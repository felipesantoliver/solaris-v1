import os
import tempfile
import whisper
from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
import numpy as np
import soundfile as sf
import io

router = APIRouter()

# Carrega o modelo uma única vez (cache) – você pode definir a variável de ambiente WHISPER_MODEL
# Valores possíveis: tiny, base, small, medium, large
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "tiny")
model = whisper.load_model(WHISPER_MODEL)

@router.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Recebe um arquivo de áudio (multipart/form-data) e retorna a transcrição em português.
    """
    # Verifica se o arquivo foi enviado
    if not file:
        raise HTTPException(status_code=400, detail="Nenhum arquivo enviado.")

    # Lê o conteúdo do arquivo
    contents = await file.read()
    
    # Salva temporariamente em disco (o Whisper espera um caminho de arquivo)
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        # Realiza a transcrição
        result = model.transcribe(tmp_path, language="pt", task="transcribe")
        text = result.get("text", "").strip()

        return JSONResponse(content={"text": text})

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro na transcrição: {str(e)}")
    finally:
        # Remove o arquivo temporário, se existir
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)