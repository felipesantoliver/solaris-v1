// domain/routers/voice.js — Transcrição de voz via microsserviço Python (Whisper local)

import { Router } from 'express';
import multer from 'multer';
import { extractUserId } from '../../middleware/auth.js';

const router = Router();

// Armazena o áudio em memória (não salva em disco)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// URL do microsserviço Python (definida no .env)
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

// ─── POST /api/voice/transcribe ────────────────────────────────────────────
router.post('/voice/transcribe', extractUserId, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo de áudio enviado.' });
    }

    // A GROQ_API_KEY era usada aqui, mas agora a transcrição é feita localmente.
    // Mantemos a variável comentada para uso futuro (ex: fallback).
    // const GROQ_API_KEY = process.env.GROQ_API_KEY;

    // Constrói o FormData para enviar ao microsserviço Python
    const formData = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });
    formData.append('file', blob, req.file.originalname || 'audio.webm');

    // Faz a requisição para o Python service
    const response = await fetch(`${PYTHON_SERVICE_URL}/voice/transcribe`, {
      method: 'POST',
      body: formData,
      // Não precisa de headers específicos; o FormData define o boundary automaticamente
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Erro no microsserviço Python:', errText);
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