"""
app/ml_models.py — Singletons de modelos de ML.

Carrega SentenceTransformer e spaCy UMA única vez e expõe via get_embedder() / get_nlp().
Todos os routers devem importar daqui em vez de instanciar diretamente.
"""
import os
import logging
from functools import lru_cache

logger = logging.getLogger(__name__)

MODEL_NAME = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")

_embedder = None
_nlp = None


def get_embedder():
    """Retorna a instância singleton do SentenceTransformer."""
    global _embedder
    if _embedder is None:
        from sentence_transformers import SentenceTransformer
        logger.info(f"🔄 Carregando SentenceTransformer: {MODEL_NAME}")
        _embedder = SentenceTransformer(MODEL_NAME)
        logger.info("✅ SentenceTransformer carregado")
    return _embedder


def get_nlp():
    """Retorna a instância singleton do modelo spaCy."""
    global _nlp
    if _nlp is None:
        import spacy
        try:
            _nlp = spacy.load("pt_core_news_sm")
            logger.info("✅ spaCy pt_core_news_sm carregado")
        except OSError:
            try:
                _nlp = spacy.load("en_core_web_sm")
                logger.info("✅ spaCy en_core_web_sm carregado (fallback)")
            except OSError:
                raise RuntimeError(
                    "Modelo spaCy não encontrado. Execute: "
                    "python -m spacy download pt_core_news_sm"
                )
    return _nlp