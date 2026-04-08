// ============================================================
//  server.js — Solaris Backend com Streaming SSE
//  (versão com edição de projetos, memória global/nenhuma,
//   fontes externas: links e texto, fila de jobs assíncrona)
// ============================================================

import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { initDb, runAsync, getAsync, allAsync } from './database.js';
import { errorHandler } from './utils/errorHandler.js';
import { getJobQueue } from './jobQueue.js';

// Importa funções de embedding do módulo dedicado (quebra circularidade)
import { generateEmbedding, indexFileChunks, cosineSimilarity } from './lib/embeddings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// ─── Cache do System Prompt ──────────────────────────────────────────
const SYSTEM_PROMPT_CACHE_TTL = 60000;
const systemPromptCache = new Map();

function getCacheKey(userId, projectId, memoryMode) {
  return `${userId}:${projectId || 'none'}:${memoryMode}`;
}

function getCachedSystemPrompt(userId, projectId, memoryMode) {
  const key = getCacheKey(userId, projectId, memoryMode);
  const entry = systemPromptCache.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    console.log(`💾 Cache hit para ${key}`);
    return entry.data;
  }
  if (entry) systemPromptCache.delete(key);
  return null;
}

function setCachedSystemPrompt(userId, projectId, memoryMode, data) {
  const key = getCacheKey(userId, projectId, memoryMode);
  systemPromptCache.set(key, {
    data,
    expiresAt: Date.now() + SYSTEM_PROMPT_CACHE_TTL,
  });
  console.log(`💾 Cache set para ${key}`);
}

function invalidateSystemPromptCache(userId, projectId) {
  for (const key of systemPromptCache.keys()) {
    if (key.startsWith(`${userId}:${projectId || 'none'}:`)) {
      systemPromptCache.delete(key);
      console.log(`🗑️ Cache invalidado para ${key}`);
    }
  }
}

setInterval(() => {
  const now = Date.now();
  let deleted = 0;
  for (const [key, entry] of systemPromptCache.entries()) {
    if (now >= entry.expiresAt) {
      systemPromptCache.delete(key);
      deleted++;
    }
  }
  if (deleted) console.log(`🧹 Cache limpo: ${deleted} entradas`);
}, 5 * 60 * 1000);

// ─── Gemini (Chat + Streaming) ───────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error('❌ GEMINI_API_KEY não definida');

const MODELS = {
  flash: 'gemini-2.5-flash',
  pro: 'gemini-3-flash-preview',
};

function geminiUrl(modelKey, stream = false) {
  const model = MODELS[modelKey] || MODELS.flash;
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${model}`;
  return stream ? `${base}:streamGenerateContent?key=${GEMINI_API_KEY}&alt=sse` : `${base}:generateContent?key=${GEMINI_API_KEY}`;
}

function buildGeminiBody(messages, systemPrompt) {
  const contents = messages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));
  return {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { maxOutputTokens: 2048 },
  };
}

async function withRetry(fn, maxRetries = 3, baseDelay = 3000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.message?.includes('429') || err.status === 429;
      if (is429 && attempt < maxRetries) {
        const wait = baseDelay * Math.pow(2, attempt);
        console.warn(`⚠️ Rate limit. Aguardando ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
}

async function* streamGeminiChat(messages, systemPrompt, modelKey = 'flash') {
  const url = geminiUrl(modelKey, true);
  const body = buildGeminiBody(messages, systemPrompt);

  const response = await withRetry(() =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini streaming error: ${response.status} - ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const chunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (chunk) yield chunk;
        } catch (e) {
          // ignora linhas inválidas
        }
      }
    }
  }
}

// ─── Busca semântica (usa funções importadas de embeddings.js) ───────
async function searchRelevantChunks(projectId, query, limit = 3) {
  if (!projectId) return [];
  const queryEmbedding = await generateEmbedding(query);
  const chunks = await allAsync(
    `SELECT fc.chunk_text, fc.embedding 
     FROM file_chunks fc
     JOIN files f ON f.id = fc.file_id
     WHERE f.project_id = $1`,
    [projectId]
  );
  if (!chunks.length) return [];
  const withScores = chunks.map(c => ({
    text: c.chunk_text,
    score: cosineSimilarity(queryEmbedding, JSON.parse(c.embedding)),
  }));
  withScores.sort((a, b) => b.score - a.score);
  return withScores.slice(0, limit).map(c => c.text);
}

