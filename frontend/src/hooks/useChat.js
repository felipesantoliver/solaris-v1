import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';

// Remove prefixos "Solaris:" repetidos (mas preserva o conteúdo)
function cleanDuplicateSolarisPrefix(text) {
  if (!text) return text;
  // Remove qualquer ocorrência de "Solaris:" ou "Solaris diz:" no início da string ou após quebra de linha
  const cleaned = text.replace(/(?:^|\n)\s*Solaris\s*[:：]?\s*(?:diz\s*)?[:：]?\s*/gi, '\n');
  // Remove múltiplas quebras de linha
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

// Efeito de digitação (typewriter)
async function typewriteMessage(setMessages, assistantIdx, fullContent, onComplete) {
  let currentText = '';
  const chars = fullContent.split('');
  
  for (let i = 0; i < chars.length; i++) {
    currentText += chars[i];
    setMessages(prev => {
      const updated = [...prev];
      if (updated[assistantIdx]) {
        updated[assistantIdx] = { ...updated[assistantIdx], content: currentText };
      }
      return updated;
    });
    // Delay variável: mais rápido para letras comuns, um pouco maior para pontuação e quebras de linha
    const delay = chars[i] === '\n' ? 60 : chars[i] === '.' || chars[i] === '?' || chars[i] === '!' ? 80 : 25;
    await new Promise(r => setTimeout(r, delay));
  }
  onComplete?.();
}

export function useChat(effectiveUserId, authUser, model, activeProjectId) {
  const [messages, setMessages] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [sendError, setSendError] = useState('');
  const newChatRef = useRef(null);
  const typewriterRef = useRef(null);

  const statusSequence = [
    { text: "Analisando contexto...", duration: 600 },
    { text: "Consultando memórias do projeto...", duration: 600 },
    { text: "Preparando resposta...", duration: 500 }
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
      // Ao carregar mensagens antigas, não adicionamos prefixo extra
      setMessages(msgs);
    } catch { setMessages([]); }
  }, [effectiveUserId]);

  useEffect(() => {
    loadMessages(activeChatId);
  }, [activeChatId, loadMessages]);

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
        setSendError(`Não foi possível iniciar conversa: ${err.message}`);
        setMessages(prev => prev.slice(0, -1));
        return;
      }
    }

    setIsLoading(true);
    await showStatusSequence();
    setIsStreaming(true);
    setIsLoading(false);

    // CORREÇÃO: o índice do assistente é capturado no momento da inserção da mensagem vazia
    let assistantIdx;
    setMessages(prev => {
      assistantIdx = prev.length; // índice exato antes de adicionar a mensagem do assistente
      return [...prev, { role: 'assistant', content: '', model: '' }];
    });

    try {
      // Usa o fallback (resposta completa) em vez do stream problemático
      const fallback = await api.sendMessageFallback(
        currentChatId,
        projectId,
        text,
        effectiveUserId,
        authUser ? model : 'flash'
      );
      
      let rawResponse = fallback.response || '';
      // Remove prefixos "Solaris:" repetidos que o backend possa ter enviado
      let cleanedContent = cleanDuplicateSolarisPrefix(rawResponse);
      // Adiciona o prefixo "Solaris:" uma única vez, se ainda não existir
      if (!cleanedContent.toLowerCase().startsWith('solaris')) {
        cleanedContent = `Solaris: ${cleanedContent}`;
      }
      
      // Atualiza a mensagem do assistente com o modelo correto (se disponível)
      setMessages(prev => {
        const updated = [...prev];
        if (updated[assistantIdx]) {
          updated[assistantIdx] = { ...updated[assistantIdx], model: fallback.model };
        }
        return updated;
      });
      
      // Inicia o typewriter com o índice correto
      await typewriteMessage(setMessages, assistantIdx, cleanedContent, () => {
        // Finalizou a digitação
      });
      
    } catch (err) {
      console.error('Erro ao obter resposta:', err);
      setMessages(prev => {
        const updated = [...prev];
        if (updated[assistantIdx]) {
          updated[assistantIdx] = { 
            ...updated[assistantIdx], 
            content: `⚠️ Não foi possível obter resposta: ${err.message}` 
          };
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
      setStatusMessage('');
    }
  }, [isLoading, isStreaming, messages.length, effectiveUserId, authUser, model]);

  const editMessage = useCallback(async (index, newContent, originalContent, chatId, projectId) => {
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
    // Opcional: chamar API para salvar edição no backend
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