// ============================================================
//  aiService.js — Camada de IA do Solaris (MVP)
//
//  TEXTO (geração de respostas):
//    Groq  →  llama-3.3-70b-versatile  (rápido, gratuito)
//
//  EMBEDDING (memória semântica):
//    Desativado no MVP — memória usa as mais recentes por ora.
//    TODO: adicionar Cohere ou outro provedor de embedding gratuito.
//
//  IMAGENS:
//    TODO: implementar quando necessário.
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
const GROQ_MODEL = 'llama-3.3-70b-versatile'; // troque por 'llama3-8b-8192' para respostas mais rápidas

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

// ─── PROVEDOR DE TEXTO: Groq ──────────────────────────────────────────────────

export async function generateText(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await withRetry(() =>
      fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2048,
          temperature: 0.7,
        }),
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
    return { text, provider: 'groq' };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── EMBEDDING: desativado no MVP ────────────────────────────────────────────
//  Groq não possui modelo de embedding próprio.
//  Retorna null — o sistema usa memórias recentes como fallback.

export async function generateEmbedding(_text) {
  return null;
}

// ─── Busca memórias (sem embedding: retorna as mais recentes) ─────────────────

export async function findSimilarMemories(projectId, _queryEmbedding, limit = 5, global = false) {
  let sql = 'SELECT id, content, project_id FROM memories';
  const params = [];
  if (!global) {
    sql += ' WHERE project_id = ?';
    params.push(projectId);
  }
  sql += ` ORDER BY created_at DESC LIMIT ${limit}`;
  return await allAsync(sql, params);
}

// ─── System prompt ────────────────────────────────────────────────────────────

export async function buildSystemPrompt(projectId, userMessage, memoryMode) {
  const project = await getAsync('SELECT * FROM projects WHERE id = ?', [projectId]);
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
  prompt += `Diretrizes gerais: evite respostas genéricas, priorize utilidade prática. Nunca invente informações.\n\n`;

  let memories = [];
  if (memoryMode === 'isolado') {
    memories = await findSimilarMemories(projectId, null, 5, false);
  } else if (memoryMode === 'global') {
    memories = await findSimilarMemories(projectId, null, 8, true);
  }

  if (memories.length > 0) {
    prompt += `=== MEMÓRIAS RECENTES ===\n`;
    memories.forEach((m, i) => { prompt += `[${i + 1}] ${m.content}\n`; });
    prompt += '\n';
  }

  const files = await allAsync(
    'SELECT original_name, extracted_text FROM files WHERE project_id = ?',
    [projectId]
  );
  if (files.length > 0) {
    prompt += `=== ARQUIVOS DE REFERÊNCIA ===\n`;
    for (const file of files) {
      const snippet = file.extracted_text?.substring(0, 2000) || 'Sem texto extraído';
      const truncated = file.extracted_text?.length > 2000 ? '... [truncado]' : '';
      prompt += `\n[ARQUIVO: ${file.original_name}]\n${snippet}${truncated}\n`;
    }
    prompt += '\n';
  }

  return prompt;
}

// ─── Extrai e salva memórias importantes ─────────────────────────────────────

async function extractAndSaveMemories(projectId, userMessage, assistantResponse) {
  const importantKeywords = [
    'importante', 'lembre-se', 'concluímos', 'aprendemos', 'descobrimos',
    'fato', 'sabemos que', 'definimos', 'decidimos', 'sempre', 'nunca',
    'padrão', 'regra', 'convenção', 'arquitetura', 'estrutura', 'configuração',
  ];

  const candidates = assistantResponse
    .split(/[.!?]+\s+/)
    .filter(s => s.trim().length > 50 && importantKeywords.some(kw => s.toLowerCase().includes(kw)))
    .slice(0, 2);

  for (const trimmed of candidates) {
    await runAsync(
      'INSERT INTO memories (project_id, content, embedding, source) VALUES (?, ?, ?, ?)',
      [projectId, trimmed, null, 'auto']
    );
    console.log('💾 Memória salva:', trimmed.substring(0, 60) + '...');
  }
}

// ─── Atualiza título do chat ──────────────────────────────────────────────────

async function updateChatTitle(chatId, userMessage) {
  try {
    const prompt = `Gere um título curto (máximo 5 palavras) para uma conversa que começa com: "${userMessage.substring(0, 100)}". Responda apenas com o título, sem aspas ou pontuação final.`;
    const { text } = await generateText(prompt);
    const title = text.trim().substring(0, 50);
    await runAsync('UPDATE chats SET title = ? WHERE id = ?', [title, chatId]);
    return title;
  } catch {
    return null;
  }
}

// ─── Envia mensagem principal ─────────────────────────────────────────────────

export async function sendMessage(projectId, chatId, userMessage) {
  await runAsync(
    'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
    [chatId, 'user', userMessage]
  );

  const history = await allAsync(
    'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC',
    [chatId]
  );
  const isFirstMessage = history.length === 1;

  const project = await getAsync(
    'SELECT memory_mode, response_style, objective FROM projects WHERE id = ?',
    [projectId]
  );
  if (!project) throw new Error('Projeto não encontrado');

  const systemPrompt = await buildSystemPrompt(projectId, userMessage, project.memory_mode);

  let fullPrompt = systemPrompt + `=== HISTÓRICO DA CONVERSA ===\n`;
  for (const msg of history.slice(0, -1).slice(-20)) {
    fullPrompt += `${msg.role === 'user' ? 'Usuário' : 'Assistente'}: ${msg.content}\n`;
  }
  fullPrompt += `\nUsuário: ${userMessage}\nAssistente:`;

  const { text: responseText } = await generateText(fullPrompt);

  await runAsync(
    'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
    [chatId, 'assistant', responseText]
  );
  await runAsync('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [chatId]);

  if (isFirstMessage) updateChatTitle(chatId, userMessage).catch(console.error);
  extractAndSaveMemories(projectId, userMessage, responseText).catch(console.error);

  return responseText;
}