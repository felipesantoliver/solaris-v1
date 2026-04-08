// ============================================================
//  server.js — Solaris Backend 
//  Agora com busca semântica por chunks de arquivos (embedding)
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// ─── Cache do System Prompt (apenas parte estática) ──────────────────────────
const SYSTEM_PROMPT_CACHE_TTL = 60000;
const systemPromptCache = new Map();

function getCacheKey(userId, projectId) {
  return `${userId}:${projectId || 'none'}`;
}

function getCachedSystemPrompt(userId, projectId) {
  const key = getCacheKey(userId, projectId);
  const entry = systemPromptCache.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    console.log(`💾 Cache hit para ${key}`);
    return entry.data;
  }
  if (entry) systemPromptCache.delete(key);
  return null;
}

function setCachedSystemPrompt(userId, projectId, data) {
  const key = getCacheKey(userId, projectId);
  systemPromptCache.set(key, {
    data,
    expiresAt: Date.now() + SYSTEM_PROMPT_CACHE_TTL,
  });
  console.log(`💾 Cache set para ${key}`);
}

function invalidateSystemPromptCache(userId, projectId) {
  const key = getCacheKey(userId, projectId);
  systemPromptCache.delete(key);
  console.log(`🗑️ Cache invalidado para ${key}`);
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

// ─── Gemini (Chat + Embedding) ───────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error('❌ GEMINI_API_KEY não definida');

const MODELS = {
  flash: 'gemini-2.5-flash',
  pro: 'gemini-3-flash-preview',
};

function geminiUrl(modelKey) {
  const model = MODELS[modelKey] || MODELS.flash;
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
}

function geminiEmbeddingUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${GEMINI_API_KEY}`;
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

async function geminiChat(messages, systemPrompt, modelKey = 'flash') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await withRetry(() =>
      fetch(geminiUrl(modelKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGeminiBody(messages, systemPrompt)),
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

async function generateEmbedding(text) {
  const response = await fetch(geminiEmbeddingUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'models/embedding-001', content: { parts: [{ text }] } }),
  });
  if (!response.ok) {
    throw new Error(`Erro ao gerar embedding: ${response.status}`);
  }
  const data = await response.json();
  return data.embedding.values; // array de floats
}

// ─── Chunking e busca semântica ──────────────────────────────────────────────
function splitTextIntoChunks(text, chunkSize = 500, overlap = 100) {
  if (!text || text.length === 0) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + chunkSize;
    if (end > text.length) end = text.length;
    let chunk = text.slice(start, end);
    // tenta quebrar em final de frase
    const lastPeriod = chunk.lastIndexOf('.');
    if (lastPeriod > chunkSize * 0.7 && end < text.length) {
      chunk = text.slice(start, start + lastPeriod + 1);
      end = start + lastPeriod + 1;
    }
    chunks.push(chunk.trim());
    start = end - overlap;
    if (start < 0) start = 0;
    if (start >= text.length) break;
  }
  return chunks;
}

async function indexFileChunks(fileId, text) {
  const chunks = splitTextIntoChunks(text);
  if (chunks.length === 0) return;
  // Remove chunks antigos
  await runAsync('DELETE FROM file_chunks WHERE file_id = $1', [fileId]);
  for (let i = 0; i < chunks.length; i++) {
    try {
      const embedding = await generateEmbedding(chunks[i]);
      await runAsync(
        'INSERT INTO file_chunks (file_id, chunk_index, chunk_text, embedding) VALUES ($1, $2, $3, $4)',
        [fileId, i, chunks[i], JSON.stringify(embedding)]
      );
    } catch (err) {
      console.error(`Erro ao indexar chunk ${i}:`, err.message);
    }
  }
  console.log(`✅ Indexados ${chunks.length} chunks para arquivo ${fileId}`);
}

// Cálculo de similaridade de cosseno entre dois vetores
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function searchRelevantChunks(projectId, query, limit = 3) {
  if (!projectId) return [];
  // Gera embedding da consulta
  let queryEmbedding;
  try {
    queryEmbedding = await generateEmbedding(query);
  } catch (err) {
    console.error('Erro ao gerar embedding da query:', err.message);
    return [];
  }
  // Busca todos os chunks dos arquivos do projeto
  const chunks = await allAsync(
    `SELECT fc.chunk_text, fc.embedding 
     FROM file_chunks fc
     JOIN files f ON f.id = fc.file_id
     WHERE f.project_id = $1`,
    [projectId]
  );
  if (!chunks.length) return [];
  // Calcula similaridade
  const withScores = chunks.map(c => ({
    text: c.chunk_text,
    score: cosineSimilarity(queryEmbedding, JSON.parse(c.embedding)),
  }));
  withScores.sort((a, b) => b.score - a.score);
  return withScores.slice(0, limit).map(c => c.text);
}

// ─── Otimização de contexto (histórico) ──────────────────────────────────────
const MAX_CONTEXT_MESSAGES = 8;

function selectContextWindow(history) {
  if (!Array.isArray(history) || history.length === 0) return [];
  const valid = history.filter(m =>
    m && typeof m.role === 'string' && typeof m.content === 'string' && m.content.trim().length > 0
  );
  if (valid.length === 0) return [];
  const deduped = valid.filter((m, i) => {
    if (i === 0) return true;
    const prev = valid[i - 1];
    return !(prev.role === m.role && prev.content.trim() === m.content.trim());
  });
  if (deduped.length <= MAX_CONTEXT_MESSAGES) {
    console.log(`📦 Context window: ${deduped.length} msgs`);
    return deduped;
  }
  const lastUserIdx = [...deduped].map((m, i) => ({ m, i })).filter(x => x.m.role === 'user').at(-1)?.i ?? -1;
  const lastModelIdx = [...deduped].map((m, i) => ({ m, i })).filter(x => x.m.role === 'assistant').at(-1)?.i ?? -1;
  const anchorIndices = new Set();
  if (lastUserIdx >= 0) anchorIndices.add(lastUserIdx);
  if (lastModelIdx >= 0) anchorIndices.add(lastModelIdx);
  const windowStart = Math.max(0, deduped.length - MAX_CONTEXT_MESSAGES);
  const windowIndices = new Set();
  for (let i = windowStart; i < deduped.length; i++) windowIndices.add(i);
  for (const idx of anchorIndices) windowIndices.add(idx);
  const selected = [...windowIndices].sort((a, b) => a - b).map(i => ({
    role: deduped[i].role,
    content: deduped[i].content
  }));
  console.log(`📦 Context window: ${selected.length}/${deduped.length} msgs`);
  return selected;
}

// ─── CORS ────────────────────────────────────────────────────────────────────
const corsOptions = {
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-user-id', 'x-model', 'Authorization'],
  credentials: true,
};
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Upload ──────────────────────────────────────────────────────────────────
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
function resolveModelKey(req) {
  const requested = req.headers['x-model'];
  const userId = req.headers['x-user-id'];
  if (requested === 'pro' && userId) return 'pro';
  return 'flash';
}

// ─── Montagem do System Prompt (parte estática, sem arquivos) ─────────────────
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

function assembleBaseSystemPrompt({ settings, project, memories }) {
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
  if (project.objective) prompt += `Objetivo: ${project.objective}\n`;
  prompt += `\n=== ESTILO ===\n${personalityText}\n`;
  if (customTraits) prompt += `Traços adicionais: ${customTraits}\n`;
  prompt += `\nEvite respostas genéricas. Nunca invente informações.\n\n`;
  prompt += BASE_IDENTITY_INSTRUCTION;

  if (memories && memories.length > 0) {
    prompt += `=== MEMÓRIAS ===\n`;
    memories.forEach((m, i) => { prompt += `[${i + 1}] ${m.content}\n`; });
    prompt += '\n';
  }
  return prompt;
}

// Busca a parte estática do system prompt com cache
async function getBaseSystemPromptWithCache(userId, projectId) {
  if (!userId) {
    const [settings, project, memories] = await Promise.all([
      null,
      projectId ? getAsync('SELECT * FROM projects WHERE id = $1', [projectId]) : Promise.resolve(null),
      projectId ? allAsync('SELECT content FROM memories WHERE project_id = $1 ORDER BY created_at DESC LIMIT 5', [projectId]) : Promise.resolve([]),
    ]);
    return assembleBaseSystemPrompt({ settings, project, memories });
  }

  const cached = getCachedSystemPrompt(userId, projectId);
  if (cached) return cached;

  const [settings, project, memories] = await Promise.all([
    getAsync('SELECT personality, custom_traits FROM user_settings WHERE user_id = $1', [userId]),
    projectId ? getAsync('SELECT * FROM projects WHERE id = $1', [projectId]) : Promise.resolve(null),
    projectId ? allAsync('SELECT content FROM memories WHERE project_id = $1 ORDER BY created_at DESC LIMIT 5', [projectId]) : Promise.resolve([]),
  ]);
  const systemPrompt = assembleBaseSystemPrompt({ settings, project, memories });
  setCachedSystemPrompt(userId, projectId, systemPrompt);
  return systemPrompt;
}

// ─── Memórias automáticas ────────────────────────────────────────────────────
const MEMORY_KEYWORDS = [
  'importante', 'lembre-se', 'concluímos', 'aprendemos', 'descobrimos',
  'fato', 'sabemos que', 'definimos', 'decidimos', 'sempre', 'nunca',
  'padrão', 'regra', 'convenção', 'arquitetura', 'estrutura', 'configuração',
];

async function extractMemories(projectId, response) {
  if (!projectId) return;
  const candidates = response
    .split(/[.!?]+\s+/)
    .filter(s => s.length > 50 && MEMORY_KEYWORDS.some(k => s.toLowerCase().includes(k)))
    .slice(0, 2);
  if (candidates.length) {
    await Promise.all(
      candidates.map(content =>
        runAsync('INSERT INTO memories (project_id, content, source) VALUES ($1, $2, $3)', [projectId, content.trim(), 'auto'])
          .catch(() => { })
      )
    );
  }
  await runAsync(
    `DELETE FROM memories WHERE project_id = $1 AND id NOT IN (SELECT id FROM memories WHERE project_id = $1 ORDER BY created_at DESC LIMIT 20)`,
    [projectId]
  ).catch(() => { });
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

// ─── ROTAS ───────────────────────────────────────────────────────────────────
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
    await runAsync(`
      INSERT INTO user_settings (user_id, personality, custom_traits, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id) DO UPDATE SET personality = $2, custom_traits = $3, updated_at = NOW()
    `, [userId, personality, custom_traits]);
    for (const key of systemPromptCache.keys()) {
      if (key.startsWith(`${userId}:`)) systemPromptCache.delete(key);
    }
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
  const { name, objective, response_style = 'direto', memory_mode = 'isolado' } = req.body;
  if (!name) return res.status(400).json({ error: 'name obrigatório' });
  try {
    const id = randomUUID();
    await runAsync(
      'INSERT INTO projects (id, user_id, name, objective, response_style, memory_mode) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, userId, name, objective || null, response_style, memory_mode]
    );
    res.status(201).json(await getAsync('SELECT * FROM projects WHERE id = $1', [id]));
  } catch (err) { next(err); }
});

app.patch('/api/projects/:id', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const { name, objective, response_style, memory_mode } = req.body;
  try {
    const project = await getAsync('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
    await runAsync(`
      UPDATE projects SET name=COALESCE($1,name), objective=COALESCE($2,objective),
        response_style=COALESCE($3,response_style), memory_mode=COALESCE($4,memory_mode), updated_at=NOW()
      WHERE id=$5
    `, [name ?? null, objective ?? null, response_style ?? null, memory_mode ?? null, req.params.id]);
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
    const rows = await allAsync(
      'SELECT id, role, content, edited, edit_history, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [req.params.chatId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

app.post('/api/messages', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const modelKey = resolveModelKey(req);
  const { project_id, chat_id, message } = req.body;
  if (!chat_id || !message) return res.status(400).json({ error: 'chat_id e message obrigatórios' });

  const projectId = (project_id && project_id !== 'none') ? project_id : null;

  try {
    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'user', message]);

    // Busca chunks relevantes (apenas se houver projeto)
    let relevantChunks = [];
    if (projectId) {
      relevantChunks = await searchRelevantChunks(projectId, message, 3);
    }

    const history = await allAsync('SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC', [chat_id]);
    const baseSystemPrompt = await getBaseSystemPromptWithCache(userId, projectId);

    // Monta prompt final com contexto dos arquivos
    let finalSystemPrompt = baseSystemPrompt;
    if (relevantChunks.length > 0) {
      finalSystemPrompt += `\n=== CONTEXTO DOS ARQUIVOS ===\nOs seguintes trechos dos seus documentos podem ser relevantes para a pergunta atual:\n\n`;
      relevantChunks.forEach((chunk, idx) => {
        finalSystemPrompt += `[Trecho ${idx + 1}]\n${chunk}\n\n`;
      });
      finalSystemPrompt += `Utilize essas informações sempre que pertinente. Se não forem úteis, ignore-as.\n`;
    }

    const apiHistory = selectContextWindow(history);
    const responseText = await geminiChat(apiHistory, finalSystemPrompt, modelKey);

    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'assistant', responseText]);
    await runAsync('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chat_id]);

    const isFirst = history.length === 1;
    if (isFirst) autoTitle(chat_id, message).catch(console.error);
    if (projectId) {
      extractMemories(projectId, responseText).catch(console.error);
      invalidateSystemPromptCache(userId, projectId);
    }

    res.json({ response: responseText, model: modelKey });
  } catch (err) { next(err); }
});

app.post('/api/messages/edit', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const modelKey = resolveModelKey(req);
  const { chat_id, project_id, message_index, new_content, original_content } = req.body;
  if (!chat_id || !new_content || message_index === undefined)
    return res.status(400).json({ error: 'chat_id, new_content e message_index obrigatórios' });

  const projectId = (project_id && project_id !== 'none') ? project_id : null;

  try {
    const allMessages = await allAsync(
      'SELECT id, role, content, edit_history FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [chat_id]
    );
    if (message_index >= allMessages.length) return res.status(400).json({ error: 'Índice inválido' });

    const targetMsg = allMessages[message_index];
    if (targetMsg.role !== 'user') return res.status(400).json({ error: 'Só é possível editar mensagens do usuário' });

    const editHistory = Array.isArray(targetMsg.edit_history) ? targetMsg.edit_history : [];
    editHistory.push({ content: original_content || targetMsg.content, edited_at: new Date().toISOString() });

    await runAsync(
      'UPDATE messages SET content=$1, edited=TRUE, edit_history=$2, updated_at=NOW() WHERE id=$3',
      [new_content, JSON.stringify(editHistory), targetMsg.id]
    );

    const idsToDelete = allMessages.slice(message_index + 1).map(m => m.id);
    if (idsToDelete.length) {
      await runAsync(`DELETE FROM messages WHERE id = ANY($1::int[])`, [idsToDelete]);
    }

    const cleanHistory = allMessages.slice(0, message_index + 1).map(m => ({
      role: m.role,
      content: m.id === targetMsg.id ? new_content : m.content,
    }));

    // Busca chunks relevantes para a nova pergunta editada
    let relevantChunks = [];
    if (projectId) {
      relevantChunks = await searchRelevantChunks(projectId, new_content, 3);
    }

    const baseSystemPrompt = await getBaseSystemPromptWithCache(userId, projectId);
    let finalSystemPrompt = baseSystemPrompt;
    if (relevantChunks.length) {
      finalSystemPrompt += `\n=== CONTEXTO DOS ARQUIVOS ===\n`;
      relevantChunks.forEach((chunk, idx) => {
        finalSystemPrompt += `[Trecho ${idx + 1}]\n${chunk}\n\n`;
      });
      finalSystemPrompt += `Utilize essas informações sempre que pertinente.\n`;
    }

    const apiHistory = selectContextWindow(cleanHistory);
    const responseText = await geminiChat(apiHistory, finalSystemPrompt, modelKey);

    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'assistant', responseText]);
    await runAsync('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chat_id]);

    if (projectId) {
      extractMemories(projectId, responseText).catch(console.error);
      invalidateSystemPromptCache(userId, projectId);
    }

    res.json({ response: responseText, model: modelKey });
  } catch (err) { next(err); }
});

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
    // Indexa os chunks do arquivo
    if (extractedText && extractedText.length > 0) {
      await indexFileChunks(fileId, extractedText);
    }
    if (userId) invalidateSystemPromptCache(userId, req.params.projectId);
    res.status(201).json({ id: fileId, original_name: req.file.originalname, size: req.file.size });
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

(async () => {
  try {
    await initDb();
    app.listen(PORT, '0.0.0.0', () => console.log(`✅ Solaris backend na porta ${PORT}`));
  } catch (err) {
    console.error('❌ Falha ao iniciar:', err);
    process.exit(1);
  }
})();