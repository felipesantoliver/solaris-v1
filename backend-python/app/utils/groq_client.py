"""
app/utils/groq_client.py
---
Cliente Groq singleton.

Fornece groq_available() e groq_complete() para todos os routers
do microsservico Python. Centraliza a inicializacao, configuracao
e tratamento de erros do cliente Groq em um unico ponto.

Modelo utilizado: llama3-8b-8192
- Rápido e eficiente para tarefas auxiliares (classificacao, extracao,
  sintese, geracao de titulos e otimizacao de personalidade)
- Não é o modelo principal de conversa (esse é o Gemini no backend Node)
- Usado apenas para tarefas de apoio que melhoram a qualidade do sistema

Servicos que dependem deste modulo:
  - memories.py  -> extracao e sintese de memorias
  - history.py   -> sumarizacao de historico longo
  - title.py     -> geracao de titulo de conversa
  - intent.py    -> classificacao de intencao da consulta
  - main.py      -> otimizacao de personalidade (optimize-personality)

Design:
  - Singleton: cliente inicializado uma vez na carga do modulo
  - Tolerante a falhas: nunca lanca excecoes para quem chama
  - Sempre retorna Optional[str]: None significa "tente o fallback"
  - Todos os routers usam o mesmo padrao: if groq_available() tenta Groq,
    se retornar None usa fallback local

Agrupamento logico:
  1. Inicializacao do cliente
  2. Funcoes publicas (groq_available e groq_complete)
"""
import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 1. INICIALIZACAO DO CLIENTE
# ---------------------------------------------------------------------------

# Tenta importar o pacote Groq. Se nao estiver instalado (ex: ambiente
# de desenvolvimento sem requisitos completos), define Groq = None e
# desabilita o servico gracefulmente.
try:
    from groq import Groq
except ImportError:
    Groq = None
    logger.warning("Package 'groq' is not installed. Groq will be disabled.")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# Cliente singleton: inicializado uma vez e compartilhado por todos os routers.
# _available controla se o cliente esta funcional (True) ou se todas as
# chamadas devem retornar None para acionar fallbacks locais.
_client = None
_available = False


def _init_client() -> None:
    """
    Inicializa o cliente Groq de forma segura.

    Ordem de verificacao:
    1. Pacote 'groq' instalado?
    2. GROQ_API_KEY definida no ambiente?
    3. Cliente consegue ser instanciado sem erros?

    Se qualquer etapa falhar, _available permanece False e todas
    as chamadas a groq_complete() retornarao None, acionando os
    fallbacks locais em cada router.

    A inicializacao acontece na importacao do modulo, nao na primeira
    chamada. Isso garante que a verificacao de disponibilidade seja
    instantanea (sem latencia na primeira requisicao).
    """
    global _client, _available

    if Groq is None:
        _available = False
        return

    if not GROQ_API_KEY:
        logger.warning("GROQ_API_KEY not defined. Groq will be disabled.")
        _available = False
        return

    try:
        _client = Groq(api_key=GROQ_API_KEY)
        _available = True
        logger.info("Groq client initialised successfully.")
    except Exception as e:
        logger.error(f"Failed to initialise Groq client: {e}")
        _client = None
        _available = False


# Inicializa o cliente imediatamente na carga do modulo.
# Isso evita surpresas: todos os routers sabem se o Groq esta
# disponivel desde o primeiro request, sem inicializacao lazy.
_init_client()

# ---------------------------------------------------------------------------
# 2. FUNCOES PUBLICAS
# ---------------------------------------------------------------------------

def groq_available() -> bool:
    """
    Verifica se o cliente Groq esta inicializado e pronto para uso.

    Returns:
        True se o cliente existe e foi inicializado com sucesso.
        False em qualquer outro caso (pacote nao instalado, chave ausente,
        erro na inicializacao).

    Uso tipico nos routers:
        if groq_available():
            result = groq_complete(prompt)
            if result:
                return result
        return fallback_local()
    """
    return _available and _client is not None


def groq_complete(prompt: str, max_tokens: int = 200) -> Optional[str]:
    """
    Chama o modelo llama3-8b-8192 via API Groq.

    Parametros:
        prompt: Texto do prompt a ser enviado ao modelo
        max_tokens: Limite de tokens na resposta (padrao 200, suficiente
                    para tarefas auxiliares como classificacao e extracao)

    Configuracao da chamada:
        model: llama3-8b-8192 (rapido e eficiente para tarefas auxiliares)
        temperature: 0.3 (baixa, para respostas deterministicas e previsiveis;
                    valor escolhido para tarefas de extracao/classificacao
                    onde criatividade nao e desejada)

    Returns:
        Texto da resposta (string) em caso de sucesso.
        None se:
        - Groq nao estiver disponivel
        - A chamada API falhar (rede, timeout, erro do servidor)
        - O modelo retornar resposta vazia

    Nunca lanca excecoes: qualquer erro e logado e retorna None,
    permitindo que o chamador use fallback local sem try/except.
    """
    if not groq_available():
        logger.warning("Groq not available — call skipped.")
        return None

    try:
        response = _client.chat.completions.create(
            model="llama3-8b-8192",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=0.3,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"Groq call error: {e}")
        return None