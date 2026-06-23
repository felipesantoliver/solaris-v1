// utils/errorHandler.js
//
// Normalizacao de erros e middleware de tratamento para o Express.
//
// Responsavel por capturar qualquer erro nao tratado nas rotas,
// traduzir para mensagens amigaveis ao usuario e registrar detalhes
// tecnicos em arquivo de log para diagnostico posterior.
//
// Principais cenarios tratados:
//   - Timeout (AbortError, ETIMEDOUT) -> 504 Gateway Timeout
//   - Rate limit -> 429 Too Many Requests
//   - Erros de autenticacao da API Gemini (401/403) -> 503 Service Unavailable
//   - Erros HTTP conhecidos (4xx) -> repassados com mensagem apropriada
//   - Conexao com banco recusada -> 503 Service Unavailable
//   - Qualquer outro erro -> 500 Internal Server Error (mensagem generica)
//
// O middleware errorHandler DEVE ser o ultimo middleware registrado no app,
// apos todas as rotas. Isso garante que erros propagados via next(err)
// sejam capturados e respondidos no formato JSON padronizado.
//
// Agrupamento logico:
//   1. Configuracao do arquivo de log
//   2. Funcao normalizeError (normalizacao e registro)
//   3. Middleware errorHandler (tratamento final)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// 1. CONFIGURACAO DO ARQUIVO DE LOG
// ---------------------------------------------------------------------------

// Resolve o caminho absoluto do diretorio atual (ESM nao tem __dirname nativo)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Arquivo de log na raiz do projeto: backend-node/logs/error.log
// Cada erro gera uma linha JSON com timestamp, mensagem, stack e metadados
const LOG_FILE = path.join(__dirname, '../../logs/error.log');

// Garante que o diretorio de logs existe antes de tentar escrever.
// recursive: true cria diretorios intermediarios se necessario.
// Envolvido em try/catch porque em ambientes com filesystem readonly
// (ex: alguns deploys serverless) a criacao pode falhar — nesse caso
// o log de arquivo e simplesmente ignorado, mas o console.error continua.
try {
    if (!fs.existsSync(path.dirname(LOG_FILE))) {
        fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    }
} catch (err) { /* ignora — log em arquivo e opcional */ }

// ---------------------------------------------------------------------------
// 2. FUNCAO normalizeError (NORMALIZACAO E REGISTRO)
// ---------------------------------------------------------------------------

/**
 * Normaliza um erro para resposta HTTP padronizada.
 *
 * Extrai informacoes relevantes do erro (status, mensagem, stack, codigo),
 * registra em console e arquivo de log, e retorna um objeto com o status
 * HTTP correto e uma mensagem amigavel para o usuario final.
 *
 * A mensagem para o usuario e SEMPRE generica e nao revela detalhes
 * internos (stack trace, nomes de arquivos, queries SQL, etc.).
 * Os detalhes tecnicos ficam apenas no log.
 *
 * Mapeamento de erros comuns:
 *   - AbortError / ETIMEDOUT / "timeout": o servidor demorou muito
 *   - 429 / "rate limit": muitas requisicoes em pouco tempo
 *   - 401 / 403 da API Gemini: problema na chave ou autenticacao externa
 *   - ECONNREFUSED / "database": banco de dados fora do ar
 *   - 404: recurso nao encontrado
 *   - 400: requisicao malformada
 *
 * @param {Error} err - Erro original (pode conter status, code, name, message, stack)
 * @returns {Object} { status: number, userMessage: string, logDetails: Object }
 */
export function normalizeError(err) {
    // Monta o objeto de log com todos os detalhes disponiveis.
    // Este objeto e serializado como JSON e salvo no arquivo de log.
    const logDetails = {
        timestamp: new Date().toISOString(),
        message: err.message,
        stack: err.stack,
        status: err.status || err.statusCode || 500,
        name: err.name,
        code: err.code,
    };

    // Sempre exibe no console para visibilidade imediata (Render logs, Vercel logs)
    console.error('[ERROR]', JSON.stringify(logDetails, null, 2));

    // Grava no arquivo de log de forma assincrona (nao bloqueia a resposta).
    // O callback vazio ignora erros de escrita (ex: disco cheio).
    fs.appendFile(LOG_FILE, JSON.stringify(logDetails) + '\n', () => { });

    // Valores padrao: erro interno generico (nao revela detalhes ao usuario)
    let status = 500;
    let userMessage = 'Erro interno, tente novamente mais tarde.';

    // Timeout: a operacao excedeu o tempo limite (AbortController, fetch timeout, etc.)
    if (err.name === 'AbortError' || err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
        status = 504;
        userMessage = 'Tempo de resposta excedido. O servidor demorou muito para responder.';
    }
    // Rate limit: muitas requisicoes em curto periodo (429 do backend ou da API Gemini)
    else if (err.status === 429 || err.message?.includes('429') || err.message?.includes('rate limit')) {
        status = 429;
        userMessage = 'Muitas requisições, tente novamente em alguns instantes.';
    }
    // Erro de autenticacao na API do Gemini (chave invalida, excedeu cota, acesso negado).
    // Retornamos 503 (Service Unavailable) para o usuario, pois o problema e externo
    // e nao ha acao que o usuario possa tomar para corrigir.
    else if (err.status === 401 || err.status === 403) {
        status = 503;
        userMessage = 'Serviço de IA temporariamente indisponível. Tente mais tarde.';
    }
    // Outros erros HTTP conhecidos na faixa 4xx (cliente)
    else if (err.status && err.status >= 400 && err.status < 500) {
        status = err.status;
        if (status === 404) userMessage = 'Recurso não encontrado.';
        else if (status === 400) userMessage = 'Requisição inválida. Verifique os dados enviados.';
        else userMessage = 'Ocorreu um erro na requisição.';
    }
    // Erro de conexao com o banco de dados (Supabase fora do ar, rede, etc.)
    else if (err.code === 'ECONNREFUSED' || err.message?.includes('database')) {
        status = 503;
        userMessage = 'Banco de dados indisponível. Tente novamente em instantes.';
    }

    return { status, userMessage, logDetails };
}

// ---------------------------------------------------------------------------
// 3. MIDDLEWARE errorHandler (TRATAMENTO FINAL)
// ---------------------------------------------------------------------------

/**
 * Middleware de tratamento de erros para o Express.
 *
 * Deve ser registrado como o ULTIMO middleware da aplicacao, apos todas
 * as rotas. O Express identifica middlewares de erro pela assinatura com
 * 4 parametros (err, req, res, next).
 *
 * Fluxo:
 *   1. Qualquer rota que chamar next(err) propaga o erro ate aqui
 *   2. normalizeError traduz o erro para status HTTP + mensagem amigavel
 *   3. O erro e registrado em console e arquivo de log
 *   4. A resposta e enviada ao cliente no formato JSON: { error: "mensagem" }
 *
 * Exemplo de uso no server.js:
 *   app.use('/api', routers);
 *   app.use(errorHandler); // <-- ultimo middleware
 *
 * @param {Error}   err  - Erro propagado via next(err)
 * @param {Request} req  - Objeto de requisicao Express
 * @param {Response} res - Objeto de resposta Express
 * @param {Function} next - Funcao next (nao usada, mas obrigatoria na assinatura)
 */
export function errorHandler(err, req, res, next) {
    const { status, userMessage } = normalizeError(err);
    res.status(status).json({ error: userMessage });
}