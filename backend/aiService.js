// ============================================================
//  aiService.js — Camada de IA do Solaris
//  Arquitetura de provedores (atualizar aqui para trocar modelos):
//
//  TEXTO (geração de respostas):
//    1º  DeepSeek  →  deepseek-chat  (principal, mais barato)
//    2º  Gemini    →  gemini-1.5-flash  (fallback automático)
//
//  EMBEDDING (memória semântica):
//    Gemini  →  gemini-embedding-001
//    (DeepSeek não possui modelo de embedding próprio ainda)
//
//  IMAGENS (geração):
//    Gemini  →  imagen-3.0-generate-002
//    (ativado apenas quando o usuário solicitar explicitamente)
//
//  Variáveis de ambiente necessárias:
//    DEEPSEEK_API_KEY   → https://platform.deepseek.com
//    GEMINI_API_KEY     → https://aistudio.google.com
// ============================================================

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getAsync, allAsync, runAsync } from './database.js';

// ─── Clientes ────────────────────────────────────────────────────────────────

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  throw new Error('❌ GEMINI_API_KEY não definida nas variáveis de ambiente');
}
if (!DEEPSEEK_API_KEY) {
  console.warn('⚠️  DEEPSEEK_API_KEY não definida — usando apenas Gemini como fallback');
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Modelos Gemini
const geminiChat = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });       // fallback de texto
const geminiEmbed = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });   // embeddings
// const geminiImage = genAI.getGenerativeModel({ model: 'imagen-3.0-generate-002' }); // imagens (quando necessário)

// ─── Rate limiter de embeddings (free tier: ~5 RPM) ──────────────────────────

const embeddingQueue = { lastCalls: [], maxPerMinute: 3 };

function canCallEmbedding() {
  const now = Date.now();
  embeddingQueue.lastCalls = embeddingQueue.lastCalls.filter(t => now - t < 60000);
  return embeddingQueue.lastCalls.length < embeddingQueue.maxPerMinute;
}
function registerEmbeddingCall() {
  embeddingQueue.lastCalls.push(Date.now());
}

// ─── Retry com backoff exponencial ───────────────────────────────────────────

