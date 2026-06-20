import React, { useEffect, useRef, useState } from 'react';
import {
  Lightbulb, Brain, Terminal, Search, FileText, CheckCircle2,
  AlertTriangle, ChevronDown, ChevronRight, Loader2, Sparkles,
} from 'lucide-react';
import AdvancedMarkdown from './AdvancedMarkdown';
import type { AgentStep, AgentToolName } from '../../types/agent';

interface AgentChatTimelineProps {
  /** Steps já conhecidos do run — históricos (estáticos) ou em andamento (vindos de useAgentStream) */
  steps: AgentStep[];
  darkMode: boolean;
  /** true enquanto o run ainda está recebendo eventos do backend */
  isStreaming?: boolean;
}

// Classes 100% literais (sem interpolação) de propósito — o Tailwind JIT
// escaneia o código-fonte por strings exatas; nomes de classe montados
// dinamicamente (ex: `text-${cor}-400`) não seriam encontrados no build.
const TOOL_META: Record<AgentToolName, {
  label: string;
  Icon: React.ComponentType<{ size?: string | number; className?: string }>;
  classesDark: string;
  classesLight: string;
}> = {
  python_sandbox: {
    label: 'Python · Sandbox',
    Icon: Terminal,
    classesDark: 'text-cyan-300 border-cyan-400/30 bg-cyan-400/5',
    classesLight: 'text-cyan-700 border-cyan-500/25 bg-cyan-500/5',
  },
  web_search: {
    label: 'Busca Web',
    Icon: Search,
    classesDark: 'text-sky-300 border-sky-400/30 bg-sky-400/5',
    classesLight: 'text-sky-700 border-sky-500/25 bg-sky-500/5',
  },
  rag_search: {
    label: 'Leitura de Arquivos',
    Icon: FileText,
    classesDark: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/5',
    classesLight: 'text-emerald-700 border-emerald-500/25 bg-emerald-500/5',
  },
};

/* ───────────────────────── Seção retrátil genérica ───────────────────────── */
// Abre automaticamente enquanto o step está streamando e recolhe sozinha ao
// concluir — mas só enquanto o usuário não tiver mexido manualmente no toggle.

