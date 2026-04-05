import { GoogleGenerativeAI } from '@google/generative-ai';
import { openDb } from './database.js';

// IMPORTANTE: A chave é puxada diretamente das variáveis de ambiente na nuvem
const API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
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
  const db = await openDb();

  let sql = 'SELECT id, content, embedding, project_id FROM memories';
  const params = [];
  if (!global) {
    sql += ' WHERE project_id = ?';
    params.push(projectId);
  }
  sql += ' ORDER BY created_at DESC LIMIT 200'; // limita busca para performance

  const memories = await db.all(sql, params);

  const scored = memories
    .map(m => {
      const emb = m.embedding ? JSON.parse(m.embedding) : null;
      return { ...m, score: cosineSimilarity(queryEmbedding, emb) };
    })
    .filter(m => m.score > 0.6) // threshold de relevância
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

// Monta o system prompt completo
export async function buildSystemPrompt(projectId, userMessage, memoryMode) {
  const db = await openDb();
  const project = await db.get('SELECT * FROM projects WHERE id = ?', projectId);
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

  // Busca memórias por similaridade semântica
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

  // Arquivos do projeto
  const files = await db.all(
    'SELECT original_name, extracted_text, mime_type FROM files WHERE project_id = ?',
    projectId
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
  // Divide por pontuação sem usar lookbehind (compatível com Node < 16)
  const sentences = assistantResponse.split(/[.!?]+\s+/).filter(Boolean);

  const importantKeywords = [
    'importante', 'lembre-se', 'concluímos', 'aprendemos', 'descobrimos',
    'fato', 'sabemos que', 'definimos', 'decidimos', 'sempre', 'nunca',
    'padrão', 'regra', 'convenção', 'arquitetura', 'estrutura', 'configuração'
  ];

  for (const sent of sentences) {
    const trimmed = sent.trim();
    const lower = trimmed.toLowerCase();

    const isImportant = trimmed.length > 50 &&
      importantKeywords.some(kw => lower.includes(kw));

    if (isImportant) {
      const emb = await generateEmbedding(trimmed);
      if (emb) {
        const db = await openDb();
        // Evita duplicatas verificando similaridade com memórias existentes
        const existing = await findSimilarMemories(projectId, emb, 1, false);
        if (existing.length === 0 || existing[0].score < 0.92) {
          await db.run(
            'INSERT INTO memories (project_id, content, embedding, source) VALUES (?, ?, ?, ?)',
            projectId, trimmed, JSON.stringify(emb), 'auto'
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
    const db = await openDb();
    await db.run('UPDATE chats SET title = ? WHERE id = ?', title, chatId);
    return title;
  } catch {
    return null;
  }
}

export async function sendMessage(projectId, chatId, userMessage) {
  const db = await openDb();

  // Verifica se é a primeira mensagem do usuário neste chat
  const existingUserMsgs = await db.get(
    'SELECT COUNT(*) as count FROM messages WHERE chat_id = ? AND role = ?',
    chatId, 'user'
  );
  const isFirstMessage = existingUserMsgs.count === 0;

  // Salvar mensagem do usuário
  await db.run(
    'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
    chatId, 'user', userMessage
  );

  // Buscar histórico recente (últimas 20 mensagens para melhor contexto)
  const history = await db.all(
    'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC',
    chatId
  );

  // Configurações do projeto
  const project = await db.get(
    'SELECT memory_mode, response_style, objective FROM projects WHERE id = ?',
    projectId
  );
  if (!project) throw new Error('Projeto não encontrado');

  // Montar contexto completo
  const systemPrompt = await buildSystemPrompt(projectId, userMessage, project.memory_mode);

  // Formatar histórico para o Gemini
  let fullPrompt = systemPrompt;
  fullPrompt += `=== HISTÓRICO DA CONVERSA ===\n`;

  // Inclui últimas 20 mensagens (exceto a atual que acabamos de adicionar)
  const historyToInclude = history.slice(0, -1).slice(-20);
  for (const msg of historyToInclude) {
    fullPrompt += `${msg.role === 'user' ? 'Usuário' : 'Assistente'}: ${msg.content}\n`;
  }

  fullPrompt += `\nUsuário: ${userMessage}\nAssistente:`;

  // Chamar Gemini com timeout
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout: API demorou mais de 30s')), 30000)
  );

  const geminiPromise = model.generateContent(fullPrompt);
  const result = await Promise.race([geminiPromise, timeoutPromise]);
  const responseText = result.response.text();

  // Salvar resposta da IA
  await db.run(
    'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
    chatId, 'assistant', responseText
  );

  // Atualiza título do chat na primeira mensagem (em background)
  if (isFirstMessage) {
    updateChatTitle(chatId, userMessage).catch(console.error);
  }

  // Extrai e salva memórias (em background para não atrasar resposta)
  extractAndSaveMemories(projectId, userMessage, responseText).catch(console.error);

  return responseText;
}