import { GoogleGenerativeAI } from '@google/generative-ai';
import { getAsync, allAsync, runAsync } from './database.js';

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  throw new Error('❌ GEMINI_API_KEY não definida nas variáveis de ambiente');
}

const genAI = new GoogleGenerativeAI(API_KEY);

// gemini-1.5-flash tem limites mais generosos no free tier que o 2.0
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// gemini-embedding-001 é o modelo correto para a API v1beta atual
const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

// ─── Rate limiter simples para embeddings ────────────────────────────────────
// Free tier: ~5 RPM para embeddings. Limitamos a 3 por minuto para folga.
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
        // Extrai retryDelay da mensagem do erro se disponível, senão usa backoff
        const retryMatch = err.message?.match(/retryDelay.*?(\d+)s/);
        const waitMs = retryMatch
          ? parseInt(retryMatch[1]) * 1000
          : baseDelay * Math.pow(2, attempt);

        console.warn(`⚠️ Rate limit (429). Aguardando ${waitMs / 1000}s antes de tentar novamente...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      throw err;
    }
  }
}

// ─── Embedding com rate limit e retry ────────────────────────────────────────
export async function generateEmbedding(text) {
  if (!canCallEmbedding()) {
    console.warn('⚠️ Rate limit local de embeddings atingido, pulando...');
    return null;
  }

  try {
    const result = await withRetry(() => embeddingModel.embedContent(text));
    registerEmbeddingCall();
    return result.embedding.values;
  } catch (err) {
    console.error('Erro ao gerar embedding:', err.message);
    return null;
  }
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
    // Sem embedding, retorna as memórias mais recentes como fallback
    let sql = 'SELECT id, content, project_id FROM memories';
    const params = [];
    if (!global) {
      sql += ' WHERE project_id = ?';
      params.push(projectId);
    }
    sql += ` ORDER BY created_at DESC LIMIT ${limit}`;
    return await allAsync(sql, params);
  }

  let sql = 'SELECT id, content, embedding, project_id FROM memories';
  const params = [];
  if (!global) {
    sql += ' WHERE project_id = ?';
    params.push(projectId);
  }
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
    estratégico: 'Foque em planejamento, impacto de longo prazo e visão macro.'
  };

  let prompt = `Você é o Solaris, um assistente de IA especializado operando dentro de um projeto específico.\n\n`;
  prompt += `=== CONTEXTO DO PROJETO ===\n`;
  prompt += `Nome: ${project.name}\n`;
  prompt += `Objetivo: ${project.objective || 'Ajudar o usuário em suas tarefas'}\n`;
  prompt += `Estilo: ${styleGuide[project.response_style] || styleGuide.direto}\n\n`;
  prompt += `Diretrizes gerais: evite respostas genéricas, priorize utilidade prática, use o contexto fornecido. Nunca invente informações que não estão no contexto.\n\n`;

  // Tenta gerar embedding para busca semântica, mas não bloqueia se falhar
  const queryEmbedding = await generateEmbedding(userMessage);
  let memories = [];

  if (memoryMode === 'isolado') {
    memories = await findSimilarMemories(projectId, queryEmbedding, 5, false);
  } else if (memoryMode === 'global') {
    memories = await findSimilarMemories(projectId, queryEmbedding, 8, true);
  }

  if (memories.length > 0) {
    prompt += `=== MEMÓRIAS RELEVANTES ===\n`;
    prompt += `(Conhecimento acumulado de conversas anteriores, ordenado por relevância)\n`;
    memories.forEach((m, i) => {
      prompt += `[${i + 1}] ${m.content}\n`;
    });
    prompt += '\n';
  }

  const files = await allAsync(
    'SELECT original_name, extracted_text, mime_type FROM files WHERE project_id = ?',
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

// ─── Extrai e salva memórias (máx. 2 por resposta para poupar quota) ─────────
async function extractAndSaveMemories(projectId, userMessage, assistantResponse) {
  const sentences = assistantResponse.split(/[.!?]+\s+/).filter(Boolean);
  const importantKeywords = [
    'importante', 'lembre-se', 'concluímos', 'aprendemos', 'descobrimos',
    'fato', 'sabemos que', 'definimos', 'decidimos', 'sempre', 'nunca',
    'padrão', 'regra', 'convenção', 'arquitetura', 'estrutura', 'configuração'
  ];

  const candidates = sentences.filter(sent => {
    const lower = sent.toLowerCase();
    return sent.trim().length > 50 && importantKeywords.some(kw => lower.includes(kw));
  });

  // Limita a no máximo 2 memórias por resposta para não explodir a quota
  const toSave = candidates.slice(0, 2);

  for (const trimmed of toSave) {
    // Verifica rate limit antes de cada embedding
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
    const titlePrompt = `Gere um título curto (máximo 5 palavras) para uma conversa que começa com: "${userMessage.substring(0, 100)}". Responda apenas com o título, sem aspas ou pontuação final.`;
    const result = await withRetry(() => model.generateContent(titlePrompt));
    const title = result.response.text().trim().substring(0, 50);
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

  let fullPrompt = systemPrompt;
  fullPrompt += `=== HISTÓRICO DA CONVERSA ===\n`;

  const historyToInclude = history.slice(0, -1).slice(-20);
  for (const msg of historyToInclude) {
    fullPrompt += `${msg.role === 'user' ? 'Usuário' : 'Assistente'}: ${msg.content}\n`;
  }
  fullPrompt += `\nUsuário: ${userMessage}\nAssistente:`;

  // Timeout de 45s + retry automático para 429
  const result = await withRetry(() => {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout: API demorou mais de 45s')), 45000)
    );
    return Promise.race([model.generateContent(fullPrompt), timeoutPromise]);
  });

  const responseText = result.response.text();

  await runAsync(
    'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
    [chatId, 'assistant', responseText]
  );

  await runAsync('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [chatId]);

  if (isFirstMessage) updateChatTitle(chatId, userMessage).catch(console.error);

  // Roda em background sem bloquear a resposta
  extractAndSaveMemories(projectId, userMessage, responseText).catch(console.error);

  return responseText;
}