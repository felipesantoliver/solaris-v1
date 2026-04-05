import { Router } from 'express';
import { getAsync, allAsync, runAsync } from '../database.js';
import { randomUUID } from 'crypto';

const router = Router();

// Lista todos os projetos do usuário
router.get('/', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'x-user-id obrigatório' });

  try {
    const projects = await allAsync(
      'SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Busca projeto com seus chats
router.get('/:id', async (req, res) => {
  const userId = req.headers['x-user-id'];
  try {
    const project = await getAsync(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [req.params.id, userId]
    );
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const chats = await allAsync(
      'SELECT * FROM chats WHERE project_id = ? ORDER BY updated_at DESC',
      [req.params.id]
    );

    res.json({ ...project, chats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cria projeto
router.post('/', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'x-user-id obrigatório' });

  const { name, objective, response_style = 'direto', memory_mode = 'isolado' } = req.body;
  if (!name) return res.status(400).json({ error: 'name obrigatório' });

  try {
    const id = randomUUID();
    await runAsync(
      'INSERT INTO projects (id, user_id, name, objective, response_style, memory_mode) VALUES (?, ?, ?, ?, ?, ?)',
      [id, userId, name, objective || null, response_style, memory_mode]
    );

    const project = await getAsync('SELECT * FROM projects WHERE id = ?', [id]);
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atualiza projeto
router.patch('/:id', async (req, res) => {
  const userId = req.headers['x-user-id'];
  const { name, objective, response_style, memory_mode } = req.body;

  try {
    const project = await getAsync(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [req.params.id, userId]
    );
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    await runAsync(`
      UPDATE projects SET
        name = COALESCE(?, name),
        objective = COALESCE(?, objective),
        response_style = COALESCE(?, response_style),
        memory_mode = COALESCE(?, memory_mode),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [name ?? null, objective ?? null, response_style ?? null, memory_mode ?? null, req.params.id]);

    const updated = await getAsync('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deleta projeto
router.delete('/:id', async (req, res) => {
  const userId = req.headers['x-user-id'];
  try {
    const project = await getAsync(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [req.params.id, userId]
    );
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    await runAsync('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cria chat dentro de um projeto
router.post('/:id/chats', async (req, res) => {
  const userId = req.headers['x-user-id'];
  try {
    const project = await getAsync(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [req.params.id, userId]
    );
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const chatId = randomUUID();
    await runAsync(
      'INSERT INTO chats (id, project_id, title) VALUES (?, ?, ?)',
      [chatId, req.params.id, 'Nova conversa']
    );
    const chat = await getAsync('SELECT * FROM chats WHERE id = ?', [chatId]);
    res.status(201).json(chat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deleta chat
router.delete('/:id/chats/:chatId', async (req, res) => {
  try {
    await runAsync(
      'DELETE FROM chats WHERE id = ? AND project_id = ?',
      [req.params.chatId, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;