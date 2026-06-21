// domain/ai/gemini.js — Comunicação com Gemini

const GEMINI_FLASH_API_KEY = process.env.GEMINI_FLASH_API_KEY;
const GEMINI_PRO_API_KEY   = process.env.GEMINI_PRO_API_KEY;

if (!GEMINI_FLASH_API_KEY) throw new Error('❌ GEMINI_FLASH_API_KEY não definida');

// "Pro" e "Flash" usam o mesmo modelo Gemini (gemini-2.5-flash).
// A diferença do modo Pro está no pipeline de pré-processamento
// (classificação de intenção, síntese de memórias), não no modelo LLM.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export function getGeminiConfig(modelKey) {
  const key = (modelKey === 'pro' && GEMINI_PRO_API_KEY) ? GEMINI_PRO_API_KEY : GEMINI_FLASH_API_KEY;
  const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}`;
  return { key, modelName: GEMINI_MODEL, baseUrl };
}

export function geminiUrl(modelKey, stream = false) {
  const { baseUrl, key } = getGeminiConfig(modelKey);
  return stream
    ? `${baseUrl}:streamGenerateContent?key=${key}&alt=sse`
    : `${baseUrl}:generateContent?key=${key}`;
}

const MAX_OUTPUT_TOKENS = {
  flash: 8192,   // era 1024 — muito baixo para gerar código completo
  pro:   16384,  // era 2048 — insuficiente para respostas longas
};

export function buildGeminiBody(messages, systemPrompt, modelKey = 'flash') {
  const contents = messages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));
  return {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS[modelKey] ?? MAX_OUTPUT_TOKENS.flash,
      // FIX VELOCIDADE: desativa o "thinking" do Gemini 2.5 Flash.
      // O thinking adiciona latência significativa sem benefício para um chat.
      // thinkingBudget: 0 → resposta imediata sem etapa de raciocínio interno.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
}

// ─── withRetry: trata 429 tanto de exceções quanto de respostas HTTP ─────────
// CORREÇÃO: fetch() não lança erro em respostas 4xx — withRetry nunca
// detectava o 429 do Gemini. Agora o callback lança explicitamente, e o
// retry com backoff exponencial funciona de verdade.
export async function withRetry(fn, maxRetries = 3, baseDelay = 3000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.status === 429 || err.message?.includes('429');
      if (is429 && attempt < maxRetries) {
        const wait = baseDelay * Math.pow(2, attempt);
        console.warn(`⚠️ Rate limit Gemini (tentativa ${attempt + 1}/${maxRetries}). Aguardando ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
}

// ─── Stream com timeout por inatividade ───────────────────────────────────
const STREAM_INACTIVITY_MS = 45_000; // 45 s sem chunk → aborta

export async function* streamGeminiChat(messages, systemPrompt, modelKey = 'flash') {
  const url  = geminiUrl(modelKey, true);
  const body = buildGeminiBody(messages, systemPrompt, modelKey);

  const controller = new AbortController();
  let inactivityTimer = setTimeout(() => controller.abort(), STREAM_INACTIVITY_MS);

  const resetTimer = () => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => controller.abort(), STREAM_INACTIVITY_MS);
  };

  let response;
  try {
    // FIX: lança erro explícito no 429 para withRetry poder retentar
    response = await withRetry(async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status === 429) {
        const err = new Error(`Gemini rate limit (429)`);
        err.status = 429;
        throw err;
      }
      return res;
    });
  } catch (err) {
    clearTimeout(inactivityTimer);
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('Timeout no streaming do Gemini'), { status: 504 });
    }
    throw err;
  }

  if (!response.ok) {
    clearTimeout(inactivityTimer);
    const errorText = await response.text();
    throw new Error(`Gemini streaming error: ${response.status} - ${errorText}`);
  }

  const reader  = response.body.getReader();
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
          const parsed      = JSON.parse(data);
          const candidate   = parsed.candidates?.[0];
          const chunk       = candidate?.content?.parts?.[0]?.text;
          const finishReason = candidate?.finishReason;

          if (chunk) yield { chunk };
          if (finishReason === 'MAX_TOKENS') hitMaxTokens = true;
        } catch { /* ignora linha malformada */ }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('Timeout por inatividade no stream'), { status: 504 });
    }
    throw err;
  } finally {
    clearTimeout(inactivityTimer);
    reader.cancel().catch(() => {});
  }

  if (hitMaxTokens) yield { maxTokens: true };
}

