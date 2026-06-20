import React, { useEffect, useState } from 'react';
import { Brain } from 'lucide-react';

interface ExtendedReasoningToggleProps {
  enabled: boolean;
  onToggle: (next: boolean) => void;
  /** true somente quando a conversa atual está no Modo Pro */
  isPro: boolean;
  darkMode: boolean;
}

// Botão de "Raciocínio Estendido" para a barra de input — segue o mesmo
// padrão visual do toggle "Code" já existente no MessageInput (pill com
// borda, ícone + label, indicador de pulso quando ativo).
export function ExtendedReasoningToggle({ enabled, onToggle, isPro, darkMode }: ExtendedReasoningToggleProps) {
  const [showProHint, setShowProHint] = useState(false);

  useEffect(() => {
    if (!showProHint) return;
    const timer = setTimeout(() => setShowProHint(false), 2500);
    return () => clearTimeout(timer);
  }, [showProHint]);

  const handleClick = () => {
    if (!isPro) {
      setShowProHint(true);
      return;
    }
    onToggle(!enabled);
  };

  const active = isPro && enabled;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        title={isPro ? (enabled ? 'Desativar raciocínio estendido' : 'Ativar raciocínio estendido') : 'Disponível apenas no Modo Pro'}
        aria-pressed={active}
        className={`relative flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium uppercase tracking-widest transition-all duration-300 mb-2 ${
          !isPro
            ? darkMode
              ? 'border-white/10 text-white/20 cursor-not-allowed'
              : 'border-black/10 text-black/20 cursor-not-allowed'
            : active
              ? darkMode
                ? 'border-violet-400/60 text-violet-300 bg-violet-400/8'
                : 'border-violet-600/50 text-violet-700 bg-violet-500/8'
              : darkMode
                ? 'border-white/10 text-white/30 hover:text-violet-400/60 hover:border-violet-400/30'
                : 'border-black/10 text-black/30 hover:text-violet-600/60 hover:border-violet-500/30'
        }`}
      >
        <Brain size={10} />
        <span>Raciocínio Estendido</span>
        {active && (
          <span className="w-1 h-1 rounded-full bg-violet-400 animate-pulse shrink-0" />
        )}
      </button>

      {showProHint && (
        <div
          role="status"
          className={`absolute bottom-full left-0 mb-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium whitespace-nowrap shadow-lg border z-10 animate-in fade-in slide-in-from-bottom-1 duration-200 ${
            darkMode ? 'bg-[#1a1a1a] border-white/15 text-white/80' : 'bg-white border-black/10 text-black/80'
          }`}
        >
          Requer o <span className="text-amber-400 font-semibold">Modo Pro</span> ativo
        </div>
      )}
    </div>
  );
}