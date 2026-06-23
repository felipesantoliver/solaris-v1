// backend-node/domain/routers/messages.js
//
// Rotas de mensagens - envio, edicao, listagem paginada e streaming SSE.
// Nucleo do fluxo de conversa: gerencia contexto, RAG, rate limiting e
// integracao com os modelos de IA (Gemini Flash e Pro).
//
// Dependencias principais:
//   - gemini.js        -> chamadas diretas aos modelos
//   - prompt.js        -> montagem de system prompt, cache e extracao de memorias
//   - projects.js      -> resolucao do modelo por projeto/usuario
//   - redis.js         -> rate limiting distribuido (fallback em memoria)
//
// Agrupamento logico:
//   1. Rate limiting e utilitarios de texto
//   2. Geracao de titulo automatico
//   3. Processamento e limpeza de resposta do assistente
//   4. Busca RAG (Recuperacao Aumentada por Geracao)
//   5. Montagem de contexto da conversa (buildChatContext)
//   6. Rotas HTTP (GET paginado, PATCH edicao, POST streaming, POST fallback)

import { Router } from 'express';
import { runAsync, getAsync, allAsync } from '../../db/database.js';
import { streamGeminiChat, geminiChat } from '../ai/gemini.js';
import {
  getBaseSystemPromptWithCache,
  extractMemories,
  selectContextWindow,
  invalidateSystemPromptCache,
  sanitizeModelResponse,
} from '../ai/prompt.js';
import { resolveModelForRequest } from './projects.js';
import { extractUserId } from '../../middleware/auth.js';
import { withRedis } from '../../utils/redis.js';

const router = Router();

// ---------------------------------------------------------------------------
// 1. RATE LIMITING E UTILITARIOS DE TEXTO
// ---------------------------------------------------------------------------

// Estrutura de rate limiting em memoria (fallback quando Redis nao esta disponivel).
// Armazena timestamps de requisicoes por usuario em uma janela deslizante.
const rateLimitMap = new Map();

// Limites por tipo de usuario.
// Convidado: 15 requisicoes por minuto.
// Autenticado: 40 requisicoes por minuto.
const RATE_LIMITS = {
  guest: { max: 15, windowMs: 60_000 },
  auth:  { max: 40, windowMs: 60_000 },
};

/**
 * Verifica se o usuario esta dentro do limite de requisicoes.
 * Tenta usar Redis primeiro; se indisponivel, recorre ao Map em memoria.
 *
 * @param {string}  userId  - Identificador do usuario (UUID da conta ou ID anonimo)
 * @param {boolean} isGuest - Se true, aplica limite de convidado
 * @returns {Promise<boolean>} true se a requisicao pode prosseguir
 */
export async function checkRateLimit(userId, isGuest) {
  const { max, windowMs } = isGuest ? RATE_LIMITS.guest : RATE_LIMITS.auth;
  const key = `ratelimit:${userId}`;

  return withRedis(
    // Caminho com Redis: contador atomico com TTL
    async (client) => {
      const current = await client.incr(key);
      if (current === 1) await client.expire(key, Math.ceil(windowMs / 1000));
      return current <= max;
    },
    // Fallback em memoria: janela deslizante manual
    async () => {
      const now = Date.now();
      const timestamps = (rateLimitMap.get(userId) || []).filter(t => now - t < windowMs);
      if (timestamps.length >= max) return false;
      timestamps.push(now);
      rateLimitMap.set(userId, timestamps);
      return true;
    }
  );
}

// Limpeza periodica do rate limit em memoria a cada 5 minutos.
// Remove entradas expiradas para evitar acumulo de usuarios inativos.
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimitMap.entries()) {
    const fresh = timestamps.filter(t => now - t < 60_000);
    if (fresh.length === 0) rateLimitMap.delete(key);
    else rateLimitMap.set(key, fresh);
  }
}, 5 * 60_000);

// ---------------------------------------------------------------------------
// 2. GERACAO DE TITULO AUTOMATICO
// ---------------------------------------------------------------------------

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

/**
 * Gera um titulo para a conversa a partir da primeira mensagem.
 * Fluxo em cascata:
 *   1. Tenta o microsservico Python (Groq) com timeout de 2s
 *   2. Se falhar, extrai as primeiras 7 palavras da mensagem
 *   3. Se a mensagem for muito curta, retorna "Nova conversa"
 *
 * @param {string} firstMessage - Conteudo da primeira mensagem do chat
 * @returns {Promise<string>} Titulo gerado (maximo 50 caracteres)
 */
