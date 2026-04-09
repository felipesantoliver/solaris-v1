// domain/routers/projects.js — CRUD de projetos

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { runAsync, getAsync, allAsync } from '../../db/database.js';
import { invalidateSystemPromptCache } from '../ai/prompt.js';

const router = Router();

// Listar projetos do usuário
router.get('/projects', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'x-user-id obrigatório' });
  try {
    const rows = await allAsync('SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    res.json(rows);
  } catch (err) { next(err); }
});

// Obter projeto específico com seus chats
router.get('/projects/:id', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  try {
    const project = await getAsync('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
    const chats = await allAsync('SELECT * FROM chats WHERE project_id = $1 ORDER BY updated_at DESC', [req.params.id]);
    res.json({ ...project, chats });
  } catch (err) { next(err); }
});

// Criar projeto
router.post('/projects', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'x-user-id obrigatório' });
  const { name, summary, detailed_objective, tags = [], response_style = 'direto', memory_mode = 'projeto', gemini_version = 'flash' } = req.body;
  if (!name) return res.status(400).json({ error: 'name obrigatório' });
  try {
    const id = randomUUID();
    await runAsync(
      'INSERT INTO projects (id, user_id, name, summary, detailed_objective, tags, response_style, memory_mode, gemini_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, userId, name, summary || null, detailed_objective || null, JSON.stringify(tags), response_style, memory_mode, gemini_version]
    );
    res.status(201).json(await getAsync('SELECT * FROM projects WHERE id = $1', [id]));
  } catch (err) { next(err); }
});

// Atualizar projeto
router.patch('/projects/:id', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const { name, summary, detailed_objective, tags, response_style, memory_mode, gemini_version } = req.body;
  try {
    const project = await getAsync('SELECT id, memory_mode FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
    const newMemoryMode = memory_mode ?? project.memory_mode;
    await runAsync(
      `UPDATE projects SET
        name = COALESCE($1, name),
        summary = COALESCE($2, summary),
        detailed_objective = COALESCE($3, detailed_objective),
        tags = COALESCE($4, tags),
        response_style = COALESCE($5, response_style),
        memory_mode = COALESCE($6, memory_mode),
        gemini_version = COALESCE($7, gemini_version),
        updated_at = NOW()
      WHERE id = $8`,
      [name ?? null, summary ?? null, detailed_objective ?? null, tags ? JSON.stringify(tags) : null, response_style ?? null, newMemoryMode, gemini_version ?? null, req.params.id]
    );
    invalidateSystemPromptCache(userId, req.params.id);
    res.json(await getAsync('SELECT * FROM projects WHERE id = $1', [req.params.id]));
  } catch (err) { next(err); }
});

// Deletar projeto
router.delete('/projects/:id', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  try {
    const project = await getAsync('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
    await runAsync('DELETE FROM projects WHERE id = $1', [req.params.id]);
    invalidateSystemPromptCache(userId, req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Resolver modelo por projeto
export async function resolveModelForRequest(userId, projectId, headerModel) {
  if (projectId) {
    const project = await getAsync('SELECT gemini_version FROM projects WHERE id = $1', [projectId]);
    if (project && project.gemini_version) return project.gemini_version;
    return 'flash';
  }
  if (headerModel === 'pro' && userId) return 'pro';
  return 'flash';
}

export default router;