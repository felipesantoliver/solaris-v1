-- Migração: adiciona pgvector à tabela file_chunks
-- Pré-requisito: extensão "vector" disponível no servidor PostgreSQL (Supabase já oferece).

BEGIN;

-- 1. Habilita a extensão pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Adiciona a nova coluna vetorial (384 dimensões — sentence-transformers/all-MiniLM-L6-v2)
ALTER TABLE file_chunks ADD COLUMN IF NOT EXISTS embedding_v vector(384);

-- 3. Migra os dados existentes de embedding (JSONB array de floats) para embedding_v (vector)
--    Só converte linhas onde embedding é um array JSON válido e embedding_v ainda não foi preenchido.
UPDATE file_chunks
SET embedding_v = (
  SELECT ('[' || string_agg(value::text, ',') || ']')::vector
  FROM jsonb_array_elements_text(embedding) AS value
)
WHERE embedding IS NOT NULL
  AND embedding_v IS NULL
  AND jsonb_typeof(embedding) = 'array';

-- 4. Índice HNSW para busca aproximada por similaridade de cosseno
CREATE INDEX IF NOT EXISTS idx_file_chunks_embedding_v_hnsw
ON file_chunks
USING hnsw (embedding_v vector_cosine_ops);

COMMIT;