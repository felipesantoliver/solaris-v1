// domain/routers/sources.js
//
// Rotas de fontes externas - gerenciamento de URLs e texto livre
// que alimentam a base de conhecimento RAG de cada projeto.
//
// Cada fonte adicionada (URL ou texto) e automaticamente enfileirada
// para indexacao: o microsservico Python gera embeddings e os armazena
// em file_chunks com pgvector, permitindo busca semantica nas conversas.
//
// Agrupamento logico:
//   1. Listagem de fontes do projeto
//   2. Adicao de fonte via URL (com fetch, extracao e enfileiramento)
//   3. Adicao de fonte via texto livre
//   4. Exclusao de fonte e seus chunks indexados

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { runAsync, allAsync } from '../../db/database.js';
import { getJobQueue } from '../../utils/jobQueue.js';
import { invalidateSystemPromptCache } from '../ai/prompt.js';
import { extractUserId } from '../../middleware/auth.js';

const router = Router();

// ---------------------------------------------------------------------------
// 1. LISTAGEM DE FONTES DO PROJETO
// ---------------------------------------------------------------------------

// Lista todas as fontes externas de um projeto, ordenadas da mais recente.
// Rota publica: o contexto do projeto e considerado acessivel,
// a verificacao de propriedade e feita no frontend ao carregar o projeto.
router.get('/projects/:projectId/sources', async (req, res, next) => {
  try {
    const rows = await allAsync(
      'SELECT id, type, title, url, content, created_at FROM external_sources WHERE project_id = $1 ORDER BY created_at DESC',
      [req.params.projectId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 2. ADICAO DE FONTE VIA URL
// ---------------------------------------------------------------------------

// Adiciona uma URL como fonte de conhecimento do projeto.
// Fluxo completo:
//   1. Faz fetch da URL com timeout de 10 segundos
//   2. Extrai o texto do HTML (remove scripts, estilos e tags)
//   3. Trunca em 50.000 caracteres para evitar sobrecarga
//   4. Salva em external_sources
//   5. Enfileira job de indexacao (gera embeddings via Python)
//   6. Invalida cache do system prompt para incluir a nova fonte
//
// O titulo e opcional; se omitido, usa a propria URL como rotulo.
router.post('/projects/:projectId/sources/url', extractUserId, async (req, res, next) => {
  const { url, title } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const projectId = req.params.projectId;
  const userId = req.userId;

  // Timeout proprio para o fetch da URL externa
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    // Busca o conteudo da URL com identificacao SolarisBot no User-Agent
    const fetchRes = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SolarisBot/1.0' },
    });
    clearTimeout(timeoutId);

    if (!fetchRes.ok) throw new Error(`Failed to fetch URL: ${fetchRes.status}`);

    const html = await fetchRes.text();

    // Extracao rudimentar de texto: remove scripts, estilos e tags HTML,
    // normaliza espacos e trunca no limite seguro
    const text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50000);

    if (!text) throw new Error('Could not extract text from URL');

    // Persiste a fonte no banco
    const sourceId = randomUUID();
    await runAsync(
      'INSERT INTO external_sources (id, project_id, type, title, url, content) VALUES ($1, $2, $3, $4, $5, $6)',
      [sourceId, projectId, 'url', title || url, url, text]
    );

    // Enfileira job de embedding para indexacao assincrona
    // Prioridade 1: processa apos uploads (prioridade 0), mas antes de tarefas de manutencao
    const jobQueue = getJobQueue();
    await jobQueue.addJob('embedding', { fileId: sourceId, projectId, text }, 1);

    // Invalida cache para que a proxima conversa inclua esta fonte no contexto
    invalidateSystemPromptCache(userId, projectId);
    res.status(201).json({ id: sourceId, type: 'url', title: title || url, job_enqueued: true });
  } catch (err) {
    clearTimeout(timeoutId);
    // Traduz erro de timeout para mensagem amigavel
    if (err.name === 'AbortError') {
      err.status = 408;
      err.message = 'URL took too long to respond (10s timeout)';
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// 3. ADICAO DE FONTE VIA TEXTO LIVRE
// ---------------------------------------------------------------------------

// Adiciona um bloco de texto livre como fonte de conhecimento.
// Mais simples que a rota de URL: nao precisa de fetch nem extracao.
//
// O conteudo e truncado em 50.000 caracteres para manter previsibilidade
// no tamanho dos embeddings e no consumo de tokens.
//
// Nota: a verificacao de userId nao e feita diretamente na query
// (project_id ja e validado pelo middleware da rota de projetos).
// Isso e intencional: a participacao no projeto e suficiente para
// adicionar fontes, sem precisar de ownership check adicional.
router.post('/projects/:projectId/sources/text', extractUserId, async (req, res, next) => {
  const { title, content } = req.body;
  if (!content) return res.status(400).json({ error: 'Content is required' });

  const projectId = req.params.projectId;

  try {
    const sourceId = randomUUID();
    const trimmedContent = content.substring(0, 50000);
    await runAsync(
      'INSERT INTO external_sources (id, project_id, type, title, content) VALUES ($1, $2, $3, $4, $5)',
      [sourceId, projectId, 'text', title || 'Texto adicionado', trimmedContent]
    );

    // Enfileira indexacao com prioridade 1 (mesma das URLs)
    const jobQueue = getJobQueue();
    await jobQueue.addJob('embedding', { fileId: sourceId, projectId, text: trimmedContent }, 1);

    res.status(201).json({ id: sourceId, type: 'text', title: title || 'Texto adicionado', job_enqueued: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 4. EXCLUSAO DE FONTE
// ---------------------------------------------------------------------------

// Remove uma fonte externa e todos os seus chunks indexados.
// A exclusao e em duas etapas:
//   1. Remove o registro em external_sources
//   2. Remove os embeddings associados em file_chunks
//
// A invalidacao do cache do system prompt so ocorre se houver userId
// (protecao contra chamadas sem autenticacao).
router.delete('/projects/:projectId/sources/:sourceId', extractUserId, async (req, res, next) => {
  const userId = req.userId;
  try {
    // Remove a fonte
    await runAsync('DELETE FROM external_sources WHERE id = $1 AND project_id = $2', [req.params.sourceId, req.params.projectId]);

    // Remove os chunks de embedding associados
    await runAsync('DELETE FROM file_chunks WHERE file_id = $1', [req.params.sourceId]);

    // Invalida cache apenas se o usuario esta autenticado
    if (userId) invalidateSystemPromptCache(userId, req.params.projectId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;