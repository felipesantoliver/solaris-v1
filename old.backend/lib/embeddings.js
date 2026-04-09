// lib/embeddings.js
import pLimit from 'p-limit';

// Embeddings usam o modelo embedding-001 (Gemini 2.5 service)
// Reutiliza GEMINI_FLASH_API_KEY — chave do serviço Gemini 2.5
const GEMINI_API_KEY = process.env.GEMINI_FLASH_API_KEY || process.env.GEMINI_PRO_API;
if (!GEMINI_API_KEY) throw new Error('❌ GEMINI_FLASH_API_KEY não definida');

// ─── Utilitários ──────────────────────────────────────────────
function splitTextIntoChunks(text, chunkSize = 500, overlap = 100) {
  if (!text) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + chunkSize;
    if (end > text.length) end = text.length;
    let chunk = text.slice(start, end);
    const lastPeriod = chunk.lastIndexOf('.');
    if (lastPeriod > chunkSize * 0.7 && end < text.length) {
      chunk = text.slice(start, start + lastPeriod + 1);
      end = start + lastPeriod + 1;
    }
    chunks.push(chunk.trim());
    start = end - overlap;
    if (start < 0) start = 0;
    if (start >= text.length) break;
  }
  return chunks;
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ─── Embedding (Gemini 2.5 — embedding-001) ───────────────────
export async function generateEmbedding(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/embedding-001',
      content: { parts: [{ text }] }
    }),
  });
  if (!response.ok) throw new Error(`Erro ao gerar embedding: ${response.status}`);
  const data = await response.json();
  return data.embedding.values;
}

// ─── Indexação paralela com p-limit ───────────────────────────
export async function indexFileChunks(fileId, text, db) {
  const chunks = splitTextIntoChunks(text);
  if (!chunks.length) return;

  await db.runAsync('DELETE FROM file_chunks WHERE file_id = $1', [fileId]);

  const limit = pLimit(5);
  const tasks = chunks.map((chunk, i) =>
    limit(async () => {
      try {
        const embedding = await generateEmbedding(chunk);
        await db.runAsync(
          'INSERT INTO file_chunks (file_id, chunk_index, chunk_text, embedding) VALUES ($1, $2, $3, $4)',
          [fileId, i, chunk, JSON.stringify(embedding)]
        );
      } catch (err) {
        console.error(`Erro ao indexar chunk ${i}:`, err.message);
      }
    })
  );

  await Promise.all(tasks);
  console.log(`✅ Indexados ${chunks.length} chunks para arquivo ${fileId} (paralelismo 5)`);
}

export { splitTextIntoChunks, cosineSimilarity };