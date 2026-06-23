// domain > ai > JS gemini.js

// ---------------------------------------------------------------------------
// Chaves de API do Gemini
// ---------------------------------------------------------------------------

const GEMINI_FLASH_API_KEY = process.env.GEMINI_FLASH_API_KEY;
const GEMINI_PRO_API_KEY = process.env.GEMINI_PRO_API_KEY;

if (!GEMINI_FLASH_API_KEY) throw new Error('GEMINI_FLASH_API_KEY is not defined');

// ---------------------------------------------------------------------------
// Modelo utilizado
// ---------------------------------------------------------------------------

// Ambos os modos "Pro" e "Flash" utilizam o mesmo modelo base (gemini-2.5-flash).
// A diferenca entre os pipelines esta no pre-processamento (classificacao de
// intencao, sintese de memoria), nao no LLM subjacente.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// ---------------------------------------------------------------------------
// Funcoes de configuracao e URL
// ---------------------------------------------------------------------------

/**
 * Retorna a configuracao (chave, nome do modelo e URL base) para o modo
 * selecionado. Se a chave Pro estiver definida e o modo for "pro", utiliza-a;
 * caso contrario, utiliza a chave Flash.
 *
 * @param {string} modelKey - Modo do modelo: "flash" ou "pro".
 * @returns {{ key: string, modelName: string, baseUrl: string }}
 */
