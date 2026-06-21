// domain/ai/embeddings.js — Geração de embeddings, validação e indexação RAG
//
// CORREÇÃO COMPLETA DO PIPELINE DE EMBEDDINGS (RAG):
//
// Problema raiz: indexFileChunks() só gravava a coluna legada `embedding`
// (JSONB), nunca `embedding_v` (pgvector) — que é a coluna que search.py
// efetivamente lê na busca por similaridade (`fc.embedding_v <=> $1::vector`).
// Resultado: TODO chunk indexado depois da migração 001 ficava com
// embedding_v = NULL para sempre, e o RAG nunca encontrava nada, mesmo com
// arquivos indexados com "sucesso".
//
// Esta versão corrige isso e os riscos identificados na auditoria:
//   1. Persistência:      grava embedding_v usando '[...]'::vector (cast no
//                          próprio SQL, parametrizado — sem string
//                          interpolation manual).
//   2. Validação:         generateEmbedding()/o validador de forma rejeitam
//                          qualquer retorno do Python que não seja
//                          Array(EMBEDDING_DIM) de números finitos.
//   3. Rastreabilidade:   embedding_model TEXT (string fixa do modelo usado)
//                          é gravado junto de cada embedding_v válido.
//   4. Falhas parciais:   embedTextsWithFallback() processa o lote inteiro
//                          numa chamada só (eficiente) e, se isso falhar
//                          (rede OU forma inválida), cai para geração
//                          individual SÓ dos itens que ainda não têm
//                          embedding válido — um chunk ruim nunca derruba os
//                          outros 19 do lote. Itens que continuam falhando
//                          são gravados com embedding_v = NULL + log
//                          detalhado, e o processamento continua.
//   5. Recomputação:      nenhuma função aqui chama o encoder durante uma
//                          resposta de chat — isso é feito 1x na indexação
//                          (upload de arquivo / fonte externa) e os vetores
//                          ficam persistidos para sempre. A busca em tempo
//                          de chat (search.py) só (re)calcula o embedding da
//                          QUERY, nunca o dos chunks já indexados.
//   6. Eficiência:        EMBEDDING_BATCH_SIZE = 20 chunks por chamada a
//                          POST /embeddings/batch, equilibrando overhead de
//                          rede vs. payload por requisição.
//   7. Observabilidade:   indexFileChunks() loga duration_ms, chunk_count,
//                          error_rate e shape_validated ao final do
//                          processamento de cada arquivo/fonte.

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

// Dimensão de saída do sentence-transformers/all-MiniLM-L6-v2. Se o modelo
// mudar (ver EMBEDDING_MODEL no backend-python), estas duas constantes
// PRECISAM ser atualizadas juntas — ver também a migração SQL
// (002_add_embedding_model_file_chunks.sql) e a coluna `vector(384)`.
export const EMBEDDING_DIM = 384;
export const EMBEDDING_MODEL_NAME = 'sentence-transformers/all-MiniLM-L6-v2';

// Tarefa 6: até 20 chunks por chamada a /embeddings/batch.
export const EMBEDDING_BATCH_SIZE = 20;

// Generoso o suficiente para tolerar o cold start do modelo no Python
// (primeiro request após o serviço subir baixa o modelo, ver README) sem
// deixar uma chamada travada para sempre.
const EMBEDDING_REQUEST_TIMEOUT_MS = 20_000;

/**
 * Tarefa 2 — valida estritamente o formato de um embedding retornado pelo
 * microsserviço Python: precisa ser um Array com EXATAMENTE EMBEDDING_DIM
 * elementos, todos do tipo `number` e finitos (rejeita NaN/Infinity).
 */
export function isValidEmbeddingVector(vec) {
  return (
    Array.isArray(vec) &&
    vec.length === EMBEDDING_DIM &&
    vec.every((v) => typeof v === 'number' && Number.isFinite(v))
  );
}

