// scripts/backfillEmbeddings.js
//
// Script de backfill para file_chunks.embedding_v e embedding_model.
//
// Responsavel por popular as colunas vetoriais (pgvector) em registros
// antigos, criados antes da correcao do pipeline de embeddings — quando
// indexFileChunks() so gravava a coluna legada JSONB "embedding", nunca
// "embedding_v" nem "embedding_model".
//
// Uso:
//   DATABASE_URL=... PYTHON_SERVICE_URL=... node scripts/backfillEmbeddings.js [--dry-run]
//
// Modo dry-run:
//   Com --dry-run, executa ambas as fases em modo somente leitura.
//   Mostra quantos registros seriam afetados em cada fase, sem gravar nada.
//   Util para estimar o impacto e a duracao antes de rodar em producao.
//
// Agrupamento logico:
//   1. Configuracao e utilitarios
//   2. Fase 1: conversao direta JSONB -> vector (sem chamar Python)
//   3. Fase 2: recomputacao via microsservico Python
//   4. Funcao principal (main)

import { initDb } from '../db/schema.js';
import { allAsync, getAsync, runAsync, getPool } from '../db/database.js';
import {
  embedTextsWithFallback,
  isValidEmbeddingVector,
  EMBEDDING_DIM,
  EMBEDDING_MODEL_NAME,
  EMBEDDING_BATCH_SIZE,
} from '../domain/ai/embeddings.js';

// ---------------------------------------------------------------------------
// 1. CONFIGURACAO E UTILITARIOS
// ---------------------------------------------------------------------------

// Modo dry-run: se a flag --dry-run estiver presente, nenhuma escrita
// e realizada no banco. Util para auditoria e estimativas.
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Converte um array de numeros (embedding) para o literal SQL de vetor.
 *
 * Exemplo: [0.12, -0.45, 0.78] -> '[0.12000000,-0.45000000,0.78000000]'
 *
 * O formato com 8 casas decimais garante precisao suficiente para
 * similaridade de cosseno sem desperdicar espaco de armazenamento.
 *
 * @param {number[]} embedding - Array de 384 floats (dimensao do all-MiniLM-L6-v2)
 * @returns {string} Literal SQL no formato '[v1,v2,...,v384]'
 */
function toVectorLiteral(embedding) {
  return `[${embedding.map((v) => v.toFixed(8)).join(',')}]`;
}

// ---------------------------------------------------------------------------
// 2. FASE 1: CONVERSAO DIRETA JSONB -> VECTOR (SEM CHAMAR PYTHON)
// ---------------------------------------------------------------------------

/**
 * Converte embeddings legados do formato JSONB para o tipo nativo vector.
 *
 * Esta fase e puramente SQL e nao chama o microsservico Python.
 * Apenas registros que atendem a TODOS os criterios abaixo sao convertidos:
 *   - embedding_v ainda e NULL (ainda nao foi convertido)
 *   - embedding (JSONB legado) nao e NULL
 *   - embedding e um array JSON valido
 *   - embedding tem exatamente EMBEDDING_DIM (384) elementos
 *
 * Registros com JSONB malformado (tipo errado ou dimensao incorreta)
 * sao deixados para a Fase 2, que recomputa a partir do chunk_text.
 *
 * A operacao e idempotente: pode ser executada multiplas vezes sem
 * duplicar ou corromper dados.
 */
