import React, { useState, useRef, useEffect } from 'react';
import {
  Send, Loader2, Minus, Plus, Maximize2, Moon, Sun, MessageSquare, Hammer,
  Mic, FolderPlus, Folder, Check, X, Trash2, AlertTriangle, History,
  ChevronDown, GripVertical, SquarePen, Search, Share2
} from 'lucide-react';

// ─── Anthropic API ────────────────────────────────────────────────────────────
async function callClaude(messages, systemPrompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages,
    }),
  });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const data = await response.json();
  return data.content.map(b => b.text || '').join('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function OrbitLine({ size, themeColor }) {
  return <div className={`absolute border ${themeColor} rounded-full ${size} transition-colors duration-500`} />;
}
function PlanetDot({ size, duration, color, glow, dotSize = 'w-1.5 h-1.5' }) {
  return (
    <div
      className={`absolute ${size}`}
      style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
    >
      <div
        className="absolute inset-0 orbit-rotate"
        style={{ animationDuration: duration }}
      >
        <div
          className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${color} ${dotSize} shadow-sm transition-colors duration-500`}
          style={glow ? { boxShadow: glow } : {}}
        />
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const WELCOME = 'Olá. Como posso ajudar?';

  const [messages, setMessages] = useState([{ role: 'assistant', content: WELCOME }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [workMode, setWorkMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showShareToast, setShowShareToast] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [projects, setProjects] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [activeChatId, setActiveChatId] = useState(null);
  const [draggedItemId, setDraggedItemId] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const hasUserStartedChat = messages.some(m => m.role === 'user');

  // ── Scroll ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ── Send message ──
  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const newMessages = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);
    setIsLoading(true);

    const activeProject = projects.find(p => p.id === activeProjectId);
    const systemPrompt = activeProject
      ? `Você é o Solaris, um assistente de IA especializado operando dentro do projeto "${activeProject.name}". ${workMode ? 'O usuário está no MODO EXECUÇÃO — foque em tarefas práticas e objetivas.' : 'Seja útil, preciso e direto.'}`
      : `Você é o Solaris, um assistente de IA. ${workMode ? 'O usuário está no MODO EXECUÇÃO — foque em tarefas práticas e objetivas.' : 'Seja útil, preciso e direto.'}`;

    const apiMessages = newMessages
      .filter((m, i) => !(i === 0 && m.role === 'assistant' && m.content === WELCOME))
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const responseText = await callClaude(apiMessages, systemPrompt);
      setMessages(prev => [...prev, { role: 'assistant', content: responseText }]);

      if (activeChatId) {
        setChatHistory(prev => prev.map(c =>
          c.id === activeChatId ? { ...c, title: userMessage.slice(0, 40) } : c
        ));
      } else {
        const newChat = { id: Date.now(), title: userMessage.slice(0, 40) };
        setChatHistory(prev => [newChat, ...prev]);
        setActiveChatId(newChat.id);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Lamento, ocorreu um erro na ligação.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleInput = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  // ── Funcionalidades Adicionais ──
  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { });
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Arquivo selecionado: ${file.name}. (Funcionalidade de upload em desenvolvimento)` }]);
    }
  };

  const handleShare = () => {
    const text = messages
      .filter(m => !(m.role === 'assistant' && m.content === WELCOME))
      .map(m => `${m.role === 'user' ? 'VOCÊ' : 'SOLARIS'}: ${m.content}`)
      .join('\n\n');
    navigator.clipboard.writeText(text).catch(() => { });
    setShowShareToast(true);
    setTimeout(() => setShowShareToast(false), 3000);
  };

  const handleNewChat = () => {
    setMessages([{ role: 'assistant', content: WELCOME }]);
    setActiveChatId(null);
  };

  const createProject = () => {
    if (!newProjectName.trim()) { setIsCreatingProject(false); return; }
    const proj = { id: Date.now(), name: newProjectName.trim() };
    setProjects(prev => [proj, ...prev]);
    setNewProjectName('');
    setIsCreatingProject(false);
    setActiveProjectId(proj.id);
  };

  const handleDeleteConfirm = () => {
    if (!itemToDelete) return;
    const { type, data } = itemToDelete;
    if (type === 'project') {
      const updated = projects.filter(p => p.id !== data.id);
      setProjects(updated);
      if (activeProjectId === data.id) setActiveProjectId(updated[0]?.id ?? null);
    } else {
      const updated = chatHistory.filter(c => c.id !== data.id);
      setChatHistory(updated);
      if (activeChatId === data.id) {
        setActiveChatId(updated[0]?.id ?? null);
        setMessages([{ role: 'assistant', content: WELCOME }]);
      }
    }
    setItemToDelete(null);
  };

  const onDragStart = (e, id) => {
    setDraggedItemId(id);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => { e.currentTarget.style.opacity = '0.4'; }, 0);
  };
  const onDragOver = (e, id) => {
    e.preventDefault();
    if (!draggedItemId || draggedItemId === id) return;
    const from = projects.findIndex(p => p.id === draggedItemId);
    const to = projects.findIndex(p => p.id === id);
    if (from === -1 || to === -1) return;
    const arr = [...projects];
    arr.splice(to, 0, arr.splice(from, 1)[0]);
    setProjects(arr);
  };
  const onDragEnd = (e) => { e.currentTarget.style.opacity = '1'; setDraggedItemId(null); };

  const theme = {
    bgAside: darkMode ? 'bg-[#0a0a0a]' : 'bg-white',
    bgMain: darkMode ? 'bg-[#111111]' : 'bg-[#fdfdfd]',
    border: darkMode ? 'border-white/10' : 'border-black/5',
    textPrimary: darkMode ? 'text-white/90' : 'text-[#1a1a1a]',
    textSecondary: darkMode ? 'text-white/40' : 'text-black/40',
    textMuted: darkMode ? 'text-white/20' : 'text-black/50',
    inputBorder: darkMode ? 'border-white/20' : 'border-black/10',
    inputFocus: darkMode ? 'focus-within:border-white' : 'focus-within:border-black',
    scrollbar: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
    orbit: darkMode ? 'border-white/15' : 'border-black/10',
    projectHover: darkMode ? 'hover:bg-white/5' : 'hover:bg-black/5',
    projectActive: darkMode ? 'bg-white/10 text-white shadow-sm' : 'bg-black/5 text-black shadow-sm',
    modalOverlay: 'bg-black/60 backdrop-blur-sm',
    modalBg: darkMode ? 'bg-[#1a1a1a]' : 'bg-white',
    dropdownBg: darkMode ? 'bg-[#151515]' : 'bg-white',
  };

  const visibleProjects = projects.slice(0, 3);
  const hiddenProjects = projects.slice(3);
  const filteredChats = searchQuery.trim()
    ? chatHistory.filter(c => c.title?.toLowerCase().includes(searchQuery.toLowerCase()))
    : chatHistory;

  const ProjectItem = ({ project, isActive }) => (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, project.id)}
      onDragOver={(e) => onDragOver(e, project.id)}
      onDragEnd={onDragEnd}
      onClick={() => setActiveProjectId(project.id)}
      className={`flex items-center justify-between p-2.5 -ml-2 rounded-lg cursor-grab active:cursor-grabbing transition-all group/item ${isActive ? theme.projectActive : theme.projectHover} ${draggedItemId === project.id ? 'bg-blue-500/10' : ''}`}
    >
      <div className="flex items-center gap-3 overflow-hidden pointer-events-none">
        <GripVertical size={12} className={`${theme.textMuted} opacity-0 group-hover/item:opacity-100 transition-opacity`} />
        <Folder size={14} className={isActive ? 'text-current opacity-60' : theme.textMuted} />
        <span className={`text-xs font-light truncate max-w-[120px] ${isActive ? 'font-normal' : theme.textSecondary}`}>{project.name}</span>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); setItemToDelete({ type: 'project', data: project }); }}
        className="opacity-0 group-hover/item:opacity-100 p-1 hover:text-red-500 transition-all duration-200"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );

  return (
    <div className={`flex h-screen ${darkMode ? 'bg-[#050505] text-white' : 'bg-[#fafafa] text-[#1a1a1a]'} font-sans antialiased overflow-hidden transition-colors duration-500`}>

      <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />

      <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-[110] px-6 py-3 rounded-full bg-emerald-500 text-white text-xs font-bold tracking-widest uppercase shadow-2xl transition-all duration-500 ${showShareToast ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
        Chat copiado para a área de transferência
      </div>

      {itemToDelete && (
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 ${theme.modalOverlay} animate-in fade-in duration-300`}>
          <div className={`${theme.modalBg} border ${theme.border} w-full max-w-sm rounded-2xl p-8 shadow-2xl animate-in zoom-in-95 duration-300`}>
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                <AlertTriangle className="text-red-500" size={24} />
              </div>
              <h3 className="text-lg font-medium mb-2">Apagar?</h3>
              <p className={`text-sm ${theme.textSecondary} mb-8`}>
                Tens a certeza que desejas eliminar "<span className="font-semibold">{itemToDelete.data.name || itemToDelete.data.title}</span>"?
              </p>
              <div className="flex w-full gap-3">
                <button onClick={() => setItemToDelete(null)} className={`flex-1 py-3 rounded-xl border ${theme.border} text-xs font-bold uppercase tracking-widest hover:bg-black/5 transition-colors`}>Cancelar</button>
                <button onClick={handleDeleteConfirm} className="flex-1 py-3 rounded-xl bg-red-500 text-white text-xs font-bold uppercase tracking-widest hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20">Eliminar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className={`hidden lg:flex fixed left-0 top-8 z-40 w-7 h-7 rounded-r-full border border-l-0 ${theme.border} ${theme.bgAside} items-center justify-center shadow-sm transition-all duration-300 ${theme.textSecondary} hover:text-current`}
          title="Expandir sidebar"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4,2 8,6 4,10" />
          </svg>
        </button>
      )}

      <aside className={`hidden lg:flex flex-col border-r ${theme.border} ${theme.bgAside} relative transition-all duration-500 overflow-y-auto custom-scrollbar ${sidebarCollapsed ? 'w-0 border-r-0 overflow-hidden' : 'w-80'}`}>
        <button
          onClick={() => setSidebarCollapsed(c => !c)}
          className={`absolute top-8 -right-4 z-30 w-7 h-7 rounded-full border ${theme.border} ${theme.bgAside} flex items-center justify-center shadow-sm transition-all duration-500 ${theme.textSecondary} hover:text-current`}
          title={sidebarCollapsed ? 'Expandir sidebar' : 'Recolher sidebar'}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {sidebarCollapsed
              ? <><polyline points="4,2 8,6 4,10" /></>
              : <><polyline points="8,2 4,6 8,10" /></>
            }
          </svg>
        </button>

        <div className={`sticky top-0 z-20 px-8 pt-8 pb-6 flex flex-col gap-5 shrink-0 ${theme.bgAside} transition-colors duration-500`}>
          <button
            onClick={handleNewChat}
            className={`flex items-center gap-3 w-full transition-colors duration-500 ${theme.textPrimary} group`}
          >
            <SquarePen size={18} strokeWidth={1.2} />
            <span className="text-sm font-light">Novo Chat</span>
          </button>

          <div className="flex items-center gap-3 w-full">
            <Search size={18} strokeWidth={1.2} className={`${theme.textPrimary} transition-colors duration-500`} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar"
              className={`bg-transparent border-none p-0 text-sm font-light w-full focus:outline-none transition-colors duration-500 ${darkMode ? 'text-white placeholder:text-white/30' : 'text-black placeholder:text-black/30'}`}
            />
          </div>
        </div>

        <div className="px-8 flex flex-col transition-colors duration-500">
          <div className="relative flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity duration-700 mb-10 shrink-0" style={{ width: '160px', height: '160px', margin: '0 auto 40px', overflow: 'visible' }}>
            <div className={`absolute w-[14px] h-[14px] ${darkMode ? 'bg-[#ffd700]' : 'bg-[#ffcc00]'} rounded-full z-10 shadow-[0_0_16px_rgba(255,204,0,0.5)] transition-colors duration-500`} style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />

            <div className={`absolute border ${theme.orbit} rounded-full transition-colors duration-500`} style={{ width: 36, height: 36, top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
            <div className={`absolute border ${theme.orbit} rounded-full transition-colors duration-500`} style={{ width: 52, height: 52, top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
            <div className={`absolute border ${theme.orbit} rounded-full transition-colors duration-500`} style={{ width: 72, height: 72, top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
            <div className={`absolute border ${theme.orbit} rounded-full transition-colors duration-500`} style={{ width: 92, height: 92, top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
            <div className={`absolute border ${theme.orbit} rounded-full transition-colors duration-500`} style={{ width: 116, height: 116, top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
            <div className={`absolute border ${theme.orbit} rounded-full transition-colors duration-500`} style={{ width: 140, height: 140, top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
            <div className={`absolute border ${theme.orbit} rounded-full transition-colors duration-500`} style={{ width: 156, height: 156, top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
            <div className={`absolute border ${theme.orbit} rounded-full transition-colors duration-500`} style={{ width: 160, height: 160, top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />

            <PlanetDot size="w-[36px] h-[36px]" duration="3s" color={darkMode ? 'bg-[#b0aeaa]' : 'bg-[#9c9a95]'} dotSize="w-[5px] h-[5px]" />
            <PlanetDot size="w-[52px] h-[52px]" duration="7s" color="bg-[#e3c98a]" dotSize="w-[6px] h-[6px]" />
            <PlanetDot size="w-[72px] h-[72px]" duration="12s" color="bg-[#2b7fc4]" glow={darkMode ? '0 0 6px #4af' : '0 0 5px rgba(43,127,196,0.7)'} dotSize="w-[6px] h-[6px]" />
            <PlanetDot size="w-[92px] h-[92px]" duration="19s" color="bg-[#c1440e]" dotSize="w-[5px] h-[5px]" />
            <PlanetDot size="w-[116px] h-[116px]" duration="32s" color="bg-[#c8874a]" glow={darkMode ? '0 0 5px rgba(200,135,74,0.4)' : undefined} dotSize="w-[9px] h-[9px]" />
            <div className="absolute w-[140px] h-[140px]" style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>
              <div className="absolute inset-0 orbit-rotate" style={{ animationDuration: '48s' }}>
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: 14, height: 14 }}>
                  <div className="w-[8px] h-[8px] rounded-full bg-[#e4c97e] absolute shadow-sm" style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
                  <svg width="16" height="8" viewBox="0 0 16 8" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-25%)' }}>
                    <ellipse cx="8" cy="4" rx="7" ry="2.2" fill="none" stroke={darkMode ? 'rgba(228,201,126,0.55)' : 'rgba(180,150,80,0.45)'} strokeWidth="1.2" />
                  </svg>
                </div>
              </div>
            </div>
            <PlanetDot size="w-[156px] h-[156px]" duration="64s" color="bg-[#7de8e8]" glow={darkMode ? '0 0 5px rgba(125,232,232,0.4)' : undefined} dotSize="w-[7px] h-[7px]" />
            <PlanetDot size="w-[160px] h-[160px]" duration="90s" color="bg-[#3f54ba]" glow={darkMode ? '0 0 5px rgba(63,84,186,0.5)' : undefined} dotSize="w-[6px] h-[6px]" />
          </div>

          <div className="flex flex-col gap-4 mb-8 shrink-0">
            <h2 className={`text-[10px] font-light tracking-[0.4em] uppercase ${theme.textSecondary} transition-colors duration-500`}>PROJETOS</h2>
            {isCreatingProject ? (
              <div className={`flex items-center gap-2 p-2 -ml-2 rounded-lg border ${theme.inputBorder} animate-in fade-in zoom-in-95 duration-200`}>
                <input
                  autoFocus
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createProject()}
                  placeholder="Nome do projeto..."
                  className="bg-transparent border-none text-xs w-full focus:outline-none font-light"
                />
                <button onClick={createProject} className="text-emerald-500"><Check size={14} /></button>
                <button onClick={() => setIsCreatingProject(false)} className="text-red-400"><X size={14} /></button>
              </div>
            ) : (
              <button
                onClick={() => setIsCreatingProject(true)}
                className={`flex items-center gap-3 p-2 -ml-2 rounded-lg transition-all duration-500 ${theme.projectHover} group`}
              >
                <FolderPlus size={18} className={`${theme.textSecondary} group-hover:text-current transition-colors duration-500`} strokeWidth={1.5} />
                <span className={`text-sm font-light ${theme.textPrimary} transition-colors duration-500`}>Novo projeto</span>
              </button>
            )}
            <div className="flex flex-col gap-1">
              {visibleProjects.map(p => <ProjectItem key={p.id} project={p} isActive={activeProjectId === p.id} />)}
              {hiddenProjects.length > 0 && (
                <div className="relative group/more">
                  <button className={`w-full flex items-center justify-between p-2.5 -ml-2 rounded-lg transition-all duration-500 ${theme.projectHover} ${theme.textSecondary}`}>
                    <div className="flex items-center gap-3">
                      <Plus size={14} className="opacity-60" />
                      <span className="text-xs font-light">Mais ({hiddenProjects.length})</span>
                    </div>
                    <ChevronDown size={12} className="opacity-40 group-hover/more:rotate-180 transition-transform duration-300" />
                  </button>
                  <div className="absolute left-0 top-full w-full z-50 pt-1 pointer-events-none group-hover/more:pointer-events-auto opacity-0 group-hover/more:opacity-100 transition-all duration-300 translate-y-2 group-hover/more:translate-y-0">
                    <div className={`${theme.dropdownBg} border ${theme.border} rounded-xl p-2 shadow-xl max-h-48 overflow-y-auto custom-scrollbar`}>
                      {hiddenProjects.map(p => <ProjectItem key={p.id} project={p} isActive={activeProjectId === p.id} />)}
                    </div>
                  </div>
                </div>
              )}
              {projects.length === 0 && !isCreatingProject && (
                <p className={`text-[10px] italic ${theme.textMuted} px-2 mt-2 transition-colors duration-500`}>Nenhum projeto ainda</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 mb-10 shrink-0">
            <h2 className={`text-[10px] font-light tracking-[0.4em] uppercase ${theme.textSecondary} transition-colors duration-500`}>SEUS CHATS</h2>
            <div className="flex flex-col gap-1">
              {filteredChats.map(chat => (
                <div
                  key={chat.id}
                  onClick={() => setActiveChatId(chat.id)}
                  className={`flex items-center justify-between p-2 -ml-2 rounded-lg cursor-pointer transition-all duration-500 group/chat ${activeChatId === chat.id ? theme.projectActive : theme.projectHover}`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <History size={14} className={activeChatId === chat.id ? 'text-current opacity-60' : theme.textMuted} />
                    <span className={`text-xs font-light truncate max-w-[140px] transition-colors duration-500 ${activeChatId === chat.id ? 'font-normal' : theme.textSecondary}`}>
                      {chat.title}
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setItemToDelete({ type: 'chat', data: chat }); }}
                    className="opacity-0 group-hover/chat:opacity-100 p-1 hover:text-red-500 transition-all duration-200"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {filteredChats.length === 0 && (
                <p className={`text-[10px] italic ${theme.textMuted} px-2 transition-colors duration-500`}>
                  {searchQuery.trim() ? 'Nenhum chat encontrado' : 'Histórico vazio'}
                </p>
              )}
            </div>
          </div>

          <div className="mt-auto pt-4 shrink-0 transition-colors duration-500">
            <div className="mb-8 flex flex-col gap-3">
              <span className={`text-[9px] font-medium uppercase tracking-[0.3em] ${theme.textMuted} ml-1`}>Operação</span>
              <div className={`relative flex items-center p-1 rounded-full border ${theme.border} bg-black/5 h-11 w-full overflow-hidden`}>
                <div className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-full transition-all duration-500 shadow-sm ${workMode ? 'translate-x-[calc(100%+0px)] bg-amber-500/10 border border-amber-500/20' : 'translate-x-0 bg-blue-500/10 border border-blue-500/20'}`} />
                <button onClick={() => setWorkMode(false)} className={`flex-1 relative flex items-center justify-center gap-2 text-[9px] font-bold uppercase tracking-widest z-10 transition-all duration-500 ${!workMode ? (darkMode ? 'text-blue-400 scale-105' : 'text-blue-700 scale-105') : 'text-gray-400 opacity-60'}`}>
                  <MessageSquare size={12} strokeWidth={workMode ? 1.5 : 2.5} /> Chat
                </button>
                <button onClick={() => setWorkMode(true)} className={`flex-1 relative flex items-center justify-center gap-2 text-[9px] font-bold uppercase tracking-widest z-10 transition-all duration-500 ${workMode ? (darkMode ? 'text-amber-400 scale-105' : 'text-amber-700 scale-105') : 'text-gray-400 opacity-60'}`}>
                  <Hammer size={12} strokeWidth={workMode ? 2.5 : 1.5} /> Obra
                </button>
              </div>
            </div>
            <div className={`h-[1px] ${theme.border} w-full mb-5`} />
            <div className="flex flex-col pb-6">
              <span className={`text-[8px] font-extralight uppercase tracking-[0.4em] ${darkMode ? 'text-white/20' : 'text-black/50'} mb-0.5`}>Criado por</span>
              <span className={`text-sm font-serif italic tracking-wide ${darkMode ? 'text-white/50' : 'text-black/80'}`} style={{ fontFamily: 'Georgia, "Apple Chancery", cursive' }}>
                felipe sant'oliver
              </span>
            </div>
          </div>
        </div>
      </aside>

      <main className={`flex-1 flex flex-col ${theme.bgMain} relative transition-colors duration-500`}>
        <header className={`h-20 flex items-center justify-between px-10 border-b ${theme.border} transition-colors duration-500`}>
          <div className="flex items-baseline gap-1">
            <span className="text-base font-medium tracking-tight">SOLARIS</span>
            <span className={`text-[10px] font-bold ${theme.textMuted} tracking-tighter`}>V1</span>
          </div>
          <div className="flex items-center gap-6">
            <button onClick={() => setDarkMode(d => !d)} className={`transition-all duration-300 ${darkMode ? 'text-yellow-400 hover:text-yellow-200' : 'text-slate-400 hover:text-slate-600'}`}>
              {darkMode ? <Sun size={18} strokeWidth={1.5} /> : <Moon size={18} strokeWidth={1.5} />}
            </button>
            <div className={`flex gap-4 ${theme.textMuted}`}>
              <Minus size={16} className="cursor-pointer hover:text-current transition-colors duration-300" onClick={handleNewChat} title="Limpar chat" />
              <Maximize2 size={14} className="cursor-pointer hover:text-current transition-colors duration-300" onClick={toggleFullScreen} title="Tela cheia" />
            </div>
          </div>
        </header>

        <div className="flex-1 relative overflow-y-auto px-6 md:px-20 py-10 space-y-12 custom-scrollbar transition-colors duration-500">

          {hasUserStartedChat && (
            <div className="sticky top-0 z-30 flex justify-end pointer-events-none mb-[-40px] animate-in fade-in zoom-in-95 duration-500">
              <button
                onClick={handleShare}
                className={`pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-full border ${theme.border} ${darkMode ? 'bg-white/5 hover:bg-white/10' : 'bg-black/5 hover:bg-black/10'} backdrop-blur-md transition-all duration-300 group shadow-sm`}
              >
                <Share2 size={14} className={`${theme.textSecondary} group-hover:text-current`} />
                <span className={`text-[10px] font-bold uppercase tracking-widest ${theme.textSecondary} group-hover:text-current`}>Compartilhar</span>
              </button>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-700`}>
              <div className={`max-w-[70%] ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                <div className={`text-[9px] uppercase tracking-[0.2em] font-bold mb-3 ${theme.textMuted}`}>
                  {msg.role === 'user' ? 'Usuário' : 'Solaris'}
                </div>
                <div className={`text-base leading-relaxed transition-colors duration-500 ${msg.role === 'user' ? (darkMode ? 'text-white font-medium' : 'text-black font-medium') : (darkMode ? 'text-white/60 font-light' : 'text-gray-600 font-light')}`}>
                  {msg.content}
                </div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center gap-3">
              <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black'} rounded-full animate-bounce [animation-delay:-0.3s]`} />
              <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black'} rounded-full animate-bounce [animation-delay:-0.15s]`} />
              <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black'} rounded-full animate-bounce`} />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <footer className="p-10 transition-colors duration-500">
          <div className="max-w-3xl mx-auto relative">
            <div className={`relative flex items-end border-b ${theme.inputBorder} pb-4 ${theme.inputFocus} transition-all duration-500`}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={workMode ? "Descreva a tarefa de obra..." : "Fale com o Solaris..."}
                className={`bg-transparent border-none text-sm w-full focus:outline-none resize-none py-2 pr-12 transition-colors duration-500 ${darkMode ? 'text-white placeholder:text-white/20' : 'text-black placeholder:text-black/30'}`}
              />
              <button
                onClick={handleSend}
                disabled={isLoading}
                className={`absolute right-0 bottom-6 transition-all duration-300 ${isLoading ? theme.textMuted : (darkMode ? 'text-white hover:scale-110' : 'text-black hover:scale-110')}`}
              >
                {isLoading ? <Loader2 size={20} className="animate-spin" /> : (input.trim() ? <Send size={20} strokeWidth={1.5} /> : <Mic size={20} strokeWidth={1.5} />)}
              </button>
            </div>
            <div className={`mt-4 flex justify-between items-center text-[9px] ${theme.textMuted} font-bold tracking-[0.2em] uppercase`}>
              <span className="flex items-center gap-2">
                aperte enter para enviar
                {workMode && <span className="text-amber-500/60 font-black tracking-widest">• MODO EXECUÇÃO</span>}
              </span>
              <span
                className={`flex items-center gap-1 cursor-pointer transition-colors duration-500 ${darkMode ? 'hover:text-white' : 'hover:text-black'}`}
                onClick={() => fileInputRef.current.click()}
              >
                <Plus size={10} /> Anexo
              </span>
            </div>
          </div>
        </footer>
      </main>

      <style dangerouslySetInnerHTML={{
        __html: `
        @keyframes rotate-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .orbit-rotate { animation: rotate-slow linear infinite; }
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: ${theme.scrollbar}; border-radius: 10px; }
        `
      }} />
    </div>
  );
}