# app/routers/search.py
#
# Busca RAG (Retrieval-Augmented Generation) — recuperacao semantica
# de chunks de documentos usando pgvector.
#
# Responsavel por encontrar os trechos mais relevantes dos arquivos
# e fontes externas indexados no projeto (ou chat avulso) para injetar
# no system prompt da conversa. Usa embeddings gerados pelo modelo
# sentence-transformers/all-MiniLM-L6-v2 (384 dimensoes) e busca
# por similaridade de cosseno via indice HNSW no PostgreSQL.
#
# Fluxo de uma busca:
#   1. Recebe query do usuario + escopo (project_id ou chat_id)
#   2. Gera embedding da query (com cache FIFO de 256 entradas)
#   3. Consulta o pgvector com operador <=> (distancia de cosseno)
#   4. Filtra resultados com score >= 0.65 (similaridade minima)
#   5. Retorna top 3 chunks mais relevantes
#
# Agrupamento logico:
#   1. Cache de embeddings de query (FIFO)
#   2. Pool de conexoes asyncpg (singleton)
#   3. Utilidade: conversao para literal vetorial
#   4. Endpoint de busca RAG

import os
import asyncio
import hashlib
import asyncpg
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.ml_models import get_embedder

router = APIRouter()

# ---------------------------------------------------------------------------
# 1. CACHE DE EMBEDDINGS DE QUERY (FIFO)
# ---------------------------------------------------------------------------

# Cache em memoria para embeddings de consultas ja processadas.
# Evita recomputar o embedding da mesma query em requisicoes repetidas
# (ex: usuario faz a mesma pergunta, ou o frontend re-renderiza).
#
# Estrutura: dicionario simples { hash_sha256[:16]: numpy_array }
# Limite: 256 entradas (FIFO — remove a mais antiga quando atinge o limite)
# Tamanho em memoria: ~256 * 384 * 4 bytes = ~393 KB (desprezivel)
_query_embedding_cache = {}
_QUERY_EMBEDDING_CACHE_MAX = 256


def _get_cached_query_embedding(query: str, embedder):
    """
    Retorna o embedding da query, usando cache FIFO simples.

    Fluxo:
      1. Gera um hash curto da query (SHA-256 truncado para 16 chars)
      2. Se o hash existe no cache, retorna o embedding salvo
      3. Se nao existe, gera o embedding via SentenceTransformer
      4. Se o cache estiver cheio (256 entradas), remove a mais antiga
         (primeira chave inserida — comportamento de dict em Python 3.7+)
      5. Armazena e retorna o novo embedding

    Por que cachear queries?
      - encode() e rapido (~1-5ms para uma frase), mas em picos de uso
        ou queries repetidas, o cache evita trabalho redundante
      - 256 entradas e suficiente para cobrir queries repetidas em uma
        sessao tipica sem consumo relevante de memoria

    Args:
        query: Texto da consulta do usuario
        embedder: Instancia singleton do SentenceTransformer

    Returns:
        numpy.ndarray: Embedding de 384 dimensoes
    """
    cache_key = hashlib.sha256(query.encode("utf-8")).hexdigest()[:16]
    if cache_key in _query_embedding_cache:
        return _query_embedding_cache[cache_key]

    embedding = embedder.encode(query, convert_to_numpy=True)

    # Politica FIFO: remove a entrada mais antiga se o cache estiver cheio
    if len(_query_embedding_cache) >= _QUERY_EMBEDDING_CACHE_MAX:
        oldest_key = next(iter(_query_embedding_cache))
        del _query_embedding_cache[oldest_key]

    _query_embedding_cache[cache_key] = embedding
    return embedding


# ---------------------------------------------------------------------------
# 2. POOL DE CONEXOES ASYNCPG (SINGLETON)
# ---------------------------------------------------------------------------

# Pool de conexoes asyncpg compartilhado por todas as requisicoes.
# Criado uma vez no primeiro uso (lazy initialization) e reutilizado
# em chamadas subsequentes.
#
# Configuracao:
#   - min_size=2: mantem pelo menos 2 conexoes abertas para evitar
#     latencia de abertura em momentos de baixa demanda
#   - max_size=10: teto de conexoes simultaneas (adequado para o plano
#     gratuito do Render, que tem limite de conexoes no Supabase)
#
# Thread safety: o lock assincrono (_pg_pool_lock) garante que o pool
# seja criado apenas uma vez, mesmo com requisicoes concorrentes no startup.

_pg_pool: asyncpg.Pool | None = None
_pg_pool_lock = asyncio.Lock()


async def get_pg_pool() -> asyncpg.Pool:
    """
    Retorna o pool de conexoes asyncpg (singleton com lazy init).

    Na primeira chamada, cria o pool com as configuracoes definidas.
    Chamadas subsequentes retornam o pool ja existente.

    Raises:
        HTTPException 503: Se a conexao com o banco falhar
            (DATABASE_URL invalida, Supabase fora do ar, etc.)

    Returns:
        asyncpg.Pool: Pool de conexoes pronto para uso
    """
    global _pg_pool
    if _pg_pool is not None:
        return _pg_pool
    async with _pg_pool_lock:
        if _pg_pool is None:
            try:
                _pg_pool = await asyncpg.create_pool(
                    dsn=os.getenv("DATABASE_URL"),
                    min_size=2,
                    max_size=10,
                )
            except Exception as e:
                raise HTTPException(status_code=503, detail=f"Erro ao criar pool do banco: {str(e)}")
    return _pg_pool


