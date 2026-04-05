import { Router } from 'express';
import { openDb } from '../database.js';
import { randomUUID } from 'crypto';

const router = Router();

// Lista todos os projetos do usuário
router.get('/', (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'x-user-id obrigatório' });

  try {
    const db = openDb();
    const projects = db.prepare(
      'SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId);
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Busca projeto com seus chats
router.get('/:id', (req, res) => {
  const userId = req.headers['x-user-id'];
  try {
    const db = openDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const chats = db.prepare(
      'SELECT * FROM chats WHERE project_id = ? ORDER BY updated_at DESC'
    ).all(req.params.id);

    res.json({ ...project, chats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cria projeto
router.post('/', (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'x-user-id obrigatório' });

  const { name, objective, response_style = 'direto', memory_mode = 'isolado' } = req.body;
  if (!name) return res.status(400).json({ error: 'name obrigatório' });

  try {
    const db = openDb();
    const id = randomUUID();
    db.prepare(
      'INSERT INTO projects (id, user_id, name, objective, response_style, memory_mode) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, userId, name, objective || null, response_style, memory_mode);

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atualiza projeto
router.patch('/:id', (req, res) => {
  const userId = req.headers['x-user-id'];
  const { name, objective, response_style, memory_mode } = req.body;

  try {
    const db = openDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    db.prepare(`
      UPDATE projects SET
        name = COALESCE(?, name),
        objective = COALESCE(?, objective),
        response_style = COALESCE(?, response_style),
        memory_mode = COALESCE(?, memory_mode),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name ?? null, objective ?? null, response_style ?? null, memory_mode ?? null, req.params.id);

    res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deleta projeto
router.delete('/:id', (req, res) => {
  const userId = req.headers['x-user-id'];
  try {
    const db = openDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cria chat dentro de um projeto
router.post('/:id/chats', (req, res) => {
  const userId = req.headers['x-user-id'];
  try {
    const db = openDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const chatId = randomUUID();
    db.prepare('INSERT INTO chats (id, project_id, title) VALUES (?, ?, ?)').run(chatId, req.params.id, 'Nova conversa');
    res.status(201).json(db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deleta chat
router.delete('/:id/chats/:chatId', (req, res) => {
  try {
    const db = openDb();
    db.prepare('DELETE FROM chats WHERE id = ? AND project_id = ?').run(req.params.chatId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
