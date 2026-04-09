import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';

function cleanAssistantMessage(text) {
  if (!text) return text;
  const solarisPrefixRegex = /^\s*Solaris\s*[:：]?\s*(diz\s*)?[:：]?\s*/i;
  return text
    .split(/\r?\n/)
    .map(line => solarisPrefixRegex.test(line) ? line.replace(solarisPrefixRegex, '') : line)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function useChat(effectiveUserId, authUser, model, activeProjectId) {
  const [messages, setMessages] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [sendError, setSendError] = useState('');
  const newChatRef = useRef(null);
  const assistantMsgIdxRef = useRef(-1);

  const statusSequence = [
    { text: "Analisando contexto...", duration: 400 },
    { text: "Consultando memórias do projeto...", duration: 400 },
    { text: "Preparando resposta...", duration: 300 }
  ];

  const showStatusSequence = async () => {
    for (const step of statusSequence) {
      setStatusMessage(step.text);
      await new Promise(r => setTimeout(r, step.duration));
    }
    setStatusMessage('');
  };

  const loadMessages = useCallback(async (chatId) => {
    if (!chatId) { setMessages([]); return; }
    if (newChatRef.current === chatId) { newChatRef.current = null; return; }
    try {
      const msgs = await api.getMessages(chatId, effectiveUserId);
      const cleaned = msgs.map(msg =>
        msg.role === 'assistant' ? { ...msg, content: cleanAssistantMessage(msg.content) } : msg
      );
      setMessages(cleaned);
    } catch { setMessages([]); }
  }, [effectiveUserId]);

  useEffect(() => {
    loadMessages(activeChatId);
  }, [activeChatId, loadMessages]);

  const sendMessage = useCallback(async (text, chatId, projectId, onCreateChat) => {
    if (!text.trim() || isLoading || isStreaming) return;
    setSendError('');
    setInput('');

    let currentChatId = chatId;
    setMessages(prev => [...prev, { role: 'user', content: text }]);

    if (!currentChatId) {
      try {
        const nc = await onCreateChat(projectId);
        currentChatId = nc.id;
        newChatRef.current = nc.id;
        setActiveChatId(nc.id);
      } catch (err) {
        setSendError(`Não foi possível iniciar conversa: ${err.message}`);
        setMessages(prev => prev.slice(0, -1));
        return;
      }
    }

    setIsLoading(true);
    await showStatusSequence();
    setIsStreaming(true);
    setIsLoading(false);

    let rawAccumulator = '';
    assistantMsgIdxRef.current = -1;

    try {
      await api.sendMessageStream(
        currentChatId,
        projectId,
        text,
        effectiveUserId,
        authUser ? model : 'flash',
        (chunk) => {
          rawAccumulator += chunk;
          const displayContent = cleanAssistantMessage(rawAccumulator);
          if (assistantMsgIdxRef.current === -1) {
            setMessages(prev => {
              assistantMsgIdxRef.current = prev.length;
              return [...prev, { role: 'assistant', content: displayContent, model: authUser ? model : 'flash' }];
            });
          } else {
            const idx = assistantMsgIdxRef.current;
            setMessages(prev => {
              const updated = [...prev];
              if (updated[idx]) updated[idx] = { ...updated[idx], content: displayContent };
              return updated;
            });
          }
        },
        (title, chatIdFromServer) => {
          // Atualizar título do chat na lista (será tratado no hook de projetos)
        },
        (error) => {
          throw new Error(error);
        },
        () => {
          const idx = assistantMsgIdxRef.current;
          if (idx !== -1) {
            setMessages(prev => {
              const updated = [...prev];
              if (updated[idx]) updated[idx] = { ...updated[idx], content: cleanAssistantMessage(rawAccumulator) };
              return updated;
            });
          }
        }
      );
    } catch (err) {
      console.error('Streaming falhou, usando fallback:', err);
      try {
        const fallback = await api.sendMessageFallback(currentChatId, projectId, text, effectiveUserId, authUser ? model : 'flash');
        const cleaned = cleanAssistantMessage(fallback.response);
        setMessages(prev => [...prev, { role: 'assistant', content: cleaned, model: fallback.model }]);
      } catch (fallbackErr) {
        setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${fallbackErr.message}` }]);
      }
    } finally {
      setIsStreaming(false);
      setStatusMessage('');
    }
  }, [isLoading, isStreaming, effectiveUserId, authUser, model, setActiveChatId]);

  const editMessage = useCallback(async (index, newContent, originalContent, chatId, projectId) => {
    // Implementação de edição (pode ser adicionada futuramente)
    // Por enquanto, apenas atualiza localmente
    setMessages(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        content: newContent,
        edited: true,
        edit_history: [...(updated[index].edit_history || []), { content: originalContent, edited_at: new Date().toISOString() }]
      };
      return updated;
    });
    // Disparar requisição para regerar resposta (endpoint não implementado no backend atual)
  }, []);

  return {
    messages,
    setMessages,
    activeChatId,
    setActiveChatId,
    isLoading,
    isStreaming,
    statusMessage,
    sendError,
    setSendError,
    sendMessage,
    editMessage,
    loadMessages,
  };
}