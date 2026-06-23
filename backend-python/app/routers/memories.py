"""
app/routers/memories.py
---
Extracao e sintese de memorias.

Dois fluxos principais:

  1. EXTRACAO (/extract)
     Recebe o texto completo da resposta do assistente e extrai ate 2
     memorias relevantes (decisoes, padroes, aprendizados, preferencias).
     Usa Groq (IA) quando disponivel; fallback para heuristica com spaCy.

  2. SINTESE (/synthesize)
     Recebe uma consulta (mensagem atual do usuario) e uma lista de memorias
     pre-existentes do projeto/chat. Classifica por similaridade de cosseno,
     seleciona as mais relevantes e sintetiza em um unico paragrafo.

     Otimizacao de backfill:
     Memorias antigas podem chegar sem embedding (criadas antes da coluna
     embedding_v existir). Nesse caso, o embedding e computado aqui uma
     unica vez e devolvido em computed_embeddings para o backend Node
     persistir. Memorias ja com embedding pulam essa etapa, evitando
     recomputacao desnecessaria.

Agrupamento logico:
  1. Palavras-chave e modelos Pydantic
  2. Funcoes auxiliares de extracao (spaCy e Groq)
  3. Endpoint de extracao de memorias
  4. Endpoint de sintese de memorias
"""
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.ml_models import get_embedder, get_nlp
from app.utils.groq_client import groq_available, groq_complete
from app.utils.math_utils import cosine_similarity

router = APIRouter()

# ---------------------------------------------------------------------------
# 1. PALAVRAS-CHAVE E MODELOS PYDANTIC
# ---------------------------------------------------------------------------

# Palavras-chave para extracao baseada em spaCy (fallback quando Groq
# esta indisponivel). A heuristica procura sentencas que contenham
# termos de decisao, obrigacao, aprendizado ou tecnologia.
#
# Criterios de selecao:
#   - Sentenca deve conter pelo menos uma destas palavras-chave
#   - Tamanho entre 40 e 300 caracteres (nem muito curta, nem muito longa)
#   - Maximo 2 memorias extraidas por resposta
_KEYWORDS = [
    "sempre", "nunca", "precisa", "deve", "e importante", "importante",
    "definimos", "decidimos", "concluimos", "aprendemos", "descobrimos",
    "padrao", "arquitetura", "stack", "tecnologia", "framework",
    "biblioteca", "banco de dados", "configuracao", "estrutura",
    "convencao", "fluxo", "pipeline", "processo", "regra",
]

# ---------------------------------------------------------------------------
# 2. FUNCOES AUXILIARES DE EXTRACAO
# ---------------------------------------------------------------------------

class MemoryExtractRequest(BaseModel):
    text: str


def _extract_with_spacy(text: str) -> list[str]:
    """
    Extracao de memorias por heuristica de palavras-chave com spaCy.

    Fluxo:
    1. Processa o texto com o pipeline spaCy (tokenizacao + segmentacao)
    2. Itera sobre as sentencas detectadas
    3. Filtra por: tamanho entre 40 e 300 caracteres E presenca de
       pelo menos uma palavra-chave da lista _KEYWORDS
    4. Retorna no maximo 2 candidatas (ordem de aparicao no texto)

    Limitacoes conhecidas:
    - Nao entende contexto ou relevancia semantica real
    - Pode perder memorias importantes que nao contenham palavras-chave
    - Pode capturar sentencas irrelevantes que contenham palavras-chave
      por coincidencia

    Usado apenas como fallback quando Groq esta indisponivel.
    """
    nlp = get_nlp()
    doc = nlp(text)
    candidates = [
        sent.text.strip()
        for sent in doc.sents
        if 40 <= len(sent.text.strip()) <= 300
        and any(kw in sent.text.lower() for kw in _KEYWORDS)
    ]
    # Limita a 2 memorias para nao poluir o contexto com informacao redundante
    return candidates[:2]


