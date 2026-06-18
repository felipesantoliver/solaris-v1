// utils/jobQueue.js — Fila de jobs assíncrona com BullMQ

import { Queue, Worker } from 'bullmq';
import { randomUUID } from 'crypto';
import { runAsync, allAsync, getAsync } from '../db/database.js';
import { indexFileChunks } from '../domain/ai/embeddings.js';

const REDIS_URL = process.env.REDIS_URL;

let queue = null;
let worker = null;
let isReady = false;

// Handlers de processamento (mesma lógica anterior)
const handlers = {
  upload: processUpload,
  embedding: processEmbedding,
};

async function processUpload(payload) {
  const { fileId, projectId, filePath, extractedText } = payload;
  if (extractedText && extractedText.length > 0) {
    await addJob('embedding', { fileId, projectId, text: extractedText }, 1);
  }
  return { status: 'uploaded', fileId };
}

async function processEmbedding(payload) {
  const { fileId, projectId, text } = payload;
  const db = { runAsync, allAsync, getAsync };
  await indexFileChunks(fileId, text, db);
  return { status: 'embedded', chunks: Math.ceil(text.length / 500) };
}

// Inicializa a fila e o worker se Redis estiver disponível
function initBullMQ() {
  if (!REDIS_URL) {
    console.warn('⚠️ REDIS_URL não definida – fila desabilitada');
    return false;
  }

  try {
    const connection = { url: REDIS_URL, maxRetriesPerRequest: 3 };

    queue = new Queue('solaris-jobs', {
      connection,
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
    });

    worker = new Worker('solaris-jobs', async (job) => {
      const { id, name, data } = job;
      console.log(`🚀 Iniciando job ${id} (${name})`);

      const handler = handlers[name];
      if (!handler) {
        throw new Error(`Tipo de job desconhecido: ${name}`);
      }

      try {
        const result = await handler(data);
        console.log(`✅ Job ${id} (${name}) concluído`);
        return result;
      } catch (err) {
        console.error(`❌ Job ${id} (${name}) falhou:`, err.message);
        throw err; // BullMQ cuidará do retry
      }
    }, {
      connection,
      concurrency: 2,
    });

    worker.on('completed', (job) => {
      console.log(`✅ Job ${job.id} (${job.name}) finalizado com sucesso`);
    });

    worker.on('failed', (job, err) => {
      console.error(`❌ Job ${job.id} (${job.name}) falhou definitivamente:`, err.message);
    });

    worker.on('error', (err) => {
      console.error('⚠️ Worker BullMQ erro:', err.message);
    });

    isReady = true;
    console.log('🚀 BullMQ Worker iniciado');
    return true;
  } catch (err) {
    console.error('❌ Falha ao inicializar BullMQ:', err.message);
    return false;
  }
}

// Função pública para adicionar job
async function addJob(type, payload, priority = 0) {
  if (!isReady || !queue) {
    console.warn('⚠️ Fila desabilitada – job não adicionado:', type);
    return null;
  }

  const jobId = randomUUID();
  await queue.add(type, payload, {
    priority,
    jobId,
    attempts: payload.maxRetries || 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
  console.log(`📦 Job ${jobId} (${type}) adicionado à fila BullMQ`);
  return jobId;
}

// Inicializa a fila (start)
function start() {
  if (!isReady) {
    initBullMQ();
  }
}

// Para o worker (stop)
async function stop() {
  if (worker) {
    await worker.close();
    worker = null;
    isReady = false;
    console.log('🛑 BullMQ Worker parado');
  }
}

// Singleton
let jobQueueInstance = null;

export function getJobQueue() {
  if (!jobQueueInstance) {
    jobQueueInstance = {
      addJob,
      start,
      stop,
    };
    jobQueueInstance.start();
  }
  return jobQueueInstance;
}

// Exporta também para uso direto (compatibilidade)
export { addJob, start, stop };