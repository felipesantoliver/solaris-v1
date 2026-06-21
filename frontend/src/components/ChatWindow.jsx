import React, { useRef, useEffect } from 'react';
import { MessageBubble } from './ui/MessageBubble';
import { ChevronRight, Loader2 } from 'lucide-react';

export function ChatWindow({
  messages,
  darkMode,
  theme,
  isLoading,
  isStreaming,
  statusMessage,
  displayName,
  activeProjectId,
  onEdit,
  editingMsgIndex,
  editValue,
  setEditValue,
  onEditSave,
  onEditCancel,
  programmingMode,
  maxTokensReached,
  onContinue,
}) {
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, isStreaming, maxTokensReached]);

  const lastMsg = messages[messages.length - 1];
  const assistantPlaceholderEmpty = lastMsg?.role === 'assistant' && !lastMsg?.content && !Array.isArray(lastMsg?.agentSteps);
  const showDots = isLoading || (isStreaming && assistantPlaceholderEmpty);

  const WelcomeScreen = () => (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8 text-center animate-in fade-in duration-700">
      {/* Estrela — ciano quando code mode ativo, padrão caso contrário */}
      <div
        className={programmingMode ? 'code-mode-dot text-3xl font-extralight' : `text-3xl font-extralight ${darkMode ? 'text-white/10' : 'text-black/10'}`}
        style={programmingMode ? { color: darkMode ? 'rgb(103 232 249)' : 'rgb(8 145 178)' } : {}}
      >✦</div>
      <div>
        <p className={`text-base font-light ${theme.textSecondary}`}>Olá{displayName ? `, ${displayName}` : ''}.</p>
        <p className={`text-sm font-light mt-1 ${theme.textMuted}`}>
          {activeProjectId ? 'Nenhuma conversa ainda. Comece digitando.' : 'Como posso ajudar hoje?'}
        </p>
      </div>
    </div>
  );

  return (
    <div className={`flex-1 relative overflow-y-auto px-6 md:px-20 py-10 custom-scrollbar transition-colors duration-500`}>

      {messages.length === 0 ? (
        <WelcomeScreen />
      ) : (
        <div className="space-y-12">
          {messages.map((msg, i) => {
            const lastAssistantIdx = messages.reduce((acc, m, idx) => m.role === 'assistant' ? idx : acc, -1);
            const isLastAssistant  = msg.role === 'assistant' && i === lastAssistantIdx;
            return (
              <MessageBubble
                key={msg.id || i}
                msg={msg}
                index={i}
                darkMode={darkMode}
                theme={theme}
                onEdit={onEdit}
                isEditing={editingMsgIndex === i}
                editValue={editValue}
                setEditValue={setEditValue}
                onEditSave={onEditSave}
                onEditCancel={onEditCancel}
                isLoading={isLoading || isStreaming}
                programmingMode={programmingMode}
                isLastAssistant={isLastAssistant}
                isStreaming={isStreaming}
              />
            );
          })}
        </div>
      )}

      {/* Pontinhos de carregamento */}
      {showDots && (
        <div className="flex items-center gap-3 mt-12">
          <div className="flex gap-1">
            <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black/60'} rounded-full animate-bounce [animation-delay:-0.3s]`} />
            <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black/60'} rounded-full animate-bounce [animation-delay:-0.15s]`} />
            <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black/60'} rounded-full animate-bounce`} />
          </div>
          {statusMessage && (
            <span className={`text-xs font-light tracking-wide ${theme.textSecondary} animate-pulse`}>{statusMessage}</span>
          )}
        </div>
      )}

      {/* Botão "Continuar" — aparece quando a resposta foi cortada por limite de tokens */}
      {maxTokensReached && !isStreaming && !isLoading && (
        <div className="mt-8 flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-500">
          <button
            onClick={onContinue}
            className={`
              group flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium
              border transition-all duration-200
              ${darkMode
                ? 'border-white/15 text-white/50 hover:border-white/30 hover:text-white/80 hover:bg-white/5'
                : 'border-black/15 text-black/40 hover:border-black/25 hover:text-black/70 hover:bg-black/5'
              }
            `}
          >
            {isLoading
              ? <Loader2 size={12} className="animate-spin" />
              : <ChevronRight size={12} className="transition-transform group-hover:translate-x-0.5" />
            }
            continuar resposta
          </button>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}