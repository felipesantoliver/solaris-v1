import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

// Mesma ordenação aplicada no backend (ORDER BY pinned DESC, updated_at DESC)
// — usada para resincronizar a lista localmente depois de fixar/desafixar um
// chat sem precisar recarregar tudo do servidor.
function sortChats(list) {
  return [...list].sort((a, b) => {
    const pa = a.pinned ? 1 : 0, pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
  });
}

export function useProjects(effectiveUserId, authUser, model) {
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchProjects = useCallback(async () => {
    if (!effectiveUserId) return;
    try {
      const data = await api.getProjects();
      setProjects(Array.isArray(data) ? data : []);
    } catch {
      setProjects([]);
    }
  }, [effectiveUserId]);

  const fetchNoProjectChats = useCallback(async () => {
    if (!effectiveUserId) return;
    try {
      // FIX 4.7: api.getUserChats() retorna um objeto paginado
      // { data, total, page, limit, hasMore } — não um array. O código antigo
      // fazia `Array.isArray(data) ? data : []`, que SEMPRE caía no `[]`
      // (porque `data` aqui era o objeto, não array), apagando a lista de
      // chats avulsos toda vez que este efeito rodava de novo (ex: ao voltar
      // o foco/visibilidade da aba, remount em StrictMode, etc.) — por isso
      // o sumiço acontecia sempre, de forma determinística.
      const res = await api.getUserChats();
      if (!activeProjectId) setChatHistory(Array.isArray(res?.data) ? res.data : []);
    } catch {}
  }, [effectiveUserId, activeProjectId]);

  useEffect(() => {
    fetchProjects();
    fetchNoProjectChats();
  }, [fetchProjects, fetchNoProjectChats]);

  // ✅ CORREÇÃO: removido setActiveChatId que não existe neste hook
  const loadProjectChats = useCallback(async (projectId) => {
    if (!projectId) {
      setChatHistory([]);
      return;
    }
    try {
      const project = await api.getProject(projectId);
      setChatHistory(project.chats || []);
    } catch {
      setChatHistory([]);
    }
  }, []);

  // Carregar chats quando o projeto ativo muda
  useEffect(() => {
    if (activeProjectId) {
      loadProjectChats(activeProjectId);
    } else {
      fetchNoProjectChats();
    }
  }, [activeProjectId, loadProjectChats, fetchNoProjectChats]);

  // Atualiza o titulo do chat na sidebar em tempo real, sem precisar recarregar a pagina
  useEffect(() => {
    const handler = (e) => {
      const { title, chat_id } = e.detail || {};
      if (!title || !chat_id) return;
      setChatHistory(prev => {
        // Se já existe, só atualiza o título (evita duplicação)
        if (prev.some(c => c.id === chat_id)) {
          return prev.map(c => c.id === chat_id ? { ...c, title } : c);
        }
        // Se ainda não existe na lista, adiciona no topo com o título correto
        return [{ id: chat_id, title }, ...prev];
      });
    };
    window.addEventListener('solaris:chat-title', handler);
    return () => window.removeEventListener('solaris:chat-title', handler);
  }, []);

  const createProject = useCallback(async (name, summary = '', detailedObjective = '', tags = [], responseStyle = 'direto', memoryMode = 'projeto', instructions = '', sharedMemoryEnabled = false) => {
    const newProject = await api.createProject({
      name,
      summary,
      detailed_objective: detailedObjective,
      tags,
      response_style: responseStyle,
      memory_mode: memoryMode,
      instructions,
      shared_memory_enabled: sharedMemoryEnabled,
    }, authUser ? model : 'flash');
    setProjects(prev => [newProject, ...prev]);
    setActiveProjectId(newProject.id);
    return newProject;
  }, [authUser, model]);

  const updateProject = useCallback(async (id, updates) => {
    const updated = await api.updateProject(id, updates);
    setProjects(prev => prev.map(p => p.id === id ? updated : p));
    return updated;
  }, []);

  const deleteProject = useCallback(async (id) => {
    await api.deleteProject(id);
    setProjects(prev => prev.filter(p => p.id !== id));
    if (activeProjectId === id) {
      setActiveProjectId(null);
      setChatHistory([]);
    }
  }, [activeProjectId]);

  const createChatInProject = useCallback(async (projectId) => {
    const newChat = await api.createChat(projectId, authUser ? model : 'flash');
    setChatHistory(prev => [newChat, ...prev]);
    return newChat;
  }, [authUser, model]);

  const deleteChat = useCallback(async (projectId, chatId) => {
    await api.deleteChat(projectId, chatId);
    setChatHistory(prev => prev.filter(c => c.id !== chatId));
  }, []);

  const updateChatTitle = useCallback(async (chatId, title) => {
    const result = await api.updateChatTitle(chatId, title);
    setChatHistory(prev => prev.map(c => c.id === chatId ? { ...c, title: result.title } : c));
    return result;
  }, []);

  // Menu de contexto da sidebar: arquivar remove o chat da lista atualmente
  // exibida (a seção "Arquivados" fica para uma próxima etapa de UI).
  const archiveChat = useCallback(async (chatId, archived = true) => {
    const updated = await api.archiveChat(chatId, archived);
    setChatHistory(prev => prev.filter(c => c.id !== chatId));
    return updated;
  }, []);

  // Menu de contexto da sidebar: fixar reordena a lista localmente (mesma
  // regra do backend — pinned primeiro, depois updated_at desc) sem precisar
  // recarregar do servidor.
  const pinChat = useCallback(async (chatId, pinned = true) => {
    const updated = await api.pinChat(chatId, pinned);
    setChatHistory(prev => sortChats(prev.map(c => c.id === chatId ? { ...c, ...updated } : c)));
    return updated;
  }, []);

  // 4.3: Move um chat para dentro de um projeto (ou para fora, se targetProjectId
  // for null/undefined). Atualiza a lista local sem precisar de reload:
  // o chat some da lista atualmente exibida assim que deixa de pertencer a ela
  // (contexto mudou — projeto diferente do ativo, ou saiu/entrou em "sem projeto").
  const moveChatToProject = useCallback(async (chatId, targetProjectId) => {
    const normalizedTarget = targetProjectId || null;
    const updated = await api.moveChat(chatId, normalizedTarget);
    setChatHistory(prev => {
      // O chat deixou de pertencer ao contexto atualmente exibido (activeProjectId
      // ou "sem projeto", quando activeProjectId é null) — remove da lista.
      const stillBelongsHere = normalizedTarget === (activeProjectId || null);
      if (!stillBelongsHere) return prev.filter(c => c.id !== chatId);
      return prev.map(c => c.id === chatId ? { ...c, ...updated } : c);
    });
    return updated;
  }, [activeProjectId]);

  const deleteAllChats = useCallback(async () => {
    const result = await api.deleteAllUserChats();
    setChatHistory([]);
    return result;
  }, []);

  return {
    projects,
    activeProjectId,
    setActiveProjectId,
    chatHistory,
    setChatHistory,
    loading,
    fetchProjects,
    fetchNoProjectChats,
    loadProjectChats,
    createProject,
    updateProject,
    deleteProject,
    createChatInProject,
    deleteChat,
    updateChatTitle,
    archiveChat,
    pinChat,
    moveChatToProject,
    deleteAllChats,
  };
}