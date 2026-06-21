import { API_BASE, getAuthHeaders } from '../config/supabase';

async function safeJson(res) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    throw new Error(`Servidor indisponível (${res.status}). Aguarde alguns segundos e tente novamente.`);
  }
  return res.json();
}

export const api = {
  // ─── Projects ─────────────────────────────────────────────────────────────
  async getProjects() {
    const res = await fetch(`${API_BASE}/projects`, { headers: await getAuthHeaders() });
    return safeJson(res);
  },

  async getProject(id) {
    const res = await fetch(`${API_BASE}/projects/${id}`, { headers: await getAuthHeaders() });
    return safeJson(res);
  },

  async createProject(data, model) {
    const res = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-model': model, ...(await getAuthHeaders()) },
      body: JSON.stringify(data),
    });
    return safeJson(res);
  },

  async updateProject(id, data) {
    const res = await fetch(`${API_BASE}/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
      body: JSON.stringify(data),
    });
    return safeJson(res);
  },

  async deleteProject(id) {
    const res = await fetch(`${API_BASE}/projects/${id}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });
    return safeJson(res);
  },

  // ─── Chats ────────────────────────────────────────────────────────────────
  async createChat(projectId, model) {
    const endpoint = projectId
      ? `${API_BASE}/projects/${projectId}/chats`
      : `${API_BASE}/projects/none/chats`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-model': model, ...(await getAuthHeaders()) },
      body: JSON.stringify({ title: 'Nova conversa' }),
    });
    return safeJson(res);
  },

  async deleteChat(projectId, chatId) {
    const endpoint = projectId
      ? `${API_BASE}/projects/${projectId}/chats/${chatId}`
      : `${API_BASE}/projects/none/chats/${chatId}`;
    const res = await fetch(endpoint, { method: 'DELETE', headers: await getAuthHeaders() });
    return safeJson(res);
  },

  async updateChatTitle(chatId, title) {
    const res = await fetch(`${API_BASE}/chats/${chatId}/title`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
      body: JSON.stringify({ title }),
    });
    return safeJson(res);
  },

  // Lista chats de um projeto com paginação
  async getProjectChats(projectId, { page = 1, limit = 30 } = {}) {
    const url = new URL(`${API_BASE}/projects/${projectId}/chats`);
    url.searchParams.set('page', page);
    url.searchParams.set('limit', limit);
    const res = await fetch(url, { headers: await getAuthHeaders() });
    return safeJson(res);
  },

  // Lista chats avulsos do usuário com paginação
  async getUserChats({ page = 1, limit = 30 } = {}) {
    const url = new URL(`${API_BASE}/user/chats`);
    url.searchParams.set('page', page);
    url.searchParams.set('limit', limit);
    const res = await fetch(url, { headers: await getAuthHeaders() });
    return safeJson(res);
  },

  async deleteAllUserChats() {
    const res = await fetch(`${API_BASE}/user/chats`, { method: 'DELETE', headers: await getAuthHeaders() });
    return safeJson(res);
  },

  // ─── Messages ─────────────────────────────────────────────────────────────
  async getMessages(chatId, { page = 1, limit = 30 } = {}) {
    const url = new URL(`${API_BASE}/messages/chat/${chatId}`);
    url.searchParams.set('page', page);
    url.searchParams.set('limit', limit);
    const res = await fetch(url, { headers: await getAuthHeaders() });
    return safeJson(res);
  },

  // Edita o conteúdo de uma mensagem existente (mantém histórico de versões no backend).
  async editMessage(messageId, content) {
    const res = await fetch(`${API_BASE}/messages/${messageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
      body: JSON.stringify({ content }),
    });
    return safeJson(res);
  },

  /**
   * Envia mensagem via streaming (SSE). Trata eventos granulares de progresso
   * (progress: searching/thinking/generating) além de chunk/title/maxTokens/done/error.
   * onProgress é opcional e não interfere no fluxo já existente.
   */
  async sendMessageStream(
    chatId, projectId, message, _userId, model, codingMode,
    onChunk, onTitle, onError, onDone, onMaxTokens, onProgress
  ) {
    const response = await fetch(`${API_BASE}/messages/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-model': model,
        'x-coding-mode': codingMode ? 'true' : 'false',
        ...(await getAuthHeaders()),
      },
      body: JSON.stringify({ project_id: projectId || null, chat_id: chatId, message }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer     = '';
    let doneCalled = false;

    const safeDone = () => {
      if (!doneCalled) { doneCalled = true; onDone?.(); }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue; // ignora ": heartbeat" / ": processing"
          const data = line.slice(6).trim();
          if (data === '[DONE]') { safeDone(); continue; }
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            // Evento de progresso é mutuamente exclusivo dos demais (payload só tem `progress`)
            if (parsed.progress)                { onProgress?.(parsed.progress); continue; }
            if (parsed.error)                   { onError?.(parsed.error); return; }
            if (parsed.title && parsed.chat_id) onTitle?.(parsed.title, parsed.chat_id);
            if (parsed.chunk)                   onChunk?.(parsed.chunk);
            if (parsed.maxTokens)               onMaxTokens?.();
            if (parsed.done)                    safeDone();
          } catch (e) { console.warn('SSE parse error:', e); }
        }
      }
    } finally {
      safeDone();
    }
  },

  async sendMessageFallback(chatId, projectId, message, _userId, model) {
    const res = await fetch(`${API_BASE}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-model': model, ...(await getAuthHeaders()) },
      body: JSON.stringify({ project_id: projectId || null, chat_id: chatId, message }),
    });
    return safeJson(res);
  },

  // ─── Settings ─────────────────────────────────────────────────────────────
  async getSettings() {
    const res = await fetch(`${API_BASE}/settings`, { headers: await getAuthHeaders() });
    return safeJson(res);
  },

  // Atualização parcial das preferências do usuário (personalidade, notificações,
  // privacidade...). Campos omitidos no objeto `partial` preservam o valor já
  // salvo no backend — não é necessário reenviar tudo a cada chamada.
  async updateSettings(partial) {
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
      body: JSON.stringify(partial),
    });
    return safeJson(res);
  },

  async saveSettings(_userId, personality, customTraits) {
    return this.updateSettings({ personality, custom_traits: customTraits });
  },

  async migrateGuest(guestId, userId) {
    const res = await fetch(`${API_BASE}/migrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_id: guestId, user_id: userId }),
    });
    return safeJson(res);
  },

  // ─── Files ────────────────────────────────────────────────────────────────
  async uploadFile(projectId, file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/files/${projectId}`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: fd,
    });
    return safeJson(res);
  },

  // ─── Sources ──────────────────────────────────────────────────────────────
  async getSources(projectId) {
    const res = await fetch(`${API_BASE}/projects/${projectId}/sources`, { headers: await getAuthHeaders() });
    return safeJson(res);
  },

  async addUrlSource(projectId, url, title) {
    const res = await fetch(`${API_BASE}/projects/${projectId}/sources/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
      body: JSON.stringify({ url, title }),
    });
    return safeJson(res);
  },

  async addTextSource(projectId, content, title) {
    const res = await fetch(`${API_BASE}/projects/${projectId}/sources/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
      body: JSON.stringify({ content, title }),
    });
    return safeJson(res);
  },

  async deleteSource(projectId, sourceId) {
    const res = await fetch(`${API_BASE}/projects/${projectId}/sources/${sourceId}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });
    return safeJson(res);
  },

  // ─── Share ────────────────────────────────────────────────────────────────
  async getSharedChat(chatId) {
    const res = await fetch(`${API_BASE}/share/${chatId}`);
    return safeJson(res);
  },
};