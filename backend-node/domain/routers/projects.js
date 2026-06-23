// domain/routers/projects.js
//
// Rotas de gerenciamento de projetos — CRUD completo, com otimizacao
// automatica de personalidade customizada e resolucao do modelo de IA.
//
// Cada projeto isola seu proprio contexto: chats, memorias, arquivos,
// fontes e personalidade. O response_style do projeto tem prioridade
// sobre a personalidade global do usuario (definida em user_settings).
//
// Middleware extractUserId aplicado a todas as rotas; userId vem do
// header Authorization (Bearer token Supabase) ou do ID anonimo no
// modo convidado.
//
// Agrupamento logico:
//   1. Listagem de projetos
//   2. Obter projeto especifico com seus chats
//   3. Criacao de projeto (com otimizacao de personalidade)
//   4. Atualizacao parcial de projeto
//   5. Exclusao de projeto
//   6. Funcao auxiliar: resolveModelForRequest (exportada para outros modulos)

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { runAsync, getAsync, allAsync } from '../../db/database.js';
import { invalidateSystemPromptCache, optimizePersonalityText } from '../ai/prompt.js';
import { extractUserId } from '../../middleware/auth.js';

const router = Router();

// Aplica o middleware de autenticacao em todas as rotas deste router.
// O userId pode ser um UUID de conta ou um ID anonimo (convidado).
router.use(extractUserId);

// ---------------------------------------------------------------------------
// 1. LISTAGEM DE PROJETOS
// ---------------------------------------------------------------------------

/**
 * Lista todos os projetos do usuario, ordenados do mais recente.
 * GET /api/projects
 */
