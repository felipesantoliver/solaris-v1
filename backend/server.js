// domain/routers/files.js (trecho adicional)
import { createClient } from '@supabase/supabase-js';
import { getAsync } from '../../db/database.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Middleware para extrair userId do token JWT ou guestId
async function authenticateRequest(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (!error && user) {
      req.userId = user.id;
      return next();
    }
  }
  // fallback para guest mode (apenas se o arquivo for público ou pertencer ao guestId)
  const guestId = req.headers['x-user-id'];
  if (guestId) {
    req.userId = guestId;
    return next();
  }
  res.status(401).json({ error: 'Não autorizado' });
}

// GET /api/files/:id/download – baixar arquivo com verificação de propriedade
router.get('/files/:id/download', authenticateRequest, async (req, res, next) => {
  try {
    const fileId = req.params.id;
    const file = await getAsync(
      'SELECT * FROM files WHERE id = $1',
      [fileId]
    );
    if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });

    // Verifica se o usuário tem acesso ao projeto do arquivo
    const project = await getAsync(
      'SELECT user_id FROM projects WHERE id = $1',
      [file.project_id]
    );
    if (!project || project.user_id !== req.userId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const filePath = path.join(__dirname, '../../uploads', file.path || fileId);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Arquivo não encontrado no disco' });
    }

    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_name)}"`);
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
});