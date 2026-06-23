// domain/routers/voice.js
//
// Rota de transcricao de voz — recebe audio do frontend,
// encaminha para o microsservico Python e retorna o texto transcrito.
//
// A transcricao usa o modelo whisper-large-v3-turbo via API Groq
// (chamada pelo microsservico Python). Nenhum modelo e carregado
// localmente, evitando consumo de RAM no backend Node.
//
// Agrupamento logico:
//   1. Configuracao e constantes
//   2. Endpoint de transcricao

import { Router } from 'express';
import multer from 'multer';
import { extractUserId } from '../../middleware/auth.js';

const router = Router();

// ---------------------------------------------------------------------------
// 1. CONFIGURACAO E CONSTANTES
// ---------------------------------------------------------------------------

// Armazena o audio em memoria (memoryStorage).
// O buffer resultante e enviado diretamente ao microsservico Python
// como multipart/form-data, sem passar pelo sistema de arquivos.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // Limite de 25 MB por arquivo de audio
});

// URL base do microsservico Python.
// Sobrescrita pela variavel de ambiente PYTHON_SERVICE_URL no deploy.
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

// ---------------------------------------------------------------------------
// 2. ENDPOINT DE TRANSCRICAO
// ---------------------------------------------------------------------------

/**
 * Transcreve um arquivo de audio enviado pelo frontend.
 *
 * Fluxo:
 *   1. Recebe o arquivo via multipart/form-data (campo "audio")
 *   2. Valida que o arquivo foi enviado
 *   3. Reencaminha o buffer para o microsservico Python (FastAPI)
 *   4. O Python chama a API Groq com o modelo whisper-large-v3-turbo
 *   5. Retorna o texto transcrito ao frontend
 *
 * Limitacoes:
 *   - Depende de GROQ_API_KEY configurada no microsservico Python.
 *     Se a chave nao existir, o Python retornara erro.
 *   - Formatos suportados: o Python aceita os formatos compativeis
 *     com a API Whisper da Groq (webm, mp3, wav, ogg, etc.).
 *
 * POST /api/voice/transcribe
 */
router.post('/voice/transcribe', extractUserId, upload.single('audio'), async (req, res) => {
  try {
    // Valida que um arquivo foi realmente enviado no campo "audio"
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo de áudio enviado.' });
    }

    // Constroi o FormData para enviar ao microsservico Python.
    // O Python espera um campo "file" com o binario do audio.
    const formData = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });
    formData.append('file', blob, req.file.originalname || 'audio.webm');

    // Encaminha o audio para o microsservico Python (rota /voice/transcribe)
    const response = await fetch(`${PYTHON_SERVICE_URL}/voice/transcribe`, {
      method: 'POST',
      body: formData,
      // Headers nao precisam ser definidos manualmente:
      // o FormData define o Content-Type (multipart/form-data) com boundary automatico
    });

    // Se o Python retornar erro, loga o detalhe e retorna 502 (Bad Gateway)
    if (!response.ok) {
      const errText = await response.text();
      console.error('Erro no microsserviço Python:', errText);
      return res.status(502).json({ error: 'Erro ao transcrever áudio.' });
    }

    // Extrai o texto transcrito da resposta do Python
    const data = await response.json();
    return res.json({ text: data.text?.trim() || '' });

  } catch (err) {
    // Erro inesperado: rede, timeout, microsservico fora do ar
    console.error('Erro na transcrição de voz:', err);
    return res.status(500).json({ error: 'Erro interno na transcrição.' });
  }
});

export default router;