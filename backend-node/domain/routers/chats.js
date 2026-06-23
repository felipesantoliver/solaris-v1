// domain/routers/chats.js
//
// Rotas de conversas (chats) - criacao, exclusao logica, listagem paginada
// e acoes do menu de contexto (arquivar, fixar, mover, renomear).
// 
// Todas as rotas exigem usuario autenticado (extractUserId).
// Conversas excluidas (deleted_at preenchido) sao sempre filtradas,
// exceto na rota de hard-delete administrativa.
//
// Agrupamento logico:
//   1. Criacao de chat
//   2. Exclusao (soft delete e hard delete)
//   3. Atualizacoes pontuais (titulo, arquivar, fixar, mover)
//   4. Listagem paginada (por projeto e avulsa)

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { runAsync, getAsync, allAsync } from '../../db/database.js';
import { extractUserId } from '../../middleware/auth.js';

const router = Router();
router.use(extractUserId);

// ---------------------------------------------------------------------------
// 1. CRIACAO DE CHAT
// ---------------------------------------------------------------------------

// Cria uma nova conversa, associada a um projeto ou avulsa (project_id = null).
// Se o parametro :id for "none", a conversa fica sem projeto.
router.post('/projects/:id/chats', async (req, res, next) => {
  const userId = req.userId;
  const projectId = req.params.id === 'none' ? null : req.params.id;
  try {
    // Se houver projeto vinculado, verifica se ele pertence ao usuario
    if (projectId) {
      const project = await getAsync('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId]);
      if (!project) return res.status(404).json({ error: 'Projeto nao encontrado' });
    }
    const chatId = randomUUID();
    await runAsync(
      'INSERT INTO chats (id, project_id, user_id, title) VALUES ($1, $2, $3, $4)',
      [chatId, projectId, userId, 'Nova conversa']
    );
    res.status(201).json(await getAsync('SELECT * FROM chats WHERE id = $1', [chatId]));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 2. EXCLUSAO DE CHATS
// ---------------------------------------------------------------------------

// Soft delete: preenche deleted_at em vez de remover fisicamente.
// A conversa some das listagens padrao mas permanece recuperavel.
// Verifica propriedade antes de aplicar.
router.delete('/projects/:id/chats/:chatId', async (req, res, next) => {
  const userId = req.userId;
  const { chatId } = req.params;
  try {
    const chat = await getAsync('SELECT id, user_id FROM chats WHERE id = $1 AND deleted_at IS NULL', [chatId]);
    if (!chat) return res.status(404).json({ error: 'Chat nao encontrado' });
    if (chat.user_id !== userId) return res.status(403).json({ error: 'Voce nao tem permissao para excluir este chat' });

    await runAsync('UPDATE chats SET deleted_at = NOW() WHERE id = $1', [chatId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Hard delete: remove permanentemente TODAS as conversas do usuario.
// Usado pela acao "limpar tudo" nas configuracoes.
// CASCADE no banco tambem remove mensagens associadas.
router.delete('/user/chats', async (req, res, next) => {
  const userId = req.userId;
  try {
    const result = await runAsync('DELETE FROM chats WHERE user_id = $1', [userId]);
    res.json({ deleted: result.changes });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 3. ATUALIZACOES PONTUAIS (menu de contexto da conversa)
// ---------------------------------------------------------------------------

// Renomeia a conversa. Titulo truncado em 50 caracteres.
// Usado pelo menu de contexto e tambem pela geracao automatica de titulo.
router.patch('/chats/:chatId/title', async (req, res, next) => {
  const userId = req.userId;
  const { chatId } = req.params;
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  try {
    const chat = await getAsync('SELECT id, user_id FROM chats WHERE id = $1 AND deleted_at IS NULL', [chatId]);
    if (!chat) return res.status(404).json({ error: 'Chat nao encontrado' });
    if (chat.user_id !== userId) return res.status(403).json({ error: 'Voce nao tem permissao para renomear este chat' });

    const trimmed = title.trim().substring(0, 50);
    await runAsync('UPDATE chats SET title = $1, updated_at = NOW() WHERE id = $2', [trimmed, chatId]);
    res.json({ ok: true, title: trimmed });
  } catch (err) { next(err); }
});

// Arquiva ou desarquiva uma conversa.
// Conversas arquivadas nao aparecem na listagem padrao,
// mas podem ser recuperadas com o parametro include_archived=true.
router.patch('/chats/:chatId/archive', async (req, res, next) => {
  const userId = req.userId;
  const { chatId } = req.params;
  const { archived } = req.body;
  try {
    const chat = await getAsync('SELECT id, user_id FROM chats WHERE id = $1 AND deleted_at IS NULL', [chatId]);
    if (!chat) return res.status(404).json({ error: 'Chat nao encontrado' });
    if (chat.user_id !== userId) return res.status(403).json({ error: 'Voce nao tem permissao para arquivar este chat' });

    const shouldArchive = archived !== false;
    await runAsync(
      shouldArchive
        ? 'UPDATE chats SET archived_at = NOW() WHERE id = $1'
        : 'UPDATE chats SET archived_at = NULL WHERE id = $1',
      [chatId]
    );
    res.json(await getAsync('SELECT * FROM chats WHERE id = $1', [chatId]));
  } catch (err) { next(err); }
});

// Fixa ou desafixa uma conversa no topo da sidebar.
// Conversas fixadas aparecem antes das demais, independente da data de atualizacao.
router.patch('/chats/:chatId/pin', async (req, res, next) => {
  const userId = req.userId;
  const { chatId } = req.params;
  const { pinned } = req.body;
  try {
    const chat = await getAsync('SELECT id, user_id FROM chats WHERE id = $1 AND deleted_at IS NULL', [chatId]);
    if (!chat) return res.status(404).json({ error: 'Chat nao encontrado' });
    if (chat.user_id !== userId) return res.status(403).json({ error: 'Voce nao tem permissao para fixar este chat' });

    await runAsync('UPDATE chats SET pinned = $1 WHERE id = $2', [pinned !== false, chatId]);
    res.json(await getAsync('SELECT * FROM chats WHERE id = $1', [chatId]));
  } catch (err) { next(err); }
});

// Move uma conversa para outro projeto ou a desvincula de qualquer projeto.
// project_id = null ou "none" transforma a conversa em avulsa.
// Verifica se o projeto de destino existe e pertence ao usuario.
router.patch('/chats/:chatId/project', async (req, res, next) => {
  const userId = req.userId;
  const { chatId } = req.params;
  let { project_id } = req.body;
  if (project_id === 'none' || project_id === undefined) project_id = null;

  try {
    const chat = await getAsync('SELECT id, user_id, project_id FROM chats WHERE id = $1 AND deleted_at IS NULL', [chatId]);
    if (!chat) return res.status(404).json({ error: 'Chat nao encontrado' });
    if (chat.user_id !== userId) return res.status(403).json({ error: 'Voce nao tem permissao para mover este chat' });

    if (project_id) {
      const project = await getAsync('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [project_id, userId]);
      if (!project) return res.status(404).json({ error: 'Projeto de destino nao encontrado' });
    }

    await runAsync(
      'UPDATE chats SET project_id = $1, updated_at = NOW() WHERE id = $2',
      [project_id, chatId]
    );
    res.json(await getAsync('SELECT * FROM chats WHERE id = $1', [chatId]));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 4. LISTAGEM PAGINADA
// ---------------------------------------------------------------------------

// Lista conversas de um projeto especifico, com paginacao.
// Suporta inclusao opcional de conversas arquivadas.
// Ordenacao: fixadas primeiro, depois por data de atualizacao (mais recentes).
router.get('/projects/:projectId/chats', async (req, res, next) => {
  const userId = req.userId;
  const { projectId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 30;
  const offset = (page - 1) * limit;
  const includeArchived = req.query.include_archived === 'true' || req.query.include_archived === '1';
  const archivedClause = includeArchived ? '' : 'AND archived_at IS NULL';

  try {
    // Confirma que o projeto pertence ao usuario
    const project = await getAsync('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto nao encontrado' });

    const totalRow = await getAsync(
      `SELECT COUNT(*) AS total FROM chats WHERE project_id = $1 AND deleted_at IS NULL ${archivedClause}`,
      [projectId]
    );
    const total = parseInt(totalRow?.total || 0);

    const rows = await allAsync(
      `SELECT id, title, project_id, pinned, archived_at, created_at, updated_at
       FROM chats
       WHERE project_id = $1 AND deleted_at IS NULL ${archivedClause}
       ORDER BY pinned DESC, updated_at DESC
       LIMIT $2 OFFSET $3`,
      [projectId, limit, offset]
    );

    res.json({ data: rows, total, page, limit, hasMore: offset + rows.length < total });
  } catch (err) { next(err); }
});

// Lista conversas avulsas do usuario (sem projeto vinculado).
// Filtra conversas que possuem pelo menos uma mensagem,
// evitando exibir conversas vazias criadas acidentalmente.
router.get('/user/chats', async (req, res, next) => {
  const userId = req.userId;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 30;
  const offset = (page - 1) * limit;
  const includeArchived = req.query.include_archived === 'true' || req.query.include_archived === '1';
  const archivedClause = includeArchived ? '' : 'AND archived_at IS NULL';

  try {
    const totalRow = await getAsync(
      `SELECT COUNT(*) AS total
       FROM chats
       WHERE user_id = $1 AND project_id IS NULL AND deleted_at IS NULL ${archivedClause}
         AND id IN (SELECT DISTINCT chat_id FROM messages)`,
      [userId]
    );
    const total = parseInt(totalRow?.total || 0);

    const rows = await allAsync(
      `SELECT id, title, project_id, pinned, archived_at, created_at, updated_at
       FROM chats
       WHERE user_id = $1 AND project_id IS NULL AND deleted_at IS NULL ${archivedClause}
         AND id IN (SELECT DISTINCT chat_id FROM messages)
       ORDER BY pinned DESC, updated_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    res.json({ data: rows, total, page, limit, hasMore: offset + rows.length < total });
  } catch (err) { next(err); }
});

export default router;