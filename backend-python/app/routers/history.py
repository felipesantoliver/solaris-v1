from fastapi import APIRouter
from pydantic import BaseModel
from typing import List

from app.ml_models import get_embedder, get_nlp
from app.utils.groq_client import groq_available, groq_complete
from app.utils.math_utils import cosine_similarity

router = APIRouter()


class Message(BaseModel):
    role: str  # "user" ou "assistant"
    content: str


class HistorySynthesisRequest(BaseModel):
    messages: List[Message]
    keep_last: int = 10


class HistorySynthesisResponse(BaseModel):
    summary: str
    recent_messages: List[Message]


def cluster_messages(messages, threshold=0.75):
    """Agrupa mensagens por similaridade de embedding."""
    if not messages:
        return []

    embedder = get_embedder()
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


def summarize_cluster_spacy(cluster_messages):
    """Gera um parágrafo resumo para um cluster de mensagens usando spaCy."""
    nlp = get_nlp()
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

    summary = ""

    if groq_available():
        full_older_text = "\n".join([f"{m.role}: {m.content}" for m in older])
        prompt = f"""
Resuma o seguinte histórico de conversa de forma fluida, em no máximo 5 linhas, preservando decisões, conclusões e contexto técnico.

Histórico:
{full_older_text}

Retorne apenas o resumo, sem introdução ou conclusão.
"""
        groq_result = groq_complete(prompt, max_tokens=300)
        if groq_result and 100 <= len(groq_result) <= 600:
            summary = groq_result
        else:
            cluster_summaries = [summarize_cluster_spacy(cluster) for cluster in clusters if cluster]
            if cluster_summaries:
                summary = "Resumo do histórico anterior:\n" + "\n".join(cluster_summaries)
    else:
        cluster_summaries = [summarize_cluster_spacy(cluster) for cluster in clusters if cluster]
        if cluster_summaries:
            summary = "Resumo do histórico anterior:\n" + "\n".join(cluster_summaries)

    return HistorySynthesisResponse(summary=summary, recent_messages=recent)