def _extract_with_groq(text: str) -> list[str] | None:
    """
    Extracao de memorias via Groq (modelo de linguagem).

    Usa um prompt especializado que instrui o modelo a:
    - Identificar informacoes importantes, decisoes, padroes ou aprendizados
    - Retornar APENAS um array JSON valido com ate 2 strings
    - Cada string entre 40 e 300 caracteres

    Validacoes aplicadas ao resultado:
    - JSON sintaticamente valido
    - Tipo array de strings
    - Cada elemento com tamanho entre 40 e 300 caracteres
    - Maximo 2 elementos

    Returns:
        list[str] | None: Lista de memorias extraidas, ou None se:
        - Groq nao estiver configurado (groq_available() = False)
        - A chamada API falhar
        - O resultado nao for JSON valido
        - O resultado nao passar nas validacoes de formato
    """
    if not groq_available():
        return None

    prompt = f"""Extraia ate 2 memorias relevantes do texto abaixo. Cada memoria deve ser uma frase curta (entre 40 e 300 caracteres) que capture uma informacao importante, decisao, padrao ou aprendizado.

Retorne APENAS um JSON no formato: ["memoria 1", "memoria 2"]

Texto:
{text}
"""
    result = groq_complete(prompt, max_tokens=250)
    if not result:
        return None
    try:
        parsed = json.loads(result)
        if isinstance(parsed, list) and all(isinstance(item, str) for item in parsed):
            # Filtra por tamanho mesmo apos Groq, como camada extra de seguranca
            return [m for m in parsed if 40 <= len(m) <= 300][:2]
    except json.JSONDecodeError:
        # Modelo ocasionalmente retorna texto livre em vez de JSON;
        # nesse caso, retorna None para cair no fallback spaCy
        pass
    return None


# ---------------------------------------------------------------------------
# 3. ENDPOINT DE EXTRACAO DE MEMORIAS
# ---------------------------------------------------------------------------

@router.post("/extract")
async def extract_memories(request: MemoryExtractRequest):
    """
    Extrai ate 2 memorias relevantes do texto fornecido.

    Chamado pelo backend Node apos cada resposta do assistente
    (em background, sem bloquear a resposta ao usuario).

    Estrategia em cascata:
    1. Tenta extracao via Groq (IA) - mais precisa, entende contexto
    2. Se Groq falhar ou estiver indisponivel, usa fallback spaCy
       (heuristica de palavras-chave)

    Memorias extraidas sao salvas no banco com embedding e vinculadas
    ao projeto (ou chat avulso). Duplicatas sao filtradas por
    similaridade de Jaccard antes da insercao.
    """
    text = request.text.strip()
    if not text:
        return []
    result = _extract_with_groq(text)
    return result if result is not None else _extract_with_spacy(text)


# ---------------------------------------------------------------------------
# 4. ENDPOINT DE SINTESE DE MEMORIAS
# ---------------------------------------------------------------------------

class MemoryItem(BaseModel):
    id: str
    content: str
    # Embedding persistido no banco (pode ser None para memorias antigas
    # criadas antes do backfill de embeddings existir).
    # Memorias sem embedding sao re-codificadas aqui e devolvidas em
    # computed_embeddings para o Node persistir de volta.
    embedding: list[float] | None = None


class SynthesisRequest(BaseModel):
    query: str
    memories: list[MemoryItem]


class SynthesisResponse(BaseModel):
    synthesis: str
    used_memory_ids: list[str]
    # Mapeamento id -> embedding, apenas para memorias que chegaram sem
    # embedding persistido e precisaram ser computadas aqui.
    # O Node usa isso para fazer backfill e garantir que cada memoria
    # seja codificada apenas uma vez em todo seu ciclo de vida.
    computed_embeddings: dict[str, list[float]] = {}


