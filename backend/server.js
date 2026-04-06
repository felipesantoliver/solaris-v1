// ============================================================
//  server.js — Solaris Backend (consolidado)
//
//  Rotas:
//    GET  /api/health
//    GET  /api/projects
//    GET  /api/projects/:id
//    POST /api/projects
//    PATCH /api/projects/:id
//    DELETE /api/projects/:id
//    POST /api/projects/:id/chats
//    DELETE /api/projects/:id/chats/:chatId
//    GET  /api/messages/chat/:chatId
//    POST /api/messages
//    GET  /api/files/:projectId
//    POST /api/files/:projectId
//    DELETE /api/files/:projectId/:fileId
//    GET  /api/share/:chatId
//
//  Variáveis de ambiente:
//    GROQ_API_KEY, DATABASE_URL, FRONTEND_URL, PORT
// ============================================================

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { initDb, runAsync, getAsync, allAsync } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// ─── Groq ─────────────────────────────────────────────────────────────────────

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) throw new Error('❌ GROQ_API_KEY não definida');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

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

async function groqChat(messages, systemPrompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await withRetry(() =>
      fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          max_tokens: 2048,
          temperature: 0.7,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
        }),
        signal: controller.signal,
      })
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Groq ${res.status}: ${err.error?.message || res.statusText}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-user-id', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Upload ───────────────────────────────────────────────────────────────────

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

// ─── IA: system prompt ────────────────────────────────────────────────────────

const STYLE_GUIDE = {
  direto: 'Seja direto, objetivo e conciso. Sem rodeios.',
  técnico: 'Use terminologia técnica precisa. Inclua detalhes de implementação.',
  analítico: 'Analise profundamente, apresente prós e contras.',
  estratégico: 'Foque em planejamento, impacto de longo prazo e visão macro.',
};

const MEMORY_KEYWORDS = [
  'importante', 'lembre-se', 'concluímos', 'aprendemos', 'descobrimos',
  'fato', 'sabemos que', 'definimos', 'decidimos', 'sempre', 'nunca',
  'padrão', 'regra', 'convenção', 'arquitetura', 'estrutura', 'configuração',
];

async function buildSystemPrompt(projectId, memoryMode) {
  const project = await getAsync('SELECT * FROM projects WHERE id = $1', [projectId]);
  if (!project) return 'Você é um assistente de IA útil e preciso.';

  let prompt = `Você é o Solaris, um assistente de IA especializado operando dentro de um projeto específico.\n\n`;
  prompt += `=== CONTEXTO DO PROJETO ===\n`;
  prompt += `Nome: ${project.name}\n`;
  prompt += `Objetivo: ${project.objective || 'Ajudar o usuário em suas tarefas'}\n`;
  prompt += `Estilo: ${STYLE_GUIDE[project.response_style] || STYLE_GUIDE.direto}\n\n`;
  prompt += `Diretrizes: evite respostas genéricas, priorize utilidade prática. Nunca invente informações.\n\n`;

  const memories = memoryMode === 'global'
    ? await allAsync('SELECT content FROM memories ORDER BY created_at DESC LIMIT $1', [8])
    : await allAsync('SELECT content FROM memories WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2', [projectId, 5]);

  if (memories.length > 0) {
    prompt += `=== MEMÓRIAS RECENTES ===\n`;
    memories.forEach((m, i) => { prompt += `[${i + 1}] ${m.content}\n`; });
    prompt += '\n';
  }

  const files = await allAsync('SELECT original_name, extracted_text FROM files WHERE project_id = $1', [projectId]);
  if (files.length > 0) {
    const MAX = 12000;
    prompt += `=== ARQUIVOS DE REFERÊNCIA ===\n`;
    for (const file of files) {
      const snippet = (file.extracted_text || 'Sem texto extraído').substring(0, 2000);
      const block = `\n[${file.original_name}]\n${snippet}${file.extracted_text?.length > 2000 ? '...[truncado]' : ''}\n`;
      if (prompt.length + block.length > MAX) break;
      prompt += block;
    }
  }
  return prompt;
}

async function extractMemories(projectId, response) {
  const candidates = response
    .split(/[.!?]+\s+/)
    .filter(s => s.length > 50 && MEMORY_KEYWORDS.some(k => s.toLowerCase().includes(k)))
    .slice(0, 2);
  for (const content of candidates) {
    await runAsync('INSERT INTO memories (project_id, content, source) VALUES ($1, $2, $3)', [projectId, content.trim(), 'auto']);
  }
}

async function autoTitle(chatId, firstMessage) {
  try {
    const title = await groqChat(
      [{ role: 'user', content: `Gere um título curto (máx 5 palavras) para: "${firstMessage.substring(0, 100)}". Só o título, sem aspas.` }],
      'Você gera títulos curtos e precisos.'
    );
    await runAsync('UPDATE chats SET title = $1 WHERE id = $2', [title.trim().substring(0, 50), chatId]);
  } catch { /* silencioso */ }
}

