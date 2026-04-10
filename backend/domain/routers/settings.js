// domain/routers/settings.js — Configurações do usuário

import { Router } from 'express';
import { runAsync, getAsync } from '../../db/database.js';
import { invalidateSystemPromptCache } from '../ai/prompt.js';
import { extractUserId } from '../../middleware/auth.js';

const router = Router();
router.use(extractUserId);

// Obter configurações do usuário
router.get('/settings', async (req, res, next) => {
  const userId = req.userId;
  try {
    const settings = await getAsync('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
    res.json(settings || { user_id: userId, personality: 'direto', custom_traits: '' });
  } catch (err) { next(err); }
});

// Salvar configurações
router.post('/settings', async (req, res, next) => {
  const userId = req.userId;
  const { personality = 'direto', custom_traits = '' } = req.body;
  try {
    await runAsync(
      `INSERT INTO user_settings (user_id, personality, custom_traits, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET personality = $2, custom_traits = $3, updated_at = NOW()`,
      [userId, personality, custom_traits]
    );
    invalidateSystemPromptCache(userId, null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Migração de guest para usuário logado (rota sem middleware, pois usa body)
router.post('/migrate', async (req, res, next) => {
  const { guest_id, user_id } = req.body;
  if (!guest_id || !user_id || guest_id === user_id) return res.json({ ok: true, migrated: 0 });
  try {
    const result = await runAsync('UPDATE projects SET user_id = $1 WHERE user_id = $2', [user_id, guest_id]);
    res.json({ ok: true, migrated: result.changes });
  } catch (err) { next(err); }
});

// Compartilhar chat (público) – sem autenticação
router.get('/share/:chatId', async (req, res, next) => {
  try {
    const chat = await getAsync('SELECT * FROM chats WHERE id = $1', [req.params.chatId]);
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });
    const messages = await allAsync('SELECT role, content, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC', [req.params.chatId]);
    res.json({ chat, messages });
  } catch (err) { next(err); }
});

export default router;