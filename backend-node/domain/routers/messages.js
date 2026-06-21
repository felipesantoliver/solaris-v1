// backend-node/domain/routers/messages.js
import { Router } from 'express';
import { getPool, runAsync, getAsync, allAsync } from '../../db/database.js';
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
import { getRedisClient, withRedis } from '../../utils/redis.js';

const router = Router();

// ─── Rate limit in-memory (fallback) ──────────────────────────────────────
const rateLimitMap = new Map();

// FIX: limites anteriores (guest: 2, auth: 5) eram muito baixos para uso normal.
// Novo: guest: 15/min, auth: 40/min.
const RATE_LIMITS = {
  guest: { max: 15, windowMs: 60_000 },
  auth:  { max: 40, windowMs: 60_000 },
};

export async function checkRateLimit(userId) {
  const isGuest = !userId || userId.length < 36;
  const { max, windowMs } = isGuest ? RATE_LIMITS.guest : RATE_LIMITS.auth;
  const key = `ratelimit:${userId}`;

  const result = await withRedis(
    async (client) => {
      const current = await client.incr(key);
      if (current === 1) await client.expire(key, Math.ceil(windowMs / 1000));
      return current <= max;
    },
    async () => {
      const now = Date.now();
      const timestamps = (rateLimitMap.get(userId) || []).filter(t => now - t < windowMs);
      if (timestamps.length >= max) return false;
      timestamps.push(now);
      rateLimitMap.set(userId, timestamps);
      return true;
    }
  );
  return result;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimitMap.entries()) {
    const fresh = timestamps.filter(t => now - t < 60_000);
    if (fresh.length === 0) rateLimitMap.delete(key);
    else rateLimitMap.set(key, fresh);
  }
}, 5 * 60_000);

// ─── Geração de título com Groq via Python ──────────────────────────────
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

