import { Router } from 'express';
import { openDb } from '../database.js';
import { sendMessage } from '../geminiService.js';

const router = Router();

// Busca mensagens de um chat
router.get('/chat/:chatId', (req, res) => {
  try {
    const db = openDb();
    const messages = db.prepare(
      'SELECT role, content, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC'
    ).all(req.params.chatId);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Envia mensagem e recebe resposta da IA
router.post('/', async (req, res) => {
  const { project_id, chat_id, message } = req.body;
  if (!project_id || !chat_id || !message) {
    return res.status(400).json({ error: 'project_id, chat_id e message são obrigatórios' });
  }

  try {
    const response = await sendMessage(project_id, chat_id, message);
    res.json({ response });
  } catch (err) {
    console.error('Erro ao enviar mensagem:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
