// domain > ai > JS embeddings.js

// ---------------------------------------------------------------------------
// Dependencias
// ---------------------------------------------------------------------------

import { pipeline } from '@xenova/transformers';
import { getRedisClient } from '../../utils/redis.js';
import { withRedis } from '../../utils/redis.js';

// ---------------------------------------------------------------------------
// Configuracao do modelo de embeddings
// ---------------------------------------------------------------------------

// Modelo de linguagem utilizado para gerar vetores de embedding.
// Baseado no MiniLM, otimizado para similaridade semantica com
// baixo consumo de recursos.
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

// Dimensao dos vetores gerados pelo modelo (384 para MiniLM-L6)
const EMBEDDING_DIM = 384;

// ---------------------------------------------------------------------------
// Cache do pipeline do modelo
// ---------------------------------------------------------------------------

// Singleton do pipeline para evitar recarregar o modelo a cada chamada.
// O modelo e carregado sob demanda na primeira utilizacao.
let extractorPipeline = null;

// ---------------------------------------------------------------------------
// Prefixo para chaves de cache no Redis
// ---------------------------------------------------------------------------

// Chave usada como prefixo para armazenamento de embeddings em cache.
// Formato: embed:{hash_do_texto}
const CACHE_PREFIX = 'embed:';

// ---------------------------------------------------------------------------
// Funcoes auxiliares
// ---------------------------------------------------------------------------

/**
 * Gera uma chave de cache deterministica para um texto.
 * Utiliza codificacao base64 da string para evitar caracteres
 * invalidos em chaves do Redis.
 *
 * @param {string} text - Texto de entrada.
 * @returns {string} Chave no formato embed:{hash}.
 */
function getCacheKey(text) {
  const hash = Buffer.from(text).toString('base64').slice(0, 64);
  return `${CACHE_PREFIX}${hash}`;
}

// ---------------------------------------------------------------------------
// Inicializacao do pipeline de extracao (sob demanda)
// ---------------------------------------------------------------------------

/**
 * Obtem ou inicializa o pipeline do Transformers.js.
 * O carregamento do modelo acontece apenas na primeira chamada.
 *
 * @returns {Promise<object>} Pipeline configurado para feature-extraction.
 */
async function getPipeline() {
  if (!extractorPipeline) {
    console.log(`Loading embedding model: ${MODEL_NAME}`);
    extractorPipeline = await pipeline('feature-extraction', MODEL_NAME);
    console.log('Embedding model loaded');
  }
  return extractorPipeline;
}

// ---------------------------------------------------------------------------
// API publica: gerar embedding a partir de texto
// ---------------------------------------------------------------------------

/**
 * Gera um vetor de embedding para o texto fornecido.
 *
 * Fluxo:
 * 1. Tenta recuperar do cache Redis (se disponivel).
 * 2. Em caso de cache miss, gera o embedding via Transformers.js.
 * 3. Armazena o resultado no cache Redis com TTL de 24 horas.
 * 4. Retorna o vetor normalizado.
 *
 * @param {string} text - Texto para gerar o embedding.
 * @returns {Promise<number[]>} Vetor de embedding com 384 dimensoes.
 */
export async function generateEmbedding(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('Text is required to generate embedding');
  }

  const cacheKey = getCacheKey(text);

  // ---------------------------------------------------------------------------
  // Tentativa de cache Redis
  // ---------------------------------------------------------------------------

  const cached = await withRedis(
    async (redis) => {
      const raw = await redis.get(cacheKey);
      return raw ? JSON.parse(raw) : null;
    },
    () => null // Fallback: retorna null se Redis estiver indisponivel
  );

  if (cached) {
    console.log(`Embedding cache hit: ${cacheKey}`);
    return cached;
  }

  // ---------------------------------------------------------------------------
  // Geracao do embedding via modelo
  // ---------------------------------------------------------------------------

  console.log(`Generating embedding for text (${text.length} chars)`);

  const pipe = await getPipeline();
  const result = await pipe(text, {
    pooling: 'mean',
    normalize: true,
  });

  // Converte o tensor de saida para array JavaScript
  const embedding = Array.from(result.data);

  // ---------------------------------------------------------------------------
  // Armazenamento no cache Redis (TTL de 24 horas)
  // ---------------------------------------------------------------------------

  await withRedis(
    async (redis) => {
      await redis.setex(cacheKey, 86400, JSON.stringify(embedding));
      console.log(`Embedding cached: ${cacheKey}`);
    },
    () => {} // Fallback vazio: nao faz nada se Redis estiver indisponivel
  );

  return embedding;
}

// ---------------------------------------------------------------------------
// API publica: gerar embeddings em lote
// ---------------------------------------------------------------------------

