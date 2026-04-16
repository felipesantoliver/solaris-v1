// domain/routers/voice.js — Transcrição de voz via Groq Whisper

import { Router } from 'express';
import multer from 'multer';
import { extractUserId } from '../../middleware/auth.js';

const router = Router();

// Armazena o áudio em memória (não salva em disco)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — limite da Groq
});

// ─── POST /api/voice/transcribe ────────────────────────────────────────────
router.post('/voice/transcribe', extractUserId, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo de áudio enviado.' });
    }

    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: 'GROQ_API_KEY não configurada no servidor.' });
    }

    // Monta o FormData para enviar para a Groq
    const formData = new FormData();

    // Groq aceita webm, mp4, mpeg, mpga, m4a, wav, ogg
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });
    formData.append('file', blob, req.file.originalname || 'audio.webm');
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('language', 'pt'); // Português por padrão
    formData.append('response_format', 'json');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Groq API erro:', errText);
      return res.status(502).json({ error: 'Erro ao transcrever áudio.' });
    }

    const data = await response.json();
    return res.json({ text: data.text?.trim() || '' });

  } catch (err) {
    console.error('Erro na transcrição de voz:', err);
    return res.status(500).json({ error: 'Erro interno na transcrição.' });
  }
});

export default router;