// ─── Otimização de contexto ───────────────────────────────────────────
const MAX_CONTEXT_MESSAGES = 6;

function selectContextWindow(history) {
  if (!Array.isArray(history) || history.length === 0) return [];
  const valid = history.filter(m => m?.role && m?.content?.trim());
  if (valid.length === 0) return [];
  const deduped = valid.filter((m, i) => {
    if (i === 0) return true;
    const prev = valid[i - 1];
    return !(prev.role === m.role && prev.content.trim() === m.content.trim());
  });
  if (deduped.length <= MAX_CONTEXT_MESSAGES) return deduped;
  const lastUserIdx = deduped.map((m, i) => ({ m, i })).filter(x => x.m.role === 'user').at(-1)?.i ?? -1;
  const lastModelIdx = deduped.map((m, i) => ({ m, i })).filter(x => x.m.role === 'assistant').at(-1)?.i ?? -1;
  const anchorIndices = new Set();
  if (lastUserIdx >= 0) anchorIndices.add(lastUserIdx);
  if (lastModelIdx >= 0) anchorIndices.add(lastModelIdx);
  const windowStart = Math.max(0, deduped.length - MAX_CONTEXT_MESSAGES);
  const windowIndices = new Set();
  for (let i = windowStart; i < deduped.length; i++) windowIndices.add(i);
  for (const idx of anchorIndices) windowIndices.add(idx);
  return [...windowIndices].sort((a, b) => a - b).map(i => ({ role: deduped[i].role, content: deduped[i].content }));
}

