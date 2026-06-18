import ast
import json
import os
import resource
import subprocess
import tempfile
import time
import uuid
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from typing import List, Optional, Any

app = FastAPI(title="Solaris Sandbox", version="1.0.0")

INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN", "")
if not INTERNAL_TOKEN:
    print("⚠️ INTERNAL_TOKEN não definido. O serviço será inseguro.", flush=True)

# ─── Modelos ──────────────────────────────────────────────────────
class PythonExecRequest(BaseModel):
    code: str
    timeout: int = 5   # segundos
    memory_limit_mb: int = 128

class PythonExecResponse(BaseModel):
    success: bool
    output: str
    error: str
    duration_ms: int

class BatchEmbeddingsRequest(BaseModel):
    texts: List[str]

class CondenseChunkRequest(BaseModel):
    chunk: str

# ─── Validação AST ────────────────────────────────────────────────
ALLOWED_MODULES = {
    "math", "statistics", "json", "re", "datetime",
    "collections", "itertools", "numpy", "pandas"
}

FORBIDDEN_NAMES = {
    "os", "sys", "subprocess", "socket", "shutil",
    "requests", "urllib", "ctypes", "eval", "exec",
    "__import__", "compile", "globals", "locals",
    "open"  # será permitido apenas para /tmp/solaris_sandbox_*
}

def validate_ast(code: str) -> bool:
    """Retorna True se o código é seguro para execução."""
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return False

    for node in ast.walk(tree):
        # Nomes globais (ex: __import__, open)
        if isinstance(node, ast.Name):
            if node.id in FORBIDDEN_NAMES:
                return False
        # Importações: proibir módulos proibidos
        if isinstance(node, ast.Import):
            for alias in node.names:
                module_name = alias.name.split('.')[0]
                if module_name not in ALLOWED_MODULES:
                    return False
        if isinstance(node, ast.ImportFrom):
            module_name = node.module.split('.')[0] if node.module else ""
            if module_name and module_name not in ALLOWED_MODULES:
                return False
            # Proibir imports de nomes proibidos (ex: from os import ...)
            for alias in node.names:
                if alias.name in FORBIDDEN_NAMES:
                    return False
        # Chamadas a funções proibidas (ex: eval, exec)
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                if node.func.id in FORBIDDEN_NAMES:
                    return False
    return True

# ─── Endpoints ──────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/tools/python-exec", response_model=PythonExecResponse)
async def python_exec(
    req: PythonExecRequest,
    x_internal_token: Optional[str] = Header(None)
):
    if not INTERNAL_TOKEN or x_internal_token != INTERNAL_TOKEN:
        raise HTTPException(status_code=401, detail="Token inválido")

    code = req.code
    timeout = min(req.timeout, 10)   # máximo 10s
    mem_limit_mb = min(req.memory_limit_mb, 256)

    # 1. Validação AST
    if not validate_ast(code):
        return PythonExecResponse(
            success=False,
            output="",
            error="Código rejeitado pela política de segurança (módulo ou função proibida).",
            duration_ms=0
        )

    # 2. Prepara ambiente de execução
    work_dir = tempfile.mkdtemp(prefix="solaris_sandbox_")
    script_path = os.path.join(work_dir, "script.py")
    with open(script_path, "w") as f:
        f.write(code)

    # 3. Executa com subprocess (timeout e limites)
    start = time.perf_counter()
    try:
        # Define limites de memória via resource (se disponível no sistema)
        # Em ambientes Linux, podemos setar limites antes do subprocess
        # Mas faremos via subprocess com prlimit se disponível? Vamos usar timeout simples.
        # Para memória, usamos ulimit -v  (virtual memory)
        cmd = [
            "sh", "-c",
            f"ulimit -v {mem_limit_mb * 1024}; python3 {script_path}"
        ]
        result = subprocess.run(
            cmd,
            cwd=work_dir,
            capture_output=True,
            text=True,
            timeout=timeout,
            env={"PYTHONPATH": ""}  # limpa variáveis de ambiente
        )
        duration_ms = int((time.perf_counter() - start) * 1000)

        stdout = result.stdout.strip()
        stderr = result.stderr.strip()

        # Sanitiza stderr (remove caminhos)
        if stderr:
            # Remove caminhos absolutos (/app, /tmp, etc.)
            import re
            stderr = re.sub(r'/tmp/solaris_sandbox_[^/]+/', '', stderr)
            stderr = re.sub(r'/app/', '', stderr)

        if result.returncode == 0:
            return PythonExecResponse(
                success=True,
                output=stdout,
                error="",
                duration_ms=duration_ms
            )
        else:
            return PythonExecResponse(
                success=False,
                output=stdout,
                error=stderr or "Erro desconhecido",
                duration_ms=duration_ms
            )
    except subprocess.TimeoutExpired:
        duration_ms = int((time.perf_counter() - start) * 1000)
        return PythonExecResponse(
            success=False,
            output="",
            error=f"Tempo limite excedido ({timeout}s)",
            duration_ms=duration_ms
        )
    except Exception as e:
        duration_ms = int((time.perf_counter() - start) * 1000)
        return PythonExecResponse(
            success=False,
            output="",
            error=f"Erro interno: {str(e)}",
            duration_ms=duration_ms
        )
    finally:
        # Limpeza do diretório temporário (em background)
        import shutil
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
        except:
            pass


# ─── Batch Embeddings (para ser chamado pelo backend-python ou Node) ─────
# Este endpoint pode ser movido para o backend-python, mas mantemos aqui
# para centralizar tarefas pesadas no sandbox. Entretanto, o backend-python
# já tem SentenceTransformer, então podemos deixar apenas lá.
# Para evitar duplicação, deixamos este endpoint comentado, mas se desejar
# pode ativá-lo. Recomendo manter no backend-python.

# @app.post("/embeddings/batch")
# async def batch_embeddings(req: BatchEmbeddingsRequest):
#     try:
#         from sentence_transformers import SentenceTransformer
#         model = SentenceTransformer("all-MiniLM-L6-v2")
#         embeddings = model.encode(req.texts, convert_to_numpy=True)
#         return {"embeddings": [e.tolist() for e in embeddings]}
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))


# ─── Condense Chunk (chamado pelo backend-python ou Node) ────────────────
@app.post("/tools/condense-chunk")
async def condense_chunk(req: CondenseChunkRequest):
    """
    Recebe um chunk de texto (>200 caracteres) e retorna uma versão condensada
    com a frase mais relevante. Usa estratégia simples: extrai a primeira frase
    que contém palavras-chave ou, se não encontrar, a primeira frase longa.
    """
    text = req.chunk.strip()
    if len(text) <= 200:
        return {"condensed": text}

    # Divisão em frases (simples)
    import re
    sentences = re.split(r'(?<=[.!?])\s+', text)
    if not sentences:
        return {"condensed": text[:200] + "..."}

    # Palavras-chave para priorizar
    keywords = ["porque", "assim", "portanto", "consequentemente", "resultado", "conclusão", "importante", "crítico", "essencial"]
    for sent in sentences:
        if any(kw in sent.lower() for kw in keywords):
            return {"condensed": sent.strip()}

    # Se nenhuma frase com keyword, pega a mais longa (mas não maior que 200)
    best = max(sentences, key=len)
    if len(best) > 200:
        best = best[:200] + "..."
    return {"condensed": best.strip()}