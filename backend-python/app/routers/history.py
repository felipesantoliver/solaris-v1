import os
import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import spacy
from typing import List, Dict, Any
from collections import defaultdict

router = APIRouter()

# Carrega modelos
MODEL_NAME = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
embedder = SentenceTransformer(MODEL_NAME)

try:
    nlp = spacy.load("pt_core_news_sm")
except OSError:
    try:
        nlp = spacy.load("en_core_web_sm")
    except OSError:
        raise RuntimeError("Modelo spaCy não encontrado.")

class Message(BaseModel):
    role: str  # "user" ou "assistant"
    content: str

class HistorySynthesisRequest(BaseModel):
    messages: List[Message]
    keep_last: int = 10

class HistorySynthesisResponse(BaseModel):
    summary: str
    recent_messages: List[Message]

def cosine_similarity(a, b):
    a = np.array(a)
    b = np.array(b)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8)

def cluster_messages(messages, threshold=0.75):
    """Agrupa mensagens por similaridade de embedding."""
    if not messages:
        return []

    texts = [m.content for m in messages]
    embeddings = embedder.encode(texts, convert_to_numpy=True)

    clusters = []
    current_cluster = [0]
    for i in range(1, len(messages)):
        sim = cosine_similarity(embeddings[i], embeddings[current_cluster[-1]])
        if sim > threshold:
            current_cluster.append(i)
        else:
            clusters.append(current_cluster)
            current_cluster = [i]
    if current_cluster:
        clusters.append(current_cluster)

    return [[messages[i] for i in cluster] for cluster in clusters]

def summarize_cluster(cluster_messages):
    """Gera um parágrafo resumo para um cluster de mensagens."""
    full_text = " ".join([m.content for m in cluster_messages])
    doc = nlp(full_text)

    sentences = [sent.text.strip() for sent in doc.sents if len(sent.text.strip()) > 20]
    sentences.sort(key=len, reverse=True)
    top_sentences = sentences[:3]

    if top_sentences:
        return " ".join(top_sentences)
    else:
        return full_text[:200] + ("..." if len(full_text) > 200 else "")

@router.post("/synthesize", response_model=HistorySynthesisResponse)
async def synthesize_history(request: HistorySynthesisRequest):
    if not request.messages:
        return HistorySynthesisResponse(summary="", recent_messages=[])

    keep_last = min(request.keep_last, len(request.messages))
    recent = request.messages[-keep_last:]
    older = request.messages[:-keep_last] if len(request.messages) > keep_last else []

    if not older:
        return HistorySynthesisResponse(summary="", recent_messages=recent)

    clusters = cluster_messages(older, threshold=0.75)
    cluster_summaries = [summarize_cluster(cluster) for cluster in clusters if cluster]

    if cluster_summaries:
        summary = "Resumo do histórico anterior:\n" + "\n".join(cluster_summaries)
    else:
        summary = ""

    return HistorySynthesisResponse(summary=summary, recent_messages=recent)