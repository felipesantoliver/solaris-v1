// domain/routers/files.js
//
// Rotas de gerenciamento de arquivos — upload, listagem, deleção e download.
//
// Responsavel por receber arquivos enviados pelo usuario, extrair texto
// via microsservico Python, persistir binario e metadados no banco,
// disparar indexacao RAG em background e permitir download posterior.
//
// Caracteristicas importantes:
//   - Binario salvo na coluna content BYTEA (nao em disco — evita perda no
//     Render, que tem sistema de arquivos ephemeral).
//   - Extracao de texto com timeout (15s via AbortController) para nao
//     travar a requisicao em PDFs grandes ou servico lento.
//   - Upload nunca falha por falha na extracao: arquivo e salvo mesmo sem
//     texto extraido (fica sem indexacao RAG, mas ainda e baixavel).
//   - Suporte a arquivos em chats avulsos (sem projeto) desde a v4.1.
//
// Ordem de registro das rotas (IMPORTANTE):
//   Rotas /files/chat/... sao registradas ANTES de /files/:projectId
//   porque :projectId e um segmento curinga no Express. Se viesse primeiro,
//   capturaria literalmente "chat" como valor de projectId, nunca alcancando
//   o handler correto.
//
// Agrupamento logico:
//   1. Constantes e configuracao do multer
//   2. Helpers compartilhados (upload middleware, extracao, persistencia)
//   3. Rotas de chat avulso (/files/chat/...)
//   4. Rotas de projeto (/files/:projectId)
//   5. Download de arquivo

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import { runAsync, getAsync, allAsync } from '../../db/database.js';
import { invalidateSystemPromptCache } from '../ai/prompt.js';
import { indexFileChunks } from '../ai/embeddings.js';
import { extractUserId } from '../../middleware/auth.js';

const router = Router();

// ---------------------------------------------------------------------------
// 1. CONSTANTES E CONFIGURACAO DO MULTER
// ---------------------------------------------------------------------------

// Extensoes de arquivo permitidas para upload.
// Foco em formatos textuais e de codigo (para extracao e indexacao RAG).
const ALLOWED_EXTS = ['.pdf', '.txt', '.md', '.json', '.js', '.ts', '.py', '.css', '.html', '.csv'];

// Tamanho maximo de arquivo: 10 MB.
// Limite suficiente para documentos, codigos-fonte e PDFs tipicos.
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Timeout para extracao de texto no microsservico Python.
// 15 segundos cobrem o pior caso (PDF grande e complexo) sem travar
// a requisicao do usuario por tempo excessivo.
const EXTRACT_TIMEOUT_MS = 15_000;

// URL base do microsservico Python para extracao de texto.
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

// Configuracao do multer: armazenamento em memoria (memoryStorage).
// O buffer resultante e salvo diretamente na coluna BYTEA do banco,
// sem passar pelo sistema de arquivos (que e ephemeral no Render).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) {
      return cb(
        Object.assign(
          new Error(`Tipo de arquivo não permitido: ${ext}. Permitidos: ${ALLOWED_EXTS.join(', ')}`),
          { code: 'INVALID_FILE_TYPE' }
        )
      );
    }
    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// 2. HELPERS COMPARTILHADOS
// ---------------------------------------------------------------------------

/**
 * Middleware compartilhado de upload.
 *
 * Faz o parsing do multipart/form-data e traduz erros do multer em
 * respostas HTTP apropriadas:
 *   - LIMIT_FILE_SIZE -> 413 (Payload Too Large)
 *   - INVALID_FILE_TYPE -> 415 (Unsupported Media Type)
 *
 * Usado tanto no upload por projeto quanto no upload por chat avulso.
 */
function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE')
      return res.status(413).json({ error: `Arquivo muito grande. Máximo: ${MAX_FILE_SIZE / 1024 / 1024}MB.` });
    if (err?.code === 'INVALID_FILE_TYPE')
      return res.status(415).json({ error: err.message });
    if (err) return next(err);
    next();
  });
}

