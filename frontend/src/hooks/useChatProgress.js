import { useState, useCallback, useRef } from 'react';
import { api } from '../services/api';

// 'searching' varia conforme o tipo de chat: chats em projeto fazem RAG sobre
// fontes/documentos (contexto); chats sem projeto recuperam memórias globais.
function progressLabel(stage, projectId) {
  switch (stage) {
    case 'searching':  return projectId ? 'Analisando contexto…' : 'Consultando memórias…';
    case 'thinking':   return 'Preparando resposta…';
    case 'generating': return null; // limpa o indicador — texto passa a chegar via chunk
    default:           return null;
  }
}

export function useChatProgress() {
  const [statusVisual, setStatusVisual] = useState(null);
  const [isStreaming, setIsStreaming]   = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const fullTextRef = useRef('');

  const sendMessage = useCallback(async (chatId, projectId, message, userId, model, codingMode = false) => {
    setIsStreaming(true);
    setStreamedText('');
    fullTextRef.current = '';
    setStatusVisual(progressLabel('searching', projectId)); // estado otimista até o 1º evento

    try {
      await api.sendMessageStream(
        chatId, projectId, message, userId, model, codingMode,
        // onChunk — defensivo: garante indicador limpo mesmo se 'generating' for perdido
        (chunk) => {
          setStatusVisual(null);
          fullTextRef.current += chunk;
          setStreamedText(fullTextRef.current);
        },
        (title, chat_id) => { /* ex.: atualizar título na sidebar */ },
        (errorMsg) => {
          setStatusVisual(null);
          setIsStreaming(false);
          console.error('Erro no streaming:', errorMsg);
        },
        () => setIsStreaming(false),
        () => { /* ex.: exibir aviso de resposta truncada */ },
        // onProgress — alterna o texto do indicador conforme a etapa do backend
        (stage) => setStatusVisual(progressLabel(stage, projectId))
      );
    } catch (err) {
      setStatusVisual(null);
      setIsStreaming(false);
      console.error('Falha ao iniciar stream:', err);
    }
  }, []);

  return { statusVisual, isStreaming, streamedText, sendMessage };
}