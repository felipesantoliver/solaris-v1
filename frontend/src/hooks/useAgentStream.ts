import { useCallback, useRef, useState } from 'react';
import type {
  AgentStep,
  AgentStreamEvent,
  AgentRunStatus,
  StartAgentPayload,
} from '../types/agent';

interface UseAgentStreamOptions {
  /** Endpoint que inicia a execução do agente, ex: `${API_BASE}/api/agent/run` */
  endpoint: string;
  getAuthHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
}

interface SSEFrame {
  event?: string;
  data: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Parser manual de SSE via fetch + ReadableStream.
//
// Por quê não `EventSource` nativo? Porque ele só faz GET e não permite
// headers customizados — e iniciar o agente exige POST (payload) + auth
// header. fetch() com response streaming resolve os dois, e ainda assim
// evita o timeout de requisições do Render: a conexão fica "viva" emitindo
// bytes continuamente em vez de bloquear esperando uma resposta única.
// ─────────────────────────────────────────────────────────────────────────
async function* readSSE(response: Response): AsyncGenerator<SSEFrame> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex: number;
      // Frames SSE são separados por linha em branco dupla (\n\n)
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const rawFrame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);

        let eventName: string | undefined;
        const dataLines: string[] = [];
        for (const line of rawFrame.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length > 0) {
          yield { event: eventName, data: dataLines.join('\n') };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Mescla um evento recebido no array de steps atual. Sempre retorna um NOVO
// array, mas reaproveita a referência de todo step que não mudou — é isso
// que permite ao item memoizado (AgentStepItem) pular re-render para os
// steps anteriores quando só o último step está streamando.
function mergeEvent(steps: AgentStep[], evt: AgentStreamEvent): AgentStep[] {
  const idx = steps.findIndex(s => s.id === evt.stepId);
  const now = Date.now();

  if (idx === -1) {
    const newStep: AgentStep = {
      id: evt.stepId,
      type: evt.type,
      content: evt.content ?? '',
      tool: evt.tool,
      result: evt.result,
      status: evt.type === 'error' ? 'error' : 'streaming',
      startedAt: now,
      completedAt: evt.type === 'error' ? now : undefined,
    };
    return [...steps, newStep];
  }

  return steps.map((step, i) => {
    if (i !== idx) return step;

    const next: AgentStep = {
      ...step,
      content: evt.delta && evt.content ? step.content + evt.content : (evt.content ?? step.content),
      tool: evt.tool ?? step.tool,
      result: evt.result ?? step.result,
    };

    if (evt.type === 'error') {
      next.status = 'error';
      next.content = evt.errorMessage ?? next.content;
      next.completedAt = now;
    } else if (evt.type === 'done' || evt.result) {
      next.status = 'complete';
      next.completedAt = now;
    }
    return next;
  });
}

export function useAgentStream({ endpoint, getAuthHeaders }: UseAgentStreamOptions) {
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [status, setStatus] = useState<AgentRunStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setSteps([]);
    setStatus('idle');
    setError(null);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus('aborted');
  }, []);

  const start = useCallback(async (payload: StartAgentPayload) => {
    setSteps([]);
    setError(null);
    setStatus('connecting');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const authHeaders = (await getAuthHeaders?.()) ?? {};
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...authHeaders,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Falha ao iniciar o agente (HTTP ${response.status}).`);
      }

      setStatus('running');

      for await (const frame of readSSE(response)) {
        if (frame.data === '[DONE]') break;

        let evt: AgentStreamEvent;
        try {
          evt = JSON.parse(frame.data);
        } catch {
          continue; // frame malformado: ignora em vez de derrubar o stream inteiro
        }

        setSteps(prev => mergeEvent(prev, evt));
        if (evt.type === 'error') {
          setError(evt.errorMessage ?? 'Erro durante a execução do agente.');
        }
      }

      setStatus(prev => (prev === 'aborted' ? prev : 'done'));
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setStatus('aborted');
        return;
      }
      setError((err as Error)?.message ?? 'Erro de conexão com o agente.');
      setStatus('error');
    }
  }, [endpoint, getAuthHeaders]);

  return { steps, status, error, start, stop, reset };
}