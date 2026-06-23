// backend-node/domain/routers/agent.js
//
// Modo Agente Autonomo (SSE) — loop de function calling com Gemini.
//
// Diferente do chat normal (/messages/stream), onde o modelo responde
// diretamente em streaming, aqui o modelo decide a cada rodada se chama
// uma ferramenta (rag_search, python_sandbox, web_search) ou se ja tem
// informacao suficiente para responder. Cada decisao vira um step na
// timeline, renderizado em tempo real pelo frontend.
//
// Protocolo SSE (contrato com o frontend):
//   event: agent_event
//   data: {"type":"action","runId":"...","stepId":"...","timestamp":"...","tool":{...}}
//
// O stream termina com `data: [DONE]`.
//
// Tipos de step na timeline:
//   - thought: raciocinio inicial do agente (estatico, sem chamada a IA)
//   - extended_reasoning: resumo do pensamento do Gemini (apenas Modo Pro)
//   - action: chamada de ferramenta (tool, label, input)
//   - observation: resultado da execucao da ferramenta
//   - final: resposta definitiva ao usuario (streaming simulado)
//   - error: erro durante a execucao
//
// Ferramentas disponiveis:
//   - rag_search: busca semantica nos documentos do projeto (RAG)
//   - python_sandbox: execucao isolada de codigo Python (Docker)
//   - web_search: busca na internet (stub — provedor nao configurado)
//
// Limitacao de seguranca: maximo MAX_TOOL_ITERATIONS rodadas de ferramenta
// antes de forcar uma resposta final, evitando loops infinitos.
//
// Agrupamento logico:
//   1. Constantes e configuracoes
//   2. Execucao das ferramentas
//   3. Simulacao de digitacao (streaming artificial do texto final)
//   4. Endpoint POST /agent/run (SSE)
//      - Validacao e setup da conexao
//      - Cancelamento e heartbeat
//      - Helpers de envio e persistencia
//      - Thought inicial
//      - Loop de function calling
//      - Resposta final
//      - Titulo e memorias (background)

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { runAsync, getAsync, allAsync } from '../../db/database.js';
import { extractUserId } from '../../middleware/auth.js';
import { resolveModelForRequest } from './projects.js';
import {
  getBaseSystemPromptWithCache,
  selectContextWindow,
  invalidateSystemPromptCache,
  extractMemories,
} from '../ai/prompt.js';
import { callGeminiWithTools, toGeminiContents, geminiChat } from '../ai/gemini.js';
import { checkRateLimit, searchRelevantChunks, generateLocalTitle, processResponse } from './messages.js';

const router = Router();

// ---------------------------------------------------------------------------
// 1. CONSTANTES E CONFIGURACOES
// ---------------------------------------------------------------------------

// URL do sandbox de execucao Python (servico FastAPI separado).
// Se nao configurado, a ferramenta python_sandbox responde com erro gracioso
// em vez de travar o run do agente.
const SANDBOX_URL = process.env.SANDBOX_URL || '';

// Token de autenticacao interna para o sandbox.
// Aceita SANDBOX_INTERNAL_TOKEN (variavel especifica do agente) ou
// INTERNAL_TOKEN (variavel generica compartilhada com outros servicos).
const SANDBOX_INTERNAL_TOKEN = process.env.SANDBOX_INTERNAL_TOKEN || process.env.INTERNAL_TOKEN || '';

// Numero maximo de rodadas de function calling antes de forcar uma resposta.
// Evita loops infinitos caso o modelo insista em chamar ferramentas sem
// chegar a uma conclusao (ex: chamando rag_search repetidamente com queries
// ligeiramente diferentes).
const MAX_TOOL_ITERATIONS = 4;

