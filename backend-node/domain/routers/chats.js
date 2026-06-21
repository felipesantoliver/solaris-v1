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

// ─── 4.3: Mover chat para outro projeto (ou para fora de projeto) ─────────
// project_id pode vir null (string 'none' tratada como null também, para
// simetria com a rota de criação) — nesse caso o chat passa a ser avulso.
router.patch('/chats/:chatId/project', async (req, res, next) => {
  const userId = req.userId;
  const { chatId } = req.params;
  let { project_id } = req.body;
  if (project_id === 'none' || project_id === undefined) project_id = null;

  try {
    // Ownership do chat: precisa pertencer ao usuário autenticado.
    const chat = await getAsync('SELECT id, user_id, project_id FROM chats WHERE id = $1', [chatId]);
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });
    if (chat.user_id !== userId) return res.status(403).json({ error: 'Você não tem permissão para mover este chat' });

    // Se há projeto de destino, precisa também pertencer ao usuário.
    if (project_id) {
      const project = await getAsync('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [project_id, userId]);
      if (!project) return res.status(404).json({ error: 'Projeto de destino não encontrado' });
    }

    await runAsync(
      'UPDATE chats SET project_id = $1, updated_at = NOW() WHERE id = $2',
      [project_id, chatId]
    );

    res.json(await getAsync('SELECT * FROM chats WHERE id = $1', [chatId]));
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
    // FIX 4.3: inclui project_id na seleção — necessário para a UI saber a que
    // projeto o chat já pertence (ex: menu "mover para projeto" não deve
    // oferecer o projeto atual como destino).
    const dataResult = await pool.query(
      `SELECT id, title, project_id, created_at, updated_at
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
    // FIX 4.3: inclui project_id (sempre NULL aqui pela própria WHERE, mas
    // mantém o shape do objeto consistente com /projects/:projectId/chats —
    // a UI usa chat.project_id sem precisar saber qual endpoint o originou).
    const dataResult = await pool.query(
      `SELECT id, title, project_id, created_at, updated_at
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