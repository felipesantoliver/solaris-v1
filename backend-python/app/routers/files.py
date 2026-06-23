# app/routers/files.py
#
# Rota de extracao de texto de arquivos — recebe um arquivo do backend Node,
# extrai o conteudo textual e retorna para indexacao RAG.
#
# Suporta dois formatos principais:
#   - PDF: usa a biblioteca pypdf para extrair texto de cada pagina,
#     retornando o numero total de paginas como metadado.
#   - Arquivos de texto (TXT, MD, JSON, JS, TS, PY, CSS, HTML, CSV):
#     le o conteudo como UTF-8 e retorna como texto puro.
#
# Formatos nao suportados (ex: imagens, binarios) retornam 415.
#
# Agrupamento logico:
#   1. Endpoint de extracao de texto

import os
import tempfile
from fastapi import APIRouter, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse
import pypdf

router = APIRouter()

# ---------------------------------------------------------------------------
# 1. ENDPOINT DE EXTRACAO DE TEXTO
# ---------------------------------------------------------------------------

@router.post("/extract-text")
async def extract_text(
    file: UploadFile = File(...),
    mime_type: str = Form(None)
):
    """
    Extrai texto de um arquivo enviado como multipart/form-data.

    Chamado pelo backend Node (files.js -> extractTextSafely) durante
    o upload de arquivos. O texto extraido e armazenado na coluna
    extracted_text e usado para gerar embeddings (indexacao RAG).

    Fluxo:
      1. Recebe o arquivo binario e o MIME type (opcional)
      2. Salva temporariamente em disco (exigencia do pypdf para PDFs)
      3. Detecta o tipo: PDF (pypdf) ou texto (decode UTF-8)
      4. Para PDFs: extrai texto de todas as paginas, conta paginas
      5. Para textos: decodifica como UTF-8, define pages=1
      6. Remove o arquivo temporario no finally

    Deteccao de tipo (ordem de prioridade):
      1. MIME type enviado explicitamente (parametro mime_type)
      2. MIME type detectado pelo navegador (file.content_type)
      3. Extensao do arquivo (.pdf)

    Tratamento de erros:
      - 400: Nenhum arquivo enviado
      - 415: Tipo de arquivo nao suportado para extracao
        (ex: imagem, binario, codificacao desconhecida)
      - 500: Erro interno (I/O no arquivo temporario, falha no pypdf)

    Returns:
        JSONResponse com:
          - text: Conteudo textual extraido (string vazia se nada encontrado)
          - pages: Numero de paginas (1 para arquivos de texto)
    """
    if not file:
        raise HTTPException(status_code=400, detail="Nenhum arquivo enviado.")

    # Le o conteudo binario completo do upload
    contents = await file.read()
    filename = file.filename or ""

    # Resolve o MIME type: enviado explicitamente > detectado pelo navegador > vazio
    mime = mime_type or file.content_type or ""

    # Arquivo temporario em disco: necessario para o pypdf, que trabalha
    # com caminhos de arquivo, nao com buffers em memoria.
    tmp_path = None
    try:
        # Cria arquivo temporario com a extensao original.
        # delete=False: o arquivo persiste ate ser removido manualmente
        # no finally, garantindo que o pypdf consiga le-lo.
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(filename)[1]) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        text = ""
        pages = 0

        # ── Deteccao de tipo e extracao ──────────────────────────────

        # PDF: usa pypdf para leitura pagina por pagina
        if mime == "application/pdf" or filename.lower().endswith(".pdf"):
            with open(tmp_path, "rb") as f:
                reader = pypdf.PdfReader(f)
                pages = len(reader.pages)
                for page in reader.pages:
                    # extract_text() pode retornar None se a pagina
                    # nao tiver texto (ex: apenas imagens)
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"
        else:
            # Arquivo de texto: decodifica o buffer como UTF-8.
            # Se falhar na decodificacao, o arquivo nao e texto puro
            # (provavelmente binario) -> retorna 415.
            try:
                text = contents.decode("utf-8")
                pages = 1
            except UnicodeDecodeError:
                raise HTTPException(
                    status_code=415,
                    detail="Tipo de arquivo não suportado para extração de texto."
                )

        return JSONResponse(content={"text": text.strip(), "pages": pages})

    except HTTPException:
        # Re-propaga HTTPException sem modificar.
        # Importante: HTTPException e subclasse de Exception, entao sem
        # este except especifico antes do generico, o 415 levantado acima
        # seria capturado pelo except Exception e transformado em um
        # 500 opaco, perdendo a semantica correta do erro.
        # Mesmo padrao usado em voice.py (/transcribe).
        raise
    except Exception as e:
        # Erros inesperados: I/O, corrupcao do PDF, etc.
        raise HTTPException(status_code=500, detail=f"Erro na extração de texto: {str(e)}")
    finally:
        # Garante a remocao do arquivo temporario em qualquer cenario
        # (sucesso, erro HTTP, erro interno).
        # Verifica se o arquivo existe antes de tentar remover, pois
        # pode nao ter sido criado se a excecao ocorreu antes.
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)