# app/main.py
#
# Ponto de entrada do microsservico Python (FastAPI).
# Centraliza a aplicacao, middleware CORS, registro de rotas
# e endpoints utilitarios que nao se encaixam em modulos de dominio.
#
# Servicos oferecidos:
#   - Voz: transcricao de audio via Whisper (Groq)
#   - Arquivos: extracao de texto de PDF, TXT, CSV e outros formatos
#   - Embeddings: geracao de vetores para busca semantica
#   - Busca RAG: recuperacao de chunks relevantes por similaridade de cosseno
#   - Memorias: extracao e sintese automatica de memorias
#   - Historico: condensacao de conversas longas
#   - Titulo: geracao automatica de titulo de chat
#   - Intencao: classificacao da intencao da mensagem do usuario
#
# Endpoints locais (nao delegados a routers):
#   - /embeddings/batch: geracao de embeddings em lote
#   - /tools/condense-chunk: condensacao de chunk por heuristica
#   - /tools/optimize-personality: reescrita compacta de personalidade
#   - /health: health check para monitoramento e keep-alive
#
# Agrupamento logico:
#   1. Configuracao da aplicacao e middleware
#   2. Registro de routers de dominio
#   3. Endpoint de embeddings em lote
#   4. Endpoint de condensacao de chunk
#   5. Endpoint de otimizacao de personalidade
#   6. Health check e inicializacao

import os
import re
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from app.routers import voice, files, embeddings, search, memories, history, title, intent
from app.ml_models import get_embedder
from app.utils.groq_client import groq_available, groq_complete

load_dotenv()

# ---------------------------------------------------------------------------
# 1. CONFIGURACAO DA APLICACAO E MIDDLEWARE
# ---------------------------------------------------------------------------

app = FastAPI(title="Solaris Python Microservice", version="1.0.0")

# Origens permitidas para CORS: frontend (Vercel) e backend Node (Render).
# Necessario pois o navegador faz chamadas diretas ao microsservico em alguns fluxos.
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
NODE_URL = os.getenv("NODE_URL", "http://localhost:3001")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, NODE_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# 2. REGISTRO DE ROUTERS DE DOMINIO
# ---------------------------------------------------------------------------

# Cada router encapsula um dominio especifico do microsservico.
# O prefixo determina a URL base: /voice, /files, /embeddings, etc.
# A tag agrupa os endpoints na documentacao automatica do FastAPI (Swagger).

app.include_router(voice.router, prefix="/voice", tags=["voice"])
app.include_router(files.router, prefix="/files", tags=["files"])
app.include_router(embeddings.router, prefix="/embeddings", tags=["embeddings"])
app.include_router(search.router, prefix="/search", tags=["search"])
app.include_router(memories.router, prefix="/memories", tags=["memories"])
app.include_router(history.router, prefix="/history", tags=["history"])
app.include_router(title.router, prefix="/title", tags=["title"])
app.include_router(intent.router, prefix="/intent", tags=["intent"])

# ---------------------------------------------------------------------------
# 3. ENDPOINT DE EMBEDDINGS EM LOTE
# ---------------------------------------------------------------------------

# Modelos Pydantic para validacao da requisicao e resposta.
# Mantidos localmente por serem usados apenas neste endpoint.

class BatchEmbeddingsRequest(BaseModel):
    texts: list[str]


class BatchEmbeddingsResponse(BaseModel):
    embeddings: list[list[float]]


