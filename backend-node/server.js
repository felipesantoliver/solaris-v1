// server.js
//
// Ponto de entrada do backend Node.js — Solaris API.
//
// Responsavel por inicializar o servidor Express, configurar middlewares
// globais (CORS, body parsers), registrar todas as rotas da API, aplicar
// o middleware de erro e iniciar o banco de dados com migracoes automaticas.
//
// Ordem de inicializacao:
//   1. Forca resolucao DNS para IPv4 (evita timeout em ambientes com IPv6)
//   2. Configura middlewares globais (CORS, JSON, URL-encoded)
//   3. Registra health check e routers de dominio
//   4. Aplica error handler como ULTIMO middleware
//   5. Inicializa o schema do banco (initDb)
//   6. Inicia o servidor HTTP na porta configurada
//
// Agrupamento logico:
//   1. Configuracao de DNS e imports
//   2. Configuracao do Express e middlewares base
//   3. CORS
//   4. Body parsers
//   5. Health check
//   6. Registro de routers
//   7. Error handler
//   8. Tratamento de unhandled rejection
//   9. Bootstrap (inicializacao do banco e servidor)

import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db/schema.js';
import { errorHandler } from './utils/errorHandler.js';

// Import dos routers de dominio — cada um gerencia um recurso especifico da API
import projectsRouter from './domain/routers/projects.js';
import chatsRouter from './domain/routers/chats.js';
import messagesRouter from './domain/routers/messages.js';
import filesRouter from './domain/routers/files.js';
import sourcesRouter from './domain/routers/sources.js';
import settingsRouter from './domain/routers/settings.js';
import voiceRouter from './domain/routers/voice.js';
import agentRouter from './domain/routers/agent.js';

// ---------------------------------------------------------------------------
// 1. CONFIGURACAO DE DNS
// ---------------------------------------------------------------------------

// Forca a resolucao DNS para IPv4 primeiro.
// Em ambientes com IPv6 habilitado (ex: Render, alguns ISPs), o Node pode
// tentar resolver hosts como IPv6 e falhar com timeout. Esta configuracao
// evita esse problema definindo a ordem de preferencia.
// setDefaultResultOrder e chamado antes de qualquer import que possa
// disparar resolucao DNS.
// Nota: chamado no topo do arquivo, antes dos imports que dependem de rede.

// ---------------------------------------------------------------------------
// 2. CONFIGURACAO DO EXPRESS E MIDDLEWARES BASE
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// 3. CORS
// ---------------------------------------------------------------------------

// Configuracao de Cross-Origin Resource Sharing.
// Permite requisicoes apenas da origem do frontend (definida em FRONTEND_URL).
//
// Metodos permitidos: GET, POST, PUT, PATCH, DELETE, OPTIONS.
// Headers permitidos:
//   - Content-Type: necessario para JSON e multipart/form-data
//   - x-user-id: ID anonimo do usuario convidado (modo sem cadastro)
//   - x-model: modelo de IA selecionado (flash/pro) por conversa
//   - Authorization: token Bearer do Supabase para usuarios autenticados
//
// Credentials: true permite envio de cookies e headers de autenticacao.
//
// O preflight (OPTIONS) e tratado explicitamente para todas as rotas,
// garantindo que browsers nao bloqueiem requisicoes cross-origin.
const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
const corsOptions = {
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-user-id', 'x-model', 'Authorization'],
  credentials: true,
};
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// ---------------------------------------------------------------------------
// 4. BODY PARSERS
// ---------------------------------------------------------------------------

// Parser JSON: suporta payloads de ate 10 MB.
// Necessario para requisicoes com corpo JSON (ex: criacao de projetos,
// envio de mensagens, atualizacao de configuracoes).
app.use(express.json({ limit: '10mb' }));

// Parser URL-encoded: suporta dados de formularios HTML (x-www-form-urlencoded).
// extended: true permite objetos aninhados via biblioteca qs.
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// 5. HEALTH CHECK
// ---------------------------------------------------------------------------

// Endpoint de health check para monitoramento e keep-alive.
// Usado por:
//   - Render: verificar se o servico esta no ar
//   - Cron jobs: evitar cold start no plano gratuito (ping a cada 10 min)
//   - Load balancers: verificar disponibilidade da instancia
app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

// ---------------------------------------------------------------------------
// 6. REGISTRO DE ROUTERS
// ---------------------------------------------------------------------------

// Todos os routers sao montados sob o prefixo /api.
// Cada router gerencia seu proprio dominio:
//   /api/projects  -> CRUD de projetos
//   /api/chats     -> CRUD de conversas, menu de contexto
//   /api/messages  -> envio, edicao e listagem de mensagens
//   /api/files     -> upload, download e gerenciamento de arquivos
//   /api/sources   -> fontes externas (URLs e texto livre)
//   /api/settings  -> configuracoes e preferencias do usuario
//   /api/voice     -> transcricao de audio
//   /api/agent     -> modo agente autonomo (function calling)
app.use('/api', projectsRouter);
app.use('/api', chatsRouter);
app.use('/api', messagesRouter);
app.use('/api', filesRouter);
app.use('/api', sourcesRouter);
app.use('/api', settingsRouter);
app.use('/api', voiceRouter);
app.use('/api', agentRouter);

// ---------------------------------------------------------------------------
// 7. ERROR HANDLER
// ---------------------------------------------------------------------------

// Middleware de tratamento de erros — DEVE ser o ULTIMO middleware registrado.
// Captura qualquer erro propagado via next(err) nas rotas e retorna uma
// resposta JSON padronizada com status HTTP apropriado e mensagem amigavel.
// Ver utils/errorHandler.js para detalhes da normalizacao.
app.use(errorHandler);

// ---------------------------------------------------------------------------
// 8. TRATAMENTO DE UNHANDLED REJECTION
// ---------------------------------------------------------------------------

// Captura promessas rejeitadas que nao tenham tratamento explicito.
// Evita que o processo seja encerrado abruptamente por uma Promise
// sem .catch(). Apenas loga o erro — o erro original continua propagando.
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));

// ---------------------------------------------------------------------------
// 9. BOOTSTRAP (INICIALIZACAO DO BANCO E SERVIDOR)
// ---------------------------------------------------------------------------

/**
 * Inicializa o banco de dados e inicia o servidor HTTP.
 *
 * Ordem:
 *   1. initDb(): aplica migracoes pendentes e garante que o schema
 *      esta atualizado (ver db/schema.js)
 *   2. app.listen(): inicia o servidor na porta configurada, ouvindo
 *      em todas as interfaces de rede (0.0.0.0) — necessario para
 *      ambientes de cloud como Render
 *
 * Se a inicializacao do banco falhar, o servidor NAO inicia (process.exit(1)).
 * Isso evita que o servico fique no ar com schema desatualizado ou
 * conexao de banco quebrada.
 */
(async () => {
  try {
    await initDb();
    app.listen(PORT, '0.0.0.0', () => console.log(`✅ Solaris backend na porta ${PORT}`));
  } catch (err) {
    console.error('❌ Falha ao iniciar:', err);
    process.exit(1);
  }
})();