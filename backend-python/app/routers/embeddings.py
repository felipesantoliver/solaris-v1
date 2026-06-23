# app/routers/embeddings.py
#
# Rota de geracao de embeddings — recebe um texto e retorna seu vetor
# de embedding usando o modelo SentenceTransformer (all-MiniLM-L6-v2).
#
# Usado para:
#   - Busca semantica em documentos (RAG): embedding da query do usuario
#   - Extracao de memorias: embedding do texto extraido para comparacao
#   - Sintese de memorias: embedding da consulta para similaridade
#
# O modelo e carregado uma unica vez via singleton em ml_models.py
# (get_embedder). Nao ha custo de recarga a cada requisicao.
#
# Agrupamento logico:
#   1. Modelo Pydantic
#   2. Endpoint de geracao de embedding

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.ml_models import get_embedder

router = APIRouter()

# ---------------------------------------------------------------------------
# 1. MODELO PYDANTIC
# ---------------------------------------------------------------------------

class EmbeddingRequest(BaseModel):
    text: str

# ---------------------------------------------------------------------------
# 2. ENDPOINT DE GERACAO DE EMBEDDING
# ---------------------------------------------------------------------------

@router.post("/generate")
async def generate_embedding(request: EmbeddingRequest):
    """
    Gera um embedding (vetor de 384 dimensoes) para um texto.

    Chamado pelo backend Node para:
      - Gerar embedding da query do usuario durante busca RAG
        (searchRelevantChunks em messages.js)
      - Gerar embeddings de memorias extraidas (extractMemories em prompt.js)

    Modelo utilizado:
      sentence-transformers/all-MiniLM-L6-v2
      - 384 dimensoes por vetor
      - Modelo leve e multilingue com otimo equilibrio qualidade/recursos
      - Carregado via singleton em ml_models.get_embedder()

    Returns:
        dict: {"embedding": [float, float, ...]} — array de 384 floats
    """
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Texto vazio.")

    try:
        embedder = get_embedder()
        # encode com convert_to_numpy=True retorna array numpy (mais eficiente
        # que lista Python para operacoes matematicas posteriores)
        embedding = embedder.encode(text, convert_to_numpy=True)
        # Converte para lista Python para serializacao JSON na resposta
        return {"embedding": embedding.tolist()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar embedding: {str(e)}")