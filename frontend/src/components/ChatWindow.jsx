import React, { useRef, useEffect } from 'react';
import { MessageBubble } from './ui/MessageBubble';

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

  // Mostra os pontinhos apenas quando está carregando OU quando o streaming
  // ainda não começou a produzir conteúdo (última msg do assistente ainda vazia)
  const lastMsg = messages[messages.length - 1];
  // Dots aparecem enquanto: está carregando OU enquanto o streaming ainda não produziu conteúdo
  const assistantPlaceholderEmpty = lastMsg?.role === 'assistant' && !lastMsg?.content;
  const showDots = isLoading || (isStreaming && assistantPlaceholderEmpty);

  const WelcomeScreen = () => (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8 text-center animate-in fade-in duration-700">
      <div className={`text-3xl font-extralight ${darkMode ? 'text-[#F5A623]/20' : 'text-[#1E3A5F]/15'}`}>✦</div>
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
          {messages.map((msg, i) => {
            // Índice da última mensagem do assistente
            const lastAssistantIdx = messages.reduce((acc, m, idx) => m.role === 'assistant' ? idx : acc, -1);
            const isLastAssistant = msg.role === 'assistant' && i === lastAssistantIdx;
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

      {/* Pontinhos: só aparecem antes do primeiro chunk chegar */}
      {showDots && (
        <div className="flex items-center gap-3 mt-12">
          <div className="flex gap-1">
            <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-[#F5A623]/50' : 'bg-[#1E3A5F]/60'} rounded-full animate-bounce [animation-delay:-0.3s]`} />
            <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-[#F5A623]/50' : 'bg-[#1E3A5F]/60'} rounded-full animate-bounce [animation-delay:-0.15s]`} />
            <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-[#F5A623]/50' : 'bg-[#1E3A5F]/60'} rounded-full animate-bounce`} />
          </div>
          {statusMessage && (
            <span className={`text-xs font-light tracking-wide ${theme.textSecondary} animate-pulse`}>{statusMessage}</span>
          )}
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}