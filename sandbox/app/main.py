# Caminho: sandbox/app/main.py
# Objetivo: Servico de sandbox para execucao segura de codigo Python.
#           Oferece endpoints para health check e execucao isolada de snippets,
#           utilizando validacao AST e limites de recursos.

import ast
import json
import os
import re
import resource
import shutil
import subprocess
import tempfile
import time
import uuid
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from typing import List, Optional, Any

# =============================================================================
# CONFIGURACAO DA APLICACAO
# =============================================================================

app = FastAPI(title="Solaris Sandbox", version="1.0.0")

# Token interno para autenticacao entre servicos.
# Se nao definido, o servico opera em modo inseguro (apenas para desenvolvimento).
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN", "")
if not INTERNAL_TOKEN:
    print("AVISO: INTERNAL_TOKEN nao definido. O servico esta inseguro.", flush=True)

# =============================================================================
# MODELOS DE DADOS
# =============================================================================

class PythonExecRequest(BaseModel):
    """Payload para requisicao de execucao de codigo Python."""
    code: str
    timeout: int = 5          # Tempo maximo de execucao em segundos
    memory_limit_mb: int = 128  # Limite de memoria virtual em MB

class PythonExecResponse(BaseModel):
    """Resposta da execucao de codigo Python."""
    success: bool
    output: str
    error: str
    duration_ms: int

# Modelo mantido para compatibilidade, mas o endpoint nao esta ativo.
class BatchEmbeddingsRequest(BaseModel):
    texts: List[str]

# =============================================================================
# VALIDACAO DE SEGURANCA VIA ANALISE ESTATICA (AST)
# =============================================================================

# Modulos que o usuario tem permissao para importar.
ALLOWED_MODULES = {
    "math", "statistics", "json", "re", "datetime",
    "collections", "itertools", "numpy", "pandas"
}

# Nomes proibidos que nao podem ser referenciados no codigo (funcoes, modulos, etc.).
# A funcao 'open' e tratada separadamente na validacao AST.
FORBIDDEN_NAMES = {
    "os", "sys", "subprocess", "socket", "shutil",
    "requests", "urllib", "ctypes", "eval", "exec",
    "__import__", "compile", "globals", "locals",
    "open"  # Permitido apenas para caminhos dentro de /tmp/solaris_sandbox_*
}

def validate_ast(code: str) -> bool:
    """
    Verifica se o codigo-fonte e seguro para execucao analisando a AST.
    
    Bloqueia:
    - Importacao de modulos fora da lista permitida.
    - Uso de nomes proibidos (como 'eval', 'exec', 'os', etc.).
    - Chamadas diretas a funcoes perigosas.
    
    Retorna True se o codigo passar em todas as verificacoes.
    """
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return False

    for node in ast.walk(tree):
        # Bloqueia referencias a nomes proibidos (ex: open, eval)
        if isinstance(node, ast.Name):
            if node.id in FORBIDDEN_NAMES:
                return False

        # Bloqueia importacoes de modulos nao permitidos (import X)
        if isinstance(node, ast.Import):
            for alias in node.names:
                module_name = alias.name.split('.')[0]
                if module_name not in ALLOWED_MODULES:
                    return False

        # Bloqueia importacoes de modulos nao permitidos (from X import Y)
        if isinstance(node, ast.ImportFrom):
            module_name = node.module.split('.')[0] if node.module else ""
            if module_name and module_name not in ALLOWED_MODULES:
                return False
            # Bloqueia importacao de nomes proibidos (ex: from os import system)
            for alias in node.names:
                if alias.name in FORBIDDEN_NAMES:
                    return False

        # Bloqueia chamadas diretas a funcoes proibidas (ex: eval())
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                if node.func.id in FORBIDDEN_NAMES:
                    return False

    return True

# =============================================================================
# ENDPOINTS
# =============================================================================

@app.get("/health")
async def health():
    """Verificacao de saude do servico."""
    return {"status": "ok"}

@app.post("/tools/python-exec", response_model=PythonExecResponse)
async def python_exec(
    req: PythonExecRequest,
    x_internal_token: Optional[str] = Header(None)
):
    """
    Executa um snippet de codigo Python em ambiente isolado.
    
    Requer autenticacao via header X-Internal-Token.
    Aplica validacao AST, limites de tempo e memoria, e sanitizacao de saida.
    O codigo e executado em um diretorio temporario removido apos o uso.
    """
    # Verifica autenticacao
    if not INTERNAL_TOKEN or x_internal_token != INTERNAL_TOKEN:
        raise HTTPException(status_code=401, detail="Token invalido")

    # Aplica limites maximos de seguranca
    code = req.code
    timeout = min(req.timeout, 10)          # Forca maximo de 10 segundos
    mem_limit_mb = min(req.memory_limit_mb, 256)  # Forca maximo de 256 MB

    # Etapa 1: Validacao de seguranca do codigo
    if not validate_ast(code):
        return PythonExecResponse(
            success=False,
            output="",
            error="Codigo rejeitado pela politica de seguranca (modulo ou funcao proibida).",
            duration_ms=0
        )

    # Etapa 2: Preparacao do ambiente isolado
    work_dir = tempfile.mkdtemp(prefix="solaris_sandbox_")
    script_path = os.path.join(work_dir, "script.py")
    with open(script_path, "w") as f:
        f.write(code)

    # Etapa 3: Execucao com limites de recursos
    start = time.perf_counter()
    try:
        # Define limites de memoria virtual via ulimit antes de executar o script.
        # O PYTHONPATH e limpo para evitar injecao de modulos do ambiente externo.
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
            env={"PYTHONPATH": ""}
        )
        duration_ms = int((time.perf_counter() - start) * 1000)

        stdout = result.stdout.strip()
        stderr = result.stderr.strip()

        # Sanitiza a saida de erro removendo caminhos absolutos do sistema
        if stderr:
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
        # Limpeza do diretorio temporario (executada em background)
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
        except:
            pass

# =============================================================================
# NOTAS SOBRE ENDPOINTS COMENTADOS/REMOVIDOS
# =============================================================================
#
# 1) /embeddings/batch: movido permanentemente para o microsservico Python
#    (backend-python), que ja carrega o SentenceTransformer. Manter aqui
#    causaria duplicacao de modelos e consumo desnecessario de memoria.
#
# 2) /tools/condense-chunk: a versao original foi removida por ser uma
#    duplicata incompleta. A implementacao completa (com max_chars e mais
#    keywords) esta em backend-python/app/main.py. Nenhum dos dois endpoints
#    e chamado pelo backend Node atualmente; se necessario no futuro, deve
#    ser reativado apenas no microsservico Python.