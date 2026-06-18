import os
import asyncio
import hashlib
import asyncpg
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.ml_models import get_embedder

router = APIRouter()

_query_embedding_cache = {}
_QUERY_EMBEDDING_CACHE_MAX = 256


def _get_cached_query_embedding(query: str, embedder):
    """Cache FIFO simples para embeddings de query (máx. 256 entradas)."""
    cache_key = hashlib.sha256(query.encode("utf-8")).hexdigest()[:16]
    if cache_key in _query_embedding_cache:
        return _query_embedding_cache[cache_key]

    embedding = embedder.encode(query, convert_to_numpy=True)

    if len(_query_embedding_cache) >= _QUERY_EMBEDDING_CACHE_MAX:
        oldest_key = next(iter(_query_embedding_cache))
        del _query_embedding_cache[oldest_key]

    _query_embedding_cache[cache_key] = embedding
    return embedding


class RAGRequest(BaseModel):
    project_id: str
    query: str


# ─── Pool asyncpg (criado uma vez, reutilizado em todas as requisições) ───
_pg_pool: asyncpg.Pool | None = None
_pg_pool_lock = asyncio.Lock()


async def get_pg_pool() -> asyncpg.Pool:
    global _pg_pool
    if _pg_pool is not None:
        return _pg_pool
    async with _pg_pool_lock:
        if _pg_pool is None:
            try:
                _pg_pool = await asyncpg.create_pool(
                    dsn=os.getenv("DATABASE_URL"),
                    min_size=2,
                    max_size=10,
                )
            except Exception as e:
                raise HTTPException(status_code=503, detail=f"Erro ao criar pool do banco: {str(e)}")
    return _pg_pool


def _embedding_to_vector_literal(embedding) -> str:
    """Converte um array numpy para o formato literal do pgvector: '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{v:.8f}" for v in embedding.tolist()) + "]"


@router.post("/rag")
async def search_rag(request: RAGRequest):
    project_id = request.project_id
    query = request.query.strip()

    if not project_id:
        raise HTTPException(status_code=400, detail="project_id é obrigatório.")
    if not query:
        raise HTTPException(status_code=400, detail="query não pode ser vazia.")

    embedder = get_embedder()

    # 1. Gera embedding da query (com cache)
    try:
        query_embedding = _get_cached_query_embedding(query, embedder)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar embedding: {str(e)}")

    embedding_literal = _embedding_to_vector_literal(query_embedding)

    # 2. Busca vetorial via pgvector (operador <=> = distância de cosseno)
    #    Traz um conjunto maior (LIMIT 20) ordenado por distância para depois
    #    filtrar por score >= 0.65 e devolver só os 3 melhores — preserva o
    #    comportamento original sem perder a ordenação por relevância.
    pool = await get_pg_pool()

    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT fc.id, fc.chunk_text, 1 - (fc.embedding_v <=> $1::vector) AS score
                FROM file_chunks fc
                JOIN files f ON f.id = fc.file_id
                WHERE f.project_id = $2
                  AND fc.embedding_v IS NOT NULL
                ORDER BY fc.embedding_v <=> $1::vector
                LIMIT 20
                """,
                embedding_literal,
                project_id,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro na consulta vetorial ao banco: {str(e)}")

    # 3. Filtra por similaridade >= 0.65 (já vem ordenado por relevância)
    filtered = [row for row in rows if row["score"] >= 0.65]

    return [
        {"id": row["id"], "text": row["chunk_text"], "score": float(row["score"])}
        for row in filtered[:3]
    ]