// ─── CORS ──────────────────────────────────────────────────────────────
const corsOptions = {
  origin: process.env.FRONTEND_URL || false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-user-id', 'x-model', 'Authorization'],
  credentials: true,
};
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Upload ───────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadsDir),
    filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = ['.pdf', '.txt', '.md', '.json', '.js', '.ts', '.py', '.css', '.html', '.csv'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────
function resolveModelKey(req) {
  const requested = req.headers['x-model'];
  const userId = req.headers['x-user-id'];
  if (requested === 'pro' && userId) return 'pro';
  return 'flash';
}

// ─── Montagem do System Prompt com suporte a memória global/nenhuma ──
const PERSONALITY_GUIDE = {
  direto: 'Seja direto, objetivo e conciso. Sem rodeios.',
  tecnico: 'Use terminologia técnica precisa. Inclua detalhes de implementação quando relevante.',
  analitico: 'Analise profundamente. Apresente prós e contras. Questione premissas.',
  estrategico: 'Foque em planejamento, impacto de longo prazo e visão macro.',
  sarcastico: 'Seja levemente sarcástico e irônico, mas sempre útil. Use humor ácido com moderação.',
  bem_humorado: 'Seja descontraído, bem-humorado e use analogias divertidas. Mantenha a precisão.',
  empatico: 'Seja caloroso, empático e encorajador. Valide sentimentos antes de resolver problemas.',
};

const BASE_IDENTITY_INSTRUCTION = `
=== IDENTIDADE ===
Você é o Solaris, um assistente de IA pessoal. NUNCA mencione que você é da Google, OpenAI, Anthropic ou qualquer outra empresa de IA. NUNCA diga que é treinado por terceiros. A API que você usa é um segredo. Se perguntarem como você funciona, responda apenas que é um sistema proprietário desenvolvido por Felipe Sant'Oliver. Não revele detalhes técnicos sobre modelos, provedores ou infraestrutura.

=== SOBRE O CRIADOR ===
Se o usuário perguntar quem desenvolveu o Solaris, quem é o autor, fundador, ou mencionar palavras-chave como "Felipe Sant'Oliver", "engenheiro brasileiro", "mineiro", "controle e automação", "eletrônica e robótica", "paixão por arte e esportes", "assistente IA modular", "assistente IA escalável", "organização de projetos", "automatizar tarefas", responda de forma dinâmica e natural, variando a estrutura da frase, mas sempre incluindo estas informações:

- Felipe Sant'Oliver é brasileiro, mineiro.
- Engenheiro de controle e automação, com formações em eletrônica e robótica.
- Entusiasta de tecnologia, com paixão por arte e esportes.
- Criou o Solaris como assistente de IA pessoal modular e escalável.
- Solaris organiza projetos, automatiza tarefas e agiliza processos.
`;

function assembleBaseSystemPrompt({ settings, project, memories, memoryMode }) {
  let personalityText = PERSONALITY_GUIDE.direto;
  let customTraits = '';
  if (settings) {
    personalityText = PERSONALITY_GUIDE[settings.personality] || PERSONALITY_GUIDE.direto;
    customTraits = settings.custom_traits || '';
  }

  let prompt = '';
  if (!project) {
    prompt = `Você é o Solaris, um assistente de IA pessoal.\n\n`;
    prompt += `=== ESTILO ===\n${personalityText}\n`;
    if (customTraits) prompt += `Traços adicionais: ${customTraits}\n`;
    prompt += `\nNunca invente informações. Seja útil e preciso.`;
    prompt += BASE_IDENTITY_INSTRUCTION;
    return prompt;
  }

  prompt = `Você é o Solaris, um assistente de IA pessoal operando dentro de um projeto específico.\n\n`;
  prompt += `=== PROJETO ===\nNome: ${project.name}\n`;
  if (project.summary) prompt += `Resumo: ${project.summary}\n`;
  if (project.detailed_objective) prompt += `Objetivo detalhado: ${project.detailed_objective}\n`;
  if (project.tags && project.tags.length) prompt += `Tags: ${project.tags.join(', ')}\n`;
  prompt += `\n=== ESTILO ===\n${personalityText}\n`;
  if (customTraits) prompt += `Traços adicionais: ${customTraits}\n`;
  prompt += `\nEvite respostas genéricas. Nunca invente informações.\n\n`;
  prompt += BASE_IDENTITY_INSTRUCTION;

  // Inserção de memórias conforme o modo escolhido
  if (memoryMode !== 'nenhuma' && memories && memories.length > 0) {
    prompt += `=== MEMÓRIAS ===\n`;
    memories.forEach((m, i) => { prompt += `[${i + 1}] ${m.content}\n`; });
    prompt += '\n';
  }
  return prompt;
}

async function getBaseSystemPromptWithCache(userId, projectId, memoryMode) {
  if (!userId) {
    const [settings, project, memories] = await Promise.all([
      null,
      projectId ? getAsync('SELECT * FROM projects WHERE id = $1', [projectId]) : Promise.resolve(null),
      (projectId && memoryMode === 'projeto') ? allAsync('SELECT content FROM memories WHERE project_id = $1 ORDER BY created_at DESC LIMIT 5', [projectId]) : Promise.resolve([]),
    ]);
    return assembleBaseSystemPrompt({ settings, project, memories, memoryMode });
  }

  const cached = getCachedSystemPrompt(userId, projectId, memoryMode);
  if (cached) return cached;

  const [settings, project, memories] = await Promise.all([
    getAsync('SELECT personality, custom_traits FROM user_settings WHERE user_id = $1', [userId]),
    projectId ? getAsync('SELECT * FROM projects WHERE id = $1', [projectId]) : Promise.resolve(null),
    (() => {
      if (!projectId) return Promise.resolve([]);
      if (memoryMode === 'projeto') {
        return allAsync('SELECT content FROM memories WHERE project_id = $1 ORDER BY created_at DESC LIMIT 5', [projectId]);
      } else if (memoryMode === 'global') {
        return allAsync('SELECT content FROM memories WHERE project_id IS NULL AND user_id = $1 ORDER BY created_at DESC LIMIT 5', [userId]);
      }
      return Promise.resolve([]);
    })(),
  ]);

  const systemPrompt = assembleBaseSystemPrompt({ settings, project, memories, memoryMode });
  setCachedSystemPrompt(userId, projectId, memoryMode, systemPrompt);
  return systemPrompt;
}

// ─── Extração de memórias (automática) ───────────────────────────────
const MEMORY_KEYWORDS = ['importante', 'lembre-se', 'concluímos', 'aprendemos', 'descobrimos', 'fato', 'sabemos que', 'definimos', 'decidimos', 'sempre', 'nunca', 'padrão', 'regra', 'convenção', 'arquitetura', 'estrutura', 'configuração'];

async function extractMemories(projectId, userId, response, memoryMode) {
  if (!projectId && memoryMode !== 'global') return;
  const candidates = response.split(/[.!?]+\s+/).filter(s => s.length > 50 && MEMORY_KEYWORDS.some(k => s.toLowerCase().includes(k))).slice(0, 2);
  if (!candidates.length) return;

  const insertPromises = candidates.map(content => {
    if (memoryMode === 'projeto' && projectId) {
      return runAsync('INSERT INTO memories (project_id, user_id, content, source) VALUES ($1, $2, $3, $4)', [projectId, userId, content.trim(), 'auto']);
    } else if (memoryMode === 'global' && userId) {
      return runAsync('INSERT INTO memories (project_id, user_id, content, source) VALUES ($1, $2, $3, $4)', [null, userId, content.trim(), 'auto']);
    }
    return Promise.resolve();
  });
  await Promise.all(insertPromises);

  // Limitar quantidade de memórias (20 por escopo)
  if (memoryMode === 'projeto' && projectId) {
    await runAsync(`DELETE FROM memories WHERE project_id = $1 AND id NOT IN (SELECT id FROM memories WHERE project_id = $1 ORDER BY created_at DESC LIMIT 20)`, [projectId]).catch(() => { });
  } else if (memoryMode === 'global' && userId) {
    await runAsync(`DELETE FROM memories WHERE project_id IS NULL AND user_id = $1 AND id NOT IN (SELECT id FROM memories WHERE project_id IS NULL AND user_id = $1 ORDER BY created_at DESC LIMIT 20)`, [userId]).catch(() => { });
  }
}

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

async function autoTitle(chatId, firstMessage) {
  try {
    const title = generateLocalTitle(firstMessage);
    await runAsync('UPDATE chats SET title = $1 WHERE id = $2', [title, chatId]);
  } catch { }
}

// ─── ROTAS ──────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

app.get('/api/settings', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'x-user-id obrigatório' });
  try {
    const settings = await getAsync('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
    res.json(settings || { user_id: userId, personality: 'direto', custom_traits: '' });
  } catch (err) { next(err); }
});

