// domain/routers/messages.js — Streaming SSE, fallback, busca RAG via Python, rate limit, mensagens paginadas

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

const router = Router();

// ─── Rate limit in-memory ──────────────────────────────────────────────────
const rateLimitMap = new Map();

const RATE_LIMITS = {
  guest: { max: 2, windowMs: 60_000 },
  auth:  { max: 5, windowMs: 60_000 },
};

function checkRateLimit(userId) {
  const isGuest = !userId || userId.length < 36;
  const { max, windowMs } = isGuest ? RATE_LIMITS.guest : RATE_LIMITS.auth;
  const now = Date.now();
  const timestamps = (rateLimitMap.get(userId) || []).filter(t => now - t < windowMs);
  if (timestamps.length >= max) return false;
  timestamps.push(now);
  rateLimitMap.set(userId, timestamps);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimitMap.entries()) {
    const fresh = timestamps.filter(t => now - t < 60_000);
    if (fresh.length === 0) rateLimitMap.delete(key);
    else rateLimitMap.set(key, fresh);
  }
}, 5 * 60_000);

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

function generateLocalTitle(firstMessage) {
  const FALLBACK = 'Nova conversa';
  if (!firstMessage || typeof firstMessage !== 'string') return FALLBACK;
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

// ─── RAG: busca via microsserviço Python ───────────────────────────────────
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

async function searchRelevantChunks(projectId, query, limit = 3) {
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

function processResponse(text) {
  return sanitizeModelResponse(cleanAssistantMessage(text));
}

// ─── GET mensagens de um chat (paginado) ──────────────────────────────────
router.get('/messages/chat/:chatId', async (req, res, next) => {
  const chatId = req.params.chatId;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 30;
  const offset = (page - 1) * limit;

  try {
    const pool = await getPool();

    // Total de mensagens do chat
    const totalResult = await pool.query(
      'SELECT COUNT(*) AS total FROM messages WHERE chat_id = $1',
      [chatId]
    );
    const total = parseInt(totalResult.rows[0]?.total || 0);

    // Dados paginados (ordenados por created_at ASC para manter ordem cronológica)
    const dataResult = await pool.query(
      `SELECT id, role, content, edited, edit_history, created_at
       FROM messages
       WHERE chat_id = $1
       ORDER BY created_at ASC
       LIMIT $2 OFFSET $3`,
      [chatId, limit, offset]
    );

    // Limpa o conteúdo das mensagens do assistente
    const cleanedRows = dataResult.rows.map(msg =>
      msg.role === 'assistant' && msg.content
        ? { ...msg, content: processResponse(msg.content) }
        : msg
    );

    res.json({
      data: cleanedRows,
      total,
      page,
      limit,
      hasMore: offset + dataResult.rows.length < total
    });
  } catch (err) { next(err); }
});

// ─── POST streaming SSE ────────────────────────────────────────────────────
router.post('/messages/stream', extractUserId, async (req, res, next) => {
  const userId = req.userId;

  if (!checkRateLimit(userId)) {
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
    if (projectId) relevantChunks = await searchRelevantChunks(projectId, message, 3);

    const history = await allAsync(
      'SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [chat_id]
    );
    const baseSystemPrompt = await getBaseSystemPromptWithCache(userId, projectId, memoryMode);

    let finalSystemPrompt = baseSystemPrompt;
    if (relevantChunks.length > 0) {
      finalSystemPrompt += `\nTrechos relevantes dos seus documentos:\n\n`;
      relevantChunks.forEach((chunk, idx) => { finalSystemPrompt += `[${idx + 1}] ${chunk}\n\n`; });
      finalSystemPrompt += `Use essas informações quando pertinente.\n`;
    }

    const apiHistory = selectContextWindow(history);
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
      const title = generateLocalTitle(message);
      await runAsync('UPDATE chats SET title = $1 WHERE id = $2', [title, chat_id]).catch(() => {});
      sendEvent({ title, chat_id });
    }

    if (projectId || memoryMode === 'global') {
      extractMemories(projectId, userId, cleanedResponse, memoryMode).catch(console.error);
      invalidateSystemPromptCache(userId, projectId);
    }

    if (wasMaxTokens) {
      sendEvent({ maxTokens: true });
    }

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

  if (!checkRateLimit(userId)) {
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
    if (projectId) relevantChunks = await searchRelevantChunks(projectId, message, 3);

    const history = await allAsync(
      'SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [chat_id]
    );
    const baseSystemPrompt = await getBaseSystemPromptWithCache(userId, projectId, memoryMode);

    let finalSystemPrompt = baseSystemPrompt;
    if (relevantChunks.length > 0) {
      finalSystemPrompt += `\nTrechos relevantes dos seus documentos:\n\n`;
      relevantChunks.forEach((chunk, idx) => { finalSystemPrompt += `[${idx + 1}] ${chunk}\n\n`; });
      finalSystemPrompt += `Use essas informações quando pertinente.\n`;
    }

    const apiHistory = selectContextWindow(history);
    const { text, maxTokens } = await geminiChat(apiHistory, finalSystemPrompt, modelKey);
    const responseText = processResponse(text);

    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'assistant', responseText]);
    await runAsync('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chat_id]);

    const isFirst = history.length === 1;
    if (isFirst) {
      const title = generateLocalTitle(message);
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