# ---------------------------------------------------------------------------
# 3. UTILIDADE: CONVERSAO PARA LITERAL VETORIAL
# ---------------------------------------------------------------------------

def _embedding_to_vector_literal(embedding) -> str:
    """
    Converte um array numpy para o formato literal do pgvector.

    Exemplo:
      Entrada: array([0.123, -0.456, 0.789])
      Saida:   '[0.12300000,-0.45600000,0.78900000]'

    O formato com 8 casas decimais garante precisao suficiente para
    similaridade de cosseno sem desperdicar espaco no SQL.
    Usado para montar a query SQL com o operador <=> do pgvector.

    Args:
        embedding: Array numpy de 384 dimensoes

    Returns:
        str: Literal SQL no formato '[v1,v2,...,v384]'
    """
    return "[" + ",".join(f"{v:.8f}" for v in embedding.tolist()) + "]"


# ---------------------------------------------------------------------------
# 4. ENDPOINT DE BUSCA RAG
# ---------------------------------------------------------------------------

class RAGRequest(BaseModel):
    project_id: str | None = None
    chat_id: str | None = None
    query: str


@router.post("/rag")
async def search_rag(request: RAGRequest):
    """
    Busca os chunks mais relevantes para uma consulta usando pgvector.

    Chamado pelo backend Node (messages.js -> searchRelevantChunks)
    em TODA mensagem de chat que esta dentro de um projeto ou chat
    com arquivos indexados.

    Escopo da busca:
      - Se project_id for informado: busca nos arquivos do projeto
      - Se apenas chat_id for informado: busca nos arquivos do chat avulso
      - Pelo menos um dos dois e obrigatorio

    Algoritmo de busca:
      1. Gera embedding da query do usuario (com cache FIFO)
      2. Converte para literal vetorial do pgvector
      3. Executa consulta SQL com operador <=> (distancia de cosseno):
         - score = 1 - distancia (quanto menor a distancia, maior o score)
         - Ordena por distancia crescente (mais similares primeiro)
         - Limita a 20 resultados brutos
      4. Filtra por score >= 0.65 (similaridade minima)
      5. Retorna top 3 chunks mais relevantes

    Por que NAO recodificar os chunks aqui?
      Os chunks ja chegam com embedding_v persistido pela indexacao
      (indexFileChunks, no Node), feita uma unica vez no upload do
      arquivo/fonte. Recodifica-los aqui transformaria TODA resposta
      de chat em uma operacao de embedding em lote, desnecessariamente.
      Apenas a QUERY do usuario e codificada aqui (com cache).

    Indice HNSW:
      A consulta usa o indice idx_file_chunks_embedding_v_hnsw
      (criado pela migracao 001/002) para busca aproximada rapida,
      com resultado exato garantido pelo refinamento via LIMIT.

    Similaridade minima (0.65):
      Valor empirico calibrado para filtrar chunks irrelevantes.
      Abaixo de 0.65, a similaridade de cosseno indica que o chunk
      nao tem relacao semantica significativa com a consulta.

    Returns:
        List[dict]: Lista de chunks relevantes, cada um com:
            - id: ID do chunk no banco
            - text: Conteudo textual do chunk
            - score: Similaridade de cosseno (0 a 1)
    """
    project_id = request.project_id
    chat_id = request.chat_id
    query = request.query.strip()

    # Validacao de escopo: pelo menos um dos dois deve ser informado
    if not project_id and not chat_id:
        raise HTTPException(status_code=400, detail="project_id ou chat_id é obrigatório.")
    if not query:
        raise HTTPException(status_code=400, detail="query não pode ser vazia.")

    embedder = get_embedder()

    # 1. Gera embedding da query (com cache FIFO para queries repetidas)
    try:
        query_embedding = _get_cached_query_embedding(query, embedder)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar embedding: {str(e)}")

    embedding_literal = _embedding_to_vector_literal(query_embedding)

    # 2. Busca vetorial via pgvector
    #    - Operador <=>: distancia de cosseno (quanto menor, mais similar)
    #    - Score: 1 - distancia (converte para faixa 0-1 onde 1 = identico)
    #    - LIMIT 20: traz candidatos para refinar com filtro de score
    #    - Filtra por project_id OU chat_id, nunca ambos:
    #      um chat dentro de projeto ja tem seus arquivos com project_id,
    #      entao buscar por projeto cobre esse caso automaticamente
    pool = await get_pg_pool()

    # Determina coluna de escopo: project_id ou chat_id
    scope_column = "f.project_id" if project_id else "f.chat_id"
    scope_value = project_id if project_id else chat_id

    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT fc.id, fc.chunk_text, 1 - (fc.embedding_v <=> $1::vector) AS score
                FROM file_chunks fc
                JOIN files f ON f.id = fc.file_id
                WHERE {scope_column} = $2
                  AND fc.embedding_v IS NOT NULL
                ORDER BY fc.embedding_v <=> $1::vector
                LIMIT 20
                """,
                embedding_literal,
                scope_value,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro na consulta vetorial ao banco: {str(e)}")

    # 3. Filtra por similaridade minima (0.65) e retorna top 3
    #    Os resultados ja vem ordenados por distancia (mais relevantes primeiro)
    filtered = [row for row in rows if row["score"] >= 0.65]

    return [
        {"id": row["id"], "text": row["chunk_text"], "score": float(row["score"])}
        for row in filtered[:3]
    ]