/**
 * Gera embeddings para multiplos textos em lote.
 * Otimizado para processamento em massa, reduzindo sobrecarga
 * de chamadas ao modelo.
 *
 * @param {string[]} texts - Array de textos para gerar embeddings.
 * @returns {Promise<number[][]>} Array de vetores de embedding.
 */
export async function generateEmbeddingsBatch(texts) {
  if (!texts || texts.length === 0) {
    return [];
  }

  console.log(`Generating embeddings for ${texts.length} texts`);

  const pipe = await getPipeline();
  const embeddings = [];

  // Processa cada texto individualmente para permitir cache por item
  for (const text of texts) {
    const embedding = await generateEmbedding(text);
    embeddings.push(embedding);
  }

  return embeddings;
}

// ---------------------------------------------------------------------------
// API publica: calcular similaridade entre vetores
// ---------------------------------------------------------------------------

/**
 * Calcula a similaridade do cosseno entre dois vetores de embedding.
 *
 * Formula: cos(theta) = (A . B) / (||A|| * ||B||)
 *
 * O resultado varia de -1 (opostos) a 1 (identicos). Valores
 * proximos de 1 indicam alta similaridade semantica.
 *
 * @param {number[]} vecA - Primeiro vetor de embedding.
 * @param {number[]} vecB - Segundo vetor de embedding.
 * @returns {number} Similaridade do cosseno no intervalo [-1, 1].
 */
export function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same dimension');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);

  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

// ---------------------------------------------------------------------------
// API publica: indexar chunks de um arquivo
// ---------------------------------------------------------------------------

/**
 * Indexa os chunks de texto de um arquivo para busca semantica.
 *
 * Fluxo:
 * 1. Divide o texto em chunks de aproximadamente 500 caracteres.
 * 2. Gera embedding para cada chunk.
 * 3. Persiste os embeddings na tabela file_chunks do banco de dados.
 *
 * @param {string} fileId - ID do arquivo no banco.
 * @param {string} text - Texto completo extraido do arquivo.
 * @param {object} db - Objeto com helpers de banco (runAsync, allAsync, getAsync).
 * @returns {Promise<number>} Quantidade de chunks indexados.
 */
export async function indexFileChunks(fileId, text, db) {
  if (!text || text.trim().length === 0) {
    console.warn(`No text to index for file ${fileId}`);
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Divisao do texto em chunks com overlap
  // ---------------------------------------------------------------------------

  const CHUNK_SIZE = 500;
  const OVERLAP = 50;
  const chunks = [];

  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    start += CHUNK_SIZE - OVERLAP;
  }

  console.log(`Indexing ${chunks.length} chunks for file ${fileId}`);

  // ---------------------------------------------------------------------------
  // Geracao de embeddings e persistencia
  // ---------------------------------------------------------------------------

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = await generateEmbedding(chunk);
    const embeddingJson = JSON.stringify(embedding);

    await db.runAsync(
      `INSERT INTO file_chunks (file_id, chunk_index, chunk_text, embedding)
       VALUES ($1, $2, $3, $4::vector)
       ON CONFLICT (file_id, chunk_index) DO UPDATE
       SET chunk_text = $3, embedding = $4::vector`,
      [fileId, i, chunk, embeddingJson]
    );
  }

  console.log(`Indexed ${chunks.length} chunks for file ${fileId}`);
  return chunks.length;
}

// ---------------------------------------------------------------------------
// API publica: busca semantica em chunks de arquivos
// ---------------------------------------------------------------------------

/**
 * Realiza busca semantica nos chunks indexados de um projeto.
 *
 * Fluxo:
 * 1. Gera embedding para a consulta.
 * 2. Busca os chunks mais similares usando similaridade do cosseno
 *    diretamente no PostgreSQL (via extensao pgvector).
 * 3. Retorna os chunks ordenados por similaridade decrescente.
 *
 * @param {string} projectId - ID do projeto no escopo da busca.
 * @param {string} query - Texto da consulta.
 * @param {object} db - Objeto com helpers de banco.
 * @param {number} limit - Quantidade maxima de resultados (padrao: 5).
 * @returns {Promise<object[]>} Array de objetos com chunk_text, file_id e similarity.
 */
export async function searchChunks(projectId, query, db, limit = 5) {
  const queryEmbedding = await generateEmbedding(query);
  const queryEmbeddingJson = JSON.stringify(queryEmbedding);

  const results = await db.allAsync(
    `SELECT
       fc.chunk_text,
       fc.file_id,
       1 - (fc.embedding <=> $1::vector) AS similarity
     FROM file_chunks fc
     JOIN files f ON f.id = fc.file_id
     WHERE f.project_id = $2
     ORDER BY fc.embedding <=> $1::vector
     LIMIT $3`,
    [queryEmbeddingJson, projectId, limit]
  );

  return results;
}