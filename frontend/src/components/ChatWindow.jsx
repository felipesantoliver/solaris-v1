import React, { useRef, useEffect } from 'react';
import { MessageBubble } from './ui/MessageBubble';
import { Loader2 } from 'lucide-react';

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
}) {
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, isStreaming]);

  const WelcomeScreen = () => (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8 text-center animate-in fade-in duration-700">
      <div className={`text-3xl font-extralight ${darkMode ? 'text-white/10' : 'text-black/10'}`}>✦</div>
      <div>
        <p className={`text-base font-light ${theme.textSecondary}`}>Olá{displayName ? `, ${displayName}` : ''}.</p>
        <p className={`text-sm font-light mt-1 ${theme.textMuted}`}>
          {activeProjectId ? 'Nenhuma conversa ainda. Comece digitando.' : 'Como posso ajudar hoje?'}
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex-1 relative overflow-y-auto px-6 md:px-20 py-10 custom-scrollbar transition-colors duration-500">
      {messages.length === 0 ? (
        <WelcomeScreen />
      ) : (
        <div className="space-y-12">
          {messages.map((msg, i) => (
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
            />
          ))}
        </div>
      )}
      {(isLoading || isStreaming) && (
        <div className="flex items-center gap-3 mt-12">
          <div className="flex gap-1">
            <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black/60'} rounded-full animate-bounce [animation-delay:-0.3s]`} />
            <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black/60'} rounded-full animate-bounce [animation-delay:-0.15s]`} />
            <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black/60'} rounded-full animate-bounce`} />
          </div>
          {statusMessage && (
            <span className={`text-xs font-light tracking-wide ${theme.textSecondary} animate-pulse`}>{statusMessage}</span>
          )}
          {isStreaming && !statusMessage && (
            <span className={`text-xs font-light tracking-wide ${theme.textSecondary} animate-pulse`}>Gerando resposta...</span>
          )}
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}