async function withRetry(fn, maxRetries = 3, baseDelay = 5000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.message?.includes('429') || err.status === 429;
      const isLast = attempt === maxRetries;

      if (is429 && !isLast) {
        const retryMatch = err.message?.match(/retryDelay.*?(\d+)s/);
        const waitMs = retryMatch
          ? parseInt(retryMatch[1]) * 1000
          : baseDelay * Math.pow(2, attempt);
        console.warn(`⚠️ Rate limit (429). Aguardando ${waitMs / 1000}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
}

// ─── PROVEDOR DE TEXTO: DeepSeek → Gemini (fallback) ─────────────────────────
//
//  DeepSeek usa a mesma interface da OpenAI (basta trocar a base URL).
//  Se a chamada falhar (timeout, quota, fora do ar), cai automaticamente
//  no Gemini. Para trocar o provedor principal no futuro, edite apenas
//  esta função.

async function callDeepSeek(prompt) {
  if (!DEEPSEEK_API_KEY) throw new Error('DeepSeek API key ausente');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',   // troque por 'deepseek-reasoner' para tarefas de raciocínio
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`DeepSeek ${response.status}: ${err.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGeminiFallback(prompt) {
  const result = await withRetry(() => {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini timeout (45s)')), 45000)
    );
    return Promise.race([geminiChat.generateContent(prompt), timeout]);
  });
  return result.response.text();
}

export async function generateText(prompt) {
  // 1º tenta DeepSeek
  if (DEEPSEEK_API_KEY) {
    try {
      console.log('🤖 Usando DeepSeek...');
      const text = await callDeepSeek(prompt);
      console.log('✅ DeepSeek respondeu');
      return { text, provider: 'deepseek' };
    } catch (err) {
      console.warn(`⚠️ DeepSeek falhou (${err.message}). Usando Gemini como fallback...`);
    }
  }

  // 2º fallback: Gemini
  console.log('🔁 Usando Gemini (fallback)...');
  const text = await callGeminiFallback(prompt);
  return { text, provider: 'gemini' };
}

// ─── PROVEDOR DE EMBEDDING: Gemini ────────────────────────────────────────────
//
//  DeepSeek ainda não possui modelo de embedding próprio.
//  Quando isso mudar, basta adicionar a lógica aqui e trocar a chamada abaixo.

export async function generateEmbedding(text) {
  if (!canCallEmbedding()) {
    console.warn('⚠️ Rate limit local de embeddings atingido, pulando...');
    return null;
  }

  try {
    const result = await withRetry(() => geminiEmbed.embedContent(text));
    registerEmbeddingCall();
    return result.embedding.values;
  } catch (err) {
    console.error('Erro ao gerar embedding:', err.message);
    return null;
  }
}

// ─── PROVEDOR DE IMAGENS: Gemini Imagen ──────────────────────────────────────
//
//  Ativado apenas quando o usuário solicitar explicitamente geração de imagem.
//  Retorna a imagem em base64 para o frontend renderizar.
//  TODO: implementar detecção de intenção no frontend e rota /api/images

export async function generateImage(prompt) {
  // Requer billing ativo na Google Cloud — não disponível no free tier básico.
  // Descomentar quando tiver acesso ao Imagen:
  //
  // const imageModel = genAI.getGenerativeModel({ model: 'imagen-3.0-generate-002' });
  // const result = await imageModel.generateImages({ prompt, numberOfImages: 1 });
  // return result.images[0].imageData; // base64

  throw new Error('Geração de imagens ainda não configurada. Adicione billing na Google Cloud e descomente o bloco acima.');
}

// ─── Similaridade de cosseno ──────────────────────────────────────────────────

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] ** 2;
    normB += b[i] ** 2;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Busca memórias por similaridade ─────────────────────────────────────────

export async function findSimilarMemories(projectId, queryEmbedding, limit = 5, global = false) {
  if (!queryEmbedding) {
    // Fallback sem embedding: retorna memórias mais recentes
    let sql = 'SELECT id, content, project_id FROM memories';
    const params = [];
    if (!global) { sql += ' WHERE project_id = ?'; params.push(projectId); }
    sql += ` ORDER BY created_at DESC LIMIT ${limit}`;
    return await allAsync(sql, params);
  }

  let sql = 'SELECT id, content, embedding, project_id FROM memories';
  const params = [];
  if (!global) { sql += ' WHERE project_id = ?'; params.push(projectId); }
  sql += ' ORDER BY created_at DESC LIMIT 200';

  const memories = await allAsync(sql, params);
  return memories
    .map(m => {
      const emb = m.embedding ? JSON.parse(m.embedding) : null;
      return { ...m, score: cosineSimilarity(queryEmbedding, emb) };
    })
    .filter(m => m.score > 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
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

  const queryEmbedding = await generateEmbedding(userMessage);
  let memories = [];
  if (memoryMode === 'isolado') {
    memories = await findSimilarMemories(projectId, queryEmbedding, 5, false);
  } else if (memoryMode === 'global') {
    memories = await findSimilarMemories(projectId, queryEmbedding, 8, true);
  }

  if (memories.length > 0) {
    prompt += `=== MEMÓRIAS RELEVANTES ===\n(Conhecimento acumulado de conversas anteriores)\n`;
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

// ─── Extrai e salva memórias (máx. 2 por resposta) ───────────────────────────

async function extractAndSaveMemories(projectId, userMessage, assistantResponse) {
  const importantKeywords = [
    'importante', 'lembre-se', 'concluímos', 'aprendemos', 'descobrimos',
    'fato', 'sabemos que', 'definimos', 'decidimos', 'sempre', 'nunca',
    'padrão', 'regra', 'convenção', 'arquitetura', 'estrutura', 'configuração',
  ];

  const candidates = assistantResponse
    .split(/[.!?]+\s+/)
    .filter(s => s.trim().length > 50 && importantKeywords.some(kw => s.toLowerCase().includes(kw)))
    .slice(0, 2); // máx. 2 memórias por resposta para poupar quota

  for (const trimmed of candidates) {
    if (!canCallEmbedding()) {
      console.warn('⚠️ Rate limit: pulando salvamento de memória');
      break;
    }
    const emb = await generateEmbedding(trimmed);
    if (emb) {
      const existing = await findSimilarMemories(projectId, emb, 1, false);
      if (existing.length === 0 || existing[0].score < 0.92) {
        await runAsync(
          'INSERT INTO memories (project_id, content, embedding, source) VALUES (?, ?, ?, ?)',
          [projectId, trimmed, JSON.stringify(emb), 'auto']
        );
        console.log('💾 Memória salva:', trimmed.substring(0, 60) + '...');
      }
    }
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

  const { text: responseText, provider } = await generateText(fullPrompt);
  console.log(`✅ Resposta gerada por: ${provider}`);

  await runAsync(
    'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
    [chatId, 'assistant', responseText]
  );
  await runAsync('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [chatId]);

  if (isFirstMessage) updateChatTitle(chatId, userMessage).catch(console.error);
  extractAndSaveMemories(projectId, userMessage, responseText).catch(console.error);

  return responseText;
}