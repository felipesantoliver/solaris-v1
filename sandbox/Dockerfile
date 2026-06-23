# Caminho: sandbox/Dockerfile
# Objetivo: Imagem Docker para o serviço de sandbox de execução de código Python.
#           Executa snippets em ambiente isolado com bibliotecas seguras.

# =============================================================================
# IMAGEM BASE
# =============================================================================

# Utiliza Python 3.12 em uma imagem enxuta (slim) para reduzir o tamanho final.
FROM python:3.12-slim

# =============================================================================
# CONFIGURACAO DO DIRETORIO DE TRABALHO
# =============================================================================

# Define /app como diretório padrão para todas as operações subsequentes.
WORKDIR /app

# =============================================================================
# INSTALACAO DE DEPENDENCIAS
# =============================================================================

# Instala apenas as bibliotecas essenciais para o funcionamento do sandbox:
# - fastapi e uvicorn: servidor web e interface ASGI
# - numpy e pandas: bibliotecas permitidas para execução de código
# O flag --no-cache-dir impede o armazenamento de cache do pip, reduzindo a imagem.
RUN pip install --no-cache-dir fastapi uvicorn numpy pandas

# =============================================================================
# COPIA DO CODIGO FONTE
# =============================================================================

# Transfere o conteúdo da pasta local ./app para o diretório /app/app na imagem.
# Apenas o necessário é copiado para manter a imagem leve.
COPY ./app /app/app

# =============================================================================
# EXPOSICAO DE PORTA
# =============================================================================

# Informa que o contêiner escuta na porta 8000 (não publica a porta de fato).
EXPOSE 8000

# =============================================================================
# COMANDO DE INICIALIZACAO
# =============================================================================

# Inicia o servidor Uvicorn com:
# - app.main:app: aplicação FastAPI localizada no módulo main
# - --host 0.0.0.0: aceita conexões de qualquer interface de rede
# - --port 8000: porta de escuta (deve corresponder ao EXPOSE)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]