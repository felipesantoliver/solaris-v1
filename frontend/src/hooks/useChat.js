import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';

// 'searching' varia conforme o tipo de chat: chats em projeto fazem RAG sobre
// fontes/documentos (contexto); chats sem projeto recuperam memórias globais.
// (Mesma lógica que existia em useChatProgress.js — mantida aqui para que o
// indicador granular searching → thinking → generating funcione no chat normal.)
function progressLabel(stage, projectId) {
  switch (stage) {
    case 'searching':  return projectId ? 'Analisando contexto…' : 'Consultando memórias…';
    case 'thinking':   return 'Preparando resposta…';
    case 'generating': return null; // limpa o indicador — texto passa a chegar via chunk
    default:           return null;
  }
}

// Avisa a Sidebar (via useProjects) que o título do chat mudou — mesmo evento
// que useProjects.js já escuta (window 'solaris:chat-title').
function announceTitle(title, chat_id) {
  if (!title || !chat_id) return;
  window.dispatchEvent(new CustomEvent('solaris:chat-title', { detail: { title, chat_id } }));
}

export function useChat(effectiveUserId, authUser, model, activeProjectId) {
  const [messages, setMessages]           = useState([]);
  const [activeChatId, setActiveChatId]   = useState(null);
  const [isLoading, setIsLoading]         = useState(false); // criação do chat / carregamento do histórico
  const [isStreaming, setIsStreaming]     = useState(false); // SSE ativo
  const [statusMessage, setStatusMessage] = useState(null);
  const [sendError, setSendError]         = useState('');
  const [maxTokensReached, setMaxTokensReached] = useState(false);

  const fullTextRef     = useRef('');
  const skipNextLoadRef = useRef(false); // ver comentário no useEffect abaixo

  // ─── Carrega o histórico de um chat ─────────────────────────────────────
  const loadMessages = useCallback(async (chatId) => {
    const targetId = chatId ?? activeChatId;
    if (!targetId) { setMessages([]); return; }
    setIsLoading(true);
    try {
      const res = await api.getMessages(targetId);
      setMessages(Array.isArray(res?.data) ? res.data : []);
    } catch (err) {
      console.error('Falha ao carregar mensagens:', err);
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeChatId]);

  // Recarrega sempre que o chat ativo muda (troca na Sidebar, "nova conversa",
  // exclusão...). EXCETO logo após sendMessage criar um chat novo — nesse caso
  // já temos as mensagens otimistas em memória (e possivelmente um stream em
  // andamento); recarregar do banco agora apagaria o streaming em progresso.
  useEffect(() => {
    if (skipNextLoadRef.current) { skipNextLoadRef.current = false; return; }
    if (activeChatId) loadMessages(activeChatId);
    else setMessages([]);
    setSendError('');
    setMaxTokensReached(false);
  }, [activeChatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Stream da resposta do assistente ───────────────────────────────────
  // Compartilhado entre envio normal, edição (regerar) e "continuar resposta".
  const streamAssistantReply = useCallback(async (chatId, projectId, message, codingMode) => {
    setIsStreaming(true);
    setStatusMessage(progressLabel('searching', projectId)); // estado otimista até o 1º evento
    fullTextRef.current = '';

    const appendChunk = (chunk) => {
      setStatusMessage(null);
      fullTextRef.current += chunk;
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: fullTextRef.current };
        return next;
      });
    };

    try {
      await api.sendMessageStream(
        chatId, projectId, message, effectiveUserId, model, codingMode,
        appendChunk,
        announceTitle,
        (errorMsg) => setSendError(errorMsg || 'Erro ao gerar resposta.'),
        () => {}, // onDone — nada extra a fazer aqui, o finally abaixo encerra o streaming
        () => setMaxTokensReached(true),
        (stage) => setStatusMessage(progressLabel(stage, projectId)),
      );
    } catch (err) {
      // Stream falhou antes mesmo de começar (rede, servidor fora do ar, etc.)
      // — tenta o modo de compatibilidade não-streaming antes de desistir.
      console.error('Falha no streaming, tentando modo de compatibilidade:', err);
      try {
        const res = await api.sendMessageFallback(chatId, projectId, message, effectiveUserId, model);
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: res.response };
          return next;
        });
        if (res.maxTokens) setMaxTokensReached(true);
      } catch (fallbackErr) {
        console.error('Modo de compatibilidade também falhou:', fallbackErr);
        setSendError(fallbackErr.message || 'Não foi possível enviar a mensagem. Tente novamente.');
        // Remove o placeholder vazio do assistente — nenhuma resposta foi gerada
        setMessages(prev => {
          const last = prev[prev.length - 1];
          return (last?.role === 'assistant' && !last.content) ? prev.slice(0, -1) : prev;
        });
      }
    } finally {
      setStatusMessage(null);
      setIsStreaming(false);
    }
  }, [effectiveUserId, model]);

  // ─── Envia uma nova mensagem do usuário ─────────────────────────────────
  const sendMessage = useCallback(async (text, chatId, projectId, ensureChat, codingMode = false) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return;

    setSendError('');
    setMaxTokensReached(false);

    let targetChatId = chatId;
    if (!targetChatId) {
      setIsLoading(true);
      try {
        const newChat = await ensureChat(projectId);
        targetChatId = newChat.id;
        skipNextLoadRef.current = true;
        setActiveChatId(targetChatId);
      } catch (err) {
        console.error('Falha ao criar conversa:', err);
        setSendError('Não foi possível criar a conversa. Tente novamente.');
        setIsLoading(false);
        return;
      }
      setIsLoading(false);
    }

    setMessages(prev => [
      ...prev,
      { role: 'user', content: trimmed, codingMode },
      { role: 'assistant', content: '', model, codingMode },
    ]);

    await streamAssistantReply(targetChatId, projectId, trimmed, codingMode);
  }, [streamAssistantReply, model]);

  // ─── Edita uma mensagem do usuário e regenera a resposta a partir dela ──
  const editMessage = useCallback(async (index, newContent, _originalContent, chatId, projectId) => {
    const trimmed = (newContent || '').trim();
    if (!trimmed || !chatId) return;
    const target = messages[index];
    if (!target || target.role !== 'user') return;

    setSendError('');
    setMaxTokensReached(false);

    // Persiste a edição (mantém histórico de versões) — não bloqueia a
    // regeneração se falhar. Mensagens ainda não recarregadas do banco nesta
    // sessão não têm `id` ainda; nesse caso só a regeneração local acontece.
    if (target.id) {
      api.editMessage(target.id, trimmed).catch(err => console.warn('Falha ao salvar edição:', err));
    }

    // Descarta tudo após a mensagem editada — a conversa é regerada a partir dela.
    setMessages(prev => [
      ...prev.slice(0, index),
      { ...target, content: trimmed, edited: true },
      { role: 'assistant', content: '', model, codingMode: target.codingMode },
    ]);

    await streamAssistantReply(chatId, projectId, trimmed, target.codingMode);
  }, [messages, model, streamAssistantReply]);

  // ─── Continua uma resposta truncada por limite de tokens ────────────────
  const continueGeneration = useCallback(async (chatId, projectId) => {
    if (!chatId) return;
    setMaxTokensReached(false);
    setMessages(prev => [...prev, { role: 'assistant', content: '', model }]);
    await streamAssistantReply(chatId, projectId, 'Continue de onde parou, sem repetir o que já foi dito.', false);
  }, [model, streamAssistantReply]);

  return {
    messages, setMessages,
    activeChatId, setActiveChatId,
    isLoading, isStreaming,
    statusMessage,
    sendError, setSendError,
    maxTokensReached,
    sendMessage, editMessage, loadMessages, continueGeneration,
  };
}