// ─── ROTAS ────────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Projetos ──────────────────────────────────────────────────────────────────

app.get('/api/projects', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'x-user-id obrigatório' });
  try {
    const rows = await allAsync('SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/projects/:id', async (req, res) => {
  const userId = req.headers['x-user-id'];
  try {
    const project = await getAsync('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
    const chats = await allAsync('SELECT * FROM chats WHERE project_id = $1 ORDER BY updated_at DESC', [req.params.id]);
    res.json({ ...project, chats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/projects', async (req, res) => {
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/projects/:id', async (req, res) => {
  const userId = req.headers['x-user-id'];
  const { name, objective, response_style, memory_mode } = req.body;
  try {
    const project = await getAsync('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
    await runAsync(`
      UPDATE projects SET
        name           = COALESCE($1, name),
        objective      = COALESCE($2, objective),
        response_style = COALESCE($3, response_style),
        memory_mode    = COALESCE($4, memory_mode),
        updated_at     = NOW()
      WHERE id = $5
    `, [name ?? null, objective ?? null, response_style ?? null, memory_mode ?? null, req.params.id]);
    res.json(await getAsync('SELECT * FROM projects WHERE id = $1', [req.params.id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/projects/:id', async (req, res) => {
  const userId = req.headers['x-user-id'];
  try {
    const project = await getAsync('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
    await runAsync('DELETE FROM projects WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Chats ─────────────────────────────────────────────────────────────────────

app.post('/api/projects/:id/chats', async (req, res) => {
  const userId = req.headers['x-user-id'];
  try {
    const project = await getAsync('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
    const chatId = randomUUID();
    await runAsync('INSERT INTO chats (id, project_id, title) VALUES ($1,$2,$3)', [chatId, req.params.id, 'Nova conversa']);
    res.status(201).json(await getAsync('SELECT * FROM chats WHERE id = $1', [chatId]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/projects/:id/chats/:chatId', async (req, res) => {
  try {
    await runAsync('DELETE FROM chats WHERE id = $1 AND project_id = $2', [req.params.chatId, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Mensagens ─────────────────────────────────────────────────────────────────

app.get('/api/messages/chat/:chatId', async (req, res) => {
  try {
    const rows = await allAsync(
      'SELECT role, content, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [req.params.chatId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/messages', async (req, res) => {
  const { project_id, chat_id, message } = req.body;
  if (!project_id || !chat_id || !message)
    return res.status(400).json({ error: 'project_id, chat_id e message são obrigatórios' });

  try {
    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'user', message]);

    const history = await allAsync(
      'SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [chat_id]
    );
    const isFirst = history.length === 1;

    const project = await getAsync('SELECT memory_mode FROM projects WHERE id = $1', [project_id]);
    const sysPrompt = await buildSystemPrompt(project_id, project?.memory_mode);
    const apiHistory = history.slice(-20).map(m => ({ role: m.role, content: m.content }));

    const responseText = await groqChat(apiHistory, sysPrompt);

    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chat_id, 'assistant', responseText]);
    await runAsync('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chat_id]);

    if (isFirst) autoTitle(chat_id, message).catch(console.error);
    extractMemories(project_id, responseText).catch(console.error);

    res.json({ response: responseText });
  } catch (err) {
    console.error('Erro ao enviar mensagem:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Arquivos ──────────────────────────────────────────────────────────────────

app.get('/api/files/:projectId', async (req, res) => {
  try {
    const rows = await allAsync(
      'SELECT id, original_name, mime_type, size, created_at FROM files WHERE project_id = $1 ORDER BY created_at DESC',
      [req.params.projectId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/files/:projectId', upload.single('file'), async (req, res) => {
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
      } catch { extractedText = '[PDF: não foi possível extrair texto]'; }
    }

    const fileId = randomUUID();
    await runAsync(
      'INSERT INTO files (id, project_id, original_name, mime_type, size, extracted_text, path) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [fileId, req.params.projectId, req.file.originalname, req.file.mimetype, req.file.size, extractedText, req.file.path]
    );
    res.status(201).json({ id: fileId, original_name: req.file.originalname, size: req.file.size });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/files/:projectId/:fileId', async (req, res) => {
  try {
    const file = await getAsync('SELECT * FROM files WHERE id = $1 AND project_id = $2', [req.params.fileId, req.params.projectId]);
    if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    await runAsync('DELETE FROM files WHERE id = $1', [req.params.fileId]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Compartilhamento ──────────────────────────────────────────────────────────

app.get('/api/share/:chatId', async (req, res) => {
  try {
    const chat = await getAsync('SELECT * FROM chats WHERE id = $1', [req.params.chatId]);
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });
    const messages = await allAsync(
      'SELECT role, content, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [req.params.chatId]
    );
    res.json({ chat, messages });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Error handler global ─────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('Erro não tratado:', err);
  res.status(err.status || 500).json({ error: err.message || 'Erro interno do servidor' });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await initDb();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Solaris backend rodando na porta ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Falha ao iniciar:', err);
    process.exit(1);
  }
})();