import { Router } from 'express';
import { allAsync, runAsync, getAsync } from '../database.js';
import { randomUUID } from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.txt', '.md', '.json', '.js', '.ts', '.py', '.css', '.html', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

const router = Router();

router.get('/:projectId', async (req, res) => {
  try {
    const files = await allAsync(
      'SELECT id, original_name, mime_type, size, created_at FROM files WHERE project_id = ? ORDER BY created_at DESC',
      [req.params.projectId]
    );
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:projectId', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    let extractedText = '';
    const textExts = ['.txt', '.md', '.json', '.js', '.ts', '.py', '.css', '.html', '.csv'];
    const ext = path.extname(req.file.originalname).toLowerCase();
    
    if (textExts.includes(ext)) {
      extractedText = fs.readFileSync(req.file.path, 'utf-8').substring(0, 50000);
    } else if (ext === '.pdf') {
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const buffer = fs.readFileSync(req.file.path);
        const data = await pdfParse(buffer);
        extractedText = data.text.substring(0, 50000);
      } catch {
        extractedText = '[PDF: não foi possível extrair texto]';
      }
    }
    
    const fileId = randomUUID();
    await runAsync(
      'INSERT INTO files (id, project_id, original_name, mime_type, size, extracted_text, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [fileId, req.params.projectId, req.file.originalname, req.file.mimetype, req.file.size, extractedText, req.file.path]
    );
    res.status(201).json({ id: fileId, original_name: req.file.originalname, size: req.file.size });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:projectId/:fileId', async (req, res) => {
  try {
    const file = await getAsync(
      'SELECT * FROM files WHERE id = ? AND project_id = ?',
      [req.params.fileId, req.params.projectId]
    );
    if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    await runAsync('DELETE FROM files WHERE id = ?', [req.params.fileId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;