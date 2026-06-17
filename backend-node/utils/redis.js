// backend-node/utils/redis.js
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;

let client = null;
let isReady = false;

if (REDIS_URL) {
  client = new Redis(REDIS_URL, {
    lazyConnect: true,        // não conecta automaticamente
    retryStrategy: (times) => {
      // reconecta a cada 3 segundos, até 10 tentativas, depois para
      if (times > 10) return null;
      return Math.min(times * 1000, 3000);
    },
    maxRetriesPerRequest: 1,   // não tenta novamente em cada comando
  });

  client.on('connect', () => {
    console.log('🔴 Redis conectado');
    isReady = true;
  });

  client.on('error', (err) => {
    console.error('⚠️ Redis erro:', err.message);
    isReady = false;
  });

  client.on('close', () => {
    console.warn('⚠️ Redis conexão fechada');
    isReady = false;
  });

  // Conecta explicitamente
  client.connect().catch(err => {
    console.error('⚠️ Redis falha na conexão inicial:', err.message);
    isReady = false;
  });
} else {
  console.warn('⚠️ REDIS_URL não definida – Redis desabilitado');
}

/**
 * Retorna o cliente Redis (pode ser null) e um booleano indicando se está pronto.
 */
export function getRedisClient() {
  return { client, isReady };
}

/**
 * Função helper para executar comandos Redis com segurança.
 * Se o Redis não estiver pronto, executa um fallback (opcional).
 * @param {Function} fn - função assíncrona que recebe o cliente Redis
 * @param {Function} fallback - função a ser executada se Redis estiver indisponível
 * @returns {Promise<any>}
 */
export async function withRedis(fn, fallback = null) {
  if (isReady && client) {
    try {
      return await fn(client);
    } catch (err) {
      console.error('❌ Redis command error:', err.message);
      return fallback !== null ? await fallback() : null;
    }
  }
  return fallback !== null ? await fallback() : null;
}