// backend-node/domain/routers/agent.js — Modo Agente Autônomo (SSE)
//
// Implementa o contrato de eventos já definido no frontend
// (frontend/src/types/agent.ts, consumido por hooks/useAgentStream.ts e
// components/ui/AgentChatTimeline.tsx): cada frame SSE é
//
//   event: agent_event
//   data: {"type":"action","runId":"...","stepId":"...","timestamp":"...","tool":{...}}
//
// e o stream termina com `data: [DONE]`. Esse protocolo é mais rico que o
// progress: searching/thinking/generating do chat normal (/messages/stream) —
// aqui cada "step" (thought, extended_reasoning, action, observation, final,
// error) é uma entrada própria na timeline, porque o agente de fato decide
// (via function calling do Gemini) quando chamar uma ferramenta.

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { runAsync, getAsync, allAsync } from '../../db/database.js';
import { extractUserId } from '../../middleware/auth.js';
import { resolveModelForRequest } from './projects.js';
import {
  getBaseSystemPromptWithCache,
  selectContextWindow,
  invalidateSystemPromptCache,
  extractMemories,
} from '../ai/prompt.js';
import { callGeminiWithTools, toGeminiContents, geminiChat } from '../ai/gemini.js';
import { checkRateLimit, searchRelevantChunks, generateLocalTitle, processResponse } from './messages.js';

const router = Router();

// Sandbox de execução Python (serviço FastAPI separado — ver /sandbox no repo).
// Sem essas variáveis configuradas, a ferramenta python_sandbox responde com
// um erro gracioso em vez de travar o run do agente.
const SANDBOX_URL = process.env.SANDBOX_URL || '';
const SANDBOX_INTERNAL_TOKEN = process.env.SANDBOX_INTERNAL_TOKEN || process.env.INTERNAL_TOKEN || '';

// Limite de "rodadas" de ferramenta antes de forçar uma resposta final —
// evita loops infinitos caso o modelo insista em chamar ferramentas.
const MAX_TOOL_ITERATIONS = 4;

const AGENT_SYSTEM_SUFFIX = `

MODO AGENTE AUTÔNOMO ATIVO: você tem acesso a ferramentas (rag_search, python_sandbox, web_search). Use-as somente quando realmente precisar delas para responder com precisão — não chame ferramentas por padrão, nem mais de uma vez com o mesmo argumento. Assim que tiver informação suficiente, pare de chamar ferramentas e responda diretamente em texto corrido, em português, de forma clara e completa: essa será a resposta final mostrada ao usuário.`;

// ─── Execução das ferramentas ───────────────────────────────────────────────

