"""
app/routers/intent.py
---
Classificacao de intencao da consulta do usuario.

Analisa a mensagem do usuario e a classifica em uma de cinco categorias.
A intencao e usada pelo backend Node para ajustar o tom e o foco da
resposta do assistente (ex: resposta mais tecnica para "technical",
mais estrategica para "planning").

Categorias de intencao:

  technical     - Codigo, implementacao, ferramentas, arquitetura,
                  bugs, configuracao, debugging, sintaxe.
  planning      - Estrategia, planejamento, decisoes de produto,
                  roadmap, prioridades, proximos passos.
  review        - Revisao, critica, analise, code review,
                  auditoria de algo ja feito ou escrito.
  continuation  - Continuacao de topico anterior, sem mudanca
                  de assunto (ex: "pode explicar melhor?").
  general       - Perguntas abertas, conceituais, ou que nao se
                  encaixam claramente nas outras categorias.
                  Tambem usado como fallback.

Fluxo:
  1. Tenta classificar via Groq (llama3-8b-8192) com prompt que define
     cada categoria com exemplos
  2. Valida que o resultado e exatamente uma das 5 categorias validas
  3. Se Groq falhar, retornar resultado invalido ou estar indisponivel,
     retorna "general" como fallback seguro

Agrupamento logico:
  1. Constantes e modelos Pydantic
  2. Endpoint de classificacao de intencao
"""
from fastapi import APIRouter
from pydantic import BaseModel

from app.utils.groq_client import groq_available, groq_complete

router = APIRouter()

# ---------------------------------------------------------------------------
# 1. CONSTANTES E MODELOS PYDANTIC
# ---------------------------------------------------------------------------

# Conjunto de intencoes validas usado para validacao.
# Garante que mesmo se o modelo retornar uma categoria inventada,
# o sistema nunca propaga um valor invalido para o backend Node.
_VALID_INTENTS = {"technical", "planning", "review", "continuation", "general"}


class IntentRequest(BaseModel):
    query: str


class IntentResponse(BaseModel):
    # Categoria de intencao (uma das 5 definidas em _VALID_INTENTS)
    intent: str
    # Origem da classificacao:
    #   "groq"    - classificada pelo modelo de IA
    #   "fallback" - retornou "general" porque Groq nao estava disponivel
    #                ou retornou resultado invalido
    source: str


# ---------------------------------------------------------------------------
# 2. ENDPOINT DE CLASSIFICACAO DE INTENCAO
# ---------------------------------------------------------------------------

@router.post("/classify", response_model=IntentResponse)
async def classify_intent(request: IntentRequest):
    """
    Classifica a intencao da mensagem do usuario.

    Chamado pelo backend Node antes de montar o system prompt.
    A intencao permite que o Node adicione instrucoes contextuais
    como "Seja mais tecnico e use exemplos de codigo" quando a
    intencao for "technical".

    Estrategia de prompt:
    - Define cada categoria com exemplos concretos para o modelo
    - Pede APENAS a palavra da categoria (max_tokens=10 economiza)
    - Validacao rigorosa: so aceita valores em _VALID_INTENTS

    Por que o fallback e "general"?
    - E a categoria mais neutra e abrangente
    - Nao adiciona vies ao system prompt (nao restringe o tom)
    - Seguro: nunca piora a resposta por classificar errado
    - Estatisticamente, a maioria das consultas ja e "general"

    Cenarios de fallback:
    1. Mensagem vazia ou apenas espacos: retorna "general"
    2. Groq nao configurado (groq_available() = False): retorna "general"
    3. Groq retornou resposta vazia ou nula: retorna "general"
    4. Groq retornou categoria fora de _VALID_INTENTS: retorna "general"
       (ex: modelo alucinou "debugging" em vez de "technical")

    Em todos os casos, a resposta sempre tem intent="general" como
    garantia minima de funcionamento.
    """
    if not request.query.strip():
        return IntentResponse(intent="general", source="fallback")

    if groq_available():
        prompt = f"""Classifique a intencao da seguinte pergunta em exatamente uma das categorias abaixo:

- technical: perguntas sobre codigo, implementacao, ferramentas, arquitetura, bugs, configuracao
- planning: perguntas sobre estrategia, planejamento, decisoes de produto, roadmap, prioridades
- review: perguntas que pedem revisao, critica, analise de algo ja feito
- continuation: perguntas que continuam um topico anterior, sem mudanca de assunto
- general: perguntas abertas, conceituais, ou que nao se encaixam nas outras

Pergunta: "{request.query}"

Retorne APENAS a categoria (uma palavra).
"""
        result = groq_complete(prompt, max_tokens=10)
        if result:
            intent = result.strip().lower()
            # Validacao rigorosa: so aceita valores do conjunto conhecido
            if intent in _VALID_INTENTS:
                return IntentResponse(intent=intent, source="groq")

    # Fallback seguro: "general" e sempre valida e neutra
    return IntentResponse(intent="general", source="fallback")