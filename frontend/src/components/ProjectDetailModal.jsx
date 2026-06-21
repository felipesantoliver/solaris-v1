// components/ProjectDetailModal.jsx — Tela dedicada do projeto (3 abas)
//
// Aberta ao clicar no card do projeto (ver ProjectsView/ProjectCard ->
// onOpenDetails). Centraliza em um único lugar:
//   - Aba "Chats": lista TODOS os chats do projeto (GET /projects/:id/chats,
//     reaproveitado via api.getProjectChats), com botão "Novo Chat".
//   - Aba "Fontes": fontes externas (URL/texto) + upload de arquivos,
//     reaproveitando os mesmos endpoints já usados pelo ProjectModal.
//   - Aba "Instruções": preset de personalidade (ou "Personalizado", com
//     textarea livre) + instruções persistentes do projeto. Salva via
//     PATCH /projects/:id (já suporta response_style + instructions).
//
// Este componente busca seus próprios dados (chats/fontes/arquivos) de forma
// independente do estado global da Sidebar — evita poluir o chatHistory que
// a Sidebar exibe para o projeto/contexto atualmente ativo, já que o usuário
// pode estar olhando os detalhes de um projeto diferente do que está aberto
// no chat principal.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Save, Loader2, Check, Globe, FileText, Trash2, Plus, MessageSquare,
  Pin, Upload, AlertTriangle, File as FileIcon,
} from 'lucide-react';
import { api } from '../services/api';

// Mesmos 7 presets de domain/ai/prompt.js (PERSONALITY_GUIDE) no backend —
// fonte de verdade fica lá; aqui só replicamos rótulo/descrição para a UI.
// "Personalizado" não é um preset real: é um modo de UI que libera o textarea
// livre — o valor enviado ao backend é o texto digitado, não a string
// "personalizado" (o backend trata qualquer string fora dos presets abaixo
// como texto livre e o otimiza automaticamente).
const PERSONALITY_PRESETS = [
  { id: 'direto', label: 'Direto', desc: 'Respostas curtas e objetivas, sem rodeios.' },
  { id: 'tecnico', label: 'Técnico', desc: 'Terminologia precisa e detalhes de implementação.' },
  { id: 'analitico', label: 'Analítico', desc: 'Análise profunda, prós e contras.' },
  { id: 'estrategico', label: 'Estratégico', desc: 'Visão macro, planejamento e longo prazo.' },
  { id: 'sarcastico', label: 'Sarcástico', desc: 'Irônico e ácido, mas sempre útil.' },
  { id: 'bem_humorado', label: 'Bem-humorado', desc: 'Descontraído, com analogias divertidas.' },
  { id: 'empatico', label: 'Empático', desc: 'Caloroso, acolhedor e encorajador.' },
];
const PRESET_KEYS = PERSONALITY_PRESETS.map(p => p.id);

// Mesma whitelist de extensões aceita pelo backend (domain/routers/files.js
// ALLOWED_EXTS) — mantém o seletor de arquivo do navegador alinhado com o
// que realmente vai ser aceito no upload.
const ALLOWED_FILE_EXTS = '.pdf,.txt,.md,.json,.js,.ts,.py,.css,.html,.csv';
// Mesmo limite do backend (MAX_FILE_SIZE) — checagem só para feedback
// imediato ao usuário; o backend é quem de fato garante o limite.
const MAX_FILE_SIZE_MB = 10;

