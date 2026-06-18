import os
import spacy
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from typing import List, Optional

router = APIRouter()

# Carrega modelos (uma única vez)
MODEL_NAME = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
embedder = SentenceTransformer(MODEL_NAME)

try:
    nlp = spacy.load("pt_core_news_sm")
except OSError:
    try:
        nlp = spacy.load("en_core_web_sm")
    except OSError:
        raise RuntimeError("Modelo spaCy não encontrado. Execute: python -m spacy download pt_core_news_sm")

# Palavras-chave para extração de memórias (já existente)
KEYWORDS = [
    "sempre", "nunca", "precisa", "deve", "é importante", "importante",
    "definimos", "decidimos", "concluímos", "aprendemos", "descobrimos",
    "padrão", "arquitetura", "stack", "tecnologia", "framework",
    "biblioteca", "banco de dados", "configuração", "estrutura",
    "convenção", "fluxo", "pipeline", "processo", "regra"
]

# --- Extração de memórias (já existente) ------------------------------------
class MemoryExtractRequest(BaseModel):
    text: str

@router.post("/extract")
async def extract_memories(request: MemoryExtractRequest):
    """Recebe um texto, divide em sentenças, filtra por palavras-chave e retorna candidatas."""
    text = request.text.strip()
    if not text:
        return []

    doc = nlp(text)
    candidates = []
    for sent in doc.sents:
        sent_text = sent.text.strip()
        if len(sent_text) < 40 or len(sent_text) > 300:
            continue
        lower = sent_text.lower()
        if any(kw in lower for kw in KEYWORDS):
            candidates.append(sent_text)

    return candidates[:2]

# --- Síntese de memórias (NOVO) ---------------------------------------------
class MemoryItem(BaseModel):
    id: str
    content: str

class SynthesisRequest(BaseModel):
    query: str
    memories: List[MemoryItem]

class SynthesisResponse(BaseModel):
    synthesis: str
    used_memory_ids: List[str]

def cosine_similarity(a, b):
    a = np.array(a)
    b = np.array(b)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8)

@router.post("/synthesize", response_model=SynthesisResponse)
async def synthesize_memories(request: SynthesisRequest):
    if not request.memories:
        return SynthesisResponse(synthesis="", used_memory_ids=[])

    # Gera embedding da query
    query_emb = embedder.encode(request.query, convert_to_numpy=True)

    # Calcula similaridade para cada memória
    scored = []
    for mem in request.memories:
        mem_emb = embedder.encode(mem.content, convert_to_numpy=True)
        sim = cosine_similarity(query_emb, mem_emb)
        if sim > 0.4:
            scored.append((sim, mem))

    # Ordena e pega top 8
    scored.sort(key=lambda x: x[0], reverse=True)
    top_memories = scored[:8]

    if not top_memories:
        return SynthesisResponse(synthesis="", used_memory_ids=[])

    # Extrai sentenças representativas usando spaCy
    all_sentences = []
    for _, mem in top_memories:
        doc = nlp(mem.content)
        for sent in doc.sents:
            sent_text = sent.text.strip()
            if len(sent_text) > 20:
                all_sentences.append(sent_text)

    # Se muitas sentenças, pega as 5 mais longas
    if len(all_sentences) > 5:
        all_sentences.sort(key=len, reverse=True)
        all_sentences = all_sentences[:5]

    synthesis = " ".join(all_sentences)
    used_ids = [mem.id for _, mem in top_memories]

    return SynthesisResponse(synthesis=synthesis, used_memory_ids=used_ids)