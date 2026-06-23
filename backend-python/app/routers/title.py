"""
app/routers/title.py
---
Geracao automatica de titulo para conversas.

Recebe a primeira mensagem do usuario e gera um titulo curto e descritivo
(ate 8 palavras). O titulo aparece na sidebar e facilita a navegacao
entre conversas.

Fluxo em cascata:
  1. Tenta gerar o titulo via Groq (llama3-8b-8192) com prompt especializado
  2. Se Groq falhar ou estiver indisponivel, retorna title=None
     (o backend Node entao gera o titulo localmente via generateLocalTitle,
     que extrai as primeiras 7 palavras da mensagem como fallback)

Por que o fallback retorna None em vez de gerar localmente?
  - Separacao de responsabilidades: este microsservico nao precisa
    implementar logica de fallback duplicada
  - O backend Node ja tem generateLocalTitle() como fallback final,
    que funciona sem dependencia externa
  - Manter o fallback no Node garante que a geracao de titulo funcione
    mesmo se o microsservico Python estiver fora do ar

Agrupamento logico:
  1. Modelos Pydantic
  2. Endpoint de geracao de titulo
"""
from fastapi import APIRouter
from pydantic import BaseModel

from app.utils.groq_client import groq_available, groq_complete

router = APIRouter()

# ---------------------------------------------------------------------------
# 1. MODELOS PYDANTIC
# ---------------------------------------------------------------------------

class TitleRequest(BaseModel):
    message: str


class TitleResponse(BaseModel):
    # Titulo gerado, ou None se a geracao falhou (o Node fara o fallback)
    title: str | None
    # Origem do titulo: "groq" para IA, "fallback" para indicar
    # que o Node deve usar generateLocalTitle()
    source: str


# ---------------------------------------------------------------------------
# 2. ENDPOINT DE GERACAO DE TITULO
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=TitleResponse)
async def generate_title(request: TitleRequest):
    """
    Gera um titulo curto e descritivo para uma nova conversa.

    Chamado pelo backend Node apos a primeira mensagem do usuario
    em uma conversa. O titulo e salvo no banco e exibido na sidebar.

    Criterios do titulo gerado:
    - Maximo 8 palavras
    - Sem aspas, sem ponto final, sem quebras de linha
    - Descritivo: captura o topico principal da mensagem
    - Exemplo: "Duvida sobre autenticacao JWT" em vez de "Ajuda"

    Validacoes aplicadas ao resultado do Groq:
    - Remove aspas duplas e simples
    - Remove quebras de linha
    - Verifica tamanho entre 3 e 60 caracteres
      (minimo 3: evita titulos como "OK" ou "AI";
       maximo 60: evita que o modelo ignore o limite de palavras)

    Comportamento de fallback:
    - Mensagem vazia: retorna title=None imediatamente
    - Groq indisponivel: retorna title=None (Node usa generateLocalTitle)
    - Groq retorna resultado invalido: retorna title=None (idem)
    - O Node SEMPRE tem um fallback funcional, entao o usuario nunca
      ve uma conversa sem titulo
    """
    if not request.message.strip():
        return TitleResponse(title=None, source="fallback")

    if groq_available():
        prompt = f"""Crie um titulo curto e descritivo (maximo 8 palavras, sem aspas, sem ponto final) para uma conversa que comeca com a seguinte mensagem do usuario:

"{request.message}"

Retorne apenas o titulo, nada mais.
"""
        result = groq_complete(prompt, max_tokens=30)
        if result:
            # Limpa artefatos comuns: aspas, quebras de linha, espacos extras
            title = result.strip().strip('"').strip("'").replace("\n", " ").strip()
            # So aceita titulos com tamanho razoavel (evita respostas truncadas
            # ou modelo que ignorou o prompt e gerou texto longo)
            if 3 <= len(title) <= 60:
                return TitleResponse(title=title, source="groq")

    # Fallback: retorna None para o Node gerar localmente
    return TitleResponse(title=None, source="fallback")