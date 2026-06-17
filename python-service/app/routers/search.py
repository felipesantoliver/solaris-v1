import os
import json
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import psycopg2
from psycopg2.extras import RealDictCursor

router = APIRouter()

# Carrega o modelo de embedding (mesmo usado em embeddings.py)
MODEL_NAME = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
model = SentenceTransformer(MODEL_NAME)

# Conecta ao banco PostgreSQL usando DATABASE_URL
def get_db_connection():
    try:
        return psycopg2.connect(os.getenv("DATABASE_URL"))
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Erro ao conectar ao banco: {str(e)}")

class RAGRequest(BaseModel):
    project_id: str
    query: str

@router.post("/rag")
async def search_rag(request: RAGRequest):
    """
    Recebe project_id e query, gera embedding, busca chunks com embedding no banco,
    calcula similaridade de cosseno e retorna os top 3 chunks com score > 0.65.
    """
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

    # 2. Busca chunks com embedding para o projeto
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
        return []  # Nenhum chunk encontrado

    # 3. Calcula similaridade de cosseno para cada chunk
    results = []
    THRESHOLD = 0.65

    for row in rows:
        try:
            # embedding está armazenado como JSONB (string JSON)
            embedding_data = row['embedding']
            if isinstance(embedding_data, str):
                chunk_embedding = np.array(json.loads(embedding_data))
            else:
                chunk_embedding = np.array(embedding_data)

            # Similaridade de cosseno
            norm_query = np.linalg.norm(query_embedding)
            norm_chunk = np.linalg.norm(chunk_embedding)
            if norm_query == 0 or norm_chunk == 0:
                sim = 0.0
            else:
                sim = np.dot(query_embedding, chunk_embedding) / (norm_query * norm_chunk)

            if sim > THRESHOLD:
                results.append({
                    "text": row['chunk_text'],
                    "score": float(sim)
                })
        except Exception as e:
            print(f"Erro ao processar chunk {row.get('id')}: {e}")
            continue

    # 4. Ordena por score (maior primeiro) e retorna top 3
    results.sort(key=lambda x: x['score'], reverse=True)
    return results[:3]