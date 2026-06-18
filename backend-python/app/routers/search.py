import os
import json
import asyncio
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import psycopg2
from psycopg2.extras import RealDictCursor

from app.ml_models import get_embedder
from app.utils.groq_client import groq_available, groq_complete

router = APIRouter()


def get_db_connection():
    try:
        return psycopg2.connect(os.getenv("DATABASE_URL"))
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Erro ao conectar ao banco: {str(e)}")


class RAGRequest(BaseModel):
    project_id: str
    query: str


async def validate_chunk_groq(chunk_text: str, query: str) -> bool:
    """Valida se o chunk é útil para responder à query usando Groq."""
    if not groq_available():
        return True

    prompt = f"""
Pergunta: {query}

Trecho: {chunk_text}

Responda apenas "sim" se este trecho é útil para responder à pergunta, ou "não" caso contrário.
"""
    result = groq_complete(prompt, max_tokens=5)
    if result:
        return result.strip().lower() == "sim"
    return True


def _fetch_chunks_sync(project_id: str):
    """Executa a query psycopg2 de forma síncrona (será chamada via asyncio.to_thread)."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT fc.id, fc.chunk_text, fc.embedding
                FROM file_chunks fc
                JOIN files f ON f.id = fc.file_id
                WHERE f.project_id = %s
                  AND fc.embedding IS NOT NULL
                """,
                (project_id,),
            )
            return cur.fetchall()
    finally:
        conn.close()


@router.post("/rag")
async def search_rag(request: RAGRequest):
    project_id = request.project_id
    query = request.query.strip()

    if not project_id:
        raise HTTPException(status_code=400, detail="project_id é obrigatório.")
    if not query:
        raise HTTPException(status_code=400, detail="query não pode ser vazia.")

    embedder = get_embedder()

    # 1. Gera embedding da query
    try:
        query_embedding = embedder.encode(query, convert_to_numpy=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar embedding: {str(e)}")

    # 2. Busca chunks com embedding no banco (psycopg2 síncrono via thread pool)
    try:
        rows = await asyncio.to_thread(_fetch_chunks_sync, project_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro na consulta ao banco: {str(e)}")

    if not rows:
        return []

    # 3. Calcula similaridade coseno e filtra top 5
    scored = []
    for row in rows:
        try:
            embedding_data = row["embedding"]
            if isinstance(embedding_data, str):
                chunk_embedding = np.array(json.loads(embedding_data))
            else:
                chunk_embedding = np.array(embedding_data)

            norm_query = np.linalg.norm(query_embedding)
            norm_chunk = np.linalg.norm(chunk_embedding)
            if norm_query == 0 or norm_chunk == 0:
                sim = 0.0
            else:
                sim = np.dot(query_embedding, chunk_embedding) / (norm_query * norm_chunk)

            if sim > 0.65:
                scored.append({"id": row["id"], "text": row["chunk_text"], "score": float(sim)})
        except Exception as e:
            print(f"Erro ao processar chunk {row.get('id')}: {e}")
            continue

    scored.sort(key=lambda x: x["score"], reverse=True)
    top_5 = scored[:5]

    if not top_5:
        return []

    # 4. Validação com Groq (em paralelo)
    if groq_available():
        tasks = [validate_chunk_groq(chunk["text"], query) for chunk in top_5]
        validation_results = await asyncio.gather(*tasks)
        validated = [chunk for chunk, valid in zip(top_5, validation_results) if valid]
        if validated:
            return validated[:3]

    return top_5[:3]