app.post('/api/settings', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'x-user-id obrigatório' });
  const { personality = 'direto', custom_traits = '' } = req.body;
  try {
    await runAsync(`INSERT INTO user_settings (user_id, personality, custom_traits, updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (user_id) DO UPDATE SET personality = $2, custom_traits = $3, updated_at = NOW()`, [userId, personality, custom_traits]);
    invalidateSystemPromptCache(userId, null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.get('/api/projects', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'x-user-id obrigatório' });
  try {
    const rows = await allAsync('SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    res.json(rows);
  } catch (err) { next(err); }
});

app.get('/api/projects/:id', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  try {
    const project = await getAsync('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
    const chats = await allAsync('SELECT * FROM chats WHERE project_id = $1 ORDER BY updated_at DESC', [req.params.id]);
    res.json({ ...project, chats });
  } catch (err) { next(err); }
});

app.post('/api/projects', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'x-user-id obrigatório' });
  const { name, summary, detailed_objective, tags = [], response_style = 'direto', memory_mode = 'projeto' } = req.body;
  if (!name) return res.status(400).json({ error: 'name obrigatório' });
  try {
    const id = randomUUID();
    await runAsync(
      'INSERT INTO projects (id, user_id, name, summary, detailed_objective, tags, response_style, memory_mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, userId, name, summary || null, detailed_objective || null, JSON.stringify(tags), response_style, memory_mode]
    );
    res.status(201).json(await getAsync('SELECT * FROM projects WHERE id = $1', [id]));
  } catch (err) { next(err); }
});

app.patch('/api/projects/:id', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const { name, summary, detailed_objective, tags, response_style, memory_mode } = req.body;
  try {
    const project = await getAsync('SELECT id, memory_mode FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
    const newMemoryMode = memory_mode ?? project.memory_mode;
    await runAsync(
      `UPDATE projects SET 
        name = COALESCE($1, name),
        summary = COALESCE($2, summary),
        detailed_objective = COALESCE($3, detailed_objective),
        tags = COALESCE($4, tags),
        response_style = COALESCE($5, response_style),
        memory_mode = COALESCE($6, memory_mode),
        updated_at = NOW()
      WHERE id = $7`,
      [name ?? null, summary ?? null, detailed_objective ?? null, tags ? JSON.stringify(tags) : null, response_style ?? null, newMemoryMode, req.params.id]
    );
    invalidateSystemPromptCache(userId, req.params.id);
    res.json(await getAsync('SELECT * FROM projects WHERE id = $1', [req.params.id]));
  } catch (err) { next(err); }
});

