import React from 'react';
import { AlertTriangle, X, UserPlus } from 'lucide-react';

// GuestBanner — avisa o usuário convidado (sem conta) de que o histórico de
// conversas não é preservado após fechar o navegador, com um CTA para criar
// conta. É deliberadamente discreto: aparece uma vez (some ao ser dispensado
// ou ao logar) e não volta a incomodar repetidamente na mesma sessão.
export function GuestBanner({ darkMode, theme, onCreateAccount, onDismiss }) {
  return (
    <div
      role="status"
      className={`flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2 px-4 md:px-10 py-2.5 border-b transition-colors duration-500 ${theme.border} ${
        darkMode ? 'bg-amber-400/[0.06]' : 'bg-amber-50'
      }`}
    >
      <AlertTriangle
        size={15}
        strokeWidth={1.5}
        className={`shrink-0 ${darkMode ? 'text-amber-400/80' : 'text-amber-500'}`}
      />

      <p className={`flex-1 min-w-[220px] text-xs md:text-[13px] font-light leading-snug ${darkMode ? 'text-amber-100/80' : 'text-amber-900/80'}`}>
        Você está navegando como convidado: ao fechar o navegador, seu histórico de conversas não fica salvo.
      </p>

      <button
        onClick={onCreateAccount}
        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] md:text-xs font-medium tracking-wide transition-all ${
          darkMode ? 'bg-amber-400 text-black hover:bg-amber-300' : 'bg-amber-500 text-white hover:bg-amber-600'
        }`}
      >
        <UserPlus size={13} strokeWidth={2} />
        Criar conta e salvar histórico
      </button>

      <button
        onClick={onDismiss}
        aria-label="Dispensar aviso"
        title="Dispensar"
        className={`shrink-0 p-1.5 rounded-md transition-colors ${
          darkMode ? 'text-amber-200/40 hover:text-amber-100 hover:bg-white/5' : 'text-amber-700/40 hover:text-amber-900 hover:bg-black/5'
        }`}
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}