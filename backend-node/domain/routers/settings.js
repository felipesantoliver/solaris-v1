// domain/routers/settings.js
//
// Rotas de configuracoes e preferencias do usuario.
//
// Gerencia personalidade do assistente, tracos customizados, preferencias
// de notificacao (browser e som) e privacidade (personalizacao e uso de dados).
// Tambem oferece migracao de dados de convidado para conta autenticada
// e compartilhamento publico de chat (somente leitura).
//
// Convidados tambem tem suas preferencias persistidas, vinculadas ao guestId
// em vez de uma conta. extractUserId trata ambos os casos (auth e guest)
// de forma transparente.
//
// Agrupamento logico:
//   1. Constantes e valores padrao
//   2. Obter configuracoes do usuario
//   3. Salvar/atualizar configuracoes (upsert parcial)
//   4. Migracao de guest para usuario autenticado
//   5. Compartilhamento publico de chat

import { Router } from 'express';
import { runAsync, getAsync, allAsync } from '../../db/database.js';
import { invalidateSystemPromptCache } from '../ai/prompt.js';
import { extractUserId } from '../../middleware/auth.js';

const router = Router();
router.use(extractUserId);

// ---------------------------------------------------------------------------
// 1. CONSTANTES E VALORES PADRAO
// ---------------------------------------------------------------------------

// Valores default usados quando o usuario (ou convidado) ainda nao tem
// registro salvo na tabela user_settings. Servem como fallback para o
// frontend e como valores iniciais no upsert.
const DEFAULT_SETTINGS = {
  personality: 'direto',
  custom_traits: '',
  notif_browser: false,
  notif_sound: false,
  privacy_personalize: true,
  privacy_usage: true,
};

// ---------------------------------------------------------------------------
// 2. OBTER CONFIGURACOES DO USUARIO
// ---------------------------------------------------------------------------

/**
 * Retorna as configuracoes atuais do usuario.
 *
 * Mescla os valores salvos no banco com DEFAULT_SETTINGS: campos que
 * existem no banco sobrescrevem o default; campos ausentes usam o default.
 * Isso garante que novos campos adicionados em migracoes futuras tenham
 * um valor inicial seguro sem precisar de backfill.
 *
 * req.userId pode ser um UUID de conta autenticada (Supabase) ou o guestId
 * de um usuario anonimo (header x-user-id). extractUserId trata ambos os
 * casos, entao convidados tambem tem suas preferencias persistidas.
 *
 * GET /api/settings
 */
