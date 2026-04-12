import React, { useState } from 'react';
import { Share2, Check, X } from 'lucide-react';

export function ShareModal({ isOpen, onClose, messages, darkMode, theme }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = messages.map(m => `${m.role === 'user' ? 'VOCÊ' : 'SOLARIS'}: ${m.content}`).join('\n\n');
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`${theme.modalBg} border ${theme.border} w-full max-w-md rounded-2xl p-6 shadow-2xl`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">Compartilhar conversa</h3>
          <button onClick={onClose} className={theme.textMuted}><X size={18} /></button>
        </div>
        <p className={`text-sm ${theme.textSecondary} mb-6`}>Copie o conteúdo da conversa para compartilhar.</p>
        <button
          onClick={handleCopy}
          className={`w-full py-3 rounded-xl flex items-center justify-center gap-2 ${darkMode ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/90'} transition-all`}
        >
          {copied ? <Check size={16} /> : <Share2 size={16} />}
          {copied ? 'Copiado!' : 'Copiar conversa'}
        </button>
      </div>
    </div>
  );
}