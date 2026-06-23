# app/routers/voice.py
#
# Rota de transcricao de audio — recebe arquivo de audio do backend Node,
# envia para a API Whisper da Groq e retorna o texto transcrito.
#
# Usa o modelo whisper-large-v3-turbo via API Groq (cloud).
# Nenhum modelo de IA e carregado localmente — zero consumo de RAM
# no startup do microsservico Python.
#
# Agrupamento logico:
#   1. Cliente Groq sob demanda
#   2. Endpoint de transcricao

import os
import tempfile
from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter()

# Chave da API Groq — necessaria para chamar o Whisper.
# Definida como variavel de ambiente no deploy (Render).
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# ---------------------------------------------------------------------------
# 1. CLIENTE GROQ SOB DEMANDA
# ---------------------------------------------------------------------------

def _get_groq_client():
    """
    Retorna um cliente Groq inicializado sob demanda.

    Motivo do lazy loading:
      O cliente Groq e importado apenas quando a primeira transcricao
      e solicitada — isso evita que o microsservico falhe no startup
      se o pacote 'groq' nao estiver instalado (ex: ambiente de
      desenvolvimento apenas para teste dos endpoints de embedding).

    Raises:
        HTTPException 503 se:
        - GROQ_API_KEY nao estiver configurada no ambiente
        - O pacote Python 'groq' nao estiver instalado

    Returns:
        Groq: Cliente autenticado e pronto para uso
    """
    if not GROQ_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="GROQ_API_KEY não configurada. Transcrição indisponível.",
        )
    try:
        from groq import Groq
        return Groq(api_key=GROQ_API_KEY)
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Pacote 'groq' não instalado.",
        )

# ---------------------------------------------------------------------------
# 2. ENDPOINT DE TRANSCRICAO
# ---------------------------------------------------------------------------

@router.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Recebe um arquivo de audio e retorna a transcricao em texto.

    Fluxo completo:
      1. Recebe o arquivo via multipart/form-data (campo 'file')
      2. Salva temporariamente em disco (exigencia da API Groq:
         o metodo create() precisa de um caminho de arquivo real
         ou um objeto file-like com nome)
      3. Envia para a API Groq com o modelo whisper-large-v3-turbo
      4. Retorna o texto transcrito em portugues (language='pt')
      5. Remove o arquivo temporario no finally

    Formatos de audio aceitos:
      A API Whisper da Groq suporta diversos formatos (webm, mp3, wav,
      ogg, flac, etc.). O formato e detectado pela extensao do arquivo
      original enviado pelo frontend.

    Configuracao da chamada:
      - model: whisper-large-v3-turbo (rapido, otimizado para baixa latencia)
      - language: 'pt' (forca transcricao em portugues, melhora acuracia)
      - response_format: 'json' (retorna objeto com campo 'text')

    Tratamento de erros:
      - 400: Nenhum arquivo enviado
      - 503: GROQ_API_KEY nao configurada ou pacote 'groq' ausente
      - 500: Falha na API Groq (rede, timeout, arquivo corrompido)

    O arquivo temporario e sempre removido no bloco finally,
    mesmo em caso de erro durante a transcricao.
    """
    if not file:
        raise HTTPException(status_code=400, detail="Nenhum arquivo enviado.")

    # Le o conteudo binario completo do upload
    contents = await file.read()

    # Detecta a extensao para preservar o formato no arquivo temporario.
    # A API Groq usa a extensao para inferir o codec do audio.
    original_name = file.filename or "audio.webm"
    suffix = os.path.splitext(original_name)[-1] or ".webm"

    # Arquivo temporario: necessario porque a API Groq exige um caminho
    # de arquivo em disco (nao aceita buffer/binario puro).
    tmp_path = None
    try:
        # Cria arquivo temporario com a extensao correta.
        # delete=False: o arquivo persiste ate ser removido manualmente.
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        # Obtem o cliente Groq (lazy loading — so inicializa agora)
        client = _get_groq_client()

        # Abre o arquivo temporario e envia para a API Whisper.
        # O parametro 'file' espera uma tupla (nome, file_object).
        with open(tmp_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                file=(os.path.basename(tmp_path), audio_file),
                model="whisper-large-v3-turbo",
                language="pt",
                response_format="json",
            )

        # Extrai e limpa o texto transcrito
        text = (transcription.text or "").strip()
        return JSONResponse(content={"text": text})

    except HTTPException:
        # Repassa excecoes HTTP conhecidas (503 por falta de chave, etc.)
        raise
    except Exception as e:
        # Erros da API Groq ou de I/O no arquivo temporario
        raise HTTPException(status_code=500, detail=f"Erro na transcrição: {str(e)}")
    finally:
        # Garante a remocao do arquivo temporario em qualquer cenario
        # (sucesso, erro HTTP, erro interno)
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)