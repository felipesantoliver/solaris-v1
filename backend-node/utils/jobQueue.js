// utils > JS jobQueue.js

// ---------------------------------------------------------------------------
// Fila de jobs assincrona baseada em BullMQ
// ---------------------------------------------------------------------------

import { Queue, Worker } from 'bullmq';
import { randomUUID } from 'crypto';
import { runAsync, allAsync, getAsync } from '../db/database.js';
import { indexFileChunks } from '../domain/ai/embeddings.js';

// ---------------------------------------------------------------------------
// Configuracao do Redis
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL;

// ---------------------------------------------------------------------------
// Estado interno da fila
// ---------------------------------------------------------------------------

let queue = null;
let worker = null;
let isReady = false;

// ---------------------------------------------------------------------------
// Mapeamento de handlers por tipo de job
// ---------------------------------------------------------------------------

const handlers = {
  upload: processUpload,
  embedding: processEmbedding,
};

// ---------------------------------------------------------------------------
// Handler: processamento de upload
// ---------------------------------------------------------------------------

/**
 * Processa um job de upload. Se houver texto extraido do arquivo,
 * encadeia automaticamente um job de embedding para indexacao.
 */
async function processUpload(payload) {
  const { fileId, projectId, filePath, extractedText } = payload;

  if (extractedText && extractedText.length > 0) {
    await addJob('embedding', { fileId, projectId, text: extractedText }, 1);
  }

  return { status: 'uploaded', fileId };
}

// ---------------------------------------------------------------------------
// Handler: processamento de embedding
// ---------------------------------------------------------------------------

/**
 * Processa um job de embedding. Indexa o texto do arquivo em chunks
 * para busca semantica via vetores.
 */
async function processEmbedding(payload) {
  const { fileId, projectId, text } = payload;
  const db = { runAsync, allAsync, getAsync };

  await indexFileChunks(fileId, text, db);

  return { status: 'embedded', chunks: Math.ceil(text.length / 500) };
}

// ---------------------------------------------------------------------------
// Inicializacao do BullMQ (fila e worker)
// ---------------------------------------------------------------------------

/**
 * Inicializa a conexao com Redis, a fila e o worker.
 * Retorna false se REDIS_URL nao estiver definida ou se a
 * inicializacao falhar, true em caso de sucesso.
 */
function initBullMQ() {
  if (!REDIS_URL) {
    console.warn('REDIS_URL not defined — job queue disabled');
    return false;
  }

  try {
    const connection = { url: REDIS_URL, maxRetriesPerRequest: 3 };

    // -----------------------------------------------------------------------
    // Fila
    // -----------------------------------------------------------------------

    queue = new Queue('solaris-jobs', {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    });

    // -----------------------------------------------------------------------
    // Worker
    // -----------------------------------------------------------------------

    worker = new Worker(
      'solaris-jobs',
      async (job) => {
        const { id, name, data } = job;
        console.log(`Starting job ${id} (${name})`);

        const handler = handlers[name];
        if (!handler) {
          throw new Error(`Unknown job type: ${name}`);
        }

        try {
          const result = await handler(data);
          console.log(`Job ${id} (${name}) completed`);
          return result;
        } catch (err) {
          console.error(`Job ${id} (${name}) failed:`, err.message);
          throw err; // BullMQ gerencia as retentativas
        }
      },
      {
        connection,
        concurrency: 2,
      }
    );

    // -----------------------------------------------------------------------
    // Eventos do worker
    // -----------------------------------------------------------------------

    // O processador acima ja registra conclusao e falha nos logs.
    // O evento abaixo trata apenas falhas permanentes (todas as
    // retentativas esgotadas).
    worker.on('failed', (job, err) => {
      if (job.attemptsMade >= job.opts.attempts) {
        console.error(
          `Job ${job.id} (${job.name}) permanently failed after ${job.attemptsMade} attempts:`,
          err.message
        );
      }
    });

    worker.on('error', (err) => {
      console.error('BullMQ worker error:', err.message);
    });

    isReady = true;
    console.log('BullMQ worker started');
    return true;
  } catch (err) {
    console.error('Failed to initialize BullMQ:', err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// API publica: adicionar job a fila
// ---------------------------------------------------------------------------

/**
 * Adiciona um job a fila, se o sistema estiver pronto.
 *
 * @param {string} type - Tipo do job (chave do mapa handlers).
 * @param {object} payload - Dados do job.
 * @param {number} priority - Prioridade (numeros menores = maior prioridade).
 * @returns {string|null} ID do job enfileirado, ou null se a fila estiver desabilitada.
 */
export async function addJob(type, payload, priority = 0) {
  if (!isReady || !queue) {
    console.warn('Job queue disabled — job not enqueued:', type);
    return null;
  }

  const jobId = randomUUID();
  await queue.add(type, payload, {
    priority,
    jobId,
    attempts: payload.maxRetries || 3,
    backoff: { type: 'exponential', delay: 5000 },
  });

  console.log(`Job ${jobId} (${type}) enqueued`);
  return jobId;
}

// ---------------------------------------------------------------------------
// API publica: iniciar o sistema de filas
// ---------------------------------------------------------------------------

/**
 * Inicia o worker e a fila, se ainda nao estiverem rodando.
 * Seguro chamar multiplas vezes (idempotente).
 */
export function start() {
  if (!isReady) {
    initBullMQ();
  }
}

// ---------------------------------------------------------------------------
// API publica: parar o sistema de filas
// ---------------------------------------------------------------------------

/**
 * Encerra graciosamente o worker e libera recursos.
 */
export async function stop() {
  if (worker) {
    await worker.close();
    worker = null;
    isReady = false;
    console.log('BullMQ worker stopped');
  }
}

// ---------------------------------------------------------------------------
// Singleton: instancia unica do gerenciador de filas
// ---------------------------------------------------------------------------

let jobQueueInstance = null;

/**
 * Obtem a instancia singleton do gerenciador de filas.
 * Na primeira chamada, inicializa automaticamente o worker.
 *
 * @returns {object} Objeto com os metodos addJob, start e stop.
 */
export function getJobQueue() {
  if (!jobQueueInstance) {
    jobQueueInstance = { addJob, start, stop };
    jobQueueInstance.start();
  }
  return jobQueueInstance;
}