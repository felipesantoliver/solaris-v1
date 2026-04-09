import React from 'react';
import { AlertTriangle } from 'lucide-react';

export function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, darkMode, theme }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`${theme.modalBg} border ${theme.border} w-full max-w-sm rounded-2xl p-8 shadow-2xl`}>
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
            <AlertTriangle className="text-red-500" size={24} />
          </div>
          <h3 className="text-lg font-medium mb-2">{title}</h3>
          <p className={`text-sm ${theme.textSecondary} mb-8`}>{message}</p>
          <div className="flex w-full gap-3">
            <button onClick={onClose} className={`flex-1 py-3 rounded-xl border ${theme.border} text-xs font-bold uppercase tracking-widest hover:bg-black/5 transition-colors`}>
              Cancelar
            </button>
            <button onClick={onConfirm} className="flex-1 py-3 rounded-xl bg-red-500 text-white text-xs font-bold uppercase tracking-widest hover:bg-red-600 transition-colors">
              Eliminar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}