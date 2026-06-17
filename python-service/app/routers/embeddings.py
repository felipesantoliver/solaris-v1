import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

router = APIRouter()

# Carrega o modelo uma única vez (cache)
MODEL_NAME = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
model = SentenceTransformer(MODEL_NAME)

class EmbeddingRequest(BaseModel):
    text: str

@router.post("/generate")
async def generate_embedding(request: EmbeddingRequest):
    """
    Recebe um texto e retorna o embedding (lista de floats).
    """
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Texto vazio.")

    try:
        embedding = model.encode(text, convert_to_numpy=True)
        # Converte para lista de floats (JSON serializável)
        embedding_list = embedding.tolist()
        return {"embedding": embedding_list}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar embedding: {str(e)}")