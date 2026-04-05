import { Router } from 'express';
import { getAsync, allAsync } from '../database.js';

const router = Router();

// Retorna mensagens de um chat para compartilhamento público
router.get('/:chatId', async (req, res) => {
  try {
    const chat = await getAsync('SELECT * FROM chats WHERE id = ?', [req.params.chatId]);
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });

    const messages = await allAsync(
      'SELECT role, content, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC',
      [req.params.chatId]
    );

    res.json({ chat, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;