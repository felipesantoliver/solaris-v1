// backend-node/src/services/db.js
//
// Funções de banco de dados com SELECT seletivo (evita SELECT *)
// e reutiliza o pool/helpers do módulo principal.

import { getPool, runAsync, getAsync, allAsync } from '../../db/database.js';

// ─── Projetos ────────────────────────────────────────────────────────────

/**
 * Busca UM projeto com campos selecionados (não `SELECT *`).
 * Retorna null se não encontrado.
 */
export async function getProjectSelective(projectId, userId) {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT id, name, summary, detailed_objective, tags, memory_mode
     FROM projects
     WHERE id = $1 AND user_id = $2`,
    [projectId, userId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  // Garante que tags seja um array (pode vir como string do JSONB)
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    detailed_objective: row.detailed_objective,
    tags: Array.isArray(row.tags) ? row.tags : JSON.parse(row.tags || '[]'),
    memory_mode: row.memory_mode || 'projeto'
  };
}

/**
 * Busca TODOS os projetos do usuário (apenas campos essenciais).
 */
export async function getProjectsSelective(userId) {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT id, name, summary, detailed_objective, tags, memory_mode
     FROM projects
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    summary: row.summary,
    detailed_objective: row.detailed_objective,
    tags: Array.isArray(row.tags) ? row.tags : JSON.parse(row.tags || '[]'),
    memory_mode: row.memory_mode || 'projeto'
  }));
}

/**
 * Busca projeto COMPLETO (para operações que precisam de todos os campos).
 * Use com moderação – prefira getProjectSelective quando possível.
 */
export async function getProjectFull(projectId, userId) {
  const result = await getAsync(
    'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
    [projectId, userId]
  );
  if (!result) return null;
  return {
    ...result,
    tags: Array.isArray(result.tags) ? result.tags : JSON.parse(result.tags || '[]')
  };
}

/**
 * Atualiza um projeto (apenas campos que podem mudar via PATCH).
 * Retorna o projeto atualizado com SELECT seletivo.
 */
export async function updateProjectSelective(projectId, userId, updates) {
  const fields = [];
  const values = [];
  let idx = 1;

  const map = {
    name: updates.name,
    summary: updates.summary,
    detailed_objective: updates.detailed_objective,
    response_style: updates.response_style,
    memory_mode: updates.memory_mode,
    gemini_version: updates.gemini_version
  };

  for (const [key, value] of Object.entries(map)) {
    if (value !== undefined) {
      fields.push(`${key} = $${idx++}`);
      values.push(value);
    }
  }

  if (updates.tags !== undefined) {
    fields.push(`tags = $${idx++}`);
    values.push(JSON.stringify(updates.tags));
  }

  if (fields.length === 0) {
    // Nada para atualizar – retorna o projeto atual
    return getProjectSelective(projectId, userId);
  }

  values.push(projectId, userId);
  const query = `
    UPDATE projects
    SET ${fields.join(', ')}, updated_at = NOW()
    WHERE id = $${idx++} AND user_id = $${idx}
    RETURNING id, name, summary, detailed_objective, tags, memory_mode
  `;

  const pool = await getPool();
  const result = await pool.query(query, values);
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    detailed_objective: row.detailed_objective,
    tags: Array.isArray(row.tags) ? row.tags : JSON.parse(row.tags || '[]'),
    memory_mode: row.memory_mode || 'projeto'
  };
}

/**
 * Deleta um projeto (verifica ownership).
 */
export async function deleteProject(projectId, userId) {
  const result = await runAsync(
    'DELETE FROM projects WHERE id = $1 AND user_id = $2',
    [projectId, userId]
  );
  return result.changes > 0;
}

// ─── Chats ──────────────────────────────────────────────────────────────

/**
 * Busca chats de um projeto (apenas campos para listagem).
 */
export async function getChatsByProject(projectId, limit = 30, offset = 0) {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT id, title, created_at, updated_at
     FROM chats
     WHERE project_id = $1
     ORDER BY updated_at DESC
     LIMIT $2 OFFSET $3`,
    [projectId, limit, offset]
  );
  return result.rows;
}

/**
 * Busca chats avulsos do usuário (sem projeto) com paginação.
 */
export async function getUserChats(userId, limit = 30, offset = 0) {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT id, title, created_at, updated_at
     FROM chats
     WHERE user_id = $1 AND project_id IS NULL
       AND id IN (SELECT DISTINCT chat_id FROM messages)
     ORDER BY updated_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result.rows;
}

// ─── Mensagens ──────────────────────────────────────────────────────────

/**
 * Busca mensagens de um chat (apenas role e content para o contexto LLM).
 * Para exibição completa, use a query original com todos os campos.
 */
export async function getMessagesForLLM(chatId) {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT role, content
     FROM messages
     WHERE chat_id = $1
     ORDER BY created_at ASC`,
    [chatId]
  );
  return result.rows;
}

/**
 * Busca mensagens para exibição (com id, edit_history, created_at, etc.)
 */
export async function getMessagesDisplay(chatId, limit = 30, offset = 0) {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT id, role, content, edited, edit_history, created_at
     FROM messages
     WHERE chat_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [chatId, limit, offset]
  );
  return result.rows;
}

// Re-exporta helpers do módulo principal para conveniência
export { runAsync, getAsync, allAsync, getPool };