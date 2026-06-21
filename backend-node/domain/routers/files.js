// domain/routers/files.js — Upload, listagem, deleção e download autenticado
//
// Problema 5 corrigido: arquivos não são mais salvos no disco (ephemeral no Render).
//   O buffer binário vai para a coluna "content BYTEA" da tabela files.
//   O download lê diretamente do banco.
//
// Problema 4 corrigido: após inserir o arquivo, indexFileChunks() é chamado para
//   gerar os file_chunks com embedding, habilitando o RAG.
//
// 4.1: arquivos agora podem pertencer a um chat avulso (sem projeto) — colunas
//   project_id/chat_id são mutuamente opcionais (mas não ambas nulas; ver
//   migração v7 em db/schema.js, que adiciona CHECK project_id IS NOT NULL OR
//   chat_id IS NOT NULL). Rotas antigas (/files/:projectId) continuam intactas;
//   rotas novas (/files/chat/:chatId) cobrem o caso sem projeto.
//   IMPORTANTE: as rotas /files/chat/... são registradas ANTES de /files/:projectId
//   — em Express, :projectId é um segmento curinga e capturaria literalmente
//   "chat" como valor de projectId se viesse primeiro, nunca chegando no handler
//   correto.
//
// 4.2: a chamada ao microsserviço Python (/files/extract-text) agora tem
//   timeout com AbortController (15s) — antes, um PDF grande ou o serviço
//   lento deixava a requisição pendurada indefinidamente, e no Render
//   (free tier, timeout curto) isso acabava em 502/504 sem mensagem útil
//   para o usuário. Agora falha de forma previsível e o upload continua
//   (arquivo é salvo mesmo sem texto extraído — ver comentário no catch).

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import { runAsync, getAsync, allAsync } from '../../db/database.js';
import { invalidateSystemPromptCache } from '../ai/prompt.js';
import { indexFileChunks } from '../ai/embeddings.js';
import { extractUserId } from '../../middleware/auth.js';

const router = Router();

const ALLOWED_EXTS = ['.pdf', '.txt', '.md', '.json', '.js', '.ts', '.py', '.css', '.html', '.csv'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const EXTRACT_TIMEOUT_MS = 15_000;

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

// Armazena o arquivo em memória para depois salvar no banco
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

// Middleware compartilhado: parseia multipart, traduz erros do multer em
// respostas HTTP apropriadas (413/415) — usado tanto no upload por projeto
// quanto no upload por chat.
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

// Extrai texto via microsserviço Python, com timeout protegido por
// AbortController. Nunca lança — em qualquer falha (timeout, 4xx/5xx, rede
// fora do ar), retorna string vazia e loga o motivo; o upload do arquivo
// em si não deve falhar só porque a extração de texto falhou (o arquivo
// continua sendo salvo e baixável, só fica sem indexação RAG).
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
      // 415 (tipo não suportado pelo parser de texto, ex: binário não-PDF) é
      // esperado e não é um erro de verdade — apenas não há texto a extrair.
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

// Insere o arquivo no banco e dispara a indexação RAG em background.
// Compartilhado pelos dois handlers de upload (projeto e chat avulso).
async function persistUploadedFile({ file, projectId, chatId, userId }) {
  const extractedText = await extractTextSafely(file);

  const fileId = randomUUID();
  await runAsync(
    `INSERT INTO files (id, project_id, chat_id, original_name, mime_type, size, extracted_text, content)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [fileId, projectId || null, chatId || null, file.originalname, file.mimetype, file.size, extractedText, file.buffer]
  );

  // Indexar chunks com embeddings (assíncrono — não bloqueia a resposta)
  // Problema 4: sem essa chamada o RAG nunca encontra nada.
  if (extractedText) {
    indexFileChunks(fileId, extractedText, { runAsync }).catch(err =>
      console.error('❌ Erro ao indexar chunks:', err.message)
    );
  }

  if (userId) invalidateSystemPromptCache(userId, projectId || null);

  return {
    id: fileId,
    original_name: file.originalname,
    size: file.size,
    extracted_text_length: extractedText.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Rotas /files/chat/... — registradas ANTES das genéricas /files/:projectId
// (ver nota no topo do arquivo sobre ordem de matching do Express).
// ═══════════════════════════════════════════════════════════════════════

// ─── 4.1: Listar arquivos de um chat avulso (sem projeto) ─────────────────
router.get('/files/chat/:chatId', extractUserId, async (req, res, next) => {
  try {
    const rows = await allAsync(
      'SELECT id, original_name, mime_type, size, created_at FROM files WHERE chat_id = $1 ORDER BY created_at DESC',
      [req.params.chatId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── 4.1: Upload de arquivo direto num chat (com ou sem projeto) ──────────
// Usado pelo input de anexo do chat quando não há projeto ativo. Verifica
// ownership do chat antes de aceitar o upload, e propaga o project_id do
// chat (se o chat já pertencer a um projeto) — assim o arquivo entra também
// na indexação/RAG do projeto, em vez de ficar "só visível pelo chat".
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

// ─── 4.1: Deletar arquivo anexado a um chat avulso ─────────────────────────
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

// ═══════════════════════════════════════════════════════════════════════
// Rotas /files/:projectId — genéricas (rota original, inalteradas)
// ═══════════════════════════════════════════════════════════════════════

// ─── Listar arquivos do projeto ────────────────────────────────────────────
router.get('/files/:projectId', async (req, res, next) => {
  try {
    const rows = await allAsync(
      'SELECT id, original_name, mime_type, size, created_at FROM files WHERE project_id = $1 ORDER BY created_at DESC',
      [req.params.projectId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── Upload de arquivo dentro de um projeto (rota original, inalterada) ───
router.post('/files/:projectId', extractUserId, handleUpload, async (req, res, next) => {
  const userId = req.userId;
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

  const projectId = req.params.projectId;

  try {
    const result = await persistUploadedFile({ file: req.file, projectId, chatId: null, userId });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// ─── Deletar arquivo de projeto (rota original, inalterada) ───────────────
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

// ─── Download de arquivo — lê diretamente do banco (sem depender do disco) ─
// 4.1: o JOIN original (INNER JOIN projects) excluía qualquer arquivo sem
// project_id — todo arquivo anexado direto a um chat avulso resultava em 404
// aqui, mesmo existindo no banco. Trocado por LEFT JOIN em projects E em
// chats, resolvendo o dono (e o user_id correspondente) por qualquer um dos
// dois caminhos.
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

    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_name)}"`);
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.send(file.content); // file.content é um Buffer (pg retorna BYTEA como Buffer)
  } catch (err) { next(err); }
});

export default router;