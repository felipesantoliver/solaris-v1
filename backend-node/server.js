// ============================================================
//  server.js — Solaris Backend Bootstrap
//  (ajustado para deploy integrado Vercel + Render)
// ============================================================

import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db/schema.js';
import { errorHandler } from './utils/errorHandler.js';

// Import routers
import projectsRouter from './domain/routers/projects.js';
import chatsRouter from './domain/routers/chats.js';
import messagesRouter from './domain/routers/messages.js';
import filesRouter from './domain/routers/files.js';
import sourcesRouter from './domain/routers/sources.js';
import settingsRouter from './domain/routers/settings.js';
import voiceRouter from './domain/routers/voice.js';
import agentRouter from './domain/routers/agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// ─── CORS ─────────────────────────────────────────────────────────────
// 🔥 Altere a origem para a URL do seu frontend na Vercel
const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
const corsOptions = {
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-user-id', 'x-model', 'Authorization'],
  credentials: true,
};
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// ─── Body parsers ─────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Health check ─────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

// ─── Register routers ─────────────────────────────────────────────────
app.use('/api', projectsRouter);
app.use('/api', chatsRouter);
app.use('/api', messagesRouter);
app.use('/api', filesRouter);
app.use('/api', sourcesRouter);
app.use('/api', settingsRouter);
app.use('/api', voiceRouter);
app.use('/api', agentRouter);

// ─── Error handler (deve ser o último) ────────────────────────────────
app.use(errorHandler);

// ─── Unhandled rejection ──────────────────────────────────────────────
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));

// ─── Bootstrap ────────────────────────────────────────────────────────
(async () => {
  try {
    await initDb();
    app.listen(PORT, '0.0.0.0', () => console.log(`✅ Solaris backend na porta ${PORT}`));
  } catch (err) {
    console.error('❌ Falha ao iniciar:', err);
    process.exit(1);
  }
})();