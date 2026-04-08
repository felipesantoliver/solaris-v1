import { randomUUID } from 'crypto';
import { runAsync, getAsync, allAsync } from './database.js';
import { generateEmbedding, indexFileChunks } from './server.js'; // exportar essas funções

class JobQueue {
    constructor(options = {}) {
        this.concurrency = options.concurrency || 2;
        this.pollInterval = options.pollInterval || 3000;
        this.running = 0;
        this.intervalId = null;
        this.handlers = {
            upload: this.processUpload.bind(this),
            embedding: this.processEmbedding.bind(this),
        };
    }

    start() {
        if (this.intervalId) return;
        this.intervalId = setInterval(() => this.poll(), this.pollInterval);
        console.log(`🚀 JobQueue iniciada (concorrência=${this.concurrency})`);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    async poll() {
        while (this.running < this.concurrency) {
            const job = await this.getNextPendingJob();
            if (!job) break;
            this.running++;
            this.processJob(job).finally(() => this.running--);
        }
    }

    async getNextPendingJob() {
        const rows = await allAsync(
            `SELECT * FROM jobs
       WHERE status = 'pending'
       ORDER BY priority DESC, created_at ASC
       LIMIT 1`
        );
        return rows[0] || null;
    }

    async processJob(job) {
        const handler = this.handlers[job.type];
        if (!handler) {
            await this.markFailed(job.id, `Tipo de job desconhecido: ${job.type}`);
            return;
        }
        await this.markProcessing(job.id);
        try {
            const result = await handler(job.payload);
            await this.markCompleted(job.id, result);
            console.log(`✅ Job ${job.id} (${job.type}) concluído`);
        } catch (err) {
            console.error(`❌ Job ${job.id} falhou:`, err);
            const retry = job.retry_count + 1;
            if (retry <= job.max_retries) {
                await runAsync(
                    `UPDATE jobs SET status = 'pending', retry_count = $1, updated_at = NOW() WHERE id = $2`,
                    [retry, job.id]
                );
                console.log(`🔄 Job ${job.id} reagendado (tentativa ${retry}/${job.max_retries})`);
            } else {
                await this.markFailed(job.id, err.message);
            }
        }
    }

    async addJob(type, payload, priority = 0) {
        const id = randomUUID();
        await runAsync(
            `INSERT INTO jobs (id, type, payload, priority, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
            [id, type, JSON.stringify(payload), priority]
        );
        console.log(`📦 Job ${id} (${type}) adicionado à fila`);
        return id;
    }

    async markProcessing(id) {
        await runAsync(`UPDATE jobs SET status = 'processing', updated_at = NOW() WHERE id = $1`, [id]);
    }

    async markCompleted(id, result) {
        await runAsync(
            `UPDATE jobs SET status = 'completed', result = $1, updated_at = NOW() WHERE id = $2`,
            [JSON.stringify(result), id]
        );
    }

    async markFailed(id, error) {
        await runAsync(
            `UPDATE jobs SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`,
            [error, id]
        );
    }

    // Handlers específicos
    async processUpload(payload) {
        const { fileId, projectId, filePath, extractedText } = payload;
        // Se já extraiu texto, cria job de embedding
        if (extractedText && extractedText.length > 0) {
            await this.addJob('embedding', { fileId, projectId, text: extractedText }, 1);
        }
        return { status: 'uploaded', fileId };
    }

    async processEmbedding(payload) {
        const { fileId, projectId, text } = payload;
        await indexFileChunks(fileId, text);
        return { status: 'embedded', chunks: Math.ceil(text.length / 500) };
    }
}

// Singleton
let jobQueueInstance = null;
export function getJobQueue() {
    if (!jobQueueInstance) {
        jobQueueInstance = new JobQueue();
        jobQueueInstance.start();
    }
    return jobQueueInstance;
}