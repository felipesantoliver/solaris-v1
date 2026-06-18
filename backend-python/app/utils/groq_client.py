import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Tenta importar o cliente Groq
try:
    from groq import Groq
except ImportError:
    Groq = None
    logger.warning("Pacote 'groq' não instalado. A Groq será desabilitada.")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

_cliente = None
_disponivel = False


def _inicializar_cliente():
    global _cliente, _disponivel
    if Groq is None:
        _disponivel = False
        return
    if not GROQ_API_KEY:
        logger.warning("GROQ_API_KEY não definida. A Groq será desabilitada.")
        _disponivel = False
        return
    try:
        _cliente = Groq(api_key=GROQ_API_KEY)
        _disponivel = True
        logger.info("✅ Cliente Groq inicializado com sucesso.")
    except Exception as e:
        logger.error(f"❌ Falha ao inicializar cliente Groq: {e}")
        _cliente = None
        _disponivel = False


# Inicializa no carregamento do módulo
_inicializar_cliente()


def groq_available() -> bool:
    """Retorna True se o cliente Groq está disponível e pronto para uso."""
    return _disponivel and _cliente is not None


def groq_complete(prompt: str, max_tokens: int = 200) -> Optional[str]:
    """
    Faz uma chamada ao modelo llama3-8b-8192.
    Retorna o texto gerado ou None em caso de erro.
    Nunca levanta exceção.
    """
    if not groq_available():
        logger.warning("Groq não disponível – chamada ignorada.")
        return None

    try:
        response = _cliente.chat.completions.create(
            model="llama3-8b-8192",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=0.3,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"Erro na chamada Groq: {e}")
        return None