async function fetchWithTimeout(url, opts, timeoutMs = 8_000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

function describeTool(name, args) {
  switch (name) {
    case 'rag_search':     return { label: args?.query ? `Buscando "${args.query}" nos documentos` : 'Buscando nos documentos' };
    case 'python_sandbox': return { label: 'Executando código Python' };
    case 'web_search':     return { label: args?.query ? `Buscando "${args.query}" na web` : 'Buscando na web' };
    default:                return { label: name };
  }
}

async function executeTool(name, args, ctx) {
  const start = Date.now();
  try {
    if (name === 'rag_search') {
      if (!ctx.projectId) {
        return { success: false, error: 'Esta conversa não está vinculada a um projeto com documentos.', durationMs: Date.now() - start };
      }
      const chunks = await searchRelevantChunks(ctx.projectId, args?.query || '');
      const output = chunks.length ? chunks.join('\n\n---\n\n') : 'Nenhum trecho relevante encontrado nos documentos do projeto.';
      return { success: true, output, durationMs: Date.now() - start };
    }

    if (name === 'python_sandbox') {
      if (!SANDBOX_URL) {
        return { success: false, error: 'Sandbox de execução Python não está configurado neste ambiente (defina SANDBOX_URL).', durationMs: Date.now() - start };
      }
      const r = await fetchWithTimeout(`${SANDBOX_URL}/tools/python-exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-token': SANDBOX_INTERNAL_TOKEN },
        body: JSON.stringify({ code: args?.code || '', timeout: 5, memory_limit_mb: 128 }),
      }, 10_000);
      if (!r.ok) {
        return { success: false, error: `Sandbox respondeu ${r.status}`, durationMs: Date.now() - start };
      }
      const data = await r.json();
      return {
        success: !!data.success,
        output: data.output,
        error: data.error || undefined,
        durationMs: typeof data.duration_ms === 'number' ? data.duration_ms : (Date.now() - start),
      };
    }

    if (name === 'web_search') {
      // TODO: integrar um provedor real (ex: Tavily/SerpAPI/Bing) quando
      // houver uma chave configurada. Por ora devolve um erro gracioso em vez
      // de inventar um resultado — o modelo recebe isso como observation e
      // segue sem essa ferramenta.
      return { success: false, error: 'Busca web ainda não está configurada neste ambiente.', durationMs: Date.now() - start };
    }

    return { success: false, error: `Ferramenta desconhecida: ${name}`, durationMs: Date.now() - start };
  } catch (err) {
    return { success: false, error: err.message || 'Erro ao executar ferramenta.', durationMs: Date.now() - start };
  }
}

// ─── "Digitação" do texto final/raciocínio ──────────────────────────────────
// callGeminiWithTools não é streaming (function calling não-streamed é bem
// mais simples de tratar corretamente) — então simulamos o efeito de chegada
// gradual fatiando o texto já recebido por inteiro. UX similar ao streaming
// real do /messages/stream, sem precisar de uma segunda chamada à IA.
function chunkText(text, size = 8) {
  if (!text) return [];
  const words = text.split(/(\s+)/);
  const out = [];
  let buf = '';
  for (const w of words) {
    buf += w;
    if (buf.length >= size) { out.push(buf); buf = ''; }
  }
  if (buf) out.push(buf);
  return out;
}

// FIX: delay fixo de 12ms/chunk sem teto fazia uma resposta de ~4000 chars
// (≈500 chunks com o `size` default de chunkText) virar ~6s de atraso
// artificial. Agora o delay por chunk é calculado em função de
// text.length pra manter a duração total dentro de um teto — respostas
// curtas mantêm o ritmo de digitação original (12ms/chunk); só respostas
// longas são "comprimidas" para caber no teto.
const TYPING_CHUNK_SIZE = 8;       // mesmo `size` default de chunkText()
const TYPING_DEFAULT_DELAY_MS = 12; // delay por chunk pra respostas curtas
const TYPING_TOTAL_CAP_MS = 1800;   // teto de duração total (~1.5-2s)

function typingDelayMs(textLength) {
  const estimatedChunks = Math.max(1, Math.ceil(textLength / TYPING_CHUNK_SIZE));
  return Math.min(TYPING_DEFAULT_DELAY_MS, TYPING_TOTAL_CAP_MS / estimatedChunks);
}

async function streamTextAsDeltas(text, onPiece, isClosed) {
  const delay = typingDelayMs((text || '').length);
  for (const piece of chunkText(text)) {
    if (isClosed()) return;
    onPiece(piece);
    await new Promise(r => setTimeout(r, delay));
  }
}

// ─── POST /agent/run (SSE) ──────────────────────────────────────────────────
router.post('/agent/run', extractUserId, async (req, res) => {
  const userId = req.userId;
  const { chatId, projectId: rawProjectId, message, model: clientModel, extendedReasoning } = req.body || {};

  if (!chatId || !message || !String(message).trim()) {
    return res.status(400).json({ error: 'chatId e message são obrigatórios' });
  }

  if (!(await checkRateLimit(userId, req.isGuest))) {
    return res.status(429).json({ error: 'Muitas requisições. Aguarde antes de enviar outra mensagem.' });
  }

  const projectId = (rawProjectId && rawProjectId !== 'none') ? rawProjectId : null;
  const runId = randomUUID();

  res.writeHead(200, {
    'Content-Type':                'text/event-stream',
    'Cache-Control':                'no-cache',
    'Connection':                   'keep-alive',
    'X-Accel-Buffering':            'no',
    'Access-Control-Allow-Origin':  process.env.FRONTEND_URL || '*',
  });
  res.write(': connected\n\n');

  // ─── Cancelamento ──────────────────────────────────────────────────────
  let closed = false;
  let controller = null;
  req.on('close', () => {
    closed = true;
    controller?.abort();
  });

  const heartbeat = setInterval(() => {
    if (!closed && !res.writableEnded) res.write(': heartbeat\n\n');
  }, 15_000);

  const send = (evt) => {
    if (closed || res.writableEnded) return;
    res.write(`event: agent_event\ndata: ${JSON.stringify(evt)}\n\n`);
  };
  const baseEvt = (over) => ({ runId, timestamp: new Date().toISOString(), ...over });

  // Espelha, do lado do servidor, os steps já "fundidos" (como o frontend
  // reconstruiria via useAgentStream) — persistido em messages.agent_steps
  // pra timeline sobreviver a um reload da página.
  const stepsLog = [];
  const record = (step) => stepsLog.push(step);

  let stepN = 0;
  const nextId = (prefix) => `s-${prefix}-${++stepN}`;

  // FIX 2.4: stepsLog só era persistido no INSERT final feliz — early-returns
  // por `closed` e o catch abaixo descartavam toda a timeline já acumulada em
  // memória. Extraído pra função reaproveitável (era só o trecho final de
  // sucesso) e agora também chamada nos pontos de saída antecipada, sempre
  // com o stepsLog que já existe até aquele momento. Falha ao persistir aqui
  // só loga — não deve mascarar/sobrepor o erro original que levou a essa
  // tentativa de salvar.
  async function saveAgentRun(content) {
    try {
      await runAsync(
        'INSERT INTO messages (chat_id, role, content, agent_steps) VALUES ($1,$2,$3,$4)',
        [chatId, 'assistant', content, JSON.stringify(stepsLog)]
      );
      await runAsync('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chatId]);
    } catch (persistErr) {
      console.error('Falha ao salvar timeline do agente:', persistErr);
    }
  }

  try {
    await runAsync('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3)', [chatId, 'user', message]);

    const modelKey = await resolveModelForRequest(userId, projectId, clientModel);
    const wantsExtendedReasoning = !!extendedReasoning && modelKey === 'pro';

    // Thought inicial — estático, não consome uma chamada à IA só pra isso.
    const thoughtId = nextId('thought');
    const tStart = Date.now();
    const thoughtText = 'Avaliando a pergunta e decidindo se preciso usar alguma ferramenta…';
    send(baseEvt({ type: 'thought', stepId: thoughtId, content: thoughtText }));
    send(baseEvt({ type: 'done', stepId: thoughtId }));
    record({ id: thoughtId, type: 'thought', content: thoughtText, status: 'complete', startedAt: tStart, completedAt: Date.now() });

    if (closed) {
      record({
        id: nextId('error'), type: 'error',
        content: 'Conexão encerrada pelo cliente antes de iniciar o processamento.',
        status: 'error', startedAt: Date.now(), completedAt: Date.now(),
      });
      await saveAgentRun('');
      return;
    }

    let memoryMode = 'projeto';
    if (projectId) {
      const proj = await getAsync('SELECT memory_mode FROM projects WHERE id = $1', [projectId]);
      if (proj?.memory_mode) memoryMode = proj.memory_mode;
    }

    const history = await allAsync(
      'SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [chatId]
    );
    const isFirst = history.length === 1;

    // Memórias + personalidade + descrição do projeto — igual ao chat normal.
    // A busca em documentos (RAG) NÃO é injetada automaticamente aqui: no
    // Modo Agente ela vira a ferramenta rag_search, chamada sob demanda.
    let systemPrompt = await getBaseSystemPromptWithCache(userId, projectId, memoryMode, message);
    systemPrompt += AGENT_SYSTEM_SUFFIX;

    const apiHistory = await selectContextWindow(history, message);
    const contents = toGeminiContents(apiHistory);

    let finalText = '';
    let gotThought = false;

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS && !closed; iter++) {
      controller = new AbortController();
      const result = await callGeminiWithTools(contents, systemPrompt, modelKey, {
        signal: controller.signal,
        includeThoughts: wantsExtendedReasoning && !gotThought, // só pedimos o resumo de raciocínio uma vez
      });
      controller = null;
      if (closed) break;

      if (result.thought && !gotThought) {
        gotThought = true;
        const erId = nextId('reason');
        const erStart = Date.now();
        await streamTextAsDeltas(
          result.thought,
          (piece) => send(baseEvt({ type: 'extended_reasoning', stepId: erId, content: piece, delta: true })),
          () => closed
        );
        if (closed) break;
        send(baseEvt({ type: 'done', stepId: erId }));
        record({ id: erId, type: 'extended_reasoning', content: result.thought, status: 'complete', startedAt: erStart, completedAt: Date.now() });
      }

      // Empilha o turno bruto retornado pelo Gemini (preserva as partes
      // functionCall) — é o jeito recomendado pela API de manter o contexto
      // de function calling coerente entre rodadas.
      if (result.rawModelContent) contents.push(result.rawModelContent);

      if (result.functionCalls.length > 0) {
        const responseParts = [];
        for (const call of result.functionCalls) {
          if (closed) break;

          const actionId = nextId('action');
          const aStart = Date.now();
          const meta = describeTool(call.name, call.args);
          send(baseEvt({ type: 'action', stepId: actionId, tool: { tool: call.name, label: meta.label, input: call.args } }));

          const obs = await executeTool(call.name, call.args, { projectId, chatId });

          send(baseEvt({ type: 'done', stepId: actionId }));
          record({
            id: actionId, type: 'action',
            tool: { tool: call.name, label: meta.label, input: call.args },
            status: 'complete', startedAt: aStart, completedAt: Date.now(),
          });

          const obsId = nextId('observation');
          const oResult = { tool: call.name, success: obs.success, output: obs.output, durationMs: obs.durationMs, error: obs.error };
          send(baseEvt({ type: 'observation', stepId: obsId, result: oResult }));
          send(baseEvt({ type: 'done', stepId: obsId }));
          record({ id: obsId, type: 'observation', result: oResult, status: 'complete', startedAt: aStart, completedAt: Date.now() });

          responseParts.push({
            functionResponse: {
              name: call.name,
              ...(call.id ? { id: call.id } : {}),
              response: obs.success ? { result: obs.output ?? '' } : { error: obs.error || 'Erro desconhecido' },
            },
          });
        }
        if (closed) break;
        contents.push({ role: 'user', parts: responseParts });
        continue; // próxima rodada: o modelo vê os resultados e decide o próximo passo
      }

      finalText = result.text || '';
      break;
    }

    if (closed) {
      // Pode haver `finalText` já pronto aqui (o modelo respondeu, mas o
      // cliente desconectou entre o fim da chamada e esta checagem) — nesse
      // caso salvamos a resposta mesmo assim, só sinalizando que a conexão
      // não estava mais ativa pra confirmar a entrega.
      record({
        id: nextId('error'), type: 'error',
        content: 'Conexão encerrada pelo cliente durante a execução do agente.',
        status: 'error', startedAt: Date.now(), completedAt: Date.now(),
      });
      await saveAgentRun(finalText ? processResponse(finalText) : '');
      return;
    }

    if (!finalText) {
      // Segurança: estourou as iterações sem uma resposta final (ou o modelo
      // só chamou ferramentas) — força uma resposta direta com o que já se sabe.
      const fallback = await geminiChat(apiHistory, systemPrompt, modelKey);
      finalText = fallback.text;
    }

    const cleanedFinal = processResponse(finalText);
    const finalId = nextId('final');
    const fStart = Date.now();
    await streamTextAsDeltas(
      cleanedFinal,
      (piece) => send(baseEvt({ type: 'final', stepId: finalId, content: piece, delta: true })),
      () => closed
    );
    // FIX 2.4: antes, `if (closed) return;` aqui descartava a resposta final
    // SEM SALVAR mesmo quando `cleanedFinal` já estava 100% pronto — só a
    // "digitação" simulada na tela é que foi cortada por desconexão do
    // cliente. `send()` já no-opa sozinho se `closed`, então deixamos o fluxo
    // seguir e persistir normalmente em vez de jogar a resposta fora.
    send(baseEvt({ type: 'done', stepId: finalId }));
    record({ id: finalId, type: 'final', content: cleanedFinal, status: 'complete', startedAt: fStart, completedAt: Date.now() });

    await saveAgentRun(cleanedFinal);

    if (!closed && !res.writableEnded) res.write('data: [DONE]\n\n');

    // Título (1ª mensagem) e extração de memórias seguem em background, igual
    // ao /messages/stream — não há um evento dedicado a "title" no protocolo
    // do agente, então o frontend atualiza a sidebar via refresh da lista de
    // chats depois que o run termina (ver App.jsx).
    if (isFirst) {
      generateLocalTitle(message)
        .then(title => runAsync('UPDATE chats SET title = $1 WHERE id = $2', [title, chatId]))
        .catch(() => {});
    }

    if (projectId || memoryMode === 'global') {
      extractMemories(projectId, userId, cleanedFinal, memoryMode).catch(console.error);
      invalidateSystemPromptCache(userId, projectId, { debounce: true });
    }
  } catch (err) {
    console.error('Erro no agente:', err);
    const errMessage = err.message || 'Erro interno no agente.';
    const errStepId = nextId('error');
    record({
      id: errStepId, type: 'error', content: errMessage,
      status: 'error', startedAt: Date.now(), completedAt: Date.now(),
    });

    if (!closed && !res.writableEnded) {
      send(baseEvt({ type: 'error', stepId: errStepId, errorMessage }));
      res.write('data: [DONE]\n\n');
    }

    // FIX 2.4: stepsLog acumulado até a exceção (thoughts/actions/observations
    // que já tinham completado) não era salvo — o catch só avisava o cliente
    // ao vivo (se ainda conectado) e descartava a timeline. content='' porque
    // não há resposta final confiável neste ponto.
    await saveAgentRun('');
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

export default router;