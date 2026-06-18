// domain/routers/files.js — Upload, listagem, deleção e download autenticado
//
// Problema 5 corrigido: arquivos não são mais salvos no disco (ephemeral no Render).
//   O buffer binário vai para a coluna "content BYTEA" da tabela files.
//   O download lê diretamente do banco.
//
// Problema 4 corrigido: após inserir o arquivo, indexFileChunks() é chamado para
//   gerar os file_chunks com embedding, habilitando o RAG.

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

// Listar arquivos do projeto
router.get('/files/:projectId', async (req, res, next) => {
  try {
    const rows = await allAsync(
      'SELECT id, original_name, mime_type, size, created_at FROM files WHERE project_id = $1 ORDER BY created_at DESC',
      [req.params.projectId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// Upload de arquivo (com autenticação)
router.post('/files/:projectId', extractUserId, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE')
      return res.status(413).json({ error: `Arquivo muito grande. Máximo: ${MAX_FILE_SIZE / 1024 / 1024}MB.` });
    if (err?.code === 'INVALID_FILE_TYPE')
      return res.status(415).json({ error: err.message });
    if (err) return next(err);
    next();
  });
}, async (req, res, next) => {
  const userId   = req.userId;
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

  const file      = req.file;
  const projectId = req.params.projectId;

  // 1. Extrair texto via microsserviço Python
  let extractedText = '';
  try {
    const formData = new FormData();
    const blob = new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' });
    formData.append('file', blob, file.originalname);
    formData.append('mime_type', file.mimetype || '');

    const response = await fetch(`${PYTHON_SERVICE_URL}/files/extract-text`, {
      method: 'POST',
      body: formData,
    });

    if (response.ok) {
      const data = await response.json();
      extractedText = data.text || '';
    } else {
      console.error(`Erro ao extrair texto com Python: ${response.status}`);
    }
  } catch (err) {
    console.error('Falha na comunicação com microsserviço Python:', err.message);
  }

  // 2. Inserir no banco — o buffer binário vai para a coluna content (BYTEA)
  //    Problema 5: sem escrita em disco; o Render não tem volume persistente.
  const fileId = randomUUID();
  try {
    await runAsync(
      `INSERT INTO files (id, project_id, original_name, mime_type, size, extracted_text, content)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [fileId, projectId, file.originalname, file.mimetype, file.size, extractedText, file.buffer]
    );
  } catch (err) {
    return next(err);
  }

  // 3. Indexar chunks com embeddings (assíncrono — não bloqueia a resposta)
  //    Problema 4: sem essa chamada o RAG nunca encontra nada.
  if (extractedText) {
    indexFileChunks(fileId, extractedText, { runAsync }).catch(err =>
      console.error('❌ Erro ao indexar chunks:', err.message)
    );
  }

  // 4. Invalidar cache do system prompt
  if (userId) invalidateSystemPromptCache(userId, projectId);

  res.status(201).json({
    id: fileId,
    original_name: file.originalname,
    size: file.size,
    extracted_text_length: extractedText.length,
  });
});

// Deletar arquivo
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

// Download de arquivo — lê diretamente do banco (sem depender do disco)
router.get('/files/:id/download', extractUserId, async (req, res, next) => {
  try {
    const fileId = req.params.id;
    const file = await getAsync(
      `SELECT f.id, f.original_name, f.mime_type, f.content,
              p.user_id AS project_user_id
       FROM files f
       JOIN projects p ON f.project_id = p.id
       WHERE f.id = $1`,
      [fileId]
    );

    if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });
    if (file.project_user_id !== req.userId)
      return res.status(403).json({ error: 'Acesso negado' });
    if (!file.content)
      return res.status(404).json({ error: 'Conteúdo do arquivo não disponível' });

    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_name)}"`);
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.send(file.content); // file.content é um Buffer (pg retorna BYTEA como Buffer)
  } catch (err) { next(err); }
});

export default router;