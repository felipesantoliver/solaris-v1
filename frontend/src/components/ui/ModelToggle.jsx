import React from 'react';
import { Zap, Star } from 'lucide-react';

export function ModelToggle({ model, onChange, authUser, darkMode, programmingMode, onProgrammingModeChange }) {
  const isPro = model === 'pro';
  const isCodeActive = programmingMode;

  if (!authUser) {
    return (
      <div className="mb-3 flex items-center gap-2" title="Faça login para usar o modo Pro">
        <button disabled className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium uppercase tracking-widest opacity-30 cursor-not-allowed ${darkMode ? 'border-white/10 text-white/40' : 'border-black/10 text-black/40'}`}>
          <Zap size={10} />Flash
        </button>
        <button disabled className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium uppercase tracking-widest opacity-30 cursor-not-allowed ${darkMode ? 'border-white/10 text-white/40' : 'border-black/10 text-black/40'}`}>
          <Star size={10} />Pro
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3 flex items-center gap-2">
      <button onClick={() => onChange('flash')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium uppercase tracking-widest transition-all ${!isPro ? (darkMode ? 'border-white/60 text-white bg-white/10' : 'border-black/60 text-black bg-black/8') : (darkMode ? 'border-white/10 text-white/30 hover:text-white/60' : 'border-black/10 text-black/30 hover:text-black/60')}`}>
        <Zap size={10} />Flash
      </button>
      <button onClick={() => onChange('pro')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium uppercase tracking-widest transition-all ${isPro ? 'border-amber-400/80 text-amber-400 bg-amber-400/10' : (darkMode ? 'border-white/10 text-white/30 hover:text-amber-400/60 hover:border-amber-400/30' : 'border-black/10 text-black/30 hover:text-amber-500/60 hover:border-amber-400/30')}`}>
        <Star size={10} />Pro
      </button>
    </div>
  );
}