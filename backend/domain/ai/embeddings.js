// domain/ai/embeddings.js — Embeddings com fallback Groq → Gemini

import pLimit from 'p-limit';

const GROQ_API_KEY = process.env.SOLARIS_EMBEDDING_GROQ;
const GEMINI_API_KEY = process.env.GEMINI_PRO_API;

if (!GROQ_API_KEY && !GEMINI_API_KEY) {
  throw new Error('❌ Nenhuma API de embedding configurada');
}

// =========================
// Utils
// =========================

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

// =========================
// Embeddings
// =========================

async function generateEmbeddingGroq(text) {
  if (!GROQ_API_KEY) throw new Error('Groq não configurado');

  const response = await fetch('https://api.groq.com/openai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small', // ou outro que você usar
      input: text
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq erro: ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function generateEmbeddingGemini(text) {
  if (!GEMINI_API_KEY) throw new Error('Gemini não configurado');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/embedding-001',
      content: { parts: [{ text }] }
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini erro: ${response.status}`);
  }

  const data = await response.json();
  return data.embedding.values;
}

// =========================
// Fallback inteligente
// =========================

export async function generateEmbedding(text) {
  // 1️⃣ tenta Groq
  try {
    const embedding = await generateEmbeddingGroq(text);
    console.log('⚡ Embedding via Groq');
    return embedding;
  } catch (err) {
    console.warn('⚠️ Groq falhou, usando fallback Gemini:', err.message);
  }

  // 2️⃣ fallback Gemini
  try {
    const embedding = await generateEmbeddingGemini(text);
    console.log('🔁 Embedding via Gemini');
    return embedding;
  } catch (err) {
    console.error('❌ Gemini também falhou:', err.message);
    throw err; // aqui sim falha total
  }
}

// =========================
// Indexação
// =========================

export async function indexFileChunks(fileId, text, db) {
  const chunks = splitTextIntoChunks(text);
  if (!chunks.length) return;

  await db.runAsync('DELETE FROM file_chunks WHERE file_id = $1', [fileId]);

  const limit = pLimit(5);

  let success = 0;
  let failed = 0;

  const tasks = chunks.map((chunk, i) =>
    limit(async () => {
      try {
        const embedding = await generateEmbedding(chunk);

        await db.runAsync(
          'INSERT INTO file_chunks (file_id, chunk_index, chunk_text, embedding) VALUES ($1, $2, $3, $4)',
          [fileId, i, chunk, JSON.stringify(embedding)]
        );

        success++;
      } catch (err) {
        failed++;
        console.error(`❌ Erro chunk ${i}:`, err.message);
      }
    })
  );

  await Promise.all(tasks);

  console.log(`✅ Indexação concluída:
  → total: ${chunks.length}
  → sucesso: ${success}
  → falhas: ${failed}`);
}

export { splitTextIntoChunks, cosineSimilarity };