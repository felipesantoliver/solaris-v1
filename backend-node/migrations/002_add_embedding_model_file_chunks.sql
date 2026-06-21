-- Migração: adiciona rastreabilidade de modelo a file_chunks (pgvector)
-- Depende da 001_add_pgvector_file_chunks.sql (cria a extensão "vector" e a
-- coluna embedding_v). Os três primeiros statements abaixo são idempotentes
-- e repetidos aqui de propósito, então esta migração também pode ser
-- executada isoladamente em um ambiente novo, sem depender da ordem.

BEGIN;

-- 1. Garante a extensão e a coluna vetorial (idempotente — ver 001)
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE file_chunks ADD COLUMN IF NOT EXISTS embedding_v vector(384);

-- 2. Nova coluna: qual modelo gerou o embedding_v desta linha.
--    NULL significa "esta linha não tem embedding_v válido" (falha parcial
--    na indexação, ou ainda não recomputado pelo script de backfill) — ver
--    backend-node/scripts/backfillEmbeddings.js.
ALTER TABLE file_chunks ADD COLUMN IF NOT EXISTS embedding_model TEXT;

-- 3. Backfill imediato: linhas que JÁ têm embedding_v (preenchido pela 001
--    a partir do JSONB legado, ou por uma indexação após a correção do
--    pipeline) mas ainda não têm embedding_model registrado — todo
--    embedding já gerado neste projeto usou sempre o mesmo modelo fixo.
UPDATE file_chunks
SET embedding_model = 'sentence-transformers/all-MiniLM-L6-v2'
WHERE embedding_v IS NOT NULL
  AND embedding_model IS NULL;

-- 4. Índice HNSW (idempotente — garante que existe mesmo se 001 não rodou)
CREATE INDEX IF NOT EXISTS idx_file_chunks_embedding_v_hnsw
ON file_chunks
USING hnsw (embedding_v vector_cosine_ops);

COMMIT;

-- Próximo passo (fora desta migração, que só altera estrutura):
-- rode `node scripts/backfillEmbeddings.js` no backend-node para popular
-- embedding_v/embedding_model dos registros antigos que ainda não têm um
-- embedding válido (texto nunca embedado, ou JSONB legado com dimensão
-- inesperada).