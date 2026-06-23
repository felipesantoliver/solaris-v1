"""
app/ml_models.py
---
Gerenciamento de singletons para modelos de machine learning.

Responsavel por carregar e disponibilizar as instancias dos modelos
de ML uma unica vez (lazy loading), evitando recarga a cada requisicao.
Economiza memoria e reduz drasticamente o tempo de inicializacao das rotas.

Modelos gerenciados:
  1. SentenceTransformer (all-MiniLM-L6-v2)
     - 384 dimensoes por embedding
     - Usado para geracao de embeddings em lote (indexacao RAG)
       e embeddings individuais (busca semantica e memorias)

  2. spaCy (pt_core_news_sm com fallback en_core_web_sm)
     - Modelo de processamento de linguagem natural
     - Usado para extracao de entidades e padroes textuais
       na extracao automatica de memorias

Singleton pattern:
  - Cada modelo e carregado apenas na primeira chamada a get_embedder() ou get_nlp()
  - Chamadas subsequentes retornam a instancia ja carregada
  - Thread-safe no contexto do FastAPI (um worker por processo)

Todos os routers devem importar get_embedder() e get_nlp() deste modulo,
em vez de instanciar modelos diretamente.
"""
import os
import logging

logger = logging.getLogger(__name__)

# Modelo de embedding configurado via variavel de ambiente.
# Valor padrao: modelo leve e multilingue com 384 dimensoes,
# otimo equilibrio entre qualidade e consumo de recursos.
MODEL_NAME = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")

# ---------------------------------------------------------------------------
# SINGLETONS
# ---------------------------------------------------------------------------

# Instancias carregadas sob demanda (None = ainda nao inicializadas).
# Usar globais no escopo do modulo e seguro no FastAPI com um unico worker,
# ja que nao ha concorrencia entre threads para escrita.
_embedder = None
_nlp = None

# ---------------------------------------------------------------------------
# SENTENCE TRANSFORMER
# ---------------------------------------------------------------------------

def get_embedder():
    """
    Retorna a instancia singleton do SentenceTransformer.

    Carregamento sob demanda (lazy loading):
    - Primeira chamada: baixa e carrega o modelo (~90 MB)
    - Chamadas subsequentes: retorna a instancia ja em memoria

    O modelo e baixado automaticamente do Hugging Face Hub na primeira
    execucao, o que pode causar um pequeno atraso no primeiro request
    apos o deploy. Em ambientes de producao no Render, o modelo persiste
    em disco entre reinicios (desde que nao seja um deploy limpo).

    Returns:
        SentenceTransformer: Modelo de embeddings carregado e pronto para uso
    """
    global _embedder
    if _embedder is None:
        from sentence_transformers import SentenceTransformer
        logger.info(f"Loading SentenceTransformer: {MODEL_NAME}")
        _embedder = SentenceTransformer(MODEL_NAME)
        logger.info("SentenceTransformer loaded successfully")
    return _embedder

# ---------------------------------------------------------------------------
# SPACY NLP
# ---------------------------------------------------------------------------

def get_nlp():
    """
    Retorna a instancia singleton do modelo spaCy.

    Estrategia de carregamento com fallback:
    1. Tenta carregar pt_core_news_sm (portugues)
    2. Se falhar, tenta en_core_web_sm (ingles)
    3. Se ambos falharem, lanca RuntimeError com instrucoes de instacao

    O modelo portugues e necessario para extracao de memorias com
    precisao adequada em textos em portugues. O fallback para ingles
    garante que o servico nao quebre completamente se o modelo pt
    nao estiver disponivel, embora a qualidade da extracao seja reduzida.

    Instacao manual (se o download automatico falhar):
      python -m spacy download pt_core_news_sm

    Returns:
        Language: Pipeline spaCy carregado e pronto para processamento
    """
    global _nlp
    if _nlp is None:
        import spacy
        try:
            _nlp = spacy.load("pt_core_news_sm")
            logger.info("spaCy pt_core_news_sm loaded")
        except OSError:
            # Fallback para ingles se o modelo portugues nao estiver disponivel
            try:
                _nlp = spacy.load("en_core_web_sm")
                logger.info("spaCy en_core_web_sm loaded (fallback)")
            except OSError:
                raise RuntimeError(
                    "spaCy model not found. Run: "
                    "python -m spacy download pt_core_news_sm"
                )
    return _nlp