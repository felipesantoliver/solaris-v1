import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Moon, Sun, LogOut, LogIn, Settings, Share2, PanelLeft, Star
} from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { useProjects } from './hooks/useProjects';
import { useChat } from './hooks/useChat';
import { api } from './services/api';
import { Sidebar } from './components/Sidebar';
import { ChatWindow } from './components/ChatWindow';
import { MessageInput } from './components/MessageInput';
import { ProjectModal } from './components/ProjectModal';
import { ProjectsView } from './components/ProjectsView';
import { SettingsModal } from './components/SettingsModal';
import { AuthModal } from './components/AuthModal';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { ShareModal } from './components/ui/ShareModal';

export default function App() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('solaris_dark') !== 'false');
  const [programmingMode, setProgrammingMode] = useState(() => localStorage.getItem('solaris_programming_mode') === 'true');
  const [model, setModel] = useState('flash');
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [draggedItemId, setDraggedItemId] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [editingChatTitleId, setEditingChatTitleId] = useState(null);
  const [editingChatTitleValue, setEditingChatTitleValue] = useState('');
  const [showShareModal, setShowShareModal] = useState(false);
  const [activeView, setActiveView] = useState('chat');
  const [input, setInput] = useState('');

  const fileInputRef = useRef(null);
  const moreProjectsRef = useRef(null);

  const {
    authUser, authReady, effectiveUserId, displayName,
    handleLogin, handleSignUp, handleGoogleLogin, handleLogout, updateDisplayName
  } = useAuth();

  const {
    projects, activeProjectId, setActiveProjectId, chatHistory, setChatHistory,
    createProject, updateProject, deleteProject, createChatInProject, deleteChat,
    updateChatTitle, deleteAllChats
  } = useProjects(effectiveUserId, authUser, model);

  const {
    messages, setMessages, activeChatId, setActiveChatId, isLoading, isStreaming,
    statusMessage, sendError, setSendError, sendMessage, editMessage, loadMessages
  } = useChat(effectiveUserId, authUser, model, activeProjectId);

  const [editingMsgIndex, setEditingMsgIndex] = useState(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => { localStorage.setItem('solaris_dark', darkMode); }, [darkMode]);
  useEffect(() => { localStorage.setItem('solaris_programming_mode', programmingMode); }, [programmingMode]);
  useEffect(() => { if (!authUser && model === 'pro') setModel('flash'); }, [authUser, model]);

  const handleNewChat = () => {
    setActiveChatId(null);
    setMessages([]);
    setSendError('');
    setInput('');
    setActiveView('chat');
  };

  // Fecha sidebar em mobile após ação
  const closeSidebarOnMobile = () => {
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  const handleSend = async () => {
    await sendMessage(input, activeChatId, activeProjectId, async (projectId) => {
      const nc = await createChatInProject(projectId);
      return nc;
    });
    setInput('');
  };

  const handleEdit = (index, content) => { setEditingMsgIndex(index); setEditValue(content); };
  const handleEditCancel = () => { setEditingMsgIndex(null); setEditValue(''); };

  const handleEditSave = async () => {
    if (!editValue.trim() || isLoading || isStreaming || editingMsgIndex === null) return;
    const original = messages[editingMsgIndex];
    await editMessage(editingMsgIndex, editValue.trim(), original.content, activeChatId, activeProjectId);
    setEditingMsgIndex(null);
    setEditValue('');
  };

  const handleShare = () => setShowShareModal(true);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (!activeProjectId) {
      setUploadStatus({ type: 'error', message: 'Selecione um projeto para enviar arquivos.' });
      setTimeout(() => setUploadStatus(null), 3000);
      return;
    }
    setUploadStatus({ type: 'uploading', message: `Enviando ${file.name}...` });
    try {
      await api.uploadFile(activeProjectId, file, effectiveUserId);
      setUploadStatus({ type: 'success', message: `${file.name} enviado com sucesso!` });
      setTimeout(() => setUploadStatus(null), 3000);
    } catch (err) {
      console.error(err);
      setUploadStatus({ type: 'error', message: `Erro ao enviar ${file.name}` });
      setTimeout(() => setUploadStatus(null), 4000);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;
    const { type, data } = itemToDelete;
    try {
      if (type === 'project') {
        await deleteProject(data.id);
      } else {
        await deleteChat(activeProjectId, data.id);
        if (activeChatId === data.id) {
          const remaining = chatHistory.filter(c => c.id !== data.id);
          setActiveChatId(remaining.length > 0 ? remaining[0].id : null);
          if (remaining.length === 0) setMessages([]);
        }
      }
    } catch (err) { console.error(err); }
    setItemToDelete(null);
  };

  const onDragStart = (e, id) => {
    setDraggedItemId(id);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => { e.currentTarget.style.opacity = '0.4'; }, 0);
  };
  const onDragOver = (e, id) => { e.preventDefault(); };
  const onDragEnd = (e) => { e.currentTarget.style.opacity = '1'; setDraggedItemId(null); };

  const startRenameChatTitle = (e, chat) => {
    e.stopPropagation();
    setEditingChatTitleId(chat.id);
    setEditingChatTitleValue(chat.title || '');
  };

  const confirmRenameChatTitle = async (chatId) => {
    const newTitle = editingChatTitleValue.trim();
    setEditingChatTitleId(null);
    setEditingChatTitleValue('');
    if (!newTitle) return;
    await updateChatTitle(chatId, newTitle);
  };

  const handleAuthUpdate = async (newDisplayName) => { await updateDisplayName(newDisplayName); };

  const handleOpenProject = (project) => {
    setActiveProjectId(project.id);
    setActiveView('chat');
    setActiveChatId(null);
    setMessages([]);
  };

  const handleCreateProjectFromView = async (name, description, instructions) => {
    await createProject(name, description, instructions);
  };

  const theme = {
    bgAside: darkMode ? 'bg-[#0a0a0a]' : 'bg-white',
    bgMain: darkMode ? 'bg-[#111111]' : 'bg-[#fdfdfd]',
    border: darkMode ? 'border-white/10' : 'border-black/5',
    textPrimary: darkMode ? 'text-white/90' : 'text-[#1a1a1a]',
    textSecondary: darkMode ? 'text-white/40' : 'text-black/50',
    textMuted: darkMode ? 'text-white/20' : 'text-black/30',
    inputBorder: darkMode ? 'border-white/20' : 'border-black/10',
    inputFocus: darkMode ? 'focus-within:border-white' : 'focus-within:border-black',
    scrollbar: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    orbit: darkMode ? 'border-white/10' : 'border-black/20',
    projectHover: darkMode ? 'hover:bg-white/5' : 'hover:bg-black/5',
    projectActive: darkMode ? 'bg-white/10 text-white shadow-sm' : 'bg-black/5 text-black shadow-sm',
    modalBg: darkMode ? 'bg-[#1a1a1a]' : 'bg-white',
  };

  const hasUserStartedChat = messages.some(m => m.role === 'user');

  return (
    <div className={`flex h-screen ${darkMode ? 'bg-[#050505] text-white' : 'bg-[#fafafa] text-[#1a1a1a]'} font-sans antialiased overflow-hidden transition-colors duration-500`}>
      {showAuthModal && (
        <AuthModal darkMode={darkMode} onClose={() => setShowAuthModal(false)} onAuthSuccess={() => setShowAuthModal(false)} onGoogleLogin={handleGoogleLogin} onLogin={handleLogin} onSignUp={handleSignUp} />
      )}
      {showSettingsModal && authUser && (
        <SettingsModal darkMode={darkMode} onClose={() => setShowSettingsModal(false)} effectiveUserId={effectiveUserId} authUser={authUser} onAuthUpdate={handleAuthUpdate} onDeleteAllChats={deleteAllChats} />
      )}
      {editingProject && (
        <ProjectModal project={editingProject} onClose={() => setEditingProject(null)} onUpdate={updateProject} darkMode={darkMode} effectiveUserId={effectiveUserId} />
      )}
      <ConfirmDialog
        isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} onConfirm={handleDeleteConfirm}
        title="Apagar?" message={`Apagar "${itemToDelete?.data?.name || itemToDelete?.data?.title}"?`}
        darkMode={darkMode} theme={theme}
      />
      <ShareModal isOpen={showShareModal} onClose={() => setShowShareModal(false)} messages={messages} darkMode={darkMode} theme={theme} />

      <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-[110] px-6 py-3 rounded-full bg-emerald-500 text-white text-xs font-bold tracking-widest uppercase shadow-2xl transition-all duration-500 ${showShareToast ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
        Copiado para a área de transferência
      </div>

      <Sidebar
        isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} darkMode={darkMode} theme={theme}
        projects={projects} activeProjectId={activeProjectId} setActiveProjectId={setActiveProjectId}
        chatHistory={chatHistory} activeChatId={activeChatId} setActiveChatId={setActiveChatId}
        onCreateProject={createProject}
        onDeleteProject={(proj) => setItemToDelete({ type: 'project', data: proj })}
        onDeleteChat={(chat) => setItemToDelete({ type: 'chat', data: chat })}
        onEditProject={setEditingProject} onNewChat={handleNewChat}
        onStartRenameChat={startRenameChatTitle}
        editingChatTitleId={editingChatTitleId} editingChatTitleValue={editingChatTitleValue}
        setEditingChatTitleValue={setEditingChatTitleValue} onConfirmRenameChat={confirmRenameChatTitle}
        displayName={displayName} onOpenSettings={() => setShowSettingsModal(true)}
        searchQuery={searchQuery} setSearchQuery={setSearchQuery}
        draggedItemId={draggedItemId} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}
        activeView={activeView} onNavigate={setActiveView}
      />

      <main className={`flex-1 flex flex-col ${theme.bgMain} relative transition-colors duration-500 overflow-hidden`}>
        <header className={`flex flex-col border-b ${theme.border} transition-colors duration-500 shrink-0`}>
          {/* Linha principal do header */}
          <div className="h-16 md:h-20 flex items-center justify-between px-4 md:px-10">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className={`p-2 rounded-lg transition-all ${darkMode ? 'text-white/60 hover:text-white hover:bg-white/5' : 'text-black/40 hover:text-black hover:bg-black/5'}`}>
              <PanelLeft size={20} strokeWidth={1.5} />
            </button>
            <div className="flex items-baseline gap-1 select-none">
              <span className="text-base font-medium tracking-tight">SOLARIS</span>
              <span className={`text-[10px] font-bold ${theme.textMuted} tracking-tighter`}>V1</span>
            </div>
            {activeProjectId && activeView === 'chat' && (
              <div className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-black/5'}`}>
                <span className={`text-xs font-light ${theme.textSecondary}`}>{projects.find(p => p.id === activeProjectId)?.name}</span>
                <button onClick={() => setActiveProjectId(null)} className={`ml-1 ${theme.textMuted} hover:text-red-400 transition-colors`} title="Sair do projeto">✕</button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {hasUserStartedChat && activeView === 'chat' && (
              <button onClick={handleShare} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all duration-200 ${theme.border} ${theme.textSecondary} hover:text-current hover:border-current opacity-60 hover:opacity-100`} title="Copiar conversa">
                <Share2 size={13} strokeWidth={1.5} />
                <span className={`hidden sm:inline text-[10px] font-light tracking-widest uppercase`}>Compartilhar</span>
              </button>
            )}
            {authUser && (
              <button onClick={() => setShowSettingsModal(true)} className={`p-2 rounded-lg transition-all ${darkMode ? 'text-white/40 hover:text-white hover:bg-white/5' : 'text-black/40 hover:text-black hover:bg-black/5'}`} title="Configurações">
                <Settings size={18} strokeWidth={1.5} />
              </button>
            )}
            <button onClick={() => setDarkMode(d => !d)} className={`transition-all ${darkMode ? 'text-yellow-400 hover:text-yellow-200' : 'text-slate-400 hover:text-slate-600'}`}>
              {darkMode ? <Sun size={18} strokeWidth={1.5} /> : <Moon size={18} strokeWidth={1.5} />}
            </button>
            {authUser ? (
              <button onClick={handleLogout} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${theme.border} text-xs font-light transition-all ${theme.textSecondary} hover:text-red-400 hover:border-red-400/20`}>
                <LogOut size={14} strokeWidth={1.5} />
                <span className="hidden sm:inline">Sair</span>
              </button>
            ) : (
              <button onClick={() => setShowAuthModal(true)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${theme.border} text-xs font-light transition-all ${theme.textSecondary} hover:text-current hover:border-current`}>
                <LogIn size={14} strokeWidth={1.5} />
                <span className="hidden sm:inline">Entrar</span>
              </button>
            )}
            {!authUser && (
              <span onClick={() => setShowAuthModal(true)} className="hidden md:flex items-center gap-1.5 cursor-pointer text-amber-400/60 hover:text-amber-400 transition-colors text-xs">
                <Star size={10} /> Entrar para usar Pro
              </span>
            )}
          </div>
          </div>

          {/* Indicador de Modo Code — aparece abaixo da linha do header */}
          {programmingMode && (
            <div className={`px-4 md:px-10 py-1.5 flex items-center gap-2 border-t ${theme.border} transition-all duration-300`}>
              <span className={darkMode ? 'code-mode-dot-dark' : 'code-mode-dot-light'} />
              <span className={`text-[9px] font-medium uppercase tracking-[0.35em] ${darkMode ? 'text-cyan-400/70' : 'text-cyan-700/70'}`}>
                Modo Code: Ativado
              </span>
            </div>
          )}
        </header>

        {activeView === 'projects' ? (
          <ProjectsView
            darkMode={darkMode} theme={theme} projects={projects}
            onCreateProject={handleCreateProjectFromView}
            onOpenProject={handleOpenProject}
            onEditProject={setEditingProject}
            onDeleteProject={(proj) => setItemToDelete({ type: 'project', data: proj })}
          />
        ) : (
          <>
            <ChatWindow
              messages={messages} darkMode={darkMode} theme={theme}
              isLoading={isLoading} isStreaming={isStreaming} statusMessage={statusMessage}
              displayName={displayName} activeProjectId={activeProjectId}
              onEdit={handleEdit} editingMsgIndex={editingMsgIndex}
              editValue={editValue} setEditValue={setEditValue}
              onEditSave={handleEditSave} onEditCancel={handleEditCancel}
              programmingMode={programmingMode}
            />
            <MessageInput
              input={input} setInput={setInput} onSend={handleSend}
              isLoading={isLoading} isStreaming={isStreaming}
              darkMode={darkMode} theme={theme} model={model} setModel={setModel}
              authUser={authUser} programmingMode={programmingMode}
              setProgrammingMode={setProgrammingMode} sendError={sendError}
              uploadStatus={uploadStatus} onFileUpload={handleFileUpload} fileInputRef={fileInputRef}
            />
          </>
        )}
      </main>

      <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} accept=".pdf,.txt,.md,.json,.js,.ts,.py,.css,.html,.csv" />

      {/* Scrollbar thumb color varia com o tema — apenas esta regra dinâmica fica aqui */}
      <style dangerouslySetInnerHTML={{ __html: `.custom-scrollbar::-webkit-scrollbar-thumb { background: ${theme.scrollbar}; }` }} />
    </div>
  );
}