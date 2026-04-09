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
      const data = await api.getProjects(effectiveUserId);
      setProjects(Array.isArray(data) ? data : []);
    } catch {
      setProjects([]);
    }
  }, [effectiveUserId]);

  const fetchNoProjectChats = useCallback(async () => {
    if (!effectiveUserId) return;
    try {
      const data = await api.getUserChats(effectiveUserId);
      if (!activeProjectId) setChatHistory(Array.isArray(data) ? data : []);
    } catch {}
  }, [effectiveUserId, activeProjectId]);

  useEffect(() => {
    fetchProjects();
    fetchNoProjectChats();
  }, [fetchProjects, fetchNoProjectChats]);

  const loadProjectChats = useCallback(async (projectId) => {
    if (!projectId) {
      setActiveChatId(null);
      setChatHistory([]);
      return;
    }
    try {
      const project = await api.getProject(projectId, effectiveUserId);
      setChatHistory(project.chats || []);
    } catch {
      setChatHistory([]);
    }
  }, [effectiveUserId]);

  const createProject = useCallback(async (name, summary = '', detailedObjective = '', tags = [], responseStyle = 'direto', memoryMode = 'projeto') => {
    const newProject = await api.createProject({
      name,
      summary,
      detailed_objective: detailedObjective,
      tags,
      response_style: responseStyle,
      memory_mode: memoryMode,
    }, effectiveUserId, authUser ? model : 'flash');
    setProjects(prev => [newProject, ...prev]);
    setActiveProjectId(newProject.id);
    return newProject;
  }, [effectiveUserId, authUser, model]);

  const updateProject = useCallback(async (id, updates) => {
    const updated = await api.updateProject(id, updates, effectiveUserId);
    setProjects(prev => prev.map(p => p.id === id ? updated : p));
    return updated;
  }, [effectiveUserId]);

  const deleteProject = useCallback(async (id) => {
    await api.deleteProject(id, effectiveUserId);
    setProjects(prev => prev.filter(p => p.id !== id));
    if (activeProjectId === id) {
      setActiveProjectId(null);
      setChatHistory([]);
    }
  }, [effectiveUserId, activeProjectId]);

  const createChatInProject = useCallback(async (projectId) => {
    const newChat = await api.createChat(projectId, effectiveUserId, authUser ? model : 'flash');
    setChatHistory(prev => [newChat, ...prev]);
    return newChat;
  }, [effectiveUserId, authUser, model]);

  const deleteChat = useCallback(async (projectId, chatId) => {
    await api.deleteChat(projectId, chatId, effectiveUserId);
    setChatHistory(prev => prev.filter(c => c.id !== chatId));
  }, [effectiveUserId]);

  const updateChatTitle = useCallback(async (chatId, title) => {
    const result = await api.updateChatTitle(chatId, title, effectiveUserId);
    setChatHistory(prev => prev.map(c => c.id === chatId ? { ...c, title: result.title } : c));
    return result;
  }, [effectiveUserId]);

  const deleteAllChats = useCallback(async () => {
    const result = await api.deleteAllUserChats(effectiveUserId);
    setChatHistory([]);
    return result;
  }, [effectiveUserId]);

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