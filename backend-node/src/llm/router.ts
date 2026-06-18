// backend-node/src/llm/router.ts
import { Router, Request, Response } from 'express';
import { GoogleGenerativeAI, FunctionDeclaration, Tool } from '@google/generative-ai';
import { executePython } from '../tools/pythonExecutor';
import { classifyIntent } from './classifier'; // seu módulo de classificação local
import { generateCodeWithGroq, generateResponseWithGemini } from './llmUtils'; // funções auxiliares

const router = Router();
const geminiApiKey = process.env.GEMINI_API_KEY || '';
if (!geminiApiKey) throw new Error('GEMINI_API_KEY não definida');

const genAI = new GoogleGenerativeAI(geminiApiKey);

// ─── Definição da função para function calling ──────────────────────────
const pythonExecutorDeclaration: FunctionDeclaration = {
  name: 'python_executor',
  description: 'Executa código Python em um ambiente isolado e seguro para cálculos, processamento de dados ou tarefas programáticas.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Código Python completo a ser executado.'
      },
      timeout: {
        type: 'integer',
        description: 'Tempo máximo em segundos (padrão 5).'
      },
      memory_limit_mb: {
        type: 'integer',
        description: 'Limite de memória em MB (padrão 128).'
      }
    },
    required: ['code']
  }
};

const tools: Tool[] = [{
  functionDeclarations: [pythonExecutorDeclaration]
}];

// ─── Função para executar a ferramenta (sandbox) ──────────────────────
async function executeToolCall(functionCall: any): Promise<any> {
  if (functionCall.name === 'python_executor') {
    const args = functionCall.args || {};
    const code = args.code;
    const timeout = args.timeout || 5;
    const memoryLimitMb = args.memory_limit_mb || 128;
    const result = await executePython(code, timeout, memoryLimitMb);
    return {
      name: 'python_executor',
      response: {
        success: result.success,
        output: result.output,
        error: result.error,
        duration_ms: result.durationMs
      }
    };
  }
  throw new Error(`Função desconhecida: ${functionCall.name}`);
}

// ─── Rota principal de chat (streaming ou non-streaming) ─────────────
// Esta rota é chamada pelo frontend via POST /api/messages/stream ou /api/messages
// Aqui mostraremos a lógica central para o fluxo IA.

router.post('/chat', async (req: Request, res: Response) => {
  const { message, history = [], modelMode = 'flash' } = req.body;
  // modelMode: 'flash' (Groq + Gemini para formatação) ou 'pro' (Gemini com function calling)

  try {
    // 1. Classificação local (Regex)
    let needsComputation = classifyIntent(message); // função booleana

    // 2. Se não detectado, fallback para Groq (opcional)
    if (!needsComputation) {
      // Chama Groq para classificação (pode ser feito via HTTP ou biblioteca)
      // Exemplo: const groqResult = await callGroqForClassification(message);
      // needsComputation = groqResult;
    }

    if (modelMode === 'flash') {
      // ── Modo Flash ─────────────────────────────────────────────
      if (needsComputation) {
        // 3. Gera código Python via Groq
        const code = await generateCodeWithGroq(message, history);
        // 4. Executa no sandbox
        const execResult = await executePython(code, 5, 128);
        // 5. Formata resposta final com Gemini (passando resultado)
        const finalResponse = await generateResponseWithGemini(
          message,
          history,
          `Resultado da execução:\n${execResult.output || execResult.error}`,
          execResult.success
        );
        res.json({ response: finalResponse });
      } else {
        // Sem necessidade de computação: usa Gemini diretamente (ou Groq, conforme preferência)
        const finalResponse = await generateResponseWithGemini(message, history, '', true);
        res.json({ response: finalResponse });
      }
    } else {
      // ── Modo PRO (Gemini com function calling) ──────────────────
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

      // Prepara histórico no formato Gemini
      const chat = model.startChat({
        history: history.map((msg: any) => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        })),
        tools: tools,
        generationConfig: { temperature: 0.3 }
      });

      // Envia a mensagem do usuário
      let result = await chat.sendMessage(message);
      let response = result.response;

      // Loop para processar function calls
      let maxIterations = 5;
      while (maxIterations-- > 0) {
        const call = response.functionCalls?.[0];
        if (!call) break;

        // Executa a ferramenta solicitada
        const toolResult = await executeToolCall(call);

        // Envia o resultado de volta para o Gemini
        const toolResponse = await chat.sendMessage([{
          functionResponse: {
            name: toolResult.name,
            response: toolResult.response
          }
        }]);
        response = toolResponse.response;
      }

      // Resposta final (texto)
      const finalText = response.text();
      res.json({ response: finalText });
    }
  } catch (error: any) {
    console.error('Erro no roteador de IA:', error);
    res.status(500).json({ error: 'Erro ao processar a mensagem.' });
  }
});

export default router;