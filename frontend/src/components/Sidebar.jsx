import React, { useState, useRef } from 'react';
import {
  PencilLine, Search, FolderPlus, Folder, History, Trash2, Pencil, ChevronDown,
  Settings, User, GripVertical, Check, X, LayoutGrid
} from 'lucide-react';
import { SolarSystem } from './ui/SolarSystem';

export function Sidebar({
  isOpen,
  setIsOpen,
  darkMode,
  theme,
  projects,
  activeProjectId,
  setActiveProjectId,
  chatHistory,
  activeChatId,
  setActiveChatId,
  onCreateProject,
  onDeleteProject,
  onDeleteChat,
  onEditProject,
  onNewChat,
  onStartRenameChat,
  editingChatTitleId,
  editingChatTitleValue,
  setEditingChatTitleValue,
  onConfirmRenameChat,
  displayName,
  onOpenSettings,
  searchQuery,
  setSearchQuery,
  draggedItemId,
  onDragStart,
  onDragOver,
  onDragEnd,
  activeView,
  onNavigate,
}) {
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [showMoreProjects, setShowMoreProjects] = useState(false);
  const moreProjectsRef = useRef(null);

  const visibleProjects = projects.slice(0, 3);
  const extraProjects = projects.slice(3);
  const filteredChats = searchQuery.trim()
    ? chatHistory.filter(c => c.title?.toLowerCase().includes(searchQuery.toLowerCase()))
    : chatHistory;

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) { setIsCreatingProject(false); return; }
    await onCreateProject(newProjectName.trim());
    setNewProjectName('');
    setIsCreatingProject(false);
  };

  const ProjectItem = ({ project, isActive, compact = false }) => (
    <div
      draggable
      onDragStart={e => onDragStart(e, project.id)}
      onDragOver={e => onDragOver(e, project.id)}
      onDragEnd={onDragEnd}
      onClick={() => { setActiveProjectId(project.id); setShowMoreProjects(false); if (onNavigate) onNavigate('chat'); }}
      className={`flex items-center justify-between p-2.5 -ml-2 rounded-lg cursor-grab active:cursor-grabbing transition-all group/item ${isActive ? theme.projectActive : theme.projectHover} ${draggedItemId === project.id ? 'bg-blue-500/10' : ''}`}
    >
      <div className="flex items-center gap-3 overflow-hidden pointer-events-none">
        {!compact && <GripVertical size={12} className={`${theme.textMuted} opacity-0 group-hover/item:opacity-100 transition-opacity`} />}
        <Folder size={14} className={isActive ? 'text-current opacity-60' : theme.textMuted} />
        <span className={`text-xs font-light truncate ${compact ? 'max-w-[140px]' : 'max-w-[100px]'} ${isActive ? 'font-normal' : theme.textSecondary}`}>
          {project.name}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={e => { e.stopPropagation(); onEditProject(project); }} className="opacity-0 group-hover/item:opacity-100 p-1 hover:text-amber-400 transition-colors">
          <Settings size={12} />
        </button>
        <button onClick={e => { e.stopPropagation(); onDeleteProject(project); }} className="opacity-0 group-hover/item:opacity-100 p-1 hover:text-red-500 transition-all duration-200">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );

  return (
    <aside className={`hidden lg:flex flex-col border-r ${theme.border} ${theme.bgAside} relative transition-all duration-500 ease-in-out shrink-0 ${isOpen ? 'w-72' : 'w-20'}`}>
      <div className={`flex flex-col h-full overflow-hidden transition-all duration-500 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="px-8 pt-12 pb-6 flex flex-col gap-5 shrink-0">
          {/* New chat */}
          <button onClick={onNewChat} className={`flex items-center gap-3 w-full text-left transition-colors ${theme.textPrimary} group`}>
            <PencilLine size={18} strokeWidth={1.2} />
            <span className="text-sm font-light">Novo Chat</span>
          </button>

          {/* Projects page nav */}
          <button
            onClick={() => onNavigate && onNavigate(activeView === 'projects' ? 'chat' : 'projects')}
            className={`flex items-center gap-3 w-full text-left transition-colors group ${
              activeView === 'projects'
                ? (darkMode ? 'text-white' : 'text-black')
                : theme.textSecondary
            }`}
          >
            <LayoutGrid size={18} strokeWidth={1.2} className={activeView === 'projects' ? 'text-current' : ''} />
            <span className="text-sm font-light">Projetos</span>
            {activeView === 'projects' && (
              <span className={`ml-auto w-1.5 h-1.5 rounded-full ${darkMode ? 'bg-white' : 'bg-black'}`} />
            )}
          </button>

          {/* Search */}
          <div className="flex items-center gap-3 w-full">
            <Search size={18} strokeWidth={1.2} className={theme.textPrimary} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar conversa"
              className={`bg-transparent border-none p-0 text-sm font-light w-full focus:outline-none ${darkMode ? 'text-white placeholder:text-white/20' : 'text-black placeholder:text-black/30'}`}
            />
          </div>
        </div>

        <div className="px-8 flex flex-col flex-1 overflow-y-auto custom-scrollbar">
          <SolarSystem darkMode={darkMode} theme={theme} />

          {/* Projects section */}
          <div className="flex flex-col gap-4 mb-8 shrink-0">
            <h2 className={`text-[10px] font-light tracking-[0.4em] uppercase ${theme.textSecondary}`}>PROJETOS</h2>
            {isCreatingProject ? (
              <div className={`flex items-center gap-2 p-2 -ml-2 rounded-lg border ${theme.inputBorder}`}>
                <input
                  autoFocus
                  type="text"
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateProject(); if (e.key === 'Escape') { setIsCreatingProject(false); setNewProjectName(''); } }}
                  placeholder="Nome do projeto..."
                  className="bg-transparent border-none text-xs w-full focus:outline-none font-light"
                />
                <button onClick={handleCreateProject} className="text-emerald-500"><Check size={14} /></button>
                <button onClick={() => { setIsCreatingProject(false); setNewProjectName(''); }} className="text-red-400"><X size={14} /></button>
              </div>
            ) : (
              <button onClick={() => setIsCreatingProject(true)} className={`flex items-center gap-3 p-2 -ml-2 rounded-lg text-left transition-all ${theme.projectHover} group`}>
                <FolderPlus size={18} className={`${theme.textSecondary} group-hover:text-current`} strokeWidth={1.5} />
                <span className={`text-sm font-light ${theme.textPrimary}`}>Novo projeto</span>
              </button>
            )}
            <div className="flex flex-col gap-1">
              {visibleProjects.map(p => <ProjectItem key={p.id} project={p} isActive={activeProjectId === p.id} />)}
            </div>
            {extraProjects.length > 0 && (
              <div className="relative" ref={moreProjectsRef}>
                <button onClick={() => setShowMoreProjects(!showMoreProjects)} className={`flex items-center gap-2 p-2 -ml-2 rounded-lg w-full transition-all ${theme.projectHover}`}>
                  <ChevronDown size={14} className={`${theme.textMuted} transition-transform ${showMoreProjects ? 'rotate-180' : ''}`} />
                  <span className={`text-xs font-light ${theme.textMuted}`}>+{extraProjects.length} projeto{extraProjects.length > 1 ? 's' : ''}</span>
                </button>
                {showMoreProjects && (
                  <div className={`absolute left-0 right-0 z-50 mt-1 rounded-xl border ${theme.border} ${darkMode ? 'bg-[#141414]' : 'bg-white'} shadow-xl py-2 px-2 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-200`}>
                    {extraProjects.map(p => <ProjectItem key={p.id} project={p} isActive={activeProjectId === p.id} compact />)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Chats section */}
          <div className="flex flex-col gap-4 mb-10 shrink-0">
            <h2 className={`text-[10px] font-light tracking-[0.4em] uppercase ${theme.textSecondary}`}>CONVERSAS</h2>
            {filteredChats.length === 0 && (
              <p className={`text-xs font-light ${theme.textMuted}`}>As conversas aparecerão aqui.</p>
            )}
            <div className="flex flex-col gap-1">
              {filteredChats.map(chat => (
                <div
                  key={chat.id}
                  onClick={() => { if (editingChatTitleId !== chat.id) { setActiveChatId(chat.id); if (onNavigate) onNavigate('chat'); } }}
                  className={`flex items-center justify-between p-2 -ml-2 rounded-lg cursor-pointer transition-all group/chat ${activeChatId === chat.id ? theme.projectActive : theme.projectHover}`}
                >
                  <div className="flex items-center gap-3 overflow-hidden flex-1 min-w-0">
                    <History size={14} className={`shrink-0 ${activeChatId === chat.id ? 'text-current opacity-60' : theme.textMuted}`} />
                    {editingChatTitleId === chat.id ? (
                      <input
                        autoFocus
                        type="text"
                        value={editingChatTitleValue}
                        onChange={e => setEditingChatTitleValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') onConfirmRenameChat(chat.id); if (e.key === 'Escape') { setEditingChatTitleId(null); setEditingChatTitleValue(''); } }}
                        onBlur={() => onConfirmRenameChat(chat.id)}
                        onClick={e => e.stopPropagation()}
                        className={`text-xs font-light bg-transparent border-none focus:outline-none w-full min-w-0 ${darkMode ? 'text-white' : 'text-black'}`}
                        maxLength={50}
                      />
                    ) : (
                      <span className={`text-xs font-light truncate max-w-[100px] ${activeChatId === chat.id ? 'font-normal' : theme.textSecondary}`}>{chat.title}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover/chat:opacity-100 transition-all duration-200 shrink-0">
                    <button onClick={e => onStartRenameChat(e, chat)} title="Renomear" className={`p-1 hover:text-current transition-colors ${theme.textMuted}`}>
                      <Pencil size={11} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); onDeleteChat(chat); }} className="p-1 hover:text-red-500 transition-all duration-200">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={`px-8 shrink-0 border-t ${theme.border}`}>
          {displayName && (
            <div className={`pt-4 pb-2 flex items-center gap-2 ${theme.textSecondary}`}>
              <User size={12} strokeWidth={1.5} />
              <span className="text-xs font-light truncate">{displayName}</span>
            </div>
          )}
          <div className="flex flex-col py-4">
            <span className={`text-[8px] font-extralight uppercase tracking-[0.4em] ${darkMode ? 'text-white/20' : 'text-black/30'} mb-0.5`}>Criado por</span>
            <span className={`text-sm italic tracking-wide ${darkMode ? 'text-white/50' : 'text-black/60'}`} style={{ fontFamily: 'Georgia, serif' }}>
              felipe sant'oliver
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}