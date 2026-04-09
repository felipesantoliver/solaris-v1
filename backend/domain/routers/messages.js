// domain/routers/messages.js — Streaming SSE, fallback, busca semântica

import { Router } from 'express';
import { runAsync, getAsync, allAsync } from '../../db/database.js';
import { streamGeminiChat, geminiChat } from '../ai/gemini.js';
import {
  getBaseSystemPromptWithCache,
  extractMemories,
  selectContextWindow,
  invalidateSystemPromptCache
} from '../ai/prompt.js';
import { generateEmbedding, cosineSimilarity } from '../ai/embeddings.js';
import { resolveModelForRequest } from './projects.js';

const router = Router();

// Utilitário de limpeza de mensagem
function cleanAssistantMessage(text) {
  if (!text) return text;
  const lines = text.split(/\r?\n/);
  const cleanedLines = [];
  let firstSolarisFound = false;
  const solarisPrefixRegex = /^\s*Solaris\s*[:：]?\s*(diz\s*)?[:：]?\s*/i;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (solarisPrefixRegex.test(line)) {
      const rest = line.replace(solarisPrefixRegex, "");
      if (!firstSolarisFound) {
        cleanedLines.push("Solaris");
        firstSolarisFound = true;
        if (rest.trim()) cleanedLines.push(rest);
      } else {
        if (rest.trim()) cleanedLines.push(rest);
      }
    } else {
      cleanedLines.push(line);
    }
  }
  let result = cleanedLines.join("\n");
  result = result.replace(/\n{3,}/g, "\n\n");
  return result.trim();
}

// Geração de título local
function generateLocalTitle(firstMessage) {
  const FALLBACK = 'Nova conversa';
  if (!firstMessage || typeof firstMessage !== 'string') return FALLBACK;
  const cleaned = firstMessage.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/["""''`]/g, '').trim();
  if (cleaned.length < 3) return FALLBACK;
  const words = cleaned.split(' ').filter(Boolean);
  let title = words.slice(0, 7).join(' ');
  title = title.charAt(0).toUpperCase() + title.slice(1);
  if (words.length > 7) title += '…';
  return title.substring(0, 50);
}

// Busca semântica
async function searchRelevantChunks(projectId, query, limit = 3) {
  if (!projectId) return [];
  const queryEmbedding = await generateEmbedding(query);
  const chunks = await allAsync(
    `SELECT fc.chunk_text, fc.embedding FROM file_chunks fc JOIN files f ON f.id = fc.file_id WHERE f.project_id = $1`,
    [projectId]
  );
  if (!chunks.length) return [];
  const withScores = chunks.map(c => ({ text: c.chunk_text, score: cosineSimilarity(queryEmbedding, JSON.parse(c.embedding)) }));
  withScores.sort((a, b) => b.score - a.score);
  return withScores.slice(0, limit).map(c => c.text);
}

// Obter mensagens de um chat
router.get('/messages/chat/:chatId', async (req, res, next) => {
  try {
    const rows = await allAsync('SELECT id, role, content, edited, edit_history, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC', [req.params.chatId]);
    const cleanedRows = rows.map(msg =>
      msg.role === 'assistant' && msg.content ? { ...msg, content: cleanAssistantMessage(msg.content) } : msg
    );
    res.json(cleanedRows);
  } catch (err) { next(err); }
});

// Streaming SSE
router.post('/messages/stream', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const { project_id, chat_id, message } = req.body;
  if (!chat_id || !message) return res.status(400).json({ error: 'chat_id e message obrigatórios' });
  const projectId = (project_id && project_id !== 'none') ? project_id : null;

  const modelKey = await resolveModelForRequest(userId, projectId, req.headers['x-model']);

  let memoryMode = 'projeto';
  if (projectId) {
    const proj = await getAsync('SELECT memory_mode FROM projects WHERE id = $1', [projectId]);
    if (proj && proj.memory_mode) memoryMode = proj.memory_mode;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
  });

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'user', message]);

    let relevantChunks = [];
    if (projectId) relevantChunks = await searchRelevantChunks(projectId, message, 3);

    const history = await allAsync('SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC', [chat_id]);
    const baseSystemPrompt = await getBaseSystemPromptWithCache(userId, projectId, memoryMode);

    let finalSystemPrompt = baseSystemPrompt;
    if (relevantChunks.length > 0) {
      finalSystemPrompt += `\n=== CONTEXTO DOS ARQUIVOS ===\nOs seguintes trechos dos seus documentos podem ser relevantes para a pergunta atual:\n\n`;
      relevantChunks.forEach((chunk, idx) => { finalSystemPrompt += `[Trecho ${idx + 1}]\n${chunk}\n\n`; });
      finalSystemPrompt += `Utilize essas informações sempre que pertinente. Se não forem úteis, ignore-as.\n`;
    }

    const apiHistory = selectContextWindow(history);
    let fullResponse = '';

    for await (const chunk of streamGeminiChat(apiHistory, finalSystemPrompt, modelKey)) {
      fullResponse += chunk;
      sendEvent({ chunk });
    }

    const cleanedResponse = cleanAssistantMessage(fullResponse);
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

    sendEvent({ done: true });
    res.end();
  } catch (err) {
    console.error('Erro no streaming:', err);
    sendEvent({ error: err.message || 'Erro interno' });
    res.end();
    next(err);
  }
});

// Fallback não-streaming
router.post('/messages', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const { project_id, chat_id, message } = req.body;
  if (!chat_id || !message) return res.status(400).json({ error: 'chat_id e message obrigatórios' });
  const projectId = (project_id && project_id !== 'none') ? project_id : null;

  const modelKey = await resolveModelForRequest(userId, projectId, req.headers['x-model']);

  let memoryMode = 'projeto';
  if (projectId) {
    const proj = await getAsync('SELECT memory_mode FROM projects WHERE id = $1', [projectId]);
    if (proj && proj.memory_mode) memoryMode = proj.memory_mode;
  }

  try {
    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'user', message]);

    let relevantChunks = [];
    if (projectId) relevantChunks = await searchRelevantChunks(projectId, message, 3);

    const history = await allAsync('SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC', [chat_id]);
    const baseSystemPrompt = await getBaseSystemPromptWithCache(userId, projectId, memoryMode);

    let finalSystemPrompt = baseSystemPrompt;
    if (relevantChunks.length > 0) {
      finalSystemPrompt += `\n=== CONTEXTO DOS ARQUIVOS ===\n`;
      relevantChunks.forEach((chunk, idx) => { finalSystemPrompt += `[Trecho ${idx + 1}]\n${chunk}\n\n`; });
      finalSystemPrompt += `Utilize essas informações sempre que pertinente.\n`;
    }

    const apiHistory = selectContextWindow(history);
    let responseText = await geminiChat(apiHistory, finalSystemPrompt, modelKey);
    responseText = cleanAssistantMessage(responseText);

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

    res.json({ response: responseText, model: modelKey });
  } catch (err) { next(err); }
});

export default router;