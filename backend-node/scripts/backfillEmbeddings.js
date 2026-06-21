// scripts/backfillEmbeddings.js — Backfill de file_chunks.embedding_v / embedding_model
//
// Popula registros antigos criados ANTES da correção do pipeline de
// embeddings (quando indexFileChunks() só gravava a coluna legada JSONB
// `embedding`, nunca `embedding_v`/`embedding_model`).
//
// Estratégia em duas fases:
//   Fase 1 (barata, só SQL): para linhas com `embedding` JSONB válido
//     (array de exatamente EMBEDDING_DIM números) e `embedding_v` ainda
//     NULL, converte direto no banco — sem chamar o Python.
//   Fase 2 (recomputa via Python): para QUALQUER linha que continue com
//     `embedding_v IS NULL` depois da Fase 1 (nunca foi embedada, ou o
//     JSONB legado estava malformado), gera um embedding novo a partir de
//     `chunk_text`, em lotes de até EMBEDDING_BATCH_SIZE, reaproveitando a
//     mesma lógica de fallback por item usada em indexFileChunks() — um
//     chunk_text vazio/ilegível não impede os demais de serem processados.
//
// Uso:
//   DATABASE_URL=... PYTHON_SERVICE_URL=... node scripts/backfillEmbeddings.js [--dry-run]
//
// --dry-run: roda as duas fases em modo só-leitura (mostra quantos
//   registros seriam afetados em cada fase, mas não grava nada — útil para
//   estimar o impacto/duração antes de rodar de verdade em produção).

import { initDb } from '../db/schema.js';
import { allAsync, getAsync, runAsync, getPool } from '../db/database.js';
import {
  embedTextsWithFallback,
  isValidEmbeddingVector,
  EMBEDDING_DIM,
  EMBEDDING_MODEL_NAME,
  EMBEDDING_BATCH_SIZE,
} from '../domain/ai/embeddings.js';

const DRY_RUN = process.argv.includes('--dry-run');

function toVectorLiteral(embedding) {
  return `[${embedding.map((v) => v.toFixed(8)).join(',')}]`;
}

// ─── Fase 1: conversão direta JSONB -> vector (sem chamar o Python) ───────
async function backfillFromLegacyJsonb() {
  console.log('🔄 [backfill] Fase 1: convertendo embedding (JSONB legado) -> embedding_v (vector)...');

  const eligible = await getAsync(
    `SELECT COUNT(*)::int AS n FROM file_chunks
     WHERE embedding_v IS NULL
       AND embedding IS NOT NULL
       AND jsonb_typeof(embedding) = 'array'
       AND jsonb_array_length(embedding) = $1`,
    [EMBEDDING_DIM]
  );
  console.log(`   ${eligible?.n ?? 0} registro(s) elegível(eis) para conversão direta.`);

  if (!DRY_RUN && eligible?.n > 0) {
    const result = await runAsync(
      `UPDATE file_chunks
       SET embedding_v = (
             SELECT ('[' || string_agg(value::text, ',') || ']')::vector
             FROM jsonb_array_elements_text(embedding) AS value
           ),
           embedding_model = $1
       WHERE embedding_v IS NULL
         AND embedding IS NOT NULL
         AND jsonb_typeof(embedding) = 'array'
         AND jsonb_array_length(embedding) = $2`,
      [EMBEDDING_MODEL_NAME, EMBEDDING_DIM]
    );
    console.log(`✅ [backfill] Fase 1 concluída: ${result.changes} registro(s) convertido(s).`);
  } else if (DRY_RUN) {
    console.log('   (dry-run — nenhuma escrita realizada)');
  }

  const malformed = await getAsync(
    `SELECT COUNT(*)::int AS n FROM file_chunks
     WHERE embedding_v IS NULL
       AND embedding IS NOT NULL
       AND (jsonb_typeof(embedding) != 'array' OR jsonb_array_length(embedding) != $1)`,
    [EMBEDDING_DIM]
  );
  if (malformed?.n > 0) {
    console.warn(
      `⚠️ [backfill] ${malformed.n} registro(s) com "embedding" JSONB malformado ` +
      `(tipo errado ou dimensão != ${EMBEDDING_DIM}) — serão recomputados a partir do chunk_text na Fase 2.`
    );
  }
}

// ─── Fase 2: recomputação via microsserviço Python ────────────────────────
async function backfillByRecomputing() {
  console.log('🔄 [backfill] Fase 2: recomputando embedding_v via microsserviço Python para o que restou...');

  const pending = await allAsync(
    `SELECT id, chunk_text FROM file_chunks
     WHERE embedding_v IS NULL
       AND chunk_text IS NOT NULL
       AND chunk_text <> ''
     ORDER BY id`
  );
  console.log(`   ${pending.length} registro(s) precisam ser (re)embedados a partir do texto.`);

  if (pending.length === 0) return;

  let successCount = 0;
  let failureCount = 0;
  const startedAt = Date.now();

  for (let i = 0; i < pending.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = pending.slice(i, i + EMBEDDING_BATCH_SIZE);
    const results = await embedTextsWithFallback(batch.map((row) => row.chunk_text));

    for (let j = 0; j < batch.length; j++) {
      const row = batch[j];
      const { embedding, error } = results[j];
      const isValid = !error && isValidEmbeddingVector(embedding);

      if (!isValid) {
        failureCount++;
        console.error(
          `❌ [backfill] file_chunks.id=${row.id} sem embedding válido ` +
          `(${error || 'motivo desconhecido'}) — embedding_v permanece NULL.`
        );
        continue;
      }

      if (DRY_RUN) {
        successCount++;
        continue;
      }

      try {
        await runAsync(
          `UPDATE file_chunks SET embedding_v = $1::vector, embedding_model = $2 WHERE id = $3`,
          [toVectorLiteral(embedding), EMBEDDING_MODEL_NAME, row.id]
        );
        successCount++;
      } catch (err) {
        failureCount++;
        console.error(`❌ [backfill] file_chunks.id=${row.id} falhou ao gravar no banco: ${err.message}`);
      }
    }

    console.log(`   ... processado ${Math.min(i + EMBEDDING_BATCH_SIZE, pending.length)}/${pending.length}`);
  }

  const durationMs = Date.now() - startedAt;
  const total = pending.length;
  const errorRate = total > 0 ? failureCount / total : 0;
  console.log(
    `📊 [backfill] chunk_count=${total} success=${successCount} failures=${failureCount} ` +
    `error_rate=${errorRate.toFixed(2)} duration_ms=${durationMs} shape_validated=true model=${EMBEDDING_MODEL_NAME}` +
    (DRY_RUN ? ' (dry-run — nenhuma escrita realizada)' : '')
  );
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL não definida. Exporte a variável antes de rodar este script.');
    process.exit(1);
  }

  console.log(`🚀 [backfill] Iniciando backfill de embeddings${DRY_RUN ? ' (DRY RUN — nenhuma escrita será feita)' : ''}...`);

  // Garante que embedding_v / embedding_model existem antes de tentar usá-las
  // (best-effort — ver migração v9 em db/schema.js).
  await initDb();

  await backfillFromLegacyJsonb();
  await backfillByRecomputing();

  console.log('✅ [backfill] Concluído.');

  const pool = await getPool();
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ [backfill] Falha fatal:', err);
  process.exit(1);
});