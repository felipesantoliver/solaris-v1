import { GoogleGenerativeAI } from '@google/generative-ai';
import { getAsync, allAsync, runAsync } from './database.js';

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  throw new Error('❌ GEMINI_API_KEY não definida nas variáveis de ambiente');
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });

// Gera embedding para um texto
export async function generateEmbedding(text) {
  try {
    const result = await embeddingModel.embedContent(text);
    return result.embedding.values;
  } catch (err) {
    console.error('Erro ao gerar embedding:', err.message);
    return null;
  }
}

// Calcula similaridade de cosseno entre dois vetores
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

// Busca memórias por similaridade semântica
export async function findSimilarMemories(projectId, queryEmbedding, limit = 5, global = false) {
  if (!queryEmbedding) return [];

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

// Monta o system prompt completo
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

// Extrai e salva memórias importantes da resposta da IA
async function extractAndSaveMemories(projectId, userMessage, assistantResponse) {
  const sentences = assistantResponse.split(/[.!?]+\s+/).filter(Boolean);
  const importantKeywords = [
    'importante', 'lembre-se', 'concluímos', 'aprendemos', 'descobrimos',
    'fato', 'sabemos que', 'definimos', 'decidimos', 'sempre', 'nunca',
    'padrão', 'regra', 'convenção', 'arquitetura', 'estrutura', 'configuração'
  ];

  for (const sent of sentences) {
    const trimmed = sent.trim();
    const lower = trimmed.toLowerCase();
    const isImportant = trimmed.length > 50 && importantKeywords.some(kw => lower.includes(kw));
    if (isImportant) {
      const emb = await generateEmbedding(trimmed);
      if (emb) {
        const existing = await findSimilarMemories(projectId, emb, 1, false);
        if (existing.length === 0 || existing[0].score < 0.92) {
          await runAsync(
            'INSERT INTO memories (project_id, content, embedding, source) VALUES (?, ?, ?, ?)',
            [projectId, trimmed, JSON.stringify(emb), 'auto']
          );
        }
      }
    }
  }
}

// Atualiza título do chat baseado na primeira mensagem
async function updateChatTitle(chatId, userMessage) {
  try {
    const titlePrompt = `Gere um título curto (máximo 5 palavras) para uma conversa que começa com: "${userMessage.substring(0, 100)}". Responda apenas com o título, sem aspas ou pontuação final.`;
    const result = await model.generateContent(titlePrompt);
    const title = result.response.text().trim().substring(0, 50);
    await runAsync('UPDATE chats SET title = ? WHERE id = ?', [title, chatId]);
    return title;
  } catch {
    return null;
  }
}

export async function sendMessage(projectId, chatId, userMessage) {
  // Insere mensagem do usuário
  await runAsync(
    'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
    [chatId, 'user', userMessage]
  );

  // Busca histórico de mensagens
  const history = await allAsync(
    'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC',
    [chatId]
  );

  // Verifica se é primeira mensagem
  const isFirstMessage = history.length === 1;

  // Busca info do projeto
  const project = await getAsync(
    'SELECT memory_mode, response_style, objective FROM projects WHERE id = ?',
    [projectId]
  );
  if (!project) throw new Error('Projeto não encontrado');

  // Monta prompt com memória
  const systemPrompt = await buildSystemPrompt(projectId, userMessage, project.memory_mode);

  let fullPrompt = systemPrompt;
  fullPrompt += `=== HISTÓRICO DA CONVERSA ===\n`;

  const historyToInclude = history.slice(0, -1).slice(-20);
  for (const msg of historyToInclude) {
    fullPrompt += `${msg.role === 'user' ? 'Usuário' : 'Assistente'}: ${msg.content}\n`;
  }
  fullPrompt += `\nUsuário: ${userMessage}\nAssistente:`;

  // Chama Gemini com timeout
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout: API demorou mais de 30s')), 30000)
  );
  const geminiPromise = model.generateContent(fullPrompt);
  const result = await Promise.race([geminiPromise, timeoutPromise]);
  const responseText = result.response.text();

  // Insere resposta do assistente
  await runAsync(
    'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
    [chatId, 'assistant', responseText]
  );

  // Atualiza timestamp do chat
  await runAsync('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [chatId]);

  // Atualiza título se primeira mensagem (não aguarda)
  if (isFirstMessage) updateChatTitle(chatId, userMessage).catch(console.error);

  // Extrai memórias (não aguarda)
  extractAndSaveMemories(projectId, userMessage, responseText).catch(console.error);

  return responseText;
}