/**
 * Extrai texto de um arquivo via microsservico Python, com timeout.
 *
 * Comportamento:
 *   - Envia o buffer do arquivo como multipart/form-data para o Python.
 *   - Timeout de EXTRACT_TIMEOUT_MS (15s) via AbortController.
 *   - Status 415 (tipo nao suportado) e esperado e nao e tratado como erro:
 *     significa que o formato nao tem texto extraivel (ex: binario).
 *   - Em qualquer falha (timeout, rede, erro do Python), retorna string vazia
 *     e loga o motivo. O upload do arquivo NAO DEVE FALHAR por causa da
 *     extracao de texto — o arquivo continua salvo e baixavel, apenas fica
 *     sem indexacao RAG.
 *
 * @param {Object} file - Objeto do multer com { buffer, originalname, mimetype }
 * @returns {Promise<string>} Texto extraido ou string vazia em caso de falha
 */
async function extractTextSafely(file) {
  try {
    const formData = new FormData();
    const blob = new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' });
    formData.append('file', blob, file.originalname);
    formData.append('mime_type', file.mimetype || '');

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), EXTRACT_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(`${PYTHON_SERVICE_URL}/files/extract-text`, {
        method: 'POST',
        body: formData,
        signal: ac.signal,
      });
    } finally {
      clearTimeout(t);
    }

    if (!response.ok) {
      // 415: tipo nao suportado pelo parser de texto (ex: binario nao-PDF).
      // Nao e um erro real — apenas nao ha texto a extrair.
      if (response.status !== 415) {
        const detail = await response.text().catch(() => '');
        console.error(`Erro ao extrair texto com Python (${response.status}): ${detail}`);
      }
      return '';
    }

    const data = await response.json();
    return data.text || '';
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error(`⏱️ Timeout (${EXTRACT_TIMEOUT_MS}ms) ao extrair texto de "${file.originalname}"`);
    } else {
      console.error('Falha na comunicação com microsserviço Python:', err.message);
    }
    return '';
  }
}

/**
 * Persiste um arquivo no banco e dispara indexacao RAG em background.
 *
 * Fluxo:
 *   1. Extrai texto do arquivo via microsservico Python (com timeout)
 *   2. Insere registro na tabela files (metadados + buffer binario + texto)
 *   3. Se houve texto extraido, dispara indexFileChunks() em background
 *      para gerar embeddings e habilitar busca RAG sobre este arquivo
 *   4. Invalida cache do system prompt para incluir a nova fonte
 *
 * Compartilhado pelos handlers de upload em projeto e em chat avulso.
 *
 * @param {Object}  params
 * @param {Object}  params.file      - Arquivo do multer
 * @param {string}  params.projectId - ID do projeto (ou null)
 * @param {string}  params.chatId    - ID do chat (ou null)
 * @param {string}  params.userId    - ID do usuario
 * @returns {Promise<Object>} Metadados do arquivo persistido
 */
