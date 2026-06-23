// frontend/src/hooks/useProjects.js
//
// Hook principal de gerenciamento de projetos e conversas.
// Centraliza todo o estado e logica de manipulacao de projetos,
// chats e suas operacoes (CRUD, arquivar, fixar, mover, renomear).
//
// Responsabilidades:
//   - Buscar e manter lista de projetos do usuario
//   - Buscar e manter historico de chats (do projeto ativo ou avulsos)
//   - Sincronizar estado local com o backend apos cada operacao
//   - Reordenar chats localmente (fixados primeiro, depois por data)
//   - Escutar eventos globais (ex: titulo gerado via SSE) para atualizar UI
//
// Dependencias:
//   - api.js: cliente HTTP centralizado para todas as chamadas ao backend
//
// Agrupamento logico:
//   1. Funcoes auxiliares
//   2. Estado e fetch inicial
//   3. Efeitos colaterais (useEffect)
//   4. Operacoes de projeto (CRUD)
//   5. Operacoes de chat (CRUD, arquivar, fixar, mover)
//   6. Retorno do hook

import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

// ---------------------------------------------------------------------------
// 1. FUNCOES AUXILIARES
// ---------------------------------------------------------------------------

/**
 * Ordena a lista de chats aplicando a mesma regra do backend:
 * 1. Chats fixados (pinned) primeiro
 * 2. Dentro de cada grupo, ordena por updated_at decrescente (mais recentes)
 *
 * Usada para reordenar localmente apos operacoes de fixar/desafixar,
 * evitando uma chamada extra ao servidor apenas para reordenacao.
 * O backend ja retorna os chats na ordem correta em listagens normais;
 * esta funcao existe apenas para atualizacoes otimistas locais.
 *
 * @param {Array} list - Array de objetos chat (cada um com id, pinned, updated_at)
 * @returns {Array} Nova array ordenada (nao modifica a original)
 */
function sortChats(list) {
  return [...list].sort((a, b) => {
    const pa = a.pinned ? 1 : 0, pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
  });
}

// ---------------------------------------------------------------------------
// 2. ESTADO E FETCH INICIAL
// ---------------------------------------------------------------------------