// Sufixo injetado no system prompt para ativar o comportamento de agente.
// Instrui o modelo a usar ferramentas apenas quando necessario e a responder
// diretamente assim que tiver informacao suficiente.
const AGENT_SYSTEM_SUFFIX = `

MODO AGENTE AUTÔNOMO ATIVO: você tem acesso a ferramentas (rag_search, python_sandbox, web_search). Use-as somente quando realmente precisar delas para responder com precisão — não chame ferramentas por padrão, nem mais de uma vez com o mesmo argumento. Assim que tiver informação suficiente, pare de chamar ferramentas e responda diretamente em texto corrido, em português, de forma clara e completa: essa será a resposta final mostrada ao usuário.`;

// ---------------------------------------------------------------------------
// 2. EXECUCAO DAS FERRAMENTAS
// ---------------------------------------------------------------------------

/**
 * Fetch com timeout usando AbortController.
 *
 * Todas as chamadas externas do agente passam por esta funcao para garantir
 * que uma ferramenta lenta nao trave o run inteiro. Timeout padrao de 8
 * segundos cobre o pior caso esperado (sandbox executando codigo complexo).
 *
 * @param {string} url       - URL a ser chamada
 * @param {Object} opts      - Opcoes do fetch (method, headers, body, etc.)
 * @param {number} timeoutMs - Timeout em milissegundos (default: 8000)
 * @returns {Promise<Response>} Resposta do fetch
 */