router.get('/settings', async (req, res, next) => {
  const userId = req.userId;
  try {
    const settings = await getAsync('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
    res.json({ ...DEFAULT_SETTINGS, ...settings, user_id: userId });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 3. SALVAR/ATUALIZAR CONFIGURACOES (UPSERT PARCIAL)
// ---------------------------------------------------------------------------

/**
 * Salva ou atualiza configuracoes do usuario com upsert parcial.
 *
 * Comportamento por campo:
 *   - Campos enviados no body: atualizados com o novo valor.
 *   - Campos OMITIDOS (undefined): mantem o valor atual no banco (via
 *     COALESCE no SQL). Isso permite que abas diferentes do frontend
 *     (Personalizacao e Notificacoes/Privacidade) salvem independentemente,
 *     sem uma sobrescrever os campos da outra.
 *   - Primeira vez do usuario: se nao existir registro, o INSERT cria
 *     usando COALESCE com os defaults definidos em DEFAULT_SETTINGS.
 *
 * Invalidacao de cache:
 *   O system prompt depende de personality e custom_traits. O cache so
 *   e invalidado quando esses campos mudam — alteracoes apenas em
 *   notificacoes ou privacidade nao disparam invalidacao.
 *
 * Suporta POST (compatibilidade com cliente atual) e PUT (verbo semântico
 * correto para recurso idempotente como preferencias de usuario).
 *
 * POST /api/settings
 * PUT  /api/settings
 */
async function upsertSettings(req, res, next) {
  const userId = req.userId;
  const b = req.body || {};

  // Converte undefined para null: COALESCE no SQL interpreta null como
  // "mantenha o valor atual" (usa o nome da propria coluna no UPDATE,
  // ou o valor default no INSERT).
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

    // Invalida cache do system prompt apenas se personalidade ou traits mudaram.
    // Notificacoes e privacidade nao afetam o prompt, entao nao disparam invalidacao.
    if (personality !== null || customTraits !== null) {
      invalidateSystemPromptCache(userId, null);
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Registra ambos os verbos: POST para compatibilidade, PUT para semantica correta.
router.post('/settings', upsertSettings);
router.put('/settings', upsertSettings);

// ---------------------------------------------------------------------------
// 4. MIGRACAO DE GUEST PARA USUARIO AUTENTICADO
// ---------------------------------------------------------------------------

/**
 * Migra TODO o historico do convidado para a conta recem-logada.
 *
 * Rota sem middleware extractUserId: usa guest_id e user_id diretamente
 * do body. Isso e necessario porque o usuario pode estar migrando de um
 * guestId que nao corresponde ao token de autenticacao atual.
 *
 * Dados migrados:
 *   - projects: projetos criados como convidado.
 *   - chats: conversas avulsas (fora de projeto) E conversas dentro de
 *     projetos, mantendo user_id consistente. Mensagens nao precisam de
 *     update direto: pertencem a chats via chat_id; migrar chats.user_id
 *     ja preserva as mensagens junto.
 *   - memories: memorias extraidas fora de projeto, vinculadas ao guest.
 *   - user_settings: preferencias do convidado migradas para a conta.
 *
 * Protecao de user_settings:
 *   Se a conta autenticada JA TEM preferencias salvas (ex.: usuario logou
 *   anteriormente em outro navegador), as preferencias do guest NAO
 *   sobrescrevem as existentes — o registro do guest e apenas deletado.
 *   Isso evita que um guestId "vazio" de um navegador novo apague
 *   preferencias ja configuradas na conta.
 *
 * POST /api/migrate
 */
router.post('/migrate', async (req, res, next) => {
  const { guest_id, user_id } = req.body;
  if (!guest_id || !user_id || guest_id === user_id) return res.json({ ok: true, migrated: 0 });
  try {
    const result = await runAsync('UPDATE projects SET user_id = $1 WHERE user_id = $2', [user_id, guest_id]);

    // Migra conversas avulsas e de projeto, mantendo user_id consistente
    await runAsync('UPDATE chats SET user_id = $1, updated_at = NOW() WHERE user_id = $2', [user_id, guest_id]);

    // Migra memorias extraidas fora de projeto
    await runAsync('UPDATE memories SET user_id = $1 WHERE user_id = $2', [user_id, guest_id]);

    // Migra preferencias do guest apenas se a conta ainda nao tem as proprias
    const existingUserSettings = await getAsync('SELECT user_id FROM user_settings WHERE user_id = $1', [user_id]);
    if (!existingUserSettings) {
      await runAsync('UPDATE user_settings SET user_id = $1, updated_at = NOW() WHERE user_id = $2', [user_id, guest_id]);
    } else {
      await runAsync('DELETE FROM user_settings WHERE user_id = $1', [guest_id]);
    }

    res.json({ ok: true, migrated: result.changes });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 5. COMPARTILHAMENTO PUBLICO DE CHAT
// ---------------------------------------------------------------------------

/**
 * Retorna um chat e suas mensagens para visualizacao publica (somente leitura).
 *
 * Rota sem autenticacao — qualquer pessoa com o link pode ver o chat.
 * Nao expoe dados sensiveis do usuario, apenas o conteudo das mensagens
 * e metadados basicos do chat (titulo, datas).
 *
 * Uso: gerar link compartilhavel de uma conversa.
 *
 * GET /api/share/:chatId
 */
router.get('/share/:chatId', async (req, res, next) => {
  try {
    const chat = await getAsync('SELECT * FROM chats WHERE id = $1', [req.params.chatId]);
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });

    const messages = await allAsync(
      'SELECT role, content, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [req.params.chatId]
    );

    res.json({ chat, messages });
  } catch (err) { next(err); }
});

export default router;