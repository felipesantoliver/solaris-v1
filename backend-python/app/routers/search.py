import os
import json
import asyncio
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import psycopg2
from psycopg2.extras import RealDictCursor

from app.utils.groq_client import groq_available, groq_complete

router = APIRouter()

MODEL_NAME = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
model = SentenceTransformer(MODEL_NAME)

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
        return True  # Se Groq não disponível, mantém

    prompt = f"""
Pergunta: {query}

Trecho: {chunk_text}

Responda apenas "sim" se este trecho é útil para responder à pergunta, ou "não" caso contrário.
"""
    result = groq_complete(prompt, max_tokens=5)
    if result:
        return result.strip().lower() == "sim"
    return True  # Em caso de erro, mantém

@router.post("/rag")
async def search_rag(request: RAGRequest):
    project_id = request.project_id
    query = request.query.strip()

    if not project_id:
        raise HTTPException(status_code=400, detail="project_id é obrigatório.")
    if not query:
        raise HTTPException(status_code=400, detail="query não pode ser vazia.")

    # 1. Gera embedding da query
    try:
        query_embedding = model.encode(query, convert_to_numpy=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar embedding: {str(e)}")

    # 2. Busca chunks com embedding no banco
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT fc.id, fc.chunk_text, fc.embedding
                FROM file_chunks fc
                JOIN files f ON f.id = fc.file_id
                WHERE f.project_id = %s
                  AND fc.embedding IS NOT NULL
            """, (project_id,))
            rows = cur.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro na consulta ao banco: {str(e)}")
    finally:
        conn.close()

    if not rows:
        return []

    # 3. Calcula similaridade para todos e pega top 5
    scored = []
    for row in rows:
        try:
            embedding_data = row['embedding']
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
                scored.append({
                    "id": row['id'],
                    "text": row['chunk_text'],
                    "score": float(sim)
                })
        except Exception as e:
            print(f"Erro ao processar chunk {row.get('id')}: {e}")
            continue

    # Ordena e pega top 5 (para dar margem ao filtro)
    scored.sort(key=lambda x: x['score'], reverse=True)
    top_5 = scored[:5]

    if not top_5:
        return []

    # 4. Validação com Groq (em paralelo)
    if groq_available():
        tasks = [validate_chunk_groq(chunk['text'], query) for chunk in top_5]
        validation_results = await asyncio.gather(*tasks)

        # Mantém apenas os que passaram na validação
        validated = [chunk for chunk, valid in zip(top_5, validation_results) if valid]
        if validated:
            # Retorna até 3 chunks validados
            return validated[:3]

    # Fallback: retorna top 3 originais
    return top_5[:3]