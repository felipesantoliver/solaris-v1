import os
import tempfile
from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter()

# Usa a API Whisper do Groq (sem modelo local → sem consumo de RAM no startup)
GROQ_API_KEY = os.getenv("GROQ_API_KEY")


def _get_groq_client():
    """Retorna um cliente Groq inicializado sob demanda."""
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


@router.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Recebe um arquivo de áudio (multipart/form-data) e retorna a transcrição em português.
    Usa a API Whisper do Groq (whisper-large-v3-turbo) — sem modelo local.
    """
    if not file:
        raise HTTPException(status_code=400, detail="Nenhum arquivo enviado.")

    contents = await file.read()

    # Detecta extensão para o arquivo temporário
    original_name = file.filename or "audio.webm"
    suffix = os.path.splitext(original_name)[-1] or ".webm"

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        client = _get_groq_client()

        with open(tmp_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                file=(os.path.basename(tmp_path), audio_file),
                model="whisper-large-v3-turbo",
                language="pt",
                response_format="json",
            )

        text = (transcription.text or "").strip()
        return JSONResponse(content={"text": text})

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro na transcrição: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)