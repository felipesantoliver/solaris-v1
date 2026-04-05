import { Router } from 'express';
import { openDb } from '../database.js';

const router = Router();

// Retorna mensagens de um chat para compartilhamento público
router.get('/:chatId', (req, res) => {
  try {
    const db = openDb();
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });

    const messages = db.prepare(
      'SELECT role, content, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC'
    ).all(req.params.chatId);

    res.json({ chat, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
