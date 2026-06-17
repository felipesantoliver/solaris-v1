// domain/routers/chats.js — Criação/deleção de chats, títulos e listagem paginada

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getPool, runAsync, getAsync, allAsync } from '../../db/database.js';
import { extractUserId } from '../../middleware/auth.js';

const router = Router();
router.use(extractUserId);

// ─── Criar chat (com ou sem projeto) ──────────────────────────────────────
router.post('/projects/:id/chats', async (req, res, next) => {
  const userId = req.userId;
  const projectId = req.params.id === 'none' ? null : req.params.id;
  try {
    if (projectId) {
      const project = await getAsync('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId]);
      if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
    }
    const chatId = randomUUID();
    await runAsync(
      'INSERT INTO chats (id, project_id, user_id, title) VALUES ($1, $2, $3, $4)',
      [chatId, projectId, userId, 'Nova conversa']
    );
    res.status(201).json(await getAsync('SELECT * FROM chats WHERE id = $1', [chatId]));
  } catch (err) { next(err); }
});

// ─── Deletar chat ──────────────────────────────────────────────────────────
router.delete('/projects/:id/chats/:chatId', async (req, res, next) => {
  try {
    await runAsync('DELETE FROM chats WHERE id = $1', [req.params.chatId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Atualizar título do chat ─────────────────────────────────────────────
router.patch('/chats/:chatId/title', async (req, res, next) => {
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title obrigatório' });
  try {
    const trimmed = title.trim().substring(0, 50);
    await runAsync('UPDATE chats SET title = $1, updated_at = NOW() WHERE id = $2', [trimmed, req.params.chatId]);
    res.json({ ok: true, title: trimmed });
  } catch (err) { next(err); }
});

// ─── Listar chats de um projeto (paginado) ────────────────────────────────
router.get('/projects/:projectId/chats', async (req, res, next) => {
  const userId = req.userId;
  const projectId = req.params.projectId;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 30;
  const offset = (page - 1) * limit;

  try {
    // Verifica se o projeto pertence ao usuário
    const project = await getAsync('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const pool = await getPool();

    // Total de chats do projeto
    const totalResult = await pool.query(
      'SELECT COUNT(*) AS total FROM chats WHERE project_id = $1',
      [projectId]
    );
    const total = parseInt(totalResult.rows[0]?.total || 0);

    // Dados paginados
    const dataResult = await pool.query(
      `SELECT id, title, created_at, updated_at
       FROM chats
       WHERE project_id = $1
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`,
      [projectId, limit, offset]
    );

    res.json({
      data: dataResult.rows,
      total,
      page,
      limit,
      hasMore: offset + dataResult.rows.length < total
    });
  } catch (err) { next(err); }
});

// ─── Listar chats do usuário (avulsos, sem projeto) ────────────────────────
router.get('/user/chats', async (req, res, next) => {
  const userId = req.userId;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 30;
  const offset = (page - 1) * limit;

  try {
    const pool = await getPool();

    // Total de chats avulsos do usuário (que tenham pelo menos uma mensagem)
    const totalResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM chats
       WHERE user_id = $1 AND project_id IS NULL
         AND id IN (SELECT DISTINCT chat_id FROM messages)`,
      [userId]
    );
    const total = parseInt(totalResult.rows[0]?.total || 0);

    // Dados paginados
    const dataResult = await pool.query(
      `SELECT id, title, created_at, updated_at
       FROM chats
       WHERE user_id = $1 AND project_id IS NULL
         AND id IN (SELECT DISTINCT chat_id FROM messages)
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    res.json({
      data: dataResult.rows,
      total,
      page,
      limit,
      hasMore: offset + dataResult.rows.length < total
    });
  } catch (err) { next(err); }
});

// ─── Deletar TODOS os chats do usuário ──────────────────────────────────────
router.delete('/user/chats', async (req, res, next) => {
  const userId = req.userId;
  try {
    const result = await runAsync('DELETE FROM chats WHERE user_id = $1', [userId]);
    res.json({ deleted: result.changes });
  } catch (err) { next(err); }
});

export default router;