from fastapi import APIRouter
from pydantic import BaseModel
from typing import Literal

from app.utils.groq_client import groq_available, groq_complete

router = APIRouter()

class IntentRequest(BaseModel):
    query: str

class IntentResponse(BaseModel):
    intent: str  # "technical", "planning", "review", "continuation", "general"
    source: str  # "groq" ou "fallback"

@router.post("/classify", response_model=IntentResponse)
async def classify_intent(request: IntentRequest):
    if not request.query.strip():
        return IntentResponse(intent="general", source="fallback")

    if groq_available():
        prompt = f"""
Classifique a intenção da seguinte pergunta em exatamente uma das categorias abaixo:

- technical: perguntas sobre código, implementação, ferramentas, arquitetura, bugs, configuração
- planning: perguntas sobre estratégia, planejamento, decisões de produto, roadmap, prioridades
- review: perguntas que pedem revisão, crítica, análise de algo já feito
- continuation: perguntas que continuam um tópico anterior, sem mudança de assunto
- general: perguntas abertas, conceituais, ou que não se encaixam nas outras

Pergunta: "{request.query}"

Retorne APENAS a categoria (uma palavra).
"""
        result = groq_complete(prompt, max_tokens=10)
        if result:
            intent = result.strip().lower()
            valid_intents = {"technical", "planning", "review", "continuation", "general"}
            if intent in valid_intents:
                return IntentResponse(intent=intent, source="groq")

    # Fallback
    return IntentResponse(intent="general", source="fallback")