// backend-node/src/tools/pythonExecutor.ts
import axios from 'axios'; // Certifique-se de que axios está instalado

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';
const SANDBOX_URL = process.env.SANDBOX_URL || 'http://localhost:8000';

export interface PythonExecutionResult {
  success: boolean;
  output: string;
  error: string;
  durationMs: number;
}

/**
 * Envia código Python para execução no sandbox isolado.
 * @param code Código Python a ser executado
 * @param timeout Timeout em segundos (padrão 5)
 * @param memoryLimitMb Limite de memória em MB (padrão 128)
 * @returns Resultado da execução
 */
export async function executePython(
  code: string,
  timeout: number = 5,
  memoryLimitMb: number = 128
): Promise<PythonExecutionResult> {
  if (!INTERNAL_TOKEN) {
    throw new Error('INTERNAL_TOKEN não configurado');
  }

  try {
    const response = await axios.post(
      `${SANDBOX_URL}/tools/python-exec`,
      { code, timeout, memory_limit_mb: memoryLimitMb },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': INTERNAL_TOKEN
        },
        timeout: (timeout + 2) * 1000, // margem para rede
      }
    );

    return {
      success: response.data.success,
      output: response.data.output,
      error: response.data.error,
      durationMs: response.data.duration_ms
    };
  } catch (error: any) {
    if (error.response) {
      // Erro HTTP (ex: 401, 500)
      return {
        success: false,
        output: '',
        error: `Sandbox retornou erro (${error.response.status}): ${error.response.data?.error || error.message}`,
        durationMs: 0
      };
    } else if (error.code === 'ECONNABORTED') {
      return {
        success: false,
        output: '',
        error: 'Timeout na comunicação com o sandbox',
        durationMs: 0
      };
    } else {
      return {
        success: false,
        output: '',
        error: `Erro ao chamar sandbox: ${error.message}`,
        durationMs: 0
      };
    }
  }
}