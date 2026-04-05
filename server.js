import express from 'express';
import cors from 'cors';
import { initDb } from './database.js';
import projectsRouter from './routes/projects.js';
import messagesRouter from './routes/messages.js';
import filesRouter from './routes/files.js';
import shareRouter from './routes/share.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-user-id', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/projects', projectsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/files', filesRouter);
app.use('/api/share', shareRouter);

// Error handler global
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({ error: err.message || 'Erro interno do servidor' });
});

(async () => {
  try {
    await initDb();
    console.log('✅ Banco de dados inicializado');
    app.listen(PORT, () => {
      console.log(`✅ Backend Solaris rodando em http://localhost:${PORT}`);
      console.log(`   API disponível em http://localhost:${PORT}/api`);
    });
  } catch (err) {
    console.error('❌ Falha ao iniciar:', err);
    process.exit(1);
  }
})();