async function fetchWithTimeout(url, opts, timeoutMs = 8_000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gera um rotulo descritivo para exibicao na UI durante a execucao da ferramenta.
 *
 * Exemplos:
 *   - rag_search com query "autenticacao JWT" -> "Buscando "autenticacao JWT" nos documentos"
 *   - python_sandbox -> "Executando codigo Python"
 *   - web_search sem query -> "Buscando na web"
 *
 * @param {string} name - Nome da ferramenta (rag_search, python_sandbox, web_search)
 * @param {Object} args - Argumentos da chamada (pode conter query, code, etc.)
 * @returns {Object} { label: string } - Rotulo formatado para a UI
 */
function describeTool(name, args) {
  switch (name) {
    case 'rag_search':     return { label: args?.query ? `Buscando "${args.query}" nos documentos` : 'Buscando nos documentos' };
    case 'python_sandbox': return { label: 'Executando código Python' };
    case 'web_search':     return { label: args?.query ? `Buscando "${args.query}" na web` : 'Buscando na web' };
    default:                return { label: name };
  }
}

/**
 * Executa uma ferramenta chamada pelo modelo e retorna o resultado.
 *
 * Fluxo por ferramenta:
 *
 *   rag_search:
 *     - So funciona dentro de um projeto (precisa de projectId)
 *     - Chama searchRelevantChunks (busca RAG no microsservico Python)
 *     - Retorna os chunks encontrados concatenados com separador
 *
 *   python_sandbox:
 *     - Depende de SANDBOX_URL configurado
 *     - Envia o codigo para execucao isolada em Docker
 *     - Timeout proprio de 10s (alem do timeout do sandbox)
 *     - Retorna stdout, stderr e metadados da execucao
 *
 *   web_search:
 *     - Stub: provedor real ainda nao integrado (TODO)
 *     - Retorna erro gracioso para que o modelo siga sem essa ferramenta
 *
 * @param {string} name - Nome da ferramenta
 * @param {Object} args - Argumentos da chamada { query?, code? }
 * @param {Object} ctx  - Contexto { projectId, chatId }
 * @returns {Promise<Object>} { success, output?, error?, durationMs }
 */
async function executeTool(name, args, ctx) {
  const start = Date.now();
  try {
    // ── rag_search: busca semantica nos documentos do projeto ──
    if (name === 'rag_search') {
      if (!ctx.projectId) {
        return {
          success: false,
          error: 'Esta conversa não está vinculada a um projeto com documentos.',
          durationMs: Date.now() - start,
        };
      }
      const chunks = await searchRelevantChunks(ctx.projectId, args?.query || '');
      const output = chunks.length
        ? chunks.join('\n\n---\n\n')
        : 'Nenhum trecho relevante encontrado nos documentos do projeto.';
      return { success: true, output, durationMs: Date.now() - start };
    }

    // ── python_sandbox: execucao isolada de codigo Python ──
    if (name === 'python_sandbox') {
      if (!SANDBOX_URL) {
        return {
          success: false,
          error: 'Sandbox de execução Python não está configurado neste ambiente (defina SANDBOX_URL).',
          durationMs: Date.now() - start,
        };
      }
      const r = await fetchWithTimeout(`${SANDBOX_URL}/tools/python-exec`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': SANDBOX_INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          code: args?.code || '',
          timeout: 5,
          memory_limit_mb: 128,
        }),
      }, 10_000);

      if (!r.ok) {
        return {
          success: false,
          error: `Sandbox respondeu ${r.status}`,
          durationMs: Date.now() - start,
        };
      }
      const data = await r.json();
      return {
        success: !!data.success,
        output: data.output,
        error: data.error || undefined,
        durationMs: typeof data.duration_ms === 'number' ? data.duration_ms : (Date.now() - start),
      };
    }

    // ── web_search: busca na internet (stub) ──
    if (name === 'web_search') {
      // TODO: integrar um provedor real (Tavily/SerpAPI/Bing) quando
      // houver uma chave configurada. Por ora, devolve erro gracioso
      // para que o modelo receba como observation e siga sem essa ferramenta.
      return {
        success: false,
        error: 'Busca web ainda não está configurada neste ambiente.',
        durationMs: Date.now() - start,
      };
    }

    // Ferramenta desconhecida (nao deveria acontecer com function calling)
    return {
      success: false,
      error: `Ferramenta desconhecida: ${name}`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    // Erro inesperado na execucao (rede, timeout, crash)
    return {
      success: false,
      error: err.message || 'Erro ao executar ferramenta.',
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// 3. SIMULACAO DE DIGITACAO (STREAMING ARTIFICIAL DO TEXTO FINAL)
// ---------------------------------------------------------------------------

// callGeminiWithTools nao e streaming (function calling nao-streamed e mais
// simples de tratar corretamente). Para manter UX similar ao streaming real
// do /messages/stream, simulamos o efeito de chegada gradual fatiando o
// texto ja recebido por inteiro e enviando em chunks com pequeno delay.

// Tamanho do chunk em caracteres (aproximadamente 2-3 palavras).
const TYPING_CHUNK_SIZE = 8;

// Delay por chunk para respostas curtas (ms).
const TYPING_DEFAULT_DELAY_MS = 12;

// Teto de duracao total da "digitacao" simulada (ms).
// Respostas longas tem o delay por chunk reduzido para caber neste teto,
// evitando que uma resposta de 4000 caracteres demore 6 segundos so na
// animacao de digitacao.
const TYPING_TOTAL_CAP_MS = 1800;

/**
 * Divide um texto em chunks de aproximadamente size caracteres.
 *
 * A divisao respeita palavras (split por whitespace) para evitar cortes
 * no meio de uma palavra. Cada chunk tem tamanho >= size caracteres
 * (exceto o ultimo, que pode ser menor).
 *
 * @param {string} text - Texto a ser dividido
 * @param {number} size - Tamanho aproximado de cada chunk (default: 8)
 * @returns {string[]} Array de chunks
 */
function chunkText(text, size = 8) {
  if (!text) return [];
  const words = text.split(/(\s+)/);
  const out = [];
  let buf = '';
  for (const w of words) {
    buf += w;
    if (buf.length >= size) { out.push(buf); buf = ''; }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * Calcula o delay por chunk para simular digitacao natural.
 *
 * Formula:
 *   estimatedChunks = max(1, textLength / TYPING_CHUNK_SIZE)
 *   delay = min(TYPING_DEFAULT_DELAY_MS, TYPING_TOTAL_CAP_MS / estimatedChunks)
 *
 * Isso garante que:
 *   - Respostas curtas mantenham o ritmo original (12ms/chunk)
 *   - Respostas longas sejam "comprimidas" para nao ultrapassar o teto
 *   - O delay nunca seja menor que o necessario para o navegador renderizar
 *
 * @param {number} textLength - Comprimento do texto em caracteres
 * @returns {number} Delay em milissegundos por chunk
 */
function typingDelayMs(textLength) {
  const estimatedChunks = Math.max(1, Math.ceil(textLength / TYPING_CHUNK_SIZE));
  return Math.min(TYPING_DEFAULT_DELAY_MS, TYPING_TOTAL_CAP_MS / estimatedChunks);
}

/**
 * Envia um texto em chunks com delay, simulando streaming.
 *
 * Cada chunk e enviado via callback onPiece(). Entre chunks, aguarda
 * o delay calculado por typingDelayMs(). Verifica isClosed() antes de
 * cada envio para interromper se o cliente desconectou.
 *
 * @param {string}   text     - Texto a ser "digitado"
 * @param {Function} onPiece  - Callback para cada chunk (recebe string)
 * @param {Function} isClosed - Callback que retorna true se a conexao fechou
 */
async function streamTextAsDeltas(text, onPiece, isClosed) {
  const delay = typingDelayMs((text || '').length);
  for (const piece of chunkText(text)) {
    if (isClosed()) return;
    onPiece(piece);
    await new Promise(r => setTimeout(r, delay));
  }
}

// ---------------------------------------------------------------------------
// 4. ENDPOINT POST /agent/run (SSE)
// ---------------------------------------------------------------------------

router.post('/agent/run', extractUserId, async (req, res) => {
  // ── Validacao e setup da conexao ──────────────────────────────────────

  const userId = req.userId;
  const { chatId, projectId: rawProjectId, message, model: clientModel, extendedReasoning } = req.body || {};

  if (!chatId || !message || !String(message).trim()) {
    return res.status(400).json({ error: 'chatId e message são obrigatórios' });
  }

  // Rate limit: mesmo esquema do chat normal (convidado 15/min, auth 40/min)
  if (!(await checkRateLimit(userId, req.isGuest))) {
    return res.status(429).json({ error: 'Muitas requisições. Aguarde antes de enviar outra mensagem.' });
  }

  const projectId = (rawProjectId && rawProjectId !== 'none') ? rawProjectId : null;
  const runId = randomUUID();

  // Configura headers SSE
  res.writeHead(200, {
    'Content-Type':                'text/event-stream',
    'Cache-Control':                'no-cache',
    'Connection':                   'keep-alive',
    'X-Accel-Buffering':            'no',
    'Access-Control-Allow-Origin':  process.env.FRONTEND_URL || '*',
  });
  res.write(': connected\n\n');

  // ── Cancelamento ──────────────────────────────────────────────────────
  // closed = true quando o cliente desconecta (req.on 'close').
  // O controller aborts a chamada Gemini em andamento, se houver.

  let closed = false;
  let controller = null;

  req.on('close', () => {
    closed = true;
    controller?.abort();
  });

  // ── Heartbeat ─────────────────────────────────────────────────────────
  // Mantem a conexao viva para proxies/load balancers.
  // Envia comentario SSE a cada 15 segundos (ignorado pelo frontend).

  const heartbeat = setInterval(() => {
    if (!closed && !res.writableEnded) res.write(': heartbeat\n\n');
  }, 15_000);

  // ── Helpers de envio e persistencia ───────────────────────────────────

  /**
   * Envia um evento SSE no formato do protocolo do agente.
   *
   * Formato:
   *   event: agent_event
   *   data: {"type":"...", "runId":"...", "stepId":"...", "timestamp":"...", ...}
   *
   * Se a conexao estiver fechada (closed=true), nao faz nada.
   *
   * @param {Object} evt - Dados do evento (sem runId/timestamp, adicionados aqui)
   */
  const send = (evt) => {
    if (closed || res.writableEnded) return;
    res.write(`event: agent_event\ndata: ${JSON.stringify(evt)}\n\n`);
  };

  /**
   * Cria um evento base com runId e timestamp.
   * @param {Object} over - Propriedades adicionais do evento
   * @returns {Object} Evento completo
   */
  const baseEvt = (over) => ({ runId, timestamp: new Date().toISOString(), ...over });

  // stepsLog: espelho dos steps enviados ao frontend, persistido em
  // messages.agent_steps para a timeline sobreviver a reload da pagina.
  const stepsLog = [];

  /**
   * Registra um step no log de persistencia.
   * @param {Object} step - Step a ser registrado { id, type, ... }
   */
  const record = (step) => stepsLog.push(step);

  // Contador sequencial para gerar IDs unicos de step dentro deste run.
  let stepN = 0;

  /**
   * Gera o proximo ID de step no formato "s-{prefix}-{numero}".
   * @param {string} prefix - Prefixo descritivo (ex: 'thought', 'action', 'final')
   * @returns {string} ID unico do step
   */
  const nextId = (prefix) => `s-${prefix}-${++stepN}`;

  /**
   * Persiste a mensagem do assistente com a timeline completa no banco.
   *
   * Chamada ao final do run (sucesso ou erro) para garantir que a timeline
   * nao seja perdida. Se a persistencia falhar, apenas loga o erro — nao
   * mascara nem sobrepoe o erro original que levou a essa tentativa.
   *
   * @param {string} content - Texto final da resposta (ou '' se nao houve resposta)
   */
  async function saveAgentRun(content) {
    try {
      await runAsync(
        'INSERT INTO messages (chat_id, role, content, agent_steps) VALUES ($1,$2,$3,$4)',
        [chatId, 'assistant', content, JSON.stringify(stepsLog)]
      );
      await runAsync('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chatId]);
    } catch (persistErr) {
      console.error('Falha ao salvar timeline do agente:', persistErr);
    }
  }

  try {
    // ── Insere mensagem do usuario ────────────────────────────────────
    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chatId, 'user', message]);

    // ── Resolve modelo e modo ─────────────────────────────────────────
    const modelKey = await resolveModelForRequest(userId, projectId, clientModel);

    // Extended reasoning: so disponivel no modo Pro, e so solicitado uma vez
    // (na primeira rodada do loop). O modelo retorna o resumo do pensamento
    // junto com a decisao de function calling.
    const wantsExtendedReasoning = !!extendedReasoning && modelKey === 'pro';

    // ── Thought inicial (estatico, sem chamada a IA) ──────────────────
    // Primeiro step da timeline: mostra que o agente comecou a trabalhar.
    // Nao consome chamada a API — e apenas um indicador visual.
    const thoughtId = nextId('thought');
    const tStart = Date.now();
    const thoughtText = 'Avaliando a pergunta e decidindo se preciso usar alguma ferramenta…';
    send(baseEvt({ type: 'thought', stepId: thoughtId, content: thoughtText }));
    send(baseEvt({ type: 'done', stepId: thoughtId }));
    record({
      id: thoughtId, type: 'thought',
      content: thoughtText, status: 'complete',
      startedAt: tStart, completedAt: Date.now(),
    });

    // Se o cliente desconectou durante o thought inicial, salva o que tem e sai
    if (closed) {
      record({
        id: nextId('error'), type: 'error',
        content: 'Conexão encerrada pelo cliente antes de iniciar o processamento.',
        status: 'error', startedAt: Date.now(), completedAt: Date.now(),
      });
      await saveAgentRun('');
      return;
    }

    // ── Busca contexto do projeto e historico ─────────────────────────
    let memoryMode = 'projeto';
    if (projectId) {
      const proj = await getAsync('SELECT memory_mode FROM projects WHERE id = $1', [projectId]);
      if (proj?.memory_mode) memoryMode = proj.memory_mode;
    }

    const history = await allAsync(
      'SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [chatId]
    );
    const isFirst = history.length === 1;

    // System prompt: mesmo do chat normal (memorias + personalidade +
    // contexto do projeto) + sufixo especifico do agente.
    // A busca em documentos (RAG) NAO e injetada automaticamente: no
    // Modo Agente ela vira a ferramenta rag_search, chamada sob demanda
    // pelo modelo. Isso da ao agente controle sobre QUANDO e COMO buscar.
    let systemPrompt = await getBaseSystemPromptWithCache(userId, projectId, memoryMode, message);
    systemPrompt += AGENT_SYSTEM_SUFFIX;

    const apiHistory = await selectContextWindow(history, message);
    const contents = toGeminiContents(apiHistory);

    // ── Loop de function calling ──────────────────────────────────────
    // O modelo decide a cada rodada se chama ferramenta ou responde.
    // Maximo MAX_TOOL_ITERATIONS rodadas para evitar loops infinitos.
    // Se estourar o limite sem resposta final, força uma resposta.

    let finalText = '';
    let gotThought = false; // extended_reasoning so e enviado uma vez

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS && !closed; iter++) {
      controller = new AbortController();

      // Chama Gemini com tools (function calling ativado)
      const result = await callGeminiWithTools(contents, systemPrompt, modelKey, {
        signal: controller.signal,
        // So pede o resumo de raciocinio na primeira rodada, e apenas se
        // o modo Pro estiver ativo com extendedReasoning solicitado.
        includeThoughts: wantsExtendedReasoning && !gotThought,
      });

      controller = null;
      if (closed) break;

      // ── Extended reasoning (raciocinio do modelo) ─────────────────
      // Exibido como step proprio na timeline (antes das actions).
      // So aparece uma vez, na primeira rodada em que o modelo retorna.
      if (result.thought && !gotThought) {
        gotThought = true;
        const erId = nextId('reason');
        const erStart = Date.now();
        await streamTextAsDeltas(
          result.thought,
          (piece) => send(baseEvt({ type: 'extended_reasoning', stepId: erId, content: piece, delta: true })),
          () => closed
        );
        if (closed) break;
        send(baseEvt({ type: 'done', stepId: erId }));
        record({
          id: erId, type: 'extended_reasoning',
          content: result.thought, status: 'complete',
          startedAt: erStart, completedAt: Date.now(),
        });
      }

      // Empilha o turno bruto retornado pelo Gemini no historico de
      // conversa. Isso e necessario para manter o contexto de function
      // calling coerente entre rodadas — a API do Gemini exige que cada
      // turno do modelo (incluindo function calls) seja reenviado.
      if (result.rawModelContent) contents.push(result.rawModelContent);

      // ── Execucao de ferramentas ───────────────────────────────────
      if (result.functionCalls.length > 0) {
        const responseParts = [];

        for (const call of result.functionCalls) {
          if (closed) break;

          // Step: action (a ferramenta foi chamada)
          const actionId = nextId('action');
          const aStart = Date.now();
          const meta = describeTool(call.name, call.args);
          send(baseEvt({
            type: 'action', stepId: actionId,
            tool: { tool: call.name, label: meta.label, input: call.args },
          }));

          // Executa a ferramenta
          const obs = await executeTool(call.name, call.args, { projectId, chatId });

          send(baseEvt({ type: 'done', stepId: actionId }));
          record({
            id: actionId, type: 'action',
            tool: { tool: call.name, label: meta.label, input: call.args },
            status: 'complete', startedAt: aStart, completedAt: Date.now(),
          });

          // Step: observation (resultado da ferramenta)
          const obsId = nextId('observation');
          const oResult = {
            tool: call.name,
            success: obs.success,
            output: obs.output,
            durationMs: obs.durationMs,
            error: obs.error,
          };
          send(baseEvt({ type: 'observation', stepId: obsId, result: oResult }));
          send(baseEvt({ type: 'done', stepId: obsId }));
          record({
            id: obsId, type: 'observation',
            result: oResult, status: 'complete',
            startedAt: aStart, completedAt: Date.now(),
          });

          // Acumula a resposta da ferramenta para enviar ao modelo
          responseParts.push({
            functionResponse: {
              name: call.name,
              ...(call.id ? { id: call.id } : {}),
              response: obs.success
                ? { result: obs.output ?? '' }
                : { error: obs.error || 'Erro desconhecido' },
            },
          });
        }

        if (closed) break;

        // Adiciona as respostas das ferramentas ao historico e continua
        // o loop. O modelo vera os resultados e decidira o proximo passo.
        contents.push({ role: 'user', parts: responseParts });
        continue;
      }

      // ── Resposta final ─────────────────────────────────────────────
      // O modelo nao chamou nenhuma ferramenta — significa que ja tem
      // informacao suficiente e esta respondendo diretamente.
      finalText = result.text || '';
      break;
    }

    // ── Tratamento de desconexao durante o loop ─────────────────────────
    if (closed) {
      // Salva o que foi acumulado ate agora (pode ter finalText pronto)
      record({
        id: nextId('error'), type: 'error',
        content: 'Conexão encerrada pelo cliente durante a execução do agente.',
        status: 'error', startedAt: Date.now(), completedAt: Date.now(),
      });
      await saveAgentRun(finalText ? processResponse(finalText) : '');
      return;
    }

    // ── Fallback: loop estourou sem resposta final ──────────────────────
    // Seguranca: se o modelo so chamou ferramentas e nunca respondeu,
    // força uma resposta direta com o contexto acumulado ate agora.
    if (!finalText) {
      const fallback = await geminiChat(apiHistory, systemPrompt, modelKey);
      finalText = fallback.text;
    }

    // ── Envio da resposta final (streaming simulado) ───────────────────
    const cleanedFinal = processResponse(finalText);
    const finalId = nextId('final');
    const fStart = Date.now();
    await streamTextAsDeltas(
      cleanedFinal,
      (piece) => send(baseEvt({ type: 'final', stepId: finalId, content: piece, delta: true })),
      () => closed
    );
    // NOTA: mesmo se o cliente desconectou durante a digitacao simulada,
    // continuamos e salvamos a resposta completa. send() ja e no-op
    // quando closed=true, entao e seguro seguir o fluxo.
    send(baseEvt({ type: 'done', stepId: finalId }));
    record({
      id: finalId, type: 'final',
      content: cleanedFinal, status: 'complete',
      startedAt: fStart, completedAt: Date.now(),
    });

    // Persiste a resposta final com a timeline completa
    await saveAgentRun(cleanedFinal);

    // Sinaliza fim do stream para o frontend
    if (!closed && !res.writableEnded) res.write('data: [DONE]\n\n');

    // ── Titulo (1a mensagem) e memorias (background) ─────────────────
    // Igual ao /messages/stream: titulo e memorias sao processados em
    // background e nao bloqueiam a resposta ao usuario.
    // Nao ha evento "title" dedicado no protocolo do agente; o frontend
    // atualiza a sidebar via refresh da lista de chats apos o run terminar.
    if (isFirst) {
      generateLocalTitle(message)
        .then(title => runAsync('UPDATE chats SET title = $1 WHERE id = $2', [title, chatId]))
        .catch(() => {});
    }

    if (projectId || memoryMode === 'global') {
      extractMemories(projectId, userId, cleanedFinal, memoryMode).catch(console.error);
      invalidateSystemPromptCache(userId, projectId, { debounce: true });
    }
  } catch (err) {
    // ── Tratamento de erro ────────────────────────────────────────────
    console.error('Erro no agente:', err);
    const errMessage = err.message || 'Erro interno no agente.';
    const errStepId = nextId('error');
    record({
      id: errStepId, type: 'error', content: errMessage,
      status: 'error', startedAt: Date.now(), completedAt: Date.now(),
    });

    if (!closed && !res.writableEnded) {
      send(baseEvt({ type: 'error', stepId: errStepId, errorMessage: errMessage }));
      res.write('data: [DONE]\n\n');
    }

    // Salva o que foi acumulado ate a excecao.
    // content='' porque nao ha resposta final confiavel neste ponto.
    await saveAgentRun('');
  } finally {
    // ── Limpeza ────────────────────────────────────────────────────────
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

export default router;