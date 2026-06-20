import React, { useState, useRef, useEffect } from 'react';
import { Pencil, RotateCcw, Check, Loader2, Star } from 'lucide-react';
import AdvancedMarkdown from './AdvancedMarkdown';

export const MessageBubble = React.memo(({
  msg,
  index,
  darkMode,
  theme,
  onEdit,
  isEditing,
  editValue,
  setEditValue,
  onEditSave,
  onEditCancel,
  isLoading,
  programmingMode,
  isLastAssistant,
  isStreaming,
}) => {
  const [showHistory, setShowHistory] = useState(false);
  const editRef = useRef(null);

  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus();
      editRef.current.style.height = 'auto';
      editRef.current.style.height = editRef.current.scrollHeight + 'px';
    }
  }, [isEditing]);

  const hasHistory = Array.isArray(msg.edit_history) && msg.edit_history.length > 0;

  const showCursor = isLastAssistant && isStreaming && msg.content.length > 0;

  // Estilo base para mensagens do assistente
  const assistantTextClass = `text-base leading-relaxed transition-colors duration-500 ${
    darkMode ? 'text-white/60 font-light' : 'text-gray-600 font-light'
  }`;

  const renderContent = () => {
    // Mensagens do usuário: sempre texto puro
    if (msg.role === 'user') {
      return (
        <div className={`text-base leading-relaxed transition-colors duration-500 whitespace-pre-wrap ${
          darkMode ? 'text-white font-medium' : 'text-black font-medium'
        }`}>
          {msg.content}
        </div>
      );
    }

    // Mensagens do assistente: sempre ReactMarkdown (bold, listas, etc.)
    // Se a mensagem foi enviada com code mode, também renderiza blocos de código
    const msgHasCodeMode = msg.codingMode === true;

    return (
      <div className={`relative ${assistantTextClass}`}>
        <AdvancedMarkdown
          content={msg.content}
          darkMode={darkMode}
          codingMode={msgHasCodeMode}
          isStreaming={showCursor}
        />
        {showCursor && (
          <span className={`inline-block w-0.5 h-4 ml-0.5 align-middle animate-pulse ${darkMode ? 'bg-white/60' : 'bg-black/60'}`} />
        )}
      </div>
    );
  };

  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group/msg animate-in fade-in slide-in-from-bottom-2 duration-700`}>
      <div className={`max-w-[70%] ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
        <div className={`text-[9px] uppercase tracking-[0.2em] font-bold mb-3 ${theme.textMuted}`}>
          {msg.role === 'user' ? (
            <span className="flex items-center gap-1.5 justify-end">
              Você
              {msg.codingMode && <span className="text-[8px] bg-cyan-500/15 text-cyan-400/70 px-1.5 rounded-full">code</span>}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              Solaris{msg.model === 'pro' && <span className="flex items-center gap-0.5 text-amber-400 opacity-70"><Star size={8} />pro</span>}
              {msg.codingMode && <span className="ml-2 text-[8px] bg-amber-500/20 text-amber-300 px-1.5 rounded-full">modo programador</span>}
            </span>
          )}
          {msg.edited && <span className="ml-2 normal-case tracking-normal font-normal opacity-50">(editado)</span>}
        </div>
        {isEditing ? (
          <div className="text-left">
            <textarea
              ref={editRef}
              value={editValue}
              onChange={e => { setEditValue(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEditSave(); } if (e.key === 'Escape') onEditCancel(); }}
              className={`w-full bg-transparent border-b ${theme.inputBorder} text-base leading-relaxed resize-none focus:outline-none py-1 font-light ${darkMode ? 'text-white' : 'text-black'}`}
              rows={1}
            />
            <div className="flex items-center gap-3 mt-2 justify-end">
              <button onClick={onEditCancel} className={`text-xs ${theme.textMuted} hover:text-current transition-colors`}>cancelar</button>
              <button
                onClick={onEditSave}
                disabled={isLoading || !editValue.trim()}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all ${darkMode ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-black/10 text-black hover:bg-black/20'} disabled:opacity-40`}
              >
                {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}Salvar e regerar
              </button>
            </div>
          </div>
        ) : (
          <>
            {renderContent()}
            {msg.role === 'user' && !isLoading && (
              <div className="flex items-center gap-2 mt-1.5 justify-end opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200">
                {hasHistory && (
                  <button onClick={() => setShowHistory(!showHistory)} className={`flex items-center gap-1 text-[10px] ${theme.textMuted} hover:text-current transition-colors`}>
                    <RotateCcw size={10} />{msg.edit_history.length}v
                  </button>
                )}
                <button onClick={() => onEdit(index, msg.content)} className={`flex items-center gap-1 text-[10px] ${theme.textMuted} hover:text-current transition-colors`}>
                  <Pencil size={10} />editar
                </button>
              </div>
            )}
          </>
        )}
        {showHistory && hasHistory && !isEditing && (
          <div className={`mt-3 text-left border-l-2 ${darkMode ? 'border-white/10' : 'border-black/10'} pl-3 space-y-2`}>
            <p className={`text-[10px] uppercase tracking-widest ${theme.textMuted} mb-2`}>Versões anteriores</p>
            {msg.edit_history.map((h, i) => (
              <p key={i} className={`text-xs ${theme.textMuted} font-light`}>
                <span className="opacity-50 mr-2">{i + 1}.</span>{h.content}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});