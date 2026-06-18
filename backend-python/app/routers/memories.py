import os
import spacy
import json
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from typing import List, Optional

# Importa o cliente Groq
from app.utils.groq_client import groq_available, groq_complete

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

# Palavras-chave para extração de memórias (fallback com spaCy)
KEYWORDS = [
    "sempre", "nunca", "precisa", "deve", "é importante", "importante",
    "definimos", "decidimos", "concluímos", "aprendemos", "descobrimos",
    "padrão", "arquitetura", "stack", "tecnologia", "framework",
    "biblioteca", "banco de dados", "configuração", "estrutura",
    "convenção", "fluxo", "pipeline", "processo", "regra"
]

# --- Extração de memórias com fallback Groq ---------------------------------
class MemoryExtractRequest(BaseModel):
    text: str

def extract_with_spacy(text: str) -> List[str]:
    """Extração tradicional com spaCy e palavras-chave."""
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

def extract_with_groq(text: str) -> Optional[List[str]]:
    """Extrai memórias usando Groq. Retorna None em caso de falha."""
    if not groq_available():
        return None

    prompt = f"""
Extraia até 2 memórias relevantes do texto abaixo. Cada memória deve ser uma frase curta (entre 40 e 300 caracteres) que capture uma informação importante, decisão, padrão ou aprendizado.

Retorne APENAS um JSON no formato: ["memória 1", "memória 2"]

Texto:
{text}
"""
    result = groq_complete(prompt, max_tokens=250)
    if not result:
        return None

    # Tenta parsear JSON
    try:
        parsed = json.loads(result)
        if isinstance(parsed, list) and all(isinstance(item, str) for item in parsed):
            # Filtra por tamanho
            filtered = [m for m in parsed if 40 <= len(m) <= 300]
            return filtered[:2]
    except json.JSONDecodeError:
        pass
    return None

@router.post("/extract")
async def extract_memories(request: MemoryExtractRequest):
    """Recebe um texto, extrai até 2 memórias relevantes.
    Usa Groq se disponível, senão fallback para spaCy."""
    text = request.text.strip()
    if not text:
        return []

    # Tenta Groq primeiro
    groq_result = extract_with_groq(text)
    if groq_result is not None:
        return groq_result

    # Fallback para spaCy
    return extract_with_spacy(text)

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

    # Se Groq disponível, tenta síntese generativa
    if groq_available():
        mem_texts = [f"- {mem.content}" for _, mem in top_memories]
        prompt = f"""
Abaixo estão algumas memórias relevantes para a pergunta do usuário.

Pergunta: {request.query}

Memórias:
{chr(10).join(mem_texts)}

Sintetize essas memórias em um único parágrafo coeso, em terceira pessoa, com no máximo 5 frases, focando no que é relevante para a pergunta.
Retorne apenas o parágrafo, sem introdução ou conclusão.
"""
        groq_result = groq_complete(prompt, max_tokens=300)
        if groq_result and 50 <= len(groq_result) <= 400:
            used_ids = [mem.id for _, mem in top_memories]
            return SynthesisResponse(synthesis=groq_result, used_memory_ids=used_ids)

    # Fallback: extração com spaCy
    all_sentences = []
    for _, mem in top_memories:
        doc = nlp(mem.content)
        for sent in doc.sents:
            sent_text = sent.text.strip()
            if len(sent_text) > 20:
                all_sentences.append(sent_text)

    if len(all_sentences) > 5:
        all_sentences.sort(key=len, reverse=True)
        all_sentences = all_sentences[:5]

    synthesis = " ".join(all_sentences)
    used_ids = [mem.id for _, mem in top_memories]

    return SynthesisResponse(synthesis=synthesis, used_memory_ids=used_ids)