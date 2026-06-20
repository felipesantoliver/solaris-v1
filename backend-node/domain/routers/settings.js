// domain/routers/settings.js — Configurações e preferências do usuário
// (personalidade do assistente + notificações + privacidade)

import { Router } from 'express';
import { runAsync, getAsync, allAsync } from '../../db/database.js';
import { invalidateSystemPromptCache } from '../ai/prompt.js';
import { extractUserId } from '../../middleware/auth.js';

const router = Router();
router.use(extractUserId);

// Valores padrão usados quando o usuário (ou convidado) ainda não tem registro salvo.
const DEFAULT_SETTINGS = {
  personality: 'direto',
  custom_traits: '',
  notif_browser: false,
  notif_sound: false,
  privacy_personalize: true,
  privacy_usage: true,
};

// Obter configurações e preferências do usuário.
// req.userId pode ser o id de uma conta autenticada (Supabase) ou o guestId
// de um usuário anônimo (header x-user-id) — extractUserId trata os dois casos
// da mesma forma, então convidados também têm suas preferências persistidas,
// só que vinculadas ao guestId em vez de a uma conta.
router.get('/settings', async (req, res, next) => {
  const userId = req.userId;
  try {
    const settings = await getAsync('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
    res.json({ ...DEFAULT_SETTINGS, ...settings, user_id: userId });
  } catch (err) { next(err); }
});

// Salva/atualiza configurações — aceita atualização PARCIAL do payload.
// Qualquer campo omitido no body preserva o valor já salvo no banco (ou o
// default acima, se for a primeira vez que esse usuário salva algo). Isso
// permite que a aba "Personalização" e a aba "Notificações/Privacidade" do
// frontend salvem independentemente, sem uma sobrescrever os campos da outra.
async function upsertSettings(req, res, next) {
  const userId = req.userId;
  const b = req.body || {};

  // undefined -> null, para o COALESCE do SQL abaixo preservar o valor atual da coluna
  const personality        = b.personality          !== undefined ? b.personality        : null;
  const customTraits       = b.custom_traits         !== undefined ? b.custom_traits       : null;
  const notifBrowser       = b.notif_browser         !== undefined ? !!b.notif_browser     : null;
  const notifSound         = b.notif_sound           !== undefined ? !!b.notif_sound       : null;
  const privacyPersonalize = b.privacy_personalize   !== undefined ? !!b.privacy_personalize : null;
  const privacyUsage       = b.privacy_usage         !== undefined ? !!b.privacy_usage     : null;

  try {
    await runAsync(
      `INSERT INTO user_settings (
         user_id, personality, custom_traits, notif_browser, notif_sound,
         privacy_personalize, privacy_usage, updated_at
       )
       VALUES (
         $1, COALESCE($2, 'direto'), COALESCE($3, ''), COALESCE($4, FALSE), COALESCE($5, FALSE),
         COALESCE($6, TRUE), COALESCE($7, TRUE), NOW()
       )
       ON CONFLICT (user_id) DO UPDATE SET
         personality          = COALESCE($2, user_settings.personality),
         custom_traits        = COALESCE($3, user_settings.custom_traits),
         notif_browser        = COALESCE($4, user_settings.notif_browser),
         notif_sound          = COALESCE($5, user_settings.notif_sound),
         privacy_personalize  = COALESCE($6, user_settings.privacy_personalize),
         privacy_usage        = COALESCE($7, user_settings.privacy_usage),
         updated_at           = NOW()`,
      [userId, personality, customTraits, notifBrowser, notifSound, privacyPersonalize, privacyUsage]
    );

    // O system prompt depende de personalidade/traços — só invalida o cache quando eles mudam
    if (personality !== null || customTraits !== null) {
      invalidateSystemPromptCache(userId, null);
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
}

// POST mantido por compatibilidade com o cliente atual; PUT é o verbo semanticamente
// correto para "atualizar/criar" um recurso idempotente como as preferências do usuário.
router.post('/settings', upsertSettings);
router.put('/settings', upsertSettings);

// Migração de guest para usuário logado (rota sem middleware, pois usa body)
//
// Cobre TODO o histórico do convidado, não só os projetos:
//   - projects        -> projetos criados como convidado
//   - chats            -> conversas avulsas (fora de projeto, project_id IS NULL)
//                         e também as ligadas a projeto, mantendo user_id consistente
//   - memories         -> memórias/personalização extraídas fora de projeto
//   - user_settings    -> preferências (personalidade, notificações, privacidade)
// `messages` não precisa de update direto: pertence a `chats` via chat_id, então
// migrar `chats.user_id` já preserva as mensagens junto.
router.post('/migrate', async (req, res, next) => {
  const { guest_id, user_id } = req.body;
  if (!guest_id || !user_id || guest_id === user_id) return res.json({ ok: true, migrated: 0 });
  try {
    const result = await runAsync('UPDATE projects SET user_id = $1 WHERE user_id = $2', [user_id, guest_id]);

    // Conversas avulsas (e também as de projeto, por consistência) — preserva o histórico de chat.
    await runAsync('UPDATE chats SET user_id = $1, updated_at = NOW() WHERE user_id = $2', [user_id, guest_id]);

    // Memórias extraídas fora de projeto, vinculadas diretamente ao convidado.
    await runAsync('UPDATE memories SET user_id = $1 WHERE user_id = $2', [user_id, guest_id]);

    // Migra as preferências (personalidade, notificações, privacidade) do convidado
    // para a conta recém-logada — mas só se a conta ainda não tiver preferências
    // próprias salvas. Isso evita sobrescrever preferências já definidas em uma
    // conta existente (ex.: usuário loga em um navegador novo, que tem um guestId
    // diferente; não queremos que o guestId "vazio" desse navegador apague as
    // preferências já configuradas na conta).
    const existingUserSettings = await getAsync('SELECT user_id FROM user_settings WHERE user_id = $1', [user_id]);
    if (!existingUserSettings) {
      await runAsync('UPDATE user_settings SET user_id = $1, updated_at = NOW() WHERE user_id = $2', [user_id, guest_id]);
    } else {
      await runAsync('DELETE FROM user_settings WHERE user_id = $1', [guest_id]);
    }

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