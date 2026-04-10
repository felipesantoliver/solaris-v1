import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';

export function useChat(effectiveUserId, authUser, model, activeProjectId) {
  const [messages, setMessages]       = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [isLoading, setIsLoading]     = useState(false);
  const [isStreaming, setIsStreaming]  = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [sendError, setSendError]     = useState('');
  const newChatRef    = useRef(null);
  const assistantIdxRef = useRef(null);

  // ── Status visual antes da resposta ──────────────────────────────────────
  const statusSequence = [
    { text: 'Analisando contexto...',          duration: 600 },
    { text: 'Consultando memórias do projeto...', duration: 600 },
    { text: 'Preparando resposta...',          duration: 500 },
  ];

  const showStatusSequence = async () => {
    for (const step of statusSequence) {
      setStatusMessage(step.text);
      await new Promise(r => setTimeout(r, step.duration));
    }
    setStatusMessage('');
  };

  // ── Carregar mensagens de um chat ─────────────────────────────────────────
  const loadMessages = useCallback(async (chatId) => {
    if (!chatId) { setMessages([]); return; }
    if (newChatRef.current === chatId) { newChatRef.current = null; return; }
    try {
      const msgs = await api.getMessages(chatId);
      setMessages(msgs);
    } catch { setMessages([]); }
  }, []);

  useEffect(() => {
    loadMessages(activeChatId);
  }, [activeChatId, loadMessages]);

  // ── Enviar mensagem (SSE streaming real) ──────────────────────────────────
  const sendMessage = useCallback(async (text, chatId, projectId, onCreateChat) => {
    if (!text.trim() || isLoading || isStreaming) return;
    setSendError('');

    let currentChatId = chatId;
    setMessages(prev => [...prev, { role: 'user', content: text }]);

    if (!currentChatId) {
      try {
        const nc = await onCreateChat(projectId);
        currentChatId = nc.id;
        newChatRef.current = nc.id;
        setActiveChatId(nc.id);
      } catch (err) {
        setSendError('Não foi possível iniciar a conversa. Tente novamente.');
        setMessages(prev => prev.slice(0, -1));
        return;
      }
    }

    setIsLoading(true);
    await showStatusSequence();
    setIsLoading(false);
    setIsStreaming(true);

    // Insere a mensagem vazia do assistente e guarda o índice via ref
    setMessages(prev => {
      assistantIdxRef.current = prev.length;
      return [...prev, { role: 'assistant', content: '', model: authUser ? model : 'flash' }];
    });

    try {
      await api.sendMessageStream(
        currentChatId,
        projectId,
        text,
        effectiveUserId,
        authUser ? model : 'flash',

        // onChunk — append em tempo real, sem typewriter artificial
        (chunk) => {
          setMessages(prev => {
            const idx = assistantIdxRef.current;
            if (idx === null || !prev[idx]) return prev;
            const updated = [...prev];
            updated[idx] = { ...updated[idx], content: updated[idx].content + chunk };
            return updated;
          });
        },

        // onTitle — atualiza título do chat na sidebar
        (title, chat_id) => {
          // O componente pai (App.jsx) escuta via setChatHistory;
          // emitimos um evento customizado leve para não precisar de prop drilling
          window.dispatchEvent(new CustomEvent('solaris:chat-title', { detail: { title, chat_id } }));
        },

        // onError
        (errMsg) => {
          setMessages(prev => {
            const idx = assistantIdxRef.current;
            if (idx === null || !prev[idx]) return prev;
            const updated = [...prev];
            updated[idx] = { ...updated[idx], content: '⚠️ Não foi possível obter resposta. Tente novamente.' };
            return updated;
          });
          setSendError('Não foi possível obter resposta. Tente novamente.');
        },

        // onDone
        () => {
          setIsStreaming(false);
          setStatusMessage('');
          assistantIdxRef.current = null;
        },
      );
    } catch (err) {
      console.error('Erro ao enviar mensagem:', err);
      setMessages(prev => {
        const idx = assistantIdxRef.current;
        if (idx === null || !prev[idx]) return prev;
        const updated = [...prev];
        updated[idx] = { ...updated[idx], content: '⚠️ Não foi possível obter resposta. Tente novamente.' };
        return updated;
      });
      setSendError('Não foi possível obter resposta. Tente novamente.');
      setIsStreaming(false);
      setStatusMessage('');
      assistantIdxRef.current = null;
    }
  }, [isLoading, isStreaming, effectiveUserId, authUser, model]);

  // ── Editar mensagem ───────────────────────────────────────────────────────
  const editMessage = useCallback(async (index, newContent, originalContent) => {
    setMessages(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        content: newContent,
        edited: true,
        edit_history: [
          ...(updated[index].edit_history || []),
          { content: originalContent, edited_at: new Date().toISOString() },
        ],
      };
      return updated;
    });
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