async function backfillFromLegacyJsonb() {
  console.log('🔄 [backfill] Fase 1: convertendo embedding (JSONB legado) -> embedding_v (vector)...');

  // Conta quantos registros sao elegiveis para conversao direta
  const eligible = await getAsync(
    `SELECT COUNT(*)::int AS n FROM file_chunks
     WHERE embedding_v IS NULL
       AND embedding IS NOT NULL
       AND jsonb_typeof(embedding) = 'array'
       AND jsonb_array_length(embedding) = $1`,
    [EMBEDDING_DIM]
  );
  console.log(`   ${eligible?.n ?? 0} registro(s) elegível(eis) para conversão direta.`);

  // Executa a conversao apenas se nao for dry-run e houver registros
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

  // Verifica se ha registros com JSONB malformado que precisarao da Fase 2
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

// ---------------------------------------------------------------------------
// 3. FASE 2: RECOMPUTACAO VIA MICROSSERVICO PYTHON
// ---------------------------------------------------------------------------

/**
 * Recomputa embeddings para registros que nao puderam ser convertidos na Fase 1.
 *
 * Busca TODOS os registros onde embedding_v ainda e NULL e chunk_text
 * nao e vazio. Para cada lote de EMBEDDING_BATCH_SIZE registros:
 *   1. Envia os textos em lote para o microsservico Python
 *   2. Recebe os embeddings gerados
 *   3. Valida cada embedding (dimensao correta, sem erros)
 *   4. Atualiza o banco com o novo vetor e o nome do modelo
 *
 * Tratamento de erros por item:
 *   Se um chunk especifico falhar (texto vazio, erro no Python, embedding
 *   invalido), ele e contado como falha e seu embedding_v permanece NULL.
 *   Os demais chunks do mesmo lote continuam sendo processados normalmente.
 *
 * Ao final, exibe um resumo com:
 *   - Total de chunks processados
 *   - Sucessos e falhas
 *   - Taxa de erro
 *   - Duracao total
 */
async function backfillByRecomputing() {
  console.log('🔄 [backfill] Fase 2: recomputando embedding_v via microsserviço Python para o que restou...');

  // Busca todos os registros pendentes (embedding_v ainda NULL, com texto)
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

  // Processa em lotes para eficiencia (evita uma chamada por chunk)
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

      // Em dry-run, apenas conta como sucesso sem escrever no banco
      if (DRY_RUN) {
        successCount++;
        continue;
      }

      // Atualiza o registro com o novo embedding e o nome do modelo
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

    // Log de progresso a cada lote processado
    console.log(`   ... processado ${Math.min(i + EMBEDDING_BATCH_SIZE, pending.length)}/${pending.length}`);
  }

  // Resumo final com metricas
  const durationMs = Date.now() - startedAt;
  const total = pending.length;
  const errorRate = total > 0 ? failureCount / total : 0;
  console.log(
    `📊 [backfill] chunk_count=${total} success=${successCount} failures=${failureCount} ` +
    `error_rate=${errorRate.toFixed(2)} duration_ms=${durationMs} shape_validated=true model=${EMBEDDING_MODEL_NAME}` +
    (DRY_RUN ? ' (dry-run — nenhuma escrita realizada)' : '')
  );
}

// ---------------------------------------------------------------------------
// 4. FUNCAO PRINCIPAL (main)
// ---------------------------------------------------------------------------

/**
 * Ponto de entrada do script de backfill.
 *
 * Fluxo:
 *   1. Verifica se DATABASE_URL esta definida (obrigatoria)
 *   2. Inicializa o schema (garante que embedding_v e embedding_model existem)
 *   3. Executa Fase 1: conversao direta JSONB -> vector
 *   4. Executa Fase 2: recomputacao via Python para o que restou
 *   5. Fecha o pool de conexoes e encerra
 *
 * A inicializacao do schema (initDb) e best-effort: garante que as colunas
 * necessarias existam, mas nao falha se a migracao ja foi aplicada.
 */
async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL não definida. Exporte a variável antes de rodar este script.');
    process.exit(1);
  }

  console.log(`🚀 [backfill] Iniciando backfill de embeddings${DRY_RUN ? ' (DRY RUN — nenhuma escrita será feita)' : ''}...`);

  // Garante que embedding_v e embedding_model existem antes de tentar usa-las.
  // initDb e idempotente: se as colunas ja existirem, nao faz nada.
  await initDb();

  // Executa as duas fases em sequencia
  await backfillFromLegacyJsonb();
  await backfillByRecomputing();

  console.log('✅ [backfill] Concluído.');

  // Fecha o pool de conexoes explicitamente para o script encerrar
  const pool = await getPool();
  await pool.end();
  process.exit(0);
}

// Executa a funcao principal com tratamento de erro fatal.
// Se main() lancar uma excecao nao tratada, o script encerra com codigo 1
// e exibe o erro no console.
main().catch((err) => {
  console.error('❌ [backfill] Falha fatal:', err);
  process.exit(1);
});