import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from dotenv import load_dotenv

# Import routers existentes
from app.routers import voice, files, embeddings, search, memories, history, title, intent

load_dotenv()

app = FastAPI(title="Solaris Python Microservice", version="1.0.0")

# CORS
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
NODE_URL = os.getenv("NODE_URL", "http://localhost:3001")
origins = [FRONTEND_URL, NODE_URL]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rotas existentes
app.include_router(voice.router, prefix="/voice", tags=["voice"])
app.include_router(files.router, prefix="/files", tags=["files"])
app.include_router(embeddings.router, prefix="/embeddings", tags=["embeddings"])
app.include_router(search.router, prefix="/search", tags=["search"])
app.include_router(memories.router, prefix="/memories", tags=["memories"])
app.include_router(history.router, prefix="/history", tags=["history"])
app.include_router(title.router, prefix="/title", tags=["title"])
app.include_router(intent.router, prefix="/intent", tags=["intent"])


# ─── NOVAS ROTAS DE OTIMIZAÇÃO ──────────────────────────────────────────

class BatchEmbeddingsRequest(BaseModel):
    texts: List[str]

class BatchEmbeddingsResponse(BaseModel):
    embeddings: List[List[float]]

@app.post("/embeddings/batch", response_model=BatchEmbeddingsResponse)
async def batch_embeddings(req: BatchEmbeddingsRequest):
    """
    Processa uma lista de textos e retorna os embeddings em lote.
    Usa SentenceTransformer com vetorização nativa.
    """
    if not req.texts:
        raise HTTPException(status_code=400, detail="Lista de textos vazia.")
    try:
        from app.ml_models import get_embedder
        embedder = get_embedder()
        embeddings = embedder.encode(req.texts, convert_to_numpy=True)
        return {"embeddings": [emb.tolist() for emb in embeddings]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar embeddings: {str(e)}")


class CondenseChunkRequest(BaseModel):
    chunk: str
    max_chars: int = 200

class CondenseChunkResponse(BaseModel):
    condensed: str

@app.post("/tools/condense-chunk", response_model=CondenseChunkResponse)
async def condense_chunk(req: CondenseChunkRequest):
    """
    Condensa um chunk de texto para até max_chars caracteres.
    Se o chunk for menor que max_chars, retorna o original.
    Caso contrário, extrai a frase mais relevante usando heurística simples.
    """
    text = req.chunk.strip()
    max_chars = req.max_chars
    if len(text) <= max_chars:
        return {"condensed": text}

    # Divisão em frases (simples)
    import re
    sentences = re.split(r'(?<=[.!?])\s+', text)
    if not sentences:
        return {"condensed": text[:max_chars] + "..."}

    # Palavras-chave para priorizar
    keywords = [
        "porque", "assim", "portanto", "consequentemente", "resultado",
        "conclusão", "importante", "crítico", "essencial", "fundamental",
        "key", "important", "therefore", "conclusion", "result", "critical"
    ]
    for sent in sentences:
        if any(kw in sent.lower() for kw in keywords):
            if len(sent) > max_chars:
                sent = sent[:max_chars] + "..."
            return {"condensed": sent.strip()}

    # Se nenhuma frase com keyword, pega a mais longa (mas não maior que max_chars)
    best = max(sentences, key=len)
    if len(best) > max_chars:
        best = best[:max_chars] + "..."
    return {"condensed": best.strip()}


class OptimizePersonalityRequest(BaseModel):
    text: str
    max_chars: int = 280

class OptimizePersonalityResponse(BaseModel):
    optimized: str
    source: str  # "groq" ou "fallback"

@app.post("/tools/optimize-personality", response_model=OptimizePersonalityResponse)
async def optimize_personality(req: OptimizePersonalityRequest):
    """
    Reescreve a descrição de personalidade (escrita livremente pelo usuário ao
    criar/editar um projeto) em uma instrução de sistema compacta e objetiva.
    Isso economiza tokens em TODA mensagem trocada no projeto, já que esse
    texto entra no system prompt de cada chamada ao modelo.
    Usa Groq se disponível; se falhar/indisponível, aplica fallback local
    (normaliza espaços e corta no limite de caracteres) — nunca derruba a
    criação do projeto por causa disso.
    """
    from app.utils.groq_client import groq_available, groq_complete
    text = req.text.strip()
    max_chars = req.max_chars
    if not text:
        return OptimizePersonalityResponse(optimized="", source="fallback")

    if groq_available():
        prompt = f"""
Reescreva a descrição de personalidade abaixo como uma instrução de sistema direta e objetiva para um assistente de IA, na 2ª pessoa do imperativo (ex.: "Seja direto e técnico, evite rodeios.").
Regras:
- Máximo {max_chars} caracteres.
- Mantenha o sentido e o tom pretendidos pelo usuário, só remova redundância e enrolação.
- Não use aspas, markdown ou explicações — retorne só a instrução final.

Descrição original do usuário:
{text}
"""
        result = groq_complete(prompt, max_tokens=120)
        if result:
            optimized = result.strip().strip('"').strip("'").replace("\n", " ").strip()
            if 0 < len(optimized) <= max_chars:
                return OptimizePersonalityResponse(optimized=optimized, source="groq")

    # Fallback local: normaliza espaços e corta no limite de caracteres
    fallback = " ".join(text.split())
    if len(fallback) > max_chars:
        fallback = fallback[: max_chars - 1].rstrip() + "…"
    return OptimizePersonalityResponse(optimized=fallback, source="fallback")


@app.get("/health")
async def health_check():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=False
    )