export async function geminiChat(messages, systemPrompt, modelKey = 'flash') {
  const url  = geminiUrl(modelKey, false);
  const body = buildGeminiBody(messages, systemPrompt, modelKey);

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 30_000);

  try {
    // FIX: mesma correção — lança erro no 429 para withRetry funcionar
    const res = await withRetry(async () => {
      const r = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  controller.signal,
      });
      if (r.status === 429) {
        const err = new Error(`Gemini rate limit (429)`);
        err.status = 429;
        throw err;
      }
      return r;
    });

    if (!res.ok) {
      const err = new Error(`Erro na IA: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data         = await res.json();
    const candidate    = data.candidates[0];
    const text         = candidate.content.parts[0].text;
    const finishReason = candidate.finishReason;

    return { text, maxTokens: finishReason === 'MAX_TOKENS' };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Timeout ao chamar IA');
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Modo Agente Autônomo: function calling real do Gemini ────────────────
// Declaração das ferramentas que o modelo pode decidir chamar. A execução de
// fato (rag_search/python_sandbox/web_search) acontece no router do agente
// (domain/routers/agent.js) — aqui só descrevemos a "assinatura" pro Gemini.
export const AGENT_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'rag_search',
        description: 'Busca trechos relevantes nos documentos e fontes anexados ao projeto atual. Só funciona dentro de um projeto com arquivos indexados.',
        parameters: {
          type: 'OBJECT',
          properties: { query: { type: 'STRING', description: 'O que buscar nos documentos do projeto' } },
          required: ['query'],
        },
      },
      {
        name: 'python_sandbox',
        description: 'Executa um trecho de código Python (sem acesso a rede ou disco) em um sandbox isolado e retorna stdout/stderr. Útil para cálculos, manipulação de dados e validação de lógica.',
        parameters: {
          type: 'OBJECT',
          properties: { code: { type: 'STRING', description: 'Código Python completo a ser executado' } },
          required: ['code'],
        },
      },
      {
        name: 'web_search',
        description: 'Busca informações atuais na internet.',
        parameters: {
          type: 'OBJECT',
          properties: { query: { type: 'STRING', description: 'Termo de busca' } },
          required: ['query'],
        },
      },
    ],
  },
];

// Converte o formato interno {role:'user'|'assistant', content} (usado em todo
// o resto do app) pro formato nativo do Gemini ({role:'user'|'model', parts}).
// Usado só pra SEMEAR o array `contents` na 1ª iteração do loop — depois disso,
// o próprio agent.js vai empilhando turnos nativos (com functionCall/functionResponse).
export function toGeminiContents(messages) {
  return (messages || []).map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));
}

// Uma "rodada" de decisão do agente: manda o histórico (já em formato nativo
// Gemini) + as ferramentas disponíveis, e devolve o que o modelo decidiu fazer
// — texto final, chamadas de função, e (opcionalmente) o resumo do raciocínio.
//
// Não é streaming de propósito: streaming + function calling simultâneos
// complicariam bastante o parsing sem trazer ganho real aqui, já que cada
// "rodada" tende a ser curta (uma decisão de ferramenta ou a resposta final).
// O efeito de digitação no texto final é simulado no router (streamTextAsDeltas).
export async function callGeminiWithTools(contents, systemPrompt, modelKey = 'flash', { signal, includeThoughts = false } = {}) {
  const { baseUrl, key } = getGeminiConfig(modelKey);
  const url = `${baseUrl}:generateContent?key=${key}`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    tools: AGENT_TOOLS,
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS[modelKey] ?? MAX_OUTPUT_TOKENS.flash,
      thinkingConfig: includeThoughts
        ? { thinkingBudget: -1, includeThoughts: true } // -1 = orçamento dinâmico (o modelo decide quanto "pensar")
        : { thinkingBudget: 0 },
    },
  };

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

  if (!res.ok) {
    const errorText = await res.text();
    const err = new Error(`Erro na IA: ${res.status} - ${errorText}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  let text = '';
  let thought = '';
  const functionCalls = [];
  for (const part of parts) {
    if (part.functionCall) functionCalls.push({ name: part.functionCall.name, args: part.functionCall.args || {}, id: part.functionCall.id });
    else if (part.thought) thought += part.text || '';
    else if (part.text) text += part.text;
  }

  return {
    text,
    thought,
    functionCalls,
    finishReason: candidate?.finishReason,
    // Conteúdo bruto retornado pelo Gemini — deve ser empilhado verbatim em
    // `contents` antes da próxima rodada (recomendação oficial da API pra
    // manter o contexto de function calling coerente entre turnos).
    rawModelContent: candidate?.content,
  };
}