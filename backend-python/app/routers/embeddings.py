from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.ml_models import get_embedder

router = APIRouter()


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
        embedder = get_embedder()
        embedding = embedder.encode(text, convert_to_numpy=True)
        return {"embedding": embedding.tolist()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar embedding: {str(e)}")