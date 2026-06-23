// backend-node > utils > JS redis.js

// ---------------------------------------------------------------------------
// Dependencias
// ---------------------------------------------------------------------------

import Redis from 'ioredis';

// ---------------------------------------------------------------------------
// Configuracao do Redis
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL;

// ---------------------------------------------------------------------------
// Estado interno do cliente
// ---------------------------------------------------------------------------

let client = null;
let isReady = false;

// ---------------------------------------------------------------------------
// Inicializacao do cliente Redis (conexao sob demanda)
// ---------------------------------------------------------------------------

if (REDIS_URL) {
  client = new Redis(REDIS_URL, {
    lazyConnect: true,
    retryStrategy: (times) => {
      // Abandona apos 10 tentativas de reconexao
      if (times > 10) return null;
      // Backoff linear com teto de 3 segundos
      return Math.min(times * 1000, 3000);
    },
    maxRetriesPerRequest: 1,
  });

  // ---------------------------------------------------------------------------
  // Eventos do ciclo de vida da conexao
  // ---------------------------------------------------------------------------

  client.on('connect', () => {
    console.log('Redis connected');
    isReady = true;
  });

  client.on('error', (err) => {
    console.error('Redis error:', err.message);
    isReady = false;
  });

  client.on('close', () => {
    console.warn('Redis connection closed');
    isReady = false;
  });

  // Inicia a conexao imediatamente (lazyConnect evita bloqueio na construcao)
  client.connect().catch((err) => {
    console.error('Redis initial connection failed:', err.message);
    isReady = false;
  });
} else {
  console.warn('REDIS_URL not defined — Redis disabled');
}

// ---------------------------------------------------------------------------
// API publica: obter referencia do cliente e estado
// ---------------------------------------------------------------------------

/**
 * Retorna o cliente Redis (pode ser null) e um booleano indicando
 * se a conexao esta ativa e pronta para uso.
 *
 * @returns {{ client: Redis|null, isReady: boolean }}
 */
export function getRedisClient() {
  return { client, isReady };
}

// ---------------------------------------------------------------------------
// API publica: executar comando Redis com fallback seguro
// ---------------------------------------------------------------------------

/**
 * Executa um comando Redis de forma segura.
 *
 * Se o Redis estiver indisponivel (isReady = false ou cliente nulo),
 * executa a funcao de fallback fornecida. Caso o comando Redis lance
 * excecao, tambem recorre ao fallback.
 *
 * @param {Function} fn - Funcao assincrona que recebe o cliente Redis.
 * @param {Function|null} fallback - Funcao chamada quando o Redis esta
 *   indisponivel. Pode ser null para retornar null silenciosamente.
 * @returns {Promise<any>} Resultado de fn(client) ou de fallback().
 */
export async function withRedis(fn, fallback = null) {
  if (isReady && client) {
    try {
      return await fn(client);
    } catch (err) {
      console.error('Redis command error:', err.message);
      return fallback !== null ? await fallback() : null;
    }
  }

  return fallback !== null ? await fallback() : null;
}