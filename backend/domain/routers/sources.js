// domain/routers/sources.js — Fontes externas (URL e texto)

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { runAsync, allAsync } from '../../db/database.js';
import { getJobQueue } from '../../utils/jobQueue.js';
import { invalidateSystemPromptCache } from '../ai/prompt.js';

const router = Router();

// Listar fontes do projeto
router.get('/projects/:projectId/sources', async (req, res, next) => {
  try {
    const rows = await allAsync('SELECT id, type, title, url, content, created_at FROM external_sources WHERE project_id = $1 ORDER BY created_at DESC', [req.params.projectId]);
    res.json(rows);
  } catch (err) { next(err); }
});

// Adicionar fonte via URL (com timeout de 10 segundos)
router.post('/projects/:projectId/sources/url', async (req, res, next) => {
  const { url, title } = req.body;
  if (!url) return res.status(400).json({ error: 'URL é obrigatória' });
  const projectId = req.params.projectId;

  // Configura AbortController para timeout de 10 segundos
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const fetchRes = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SolarisBot/1.0' }
    });
    clearTimeout(timeoutId); // limpa o timeout assim que a resposta chega

    if (!fetchRes.ok) throw new Error(`Erro ao acessar URL: ${fetchRes.status}`);
    let html = await fetchRes.text();
    const text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 50000);
    if (!text) throw new Error('Não foi possível extrair texto da URL');

    const sourceId = randomUUID();
    await runAsync(
      'INSERT INTO external_sources (id, project_id, type, title, url, content) VALUES ($1, $2, $3, $4, $5, $6)',
      [sourceId, projectId, 'url', title || url, url, text]
    );

    const jobQueue = getJobQueue();
    await jobQueue.addJob('embedding', { fileId: sourceId, projectId, text }, 1);

    res.status(201).json({ id: sourceId, type: 'url', title: title || url, job_enqueued: true });
  } catch (err) {
    clearTimeout(timeoutId); // garante limpeza em caso de erro também
    if (err.name === 'AbortError') {
      err.status = 408;
      err.message = 'A URL demorou muito para responder (timeout de 10s)';
    }
    next(err);
  }
});

// Adicionar fonte via texto
router.post('/projects/:projectId/sources/text', async (req, res, next) => {
  const { title, content } = req.body;
  if (!content) return res.status(400).json({ error: 'Conteúdo de texto é obrigatório' });
  const projectId = req.params.projectId;
  try {
    const sourceId = randomUUID();
    const trimmedContent = content.substring(0, 50000);
    await runAsync('INSERT INTO external_sources (id, project_id, type, title, content) VALUES ($1, $2, $3, $4, $5)', [sourceId, projectId, 'text', title || 'Texto adicionado', trimmedContent]);
    const jobQueue = getJobQueue();
    await jobQueue.addJob('embedding', { fileId: sourceId, projectId, text: trimmedContent }, 1);
    res.status(201).json({ id: sourceId, type: 'text', title: title || 'Texto adicionado', job_enqueued: true });
  } catch (err) { next(err); }
});

// Deletar fonte
router.delete('/projects/:projectId/sources/:sourceId', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  try {
    await runAsync('DELETE FROM external_sources WHERE id = $1 AND project_id = $2', [req.params.sourceId, req.params.projectId]);
    await runAsync('DELETE FROM file_chunks WHERE file_id = $1', [req.params.sourceId]);
    if (userId) invalidateSystemPromptCache(userId, req.params.projectId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;