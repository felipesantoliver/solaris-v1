// domain/routers/projects.js — CRUD de projetos

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { runAsync, getAsync, allAsync } from '../../db/database.js';
import { invalidateSystemPromptCache, optimizePersonalityText } from '../ai/prompt.js';
import { extractUserId } from '../../middleware/auth.js';

const router = Router();
router.use(extractUserId); // aplica a todas as rotas

// Listar projetos do usuário
router.get('/projects', async (req, res, next) => {
  const userId = req.userId;
  try {
    const rows = await allAsync('SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    res.json(rows);
  } catch (err) { next(err); }
});

// Obter projeto específico com seus chats
router.get('/projects/:id', async (req, res, next) => {
  const userId = req.userId;
  // Espelha o mesmo filtro de GET /projects/:projectId/chats e GET /user/chats
  // (domain/routers/chats.js): por padrão chats arquivados ficam de fora;
  // soft-deletados (deleted_at) nunca aparecem aqui.
  const includeArchived = req.query.include_archived === 'true' || req.query.include_archived === '1';
  const archivedClause = includeArchived ? '' : 'AND archived_at IS NULL';
  try {
    const project = await getAsync('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
    const chats = await allAsync(
      `SELECT * FROM chats
       WHERE project_id = $1 AND deleted_at IS NULL ${archivedClause}
       ORDER BY pinned DESC, updated_at DESC`,
      [req.params.id]
    );
    res.json({ ...project, chats });
  } catch (err) { next(err); }
});

// Criar projeto
router.post('/projects', async (req, res, next) => {
  const userId = req.userId;
  const {
    name, summary, detailed_objective, tags = [], response_style = 'direto',
    memory_mode = 'projeto', gemini_version = 'flash',
    instructions = null, shared_memory_enabled = false,
  } = req.body;
  if (!name) return res.status(400).json({ error: 'name obrigatório' });
  try {
    const id = randomUUID();
    // Preset (ex.: "tecnico") é salvo direto; texto livre escrito pelo usuário
    // passa pelo serviço Python para ser reescrito de forma compacta antes de salvar.
    const finalResponseStyle = await optimizePersonalityText(response_style);
    await runAsync(
      'INSERT INTO projects (id, user_id, name, summary, detailed_objective, tags, response_style, memory_mode, gemini_version, instructions, shared_memory_enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, userId, name, summary || null, detailed_objective || null, JSON.stringify(tags), finalResponseStyle, memory_mode, gemini_version, instructions || null, !!shared_memory_enabled]
    );
    res.status(201).json(await getAsync('SELECT * FROM projects WHERE id = $1', [id]));
  } catch (err) { next(err); }
});

// Atualizar projeto
router.patch('/projects/:id', async (req, res, next) => {
  const userId = req.userId;
  const { name, summary, detailed_objective, tags, response_style, memory_mode, gemini_version, instructions, shared_memory_enabled } = req.body;
  try {
    const project = await getAsync('SELECT id, memory_mode FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
    const newMemoryMode = memory_mode ?? project.memory_mode;
    // Só chama a otimização quando response_style foi de fato enviado neste
    // PATCH — evita custo/latência extra ao editar só nome, tags etc.
    // typeof === 'string' trata omitido/null como "não mudou" (preserva valor
    // atual via COALESCE), igual ao comportamento original.
    const finalResponseStyle = typeof response_style === 'string'
      ? await optimizePersonalityText(response_style)
      : null;
    // shared_memory_enabled é booleano: `false` é um valor válido (desliga o
    // compartilhamento), então só tratamos `undefined` como "não enviado".
    // Passar `null` explicitamente no array de params faz o COALESCE manter
    // o valor atual; passar `false` faz o COALESCE gravar `false` mesmo
    // assim, porque `false` não é SQL NULL.
    const sharedMemoryParam = typeof shared_memory_enabled === 'boolean' ? shared_memory_enabled : null;
    await runAsync(
      `UPDATE projects SET
        name = COALESCE($1, name),
        summary = COALESCE($2, summary),
        detailed_objective = COALESCE($3, detailed_objective),
        tags = COALESCE($4, tags),
        response_style = COALESCE($5, response_style),
        memory_mode = COALESCE($6, memory_mode),
        gemini_version = COALESCE($7, gemini_version),
        instructions = COALESCE($8, instructions),
        shared_memory_enabled = COALESCE($9, shared_memory_enabled),
        updated_at = NOW()
      WHERE id = $10`,
      [name ?? null, summary ?? null, detailed_objective ?? null, tags ? JSON.stringify(tags) : null, finalResponseStyle, newMemoryMode, gemini_version ?? null, instructions ?? null, sharedMemoryParam, req.params.id]
    );
    invalidateSystemPromptCache(userId, req.params.id);
    res.json(await getAsync('SELECT * FROM projects WHERE id = $1', [req.params.id]));
  } catch (err) { next(err); }
});

// Deletar projeto
router.delete('/projects/:id', async (req, res, next) => {
  const userId = req.userId;
  try {
    const project = await getAsync('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
    await runAsync('DELETE FROM projects WHERE id = $1', [req.params.id]);
    invalidateSystemPromptCache(userId, req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Resolver modelo por projeto (mantido como export)
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