@router.post("/synthesize", response_model=SynthesisResponse)
async def synthesize_memories(request: SynthesisRequest):
    """
    Sintetiza memorias relevantes em um paragrafo coeso para injecao
    no system prompt da conversa.

    Fluxo completo:
    1. Se nao houver memorias, retorna vazio imediatamente
    2. Gera embedding da consulta (mensagem atual do usuario)
    3. Identifica memorias sem embedding persistido e gera embeddings
       para elas em lote (uma unica chamada ao SentenceTransformer)
    4. Calcula similaridade de cosseno entre consulta e cada memoria
    5. Filtra memorias com score > 0.4 e seleciona as top 8
    6. Se Groq disponivel: sintetiza as memorias em um paragrafo via IA
    7. Fallback: extrai as 5 sentencas mais longas das memorias top
       e as concatena (abordagem pragmatica, mantem os fatos originais)

    Otimizacao de backfill:
    - Memorias SEM embedding: codificadas em lote aqui e devolvidas
      em computed_embeddings para persistencia
    - Memorias COM embedding: usadas diretamente, sem recomputacao
    - Isso garante que cada texto de memoria passe pelo encoder
      exatamente uma vez em todo seu ciclo de vida
    """
    if not request.memories:
        return SynthesisResponse(synthesis="", used_memory_ids=[], computed_embeddings={})

    embedder = get_embedder()

    # Gera embedding da consulta (pergunta atual do usuario)
    query_emb = embedder.encode(request.query, convert_to_numpy=True)

    # Re-codifica apenas memorias que chegaram sem embedding persistido.
    # Usa encode em lote (mais eficiente que chamadas individuais).
    missing = [mem for mem in request.memories if mem.embedding is None]
    computed_embeddings: dict[str, list[float]] = {}
    if missing:
        fresh = embedder.encode([mem.content for mem in missing], convert_to_numpy=True)
        for mem, emb in zip(missing, fresh):
            computed_embeddings[mem.id] = emb.tolist()

    def embedding_for(mem: MemoryItem) -> list[float]:
        """Resolve o embedding de uma memoria: persistido ou computado na hora."""
        return mem.embedding if mem.embedding is not None else computed_embeddings[mem.id]

    # Classifica memorias por similaridade de cosseno com a consulta.
    # Filtra score minimo de 0.4 para evitar injetar informacao irrelevante.
    # Seleciona top 8 para manter o contexto enxuto.
    scored = sorted(
        (
            (cosine_similarity(query_emb, embedding_for(mem)), mem)
            for mem in request.memories
            if cosine_similarity(query_emb, embedding_for(mem)) > 0.4
        ),
        key=lambda x: x[0],
        reverse=True,
    )
    top_memories = scored[:8]

    if not top_memories:
        return SynthesisResponse(synthesis="", used_memory_ids=[], computed_embeddings=computed_embeddings)

    # Caminho preferencial: sintese via Groq (IA)
    if groq_available():
        mem_lines = "\n".join(f"- {mem.content}" for _, mem in top_memories)
        prompt = f"""Abaixo estao algumas memorias relevantes para a pergunta do usuario.

Pergunta: {request.query}

Memorias:
{mem_lines}

Sintetize essas memorias em um unico paragrafo coeso, em terceira pessoa, com no maximo 5 frases, focando no que e relevante para a pergunta.
Retorne apenas o paragrafo, sem introducao ou conclusao.
"""
        groq_result = groq_complete(prompt, max_tokens=300)
        if groq_result and 50 <= len(groq_result) <= 400:
            return SynthesisResponse(
                synthesis=groq_result,
                used_memory_ids=[mem.id for _, mem in top_memories],
                computed_embeddings=computed_embeddings,
            )

    # Fallback: sintese baseada em spaCy (sem IA).
    # Extrai sentencas individuais das memorias top, ordena por tamanho
    # decrescente e pega as 5 maiores. Abordagem simples mas preserva
    # os fatos originais sem risco de alucinacao.
    nlp = get_nlp()
    all_sentences: list[str] = []
    for _, mem in top_memories:
        doc = nlp(mem.content)
        all_sentences.extend(
            sent.text.strip() for sent in doc.sents if len(sent.text.strip()) > 20
        )

    # Sentencas mais longas tendem a conter mais informacao contextual
    top_sentences = sorted(all_sentences, key=len, reverse=True)[:5]
    return SynthesisResponse(
        synthesis=" ".join(top_sentences),
        used_memory_ids=[mem.id for _, mem in top_memories],
        computed_embeddings=computed_embeddings,
    )