router.get('/projects', async (req, res, next) => {
  const userId = req.userId;
  try {
    const rows = await allAsync('SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 2. OBTER PROJETO ESPECIFICO COM SEUS CHATS
// ---------------------------------------------------------------------------

/**
 * Retorna um projeto com sua lista de chats.
 *
 * Comportamento dos chats:
 *   - Chats soft-deletados (deleted_at IS NOT NULL) NUNCA aparecem.
 *   - Chats arquivados (archived_at IS NOT NULL) ficam de fora por padrao,
 *     a menos que o parametro include_archived=true seja enviado.
 *   - Ordenacao: fixados primeiro (pinned DESC), depois por data de
 *     atualizacao (updated_at DESC) — mesma regra da sidebar.
 *
 * GET /api/projects/:id
 */
router.get('/projects/:id', async (req, res, next) => {
  const userId = req.userId;
  const includeArchived = req.query.include_archived === 'true' || req.query.include_archived === '1';
  const archivedClause = includeArchived ? '' : 'AND archived_at IS NULL';
  try {
    const project = await getAsync('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const chats = await allAsync(
      `SELECT * FROM chats
       WHERE project_id = $1 AND deleted_at IS NULL ${archivedClause}
       ORDER BY pinned DESC, updated_at DESC`,
      [req.params.id]
    );
    res.json({ ...project, chats });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 3. CRIACAO DE PROJETO (COM OTIMIZACAO DE PERSONALIDADE)
// ---------------------------------------------------------------------------

/**
 * Cria um novo projeto.
 *
 * O campo response_style pode ser:
 *   - Um preset conhecido (ex: "tecnico", "analitico", "direto"):
 *     salvo como a propria string, sem chamar o Python.
 *   - Texto livre escrito pelo usuario:
 *     enviado para optimizePersonalityText(), que chama o microsservico
 *     Python para reescrever de forma compacta (max 280 caracteres).
 *     Se o Python falhar, um fallback local normaliza espacos e trunca.
 *
 * Essa otimizacao economiza tokens em TODA mensagem dentro do projeto,
 * ja que o texto de personalidade entra no system prompt a cada chamada.
 *
 * POST /api/projects
 */
router.post('/projects', async (req, res, next) => {
  const userId = req.userId;
  const {
    name, summary, detailed_objective, tags = [], response_style = 'direto',
    memory_mode = 'projeto', gemini_version = 'flash',
    instructions = null, shared_memory_enabled = false,
  } = req.body;

  if (!name) return res.status(400).json({ error: 'name obrigatório' });

  try {
    const id = randomUUID();
    // Otimiza a personalidade antes de salvar: preset fica intacto,
    // texto livre e reescrito de forma compacta.
    const finalResponseStyle = await optimizePersonalityText(response_style);

    await runAsync(
      'INSERT INTO projects (id, user_id, name, summary, detailed_objective, tags, response_style, memory_mode, gemini_version, instructions, shared_memory_enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, userId, name, summary || null, detailed_objective || null, JSON.stringify(tags), finalResponseStyle, memory_mode, gemini_version, instructions || null, !!shared_memory_enabled]
    );

    res.status(201).json(await getAsync('SELECT * FROM projects WHERE id = $1', [id]));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 4. ATUALIZACAO PARCIAL DE PROJETO
// ---------------------------------------------------------------------------

/**
 * Atualiza um projeto (PATCH parcial).
 *
 * Comportamento por campo:
 *   - Campos omitidos ou null: mantem o valor atual (via COALESCE no SQL).
 *   - response_style: se enviado (mesmo que string vazia), passa por
 *     optimizePersonalityText(). Se NAO enviado (undefined), mantem o atual.
 *   - shared_memory_enabled: booleano. `false` e um valor valido (desliga o
 *     compartilhamento). Apenas `undefined` e tratado como "nao enviado".
 *     `null` explicito faz o COALESCE manter o valor atual.
 *
 * Apos atualizar, invalida o cache do system prompt para que a proxima
 * mensagem use os novos valores (personalidade, instrucoes, etc.).
 *
 * PATCH /api/projects/:id
 */
router.patch('/projects/:id', async (req, res, next) => {
  const userId = req.userId;
  const { name, summary, detailed_objective, tags, response_style, memory_mode, gemini_version, instructions, shared_memory_enabled } = req.body;

  try {
    const project = await getAsync('SELECT id, memory_mode FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const newMemoryMode = memory_mode ?? project.memory_mode;

    // So chama otimizacao se response_style foi explicitamente enviado.
    // typeof === 'string' cobre string vazia (usuario limpou o campo).
    const finalResponseStyle = typeof response_style === 'string'
      ? await optimizePersonalityText(response_style)
      : null;

    // shared_memory_enabled: false e um valor valido (desliga).
    // Apenas undefined e tratado como "nao enviado" -> mantem atual.
    const sharedMemoryParam = typeof shared_memory_enabled === 'boolean' ? shared_memory_enabled : null;

    await runAsync(
      `UPDATE projects SET
        name = COALESCE($1, name),
        summary = COALESCE($2, summary),
        detailed_objective = COALESCE($3, detailed_objective),
        tags = COALESCE($4, tags),
        response_style = COALESCE($5, response_style),
        memory_mode = COALESCE($6, memory_mode),
        gemini_version = COALESCE($7, gemini_version),
        instructions = COALESCE($8, instructions),
        shared_memory_enabled = COALESCE($9, shared_memory_enabled),
        updated_at = NOW()
      WHERE id = $10`,
      [name ?? null, summary ?? null, detailed_objective ?? null, tags ? JSON.stringify(tags) : null, finalResponseStyle, newMemoryMode, gemini_version ?? null, instructions ?? null, sharedMemoryParam, req.params.id]
    );

    invalidateSystemPromptCache(userId, req.params.id);
    res.json(await getAsync('SELECT * FROM projects WHERE id = $1', [req.params.id]));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 5. EXCLUSAO DE PROJETO
// ---------------------------------------------------------------------------

/**
 * Exclui permanentemente um projeto.
 *
 * O DELETE e em cascata: chats, mensagens, memorias, arquivos e fontes
 * vinculados ao projeto sao removidos automaticamente pelo banco
 * (ON DELETE CASCADE).
 *
 * Invalida o cache do system prompt para remover entradas obsoletas.
 *
 * DELETE /api/projects/:id
 */
router.delete('/projects/:id', async (req, res, next) => {
  const userId = req.userId;
  try {
    const project = await getAsync('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    await runAsync('DELETE FROM projects WHERE id = $1', [req.params.id]);
    invalidateSystemPromptCache(userId, req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 6. RESOLUCAO DE MODELO PARA REQUISICAO (EXPORTADA)
// ---------------------------------------------------------------------------

/**
 * Determina qual modelo de IA usar para uma requisicao.
 *
 * Prioridade:
 *   1. Se a conversa esta dentro de um projeto, usa o modelo definido
 *      no projeto (projects.gemini_version).
 *   2. Se nao ha projeto, mas o header x-model indica "pro" E o usuario
 *      esta autenticado, usa "pro" (modo Pro com pre-processamento).
 *   3. Caso contrario, usa "flash" (Gemini direto, disponivel para todos).
 *
 * Usuarios convidados nunca recebem "pro" — o modo Pro e exclusivo para
 * contas autenticadas.
 *
 * Exportada e usada por:
 *   - messages.js (POST /messages/stream e /messages)
 *   - agent.js (POST /agent/run)
 *
 * @param {string}  userId      - ID do usuario (null para convidado anonimo)
 * @param {string}  projectId   - ID do projeto (ou null)
 * @param {string}  headerModel - Valor do header x-model enviado pelo frontend
 * @returns {Promise<string>} "flash" ou "pro"
 */
export async function resolveModelForRequest(userId, projectId, headerModel) {
  // Projeto define o modelo: se existir, usa o que esta salvo.
  if (projectId) {
    const project = await getAsync('SELECT gemini_version FROM projects WHERE id = $1', [projectId]);
    if (project && project.gemini_version) return project.gemini_version;
    return 'flash';
  }

  // Sem projeto: "pro" so se o usuario autenticado solicitou explicitamente.
  if (headerModel === 'pro' && userId) return 'pro';

  // Fallback seguro: Flash funciona para qualquer usuario (autenticado ou convidado).
  return 'flash';
}

export default router;