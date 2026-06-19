import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';

export function useChat(effectiveUserId, authUser, model, activeProjectId) {
  const [messages, setMessages]           = useState([]);
  const [activeChatId, setActiveChatId]   = useState(null);
  const [isLoading, setIsLoading]         = useState(false);
  const [isStreaming, setIsStreaming]      = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [sendError, setSendError]         = useState('');
  const [maxTokensReached, setMaxTokensReached] = useState(false);

  // Estado de paginação das mensagens
  const [messagesTotal, setMessagesTotal] = useState(0);
  const [messagesPage, setMessagesPage]   = useState(1);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const messagesLimit = 30;

  const newChatRef       = useRef(null);
  const assistantIdxRef  = useRef(null);
  const streamTimeoutRef = useRef(null);
  const continueContextRef = useRef({ chatId: null, projectId: null });
  const lastAssistantContentRef = useRef(''); // guarda o texto final p/ usar no corpo da notificação

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
    setIsLoading(false);
    setStatusMessage('');
    setTimeout(() => { assistantIdxRef.current = null; }, 50);
  }, []);

  // ── Som de notificação (gerado via Web Audio API, sem depender de arquivo) ─
  const playNotificationSound = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      const playTone = (freq, start, duration, peakGain = 0.15) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + start);
        gain.gain.linearRampToValueAtTime(peakGain, now + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + duration + 0.02);
      };

      // "Ding" curto de duas notas
      playTone(880, 0, 0.15);
      playTone(1320, 0.08, 0.18);

      // Libera o contexto de áudio após o som terminar
      setTimeout(() => { ctx.close().catch(() => {}); }, 600);
    } catch (err) {
      console.warn('Não foi possível tocar o som de notificação:', err);
    }
  }, []);

  // ── Notificação do navegador (Notification API) ───────────────────────────
  const showBrowserNotification = useCallback((bodyText) => {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission !== 'granted') return;

      // Só exibe a notificação se a aba estiver em background.
      // Se o usuário já está olhando a conversa, a notificação do SO é redundante.
      if (document.visibilityState === 'visible') return;

      const notification = new Notification('Solaris', {
        body: bodyText && bodyText.trim() ? bodyText.trim() : 'Sua resposta está pronta.',
        tag: 'solaris-response', // evita empilhar várias notificações
        silent: true,            // o som já é tratado separadamente
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (err) {
      console.warn('Não foi possível exibir a notificação do navegador:', err);
    }
  }, []);

  // ── Dispara som/notificação ao final da resposta, respeitando preferências ─
  const notifyResponseDone = useCallback(() => {
    const soundEnabled   = localStorage.getItem('solaris_notif_sound') === 'true';
    const browserEnabled = localStorage.getItem('solaris_notif_browser') === 'true';

    if (!soundEnabled && !browserEnabled) return;

    if (soundEnabled) {
      playNotificationSound();
    }

    if (browserEnabled) {
      const preview = (lastAssistantContentRef.current || '').slice(0, 120);
      showBrowserNotification(preview);
    }
  }, [playNotificationSound, showBrowserNotification]);

  // ── Carregar mensagens de um chat (com paginação) ────────────────────────
  const loadMessages = useCallback(async (chatId, page = 1, limit = messagesLimit) => {
    if (!chatId) {
      setMessages([]);
      setMessagesTotal(0);
      setMessagesPage(1);
      setHasMoreMessages(false);
      return;
    }

    // Se for um chat recém-criado, não carrega do backend (está vazio)
    if (newChatRef.current === chatId) {
      newChatRef.current = null;
      setMessages([]);
      setMessagesTotal(0);
      setMessagesPage(1);
      setHasMoreMessages(false);
      return;
    }

    try {
      const result = await api.getMessages(chatId, { page, limit });
      const { data, total, page: currentPage, hasMore } = result;

      if (page === 1) {
        setMessages(data);
      } else {
        // Concatena com as mensagens existentes (ordenadas por created_at ASC)
        setMessages(prev => [...prev, ...data]);
      }

      setMessagesTotal(total);
      setMessagesPage(currentPage);
      setHasMoreMessages(hasMore);
    } catch (err) {
      console.error('Erro ao carregar mensagens:', err);
      if (page === 1) setMessages([]);
      setMessagesTotal(0);
      setHasMoreMessages(false);
    }
  }, []);

  // Carrega a próxima página
  const loadMoreMessages = useCallback(async () => {
    if (!activeChatId || !hasMoreMessages || isLoading) return;
    const nextPage = messagesPage + 1;
    await loadMessages(activeChatId, nextPage, messagesLimit);
  }, [activeChatId, hasMoreMessages, messagesPage, isLoading, loadMessages]);

  // Recarrega a primeira página (ex: após enviar mensagem)
  const refreshMessages = useCallback(async () => {
    if (activeChatId) {
      await loadMessages(activeChatId, 1, messagesLimit);
    }
  }, [activeChatId, loadMessages]);

  // Quando o chat ativo muda, carrega a primeira página
  useEffect(() => {
    loadMessages(activeChatId, 1, messagesLimit);
  }, [activeChatId, loadMessages]);

  // Limpa o flag de maxTokens quando muda de chat
  useEffect(() => {
    setMaxTokensReached(false);
  }, [activeChatId]);

  // ── Enviar mensagem (SSE streaming real) ──────────────────────────────────
  const sendMessage = useCallback(async (text, chatId, projectId, onCreateChat, codingMode = false) => {
    if (!text.trim() || isLoading || isStreaming) return;
    setSendError('');
    setMaxTokensReached(false);

    let currentChatId = chatId;
    setMessages(prev => [...prev, { role: 'user', content: text, codingMode }]);

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

    continueContextRef.current = { chatId: currentChatId, projectId };

    setIsLoading(true);
    setIsStreaming(true);

    setMessages(prev => {
      assistantIdxRef.current = prev.length;
      return [...prev, { role: 'assistant', content: '', model: authUser ? model : 'flash', codingMode }];
    });
    lastAssistantContentRef.current = '';

    showStatusSequence().then(() => setStatusMessage(''));

    streamTimeoutRef.current = setTimeout(() => { finishStreaming(); }, 30000);

    try {
      await api.sendMessageStream(
        currentChatId,
        projectId,
        text,
        effectiveUserId,
        authUser ? model : 'flash',
        codingMode,

        // onChunk
        (chunk) => {
          setMessages(prev => {
            const idx = assistantIdxRef.current;
            if (idx === null || !prev[idx]) return prev;
            const updated = [...prev];
            const newContent = updated[idx].content + chunk;
            updated[idx] = { ...updated[idx], content: newContent };
            lastAssistantContentRef.current = newContent;
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
          notifyResponseDone();
          finishStreaming();
          // Recarrega a primeira página para sincronizar com o backend
          refreshMessages();
        },

        // onMaxTokens
        () => { setMaxTokensReached(true); },
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
  }, [isLoading, isStreaming, effectiveUserId, authUser, model, finishStreaming, refreshMessages, notifyResponseDone]);

  // ── Continuar resposta cortada ────────────────────────────────────────────
  const continueResponse = useCallback(async (onCreateChat) => {
    const { chatId, projectId } = continueContextRef.current;
    if (!chatId) return;
    setMaxTokensReached(false);
    await sendMessage('continue', chatId, projectId, onCreateChat);
  }, [sendMessage]);

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
    continueResponse,
    maxTokensReached,
    editMessage,
    loadMessages,
    loadMoreMessages,
    refreshMessages,
    messagesTotal,
    messagesPage,
    hasMoreMessages,
  };
}