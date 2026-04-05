import React, { useState, useRef, useEffect } from 'react';
import {
  Send, Loader2, Minus, Plus, Maximize2, Moon, Sun, MessageSquare, Hammer,
  Mic, FolderPlus, Folder, Check, X, Trash2, AlertTriangle, History,
  ChevronDown, GripVertical, PencilLine, Search, Share2
} from 'lucide-react';

// Corrigido: Substituição de import.meta por uma string vazia ou variável de ambiente segura
const API_BASE = "";

function getUserId() {
  let id = localStorage.getItem('solaris_user_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('solaris_user_id', id);
  }
  return id;
}
const USER_ID = getUserId();

function OrbitLine({ size, themeColor }) {
  return <div className={`absolute border ${themeColor} rounded-full ${size} transition-colors duration-500`}></div>;
}

function PlanetDot({ size, duration, color, glow }) {
  return (
    <div className={`absolute orbit-rotate ${size}`} style={{ animationDuration: duration }}>
      <div
        className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${color} w-1.5 h-1.5 shadow-sm transition-colors duration-500`}
        style={glow ? { boxShadow: glow } : {}}
      ></div>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Olá. Como posso ajudar?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('solaris_dark') === 'true');
  const [workMode, setWorkMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showShareToast, setShowShareToast] = useState(false);

  const [projects, setProjects] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);

  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [draggedItemId, setDraggedItemId] = useState(null);
  const [activeChatId, setActiveChatId] = useState(null);

  const [itemToDelete, setItemToDelete] = useState(null);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const hasUserStartedChat = messages.some(m => m.role === 'user');

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    localStorage.setItem('solaris_dark', darkMode);
  }, [darkMode]);

  // Carregar projetos do backend
  useEffect(() => {
    fetchProjects();
  }, []);

  async function fetchProjects() {
    if (!API_BASE) return;
    try {
      const res = await fetch(`${API_BASE}/projects`, { headers: { 'x-user-id': USER_ID } });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setProjects(data);
      if (data.length > 0 && !activeProjectId) setActiveProjectId(data[0].id);
    } catch (err) {
      console.error('Erro ao carregar projetos');
    }
  }

  // Carregar chats e mensagens quando projeto ativo mudar
  useEffect(() => {
    if (!activeProjectId || !API_BASE) return;
    setActiveChatId(null);
    setMessages([]);
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/projects/${activeProjectId}`, { headers: { 'x-user-id': USER_ID } });
        const data = await res.json();
        setChatHistory(data.chats || []);
        if (data.chats?.length > 0) {
          setActiveChatId(data.chats[0].id);
        } else {
          setMessages([{ role: 'assistant', content: 'Nenhum chat neste projeto. Crie um novo.' }]);
        }
      } catch (err) {
        console.error(err);
      }
    })();
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeChatId || !API_BASE) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/messages/chat/${activeChatId}`, { headers: { 'x-user-id': USER_ID } });
        const msgs = await res.json();
        setMessages(msgs.length === 0
          ? [{ role: 'assistant', content: 'Olá! Como posso ajudar neste projeto?' }]
          : msgs
        );
      } catch (err) {
        console.error(err);
      }
    })();
  }, [activeChatId]);

  const toggleDarkMode = () => setDarkMode(prev => !prev);

  const handleInput = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || !API_BASE) return;

    let chatId = activeChatId;

    if (!chatId) {
      if (!activeProjectId) return;
      try {
        const res = await fetch(`${API_BASE}/projects/${activeProjectId}/chats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID },
          body: JSON.stringify({ title: 'Nova conversa' }),
        });
        if (!res.ok) throw new Error('Falha ao criar chat');
        const newChat = await res.json();
        setChatHistory(prev => [newChat, ...prev]);
        setActiveChatId(newChat.id);
        chatId = newChat.id;
      } catch (err) {
        console.error(err);
        return;
      }
    }

    const userMessage = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID },
        body: JSON.stringify({ project_id: activeProjectId, chat_id: chatId, message: userMessage }),
      });
      if (!res.ok) throw new Error('Erro na API');
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);

      setTimeout(async () => {
        const projRes = await fetch(`${API_BASE}/projects/${activeProjectId}`, { headers: { 'x-user-id': USER_ID } });
        const projData = await projRes.json();
        setChatHistory(projData.chats || []);
      }, 500);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Lamento, ocorreu um erro na ligação.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleShare = () => {
    const chatText = messages
      .filter(m => m.role !== 'assistant' || m.content !== 'Olá. Como posso ajudar?')
      .map(m => `${m.role === 'user' ? 'VOCÊ' : 'SOLARIS'}: ${m.content}`)
      .join('\n\n');
    navigator.clipboard.writeText(chatText).catch(() => { });
    setShowShareToast(true);
    setTimeout(() => setShowShareToast(false), 3000);
  };

  const createProject = async () => {
    if (!newProjectName.trim() || !API_BASE) {
      setIsCreatingProject(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID },
        body: JSON.stringify({
          name: newProjectName.trim(),
          objective: '',
          response_style: 'direto',
          memory_mode: 'isolado'
        }),
      });
      const project = await res.json();
      setProjects([project, ...projects]);
      setNewProjectName('');
      setIsCreatingProject(false);
      setActiveProjectId(project.id);
    } catch (err) {
      console.error(err);
      setIsCreatingProject(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete || !API_BASE) return;
    const { type, data } = itemToDelete;
    try {
      if (type === 'project') {
        await fetch(`${API_BASE}/projects/${data.id}`, { method: 'DELETE', headers: { 'x-user-id': USER_ID } });
        const updated = projects.filter(p => p.id !== data.id);
        setProjects(updated);
        if (activeProjectId === data.id) {
          setActiveProjectId(updated.length > 0 ? updated[0].id : null);
          setChatHistory([]);
          setActiveChatId(null);
        }
      } else if (type === 'chat') {
        await fetch(`${API_BASE}/projects/${activeProjectId}/chats/${data.id}`, { method: 'DELETE', headers: { 'x-user-id': USER_ID } });
        const updated = chatHistory.filter(c => c.id !== data.id);
        setChatHistory(updated);
        if (activeChatId === data.id) {
          setActiveChatId(updated.length > 0 ? updated[0].id : null);
        }
      }
    } catch (err) {
      console.error(err);
    }
    setItemToDelete(null);
  };

  const onDragStart = (e, id) => {
    setDraggedItemId(id);
    e.dataTransfer.effectAllowed = "move";
    const target = e.currentTarget;
    setTimeout(() => { target.style.opacity = '0.4'; }, 0);
  };

  const onDragOver = (e, id) => {
    e.preventDefault();
    if (draggedItemId === null || draggedItemId === id) return;
    const draggedIdx = projects.findIndex(p => p.id === draggedItemId);
    const targetIdx = projects.findIndex(p => p.id === id);
    if (draggedIdx === -1 || targetIdx === -1) return;
    const newProjects = [...projects];
    const item = newProjects[draggedIdx];
    newProjects.splice(draggedIdx, 1);
    newProjects.splice(targetIdx, 0, item);
    setProjects(newProjects);
  };

  const onDragEnd = (e) => {
    e.currentTarget.style.opacity = '1';
    setDraggedItemId(null);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !activeProjectId || !API_BASE) return;
    e.target.value = '';
    const formData = new FormData();
    formData.append('file', file);
    try {
      await fetch(`${API_BASE}/files/${activeProjectId}`, {
        method: 'POST',
        headers: { 'x-user-id': USER_ID },
        body: formData,
      });
    } catch (err) {
      console.error(err);
    }
  };

  const theme = {
    bgAside: darkMode ? 'bg-[#0a0a0a]' : 'bg-white',
    bgMain: darkMode ? 'bg-[#111111]' : 'bg-[#fdfdfd]',
    border: darkMode ? 'border-white/10' : 'border-black/5',
    textPrimary: darkMode ? 'text-white/90' : 'text-[#1a1a1a]',
    textSecondary: darkMode ? 'text-white/40' : 'text-black/40',
    textMuted: darkMode ? 'text-white/20' : 'text-black/50',
    inputBorder: darkMode ? 'border-white/20' : 'border-black/10',
    inputFocus: darkMode ? 'focus-within:border-white' : 'focus-within:border-black',
    scrollbar: darkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
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
      className={`flex items-center justify-between p-2.5 -ml-2 rounded-lg cursor-grab active:cursor-grabbing transition-all group/item ${isActive ? theme.projectActive : theme.projectHover
        } ${draggedItemId === project.id ? 'bg-blue-500/10' : ''}`}
    >
      <div className="flex items-center gap-3 overflow-hidden pointer-events-none">
        <GripVertical size={12} className={`${theme.textMuted} opacity-0 group-hover/item:opacity-100 transition-opacity`} />
        <Folder size={14} className={isActive ? 'text-current opacity-60' : theme.textMuted} />
        <span className={`text-xs font-light truncate max-w-[120px] ${isActive ? 'font-normal' : theme.textSecondary}`}>
          {project.name}
        </span>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); setItemToDelete({ type: 'project', data: project }); }}
        className={`opacity-0 group-hover/item:opacity-100 p-1 hover:text-red-500 transition-all duration-200`}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );

  return (
    <div className={`flex h-screen ${darkMode ? 'bg-[#050505] text-white' : 'bg-[#fafafa] text-[#1a1a1a]'} font-sans antialiased overflow-hidden transition-colors duration-500`}>

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
                <button onClick={() => setItemToDelete(null)} className={`flex-1 py-3 rounded-xl border ${theme.border} text-xs font-bold uppercase tracking-widest hover:bg-black/5 dark:hover:bg-white/5 transition-colors`}>Cancelar</button>
                <button onClick={handleDeleteConfirm} className="flex-1 py-3 rounded-xl bg-red-500 text-white text-xs font-bold uppercase tracking-widest hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20">Eliminar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <aside className={`hidden lg:flex w-80 flex-col border-r ${theme.border} ${theme.bgAside} relative transition-colors duration-500 overflow-y-auto custom-scrollbar`}>

        <div className={`sticky top-0 z-20 px-8 pt-8 pb-6 flex flex-col gap-5 shrink-0 ${theme.bgAside} transition-colors duration-500`}>
          <button
            onClick={async () => {
              if (!activeProjectId || !API_BASE) return;
              try {
                const res = await fetch(`${API_BASE}/projects/${activeProjectId}/chats`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID },
                  body: JSON.stringify({ title: 'Nova conversa' }),
                });
                const newChat = await res.json();
                setChatHistory(prev => [newChat, ...prev]);
                setActiveChatId(newChat.id);
              } catch (err) {
                console.error(err);
              }
            }}
            className={`flex items-center gap-3 w-full transition-colors duration-500 ${theme.textPrimary} group`}
          >
            <PencilLine size={18} strokeWidth={1.2} />
            <span className="text-sm font-light">Novo Chat</span>
          </button>

          <div className="flex items-center gap-3 w-full">
            <Search size={18} strokeWidth={1.2} className={`${theme.textPrimary} transition-colors duration-500`} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar"
              className={`bg-transparent border-none p-0 text-sm font-light w-full focus:outline-none transition-colors duration-500 ${darkMode ? 'text-white placeholder:text-white' : 'text-black placeholder:text-black'}`}
            />
          </div>
        </div>

        <div className="px-8 flex flex-col transition-colors duration-500">
          <div className="relative w-full aspect-square flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity duration-700 mb-10 shrink-0">
            <div className={`w-6 h-6 ${darkMode ? 'bg-[#ffd700]' : 'bg-[#ffcc00]'} rounded-full z-10 shadow-[0_0_25px_rgba(255,204,0,0.3)] transition-colors duration-500`}></div>
            <OrbitLine size="w-16 h-16" themeColor={theme.orbit} />
            <OrbitLine size="w-24 h-24" themeColor={theme.orbit} />
            <OrbitLine size="w-32 h-32" themeColor={theme.orbit} />
            <OrbitLine size="w-44 h-44" themeColor={theme.orbit} />
            <OrbitLine size="w-56 h-56" themeColor={theme.orbit} />
            <PlanetDot size="w-16 h-16" duration="4s" color={darkMode ? 'bg-[#888]' : 'bg-[#666]'} />
            <PlanetDot size="w-24 h-24" duration="7s" color="bg-[#e3bb76]" />
            <PlanetDot size="w-32 h-32" duration="12s" color="bg-[#2271b3]" glow={darkMode ? "0_0_12px_#00ffff" : "0_0_8px_#00ffff"} />
            <PlanetDot size="w-44 h-44" duration="18s" color="bg-[#e27b58]" />
            <PlanetDot size="w-56 h-56" duration="30s" color="bg-[#d39c7e]" />
          </div>

          <div className="flex flex-col gap-4 mb-8 shrink-0">
            <h2 className={`text-[10px] font-light tracking-[0.4em] uppercase ${theme.textSecondary} transition-colors duration-500`}>PROJETOS</h2>

            {isCreatingProject ? (
              <div className={`flex items-center gap-2 p-2 -ml-2 rounded-lg border ${theme.inputBorder} animate-in fade-in zoom-in-95 duration-200 transition-colors duration-500`}>
                <input
                  autoFocus
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createProject()}
                  placeholder="Nome do projeto..."
                  className="bg-transparent border-none text-xs w-full focus:outline-none font-light transition-colors duration-500"
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
              {visibleProjects.map((project) => (
                <ProjectItem key={project.id} project={project} isActive={activeProjectId === project.id} />
              ))}
              {hiddenProjects.length > 0 && (
                <div className="relative group/more">
                  <button className={`w-full flex items-center justify-between p-2.5 -ml-2 rounded-lg transition-all duration-500 ${theme.projectHover} ${theme.textSecondary}`}>
                    <div className="flex items-center gap-3">
                      <Plus size={14} className="opacity-60" />
                      <span className="text-xs font-light">Mais ({hiddenProjects.length})</span>
                    </div>
                    <ChevronDown size={12} className="opacity-40 group-hover/more:rotate-180 transition-transform duration-300" />
                  </button>
                  <div className={`absolute left-0 top-full w-full z-50 pt-1 pointer-events-none group-hover/more:pointer-events-auto opacity-0 group-hover/more:opacity-100 transition-all duration-300 translate-y-2 group-hover/more:translate-y-0`}>
                    <div className={`${theme.dropdownBg} border ${theme.border} rounded-xl p-2 shadow-xl max-h-48 overflow-y-auto custom-scrollbar transition-colors duration-500`}>
                      {hiddenProjects.map((project) => (
                        <ProjectItem key={project.id} project={project} isActive={activeProjectId === project.id} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 mb-10 shrink-0">
            <h2 className={`text-[10px] font-light tracking-[0.4em] uppercase ${theme.textSecondary} transition-colors duration-500`}>SEUS CHATS</h2>
            <div className="flex flex-col gap-1">
              {filteredChats.map((chat) => (
                <div
                  key={chat.id}
                  onClick={() => setActiveChatId(chat.id)}
                  className={`flex items-center justify-between p-2 -ml-2 rounded-lg cursor-pointer transition-all duration-500 group/chat ${activeChatId === chat.id ? theme.projectActive : theme.projectHover
                    }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <History size={14} className={activeChatId === chat.id ? 'text-current opacity-60 transition-opacity duration-500' : `${theme.textMuted} transition-colors duration-500`} />
                    <span className={`text-xs font-light truncate max-w-[140px] transition-colors duration-500 ${activeChatId === chat.id ? 'font-normal' : theme.textSecondary}`}>
                      {chat.title}
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setItemToDelete({ type: 'chat', data: chat }); }}
                    className={`opacity-0 group-hover/chat:opacity-100 p-1 hover:text-red-500 transition-all duration-200`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-auto pt-4 shrink-0 transition-colors duration-500">
            <div className="mb-8 flex flex-col gap-3">
              <span className={`text-[9px] font-medium uppercase tracking-[0.3em] ${theme.textMuted} ml-1 transition-colors duration-500`}>Operação</span>
              <div className={`relative flex items-center p-1 rounded-full border ${theme.border} bg-black/5 dark:bg-white/5 h-11 w-full overflow-hidden transition-colors duration-500`}>
                <div className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-full transition-all duration-500 shadow-sm ${workMode ? 'translate-x-[calc(100%+0px)] bg-amber-500/10 border border-amber-500/20' : 'translate-x-0 bg-blue-500/10 border border-blue-500/20'}`} />
                <button onClick={() => setWorkMode(false)} className={`flex-1 relative flex items-center justify-center gap-2 text-[9px] font-bold uppercase tracking-widest z-10 transition-all duration-500 ${!workMode ? (darkMode ? 'text-blue-400 scale-105' : 'text-blue-700 scale-105') : 'text-gray-400 opacity-60'}`}><MessageSquare size={12} strokeWidth={workMode ? 1.5 : 2.5} /> Chat</button>
                <button onClick={() => setWorkMode(true)} className={`flex-1 relative flex items-center justify-center gap-2 text-[9px] font-bold uppercase tracking-widest z-10 transition-all duration-500 ${workMode ? (darkMode ? 'text-amber-400 scale-105' : 'text-amber-700 scale-105') : 'text-gray-400 opacity-60'}`}><Hammer size={12} strokeWidth={workMode ? 2.5 : 1.5} /> Obra</button>
              </div>
            </div>
            <div className={`h-[1px] ${theme.border} w-full mb-5 transition-colors duration-500`}></div>
            <div className="flex flex-col pb-6 transition-colors duration-500">
              <span className={`text-[8px] font-extralight uppercase tracking-[0.4em] ${darkMode ? 'text-white/20' : 'text-black/50'} mb-0.5 transition-colors duration-500`}>Criado por</span>
              <span className={`text-sm font-serif italic tracking-wide transition-colors duration-500 ${darkMode ? 'text-white/50' : 'text-black/80'}`} style={{ fontFamily: 'Georgia, "Apple Chancery", cursive' }}>felipe sant'oliver</span>
            </div>
          </div>
        </div>
      </aside>

      <main className={`flex-1 flex flex-col ${theme.bgMain} relative transition-colors duration-500`}>
        <header className={`h-20 flex items-center justify-between px-10 border-b ${theme.border} transition-colors duration-500`}>
          <div className="flex items-baseline gap-1">
            <span className="text-base font-medium tracking-tight">SOLARIS</span>
            <span className={`text-[10px] font-bold ${theme.textMuted} tracking-tighter transition-colors duration-500`}>V1</span>
          </div>
          <div className="flex items-center gap-6">
            <button onClick={toggleDarkMode} className={`transition-all duration-300 ${darkMode ? 'text-yellow-400 hover:text-yellow-200' : 'text-slate-400 hover:text-slate-600'}`}>{darkMode ? <Sun size={18} strokeWidth={1.5} /> : <Moon size={18} strokeWidth={1.5} />}</button>
            <div className={`flex gap-4 ${theme.textMuted} transition-colors duration-500`}><Minus size={16} className="cursor-pointer hover:text-current transition-colors duration-300" /><Maximize2 size={14} className="cursor-pointer hover:text-current transition-colors duration-300" /></div>
          </div>
        </header>

        <div className={`flex-1 relative overflow-y-auto px-6 md:px-20 py-10 space-y-12 custom-scrollbar transition-colors duration-500`}>
          {hasUserStartedChat && (
            <div className="sticky top-0 z-30 flex justify-end pointer-events-none mb-[-40px] animate-in fade-in zoom-in-95 duration-500">
              <button
                onClick={handleShare}
                className={`pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-full border ${theme.border} ${darkMode ? 'bg-white/5 hover:bg-white/10' : 'bg-black/5 hover:bg-black/10'} backdrop-blur-md transition-all duration-300 group shadow-sm`}
              >
                <Share2 size={14} className={`${theme.textSecondary} group-hover:text-current transition-colors duration-500`} />
                <span className={`text-[10px] font-bold uppercase tracking-widest ${theme.textSecondary} group-hover:text-current transition-colors duration-500`}>Compartilhar</span>
              </button>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-700`}>
              <div className={`max-w-[70%] ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                <div className={`text-[9px] uppercase tracking-[0.2em] font-bold mb-3 ${theme.textMuted} transition-colors duration-500`}>{msg.role === 'user' ? 'Solicitação' : 'Solaris'}</div>
                <div className={`text-base leading-relaxed transition-colors duration-500 ${msg.role === 'user' ? (darkMode ? 'text-white font-medium' : 'text-black font-medium') : (darkMode ? 'text-white/60 font-light' : 'text-gray-600 font-light')}`}>{msg.content}</div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex items-center gap-3">
              <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black'} rounded-full animate-bounce [animation-delay:-0.3s] transition-colors duration-500`}></div>
              <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black'} rounded-full animate-bounce [animation-delay:-0.15s] transition-colors duration-500`}></div>
              <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black'} rounded-full animate-bounce transition-colors duration-500`}></div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <footer className="p-10 transition-colors duration-500">
          <div className="max-w-3xl mx-auto relative">
            <div className={`relative flex items-end border-b ${theme.inputBorder} pb-4 ${theme.inputFocus} transition-all duration-500`}>
              <textarea ref={textareaRef} value={input} onChange={handleInput} onKeyDown={handleKeyDown} rows={1} placeholder={workMode ? "Descreva a tarefa..." : "O que deseja perguntar?"} className={`flex-1 bg-transparent border-none text-lg ${darkMode ? 'text-white placeholder-white/20' : 'text-black placeholder-black/20'} resize-none focus:outline-none py-2 font-light transition-colors duration-500`} />
              <button onClick={handleSend} disabled={isLoading} className={`p-2 transition-all duration-300 ${isLoading ? theme.textMuted : (darkMode ? 'text-white hover:scale-110' : 'text-black hover:scale-110')}`}>{isLoading ? <Loader2 size={20} className="animate-spin" /> : input.trim() ? <Send size={20} strokeWidth={1.5} /> : <Mic size={20} strokeWidth={1.5} />}</button>
            </div>
            <div className={`mt-4 flex justify-between items-center text-[9px] ${theme.textMuted} font-bold tracking-[0.2em] uppercase transition-colors duration-500`}>
              <span className="flex items-center gap-2">aperte enter para enviar {workMode && <span className="text-amber-500/60 font-black tracking-widest">• MODO EXECUÇÃO</span>}</span>
              <span
                onClick={() => fileInputRef.current?.click()}
                className={`flex items-center gap-1 cursor-pointer transition-colors duration-500 ${darkMode ? 'hover:text-white' : 'hover:text-black'}`}
              >
                <Plus size={10} /> Anexo
              </span>
            </div>
          </div>
        </footer>
      </main>

      <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} accept=".pdf,.docx,.txt,.md,.json,.js,.ts,.py,.css,.html,.csv" />

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