async function fetchJsonWithTimeout(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} em ${url}${detail ? ` — ${detail}` : ''}`);
    }
    return await response.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Timeout (${timeoutMs}ms) ao chamar ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gera o embedding de UM texto via microsserviço Python.
 *
 * Tarefa 2: valida estritamente o retorno — precisa ser um Array com
 * exatamente EMBEDDING_DIM números. Qualquer desvio lança erro: preferimos
 * falhar alto a persistir um vetor corrompido que quebraria silenciosamente
 * a busca por similaridade mais tarde (dimensão errada faz o próprio
 * Postgres rejeitar o INSERT/cast para vector(384), mas um array de
 * strings, nulls ou tamanho certo com lixo passaria batido sem essa
 * validação).
 */
export async function generateEmbedding(text) {
  const data = await fetchJsonWithTimeout(
    `${PYTHON_SERVICE_URL}/embeddings/generate`,
    { text },
    EMBEDDING_REQUEST_TIMEOUT_MS
  );
  const embedding = data?.embedding;
  if (!isValidEmbeddingVector(embedding)) {
    throw new Error(
      `Formato de embedding inválido: esperado Array(${EMBEDDING_DIM}) de números, recebido ` +
      (Array.isArray(embedding) ? `Array(${embedding.length})` : typeof embedding)
    );
  }
  return embedding;
}

/**
 * Gera embeddings para uma LISTA de textos numa única chamada a
 * POST /embeddings/batch (mais barato que N chamadas individuais).
 *
 * Valida apenas a forma do envelope (Array do mesmo tamanho da entrada) —
 * a validação item-a-item (Tarefa 2) fica para o chamador, que precisa
 * saber qual índice especificamente falhou para poder isolar o item
 * (Tarefa 4) sem invalidar o lote inteiro.
 */
async function generateEmbeddingsBatchRaw(texts) {
  const data = await fetchJsonWithTimeout(
    `${PYTHON_SERVICE_URL}/embeddings/batch`,
    { texts },
    EMBEDDING_REQUEST_TIMEOUT_MS
  );
  const embeddings = data?.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw new Error(
      `Formato de lote inválido: esperado Array(${texts.length}), recebido ` +
      (Array.isArray(embeddings) ? `Array(${embeddings.length})` : typeof embeddings)
    );
  }
  return embeddings;
}

/**
 * Tarefa 4 (falhas parciais) + Tarefa 6 (eficiência) — gera embeddings para
 * uma lista de textos (até EMBEDDING_BATCH_SIZE) com a seguinte estratégia:
 *
 *   1. Tenta UMA chamada em lote para todos os textos (caminho feliz/rápido).
 *   2. Qualquer item que não veio com forma válida nessa resposta — ou TODO
 *      o lote, se a chamada falhou por completo (rede, timeout, 5xx) — é
 *      recalculado INDIVIDUALMENTE via generateEmbedding().
 *   3. Itens que falham mesmo na tentativa individual ficam com
 *      `embedding: null` e o motivo em `error` — quem chamar esta função
 *      decide o que fazer (gravar embedding_v = NULL, logar, etc.), mas o
 *      lote nunca para por causa de um item ruim.
 *
 * Retorna um array do MESMO tamanho de `texts`, na mesma ordem, com
 * `{ embedding: number[]|null, error: string|null }` por posição.
 */
export async function embedTextsWithFallback(texts) {
  const results = texts.map(() => ({ embedding: null, error: null }));

  try {
    const raw = await generateEmbeddingsBatchRaw(texts);
    for (let i = 0; i < raw.length; i++) {
      if (isValidEmbeddingVector(raw[i])) {
        results[i].embedding = raw[i];
      } else {
        results[i].error = `shape_invalid_in_batch (recebido ${
          Array.isArray(raw[i]) ? `Array(${raw[i].length})` : typeof raw[i]
        })`;
      }
    }
  } catch (err) {
    // Lote inteiro falhou (rede, timeout, 500, forma do envelope) — todos os
    // itens caem para a tentativa individual abaixo.
    for (let i = 0; i < texts.length; i++) {
      results[i].error = `batch_failed: ${err.message}`;
    }
  }

  // Fallback granular: só recalcula quem ainda não tem embedding válido.
  for (let i = 0; i < texts.length; i++) {
    if (results[i].embedding) continue;
    try {
      results[i].embedding = await generateEmbedding(texts[i]);
      results[i].error = null;
    } catch (err) {
      results[i].error = err.message;
    }
  }

  return results;
}

/**
 * Calcula a similaridade de cosseno entre dois vetores (usado fora do
 * caminho de pgvector, ex.: comparações ad-hoc em memória).
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
  const dot = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
  const normA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

/**
 * Converte um Array de números no literal textual aceito pelo cast
 * '::vector' do pgvector: "[0.10000000,0.20000000,...]".
 * 8 casas decimais — mesma precisão usada em search.py
 * (_embedding_to_vector_literal), por consistência entre os dois serviços.
 */
function toVectorLiteral(embedding) {
  return `[${embedding.map((v) => v.toFixed(8)).join(',')}]`;
}

/**
 * Indexa chunks de texto (cria registros em file_chunks com embedding_v
 * real, prontos para a busca RAG em search.py).
 *
 * Usado tanto pelo upload direto de arquivo (files.js) quanto pela fila de
 * jobs de fontes externas (jobQueue.js / sources.js).
 */
export async function indexFileChunks(fileId, text, db) {
  const startedAt = Date.now();

  if (!text || text.length === 0) {
    console.log(`📊 [embeddings] file_id=${fileId} chunk_count=0 duration_ms=0 — texto vazio, nada a indexar.`);
    return;
  }

  const chunkSize = 500;
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.substring(i, i + chunkSize));
  }

  let successCount = 0;
  let failureCount = 0;

  for (let batchStart = 0; batchStart < chunks.length; batchStart += EMBEDDING_BATCH_SIZE) {
    const batchChunks = chunks.slice(batchStart, batchStart + EMBEDDING_BATCH_SIZE);
    const batchResults = await embedTextsWithFallback(batchChunks);

    await Promise.all(
      batchChunks.map((chunkText, j) => {
        const chunkIndex = batchStart + j;
        const { embedding, error } = batchResults[j];
        const isValid = !error && isValidEmbeddingVector(embedding);

        if (!isValid) {
          failureCount++;
          console.error(
            `❌ [embeddings] file_id=${fileId} chunk_index=${chunkIndex} ` +
            `sem embedding válido (${error || 'motivo desconhecido'}) — gravando embedding_v = NULL.`
          );
        } else {
          successCount++;
        }

        return db
          .runAsync(
            `INSERT INTO file_chunks (file_id, chunk_index, chunk_text, embedding_v, embedding_model)
             VALUES ($1, $2, $3, $4::vector, $5)`,
            [
              fileId,
              chunkIndex,
              chunkText,
              isValid ? toVectorLiteral(embedding) : null,
              isValid ? EMBEDDING_MODEL_NAME : null,
            ]
          )
          .catch((err) => {
            // Falha na própria escrita (ex.: violação de FK) — não é uma
            // falha de embedding, mas também não pode travar os outros
            // chunks do lote. Loga e segue.
            if (isValid) {
              successCount--;
            }
            failureCount++;
            console.error(
              `❌ [embeddings] file_id=${fileId} chunk_index=${chunkIndex} falha ao gravar no banco: ${err.message}`
            );
          });
      })
    );
  }

  const durationMs = Date.now() - startedAt;
  const chunkCount = chunks.length;
  const errorRate = chunkCount > 0 ? failureCount / chunkCount : 0;

  console.log(
    `📊 [embeddings] file_id=${fileId} chunk_count=${chunkCount} success=${successCount} ` +
    `failures=${failureCount} error_rate=${errorRate.toFixed(2)} duration_ms=${durationMs} ` +
    `shape_validated=true model=${EMBEDDING_MODEL_NAME}`
  );
}