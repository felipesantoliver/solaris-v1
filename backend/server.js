// ============================================================
//  server.js — Solaris Backend Bootstrap
//  (apenas configuração de middlewares, rotas e listen)
// ============================================================

import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db/schema.js';
import { errorHandler } from './utils/errorHandler.js';
import { getJobQueue } from './utils/jobQueue.js';

// Import routers
import projectsRouter from './domain/routers/projects.js';
import chatsRouter from './domain/routers/chats.js';
import messagesRouter from './domain/routers/messages.js';
import filesRouter from './domain/routers/files.js';
import sourcesRouter from './domain/routers/sources.js';
import settingsRouter from './domain/routers/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// ─── CORS ─────────────────────────────────────────────────────────────
const corsOptions = {
  origin: process.env.FRONTEND_URL || false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-user-id', 'x-model', 'Authorization'],
  credentials: true,
};
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// ─── Body parsers ─────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Static files ─────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Health check ─────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

// ─── Register routers ─────────────────────────────────────────────────
app.use('/api', projectsRouter);
app.use('/api', chatsRouter);
app.use('/api', messagesRouter);
app.use('/api', filesRouter);
app.use('/api', sourcesRouter);
app.use('/api', settingsRouter);

// ─── Error handler (deve ser o último) ────────────────────────────────
app.use(errorHandler);

// ─── Unhandled rejection ──────────────────────────────────────────────
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));

// ─── Bootstrap ────────────────────────────────────────────────────────
(async () => {
  try {
    await initDb();
    const jobQueue = getJobQueue();
    console.log('📋 JobQueue inicializada e rodando');
    app.listen(PORT, '0.0.0.0', () => console.log(`✅ Solaris backend na porta ${PORT}`));
  } catch (err) {
    console.error('❌ Falha ao iniciar:', err);
    process.exit(1);
  }
})();