app.delete('/api/projects/:id', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  try {
    const project = await getAsync('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
    await runAsync('DELETE FROM projects WHERE id = $1', [req.params.id]);
    invalidateSystemPromptCache(userId, req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post('/api/projects/:id/chats', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const projectId = req.params.id === 'none' ? null : req.params.id;
  try {
    if (projectId) {
      const project = await getAsync('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId]);
      if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
    }
    const chatId = randomUUID();
    await runAsync('INSERT INTO chats (id, project_id, title) VALUES ($1,$2,$3)', [chatId, projectId, 'Nova conversa']);
    res.status(201).json(await getAsync('SELECT * FROM chats WHERE id = $1', [chatId]));
  } catch (err) { next(err); }
});

app.delete('/api/projects/:id/chats/:chatId', async (req, res, next) => {
  try {
    await runAsync('DELETE FROM chats WHERE id = $1', [req.params.chatId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.patch('/api/chats/:chatId/title', async (req, res, next) => {
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title obrigatório' });
  try {
    const trimmed = title.trim().substring(0, 50);
    await runAsync('UPDATE chats SET title = $1, updated_at = NOW() WHERE id = $2', [trimmed, req.params.chatId]);
    res.json({ ok: true, title: trimmed });
  } catch (err) { next(err); }
});

app.get('/api/messages/chat/:chatId', async (req, res, next) => {
  try {
    const rows = await allAsync('SELECT id, role, content, edited, edit_history, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC', [req.params.chatId]);
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── Endpoint com streaming (SSE) ──────────────────────────────────────
app.post('/api/messages/stream', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const modelKey = resolveModelKey(req);
  const { project_id, chat_id, message } = req.body;
  if (!chat_id || !message) {
    return res.status(400).json({ error: 'chat_id e message obrigatórios' });
  }
  const projectId = (project_id && project_id !== 'none') ? project_id : null;

  // Buscar modo de memória do projeto (se existir)
  let memoryMode = 'projeto'; // padrão
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

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'user', message]);

    let relevantChunks = [];
    if (projectId) {
      relevantChunks = await searchRelevantChunks(projectId, message, 3);
    }

    const history = await allAsync('SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC', [chat_id]);
    const baseSystemPrompt = await getBaseSystemPromptWithCache(userId, projectId, memoryMode);

    let finalSystemPrompt = baseSystemPrompt;
    if (relevantChunks.length > 0) {
      finalSystemPrompt += `\n=== CONTEXTO DOS ARQUIVOS ===\nOs seguintes trechos dos seus documentos podem ser relevantes para a pergunta atual:\n\n`;
      relevantChunks.forEach((chunk, idx) => {
        finalSystemPrompt += `[Trecho ${idx + 1}]\n${chunk}\n\n`;
      });
      finalSystemPrompt += `Utilize essas informações sempre que pertinente. Se não forem úteis, ignore-as.\n`;
    }

    const apiHistory = selectContextWindow(history);
    let fullResponse = '';

    for await (const chunk of streamGeminiChat(apiHistory, finalSystemPrompt, modelKey)) {
      fullResponse += chunk;
      sendEvent({ chunk });
    }

    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'assistant', fullResponse]);
    await runAsync('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chat_id]);

    const isFirst = history.length === 1;
    if (isFirst) autoTitle(chat_id, message).catch(console.error);
    if (projectId || memoryMode === 'global') {
      extractMemories(projectId, userId, fullResponse, memoryMode).catch(console.error);
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

// ─── Endpoint tradicional (fallback) ──────────────────────────────────
app.post('/api/messages', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const modelKey = resolveModelKey(req);
  const { project_id, chat_id, message } = req.body;
  if (!chat_id || !message) return res.status(400).json({ error: 'chat_id e message obrigatórios' });

  const projectId = (project_id && project_id !== 'none') ? project_id : null;

  let memoryMode = 'projeto';
  if (projectId) {
    const proj = await getAsync('SELECT memory_mode FROM projects WHERE id = $1', [projectId]);
    if (proj && proj.memory_mode) memoryMode = proj.memory_mode;
  }

  try {
    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'user', message]);

    let relevantChunks = [];
    if (projectId) {
      relevantChunks = await searchRelevantChunks(projectId, message, 3);
    }

    const history = await allAsync('SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC', [chat_id]);
    const baseSystemPrompt = await getBaseSystemPromptWithCache(userId, projectId, memoryMode);

    let finalSystemPrompt = baseSystemPrompt;
    if (relevantChunks.length > 0) {
      finalSystemPrompt += `\n=== CONTEXTO DOS ARQUIVOS ===\n`;
      relevantChunks.forEach((chunk, idx) => {
        finalSystemPrompt += `[Trecho ${idx + 1}]\n${chunk}\n\n`;
      });
      finalSystemPrompt += `Utilize essas informações sempre que pertinente.\n`;
    }

    const apiHistory = selectContextWindow(history);
    const responseText = await geminiChat(apiHistory, finalSystemPrompt, modelKey);

    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'assistant', responseText]);
    await runAsync('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chat_id]);

    const isFirst = history.length === 1;
    if (isFirst) autoTitle(chat_id, message).catch(console.error);
    if (projectId || memoryMode === 'global') {
      extractMemories(projectId, userId, responseText, memoryMode).catch(console.error);
      invalidateSystemPromptCache(userId, projectId);
    }

    res.json({ response: responseText, model: modelKey });
  } catch (err) { next(err); }
});

// ─── Rotas para fontes externas (links e texto) ───────────────────────
app.get('/api/projects/:projectId/sources', async (req, res, next) => {
  try {
    const rows = await allAsync('SELECT id, type, title, url, content, created_at FROM external_sources WHERE project_id = $1 ORDER BY created_at DESC', [req.params.projectId]);
    res.json(rows);
  } catch (err) { next(err); }
});

app.post('/api/projects/:projectId/sources/url', async (req, res, next) => {
  const { url, title } = req.body;
  if (!url) return res.status(400).json({ error: 'URL é obrigatória' });
  const projectId = req.params.projectId;
  try {
    const fetchRes = await fetch(url, { headers: { 'User-Agent': 'SolarisBot/1.0' } });
    if (!fetchRes.ok) throw new Error(`Erro ao acessar URL: ${fetchRes.status}`);
    let html = await fetchRes.text();
    const text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50000);
    if (!text) throw new Error('Não foi possível extrair texto da URL');

    const sourceId = randomUUID();
    await runAsync(
      'INSERT INTO external_sources (id, project_id, type, title, url, content) VALUES ($1, $2, $3, $4, $5, $6)',
      [sourceId, projectId, 'url', title || url, url, text]
    );
    // Indexar via job queue (processamento assíncrono)
    const jobQueue = getJobQueue();
    await jobQueue.addJob('embedding', { fileId: sourceId, projectId, text }, 1);
    res.status(201).json({ id: sourceId, type: 'url', title: title || url, job_enqueued: true });
  } catch (err) { next(err); }
});

app.post('/api/projects/:projectId/sources/text', async (req, res, next) => {
  const { title, content } = req.body;
  if (!content) return res.status(400).json({ error: 'Conteúdo de texto é obrigatório' });
  const projectId = req.params.projectId;
  try {
    const sourceId = randomUUID();
    const trimmedContent = content.substring(0, 50000);
    await runAsync(
      'INSERT INTO external_sources (id, project_id, type, title, content) VALUES ($1, $2, $3, $4, $5)',
      [sourceId, projectId, 'text', title || 'Texto adicionado', trimmedContent]
    );
    const jobQueue = getJobQueue();
    await jobQueue.addJob('embedding', { fileId: sourceId, projectId, text: trimmedContent }, 1);
    res.status(201).json({ id: sourceId, type: 'text', title: title || 'Texto adicionado', job_enqueued: true });
  } catch (err) { next(err); }
});

app.delete('/api/projects/:projectId/sources/:sourceId', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  try {
    await runAsync('DELETE FROM external_sources WHERE id = $1 AND project_id = $2', [req.params.sourceId, req.params.projectId]);
    await runAsync('DELETE FROM file_chunks WHERE file_id = $1', [req.params.sourceId]);
    if (userId) invalidateSystemPromptCache(userId, req.params.projectId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Rotas para arquivos (com job queue) ───────────────────────────────
app.get('/api/files/:projectId', async (req, res, next) => {
  try {
    const rows = await allAsync('SELECT id, original_name, mime_type, size, created_at FROM files WHERE project_id = $1 ORDER BY created_at DESC', [req.params.projectId]);
    res.json(rows);
  } catch (err) { next(err); }
});

app.post('/api/files/:projectId', upload.single('file'), async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    const textExts = ['.txt', '.md', '.json', '.js', '.ts', '.py', '.css', '.html', '.csv'];
    let extractedText = '';
    if (textExts.includes(ext)) {
      extractedText = fs.readFileSync(req.file.path, 'utf-8').substring(0, 50000);
    } else if (ext === '.pdf') {
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const data = await pdfParse(fs.readFileSync(req.file.path));
        extractedText = data.text.substring(0, 50000);
      } catch {
        extractedText = '[PDF: não foi possível extrair texto]';
      }
    }
    const fileId = randomUUID();
    await runAsync(
      'INSERT INTO files (id, project_id, original_name, mime_type, size, extracted_text, path) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [fileId, req.params.projectId, req.file.originalname, req.file.mimetype, req.file.size, extractedText, req.file.path]
    );
    // Adiciona job de upload (que por sua vez pode criar job de embedding)
    const jobQueue = getJobQueue();
    await jobQueue.addJob('upload', {
      fileId,
      projectId: req.params.projectId,
      filePath: req.file.path,
      extractedText
    }, 0);
    if (userId) invalidateSystemPromptCache(userId, req.params.projectId);
    res.status(201).json({ id: fileId, original_name: req.file.originalname, size: req.file.size, job_enqueued: true });
  } catch (err) { next(err); }
});

app.delete('/api/files/:projectId/:fileId', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  try {
    const file = await getAsync('SELECT * FROM files WHERE id = $1 AND project_id = $2', [req.params.fileId, req.params.projectId]);
    if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    await runAsync('DELETE FROM files WHERE id = $1', [req.params.fileId]);
    if (userId) invalidateSystemPromptCache(userId, req.params.projectId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Endpoint para excluir todos os chats do usuário ───────────────────
app.delete('/api/user/chats', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'x-user-id obrigatório' });
  try {
    // Busca todos os projetos do usuário
    const projects = await allAsync('SELECT id FROM projects WHERE user_id = $1', [userId]);
    const projectIds = projects.map(p => p.id);
    if (projectIds.length === 0) {
      return res.json({ deleted: 0 });
    }
    // Constrói placeholders para IN
    const placeholders = projectIds.map((_, i) => `$${i + 1}`).join(',');
    // Remove mensagens e chats desses projetos
    await runAsync(`DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE project_id IN (${placeholders}))`, projectIds);
    const result = await runAsync(`DELETE FROM chats WHERE project_id IN (${placeholders})`, projectIds);
    res.json({ deleted: result.changes });
  } catch (err) { next(err); }
});

app.post('/api/migrate', async (req, res, next) => {
  const { guest_id, user_id } = req.body;
  if (!guest_id || !user_id || guest_id === user_id) return res.json({ ok: true, migrated: 0 });
  try {
    const result = await runAsync('UPDATE projects SET user_id = $1 WHERE user_id = $2', [user_id, guest_id]);
    res.json({ ok: true, migrated: result.changes });
  } catch (err) { next(err); }
});

app.get('/api/share/:chatId', async (req, res, next) => {
  try {
    const chat = await getAsync('SELECT * FROM chats WHERE id = $1', [req.params.chatId]);
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });
    const messages = await allAsync('SELECT role, content, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC', [req.params.chatId]);
    res.json({ chat, messages });
  } catch (err) { next(err); }
});

app.use(errorHandler);

process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));

async function geminiChat(messages, systemPrompt, modelKey = 'flash') {
  const url = geminiUrl(modelKey, false);
  const body = buildGeminiBody(messages, systemPrompt);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await withRetry(() =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    );
    if (!res.ok) {
      const err = new Error(`Erro na IA: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return data.candidates[0].content.parts[0].text;
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Timeout ao chamar IA');
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

(async () => {
  try {
    await initDb();
    // Inicia a fila de jobs
    const jobQueue = getJobQueue();
    console.log('📋 JobQueue inicializada e rodando');

    app.listen(PORT, '0.0.0.0', () => console.log(`✅ Solaris backend na porta ${PORT}`));
  } catch (err) {
    console.error('❌ Falha ao iniciar:', err);
    process.exit(1);
  }
})();