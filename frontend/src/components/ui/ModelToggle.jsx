import React from 'react';
import { Zap, Star, Code } from 'lucide-react';

export function ModelToggle({ model, onChange, authUser, darkMode, programmingMode, onProgrammingModeChange }) {
  const isPro = model === 'pro';
  const isCodeActive = programmingMode;

  // shared inactive style
  const inactiveBtn = darkMode
    ? 'border-[#E8F0F9]/10 text-[#E8F0F9]/30 hover:text-[#F5A623]/60 hover:border-[#F5A623]/30'
    : 'border-[#1E3A5F]/10 text-[#1E3A5F]/30 hover:text-[#F5A623]/80 hover:border-[#F5A623]/40';

  const activeFlash = darkMode
    ? 'border-[#E8F0F9]/60 text-[#E8F0F9] bg-[#E8F0F9]/10'
    : 'border-[#0D1B2A]/60 text-[#0D1B2A] bg-[#0D1B2A]/8';

  const activeAccent = 'border-[#F5A623]/80 text-[#F5A623] bg-[#F5A623]/10';

  if (!authUser) {
    return (
      <div className="mb-3 flex items-center gap-2" title="Faça login para usar o modo Pro">
        <button disabled className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium uppercase tracking-widest opacity-30 cursor-not-allowed ${darkMode ? 'border-[#E8F0F9]/10 text-[#E8F0F9]/40' : 'border-[#1E3A5F]/10 text-[#1E3A5F]/40'}`}>
          <Zap size={10} />Flash
        </button>
        <button disabled className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium uppercase tracking-widest opacity-30 cursor-not-allowed ${darkMode ? 'border-[#E8F0F9]/10 text-[#E8F0F9]/40' : 'border-[#1E3A5F]/10 text-[#1E3A5F]/40'}`}>
          <Star size={10} />Pro
        </button>
        <button
          onClick={() => onProgrammingModeChange(!isCodeActive)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium uppercase tracking-widest transition-all ${isCodeActive ? activeAccent : inactiveBtn}`}
        >
          <Code size={10} />code
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3 flex items-center gap-2">
      <button onClick={() => onChange('flash')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium uppercase tracking-widest transition-all ${!isPro ? activeFlash : inactiveBtn}`}>
        <Zap size={10} />Flash
      </button>
      <button onClick={() => onChange('pro')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium uppercase tracking-widest transition-all ${isPro ? activeAccent : inactiveBtn}`}>
        <Star size={10} />Pro
      </button>
      <button
        onClick={() => onProgrammingModeChange(!isCodeActive)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium uppercase tracking-widest transition-all ${isCodeActive ? activeAccent : inactiveBtn}`}
      >
        <Code size={10} />code
      </button>
    </div>
  );
}
