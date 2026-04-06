// ============================================================
//  aiService.js — Camada de IA do Solaris
//
//  PROVEDOR: Groq  →  llama-3.3-70b-versatile
//
//  Variáveis de ambiente necessárias:
//    GROQ_API_KEY  →  https://console.groq.com
// ============================================================

import { getAsync, allAsync, runAsync } from './database.js';

const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  throw new Error('❌ GROQ_API_KEY não definida nas variáveis de ambiente');
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ─── Retry com backoff exponencial ───────────────────────────────────────────

async function withRetry(fn, maxRetries = 3, baseDelay = 3000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.message?.includes('429') || err.status === 429;
      const isLast = attempt === maxRetries;
      if (is429 && !isLast) {
        const waitMs = baseDelay * Math.pow(2, attempt);
        console.warn(`⚠️ Rate limit (429). Aguardando ${waitMs / 1000}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
}

// ─── Geração de texto via Groq ────────────────────────────────────────────────

export async function generateText(messages, systemPrompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const body = {
      model: GROQ_MODEL,
      max_tokens: 2048,
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    };

    const response = await withRetry(() =>
      fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Groq ${response.status}: ${err.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const text = data.choices[0].message.content;
    console.log('✅ Groq respondeu');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Busca memórias recentes (sem embedding) ──────────────────────────────────

async function findMemories(projectId, limit = 5, global = false) {
  if (global) {
    return await allAsync(
      `SELECT id, content, project_id FROM memories ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
  }
  return await allAsync(
    `SELECT id, content, project_id FROM memories WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [projectId, limit]
  );
}

// ─── Monta system prompt ──────────────────────────────────────────────────────

async function buildSystemPrompt(projectId, memoryMode) {
  const project = await getAsync('SELECT * FROM projects WHERE id = $1', [projectId]);
  if (!project) return 'Você é um assistente de IA útil e preciso.';

  const styleGuide = {
    direto: 'Seja direto, objetivo e conciso. Sem rodeios.',
    técnico: 'Use terminologia técnica precisa. Inclua detalhes de implementação quando relevante.',
    analítico: 'Analise profundamente, apresente prós e contras, avalie diferentes perspectivas.',
    estratégico: 'Foque em planejamento, impacto de longo prazo e visão macro.',
  };

  let prompt = `Você é o Solaris, um assistente de IA especializado operando dentro de um projeto específico.\n\n`;
  prompt += `=== CONTEXTO DO PROJETO ===\n`;
  prompt += `Nome: ${project.name}\n`;
  prompt += `Objetivo: ${project.objective || 'Ajudar o usuário em suas tarefas'}\n`;
  prompt += `Estilo: ${styleGuide[project.response_style] || styleGuide.direto}\n\n`;
  prompt += `Diretrizes: evite respostas genéricas, priorize utilidade prática. Nunca invente informações.\n\n`;

  const memories = await findMemories(projectId, memoryMode === 'global' ? 8 : 5, memoryMode === 'global');
  if (memories.length > 0) {
    prompt += `=== MEMÓRIAS RECENTES ===\n`;
    memories.forEach((m, i) => { prompt += `[${i + 1}] ${m.content}\n`; });
    prompt += '\n';
  }

  const files = await allAsync(
    'SELECT original_name, extracted_text FROM files WHERE project_id = $1',
    [projectId]
  );
  if (files.length > 0) {
    const MAX_CHARS = 12000;
    let used = prompt.length;
    prompt += `=== ARQUIVOS DE REFERÊNCIA ===\n`;
    for (const file of files) {
      const snippet = file.extracted_text?.substring(0, 2000) || 'Sem texto extraído';
      const truncated = file.extracted_text?.length > 2000 ? '... [truncado]' : '';
      const block = `\n[ARQUIVO: ${file.original_name}]\n${snippet}${truncated}\n`;
      if (used + block.length > MAX_CHARS) break;
      prompt += block;
      used += block.length;
    }
    prompt += '\n';
  }

  return prompt;
}

// ─── Extrai e salva memórias importantes ─────────────────────────────────────

async function extractAndSaveMemories(projectId, assistantResponse) {
  const keywords = [
    'importante', 'lembre-se', 'concluímos', 'aprendemos', 'descobrimos',
    'fato', 'sabemos que', 'definimos', 'decidimos', 'sempre', 'nunca',
    'padrão', 'regra', 'convenção', 'arquitetura', 'estrutura', 'configuração',
  ];

  const candidates = assistantResponse
    .split(/[.!?]+\s+/)
    .filter(s => s.trim().length > 50 && keywords.some(kw => s.toLowerCase().includes(kw)))
    .slice(0, 2);

  for (const content of candidates) {
    await runAsync(
      'INSERT INTO memories (project_id, content, source) VALUES ($1, $2, $3)',
      [projectId, content.trim(), 'auto']
    );
    console.log('💾 Memória salva:', content.substring(0, 60) + '...');
  }
}

// ─── Atualiza título do chat ──────────────────────────────────────────────────

async function updateChatTitle(chatId, userMessage) {
  try {
    const titlePrompt = `Gere um título curto (máximo 5 palavras) para uma conversa que começa com: "${userMessage.substring(0, 100)}". Responda apenas com o título, sem aspas ou pontuação final.`;
    const title = await generateText(
      [{ role: 'user', content: titlePrompt }],
      'Você gera títulos curtos e precisos.'
    );
    const clean = title.trim().substring(0, 50);
    await runAsync('UPDATE chats SET title = $1 WHERE id = $2', [clean, chatId]);
    return clean;
  } catch {
    return null;
  }
}

// ─── Envia mensagem principal ─────────────────────────────────────────────────

export async function sendMessage(projectId, chatId, userMessage) {
  await runAsync(
    'INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3)',
    [chatId, 'user', userMessage]
  );

  const history = await allAsync(
    'SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
    [chatId]
  );
  const isFirstMessage = history.length === 1;

  const project = await getAsync(
    'SELECT memory_mode FROM projects WHERE id = $1',
    [projectId]
  );
  if (!project) throw new Error('Projeto não encontrado');

  const systemPrompt = await buildSystemPrompt(projectId, project.memory_mode);

  // Últimas 20 mensagens como histórico para o modelo
  const apiMessages = history.slice(-20).map(m => ({
    role: m.role,
    content: m.content,
  }));

  const responseText = await generateText(apiMessages, systemPrompt);

  await runAsync(
    'INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3)',
    [chatId, 'assistant', responseText]
  );
  await runAsync('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chatId]);

  if (isFirstMessage) updateChatTitle(chatId, userMessage).catch(console.error);
  extractAndSaveMemories(projectId, responseText).catch(console.error);

  return responseText;
}