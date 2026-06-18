// domain/ai/embeddings.js — Geração de embeddings e similaridade de cosseno
// (utilizado tanto no Node quanto no Python, mas aqui é apenas um helper para o Node)

/**
 * Gera um embedding para um texto usando o microsserviço Python.
 * Se o Python estiver indisponível, retorna um array vazio ou lança erro.
 */
export async function generateEmbedding(text) {
  const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
  try {
    const response = await fetch(`${PYTHON_SERVICE_URL}/embeddings/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.embedding;
  } catch (err) {
    console.error('❌ Falha ao gerar embedding:', err.message);
    throw err;
  }
}

/**
 * Calcula a similaridade de cosseno entre dois vetores.
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
 * Indexa chunks de texto (cria registros na tabela file_chunks).
 * Usado pela fila de jobs para processar embeddings de arquivos.
 */
export async function indexFileChunks(fileId, text, db) {
  if (!text || text.length === 0) return;
  const chunkSize = 500;
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.substring(i, i + chunkSize));
  }
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    let embedding = null;
    try {
      embedding = await generateEmbedding(chunkText);
    } catch {
      // Se falhar, continua sem embedding
    }
    await db.runAsync(
      `INSERT INTO file_chunks (file_id, chunk_index, chunk_text, embedding)
       VALUES ($1, $2, $3, $4)`,
      [fileId, i, chunkText, embedding ? JSON.stringify(embedding) : null]
    );
  }
}