export function getGeminiConfig(modelKey) {
  const key =
    modelKey === 'pro' && GEMINI_PRO_API_KEY ? GEMINI_PRO_API_KEY : GEMINI_FLASH_API_KEY;
  const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}`;
  return { key, modelName: GEMINI_MODEL, baseUrl };
}

/**
 * Monta a URL completa para chamadas a API do Gemini.
 *
 * @param {string} modelKey - Modo do modelo: "flash" ou "pro".
 * @param {boolean} stream - Se true, utiliza o endpoint de streaming (SSE).
 * @returns {string} URL completa com chave de API.
 */
export function geminiUrl(modelKey, stream = false) {
  const { baseUrl, key } = getGeminiConfig(modelKey);
  return stream
    ? `${baseUrl}:streamGenerateContent?key=${key}&alt=sse`
    : `${baseUrl}:generateContent?key=${key}`;
}

// ---------------------------------------------------------------------------
// Limites de tokens por modo
// ---------------------------------------------------------------------------

const MAX_OUTPUT_TOKENS = {
  flash: 8192,
  pro: 16384,
};

// ---------------------------------------------------------------------------
// Construcao do corpo da requisicao
// ---------------------------------------------------------------------------

/**
 * Converte mensagens no formato interno {role, content} para o corpo
 * esperado pela API do Gemini, incluindo instrucao de sistema e
 * configuracoes de geracao.
 *
 * @param {object[]} messages - Lista de mensagens no formato {role, content}.
 * @param {string} systemPrompt - Instrucao de sistema.
 * @param {string} modelKey - Modo do modelo: "flash" ou "pro".
 * @returns {object} Corpo JSON pronto para envio a API.
 */
export function buildGeminiBody(messages, systemPrompt, modelKey = 'flash') {
  const contents = messages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  return {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS[modelKey] ?? MAX_OUTPUT_TOKENS.flash,
      // thinkingBudget: 0 desabilita a etapa de pensamento do Gemini 2.5 Flash,
      // reduzindo significativamente a latencia para uso conversacional.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
}

// ---------------------------------------------------------------------------
// Retentativa com backoff exponencial
// ---------------------------------------------------------------------------

/**
 * Executa uma funcao com retentativas em caso de erro 429 (Rate Limit).
 *
 * Nota: fetch() nao lanca excecao para respostas 4xx, portanto o callback
 * deve lancar explicitamente um erro com status 429 para que a retentativa
 * seja acionada.
 *
 * @param {Function} fn - Funcao assincrona a ser executada.
 * @param {number} maxRetries - Numero maximo de retentativas (padrao: 3).
 * @param {number} baseDelay - Atraso base em ms para backoff exponencial (padrao: 3000).
 * @returns {Promise<any>} Resultado de fn().
 */
export async function withRetry(fn, maxRetries = 3, baseDelay = 3000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.status === 429 || err.message?.includes('429');

      if (is429 && attempt < maxRetries) {
        const wait = baseDelay * Math.pow(2, attempt);
        console.warn(
          `Gemini rate limit (attempt ${attempt + 1}/${maxRetries}). Waiting ${wait / 1000}s...`
        );
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Streaming com timeout de inatividade
// ---------------------------------------------------------------------------

// Tempo maximo sem atividade no stream antes de abortar a conexao.
// Evita conexoes penduradas indefinidamente.
const STREAM_INACTIVITY_MS = 45_000;

/**
 * Gerador assincrono que realiza streaming de respostas do Gemini.
 *
 * Cada chunk produzido contem a propriedade "chunk" com o texto parcial.
 * Ao final, se o limite de tokens for atingido, produz um chunk com
 * a propriedade "maxTokens": true.
 *
 * @param {object[]} messages - Historico de mensagens no formato {role, content}.
 * @param {string} systemPrompt - Instrucao de sistema.
 * @param {string} modelKey - Modo do modelo: "flash" ou "pro".
 * @yields {object} Chunk com texto parcial ou sinalizacao de limite de tokens.
 */
export async function* streamGeminiChat(messages, systemPrompt, modelKey = 'flash') {
  const url = geminiUrl(modelKey, true);
  const body = buildGeminiBody(messages, systemPrompt, modelKey);

  // ---------------------------------------------------------------------------
  // Controle de timeout por inatividade
  // ---------------------------------------------------------------------------

  const controller = new AbortController();
  let inactivityTimer = setTimeout(() => controller.abort(), STREAM_INACTIVITY_MS);

  const resetTimer = () => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => controller.abort(), STREAM_INACTIVITY_MS);
  };

  // ---------------------------------------------------------------------------
  // Execucao da requisicao com retentativa
  // ---------------------------------------------------------------------------

  let response;
  try {
    response = await withRetry(async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.status === 429) {
        const err = new Error('Gemini rate limit (429)');
        err.status = 429;
        throw err;
      }

      return res;
    });
  } catch (err) {
    clearTimeout(inactivityTimer);

    if (err.name === 'AbortError') {
      throw Object.assign(new Error('Gemini streaming timeout'), { status: 504 });
    }

    throw err;
  }

  // ---------------------------------------------------------------------------
  // Validacao da resposta HTTP
  // ---------------------------------------------------------------------------

  if (!response.ok) {
    clearTimeout(inactivityTimer);
    const errorText = await response.text();
    throw new Error(`Gemini streaming error: ${response.status} - ${errorText}`);
  }

  // ---------------------------------------------------------------------------
  // Leitura do stream SSE (Server-Sent Events)
  // ---------------------------------------------------------------------------

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let hitMaxTokens = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      resetTimer();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const candidate = parsed.candidates?.[0];
          const chunk = candidate?.content?.parts?.[0]?.text;
          const finishReason = candidate?.finishReason;

          if (chunk) yield { chunk };
          if (finishReason === 'MAX_TOKENS') hitMaxTokens = true;
        } catch {
          // Ignora linhas malformadas do stream
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('Stream inactivity timeout'), { status: 504 });
    }
    throw err;
  } finally {
    clearTimeout(inactivityTimer);
    reader.cancel().catch(() => {});
  }

  // Sinaliza que o limite de tokens foi atingido
  if (hitMaxTokens) yield { maxTokens: true };
}

// ---------------------------------------------------------------------------
// Chamada nao-streaming (resposta completa)
// ---------------------------------------------------------------------------

/**
 * Realiza uma chamada unica (nao-streaming) ao Gemini e retorna a
 * resposta completa.
 *
 * @param {object[]} messages - Historico de mensagens no formato {role, content}.
 * @param {string} systemPrompt - Instrucao de sistema.
 * @param {string} modelKey - Modo do modelo: "flash" ou "pro".
 * @returns {Promise<{ text: string, maxTokens: boolean }>} Resposta completa.
 */
export async function geminiChat(messages, systemPrompt, modelKey = 'flash') {
  const url = geminiUrl(modelKey, false);
  const body = buildGeminiBody(messages, systemPrompt, modelKey);

  // Timeout geral da requisicao (30 segundos)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await withRetry(async () => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (r.status === 429) {
        const err = new Error('Gemini rate limit (429)');
        err.status = 429;
        throw err;
      }

      return r;
    });

    // ---------------------------------------------------------------------------
    // Tratamento de erros HTTP
    // ---------------------------------------------------------------------------

    if (!res.ok) {
      const err = new Error(`AI error: ${res.status}`);
      err.status = res.status;
      throw err;
    }

    // ---------------------------------------------------------------------------
    // Extracao da resposta
    // ---------------------------------------------------------------------------

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;
    const finishReason = candidate?.finishReason;

    // Sem texto: prompt ou resposta bloqueados pelo filtro de seguranca
    // ou outro motivo
    if (!text) {
      const reason = data.promptFeedback?.blockReason || finishReason || 'unknown';
      const err = new Error(
        `Gemini returned no text (reason: ${reason}). Try rephrasing the message.`
      );
      err.status = 400;
      throw err;
    }

    return { text, maxTokens: finishReason === 'MAX_TOKENS' };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('AI request timed out');
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Definicacao de ferramentas para o modo agente (function calling)
// ---------------------------------------------------------------------------

// Declaracoes de funcoes que o Gemini pode invocar no modo agente.
// A execucao real das ferramentas (rag_search, python_sandbox, web_search)
// acontece em domain/routers/agent.js. Estas sao apenas as descricoes de
// schema para o modelo.
export const AGENT_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'rag_search',
        description:
          'Busca trechos relevantes nos documentos e fontes anexados ao projeto atual. So funciona dentro de um projeto com arquivos indexados.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: {
              type: 'STRING',
              description: 'O que buscar nos documentos do projeto',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'python_sandbox',
        description:
          'Executa um trecho de codigo Python (sem acesso a rede ou disco) em um sandbox isolado e retorna stdout/stderr.',
        parameters: {
          type: 'OBJECT',
          properties: {
            code: {
              type: 'STRING',
              description: 'Codigo Python completo a ser executado',
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'web_search',
        description: 'Busca informacoes atuais na internet.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: {
              type: 'STRING',
              description: 'Termo de busca',
            },
          },
          required: ['query'],
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Conversao de formato interno para formato nativo do Gemini
// ---------------------------------------------------------------------------

/**
 * Converte mensagens do formato interno {role, content} para o formato
 * nativo do Gemini {role, parts}.
 *
 * Utilizado para semear o array "contents" na primeira iteracao do loop
 * do agente.
 *
 * @param {object[]} messages - Mensagens no formato {role, content}.
 * @returns {object[]} Mensagens no formato {role, parts}.
 */
export function toGeminiContents(messages) {
  return (messages || []).map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));
}

// ---------------------------------------------------------------------------
// Chamada com function calling (modo agente)
// ---------------------------------------------------------------------------

/**
 * Realiza uma rodada de decisao do agente: envia o historico (em formato
 * nativo do Gemini) e as ferramentas disponiveis, e retorna o que o modelo
 * decidiu fazer: texto final, chamadas de funcao e, opcionalmente, o
 * resumo de raciocinio (thought).
 *
 * @param {object[]} contents - Historico no formato nativo {role, parts}.
 * @param {string} systemPrompt - Instrucao de sistema.
 * @param {string} modelKey - Modo do modelo: "flash" ou "pro".
 * @param {object} options - Opcoes adicionais.
 * @param {AbortSignal} options.signal - Sinal para abortar a requisicao.
 * @param {boolean} options.includeThoughts - Se true, habilita a etapa de
 *   pensamento do modelo (thinking budget ilimitado).
 * @returns {Promise<{ text: string, thought: string, functionCalls: object[],
 *   finishReason: string, rawModelContent: object }>}
 */
export async function callGeminiWithTools(
  contents,
  systemPrompt,
  modelKey = 'flash',
  { signal, includeThoughts = false } = {}
) {
  const { baseUrl, key } = getGeminiConfig(modelKey);
  const url = `${baseUrl}:generateContent?key=${key}`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    tools: AGENT_TOOLS,
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS[modelKey] ?? MAX_OUTPUT_TOKENS.flash,
      thinkingConfig: includeThoughts
        ? { thinkingBudget: -1, includeThoughts: true }
        : { thinkingBudget: 0 },
    },
  };

  // ---------------------------------------------------------------------------
  // Execucao com retentativa
  // ---------------------------------------------------------------------------

  const res = await withRetry(async () => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (r.status === 429) {
      const err = new Error('Gemini rate limit (429)');
      err.status = 429;
      throw err;
    }

    return r;
  });

  // ---------------------------------------------------------------------------
  // Tratamento de erros HTTP
  // ---------------------------------------------------------------------------

  if (!res.ok) {
    const errorText = await res.text();
    const err = new Error(`AI error: ${res.status} - ${errorText}`);
    err.status = res.status;
    throw err;
  }

  // ---------------------------------------------------------------------------
  // Extracao dos componentes da resposta
  // ---------------------------------------------------------------------------

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  let text = '';
  let thought = '';
  const functionCalls = [];

  for (const part of parts) {
    if (part.functionCall) {
      functionCalls.push({
        name: part.functionCall.name,
        args: part.functionCall.args || {},
        id: part.functionCall.id,
      });
    } else if (part.thought) {
      thought += part.text || '';
    } else if (part.text) {
      text += part.text;
    }
  }

  return {
    text,
    thought,
    functionCalls,
    finishReason: candidate?.finishReason,
    rawModelContent: candidate?.content,
  };
}