export async function generateLocalTitle(firstMessage) {
  const FALLBACK = 'Nova conversa';
  if (!firstMessage || typeof firstMessage !== 'string') return FALLBACK;

  try {
    const ac = new AbortController();
    // FIX: timeout reduzido de 8s para 2s — não vale bloquear o evento
    // "done" por 8 segundos só para gerar um título.
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
    console.warn('⚠️ Falha ao gerar título via Python:', err.message);
  }

  const cleaned = firstMessage
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[""""'']/g, '')
    .trim();
  if (cleaned.length < 3) return FALLBACK;
  const words = cleaned.split(' ').filter(Boolean);
  let title = words.slice(0, 7).join(' ');
  title = title.charAt(0).toUpperCase() + title.slice(1);
  if (words.length > 7) title += '…';
  return title.substring(0, 50);
}

// ─── Helpers ───────────────────────────────────────────────────────────────
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

export function processResponse(text) {
  return sanitizeModelResponse(cleanAssistantMessage(text));
}

// ─── RAG: busca via microsserviço Python ───────────────────────────────────
export async function searchRelevantChunks(projectId, query) {
  if (!projectId) return [];
  try {
    const ac = new AbortController();
    const t  = setTimeout(() => ac.abort(), 10_000);
    const response = await fetch(`${PYTHON_SERVICE_URL}/search/rag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, query }),
      signal: ac.signal,
    });
    clearTimeout(t);
    if (!response.ok) { console.error(`Erro no serviço RAG: ${response.status}`); return []; }
    const data = await response.json();
    return data.filter(item => item.score > 0.65).map(item => item.text);
  } catch (err) {
    console.error('Falha na busca RAG via Python:', err.message);
    return [];
  }
}

// ─── Construção do contexto de chat (compartilhado entre /messages/stream e /messages) ──
// Centraliza: resolução de modelo, memory_mode do projeto, busca paralela de
// RAG + histórico, montagem do system prompt (com cache) e seleção da janela
// de contexto. NÃO executa side-effects pós-resposta (extractMemories,
// invalidateSystemPromptCache, generateLocalTitle, UPDATE chats) — isso
// permanece em cada handler.
//
// onProgress(stage) é opcional: usado apenas pelo handler de streaming para
// emitir eventos SSE de progresso ('thinking', antes do system prompt). O
// handler de fallback não passa esse callback — comportamento inalterado.
async function buildChatContext(chatId, projectId, userId, message, isCodingMode, headerModel, onProgress) {
  const modelKey = await resolveModelForRequest(userId, projectId, headerModel);

  // 1. memory_mode do projeto (1 query SQL)
  let memoryMode = 'projeto';
  if (projectId) {
    const proj = await getAsync('SELECT memory_mode FROM projects WHERE id = $1', [projectId]);
    if (proj?.memory_mode) memoryMode = proj.memory_mode;
  }

  // 2. RAG (se houver projeto) em paralelo com o histórico de mensagens
  const [relevantChunks, history] = await Promise.all([
    projectId ? searchRelevantChunks(projectId, message) : Promise.resolve([]),
    allAsync(
      'SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [chatId]
    ),
  ]);

  if (onProgress) onProgress('thinking');

  // 3. System prompt base (com cache)
  const baseSystemPrompt = await getBaseSystemPromptWithCache(userId, projectId, memoryMode, message);

  let finalSystemPrompt = baseSystemPrompt;
  if (isCodingMode) {
    finalSystemPrompt += '\n\nMODO PROGRAMADOR ATIVO: O usuário solicitou código. Forneça o código completo e funcional, sem truncar. Use blocos de código markdown com a linguagem correta (ex: ```cpp, ```python, ```javascript). Não omita partes do código.';
  }
  if (relevantChunks.length > 0) {
    finalSystemPrompt += `\nTrechos relevantes dos seus documentos:\n\n`;
    relevantChunks.forEach((chunk, idx) => { finalSystemPrompt += `[${idx + 1}] ${chunk}\n\n`; });
    finalSystemPrompt += `Use essas informações quando pertinente.\n`;
  }

  const apiHistory = await selectContextWindow(history, message);

  // 4. Retorno: apiHistory, finalSystemPrompt, modelKey, memoryMode
  // (+ history, necessário nos handlers para o check de "isFirst")
  return { apiHistory, finalSystemPrompt, modelKey, memoryMode, history };
}

// ─── GET mensagens de um chat (paginado) ──────────────────────────────────
router.get('/messages/chat/:chatId', async (req, res, next) => {
  const chatId = req.params.chatId;
  const page   = parseInt(req.query.page)  || 1;
  const limit  = parseInt(req.query.limit) || 30;
  const offset = (page - 1) * limit;

  try {
    const pool = await getPool();

    const totalResult = await pool.query(
      'SELECT COUNT(*) AS total FROM messages WHERE chat_id = $1',
      [chatId]
    );
    const total = parseInt(totalResult.rows[0]?.total || 0);

    const dataResult = await pool.query(
      `SELECT id, role, content, edited, edit_history, agent_steps, created_at
       FROM messages
       WHERE chat_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [chatId, limit, offset]
    );

    const rows = dataResult.rows.reverse();

    const cleanedRows = rows.map(msg => {
      const { agent_steps, ...rest } = msg;
      const base = rest.role === 'assistant' && rest.content
        ? { ...rest, content: processResponse(rest.content) }
        : rest;
      // agent_steps (JSONB) já vem desserializado pelo driver `pg` — só
      // remapeia pro nome camelCase que o frontend (MessageBubble) espera.
      return Array.isArray(agent_steps) ? { ...base, agentSteps: agent_steps } : base;
    });

    res.json({
      data: cleanedRows,
      total,
      page,
      limit,
      hasMore: offset + dataResult.rows.length < total,
    });
  } catch (err) { next(err); }
});

// ─── PATCH editar mensagem ─────────────────────────────────────────────────
router.patch('/messages/:messageId', extractUserId, async (req, res, next) => {
  const { messageId } = req.params;
  const { content }   = req.body;

  if (!content || !content.trim())
    return res.status(400).json({ error: 'content não pode estar vazio' });

  try {
    const existing = await getAsync(
      'SELECT id, content, edit_history FROM messages WHERE id = $1',
      [messageId]
    );
    if (!existing) return res.status(404).json({ error: 'Mensagem não encontrada' });

    let editHistory = [];
    try {
      editHistory = Array.isArray(existing.edit_history)
        ? existing.edit_history
        : JSON.parse(existing.edit_history || '[]');
    } catch { editHistory = []; }

    editHistory.push({ content: existing.content, edited_at: new Date().toISOString() });

    await runAsync(
      `UPDATE messages SET content = $1, edited = true, edit_history = $2, updated_at = NOW()
       WHERE id = $3`,
      [content.trim(), JSON.stringify(editHistory), messageId]
    );

    res.json({ ok: true, id: messageId });
  } catch (err) { next(err); }
});

// ─── POST streaming SSE ────────────────────────────────────────────────────
router.post('/messages/stream', extractUserId, async (req, res, next) => {
  const userId = req.userId;

  if (!(await checkRateLimit(userId))) {
    return res.status(429).json({ error: 'Muitas requisições. Aguarde antes de enviar outra mensagem.' });
  }

  const { project_id, chat_id, message } = req.body;
  if (!chat_id || !message) return res.status(400).json({ error: 'chat_id e message obrigatórios' });
  const projectId = (project_id && project_id !== 'none') ? project_id : null;

  const isCodingMode = req.headers['x-coding-mode'] === 'true';

  res.writeHead(200, {
    'Content-Type':                'text/event-stream',
    'Cache-Control':               'no-cache',
    'Connection':                  'keep-alive',
    'X-Accel-Buffering':           'no',
    'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
  });

  res.write(': processing\n\n');

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': heartbeat\n\n');
  }, 15_000);

  const sendEvent = (data) => {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Eventos de progresso (não interferem no layout/UI — apenas informam a etapa atual)
  const sendProgress = (stage) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ progress: stage })}\n\n`);
  };

  try {
    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'user', message]);

    sendProgress('searching'); // antes do RAG (disparado dentro de buildChatContext)

    const { apiHistory, finalSystemPrompt, modelKey, memoryMode, history } = await buildChatContext(
      chat_id, projectId, userId, message, isCodingMode, req.headers['x-model'],
      (stage) => sendProgress(stage) // emite 'thinking' antes do system prompt
    );

    sendProgress('generating'); // antes do stream do Gemini

    let fullResponse = '';
    let wasMaxTokens = false;

    for await (const event of streamGeminiChat(apiHistory, finalSystemPrompt, modelKey)) {
      if (event.chunk) {
        fullResponse += event.chunk;
        sendEvent({ chunk: event.chunk });
      }
      if (event.maxTokens) wasMaxTokens = true;
    }

    const cleanedResponse = processResponse(fullResponse);
    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'assistant', cleanedResponse]);
    await runAsync('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chat_id]);

    if (wasMaxTokens) sendEvent({ maxTokens: true });

    // FIX PRIMEIRA RESPOSTA: envia "done" ANTES de gerar o título.
    // Antes: generateLocalTitle tinha timeout de 8s e bloqueava o "done",
    // fazendo o frontend não renderizar a resposta até o timeout expirar.
    // Agora: o frontend recebe "done" imediatamente → renderiza a resposta →
    // o título é gerado em background (timeout de 2s) e enviado depois.
    sendEvent({ done: true });

    const isFirst = history.length === 1;
    if (isFirst) {
      const title = await generateLocalTitle(message);
      await runAsync('UPDATE chats SET title = $1 WHERE id = $2', [title, chat_id]).catch(() => {});
      // Envia o título após o done — o frontend deve aceitar eventos após done
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ title, chat_id })}\n\n`);
      }
    }

    if (projectId || memoryMode === 'global') {
      extractMemories(projectId, userId, cleanedResponse, memoryMode).catch(console.error);
      invalidateSystemPromptCache(userId, projectId, { debounce: true });
    }

  } catch (err) {
    console.error('Erro no streaming:', err);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: err.message || 'Erro interno' })}\n\n`);
    }
    next(err);
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

// ─── POST fallback não-streaming ───────────────────────────────────────────
router.post('/messages', extractUserId, async (req, res, next) => {
  const userId = req.userId;

  if (!(await checkRateLimit(userId))) {
    return res.status(429).json({ error: 'Muitas requisições. Aguarde antes de enviar outra mensagem.' });
  }

  const { project_id, chat_id, message } = req.body;
  if (!chat_id || !message) return res.status(400).json({ error: 'chat_id e message obrigatórios' });
  const projectId = (project_id && project_id !== 'none') ? project_id : null;

  try {
    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'user', message]);

    // Handler de fallback nunca leu x-coding-mode no original — mantido como false.
    // Sem onProgress: nenhum evento SSE de progresso aqui (não é streaming).
    const { apiHistory, finalSystemPrompt, modelKey, memoryMode, history } = await buildChatContext(
      chat_id, projectId, userId, message, false, req.headers['x-model']
    );

    const { text, maxTokens } = await geminiChat(apiHistory, finalSystemPrompt, modelKey);
    const responseText = processResponse(text);

    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'assistant', responseText]);
    await runAsync('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chat_id]);

    const isFirst = history.length === 1;
    if (isFirst) {
      const title = await generateLocalTitle(message);
      await runAsync('UPDATE chats SET title = $1 WHERE id = $2', [title, chat_id]).catch(() => {});
    }

    if (projectId || memoryMode === 'global') {
      extractMemories(projectId, userId, responseText, memoryMode).catch(console.error);
      invalidateSystemPromptCache(userId, projectId);
    }

    res.json({ response: responseText, model: modelKey, maxTokens: maxTokens ?? false });
  } catch (err) { next(err); }
});

export default router;