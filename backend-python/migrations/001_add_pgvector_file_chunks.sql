-- Caminho: backend-python/migrations/001_add_pgvector_file_chunks.sql
-- Objetivo: Ativar pgvector, adicionar coluna vetorial e criar índice HNSW para busca semântica em file_chunks.
-- Pré-requisito: Extensão "vector" disponível no PostgreSQL (fornecida por padrão no Supabase).

BEGIN;

-- =============================================================================
-- ETAPA 1: HABILITACAO DA EXTENSAO PGVECTOR
-- =============================================================================

-- Ativa a extensão pgvector caso ainda não esteja habilitada no banco.
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- ETAPA 2: ADICAO DA COLUNA VETORIAL
-- =============================================================================

-- Adiciona a coluna embedding_v com tipo vector(384), compatível com o modelo
-- sentence-transformers/all-MiniLM-L6-v2, que gera embeddings de 384 dimensões.
-- O uso de vector nativo melhora a performance de buscas por similaridade.
ALTER TABLE file_chunks ADD COLUMN IF NOT EXISTS embedding_v vector(384);

-- =============================================================================
-- ETAPA 3: MIGRACAO DE DADOS EXISTENTES
-- =============================================================================

-- Converte embeddings armazenados como array JSONB (formato antigo) para o tipo
-- vector. Apenas linhas com embedding JSON válido e sem valor em embedding_v
-- são processadas. Isso garante que dados anteriores à migração permaneçam
-- utilizáveis no novo formato.
UPDATE file_chunks
SET embedding_v = (
  SELECT ('[' || string_agg(value::text, ',') || ']')::vector
  FROM jsonb_array_elements_text(embedding) AS value
)
WHERE embedding IS NOT NULL
  AND embedding_v IS NULL
  AND jsonb_typeof(embedding) = 'array';

-- =============================================================================
-- ETAPA 4: CRIACAO DO INDICE HNSW
-- =============================================================================

-- Cria um índice HNSW (Hierarchical Navigable Small World) sobre a coluna
-- embedding_v usando similaridade de cosseno (vector_cosine_ops). Esse índice
-- acelera as consultas de busca semântica (RAG) que recuperam chunks relevantes
-- com base na proximidade vetorial.
CREATE INDEX IF NOT EXISTS idx_file_chunks_embedding_v_hnsw
ON file_chunks
USING hnsw (embedding_v vector_cosine_ops);

COMMIT;