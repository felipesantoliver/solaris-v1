import os
import tempfile
from fastapi import APIRouter, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse
import pypdf

router = APIRouter()

@router.post("/extract-text")
async def extract_text(
    file: UploadFile = File(...),
    mime_type: str = Form(None)
):
    """
    Extrai texto de arquivos enviados. Suporta PDF e arquivos de texto.
    Retorna {'text': str, 'pages': int} (pages = 1 para não-PDF).
    """
    if not file:
        raise HTTPException(status_code=400, detail="Nenhum arquivo enviado.")

    contents = await file.read()
    filename = file.filename or ""
    mime = mime_type or file.content_type or ""

    # Salvar temporariamente para processar
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(filename)[1]) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        text = ""
        pages = 0

        # Detectar tipo: PDF ou texto
        if mime == "application/pdf" or filename.lower().endswith(".pdf"):
            # Extrair com pypdf
            with open(tmp_path, "rb") as f:
                reader = pypdf.PdfReader(f)
                pages = len(reader.pages)
                for page in reader.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"
        else:
            # Tentar ler como texto (assumindo UTF-8)
            try:
                text = contents.decode("utf-8")
                pages = 1
            except UnicodeDecodeError:
                raise HTTPException(status_code=415, detail="Tipo de arquivo não suportado para extração de texto.")

        return JSONResponse(content={"text": text.strip(), "pages": pages})

    except HTTPException:
        # Re-propaga HTTPException sem embrulhar em 500 — HTTPException é
        # subclasse de Exception, então sem este except específico antes do
        # genérico, o 415 levantado acima (tipo de arquivo não suportado)
        # seria capturado abaixo e virava um 500 opaco. Mesmo padrão do
        # voice.py (/transcribe).
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro na extração de texto: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)