export async function generateLocalTitle(firstMessage) {
  const FALLBACK = 'Nova conversa';
  if (!firstMessage || typeof firstMessage !== 'string') return FALLBACK;

  try {
    const ac = new AbortController();
    const t  = setTimeout(() => ac.abort(), 2_000);
    const response = await fetch(`${PYTHON_SERVICE_URL}/title/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: firstMessage }),
      signal: ac.signal,
    });
    clearTimeout(t);
    if (response.ok) {
      const data = await response.json();
      if (data.title) return data.title;
    }
  } catch (err) {
    console.warn('Failed to generate title via Python:', err.message);
  }

  // Fallback local: primeiras 7 palavras, com capitalizacao
  const cleaned = firstMessage
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[""'']/g, '')
    .trim();
  if (cleaned.length < 3) return FALLBACK;
  const words = cleaned.split(' ').filter(Boolean);
  let title = words.slice(0, 7).join(' ');
  title = title.charAt(0).toUpperCase() + title.slice(1);
  if (words.length > 7) title += '...';
  return title.substring(0, 50);
}

// ---------------------------------------------------------------------------
// 3. PROCESSAMENTO E LIMPEZA DE RESPOSTA DO ASSISTENTE
// ---------------------------------------------------------------------------

/**
 * Remove prefixos repetidos como "**Solaris:**" ou "Solaris diz:"
 * que o modelo ocasionalmente insere no inicio das respostas.
 * Apenas a primeira ocorrencia e removida; as demais permanecem
 * pois podem ser parte legitima do conteudo (ex: citacoes).
 *
 * @param {string} text - Texto bruto da resposta do modelo
 * @returns {string} Texto limpo
 */
function cleanAssistantMessage(text) {
  if (!text) return text;
  const lines = text.split(/\r?\n/);
  const cleanedLines = [];
  let firstSolarisFound = false;
  const solarisPrefixRegex = /^\s*\**\s*Solaris\s*\**\s*[:：]?\s*(diz\s*)?[:：]?\s*/i;
  for (const line of lines) {
    if (solarisPrefixRegex.test(line)) {
      const rest = line.replace(solarisPrefixRegex, '');
      if (!firstSolarisFound) {
        firstSolarisFound = true;
        if (rest.trim()) cleanedLines.push(rest);
      } else {
        if (rest.trim()) cleanedLines.push(rest);
      }
    } else {
      cleanedLines.push(line);
    }
  }
  return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Pipeline completo de limpeza da resposta.
 * 1. Remove prefixos do assistente (cleanAssistantMessage)
 * 2. Aplica sanitizacao geral (sanitizeModelResponse do prompt.js)
 *
 * @param {string} text - Texto bruto da resposta
 * @returns {string} Texto processado e pronto para exibicao/armazenamento
 */
export function processResponse(text) {
  return sanitizeModelResponse(cleanAssistantMessage(text));
}

// ---------------------------------------------------------------------------
// 4. BUSCA RAG (RECUPERACAO AUMENTADA POR GERACAO)
// ---------------------------------------------------------------------------

/**
 * Busca chunks semanticamente relevantes nos documentos do projeto.
 * Consulta o microsservico Python que gerencia embeddings e indice HNSW.
 *
 * Aplica um filtro de relevancia minima (score > 0.65) para evitar
 * injetar informacao pouco relacionada no contexto.
 *
 * @param {string|null} projectId - ID do projeto (null se chat avulso)
 * @param {string}      query     - Texto da consulta (mensagem do usuario)
 * @param {string|null} chatId    - ID do chat (usado como fallback se nao houver projeto)
 * @returns {Promise<string[]>} Array de textos dos chunks relevantes
 */
export async function searchRelevantChunks(projectId, query, chatId) {
  if (!projectId && !chatId) return [];
  try {
    const ac = new AbortController();
    const t  = setTimeout(() => ac.abort(), 10_000);
    const response = await fetch(`${PYTHON_SERVICE_URL}/search/rag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId || null, chat_id: projectId ? null : (chatId || null), query }),
      signal: ac.signal,
    });
    clearTimeout(t);
    if (!response.ok) { console.error(`RAG service error: ${response.status}`); return []; }
    const data = await response.json();
    // Filtra apenas chunks com similaridade de cosseno acima de 0.65
    return data.filter(item => item.score > 0.65).map(item => item.text);
  } catch (err) {
    console.error('RAG search failed:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 5. MONTAGEM DE CONTEXTO DA CONVERSA (buildChatContext)
// ---------------------------------------------------------------------------

/**
 * Monta o contexto completo para envio ao modelo de IA.
 * Centraliza a logica compartilhada entre os endpoints streaming e nao-streaming.
 *
 * Etapas:
 *   1. Resolve qual modelo usar (Flash/Pro) baseado no projeto, usuario ou header
 *   2. Determina o modo de memoria (projeto, global ou nenhuma)
 *   3. Busca chunks RAG relevantes e historico de mensagens em paralelo
 *   4. Monta o system prompt final com personalidade, memorias e trechos RAG
 *   5. Seleciona a janela de contexto otima (evita estouro de tokens)
 *
 * @param {string}   chatId       - ID da conversa
 * @param {string}   projectId    - ID do projeto (null se avulso)
 * @param {string}   userId       - ID do usuario
 * @param {string}   message      - Mensagem atual do usuario
 * @param {boolean}  isCodingMode - Se true, adiciona instrucoes de codigo ao prompt
 * @param {string}   headerModel  - Modelo indicado no header da requisicao
 * @param {Function} onProgress   - Callback para emitir eventos de progresso SSE
 * @returns {Promise<Object>} Contexto montado: { apiHistory, finalSystemPrompt, modelKey, memoryMode, history }
 */
async function buildChatContext(chatId, projectId, userId, message, isCodingMode, headerModel, onProgress) {
  // Resolve o modelo a ser usado (Flash ou Pro)
  const modelKey = await resolveModelForRequest(userId, projectId, headerModel);

  // Determina modo de memoria do projeto
  let memoryMode = 'projeto';
  if (projectId) {
    const proj = await getAsync('SELECT memory_mode FROM projects WHERE id = $1', [projectId]);
    if (proj?.memory_mode) memoryMode = proj.memory_mode;
  }

  // Busca chunks RAG e historico de mensagens em paralelo
  const [relevantChunks, history] = await Promise.all([
    (projectId || chatId) ? searchRelevantChunks(projectId, message, chatId) : Promise.resolve([]),
    allAsync(
      'SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [chatId]
    ),
  ]);

  // Emite evento de progresso: montando o prompt
  if (onProgress) onProgress('thinking');

  // Obtem o system prompt base (com cache) incluindo memorias e personalidade
  const baseSystemPrompt = await getBaseSystemPromptWithCache(userId, projectId, memoryMode, message, chatId);

  // Acrescenta instrucoes especificas de modo programador se ativado
  let finalSystemPrompt = baseSystemPrompt;
  if (isCodingMode) {
    finalSystemPrompt += '\n\nMODO PROGRAMADOR ATIVO: O usuario solicitou codigo. Forneca o codigo completo e funcional, sem truncar. Use blocos de codigo markdown com a linguagem correta (ex: ```cpp, ```python, ```javascript). Nao omita partes do codigo.';
  }

  // Injeta trechos relevantes dos documentos no system prompt
  if (relevantChunks.length > 0) {
    finalSystemPrompt += `\nTrechos relevantes dos seus documentos:\n\n`;
    relevantChunks.forEach((chunk, idx) => { finalSystemPrompt += `[${idx + 1}] ${chunk}\n\n`; });
    finalSystemPrompt += `Use essas informacoes quando pertinente.\n`;
  }

  // Seleciona janela de contexto otima (memorias + mensagens mais relevantes)
  const apiHistory = await selectContextWindow(history, message);

  return { apiHistory, finalSystemPrompt, modelKey, memoryMode, history };
}

// ---------------------------------------------------------------------------
// 6. ROTAS HTTP
// ---------------------------------------------------------------------------

// GET /messages/chat/:chatId
// Lista mensagens de uma conversa com paginacao.
// Ordenacao cronologica ascendente (mais antigas primeiro).
// Para mensagens do assistente, aplica processResponse para limpeza.
router.get('/messages/chat/:chatId', async (req, res, next) => {
  const { chatId } = req.params;
  const page   = parseInt(req.query.page)  || 1;
  const limit  = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  try {
    // Contagem total para paginacao
    const totalRow = await getAsync(
      'SELECT COUNT(*) AS count FROM messages WHERE chat_id = $1',
      [chatId]
    );
    const total = parseInt(totalRow?.count) || 0;

    // Busca mensagens em ordem descendente e inverte no codigo
    // (mais eficiente que ORDER BY ASC com LIMIT para chats longos)
    const rows = await allAsync(
      `SELECT id, chat_id, role, content, edited, edit_history, agent_steps, created_at
       FROM messages
       WHERE chat_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [chatId, limit, offset]
    );

    // Reverte para ordem cronologica ascendente
    const ordered = rows.reverse();

    // Limpa respostas do assistente e normaliza agent_steps para camelCase
    const cleanedRows = ordered.map(msg => {
      const { agent_steps, ...rest } = msg;
      const base = rest.role === 'assistant' && rest.content
        ? { ...rest, content: processResponse(rest.content) }
        : rest;
      return Array.isArray(agent_steps) ? { ...base, agentSteps: agent_steps } : base;
    });

    res.json({
      data: cleanedRows,
      total,
      page,
      limit,
      hasMore: offset + rows.length < total,
    });
  } catch (err) { next(err); }
});

// PATCH /messages/:messageId
// Edita uma mensagem existente e descarta todas as mensagens posteriores.
// Preserva o historico de edicoes (conteudo anterior + timestamp).
// Apos a edicao, o frontend deve reenviar para regenerar a resposta.
router.patch('/messages/:messageId', extractUserId, async (req, res, next) => {
  const { messageId } = req.params;
  const { content }   = req.body;

  if (!content || !content.trim())
    return res.status(400).json({ error: 'content cannot be empty' });

  try {
    const existing = await getAsync(
      'SELECT id, content, edit_history FROM messages WHERE id = $1',
      [messageId]
    );
    if (!existing) return res.status(404).json({ error: 'Message not found' });

    // Carrega historico de edicoes existente
    let editHistory = [];
    try {
      editHistory = Array.isArray(existing.edit_history)
        ? existing.edit_history
        : JSON.parse(existing.edit_history || '[]');
    } catch { editHistory = []; }

    // Registra o conteudo anterior antes de sobrescrever
    editHistory.push({ content: existing.content, edited_at: new Date().toISOString() });

    // Descarta mensagens posteriores para manter coerencia do historico
    await runAsync(
      `DELETE FROM messages
       WHERE chat_id = (SELECT chat_id FROM messages WHERE id = $1)
         AND id > $1`,
      [messageId]
    );

    // Atualiza a mensagem com novo conteudo e historico de edicoes
    await runAsync(
      `UPDATE messages SET content = $1, edited = true, edit_history = $2, updated_at = NOW()
       WHERE id = $3`,
      [content.trim(), JSON.stringify(editHistory), messageId]
    );

    res.json({ ok: true, id: messageId });
  } catch (err) { next(err); }
});

// POST /messages/stream
// Endpoint principal de envio de mensagem com resposta em streaming via SSE.
//
// Fluxo completo:
//   1. Verifica rate limit
//   2. Insere mensagem do usuario no banco (se nao for skip)
//   3. Emite progresso: "searching" (busca RAG em andamento)
//   4. Emite progresso: "thinking" (montagem do system prompt)
//   5. Emite progresso: "generating" (modelo gerando resposta)
//   6. Envia chunks da resposta em tempo real
//   7. Salva resposta completa no banco
//   8. Gera titulo automatico se for a primeira mensagem
//   9. Extrai memorias em background (nao bloqueia a resposta)
//  10. Invalida cache do system prompt para a proxima requisicao
//
// Eventos SSE emitidos:
//   - progress: etapa atual (searching, thinking, generating)
//   - chunk: trecho da resposta
//   - maxTokens: resposta foi truncada por limite de tokens
//   - title: titulo gerado automaticamente (apenas na primeira mensagem)
//   - done: resposta finalizada com sucesso
//   - error: erro durante o processamento
router.post('/messages/stream', extractUserId, async (req, res, next) => {
  const userId = req.userId;

  // Verifica limite de requisicoes antes de processar
  if (!(await checkRateLimit(userId, req.isGuest))) {
    return res.status(429).json({ error: 'Too many requests. Please wait before sending another message.' });
  }

  const { project_id, chat_id, message, skip_user_insert } = req.body;
  if (!chat_id || !message) return res.status(400).json({ error: 'chat_id and message are required' });
  const projectId = (project_id && project_id !== 'none') ? project_id : null;
  const isCodingMode = req.headers['x-coding-mode'] === 'true';

  // Configura headers para streaming SSE
  res.writeHead(200, {
    'Content-Type':                'text/event-stream',
    'Cache-Control':               'no-cache',
    'Connection':                  'keep-alive',
    'X-Accel-Buffering':           'no',
    'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
  });

  // Comentario inicial para estabelecer a conexao
  res.write(': processing\n\n');

  // Heartbeat a cada 15 segundos para manter a conexao viva
  // Importante para proxies e load balancers que fecham conexoes inativas
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': heartbeat\n\n');
  }, 15_000);

  // Envia um evento SSE valido
  const sendEvent = (data) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Envia evento de progresso (etapa do processamento)
  const sendProgress = (stage) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ progress: stage })}\n\n`);
  };

  try {
    // Insere mensagem do usuario (pode ser pulado em retry/regen)
    if (!skip_user_insert) {
      await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'user', message]);
    }

    // Fase 1: busca documentos relevantes
    sendProgress('searching');

    // Monta o contexto completo (RAG, memorias, system prompt, janela de contexto)
    const { apiHistory, finalSystemPrompt, modelKey, memoryMode, history } = await buildChatContext(
      chat_id, projectId, userId, message, isCodingMode, req.headers['x-model'],
      (stage) => sendProgress(stage)
    );

    // Fase 2: geracao da resposta
    sendProgress('generating');

    let fullResponse = '';
    let wasMaxTokens = false;

    // Streaming: envia cada chunk conforme o modelo gera
    for await (const event of streamGeminiChat(apiHistory, finalSystemPrompt, modelKey)) {
      if (event.chunk) {
        fullResponse += event.chunk;
        sendEvent({ chunk: event.chunk });
      }
      if (event.maxTokens) wasMaxTokens = true;
    }

    // Limpa e salva a resposta completa
    const cleanedResponse = processResponse(fullResponse);
    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'assistant', cleanedResponse]);
    await runAsync('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chat_id]);

    // Notifica o frontend se a resposta foi truncada
    if (wasMaxTokens) sendEvent({ maxTokens: true });

    // Sinaliza fim da resposta antes de gerar titulo
    // (o frontend renderiza imediatamente, titulo vem depois)
    sendEvent({ done: true });

    // Gera titulo automatico para a primeira mensagem da conversa
    const isFirst = history.length === 1;
    if (isFirst) {
      const title = await generateLocalTitle(message);
      await runAsync('UPDATE chats SET title = $1 WHERE id = $2', [title, chat_id]).catch(() => {});
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ title, chat_id })}\n\n`);
      }
    }

    // Extracao de memorias em background (nao bloqueia a resposta)
    // Executa apenas se o modo de memoria nao for "nenhuma"
    if (projectId || memoryMode === 'global') {
      extractMemories(projectId, userId, cleanedResponse, memoryMode, chat_id).catch(console.error);
      // Invalida cache do system prompt com debounce para evitar multiplas invalidacoes
      invalidateSystemPromptCache(userId, projectId, { debounce: true });
    }
  } catch (err) {
    console.error('Streaming error:', err);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: err.message || 'Internal error' })}\n\n`);
    }
    next(err);
  } finally {
    // Garante limpeza: para o heartbeat e fecha a conexao
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

// POST /messages
// Endpoint nao-streaming (fallback para clientes que nao suportam SSE).
// Mesmo fluxo do /stream, mas retorna a resposta completa em JSON.
// Usado principalmente como alternativa de compatibilidade.
router.post('/messages', extractUserId, async (req, res, next) => {
  const userId = req.userId;

  if (!(await checkRateLimit(userId, req.isGuest))) {
    return res.status(429).json({ error: 'Too many requests. Please wait before sending another message.' });
  }

  const { project_id, chat_id, message, skip_user_insert } = req.body;
  if (!chat_id || !message) return res.status(400).json({ error: 'chat_id and message are required' });
  const projectId = (project_id && project_id !== 'none') ? project_id : null;

  try {
    if (!skip_user_insert) {
      await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'user', message]);
    }

    // Monta contexto e chama o modelo de forma bloqueante (sem streaming)
    const { apiHistory, finalSystemPrompt, modelKey, memoryMode, history } = await buildChatContext(
      chat_id, projectId, userId, message, false, req.headers['x-model']
    );

    const { text, maxTokens } = await geminiChat(apiHistory, finalSystemPrompt, modelKey);
    const responseText = processResponse(text);

    // Salva resposta e atualiza timestamp da conversa
    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'assistant', responseText]);
    await runAsync('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chat_id]);

    // Titulo automatico na primeira mensagem
    const isFirst = history.length === 1;
    if (isFirst) {
      const title = await generateLocalTitle(message);
      await runAsync('UPDATE chats SET title = $1 WHERE id = $2', [title, chat_id]).catch(() => {});
    }

    // Memorias em background
    if (projectId || memoryMode === 'global') {
      extractMemories(projectId, userId, responseText, memoryMode, chat_id).catch(console.error);
      invalidateSystemPromptCache(userId, projectId);
    }

    res.json({ response: responseText, model: modelKey, maxTokens: maxTokens ?? false });
  } catch (err) { next(err); }
});

export default router;