// ─────────────────────────────────────────────────────────────────────────
// Contrato de eventos do Modo Agente Autônomo (Solaris AI v1.2)
// ─────────────────────────────────────────────────────────────────────────
// O backend (Node, via SSE) deve emitir eventos no formato padrão de
// Server-Sent Events, um JSON por frame:
//
//   event: agent_event
//   data: {"type":"action","runId":"r1","stepId":"s2","timestamp":"...","tool":{...}}
//
// Vários eventos podem compartilhar o mesmo `stepId` — por exemplo, texto de
// `extended_reasoning` ou `final` chegando aos poucos via `delta: true`. O
// frontend (useAgentStream) funde tudo num único AgentStep por stepId.
//
// Para encerrar o stream, o backend pode enviar `data: [DONE]` como frame
// final (sentinela), além do evento `type: "done"` do último step.

export type AgentEventType =
  | 'thought'             // raciocínio curto, intermediário, sempre visível
  | 'extended_reasoning'  // chain-of-thought detalhada (só com Modo Pro + toggle ativo)
  | 'action'               // chamada de ferramenta (Python sandbox, busca web, RAG)
  | 'observation'          // resultado/output da ferramenta chamada
  | 'final'                // resposta final do agente ao usuário
  | 'error'                // falha em qualquer etapa do loop
  | 'done';                // sinaliza que um step específico terminou de streamar

export type AgentToolName = 'python_sandbox' | 'web_search' | 'rag_search';

export interface AgentToolCall {
  tool: AgentToolName;
  /** Descrição curta e legível do que está sendo feito, ex: "Buscando 'preço cobre 2026'" */
  label?: string;
  input?: string | Record<string, unknown>;
}

export interface AgentToolResult {
  tool: AgentToolName;
  success: boolean;
  /** Output resumido (stdout do Python, snippets da busca, trecho do arquivo) */
  output?: string;
  durationMs?: number;
  error?: string;
}

export interface AgentStreamEvent {
  type: AgentEventType;
  runId: string;
  stepId: string;
  timestamp: string;
  /** Texto do step (thought / extended_reasoning / final). Pode chegar em pedaços. */
  content?: string;
  /** Se true, `content` deve ser concatenado ao conteúdo já acumulado do step. */
  delta?: boolean;
  /** Presente quando type === 'action' */
  tool?: AgentToolCall;
  /** Presente quando type === 'observation' */
  result?: AgentToolResult;
  /** Presente quando type === 'error' */
  errorMessage?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Estado interno (já mesclado) usado pelo componente de UI
// ─────────────────────────────────────────────────────────────────────────

export type AgentStepStatus = 'streaming' | 'complete' | 'error';

export interface AgentStep {
  id: string;
  type: AgentEventType;
  content: string;
  tool?: AgentToolCall;
  result?: AgentToolResult;
  status: AgentStepStatus;
  startedAt: number;
  completedAt?: number;
}

export type AgentRunStatus = 'idle' | 'connecting' | 'running' | 'done' | 'error' | 'aborted';

export interface StartAgentPayload {
  chatId: string;
  /** null/undefined em chats avulsos (fora de projeto) */
  projectId?: string | null;
  message: string;
  model: 'pro' | 'flash';
  /** Só tem efeito real quando model === 'pro' */
  extendedReasoning: boolean;
}