function formatDateTime(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProjectDetailModal({ project, onClose, onUpdateProject, onOpenChat, darkMode }) {
  const [activeTab, setActiveTab] = useState('chats');

  // ─── Aba "Chats" ──────────────────────────────────────────────────────────
  const [chats, setChats] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [chatsError, setChatsError] = useState('');
  const [chatsPage, setChatsPage] = useState(1);
  const [chatsHasMore, setChatsHasMore] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);

  // ─── Aba "Fontes" ─────────────────────────────────────────────────────────
  const [sources, setSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newUrlTitle, setNewUrlTitle] = useState('');
  const [newText, setNewText] = useState('');
  const [newTextTitle, setNewTextTitle] = useState('');
  const [addingSource, setAddingSource] = useState(false);
  const [sourcesError, setSourcesError] = useState('');
  const [uploadStatus, setUploadStatus] = useState(null);
  const fileInputRef = useRef(null);

  // ─── Aba "Instruções" ─────────────────────────────────────────────────────
  const [styleMode, setStyleMode] = useState('preset'); // 'preset' | 'personalizado'
  const [presetValue, setPresetValue] = useState('direto');
  const [customText, setCustomText] = useState('');
  const [instructions, setInstructions] = useState('');
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [savedInstructions, setSavedInstructions] = useState(false);
  const [instructionsError, setInstructionsError] = useState('');

  const t = {
    bg: darkMode ? 'bg-[#1a1a1a]' : 'bg-white',
    border: darkMode ? 'border-white/10' : 'border-black/8',
    muted: darkMode ? 'text-white/40' : 'text-black/50',
    text: darkMode ? 'text-white/80' : 'text-black/80',
    input: darkMode ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-black/3 border-black/10 text-black placeholder-black/30',
    btn: darkMode ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/90',
    btnOutline: darkMode ? 'border-white/20 hover:bg-white/5' : 'border-black/20 hover:bg-black/5',
    card: darkMode ? 'border-white/10 hover:border-white/20' : 'border-black/8 hover:border-black/15',
  };

  // ─── Carregamento: Chats ──────────────────────────────────────────────────
  const fetchChats = useCallback(async (reset = false) => {
    if (!project) return;
    setChatsLoading(true);
    setChatsError('');
    try {
      const targetPage = reset ? 1 : chatsPage;
      const res = await api.getProjectChats(project.id, { page: targetPage, limit: 30 });
      const data = Array.isArray(res?.data) ? res.data : [];
      setChats(prev => (reset ? data : [...prev, ...data]));
      setChatsHasMore(!!res?.hasMore);
      setChatsPage(targetPage + 1);
    } catch (err) {
      setChatsError('Não foi possível carregar os chats deste projeto.');
    } finally {
      setChatsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // ─── Carregamento: Fontes + Arquivos ──────────────────────────────────────
  const fetchSources = useCallback(async () => {
    if (!project) return;
    setSourcesLoading(true);
    try {
      const data = await api.getSources(project.id);
      setSources(Array.isArray(data) ? data : []);
    } catch (err) {
      setSourcesError('Não foi possível carregar as fontes externas.');
    } finally {
      setSourcesLoading(false);
    }
  }, [project?.id]);

  const fetchFiles = useCallback(async () => {
    if (!project) return;
    setFilesLoading(true);
    try {
      const data = await api.getProjectFiles(project.id);
      setFiles(Array.isArray(data) ? data : []);
    } catch (err) {
      // Mantém a lista anterior em caso de falha pontual — não é crítico.
    } finally {
      setFilesLoading(false);
    }
  }, [project?.id]);

  // Busca os dados da aba só quando ela é aberta pela primeira vez para este
  // projeto (evita refetch a cada troca de aba, mas garante dados frescos ao
  // abrir um projeto diferente).
  useEffect(() => {
    if (!project) return;
    if (activeTab === 'chats') fetchChats(true);
    if (activeTab === 'fontes') { fetchSources(); fetchFiles(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, project?.id]);

  // Reinicializa o formulário de "Instruções" sempre que o projeto exibido
  // muda — mas não a cada atualização de campo do próprio `project` (ex.:
  // depois de salvar), para não sobrescrever o que o usuário está editando.
  useEffect(() => {
    if (!project) return;
    const rs = (project.response_style || '').trim();
    if (!rs || PRESET_KEYS.includes(rs)) {
      setStyleMode('preset');
      setPresetValue(rs || 'direto');
      setCustomText('');
    } else {
      setStyleMode('personalizado');
      setCustomText(rs);
      setPresetValue('direto');
    }
    setInstructions(project.instructions || '');
    setInstructionsError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  if (!project) return null;

  // ─── Ações: Chats ─────────────────────────────────────────────────────────
  async function handleCreateChat() {
    setCreatingChat(true);
    setChatsError('');
    try {
      // x-model aqui não importa para esta rota (POST /projects/:id/chats
      // não lê o header) — o modelo efetivo do chat é resolvido por
      // resolveModelForRequest a partir de project.gemini_version.
      const newChat = await api.createChat(project.id, 'flash');
      onOpenChat(project.id, newChat.id);
    } catch (err) {
      setChatsError('Não foi possível criar um novo chat.');
    } finally {
      setCreatingChat(false);
    }
  }

  // ─── Ações: Fontes ────────────────────────────────────────────────────────
  async function addUrlSource() {
    if (!newUrl.trim()) return;
    setAddingSource(true);
    setSourcesError('');
    try {
      await api.addUrlSource(project.id, newUrl.trim(), newUrlTitle.trim() || undefined);
      await fetchSources();
      setNewUrl(''); setNewUrlTitle('');
    } catch (err) {
      setSourcesError(err.message || 'Não foi possível adicionar a URL.');
    }
    setAddingSource(false);
  }

  async function addTextSource() {
    if (!newText.trim()) return;
    setAddingSource(true);
    setSourcesError('');
    try {
      await api.addTextSource(project.id, newText.trim(), newTextTitle.trim() || 'Texto adicionado');
      await fetchSources();
      setNewText(''); setNewTextTitle('');
    } catch (err) {
      setSourcesError(err.message || 'Não foi possível adicionar o texto.');
    }
    setAddingSource(false);
  }

  async function deleteSource(sourceId) {
    if (!confirm('Remover esta fonte?')) return;
    try {
      await api.deleteSource(project.id, sourceId);
      await fetchSources();
    } catch (err) {
      setSourcesError(err.message || 'Não foi possível remover a fonte.');
    }
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setUploadStatus({ type: 'error', message: `Arquivo muito grande. Máximo: ${MAX_FILE_SIZE_MB}MB.` });
      setTimeout(() => setUploadStatus(null), 4000);
      return;
    }
    setUploadStatus({ type: 'uploading', message: `Enviando ${file.name}...` });
    try {
      await api.uploadFile(project.id, file);
      setUploadStatus({ type: 'success', message: `${file.name} enviado com sucesso!` });
      await fetchFiles();
      setTimeout(() => setUploadStatus(null), 3000);
    } catch (err) {
      setUploadStatus({ type: 'error', message: err.message || `Erro ao enviar ${file.name}` });
      setTimeout(() => setUploadStatus(null), 4000);
    }
  }

  async function deleteFile(fileId) {
    if (!confirm('Remover este arquivo?')) return;
    try {
      await api.deleteProjectFile(project.id, fileId);
      await fetchFiles();
    } catch (err) {
      setUploadStatus({ type: 'error', message: 'Não foi possível remover o arquivo.' });
      setTimeout(() => setUploadStatus(null), 4000);
    }
  }

  // ─── Ações: Instruções ────────────────────────────────────────────────────
  async function handleSaveInstructions() {
    setInstructionsError('');
    if (styleMode === 'personalizado' && !customText.trim()) {
      setInstructionsError('Escreva uma instrução de estilo personalizada, ou escolha um preset acima.');
      return;
    }
    setSavingInstructions(true);
    try {
      const finalResponseStyle = styleMode === 'personalizado' ? customText.trim() : presetValue;
      await onUpdateProject(project.id, { response_style: finalResponseStyle, instructions });
      setSavedInstructions(true);
      setTimeout(() => setSavedInstructions(false), 2000);
    } catch (err) {
      setInstructionsError(err.message || 'Não foi possível salvar as instruções.');
    } finally {
      setSavingInstructions(false);
    }
  }

  const tabs = [
    { id: 'chats', label: 'Chats' },
    { id: 'fontes', label: 'Fontes' },
    { id: 'instrucoes', label: 'Instruções' },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className={`${t.bg} border ${t.border} w-full h-full sm:h-[88vh] sm:max-w-5xl sm:rounded-2xl shadow-2xl flex flex-col`}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-current/10 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-medium truncate">{project.name}</h2>
            {project.summary && <p className={`text-xs mt-0.5 truncate ${t.muted}`}>{project.summary}</p>}
          </div>
          <button onClick={onClose} className={`${t.muted} hover:text-current shrink-0 ml-4`}>
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-current/10 shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-3 text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? (darkMode ? 'border-b-2 border-white text-white' : 'border-b-2 border-black text-black')
                  : t.muted
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
          {/* ── Aba Chats ───────────────────────────────────────────────── */}
          {activeTab === 'chats' && (
            <div className="space-y-4">
              <button
                onClick={handleCreateChat}
                disabled={creatingChat}
                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${t.btn}`}
              >
                {creatingChat ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                Novo Chat
              </button>

              {chatsError && <p className="text-red-400 text-xs">{chatsError}</p>}

              {chats.length === 0 && !chatsLoading ? (
                <p className={`text-sm ${t.muted}`}>Nenhum chat neste projeto ainda. Crie o primeiro acima.</p>
              ) : (
                <div className="space-y-2">
                  {chats.map(chat => (
                    <div
                      key={chat.id}
                      onClick={() => onOpenChat(project.id, chat.id)}
                      className={`flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${t.card}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {chat.pinned ? (
                          <Pin size={15} className="shrink-0 text-amber-400 fill-amber-400/30" />
                        ) : (
                          <MessageSquare size={15} className={`shrink-0 ${t.muted}`} />
                        )}
                        <span className={`text-sm truncate ${t.text}`}>{chat.title || 'Nova conversa'}</span>
                      </div>
                      <span className={`text-[11px] shrink-0 ${t.muted}`}>{formatDateTime(chat.updated_at)}</span>
                    </div>
                  ))}
                </div>
              )}

              {chatsHasMore && (
                <button
                  onClick={() => fetchChats(false)}
                  disabled={chatsLoading}
                  className={`w-full py-2.5 rounded-xl border text-sm transition-all flex items-center justify-center gap-2 ${t.btnOutline} ${t.muted}`}
                >
                  {chatsLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                  Carregar mais
                </button>
              )}
              {chatsLoading && chats.length === 0 && (
                <div className="flex justify-center py-6"><Loader2 size={20} className={`animate-spin ${t.muted}`} /></div>
              )}
            </div>
          )}

          {/* ── Aba Fontes ──────────────────────────────────────────────── */}
          {activeTab === 'fontes' && (
            <div className="space-y-8">
              {/* Upload de arquivos */}
              <div>
                <h3 className="text-sm font-medium mb-2">Arquivos</h3>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept={ALLOWED_FILE_EXTS}
                  onChange={handleFileSelect}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm transition-all ${t.btnOutline}`}
                >
                  <Upload size={15} />
                  Anexar arquivo (PDF, TXT, MD...)
                </button>

                {uploadStatus && (
                  <p className={`flex items-center gap-1.5 text-xs mt-2 ${
                    uploadStatus.type === 'error' ? 'text-red-400' :
                    uploadStatus.type === 'success' ? 'text-emerald-400' : 'text-amber-400'
                  }`}>
                    {uploadStatus.type === 'uploading' && <Loader2 size={12} className="animate-spin" />}
                    {uploadStatus.type === 'success' && <Check size={12} />}
                    {uploadStatus.type === 'error' && <AlertTriangle size={12} />}
                    {uploadStatus.message}
                  </p>
                )}

                <div className="mt-3 space-y-2">
                  {filesLoading && files.length === 0 ? (
                    <p className={`text-xs ${t.muted}`}>Carregando arquivos...</p>
                  ) : files.length === 0 ? (
                    <p className={`text-xs ${t.muted}`}>Nenhum arquivo anexado a este projeto.</p>
                  ) : (
                    files.map(f => (
                      <div key={f.id} className={`flex items-center justify-between p-3 rounded-xl border ${t.border}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="p-1 rounded-lg bg-current/10 shrink-0"><FileIcon size={14} /></div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{f.original_name}</p>
                            <p className={`text-xs ${t.muted}`}>{formatFileSize(f.size)} · {formatDateTime(f.created_at)}</p>
                          </div>
                        </div>
                        <button onClick={() => deleteFile(f.id)} className="text-red-400 hover:text-red-500 shrink-0 ml-2"><Trash2 size={14} /></button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Fontes externas (URL / texto) */}
              <div>
                <h3 className="text-sm font-medium mb-2">Adicionar fonte externa</h3>
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input type="text" placeholder="URL (ex: https://...)" value={newUrl} onChange={e => setNewUrl(e.target.value)} className={`flex-1 px-4 py-2 rounded-xl border ${t.input}`} />
                    <input type="text" placeholder="Título (opcional)" value={newUrlTitle} onChange={e => setNewUrlTitle(e.target.value)} className={`flex-1 px-4 py-2 rounded-xl border ${t.input}`} />
                    <button onClick={addUrlSource} disabled={addingSource} className={`px-4 py-2 rounded-xl border shrink-0 ${t.btnOutline}`}>{addingSource ? <Loader2 size={16} className="animate-spin" /> : <Globe size={16} />}</button>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <textarea placeholder="Cole o texto aqui..." value={newText} onChange={e => setNewText(e.target.value)} rows={2} className={`flex-1 px-4 py-2 rounded-xl border ${t.input}`} />
                    <div className="flex sm:flex-col gap-2 sm:gap-0">
                      <input type="text" placeholder="Título" value={newTextTitle} onChange={e => setNewTextTitle(e.target.value)} className={`flex-1 sm:w-full sm:mb-2 px-4 py-2 rounded-xl border ${t.input}`} />
                      <button onClick={addTextSource} disabled={addingSource} className={`px-4 sm:w-full py-2 rounded-xl border shrink-0 ${t.btnOutline}`}>{addingSource ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}</button>
                    </div>
                  </div>
                  {sourcesError && <p className="text-red-400 text-xs">{sourcesError}</p>}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">Fontes atuais</h3>
                {sourcesLoading && sources.length === 0 ? (
                  <p className={`text-xs ${t.muted}`}>Carregando fontes...</p>
                ) : sources.length === 0 ? (
                  <p className={`text-xs ${t.muted}`}>Nenhuma fonte externa adicionada.</p>
                ) : (
                  <div className="space-y-2">
                    {sources.map(s => (
                      <div key={s.id} className={`flex items-center justify-between gap-2 p-3 rounded-xl border ${t.border}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="p-1 rounded-lg bg-current/10 shrink-0">{s.type === 'url' ? <Globe size={14} /> : <FileText size={14} />}</div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{s.title || (s.type === 'url' ? s.url : 'Texto')}</p>
                            <p className={`text-xs truncate ${t.muted}`}>{s.type === 'url' ? s.url : `${s.content?.substring(0, 60)}...`}</p>
                          </div>
                        </div>
                        <button onClick={() => deleteSource(s.id)} className="text-red-400 hover:text-red-500 shrink-0"><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Aba Instruções ──────────────────────────────────────────── */}
          {activeTab === 'instrucoes' && (
            <div className="space-y-5">
              <div>
                <label className={`text-xs uppercase tracking-wider ${t.muted}`}>Estilo de fala / Persona</label>
                <select
                  value={styleMode === 'personalizado' ? 'personalizado' : presetValue}
                  onChange={e => {
                    if (e.target.value === 'personalizado') setStyleMode('personalizado');
                    else { setStyleMode('preset'); setPresetValue(e.target.value); }
                  }}
                  className={`w-full mt-1 px-4 py-2 rounded-xl border ${t.input}`}
                >
                  {PERSONALITY_PRESETS.map(p => (<option key={p.id} value={p.id}>{p.label}</option>))}
                  <option value="personalizado">Personalizado</option>
                </select>
                {styleMode === 'preset' ? (
                  <p className={`text-[11px] mt-1.5 ${t.muted}`}>
                    {PERSONALITY_PRESETS.find(p => p.id === presetValue)?.desc}
                  </p>
                ) : (
                  <div className="mt-2">
                    <textarea
                      value={customText}
                      onChange={e => setCustomText(e.target.value)}
                      rows={3}
                      maxLength={1000}
                      className={`w-full px-4 py-2.5 rounded-xl border resize-none ${t.input}`}
                      placeholder="Descreva como o assistente deve se comunicar neste projeto..."
                    />
                    <p className={`text-[10px] mt-1 ${t.muted}`}>
                      O texto é otimizado automaticamente para um resumo mais compacto ao salvar.
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className={`text-xs uppercase tracking-wider ${t.muted}`}>Instruções personalizadas (System Prompt)</label>
                <p className={`text-[10px] mt-1 mb-1.5 ${t.muted}`}>
                  Contexto persistente que o assistente usará em todos os chats deste projeto (injetado no system prompt).
                </p>
                <textarea
                  value={instructions}
                  onChange={e => setInstructions(e.target.value)}
                  rows={10}
                  className={`w-full px-4 py-3 rounded-xl border resize-none ${t.input}`}
                  placeholder="Ex: Você é um assistente especialista em startups de tecnologia. Sempre responda de forma objetiva e com foco em crescimento..."
                />
              </div>

              {instructionsError && <p className="text-red-400 text-xs">{instructionsError}</p>}
              <button
                onClick={handleSaveInstructions}
                disabled={savingInstructions}
                className={`w-full py-3 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${t.btn}`}
              >
                {savingInstructions ? <Loader2 size={16} className="animate-spin" /> : savedInstructions ? <Check size={16} /> : <Save size={16} />}
                {savedInstructions ? 'Salvo!' : 'Salvar alterações'}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-current/10 flex justify-end shrink-0">
          <button onClick={onClose} className={`px-6 py-2 rounded-xl border ${t.btnOutline}`}>Fechar</button>
        </div>
      </div>
    </div>
  );
}