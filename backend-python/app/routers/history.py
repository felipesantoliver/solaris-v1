"""
app/routers/history.py
---
Sintese de historico de conversas longas.

Quando uma conversa acumula muitas mensagens, as mais antigas (alem das
keep_last mais recentes) sao condensadas em um resumo. Esse resumo e
injetado no system prompt para que o modelo mantenha consciencia do
contexto historico sem consumir tokens com mensagens antigas na integra.

Dois caminhos de sintese:

  1. GROQ (preferencial)
     Envia o historico completo para um modelo de linguagem que gera
     um resumo fluido e coerente, preservando decisoes e contexto tecnico.
     Mais preciso, entende nuances e referencias cruzadas.

  2. CLUSTER + SPACY (fallback)
     Agrupa mensagens por similaridade semantica (cosseno > 0.75),
     depois extrai as 3 sentencas mais longas de cada cluster.
     Abordagem mais rudimentar, mas nao depende de API externa e
     nunca alucina informacao (apenas reorganiza texto existente).

Otimizacao importante:
  O caminho de cluster + spaCy e intencionalmente "preguicoso"
  (lazy): so e executado quando Groq esta indisponivel ou retornou
  resposta invalida. No caminho feliz (Groq disponivel), nao ha custo
  de embeddings para clusterizacao.

Agrupamento logico:
  1. Modelos Pydantic
  2. Funcoes auxiliares de clusterizacao e sumarizacao
  3. Fallback (cluster + spaCy)
  4. Endpoint de sintese de historico
"""
from fastapi import APIRouter
from pydantic import BaseModel

from app.ml_models import get_embedder, get_nlp
from app.utils.groq_client import groq_available, groq_complete
from app.utils.math_utils import cosine_similarity

router = APIRouter()

# ---------------------------------------------------------------------------
# 1. MODELOS PYDANTIC
# ---------------------------------------------------------------------------

class Message(BaseModel):
    role: str  # "user" ou "assistant"
    content: str


class HistorySynthesisRequest(BaseModel):
    messages: list[Message]
    # Quantas mensagens mais recentes manter intactas (nao incluiras no resumo).
    # Valor padrao: 10. Essas mensagens sao enviadas ao modelo na integra
    # junto com o resumo das mais antigas.
    keep_last: int = 10


class HistorySynthesisResponse(BaseModel):
    summary: str
    # Mensagens recentes devolvidas na integra para o backend Node
    # montar o contexto final (resumo + recentes).
    recent_messages: list[Message]


# ---------------------------------------------------------------------------
# 2. FUNCOES AUXILIARES DE CLUSTERIZACAO E SUMARIZACAO
# ---------------------------------------------------------------------------

def cluster_messages(messages: list[Message], threshold: float = 0.75) -> list[list[Message]]:
    """
    Agrupa mensagens por similaridade semantica usando embeddings.

    Algoritmo de clusterizacao sequencial (single-pass):
    1. Gera embeddings para todas as mensagens em lote
    2. Inicia o primeiro cluster com a primeira mensagem
    3. Para cada mensagem seguinte, compara com a ULTIMA mensagem
       do cluster atual (nao com o centroide)
    4. Se similaridade de cosseno > threshold (0.75), adiciona ao cluster atual
    5. Caso contrario, fecha o cluster atual e inicia um novo

    Threshold de 0.75:
    - Alto o suficiente para agrupar mensagens sobre o mesmo topico
    - Baixo o suficiente para nao fragmentar topicos relacionados
    - Valor empirico, calibrado para conversas tecnicas em portugues

    Por que comparar com a ultima mensagem e nao com o centroide?
    - Conversas sao sequenciais: mensagens proximas no tempo tendem
      a tratar do mesmo topico
    - Evita que um cluster "desvie" muito do topico original ao longo
      de varias mensagens (drift semantico)
    - Mais simples e rapido que K-means ou aglomerativo
    """
    if not messages:
        return []
    embedder = get_embedder()
    # Gera embeddings em lote (unica chamada ao modelo)
    embeddings = embedder.encode([m.content for m in messages], convert_to_numpy=True)

    clusters: list[list[int]] = []
    current: list[int] = [0]  # Primeiro cluster com a primeira mensagem

    for i in range(1, len(messages)):
        # Compara com a ultima mensagem do cluster atual
        if cosine_similarity(embeddings[i], embeddings[current[-1]]) > threshold:
            current.append(i)
        else:
            # Fecha o cluster e inicia um novo
            clusters.append(current)
            current = [i]

    # Adiciona o ultimo cluster
    clusters.append(current)

    return [[messages[i] for i in cluster] for cluster in clusters]


