from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from app.utils.groq_client import groq_available, groq_complete

router = APIRouter()

class TitleRequest(BaseModel):
    message: str

class TitleResponse(BaseModel):
    title: Optional[str]
    source: str  # "groq" ou "fallback"

@router.post("/generate", response_model=TitleResponse)
async def generate_title(request: TitleRequest):
    if not request.message.strip():
        return TitleResponse(title=None, source="fallback")

    if groq_available():
        prompt = f"""
Crie um título curto e descritivo (máximo 8 palavras, sem aspas, sem ponto final) para uma conversa que começa com a seguinte mensagem do usuário:

"{request.message}"

Retorne apenas o título, nada mais.
"""
        result = groq_complete(prompt, max_tokens=30)
        if result:
            # Limpeza básica
            title = result.strip().strip('"').strip("'")
            # Remove quebras de linha
            title = title.replace("\n", " ").strip()
            # Valida tamanho
            if 3 <= len(title) <= 60:
                return TitleResponse(title=title, source="groq")

    # Fallback
    return TitleResponse(title=None, source="fallback")