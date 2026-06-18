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

const RATE_LIMITS = {
  guest: { max: 2, windowMs: 60_000 },
  auth:  { max: 5, windowMs: 60_000 },
};

async function checkRateLimit(userId) {
  const isGuest = !userId || userId.length < 36;
  const { max, windowMs } = isGuest ? RATE_LIMITS.guest : RATE_LIMITS.auth;
  const key = `ratelimit:${userId}`;

  const result = await withRedis(
    async (client) => {
      const current = await client.incr(key);
      if (current === 1) {
        await client.expire(key, Math.ceil(windowMs / 1000));
      }
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

async function generateLocalTitle(firstMessage) {
  const FALLBACK = 'Nova conversa';
  if (!firstMessage || typeof firstMessage !== 'string') return FALLBACK;

  try {
    const response = await fetch(`${PYTHON_SERVICE_URL}/title/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: firstMessage }),
    });
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
    .replace(/["""''`]/g, '')
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
  const solarisPrefixRegex = /^\s*Solaris\s*[:：]?\s*(diz\s*)?[:：]?\s*/i;
  for (const line of lines) {
    if (solarisPrefixRegex.test(line)) {
      const rest = line.replace(solarisPrefixRegex, '');
      if (!firstSolarisFound) {
        cleanedLines.push('Solaris');
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

function processResponse(text) {
  return sanitizeModelResponse(cleanAssistantMessage(text));
}

// ─── RAG: busca via microsserviço Python ───────────────────────────────────
async function searchRelevantChunks(projectId, query) {
  if (!projectId) return [];
  try {
    const response = await fetch(`${PYTHON_SERVICE_URL}/search/rag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, query }),
    });
    if (!response.ok) {
      console.error(`Erro no serviço RAG: ${response.status}`);
      return [];
    }
    const data = await response.json();
    return data.filter(item => item.score > 0.65).map(item => item.text);
  } catch (err) {
    console.error('Falha na busca RAG via Python:', err.message);
    return [];
  }
}

// ─── GET mensagens de um chat (paginado) ──────────────────────────────────
// Problema 11 corrigido: paginação estava retornando mensagens mais antigas primeiro.
// Agora page=1 retorna as MAIS RECENTES; o array é revertido para preservar
// ordem cronológica no front-end (mais antiga → mais nova dentro da página).
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

    // DESC para pegar as mais recentes; revertemos abaixo para exibição cronológica
    const dataResult = await pool.query(
      `SELECT id, role, content, edited, edit_history, created_at
       FROM messages
       WHERE chat_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [chatId, limit, offset]
    );

    // Reverte para ordem cronológica (mais antiga → mais nova) dentro da página
    const rows = dataResult.rows.reverse();

    const cleanedRows = rows.map(msg =>
      msg.role === 'assistant' && msg.content
        ? { ...msg, content: processResponse(msg.content) }
        : msg
    );

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
// Problema 10 corrigido: endpoint de edição estava ausente no backend.
router.patch('/messages/:messageId', extractUserId, async (req, res, next) => {
  const { messageId } = req.params;
  const { content }   = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'content não pode estar vazio' });
  }

  try {
    const existing = await getAsync(
      'SELECT id, content, edit_history FROM messages WHERE id = $1',
      [messageId]
    );
    if (!existing) return res.status(404).json({ error: 'Mensagem não encontrada' });

    // Acumula histórico de edições
    let editHistory = [];
    try {
      editHistory = Array.isArray(existing.edit_history)
        ? existing.edit_history
        : JSON.parse(existing.edit_history || '[]');
    } catch { editHistory = []; }

    editHistory.push({
      content:   existing.content,
      edited_at: new Date().toISOString(),
    });

    await runAsync(
      `UPDATE messages
       SET content = $1, edited = true, edit_history = $2, updated_at = NOW()
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

  const modelKey = await resolveModelForRequest(userId, projectId, req.headers['x-model']);

  let memoryMode = 'projeto';
  if (projectId) {
    const proj = await getAsync('SELECT memory_mode FROM projects WHERE id = $1', [projectId]);
    if (proj?.memory_mode) memoryMode = proj.memory_mode;
  }

  res.writeHead(200, {
    'Content-Type':                'text/event-stream',
    'Cache-Control':               'no-cache',
    'Connection':                  'keep-alive',
    'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
  });

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'user', message]);

    let relevantChunks = [];
    if (projectId) relevantChunks = await searchRelevantChunks(projectId, message);

    const history = await allAsync(
      'SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [chat_id]
    );

    const baseSystemPrompt = await getBaseSystemPromptWithCache(userId, projectId, memoryMode, message);

    let finalSystemPrompt = baseSystemPrompt;
    if (relevantChunks.length > 0) {
      finalSystemPrompt += `\nTrechos relevantes dos seus documentos:\n\n`;
      relevantChunks.forEach((chunk, idx) => { finalSystemPrompt += `[${idx + 1}] ${chunk}\n\n`; });
      finalSystemPrompt += `Use essas informações quando pertinente.\n`;
    }

    const apiHistory = await selectContextWindow(history, message);
    let fullResponse = '';
    let wasMaxTokens = false;

    for await (const event of streamGeminiChat(apiHistory, finalSystemPrompt, modelKey)) {
      if (event.chunk) {
        fullResponse += event.chunk;
        sendEvent({ chunk: event.chunk });
      }
      if (event.maxTokens) {
        wasMaxTokens = true;
      }
    }

    const cleanedResponse = processResponse(fullResponse);
    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'assistant', cleanedResponse]);
    await runAsync('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chat_id]);

    const isFirst = history.length === 1;
    if (isFirst) {
      const title = await generateLocalTitle(message);
      await runAsync('UPDATE chats SET title = $1 WHERE id = $2', [title, chat_id]).catch(() => {});
      sendEvent({ title, chat_id });
    }

    if (projectId || memoryMode === 'global') {
      extractMemories(projectId, userId, cleanedResponse, memoryMode).catch(console.error);
      invalidateSystemPromptCache(userId, projectId);
    }

    if (wasMaxTokens) sendEvent({ maxTokens: true });

    sendEvent({ done: true });
    res.end();
  } catch (err) {
    console.error('Erro no streaming:', err);
    sendEvent({ error: err.message || 'Erro interno' });
    res.end();
    next(err);
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

  const modelKey = await resolveModelForRequest(userId, projectId, req.headers['x-model']);

  let memoryMode = 'projeto';
  if (projectId) {
    const proj = await getAsync('SELECT memory_mode FROM projects WHERE id = $1', [projectId]);
    if (proj?.memory_mode) memoryMode = proj.memory_mode;
  }

  try {
    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'user', message]);

    let relevantChunks = [];
    if (projectId) relevantChunks = await searchRelevantChunks(projectId, message);

    const history = await allAsync(
      'SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [chat_id]
    );

    const baseSystemPrompt = await getBaseSystemPromptWithCache(userId, projectId, memoryMode, message);

    let finalSystemPrompt = baseSystemPrompt;
    if (relevantChunks.length > 0) {
      finalSystemPrompt += `\nTrechos relevantes dos seus documentos:\n\n`;
      relevantChunks.forEach((chunk, idx) => { finalSystemPrompt += `[${idx + 1}] ${chunk}\n\n`; });
      finalSystemPrompt += `Use essas informações quando pertinente.\n`;
    }

    const apiHistory = await selectContextWindow(history, message);
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