async function persistUploadedFile({ file, projectId, chatId, userId }) {
  const extractedText = await extractTextSafely(file);

  const fileId = randomUUID();
  await runAsync(
    `INSERT INTO files (id, project_id, chat_id, original_name, mime_type, size, extracted_text, content)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [fileId, projectId || null, chatId || null, file.originalname, file.mimetype, file.size, extractedText, file.buffer]
  );

  // Dispara indexacao RAG em background (nao bloqueia a resposta ao usuario).
  // Sem esta chamada, o RAG nunca encontra conteudo de arquivos.
  if (extractedText) {
    indexFileChunks(fileId, extractedText, { runAsync }).catch(err =>
      console.error('❌ Erro ao indexar chunks:', err.message)
    );
  }

  // Invalida cache para que a proxima conversa inclua este arquivo no contexto
  if (userId) invalidateSystemPromptCache(userId, projectId || null);

  return {
    id: fileId,
    original_name: file.originalname,
    size: file.size,
    extracted_text_length: extractedText.length,
  };
}

// ---------------------------------------------------------------------------
// 3. ROTAS DE CHAT AVULSO (/files/chat/...)
// ---------------------------------------------------------------------------
// Registradas ANTES das rotas genericas /files/:projectId.
// Ver nota sobre ordem de matching do Express no cabecalho deste arquivo.

/**
 * Lista arquivos anexados a um chat avulso (sem projeto).
 * GET /files/chat/:chatId
 */
router.get('/files/chat/:chatId', extractUserId, async (req, res, next) => {
  try {
    const rows = await allAsync(
      'SELECT id, original_name, mime_type, size, created_at FROM files WHERE chat_id = $1 ORDER BY created_at DESC',
      [req.params.chatId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * Upload de arquivo diretamente em um chat (com ou sem projeto).
 *
 * Verifica ownership do chat antes de aceitar o upload.
 * Se o chat pertence a um projeto, propaga o project_id para que
 * o arquivo entre na indexacao RAG do projeto, em vez de ficar
 * visivel apenas pelo chat.
 *
 * POST /files/chat/:chatId
 */
router.post('/files/chat/:chatId', extractUserId, handleUpload, async (req, res, next) => {
  const userId = req.userId;
  const { chatId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

  try {
    const chat = await getAsync('SELECT id, user_id, project_id FROM chats WHERE id = $1', [chatId]);
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });
    if (chat.user_id !== userId) return res.status(403).json({ error: 'Você não tem permissão para anexar arquivos neste chat' });

    const result = await persistUploadedFile({
      file: req.file,
      projectId: chat.project_id || null,
      chatId,
      userId,
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

/**
 * Exclui um arquivo anexado a um chat avulso.
 * DELETE /files/chat/:chatId/:fileId
 */
router.delete('/files/chat/:chatId/:fileId', extractUserId, async (req, res, next) => {
  const userId = req.userId;
  try {
    const file = await getAsync(
      'SELECT id FROM files WHERE id = $1 AND chat_id = $2',
      [req.params.fileId, req.params.chatId]
    );
    if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });

    await runAsync('DELETE FROM files WHERE id = $1', [req.params.fileId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 4. ROTAS DE PROJETO (/files/:projectId)
// ---------------------------------------------------------------------------
// Rotas originais, mantidas inalteradas para compatibilidade.

/**
 * Lista arquivos de um projeto.
 * GET /files/:projectId
 */
router.get('/files/:projectId', async (req, res, next) => {
  try {
    const rows = await allAsync(
      'SELECT id, original_name, mime_type, size, created_at FROM files WHERE project_id = $1 ORDER BY created_at DESC',
      [req.params.projectId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * Upload de arquivo dentro de um projeto.
 * POST /files/:projectId
 */
router.post('/files/:projectId', extractUserId, handleUpload, async (req, res, next) => {
  const userId = req.userId;
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

  const projectId = req.params.projectId;

  try {
    const result = await persistUploadedFile({ file: req.file, projectId, chatId: null, userId });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

/**
 * Exclui um arquivo de projeto e invalida o cache do system prompt.
 * DELETE /files/:projectId/:fileId
 */
router.delete('/files/:projectId/:fileId', extractUserId, async (req, res, next) => {
  const userId = req.userId;
  try {
    const file = await getAsync(
      'SELECT id FROM files WHERE id = $1 AND project_id = $2',
      [req.params.fileId, req.params.projectId]
    );
    if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });

    await runAsync('DELETE FROM files WHERE id = $1', [req.params.fileId]);
    if (userId) invalidateSystemPromptCache(userId, req.params.projectId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 5. DOWNLOAD DE ARQUIVO
// ---------------------------------------------------------------------------

/**
 * Download do binario original do arquivo.
 *
 * Le diretamente da coluna content (BYTEA) do banco, sem depender de
 * sistema de arquivos em disco (que e ephemeral no Render).
 *
 * Resolucao de ownership:
 *   Usa LEFT JOIN em projects E chats para encontrar o dono do arquivo,
 *   independente de ele estar vinculado a um projeto ou a um chat avulso.
 *   O COALESCE garante que o user_id correto seja usado em qualquer caso.
 *
 * GET /files/:id/download
 */
router.get('/files/:id/download', extractUserId, async (req, res, next) => {
  try {
    const fileId = req.params.id;
    const file = await getAsync(
      `SELECT f.id, f.original_name, f.mime_type, f.content,
              COALESCE(p.user_id, c.user_id) AS owner_user_id
       FROM files f
       LEFT JOIN projects p ON f.project_id = p.id
       LEFT JOIN chats c ON f.chat_id = c.id
       WHERE f.id = $1`,
      [fileId]
    );

    if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });
    if (file.owner_user_id !== req.userId)
      return res.status(403).json({ error: 'Acesso negado' });
    if (!file.content)
      return res.status(404).json({ error: 'Conteúdo do arquivo não disponível' });

    // Define Content-Disposition como inline para exibicao no navegador
    // (em vez de attachment que forcaria download automatico)
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_name)}"`);
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.send(file.content); // Buffer retornado pelo pg para coluna BYTEA
  } catch (err) { next(err); }
});

export default router;