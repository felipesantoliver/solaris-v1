// domain/routers/chats.js — Criação/deleção de chats, títulos, listagem paginada
// e ações do menu de contexto da sidebar (arquivar, fixar).

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
// FIX (auditoria de segurança): a rota antes deletava qualquer chat só pelo
// chatId, sem checar se ele pertencia ao usuário autenticado (IDOR — qualquer
// pessoa com um chatId conseguia apagar a conversa de outra). Agora confere
// ownership antes de qualquer escrita, no mesmo padrão já usado em
// PATCH /chats/:chatId/project.
// Também passou a ser soft delete (deleted_at) em vez de DELETE em cascata:
// preserva mensagens e arquivos da conversa, abrindo espaço para uma futura
// tela de "lixeira"/recuperação, e evita perda de dados em caso de clique
// acidental (a UI já pede confirmação antes de chamar esta rota).
router.delete('/projects/:id/chats/:chatId', async (req, res, next) => {
  const userId = req.userId;
  const { chatId } = req.params;
  try {
    const chat = await getAsync('SELECT id, user_id FROM chats WHERE id = $1 AND deleted_at IS NULL', [chatId]);
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });
    if (chat.user_id !== userId) return res.status(403).json({ error: 'Você não tem permissão para excluir este chat' });

    await runAsync('UPDATE chats SET deleted_at = NOW() WHERE id = $1', [chatId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Atualizar título do chat ─────────────────────────────────────────────
// FIX (auditoria de segurança): rota antes não checava ownership do chat
// (qualquer chatId podia ser renomeado por qualquer usuário). Adicionada a
// mesma checagem usada nas demais rotas de manipulação.
router.patch('/chats/:chatId/title', async (req, res, next) => {
  const userId = req.userId;
  const { chatId } = req.params;
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title obrigatório' });
  try {
    const chat = await getAsync('SELECT id, user_id FROM chats WHERE id = $1 AND deleted_at IS NULL', [chatId]);
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });
    if (chat.user_id !== userId) return res.status(403).json({ error: 'Você não tem permissão para renomear este chat' });

    const trimmed = title.trim().substring(0, 50);
    await runAsync('UPDATE chats SET title = $1, updated_at = NOW() WHERE id = $2', [trimmed, chatId]);
    res.json({ ok: true, title: trimmed });
  } catch (err) { next(err); }
});

// ─── Arquivar / desarquivar chat ──────────────────────────────────────────
// Conversa arquivada some da listagem padrão (GET /projects/:id/chats e
// GET /user/chats) mas continua existindo e pode ser recuperada passando
// ?include_archived=true — a seção "Arquivados" na UI fica para uma próxima
// etapa; por enquanto só o "arquivar" (sumir da lista) está exposto no menu.
router.patch('/chats/:chatId/archive', async (req, res, next) => {
  const userId = req.userId;
  const { chatId } = req.params;
  const { archived } = req.body; // true (default) = arquiva · false = desarquiva
  try {
    const chat = await getAsync('SELECT id, user_id FROM chats WHERE id = $1 AND deleted_at IS NULL', [chatId]);
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });
    if (chat.user_id !== userId) return res.status(403).json({ error: 'Você não tem permissão para arquivar este chat' });

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

// ─── Fixar / desafixar chat ───────────────────────────────────────────────
// Conversas fixadas aparecem no topo da sidebar, antes das demais,
// independente de updated_at (ver ORDER BY pinned DESC, updated_at DESC
// nas rotas de listagem abaixo).
router.patch('/chats/:chatId/pin', async (req, res, next) => {
  const userId = req.userId;
  const { chatId } = req.params;
  const { pinned } = req.body; // true (default) = fixa · false = desafixa
  try {
    const chat = await getAsync('SELECT id, user_id FROM chats WHERE id = $1 AND deleted_at IS NULL', [chatId]);
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });
    if (chat.user_id !== userId) return res.status(403).json({ error: 'Você não tem permissão para fixar este chat' });

    await runAsync('UPDATE chats SET pinned = $1 WHERE id = $2', [pinned !== false, chatId]);
    res.json(await getAsync('SELECT * FROM chats WHERE id = $1', [chatId]));
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
    const chat = await getAsync('SELECT id, user_id, project_id FROM chats WHERE id = $1 AND deleted_at IS NULL', [chatId]);
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
  // Por padrão a lista ignora chats arquivados — ?include_archived=true
  // (ou =1) traz todos, inclusive os arquivados.
  const includeArchived = req.query.include_archived === 'true' || req.query.include_archived === '1';

  try {
    // Verifica se o projeto pertence ao usuário
    const project = await getAsync('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const pool = await getPool();

    // Soft-deletados nunca aparecem; arquivados só aparecem com include_archived.
    const archivedClause = includeArchived ? '' : 'AND archived_at IS NULL';

    // Total de chats do projeto
    const totalResult = await pool.query(
      `SELECT COUNT(*) AS total FROM chats WHERE project_id = $1 AND deleted_at IS NULL ${archivedClause}`,
      [projectId]
    );
    const total = parseInt(totalResult.rows[0]?.total || 0);

    // Dados paginados
    // FIX 4.3: inclui project_id na seleção — necessário para a UI saber a que
    // projeto o chat já pertence (ex: menu "mover para projeto" não deve
    // oferecer o projeto atual como destino).
    // Menu de contexto: inclui pinned/archived_at — pinned ordena no topo,
    // independente da ordem cronológica.
    const dataResult = await pool.query(
      `SELECT id, title, project_id, pinned, archived_at, created_at, updated_at
       FROM chats
       WHERE project_id = $1 AND deleted_at IS NULL ${archivedClause}
       ORDER BY pinned DESC, updated_at DESC
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
  const includeArchived = req.query.include_archived === 'true' || req.query.include_archived === '1';

  try {
    const pool = await getPool();
    const archivedClause = includeArchived ? '' : 'AND archived_at IS NULL';

    // Total de chats avulsos do usuário (que tenham pelo menos uma mensagem)
    const totalResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM chats
       WHERE user_id = $1 AND project_id IS NULL AND deleted_at IS NULL ${archivedClause}
         AND id IN (SELECT DISTINCT chat_id FROM messages)`,
      [userId]
    );
    const total = parseInt(totalResult.rows[0]?.total || 0);

    // Dados paginados
    // FIX 4.3: inclui project_id (sempre NULL aqui pela própria WHERE, mas
    // mantém o shape do objeto consistente com /projects/:projectId/chats —
    // a UI usa chat.project_id sem precisar saber qual endpoint o originou).
    // Menu de contexto: inclui pinned/archived_at, mesma ordenação acima.
    const dataResult = await pool.query(
      `SELECT id, title, project_id, pinned, archived_at, created_at, updated_at
       FROM chats
       WHERE user_id = $1 AND project_id IS NULL AND deleted_at IS NULL ${archivedClause}
         AND id IN (SELECT DISTINCT chat_id FROM messages)
       ORDER BY pinned DESC, updated_at DESC
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
// Ação explícita de "apagar tudo" (Configurações) — mantida como DELETE
// definitivo de propósito; é um caminho diferente do "Excluir" individual do
// menu de contexto, que agora é soft delete.
router.delete('/user/chats', async (req, res, next) => {
  const userId = req.userId;
  try {
    const result = await runAsync('DELETE FROM chats WHERE user_id = $1', [userId]);
    res.json({ deleted: result.changes });
  } catch (err) { next(err); }
});

export default router;