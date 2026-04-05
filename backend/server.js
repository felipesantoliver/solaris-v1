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

// A porta é definida automaticamente pelo Render.com através da variável process.env.PORT
const PORT = process.env.PORT || 3001;

// Configuração CORS otimizada para a nuvem
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-user-id', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check para o Render saber que o servidor está vivo
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/projects', projectsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/files', filesRouter);
app.use('/api/share', shareRouter);

// Captura erros de rotas assíncronas que não chamaram next(err) explicitamente
// (Express 4 não faz isso automaticamente — Express 5 sim)
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

// Error handler global — deve ter 4 parâmetros para o Express reconhecê-lo
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('Erro não tratado:', err);
  res.status(err.status || 500).json({ error: err.message || 'Erro interno do servidor' });
});

(async () => {
  try {
    await initDb();
    console.log('✅ Base de dados inicializada');

    // Ouve em '0.0.0.0' para ser acessível externamente pelos balanceadores do Render
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Backend Solaris a correr online na porta ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Falha ao iniciar:', err);
    process.exit(1);
  }
})();