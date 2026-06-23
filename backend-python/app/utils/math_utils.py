# app/utils/math_utils.py
#
# Utilitarios matematicos compartilhados entre os routers.
#
# Fornece funcoes para operacoes vetoriais usadas em:
#   - memories.py: sintese de memorias (similaridade entre query e memorias)
#   - history.py: clusterizacao de mensagens (similaridade entre embeddings)
#
# Centralizar estas funcoes evita duplicacao e garante que todos
# os modulos usem a mesma implementacao (ex: mesmo tratamento
# de norma zero na similaridade de cosseno).
#
# Agrupamento logico:
#   1. Similaridade de cosseno

import numpy as np

# ---------------------------------------------------------------------------
# 1. SIMILARIDADE DE COSSENO
# ---------------------------------------------------------------------------

def cosine_similarity(a, b):
    """
    Calcula a similaridade de cosseno entre dois vetores.

    Formula:
        cos(a, b) = (a · b) / (||a|| * ||b||)

    Resultado:
        - 1.0: vetores identicos (mesma direcao)
        - 0.0: vetores ortogonais (sem relacao)
        - -1.0: vetores opostos (direcoes contrarias)

    Protecao contra norma zero:
        Se qualquer um dos vetores tiver norma zero (vetor nulo),
        a similaridade e definida como 0.0. Isso evita divisao por
        zero e trata o vetor nulo como "sem similaridade definida"
        com qualquer outro vetor.

    Uso no projeto:
        - Comparar embedding da query do usuario com embeddings
          de memorias para encontrar as mais relevantes
        - Agrupar mensagens por similaridade semantica na
          clusterizacao do historico (history.py)
        - Deducar memorias por similaridade de Jaccard
          (nao usa esta funcao, mas e um conceito relacionado)

    Args:
        a: Primeiro vetor (lista, array numpy, ou qualquer iteravel numerico)
        b: Segundo vetor (mesmo tipo e dimensao que 'a')

    Returns:
        float: Similaridade de cosseno no intervalo [-1.0, 1.0],
               ou 0.0 se qualquer vetor tiver norma zero
    """
    # Converte para arrays numpy para garantir operacoes vetoriais corretas
    a = np.array(a)
    b = np.array(b)

    # Calcula as normas (magnitudes) dos vetores
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)

    # Se qualquer vetor for nulo, retorna 0.0 (sem similaridade definida)
    if norm_a == 0 or norm_b == 0:
        return 0.0

    # Calcula o produto escalar e divide pelo produto das normas
    return float(np.dot(a, b) / (norm_a * norm_b))