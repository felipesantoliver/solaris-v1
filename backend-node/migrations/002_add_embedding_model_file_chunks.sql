-- backend-python/migrations/002_add_embedding_model.sql
--
-- Migracao: adiciona rastreabilidade de modelo a file_chunks (pgvector).
--
-- Responsavel por garantir que cada chunk indexado tenha registro de QUAL
-- modelo de embedding o gerou (coluna embedding_model). Isso permite:
--   - Auditoria: saber se um chunk foi indexado com modelo correto
--   - Backfill seletivo: identificar chunks sem embedding valido
--   - Migracoes futuras: trocar o modelo e recomputar apenas os chunks
--     que usam o modelo antigo
--
-- Dependencia logica: a migracao 001_add_pgvector_file_chunks.sql (que cria
-- a extensao "vector" e a coluna embedding_v). No entanto, os statements
-- aqui sao idempotentes e repetidos de proposito, entao esta migracao
-- tambem pode ser executada isoladamente em um ambiente novo, sem depender
-- da ordem de execucao.
--
-- Agrupamento logico:
--   1. Garantia de extensao e coluna vetorial (idempotente)
--   2. Nova coluna de rastreabilidade (embedding_model)
--   3. Backfill imediato para registros ja indexados
--   4. Indice HNSW (idempotente)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. GARANTIA DE EXTENSAO E COLUNA VETORIAL (IDEMPOTENTE)
-- ---------------------------------------------------------------------------

-- Habilita a extensao pgvector se ainda nao estiver ativa.
-- Necessaria para o tipo "vector" usado em embedding_v.
CREATE EXTENSION IF NOT EXISTS vector;

-- Adiciona a coluna vetorial de 384 dimensoes (all-MiniLM-L6-v2).
-- IF NOT EXISTS torna esta linha inofensiva se a 001 ja criou a coluna.
ALTER TABLE file_chunks ADD COLUMN IF NOT EXISTS embedding_v vector(384);

-- ---------------------------------------------------------------------------
-- 2. NOVA COLUNA DE RASTREABILIDADE (embedding_model)
-- ---------------------------------------------------------------------------

-- Adiciona a coluna que registra qual modelo de embedding gerou o vetor.
--
-- Valores possiveis:
--   - 'sentence-transformers/all-MiniLM-L6-v2': modelo padrao do projeto
--   - NULL: chunk ainda nao tem embedding valido (falha parcial na indexacao,
--     ou ainda nao foi processado pelo script de backfill)
--
-- O valor NULL e usado como indicador de "precisa ser recomputado" pelo
-- script de backfill (backend-node/scripts/backfillEmbeddings.js).
ALTER TABLE file_chunks ADD COLUMN IF NOT EXISTS embedding_model TEXT;

-- ---------------------------------------------------------------------------
-- 3. BACKFILL IMEDIATO PARA REGISTROS JA INDEXADOS
-- ---------------------------------------------------------------------------

-- Preenche o embedding_model para todos os chunks que ja possuem embedding_v
-- mas ainda nao tem o modelo registrado.
--
-- Contexto: todo embedding gerado ate o momento neste projeto usou sempre
-- o mesmo modelo fixo (all-MiniLM-L6-v2). Portanto, e seguro assumir que
-- qualquer embedding_v nao-nulo foi gerado por este modelo.
--
-- Isso evita que o script de backfill reprocesse chunks que ja estao corretos,
-- economizando chamadas ao microsservico Python.
UPDATE file_chunks
SET embedding_model = 'sentence-transformers/all-MiniLM-L6-v2'
WHERE embedding_v IS NOT NULL
  AND embedding_model IS NULL;

-- ---------------------------------------------------------------------------
-- 4. INDICE HNSW (IDEMPOTENTE)
-- ---------------------------------------------------------------------------

-- Cria (se nao existir) o indice HNSW para busca aproximada por similaridade
-- de cosseno sobre a coluna embedding_v.
--
-- IF NOT EXISTS garante que esta linha seja inofensiva se a 001 ja criou
-- o indice. A repeticao aqui e proposital: permite que esta migracao seja
-- executada isoladamente em ambientes novos.
CREATE INDEX IF NOT EXISTS idx_file_chunks_embedding_v_hnsw
ON file_chunks
USING hnsw (embedding_v vector_cosine_ops);

COMMIT;

-- ===========================================================================
-- PROXIMO PASSO (fora desta migracao, que so altera estrutura)
-- ===========================================================================
--
-- Execute o script de backfill para popular embedding_v e embedding_model
-- dos registros antigos que ainda nao possuem um embedding valido:
--
--   node scripts/backfillEmbeddings.js
--
-- Isso cobre:
--   - Chunks cujo texto nunca foi embedado (falha na indexacao original)
--   - Chunks com embedding JSONB legado de dimensao inesperada
--   - Chunks onde embedding_v e NULL (falha parcial)
--
-- O script de backfill processa apenas os registros com embedding_model IS NULL,
-- entao o backfill imediato acima (passo 3) reduz significativamente o numero
-- de chunks que precisam ser reprocessados.