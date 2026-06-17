import os
import spacy
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

# Carrega o modelo spaCy (português ou inglês como fallback)
try:
    nlp = spacy.load("pt_core_news_sm")
except OSError:
    # Fallback para inglês se o modelo pt não estiver disponível
    try:
        nlp = spacy.load("en_core_web_sm")
    except OSError:
        raise RuntimeError("Modelo spaCy não encontrado. Execute: python -m spacy download pt_core_news_sm")

# Palavras-chave para identificar sentenças que podem ser memórias relevantes
KEYWORDS = [
    "sempre", "nunca", "precisa", "deve", "é importante", "importante",
    "definimos", "decidimos", "concluímos", "aprendemos", "descobrimos",
    "padrão", "arquitetura", "stack", "tecnologia", "framework",
    "biblioteca", "banco de dados", "configuração", "estrutura",
    "convenção", "fluxo", "pipeline", "processo", "regra"
]

class MemoryExtractRequest(BaseModel):
    text: str

@router.post("/extract")
async def extract_memories(request: MemoryExtractRequest):
    """
    Recebe um texto, divide em sentenças, filtra por palavras-chave
    e retorna as sentenças candidatas (entre 40 e 300 caracteres).
    """
    text = request.text.strip()
    if not text:
        return []

    # Processa com spaCy
    doc = nlp(text)

    candidates = []
    for sent in doc.sents:
        sent_text = sent.text.strip()
        # Filtra por tamanho
        if len(sent_text) < 40 or len(sent_text) > 300:
            continue

        # Verifica se contém alguma palavra-chave (case insensitive)
        lower = sent_text.lower()
        if any(kw in lower for kw in KEYWORDS):
            candidates.append(sent_text)

    # Retorna no máximo 2 sentenças (para evitar excesso)
    return candidates[:2]