import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

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
      const data = await api.getUserChats();
      if (!activeProjectId) setChatHistory(Array.isArray(data) ? data : []);
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

  const createProject = useCallback(async (name, summary = '', detailedObjective = '', tags = [], responseStyle = 'direto', memoryMode = 'projeto') => {
    const newProject = await api.createProject({
      name,
      summary,
      detailed_objective: detailedObjective,
      tags,
      response_style: responseStyle,
      memory_mode: memoryMode,
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
    deleteAllChats,
  };
}