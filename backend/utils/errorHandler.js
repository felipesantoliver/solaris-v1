// backend/utils/errorHandler.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, '../../logs/error.log');

// Garante que o diretório de logs existe
try {
    if (!fs.existsSync(path.dirname(LOG_FILE))) {
        fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    }
} catch (err) { /* ignora */ }

/**
 * Normaliza um erro para uma mensagem amigável e registra o erro completo.
 * @param {Error} err - Erro original
 * @returns {Object} { status, userMessage, logDetails }
 */
export function normalizeError(err) {
    // Log completo (stack, detalhes) em arquivo e console
    const logDetails = {
        timestamp: new Date().toISOString(),
        message: err.message,
        stack: err.stack,
        status: err.status || err.statusCode || 500,
        name: err.name,
        code: err.code,
    };
    console.error('[ERROR]', JSON.stringify(logDetails, null, 2));
    fs.appendFile(LOG_FILE, JSON.stringify(logDetails) + '\n', () => { });

    let status = 500;
    let userMessage = 'Erro interno, tente novamente mais tarde.';

    // Timeout (AbortError ou timeout específico)
    if (err.name === 'AbortError' || err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
        status = 504;
        userMessage = 'Tempo de resposta excedido. O servidor demorou muito para responder.';
    }
    // Rate limit (429)
    else if (err.status === 429 || err.message?.includes('429') || err.message?.includes('rate limit')) {
        status = 429;
        userMessage = 'Muitas requisições, tente novamente em alguns instantes.';
    }
    // Erro específico da API do Gemini (ex: 401, 403)
    else if (err.status === 401 || err.status === 403) {
        status = 503;
        userMessage = 'Serviço de IA temporariamente indisponível. Tente mais tarde.';
    }
    // Outros status HTTP definidos
    else if (err.status && err.status >= 400 && err.status < 500) {
        status = err.status;
        if (status === 404) userMessage = 'Recurso não encontrado.';
        else if (status === 400) userMessage = 'Requisição inválida. Verifique os dados enviados.';
        else userMessage = 'Ocorreu um erro na requisição.';
    }
    // Erro de conexão com banco de dados
    else if (err.code === 'ECONNREFUSED' || err.message?.includes('database')) {
        status = 503;
        userMessage = 'Banco de dados indisponível. Tente novamente em instantes.';
    }

    return { status, userMessage, logDetails };
}

/**
 * Middleware de tratamento de erros para o Express.
 * Deve ser o último middleware registrado.
 */
export function errorHandler(err, req, res, next) {
    const { status, userMessage } = normalizeError(err);
    res.status(status).json({ error: userMessage });
}