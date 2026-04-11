import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';

export function useChat(effectiveUserId, authUser, model, activeProjectId) {
  const [messages, setMessages]         = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [isLoading, setIsLoading]       = useState(false);
  const [isStreaming, setIsStreaming]    = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [sendError, setSendError]       = useState('');
  const newChatRef      = useRef(null);
  const assistantIdxRef = useRef(null);
  const streamTimeoutRef = useRef(null); // timeout de segurança

  // ── Status visual antes da resposta ──────────────────────────────────────
  const statusSequence = [
    { text: 'Analisando contexto...',             duration: 300 },
    { text: 'Consultando memórias do projeto...', duration: 300 },
    { text: 'Preparando resposta...',             duration: 200 },
  ];

  const showStatusSequence = async () => {
    for (const step of statusSequence) {
      setStatusMessage(step.text);
      await new Promise(r => setTimeout(r, step.duration));
    }
    setStatusMessage('');
  };

  // ── Finaliza streaming de forma segura ────────────────────────────────────
  const finishStreaming = useCallback(() => {
    clearTimeout(streamTimeoutRef.current);
    setIsStreaming(false);
    setStatusMessage('');
    // Pequeno delay para garantir que o último chunk foi processado antes de finalizar
    setTimeout(() => {
      assistantIdxRef.current = null;
    }, 50);
  }, []);

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
      } catch {
        setSendError('Não foi possível iniciar a conversa. Tente novamente.');
        setMessages(prev => prev.slice(0, -1));
        return;
      }
    }

    setIsLoading(true);
    setIsStreaming(true);

    // Insere o placeholder do assistente APÓS ativar isStreaming,
    // para que isAssistantWriting seja true desde o início
    setMessages(prev => {
      assistantIdxRef.current = prev.length;
      return [...prev, { role: 'assistant', content: '', model: authUser ? model : 'flash' }];
    });

    // Animação de status em paralelo com a requisição (não bloqueia mais)
    showStatusSequence().then(() => setStatusMessage(''));

    // Timeout de segurança: libera o input após 30s caso o stream trave
    streamTimeoutRef.current = setTimeout(() => {
      finishStreaming();
    }, 30000);

    try {
      await api.sendMessageStream(
        currentChatId,
        projectId,
        text,
        effectiveUserId,
        authUser ? model : 'flash',

        // onChunk — append em tempo real
        (chunk) => {
          setMessages(prev => {
            const idx = assistantIdxRef.current;
            if (idx === null || !prev[idx]) return prev;
            const updated = [...prev];
            updated[idx] = { ...updated[idx], content: updated[idx].content + chunk };
            return updated;
          });
        },

        // onTitle
        (title, chat_id) => {
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
          finishStreaming();
        },

        // onDone
        () => {
          finishStreaming();
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
      finishStreaming();
    }
  }, [isLoading, isStreaming, effectiveUserId, authUser, model, finishStreaming]);

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