def summarize_cluster_spacy(cluster: list[Message]) -> str:
    """
    Gera um paragrafo resumo para um cluster de mensagens usando spaCy.

    Estrategia extrativa (nao gera texto novo):
    1. Concatena o conteudo de todas as mensagens do cluster
    2. Processa com spaCy para segmentar em sentencas
    3. Seleciona as 3 sentencas mais longas (proxy de informatividade)
    4. Se nao houver sentencas > 20 caracteres, usa truncamento simples

    Limitacoes:
    - Nao entende o significado das sentencas, apenas tamanho
    - Pode perder contexto importante em sentencas curtas
    - Pode incluir informacao redundante de mensagens diferentes

    Vantagens:
    - Deterministico e rapido
    - Nunca alucina ou inventa informacao
    - Nao depende de API externa
    """
    nlp = get_nlp()
    full_text = " ".join(m.content for m in cluster)
    doc = nlp(full_text)

    # Filtra sentencas muito curtas (provavelmente ruido ou saudações)
    sentences = sorted(
        (s.text.strip() for s in doc.sents if len(s.text.strip()) > 20),
        key=len,
        reverse=True,
    )

    # Top 3 sentencas mais longas como resumo extrativo
    top = sentences[:3]
    return " ".join(top) if top else (full_text[:200] + ("..." if len(full_text) > 200 else ""))


# ---------------------------------------------------------------------------
# 3. FALLBACK (CLUSTER + SPACY)
# ---------------------------------------------------------------------------

def _fallback_summary(older: list[Message]) -> str:
    """
    Sumarizacao de historico por clusterizacao + spaCy.

    Usado quando:
    - Groq nao esta configurado (groq_available() = False)
    - Groq retornou resposta vazia ou fora dos limites de tamanho

    Fluxo:
    1. Agrupa mensagens antigas por similaridade semantica
    2. Para cada cluster, extrai as 3 sentencas mais longas
    3. Concatena os resumos de cada cluster com um prefixo descritivo

    O prefixo "Resumo do historico anterior:" ajuda o modelo a entender
    que aquele bloco de texto e uma sintese, nao uma conversa literal.
    """
    clusters = cluster_messages(older, threshold=0.75)
    summaries = [summarize_cluster_spacy(c) for c in clusters if c]
    return ("Resumo do historico anterior:\n" + "\n".join(summaries)) if summaries else ""


# ---------------------------------------------------------------------------
# 4. ENDPOINT DE SINTESE DE HISTORICO
# ---------------------------------------------------------------------------

@router.post("/synthesize", response_model=HistorySynthesisResponse)
async def synthesize_history(request: HistorySynthesisRequest):
    """
    Condensa o historico de conversa para otimizar o uso de tokens.

    Chamado pelo backend Node quando uma conversa excede um limite
    de mensagens. O Node decide quando chamar este endpoint com base
    na contagem de mensagens da conversa.

    Fluxo de decisao:
    1. Se nao ha mensagens, retorna vazio
    2. Separa as keep_last mensagens mais recentes (mantidas intactas)
    3. Se nao ha mensagens antigas alem das recentes, retorna sem resumo
    4. Tenta sumarizar as antigas via Groq (IA)
       - Prompt pede maximo 5 linhas, preservando decisoes e contexto
       - Valida que o resultado tem entre 100 e 600 caracteres
    5. Se Groq falhar ou retornar resposta invalida, usa fallback
       cluster + spaCy (sem custo adicional de embeddings no caminho feliz)

    Por que validar entre 100 e 600 caracteres?
    - < 100: provavelmente resposta truncada ou erro do modelo
    - > 600: resumo muito longo, nao cumpre o proposito de economizar tokens
    - A faixa foi calibrada para equilibrar preservacao de contexto e economia

    Returns:
        HistorySynthesisResponse com o resumo (string) e as mensagens
        recentes mantidas intactas para o contexto final.
    """
    if not request.messages:
        return HistorySynthesisResponse(summary="", recent_messages=[])

    # Garante que keep_last nao excede o total de mensagens disponiveis
    keep_last = min(request.keep_last, len(request.messages))
    recent = request.messages[-keep_last:]
    older  = request.messages[:-keep_last] if len(request.messages) > keep_last else []

    # Se todas as mensagens cabem em keep_last, nao ha o que resumir
    if not older:
        return HistorySynthesisResponse(summary="", recent_messages=recent)

    summary = ""

    # Caminho preferencial: Groq (modelo de linguagem)
    if groq_available():
        # Formata historico como dialogo: "user: ...\nassistant: ..."
        history_text = "\n".join(f"{m.role}: {m.content}" for m in older)
        prompt = f"""Resuma o seguinte historico de conversa de forma fluida, em no maximo 5 linhas, preservando decisoes, conclusoes e contexto tecnico.

Historico:
{history_text}

Retorne apenas o resumo, sem introducao ou conclusao.
"""
        groq_result = groq_complete(prompt, max_tokens=300)
        # Valida que o resumo esta dentro dos limites aceitaveis
        if groq_result and 100 <= len(groq_result) <= 600:
            summary = groq_result
        else:
            # Groq retornou resposta invalida ou vazia
            # Cai para o fallback sem custo adicional de embeddings
            # (os embeddings so serao gerados agora, no caminho de fallback)
            summary = _fallback_summary(older)
    else:
        # Groq nao configurado: usa fallback diretamente
        summary = _fallback_summary(older)

    return HistorySynthesisResponse(summary=summary, recent_messages=recent)