function CollapsibleSection({
  darkMode,
  isStreaming,
  summary,
  accentClass,
  children,
}: {
  darkMode: boolean;
  isStreaming: boolean;
  summary: React.ReactNode;
  accentClass: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(isStreaming);
  const userToggledRef = useRef(false);
  const wasStreamingRef = useRef(isStreaming);

  useEffect(() => {
    if (userToggledRef.current) return;
    if (wasStreamingRef.current && !isStreaming) setOpen(false);
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const toggle = () => {
    userToggledRef.current = true;
    setOpen(o => !o);
  };

  return (
    <div className={`rounded-lg border overflow-hidden ${accentClass}`}>
      <button type="button" onClick={toggle} className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left">
        {summary}
        {open ? <ChevronDown size={13} className="shrink-0 opacity-60" /> : <ChevronRight size={13} className="shrink-0 opacity-60" />}
      </button>
      {open && (
        <div className={`px-3 pb-3 pt-0.5 text-sm border-t ${darkMode ? 'border-white/10' : 'border-black/10'}`}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Renderizadores por tipo de step ───────────────────────── */

function ThoughtStep({ step, darkMode }: { step: AgentStep; darkMode: boolean }) {
  const isStreaming = step.status === 'streaming';
  return (
    <div className={`flex items-start gap-2 text-xs italic leading-relaxed ${darkMode ? 'text-white/40' : 'text-black/40'}`}>
      <Lightbulb size={12} className="mt-0.5 shrink-0 text-amber-400/70" />
      <span>{step.content || (isStreaming ? 'pensando…' : '')}</span>
      {isStreaming && <Loader2 size={10} className="animate-spin shrink-0 mt-0.5 opacity-50" />}
    </div>
  );
}

function ExtendedReasoningStep({ step, darkMode }: { step: AgentStep; darkMode: boolean }) {
  const isStreaming = step.status === 'streaming';
  const durationLabel = step.completedAt ? `${((step.completedAt - step.startedAt) / 1000).toFixed(1)}s` : null;

  return (
    <CollapsibleSection
      darkMode={darkMode}
      isStreaming={isStreaming}
      accentClass={darkMode ? 'border-violet-400/25 bg-violet-400/[0.04]' : 'border-violet-500/20 bg-violet-500/[0.03]'}
      summary={
        <span className={`flex items-center gap-2 text-xs font-semibold ${darkMode ? 'text-violet-300' : 'text-violet-700'}`}>
          <Brain size={13} className={isStreaming ? 'animate-pulse' : ''} />
          {isStreaming ? 'Raciocinando profundamente…' : `Raciocínio estendido${durationLabel ? ` · ${durationLabel}` : ''}`}
        </span>
      }
    >
      <div className={darkMode ? 'text-white/65' : 'text-black/65'}>
        <AdvancedMarkdown content={step.content || '_aguardando…_'} darkMode={darkMode} codingMode={false} isStreaming={isStreaming} />
      </div>
    </CollapsibleSection>
  );
}

function ActionStep({ step, darkMode }: { step: AgentStep; darkMode: boolean }) {
  const tool = step.tool;
  if (!tool) return null;
  const meta = TOOL_META[tool.tool];
  const Icon = meta.Icon;
  const isPending = step.status === 'streaming';
  const subtitle = tool.label ?? (typeof tool.input === 'string' ? tool.input : tool.input ? JSON.stringify(tool.input) : undefined);

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-mono ${darkMode ? meta.classesDark : meta.classesLight}`}>
      <Icon size={13} className="shrink-0" />
      <span className="font-semibold shrink-0">{meta.label}</span>
      {subtitle && <span className="opacity-70 truncate">{subtitle}</span>}
      {isPending && <Loader2 size={11} className="animate-spin ml-auto shrink-0 opacity-70" />}
    </div>
  );
}

function ObservationStep({ step, darkMode }: { step: AgentStep; darkMode: boolean }) {
  const result = step.result;
  const isStreaming = step.status === 'streaming';
  const success = result?.success ?? true;
  const output = result?.output ?? step.content;
  const isLong = (output?.length ?? 0) > 280 || (output?.includes('\n') ?? false);
  const meta = result ? TOOL_META[result.tool] : undefined;
  const durationLabel = result?.durationMs != null ? `${(result.durationMs / 1000).toFixed(2)}s` : null;

  const summary = (
    <span className={`flex items-center gap-2 text-xs font-semibold ${success ? (darkMode ? 'text-emerald-300' : 'text-emerald-700') : (darkMode ? 'text-red-300' : 'text-red-700')}`}>
      {success ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
      {meta ? `Resultado · ${meta.label}` : 'Resultado'}
      {durationLabel && <span className="opacity-50 font-normal">{durationLabel}</span>}
    </span>
  );

  // Tratado como bloco de código para reaproveitar o CodeBlock (com botão de
  // copiar) do AdvancedMarkdown — assume-se que o output não contém ``` cru;
  // se o backend já mandar markdown formatado, passe `output` direto sem o fence.
  const body = (
    <AdvancedMarkdown
      content={output ? '```\n' + output + '\n```' : '_sem saída_'}
      darkMode={darkMode}
      codingMode={true}
      isStreaming={isStreaming}
    />
  );

  if (!isLong) {
    return (
      <div className={`px-3 py-2 rounded-lg border ${darkMode ? 'border-white/10 bg-white/[0.02]' : 'border-black/10 bg-black/[0.015]'}`}>
        {summary}
        <div className="mt-1.5 text-xs">{body}</div>
      </div>
    );
  }

  return (
    <CollapsibleSection
      darkMode={darkMode}
      isStreaming={isStreaming}
      accentClass={darkMode ? 'border-white/10 bg-white/[0.02]' : 'border-black/10 bg-black/[0.015]'}
      summary={summary}
    >
      {body}
    </CollapsibleSection>
  );
}

function FinalStep({ step, darkMode }: { step: AgentStep; darkMode: boolean }) {
  const isStreaming = step.status === 'streaming';
  return (
    <div>
      {!isStreaming && (
        <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold mb-2 ${darkMode ? 'text-white/30' : 'text-black/30'}`}>
          <CheckCircle2 size={11} className="text-emerald-400" /> Resposta final
        </div>
      )}
      <AdvancedMarkdown content={step.content} darkMode={darkMode} codingMode={false} isStreaming={isStreaming} />
    </div>
  );
}

function ErrorStep({ step, darkMode }: { step: AgentStep; darkMode: boolean }) {
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-xs ${darkMode ? 'text-red-300' : 'text-red-700'}`}>
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <span>{step.content || 'Ocorreu um erro durante a execução do agente.'}</span>
    </div>
  );
}

/* ───────────────────────── Item memoizado ───────────────────────── */
// Cada step só re-renderiza quando o PRÓPRIO objeto `step` muda de referência.
// Como o reducer do useAgentStream preserva a referência dos steps que não
// foram tocados por um evento, os irmãos de um step em streaming não
// re-renderizam a cada token recebido.

const AgentStepItem = React.memo(function AgentStepItem({ step, darkMode }: { step: AgentStep; darkMode: boolean }) {
  switch (step.type) {
    case 'thought': return <ThoughtStep step={step} darkMode={darkMode} />;
    case 'extended_reasoning': return <ExtendedReasoningStep step={step} darkMode={darkMode} />;
    case 'action': return <ActionStep step={step} darkMode={darkMode} />;
    case 'observation': return <ObservationStep step={step} darkMode={darkMode} />;
    case 'final': return <FinalStep step={step} darkMode={darkMode} />;
    case 'error': return <ErrorStep step={step} darkMode={darkMode} />;
    default: return null;
  }
}, (prev, next) => prev.step === next.step && prev.darkMode === next.darkMode);

/* ───────────────────────── Componente principal ───────────────────────── */

function AgentChatTimelineBase({ steps, darkMode, isStreaming = false }: AgentChatTimelineProps) {
  if (steps.length === 0) {
    if (!isStreaming) return null;
    return (
      <div className={`flex items-center gap-2 text-xs ${darkMode ? 'text-white/30' : 'text-black/30'}`}>
        <Sparkles size={12} className="animate-pulse" /> iniciando agente…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {steps.map(step => (
        <AgentStepItem key={step.id} step={step} darkMode={darkMode} />
      ))}
    </div>
  );
}

// Memo no nível do componente todo: só recalcula a árvore se a referência do
// array `steps` mudar (o hook sempre devolve um array novo quando há
// novidade — comparar por referência é O(1) e evita um deep-compare caro).
const AgentChatTimeline = React.memo(AgentChatTimelineBase, (prev, next) =>
  prev.steps === next.steps && prev.darkMode === next.darkMode && prev.isStreaming === next.isStreaming
);

export default AgentChatTimeline;