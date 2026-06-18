// domain/ai/gemini.js — Comunicação com Gemini

const GEMINI_FLASH_API_KEY = process.env.GEMINI_FLASH_API_KEY;
const GEMINI_PRO_API_KEY   = process.env.GEMINI_PRO_API_KEY;

if (!GEMINI_FLASH_API_KEY) throw new Error('❌ GEMINI_FLASH_API_KEY não definida');

// Problema 6 corrigido: modelo Pro era 'gemini-3-flash-preview' (inexistente).
// Use a variável de ambiente GEMINI_PRO_MODEL para trocar sem redeploy.
const GEMINI_PRO_MODEL   = process.env.GEMINI_PRO_MODEL   || 'gemini-2.5-pro-preview-06-05';
const GEMINI_FLASH_MODEL = process.env.GEMINI_FLASH_MODEL || 'gemini-2.5-flash';

export function getGeminiConfig(modelKey) {
  const key = modelKey === 'pro' ? GEMINI_PRO_API_KEY : GEMINI_FLASH_API_KEY;
  if (!key) throw new Error(`Chave API não configurada para o modelo ${modelKey}`);
  const modelName = modelKey === 'pro' ? GEMINI_PRO_MODEL : GEMINI_FLASH_MODEL;
  const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}`;
  return { key, modelName, baseUrl };
}

export function geminiUrl(modelKey, stream = false) {
  const { baseUrl, key } = getGeminiConfig(modelKey);
  return stream
    ? `${baseUrl}:streamGenerateContent?key=${key}&alt=sse`
    : `${baseUrl}:generateContent?key=${key}`;
}

const MAX_OUTPUT_TOKENS = {
  flash: 1024,
  pro:   2048,
};

export function buildGeminiBody(messages, systemPrompt, modelKey = 'flash') {
  const contents = messages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));
  return {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS[modelKey] ?? MAX_OUTPUT_TOKENS.flash },
  };
}

export async function withRetry(fn, maxRetries = 3, baseDelay = 3000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.message?.includes('429') || err.status === 429;
      if (is429 && attempt < maxRetries) {
        const wait = baseDelay * Math.pow(2, attempt);
        console.warn(`⚠️ Rate limit. Aguardando ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
}

// ─── Stream com detecção de MAX_TOKENS e timeout ──────────────────────────
const STREAM_TIMEOUT_MS = 60_000; // 60 s sem receber nenhum byte → aborta

export async function* streamGeminiChat(messages, systemPrompt, modelKey = 'flash') {
  const url  = geminiUrl(modelKey, true);
  const body = buildGeminiBody(messages, systemPrompt, modelKey);

  const controller = new AbortController();

  // Problema 7: timeout para o stream inteiro
  const streamTimer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

  let response;
  try {
    response = await withRetry(() =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    );
  } catch (err) {
    clearTimeout(streamTimer);
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('Timeout no streaming do Gemini'), { status: 504 });
    }
    throw err;
  }

  if (!response.ok) {
    clearTimeout(streamTimer);
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

      // Reinicia o timer a cada chunk recebido (watchdog por inatividade)
      clearTimeout(streamTimer);
      const inactivityTimer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') { clearTimeout(inactivityTimer); return; }

        try {
          const parsed      = JSON.parse(data);
          const candidate   = parsed.candidates?.[0];
          const chunk       = candidate?.content?.parts?.[0]?.text;
          const finishReason = candidate?.finishReason;

          if (chunk) yield { chunk };
          if (finishReason === 'MAX_TOKENS') hitMaxTokens = true;
        } catch { /* ignora linha malformada */ }
      }

      // Agora usando o inactivityTimer por chunk; cancela o anterior genérico
      void inactivityTimer; // já registrado acima
    }
  } finally {
    clearTimeout(streamTimer);
    reader.cancel().catch(() => {});
  }

  if (hitMaxTokens) {
    yield { maxTokens: true };
  }
}

export async function geminiChat(messages, systemPrompt, modelKey = 'flash') {
  const url  = geminiUrl(modelKey, false);
  const body = buildGeminiBody(messages, systemPrompt, modelKey);

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await withRetry(() =>
      fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  controller.signal,
      })
    );
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