export function useProjects(effectiveUserId, authUser, model) {
  // Lista de projetos do usuario (sidebar esquerda)
  const [projects, setProjects] = useState([]);

  // ID do projeto atualmente selecionado.
  // null = nenhum projeto selecionado (mostra chats avulsos).
  const [activeProjectId, setActiveProjectId] = useState(null);

  // Historico de chats exibido na sidebar:
  // - Se activeProjectId != null: chats do projeto ativo
  // - Se activeProjectId == null: chats avulsos (sem projeto)
  const [chatHistory, setChatHistory] = useState([]);

  // Estado de carregamento.
  // NOTA: atualmente nunca definido como true internamente.
  // Exportado para componentes consumidores que queiram mostrar
  // skeleton/loader enquanto carregam.
  // TODO: integrar setLoading nas chamadas async se uma UI de skeleton
  // for adicionada a sidebar.
  const [loading] = useState(false);

  /**
   * Busca todos os projetos do usuario.
   * Chamado na montagem do hook e quando effectiveUserId muda.
   * Em caso de erro, define array vazio para evitar UI quebrada.
   */
  const fetchProjects = useCallback(async () => {
    if (!effectiveUserId) return;
    try {
      const data = await api.getProjects();
      setProjects(Array.isArray(data) ? data : []);
    } catch {
      setProjects([]);
    }
  }, [effectiveUserId]);

  /**
   * Busca chats avulsos (sem projeto vinculado).
   * api.getUserChats() retorna um envelope paginado:
   * { data, total, page, limit, hasMore }
   * por isso sempre desestruturamos res.data, nao usamos o objeto completo.
   * So atualiza o estado se nenhum projeto estiver ativo (evita flicker).
   */
  const fetchNoProjectChats = useCallback(async () => {
    if (!effectiveUserId) return;
    try {
      const res = await api.getUserChats();
      if (!activeProjectId) setChatHistory(Array.isArray(res?.data) ? res.data : []);
    } catch {}
  }, [effectiveUserId, activeProjectId]);

  // -------------------------------------------------------------------------
  // 3. EFEITOS COLATERAIS (useEffect)
  // -------------------------------------------------------------------------

  // Busca inicial: projetos + chats avulsos quando o usuario muda
  useEffect(() => {
    fetchProjects();
    fetchNoProjectChats();
  }, [fetchProjects, fetchNoProjectChats]);

  /**
   * Carrega os chats de um projeto especifico.
   * Chamado quando o usuario seleciona um projeto na sidebar.
   *
   * @param {string|null} projectId - ID do projeto ou null (limpa o historico)
   */
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

  // Quando activeProjectId muda, carrega os chats correspondentes.
  // Se for null (nenhum projeto), carrega chats avulsos.
  useEffect(() => {
    if (activeProjectId) {
      loadProjectChats(activeProjectId);
    } else {
      fetchNoProjectChats();
    }
  }, [activeProjectId, loadProjectChats, fetchNoProjectChats]);

  /**
   * Escuta o evento global 'solaris:chat-title' para atualizar o titulo
   * de um chat na sidebar em tempo real, sem recarregar a pagina.
   *
   * Fluxo:
   * 1. Backend emite titulo gerado via SSE apos primeira mensagem
   * 2. ChatWindow ou MessageInput dispara evento global com title e chat_id
   * 3. Este listener atualiza o estado local, refletindo na sidebar
   *
   * Se o chat ainda nao estiver no historico (ex: foi criado mas a lista
   * ainda nao recarregou), adiciona ele no topo da lista com o titulo novo.
   */
  useEffect(() => {
    const handler = (e) => {
      const { title, chat_id } = e.detail || {};
      if (!title || !chat_id) return;
      setChatHistory(prev => {
        // Atualiza titulo se o chat ja existe na lista
        if (prev.some(c => c.id === chat_id)) {
          return prev.map(c => c.id === chat_id ? { ...c, title } : c);
        }
        // Adiciona novo chat no topo se ainda nao estava na lista
        return [{ id: chat_id, title }, ...prev];
      });
    };
    window.addEventListener('solaris:chat-title', handler);
    return () => window.removeEventListener('solaris:chat-title', handler);
  }, []);

  // -------------------------------------------------------------------------
  // 4. OPERACOES DE PROJETO (CRUD)
  // -------------------------------------------------------------------------

  /**
   * Cria um novo projeto e define como ativo.
   *
   * @param {string}   name                 - Nome do projeto
   * @param {string}   summary              - Resumo/descricao curta
   * @param {string}   detailedObjective    - Objetivo detalhado
   * @param {string[]} tags                 - Tags para categorizacao
   * @param {string}   responseStyle        - Preset de personalidade ou texto livre
   * @param {string}   memoryMode           - Modo de memoria: 'projeto', 'global', 'nenhuma'
   * @param {string}   instructions         - Instrucoes/traits personalizados
   * @param {boolean}  sharedMemoryEnabled  - Se memorias sao compartilhadas entre projetos
   * @returns {Promise<Object>} O projeto criado (retornado pelo backend)
   */
  const createProject = useCallback(async (
    name, summary = '', detailedObjective = '', tags = [],
    responseStyle = 'direto', memoryMode = 'projeto',
    instructions = '', sharedMemoryEnabled = false,
  ) => {
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
    // Adiciona no topo da lista e seleciona como ativo
    setProjects(prev => [newProject, ...prev]);
    setActiveProjectId(newProject.id);
    return newProject;
  }, [authUser, model]);

  /**
   * Atualiza um projeto existente.
   * Substitui o projeto na lista local com os dados retornados pelo backend.
   *
   * @param {string} id      - ID do projeto
   * @param {Object} updates - Campos a serem atualizados (parcial)
   * @returns {Promise<Object>} Projeto atualizado
   */
  const updateProject = useCallback(async (id, updates) => {
    const updated = await api.updateProject(id, updates);
    setProjects(prev => prev.map(p => p.id === id ? updated : p));
    return updated;
  }, []);

  /**
   * Exclui um projeto.
   * Remove da lista local. Se o projeto excluido era o ativo,
   * volta para a visao de chats avulsos e limpa o historico.
   *
   * @param {string} id - ID do projeto a ser excluido
   */
  const deleteProject = useCallback(async (id) => {
    await api.deleteProject(id);
    setProjects(prev => prev.filter(p => p.id !== id));
    if (activeProjectId === id) {
      setActiveProjectId(null);
      setChatHistory([]);
    }
  }, [activeProjectId]);

  // -------------------------------------------------------------------------
  // 5. OPERACOES DE CHAT (CRUD, ARQUIVAR, FIXAR, MOVER)
  // -------------------------------------------------------------------------

  /**
   * Cria uma nova conversa dentro de um projeto.
   * A conversa e adicionada no topo do historico local.
   *
   * @param {string} projectId - ID do projeto (ou 'none' para chat avulso)
   * @returns {Promise<Object>} O chat criado
   */
  const createChatInProject = useCallback(async (projectId) => {
    const newChat = await api.createChat(projectId, authUser ? model : 'flash');
    setChatHistory(prev => [newChat, ...prev]);
    return newChat;
  }, [authUser, model]);

  /**
   * Exclui uma conversa (soft delete no backend).
   * Remove da lista local imediatamente.
   *
   * @param {string} projectId - ID do projeto
   * @param {string} chatId    - ID do chat a ser excluido
   */
  const deleteChat = useCallback(async (projectId, chatId) => {
    await api.deleteChat(projectId, chatId);
    setChatHistory(prev => prev.filter(c => c.id !== chatId));
  }, []);

  /**
   * Atualiza o titulo de uma conversa.
   * Reflete a mudanca imediatamente no estado local.
   *
   * @param {string} chatId - ID do chat
   * @param {string} title  - Novo titulo
   * @returns {Promise<Object>} Resultado da API (contem o titulo normalizado)
   */
  const updateChatTitle = useCallback(async (chatId, title) => {
    const result = await api.updateChatTitle(chatId, title);
    setChatHistory(prev => prev.map(c => c.id === chatId ? { ...c, title: result.title } : c));
    return result;
  }, []);

  /**
   * Arquiva ou desarquiva uma conversa.
   * Remove da listagem atual (para recuperar, usar include_archived=true).
   * Uma secao "Arquivados" na UI pode re-buscar com esse parametro.
   *
   * @param {string}  chatId   - ID do chat
   * @param {boolean} archived - true para arquivar, false para desarquivar
   * @returns {Promise<Object>} Chat atualizado
   */
  const archiveChat = useCallback(async (chatId, archived = true) => {
    const updated = await api.archiveChat(chatId, archived);
    setChatHistory(prev => prev.filter(c => c.id !== chatId));
    return updated;
  }, []);

  /**
   * Fixa ou desafixa uma conversa no topo da sidebar.
   * Reordena a lista localmente usando sortChats() sem chamada extra ao servidor.
   * A ordem e: fixados primeiro, depois por updated_at decrescente.
   *
   * @param {string}  chatId - ID do chat
   * @param {boolean} pinned - true para fixar, false para desafixar
   * @returns {Promise<Object>} Chat atualizado
   */
  const pinChat = useCallback(async (chatId, pinned = true) => {
    const updated = await api.pinChat(chatId, pinned);
    setChatHistory(prev => sortChats(prev.map(c => c.id === chatId ? { ...c, ...updated } : c)));
    return updated;
  }, []);

  /**
   * Move uma conversa para outro projeto ou a desvincula de qualquer projeto.
   *
   * Remove o chat da visualizacao atual imediatamente se ele nao pertence
   * mais ao contexto ativo (ex: moveu para outro projeto enquanto esta
   * visualizando os chats do projeto de origem, ou moveu para um projeto
   * enquanto esta na visao de chats avulsos).
   *
   * @param {string}      chatId          - ID do chat
   * @param {string|null} targetProjectId - ID do projeto destino (null = avulso)
   * @returns {Promise<Object>} Chat atualizado
   */
  const moveChatToProject = useCallback(async (chatId, targetProjectId) => {
    const normalizedTarget = targetProjectId || null;
    const updated = await api.moveChat(chatId, normalizedTarget);
    setChatHistory(prev => {
      // Verifica se o chat ainda pertence ao contexto ativo
      const stillBelongsHere = normalizedTarget === (activeProjectId || null);
      if (!stillBelongsHere) return prev.filter(c => c.id !== chatId);
      return prev.map(c => c.id === chatId ? { ...c, ...updated } : c);
    });
    return updated;
  }, [activeProjectId]);

  /**
   * Exclui permanentemente TODOS os chats avulsos do usuario.
   * Usado pela acao "limpar tudo" nas configuracoes.
   * Hard delete: nao ha recuperacao via soft delete.
   *
   * @returns {Promise<Object>} Resultado da API (contem contagem de deletados)
   */
  const deleteAllChats = useCallback(async () => {
    const result = await api.deleteAllUserChats();
    setChatHistory([]);
    return result;
  }, []);

  // -------------------------------------------------------------------------
  // 6. RETORNO DO HOOK
  // -------------------------------------------------------------------------

  return {
    // Estado
    projects,
    activeProjectId,
    setActiveProjectId,
    chatHistory,
    setChatHistory,
    loading,

    // Fetch
    fetchProjects,
    fetchNoProjectChats,
    loadProjectChats,

    // Projetos
    createProject,
    updateProject,
    deleteProject,

    // Chats
    createChatInProject,
    deleteChat,
    updateChatTitle,
    archiveChat,
    pinChat,
    moveChatToProject,
    deleteAllChats,
  };
}