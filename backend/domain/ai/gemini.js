// domain/ai/gemini.js — Comunicação com Gemini

const GEMINI_FLASH_API_KEY = process.env.GEMINI_FLASH_API_KEY;
const GEMINI_PRO_API_KEY = process.env.GEMINI_PRO_API_KEY;

if (!GEMINI_FLASH_API_KEY) throw new Error('❌ GEMINI_FLASH_API_KEY não definida');

export function getGeminiConfig(modelKey) {
  const key = modelKey === 'pro' ? GEMINI_PRO_API_KEY : GEMINI_FLASH_API_KEY;
  if (!key) throw new Error(`Chave API não configurada para o modelo ${modelKey}`);
  const modelName = modelKey === 'pro' ? 'gemini-3-flash-preview' : 'gemini-2.5-flash';
  const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}`;
  return { key, modelName, baseUrl };
}

export function geminiUrl(modelKey, stream = false) {
  const { baseUrl, key } = getGeminiConfig(modelKey);
  return stream ? `${baseUrl}:streamGenerateContent?key=${key}&alt=sse` : `${baseUrl}:generateContent?key=${key}`;
}

export function buildGeminiBody(messages, systemPrompt) {
  const contents = messages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));
  return {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { maxOutputTokens: 2048 },
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

export async function* streamGeminiChat(messages, systemPrompt, modelKey = 'flash') {
  const url = geminiUrl(modelKey, true);
  const body = buildGeminiBody(messages, systemPrompt);
  const response = await withRetry(() =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini streaming error: ${response.status} - ${errorText}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const chunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (chunk) yield chunk;
        } catch (e) { }
      }
    }
  }
}

export async function geminiChat(messages, systemPrompt, modelKey = 'flash') {
  const url = geminiUrl(modelKey, false);
  const body = buildGeminiBody(messages, systemPrompt);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await withRetry(() =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal })
    );
    if (!res.ok) {
      const err = new Error(`Erro na IA: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return data.candidates[0].content.parts[0].text;
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