@app.post("/embeddings/batch", response_model=BatchEmbeddingsResponse)
async def batch_embeddings(req: BatchEmbeddingsRequest):
    """
    Gera embeddings para uma lista de textos em uma unica chamada.
    
    Usa o metodo encode() nativo do SentenceTransformer com convert_to_numpy=True,
    que e significativamente mais rapido que chamadas individuais para cada texto
    (aproveita paralelismo interno e evita overhead de multiple chamadas HTTP).
    
    Chamado pelo backend Node durante indexacao de arquivos, fontes e memorias.
    Retorna uma lista de vetores de 384 dimensoes (all-MiniLM-L6-v2).
    """
    if not req.texts:
        raise HTTPException(status_code=400, detail="Text list is empty.")
    try:
        embedder = get_embedder()
        # encode em lote: processa todos os textos de uma vez
        embeddings = embedder.encode(req.texts, convert_to_numpy=True)
        # Converte arrays numpy para listas Python (serializavel em JSON)
        return {"embeddings": [emb.tolist() for emb in embeddings]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating embeddings: {str(e)}")

# ---------------------------------------------------------------------------
# 4. ENDPOINT DE CONDENSACAO DE CHUNK
# ---------------------------------------------------------------------------

# Palavras-chave usadas para identificar a sentenca mais relevante
# quando um chunk excede o limite de caracteres.
# Funciona como um mini-resumo heuristico: prioriza sentencas que
# contem termos de conclusao, importancia ou causalidade.
_CONDENSE_KEYWORDS = [
    "porque", "assim", "portanto", "consequentemente", "resultado",
    "conclusao", "importante", "critico", "essencial", "fundamental",
    "key", "important", "therefore", "conclusion", "result", "critical",
]

# Expressao regular para dividir texto em sentencas.
# Busca pontuacao final (. ! ?) seguida de espaco.
_SENTENCE_SPLIT = re.compile(r'(?<=[.!?])\s+')


class CondenseChunkRequest(BaseModel):
    chunk: str
    max_chars: int = 200


class CondenseChunkResponse(BaseModel):
    condensed: str


@app.post("/tools/condense-chunk", response_model=CondenseChunkResponse)
async def condense_chunk(req: CondenseChunkRequest):
    """
    Condensa um chunk de texto para no maximo max_chars caracteres.
    
    Estrategia de condensacao:
    1. Se o texto ja cabe no limite, retorna integral.
    2. Divide em sentencas e procura por palavras-chave de relevancia.
    3. Se encontrar sentenca com palavra-chave, retorna ela (truncada se necessario).
    4. Caso contrario, retorna a maior sentenca (fallback pragmatico).
    
    Usado internamente para reduzir chunks muito longos antes de envia-los
    ao modelo, economizando tokens sem perder a ideia central.
    """
    text = req.chunk.strip()
    max_chars = req.max_chars

    # Caso simples: texto ja esta dentro do limite
    if len(text) <= max_chars:
        return {"condensed": text}

    # Divide em sentencas mantendo a pontuacao original
    sentences = _SENTENCE_SPLIT.split(text)
    if not sentences:
        return {"condensed": text[:max_chars] + "..."}

    # Busca sentenca com palavra-chave de relevancia
    for sent in sentences:
        if any(kw in sent.lower() for kw in _CONDENSE_KEYWORDS):
            if len(sent) > max_chars:
                sent = sent[:max_chars] + "..."
            return {"condensed": sent.strip()}

    # Fallback: retorna a sentenca mais longa (provavelmente a mais informativa)
    best = max(sentences, key=len)
    if len(best) > max_chars:
        best = best[:max_chars] + "..."
    return {"condensed": best.strip()}

# ---------------------------------------------------------------------------
# 5. ENDPOINT DE OTIMIZACAO DE PERSONALIDADE
# ---------------------------------------------------------------------------

class OptimizePersonalityRequest(BaseModel):
    text: str
    max_chars: int = 280


class OptimizePersonalityResponse(BaseModel):
    optimized: str
    source: str  # "groq" para IA, "fallback" para normalizacao local


@app.post("/tools/optimize-personality", response_model=OptimizePersonalityResponse)
async def optimize_personality(req: OptimizePersonalityRequest):
    """
    Reescreve uma descricao de personalidade em texto livre (fornecida pelo
    usuario ao criar/editar um projeto) como uma instrucao de sistema compacta.
    
    Por que isso existe:
    - O texto da personalidade entra no system prompt de TODA mensagem do projeto
    - Texto livre tende a ser verboso, com redundancias e explicacoes desnecessarias
    - Reescrever de forma compacta economiza tokens em cada chamada ao modelo
    
    Fluxo em cascata:
    1. Se Groq estiver disponivel, usa um prompt especializado para reescrever
       o texto como instrucao imperativa na 2a pessoa, maximo max_chars caracteres.
    2. Se Groq falhar ou estiver indisponivel, aplica fallback local:
       normaliza espacos e trunca no limite (garante que a criacao do projeto
       nunca seja bloqueada por indisponibilidade deste servico).
    
    O campo "source" na resposta indica qual estrategia foi usada,
    permitindo ao frontend decidir se mostra ou nao um indicador de "otimizado por IA".
    """
    text = req.text.strip()
    max_chars = req.max_chars

    # Texto vazio: retorna imediatamente (projeto sem personalidade customizada)
    if not text:
        return OptimizePersonalityResponse(optimized="", source="fallback")

    # Tenta otimizacao via Groq (IA)
    if groq_available():
        prompt = f"""Reescreva a descricao de personalidade abaixo como uma instrucao de sistema direta e objetiva para um assistente de IA, na 2a pessoa do imperativo (ex.: "Seja direto e tecnico, evite rodeios.").
Regras:
- Maximo {max_chars} caracteres.
- Mantenha o sentido e o tom pretendidos pelo usuario, so remova redundancia e enrolacao.
- Nao use aspas, markdown ou explicacoes - retorne so a instrucao final.

Descricao original do usuario:
{text}
"""
        result = groq_complete(prompt, max_tokens=120)
        if result:
            # Limpa artefatos comuns da resposta do modelo
            optimized = result.strip().strip('"').strip("'").replace("\n", " ").strip()
            # So aceita se o resultado for valido (nao vazio e dentro do limite)
            if 0 < len(optimized) <= max_chars:
                return OptimizePersonalityResponse(optimized=optimized, source="groq")

    # Fallback local: normalizacao simples (colapsa espacos multiplos)
    # Nao altera o significado, apenas remove espacos extras e trunca
    fallback = " ".join(text.split())
    if len(fallback) > max_chars:
        fallback = fallback[: max_chars - 1].rstrip() + "..."
    return OptimizePersonalityResponse(optimized=fallback, source="fallback")

# ---------------------------------------------------------------------------
# 6. HEALTH CHECK E INICIALIZACAO
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check():
    """
    Health check simples.
    Usado por:
    - Render para verificar se o servico esta no ar
    - Cron jobs de keep-alive para evitar cold start no plano gratuito
    - Monitoramento externo (UptimeRobot, etc.)
    """
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=False)