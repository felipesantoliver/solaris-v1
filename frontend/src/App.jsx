import React, { useState, useRef, useEffect } from 'react';
import {
  Send, Loader2, Plus, Moon, Sun,
  Mic, FolderPlus, Folder, Check, X, Trash2, AlertTriangle, History,
  GripVertical, PencilLine, Search, Share2, PanelLeft, LogIn, LogOut, User
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const API_BASE = import.meta.env.VITE_API_BASE || 'https://solaris-backend-s7vm.onrender.com/api';

// ─── ID do usuário (visitante ou autenticado) ─────────────────────────────────
function getGuestId() {
  let id = localStorage.getItem('solaris_guest_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('solaris_guest_id', id);
  }
  return id;
}

// ─── Helpers visuais ──────────────────────────────────────────────────────────
function OrbitLine({ size, themeColor }) {
  return <div className={`absolute border ${themeColor} rounded-full ${size} transition-colors duration-500`}></div>;
}

function PlanetDot({ size, duration, color, glow, dotSize = 'w-1.5 h-1.5', hasRing = false, darkMode = true }) {
  return (
    <div className={`absolute orbit-rotate ${size}`} style={{ animationDuration: duration }}>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
        <div
          className={`relative z-10 rounded-full ${color} ${dotSize} shadow-sm transition-colors duration-500`}
          style={glow ? { boxShadow: glow } : {}}
        ></div>
        {hasRing && (
          <div
            className={`absolute border-[1px] ${darkMode ? 'border-white/20' : 'border-black/20'} rounded-[100%] w-[260%] h-[120%] rotate-[25deg]`}
            style={{
              boxShadow: darkMode ? '0 0 4px rgba(255,255,255,0.1)' : '0 0 4px rgba(0,0,0,0.05)',
              background: darkMode
                ? 'radial-gradient(ellipse at center, transparent 40%, rgba(255,255,255,0.05) 45%, rgba(255,255,255,0.1) 50%, transparent 60%)'
                : 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.02) 45%, rgba(0,0,0,0.05) 50%, transparent 60%)'
            }}
          ></div>
        )}
      </div>
    </div>
  );
}

// ─── Modal de Auth ────────────────────────────────────────────────────────────
function AuthModal({ onClose, darkMode, onAuthSuccess }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const theme = {
    bg: darkMode ? 'bg-[#1a1a1a]' : 'bg-white',
    border: darkMode ? 'border-white/10' : 'border-black/8',
    text: darkMode ? 'text-white/90' : 'text-[#1a1a1a]',
    muted: darkMode ? 'text-white/40' : 'text-black/50',
    input: darkMode ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-black/3 border-black/10 text-black placeholder-black/30',
    btn: darkMode ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/90',
    google: darkMode ? 'border-white/10 hover:bg-white/5 text-white/80' : 'border-black/10 hover:bg-black/5 text-black/70',
    tab: darkMode ? 'text-white/30 hover:text-white/60' : 'text-black/30 hover:text-black/60',
    tabActive: darkMode ? 'text-white border-b border-white' : 'text-black border-b border-black',
  };

  async function handleGoogle() {
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) { setError(error.message); setLoading(false); }
  }

  async function handleSubmit() {
    setLoading(true); setError(''); setInfo('');
    if (mode === 'register') {
      if (!displayName.trim()) { setError('Informe como quer ser chamado.'); setLoading(false); return; }
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { display_name: displayName.trim() } },
      });
      if (error) { setError(error.message); setLoading(false); return; }
      if (data.user && !data.session) {
        setInfo('Verifique seu email para confirmar o cadastro.');
        setLoading(false); return;
      }
      onAuthSuccess(data.user);
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setError(error.message); setLoading(false); return; }
      onAuthSuccess(data.user);
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`${theme.bg} border ${theme.border} w-full max-w-sm rounded-2xl p-8 shadow-2xl`}>
        {/* Tabs */}
        <div className="flex gap-6 mb-8">
          <button
            onClick={() => { setMode('login'); setError(''); setInfo(''); }}
            className={`text-sm font-light pb-1 transition-all ${mode === 'login' ? theme.tabActive : theme.tab}`}
          >Entrar</button>
          <button
            onClick={() => { setMode('register'); setError(''); setInfo(''); }}
            className={`text-sm font-light pb-1 transition-all ${mode === 'register' ? theme.tabActive : theme.tab}`}
          >Criar conta</button>
          <button onClick={onClose} className={`ml-auto ${theme.muted} hover:text-current`}><X size={16} /></button>
        </div>

        <div className="flex flex-col gap-3">
          {/* Google */}
          <button
            onClick={handleGoogle}
            disabled={loading}
            className={`flex items-center justify-center gap-3 w-full py-3 rounded-xl border ${theme.google} text-sm font-light transition-all`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continuar com Google
          </button>

          <div className={`flex items-center gap-3 my-1 ${theme.muted}`}>
            <div className="flex-1 h-px bg-current opacity-20"></div>
            <span className="text-xs">ou</span>
            <div className="flex-1 h-px bg-current opacity-20"></div>
          </div>

          {/* Nome (só no cadastro) */}
          {mode === 'register' && (
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Como quer ser chamado?"
              className={`w-full px-4 py-3 rounded-xl border text-sm font-light focus:outline-none ${theme.input}`}
            />
          )}

          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email"
            className={`w-full px-4 py-3 rounded-xl border text-sm font-light focus:outline-none ${theme.input}`}
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="Senha"
            className={`w-full px-4 py-3 rounded-xl border text-sm font-light focus:outline-none ${theme.input}`}
          />

          {error && <p className="text-red-400 text-xs">{error}</p>}
          {info && <p className="text-emerald-400 text-xs">{info}</p>}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className={`w-full py-3 rounded-xl text-sm font-medium transition-all mt-1 ${theme.btn}`}
          >
            {loading ? <Loader2 size={16} className="animate-spin mx-auto" /> : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── App principal ────────────────────────────────────────────────────────────
export default function App() {
  const [messages, setMessages] = useState([{ role: 'assistant', content: 'Olá. Como posso ajudar?' }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('solaris_dark') !== 'false');
  const [searchQuery, setSearchQuery] = useState('');
  const [showShareToast, setShowShareToast] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [projects, setProjects] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [draggedItemId, setDraggedItemId] = useState(null);
  const [activeChatId, setActiveChatId] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);

  // Auth
  const [authUser, setAuthUser] = useState(null);  // Supabase user ou null
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const hasUserStartedChat = messages.some(m => m.role === 'user');

  // ID efetivo usado nas chamadas ao backend
  const effectiveUserId = authUser?.id || getGuestId();
  const displayName = authUser?.user_metadata?.display_name
    || authUser?.user_metadata?.full_name
    || authUser?.email?.split('@')[0]
    || null;

  // ── Supabase Auth listener ──────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthUser(session?.user ?? null);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Migra dados do visitante para a conta ao fazer login
  async function migrateGuestData(userId) {
    const guestId = localStorage.getItem('solaris_guest_id');
    if (!guestId || guestId === userId) return;
    try {
      await fetch(`${API_BASE}/migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest_id: guestId, user_id: userId }),
      });
    } catch { /* silencioso */ }
  }

  async function handleAuthSuccess(user) {
    await migrateGuestData(user.id);
    setAuthUser(user);
    setShowAuthModal(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setAuthUser(null);
    setProjects([]);
    setChatHistory([]);
    setActiveChatId(null);
    setActiveProjectId(null);
    setMessages([{ role: 'assistant', content: 'Olá. Como posso ajudar?' }]);
  }

  // ── Scroll e dark mode ──────────────────────────────────────────────────────
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isLoading]);
  useEffect(() => { localStorage.setItem('solaris_dark', darkMode); }, [darkMode]);

  // ── Ping health ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const ping = () => fetch(`${API_BASE}/health`).catch(() => { });
    ping();
    const interval = setInterval(ping, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Projetos ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authReady) return;
    fetchProjects();
  }, [authReady, effectiveUserId]);

  async function fetchProjects() {
    try {
      const res = await fetch(`${API_BASE}/projects`, { headers: { 'x-user-id': effectiveUserId } });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setProjects(data || []);
      if (data?.length > 0 && !activeProjectId) setActiveProjectId(data[0].id);
    } catch { setProjects([]); }
  }

  useEffect(() => {
    if (!activeProjectId) return;
    setActiveChatId(null);
    setMessages([]);
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/projects/${activeProjectId}`, { headers: { 'x-user-id': effectiveUserId } });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setChatHistory(data.chats || []);
        if (data.chats?.length > 0) setActiveChatId(data.chats[0].id);
        else setMessages([{ role: 'assistant', content: 'Nenhum chat neste projeto. Crie um novo.' }]);
      } catch { setChatHistory([]); }
    })();
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeChatId) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/messages/chat/${activeChatId}`, { headers: { 'x-user-id': effectiveUserId } });
        if (!res.ok) throw new Error();
        const msgs = await res.json();
        setMessages(msgs.length === 0
          ? [{ role: 'assistant', content: 'Olá! Como posso ajudar neste projeto?' }]
          : msgs
        );
      } catch { }
    })();
  }, [activeChatId]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleInput = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    let chatId = activeChatId;
    let projectId = activeProjectId;

    if (!projectId) {
      try {
        const res = await fetch(`${API_BASE}/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-id': effectiveUserId },
          body: JSON.stringify({ name: 'Geral', objective: '', response_style: 'direto', memory_mode: 'isolado' }),
        });
        const np = await res.json();
        setProjects(prev => [np, ...prev]);
        setActiveProjectId(np.id);
        projectId = np.id;
      } catch (err) { console.error(err); return; }
    }
    if (!chatId) {
      try {
        const res = await fetch(`${API_BASE}/projects/${projectId}/chats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-id': effectiveUserId },
          body: JSON.stringify({ title: 'Nova conversa' }),
        });
        const nc = await res.json();
        setChatHistory(prev => [nc, ...prev]);
        setActiveChatId(nc.id);
        chatId = nc.id;
      } catch (err) { console.error(err); return; }
    }

    const userMessage = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': effectiveUserId },
        body: JSON.stringify({ project_id: projectId, chat_id: chatId, message: userMessage }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Erro ao conectar com o servidor.' }]);
    } finally { setIsLoading(false); }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleShare = () => {
    const text = messages
      .filter(m => m.role !== 'assistant' || m.content !== 'Olá. Como posso ajudar?')
      .map(m => `${m.role === 'user' ? 'VOCÊ' : 'SOLARIS'}: ${m.content}`)
      .join('\n\n');
    navigator.clipboard.writeText(text).catch(() => { });
    setShowShareToast(true);
    setTimeout(() => setShowShareToast(false), 3000);
  };

  const createProject = async () => {
    if (!newProjectName.trim()) { setIsCreatingProject(false); return; }
    try {
      const res = await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': effectiveUserId },
        body: JSON.stringify({ name: newProjectName.trim(), objective: '', response_style: 'direto', memory_mode: 'isolado' }),
      });
      const p = await res.json();
      setProjects([p, ...projects]);
      setNewProjectName('');
      setIsCreatingProject(false);
      setActiveProjectId(p.id);
    } catch (err) { console.error(err); }
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;
    const { type, data } = itemToDelete;
    try {
      if (type === 'project') {
        await fetch(`${API_BASE}/projects/${data.id}`, { method: 'DELETE', headers: { 'x-user-id': effectiveUserId } });
        const updated = projects.filter(p => p.id !== data.id);
        setProjects(updated);
        if (activeProjectId === data.id) {
          setActiveProjectId(updated.length > 0 ? updated[0].id : null);
          setChatHistory([]); setActiveChatId(null);
        }
      } else {
        await fetch(`${API_BASE}/projects/${activeProjectId}/chats/${data.id}`, { method: 'DELETE', headers: { 'x-user-id': effectiveUserId } });
        const updated = chatHistory.filter(c => c.id !== data.id);
        setChatHistory(updated);
        if (activeChatId === data.id) setActiveChatId(updated.length > 0 ? updated[0].id : null);
      }
    } catch (err) { console.error(err); }
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

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !activeProjectId) return;
    e.target.value = '';
    const formData = new FormData();
    formData.append('file', file);
    try {
      await fetch(`${API_BASE}/files/${activeProjectId}`, {
        method: 'POST',
        headers: { 'x-user-id': effectiveUserId },
        body: formData,
      });
    } catch (err) { console.error(err); }
  };

  // ── Tema ────────────────────────────────────────────────────────────────────
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

  const visibleProjects = projects.slice(0, 3);
  const filteredChats = searchQuery.trim()
    ? chatHistory.filter(c => c.title?.toLowerCase().includes(searchQuery.toLowerCase()))
    : chatHistory;

  // ── ProjectItem ─────────────────────────────────────────────────────────────
  const ProjectItem = ({ project, isActive }) => (
    <div
      draggable
      onDragStart={e => onDragStart(e, project.id)}
      onDragOver={e => onDragOver(e, project.id)}
      onDragEnd={onDragEnd}
      onClick={() => setActiveProjectId(project.id)}
      className={`flex items-center justify-between p-2.5 -ml-2 rounded-lg cursor-grab active:cursor-grabbing transition-all group/item ${isActive ? theme.projectActive : theme.projectHover} ${draggedItemId === project.id ? 'bg-blue-500/10' : ''}`}
    >
      <div className="flex items-center gap-3 overflow-hidden pointer-events-none text-left">
        <GripVertical size={12} className={`${theme.textMuted} opacity-0 group-hover/item:opacity-100 transition-opacity`} />
        <Folder size={14} className={isActive ? 'text-current opacity-60' : theme.textMuted} />
        <span className={`text-xs font-light truncate max-w-[100px] ${isActive ? 'font-normal' : theme.textSecondary}`}>{project.name}</span>
      </div>
      <button
        onClick={e => { e.stopPropagation(); setItemToDelete({ type: 'project', data: project }); }}
        className="opacity-0 group-hover/item:opacity-100 p-1 hover:text-red-500 transition-all duration-200"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={`flex h-screen ${darkMode ? 'bg-[#050505] text-white' : 'bg-[#fafafa] text-[#1a1a1a]'} font-sans antialiased overflow-hidden transition-colors duration-500`}>

      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal
          darkMode={darkMode}
          onClose={() => setShowAuthModal(false)}
          onAuthSuccess={handleAuthSuccess}
        />
      )}

      {/* Share Toast */}
      <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-[110] px-6 py-3 rounded-full bg-emerald-500 text-white text-xs font-bold tracking-widest uppercase shadow-2xl transition-all duration-500 ${showShareToast ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
        Chat copiado para a área de transferência
      </div>

      {/* Delete Modal */}
      {itemToDelete && (
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300`}>
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

      {/* ── Sidebar ── */}
      <aside className={`hidden lg:flex flex-col border-r ${theme.border} ${theme.bgAside} relative transition-all duration-500 ease-in-out shrink-0 ${isSidebarOpen ? 'w-72' : 'w-20'}`}>
        <div className={`flex flex-col h-full overflow-hidden transition-all duration-500 ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <div className="px-8 pt-12 pb-6 flex flex-col gap-5 shrink-0">
            {/* Novo Chat */}
            <button
              onClick={async () => {
                if (!activeProjectId) return;
                try {
                  const res = await fetch(`${API_BASE}/projects/${activeProjectId}/chats`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-user-id': effectiveUserId },
                    body: JSON.stringify({ title: 'Nova conversa' }),
                  });
                  const nc = await res.json();
                  setChatHistory(prev => [nc, ...prev]);
                  setActiveChatId(nc.id);
                } catch (err) { console.error(err); }
              }}
              className={`flex items-center gap-3 w-full text-left transition-colors duration-500 ${theme.textPrimary} group`}
            >
              <PencilLine size={18} strokeWidth={1.2} />
              <span className="text-sm font-light">Novo Chat</span>
            </button>

            {/* Busca */}
            <div className="flex items-center gap-3 w-full">
              <Search size={18} strokeWidth={1.2} className={theme.textPrimary} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar"
                className={`bg-transparent border-none p-0 text-sm font-light w-full focus:outline-none ${darkMode ? 'text-white placeholder:text-white/20' : 'text-black placeholder:text-black/30'}`}
              />
            </div>
          </div>

          <div className="px-8 flex flex-col flex-1 overflow-y-auto custom-scrollbar">
            {/* Sistema Solar */}
            <div className="relative w-full aspect-square flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity duration-700 mb-10 shrink-0">
              <div className={`w-6 h-6 ${darkMode ? 'bg-[#ffd700]' : 'bg-[#ffcc00] border border-amber-600/10'} rounded-full z-10 shadow-[0_0_25px_rgba(255,204,0,0.3)]`}></div>
              <OrbitLine size="w-10 h-10" themeColor={theme.orbit} />
              <OrbitLine size="w-14 h-14" themeColor={theme.orbit} />
              <OrbitLine size="w-20 h-20" themeColor={theme.orbit} />
              <OrbitLine size="w-24 h-24" themeColor={theme.orbit} />
              <OrbitLine size="w-32 h-32" themeColor={theme.orbit} />
              <OrbitLine size="w-40 h-40" themeColor={theme.orbit} />
              <OrbitLine size="w-48 h-48" themeColor={theme.orbit} />
              <OrbitLine size="w-56 h-56" themeColor={theme.orbit} />
              <PlanetDot size="w-10 h-10" duration="3s" color={darkMode ? 'bg-[#888]' : 'bg-[#666]'} dotSize="w-1 h-1" />
              <PlanetDot size="w-14 h-14" duration="5s" color="bg-[#e3bb76]" />
              <PlanetDot size="w-20 h-20" duration="8s" color="bg-[#2271b3]" glow={darkMode ? '0 0 12px #00ffff' : '0 0 8px rgba(0,255,255,0.4)'} />
              <PlanetDot size="w-24 h-24" duration="12s" color="bg-[#e27b58]" dotSize="w-1 h-1" />
              <PlanetDot size="w-32 h-32" duration="20s" color="bg-[#d39c7e]" dotSize="w-2.5 h-2.5" />
              <PlanetDot size="w-40 h-40" duration="28s" color="bg-[#eadaa4]" dotSize="w-2 h-2" hasRing darkMode={darkMode} />
              <PlanetDot size="w-48 h-48" duration="36s" color="bg-[#a6d1e6]" />
              <PlanetDot size="w-56 h-56" duration="45s" color="bg-[#4b70dd]" />
            </div>

            {/* Projetos */}
            <div className="flex flex-col gap-4 mb-8 shrink-0">
              <h2 className={`text-[10px] font-light tracking-[0.4em] uppercase ${theme.textSecondary}`}>PROJETOS</h2>
              {isCreatingProject ? (
                <div className={`flex items-center gap-2 p-2 -ml-2 rounded-lg border ${theme.inputBorder}`}>
                  <input
                    autoFocus
                    type="text"
                    value={newProjectName}
                    onChange={e => setNewProjectName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && createProject()}
                    placeholder="..."
                    className="bg-transparent border-none text-xs w-full focus:outline-none font-light"
                  />
                  <button onClick={createProject} className="text-emerald-500"><Check size={14} /></button>
                  <button onClick={() => setIsCreatingProject(false)} className="text-red-400"><X size={14} /></button>
                </div>
              ) : (
                <button
                  onClick={() => setIsCreatingProject(true)}
                  className={`flex items-center gap-3 p-2 -ml-2 rounded-lg text-left transition-all ${theme.projectHover} group`}
                >
                  <FolderPlus size={18} className={`${theme.textSecondary} group-hover:text-current`} strokeWidth={1.5} />
                  <span className={`text-sm font-light ${theme.textPrimary}`}>Novo projeto</span>
                </button>
              )}
              <div className="flex flex-col gap-1">
                {visibleProjects.map(p => <ProjectItem key={p.id} project={p} isActive={activeProjectId === p.id} />)}
              </div>
            </div>

            {/* Conversas */}
            <div className="flex flex-col gap-4 mb-10 shrink-0">
              <h2 className={`text-[10px] font-light tracking-[0.4em] uppercase ${theme.textSecondary}`}>CONVERSAS</h2>
              <div className="flex flex-col gap-1">
                {filteredChats.map(chat => (
                  <div
                    key={chat.id}
                    onClick={() => setActiveChatId(chat.id)}
                    className={`flex items-center justify-between p-2 -ml-2 rounded-lg cursor-pointer transition-all group/chat ${activeChatId === chat.id ? theme.projectActive : theme.projectHover}`}
                  >
                    <div className="flex items-center gap-3 overflow-hidden text-left">
                      <History size={14} className={activeChatId === chat.id ? 'text-current opacity-60' : theme.textMuted} />
                      <span className={`text-xs font-light truncate max-w-[120px] ${activeChatId === chat.id ? 'font-normal' : theme.textSecondary}`}>{chat.title}</span>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); setItemToDelete({ type: 'chat', data: chat }); }}
                      className="opacity-0 group-hover/chat:opacity-100 p-1 hover:text-red-500 transition-all duration-200"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer da sidebar */}
          <div className={`px-8 shrink-0 border-t ${theme.border}`}>
            {/* Nome do usuário (quando logado) */}
            {displayName && (
              <div className={`pt-4 pb-2 flex items-center gap-2 ${theme.textSecondary}`}>
                <User size={12} strokeWidth={1.5} />
                <span className="text-xs font-light truncate">{displayName}</span>
              </div>
            )}
            <div className="flex flex-col py-4">
              <span className={`text-[8px] font-extralight uppercase tracking-[0.4em] ${darkMode ? 'text-white/20' : 'text-black/30'} mb-0.5`}>Criado por</span>
              <span className={`text-sm font-serif italic tracking-wide ${darkMode ? 'text-white/50' : 'text-black/60'}`} style={{ fontFamily: 'Georgia, "Apple Chancery", cursive' }}>felipe sant'oliver</span>
            </div>
          </div>
        </div>

        {/* Rail Mode */}
        {!isSidebarOpen && (
          <div className="flex-1 flex flex-col items-center pt-12 gap-8 animate-in fade-in duration-700">
            <div className={`w-8 h-8 rounded-full border ${theme.orbit} flex items-center justify-center animate-pulse`}>
              <div className={`w-1.5 h-1.5 rounded-full ${darkMode ? 'bg-white/40' : 'bg-black/30'}`}></div>
            </div>
            <div className="flex flex-col gap-6 items-center">
              <PencilLine size={18} strokeWidth={1.5} className={theme.textMuted} />
              <History size={18} strokeWidth={1.5} className={theme.textMuted} />
              <Folder size={18} strokeWidth={1.5} className={theme.textMuted} />
            </div>
          </div>
        )}
      </aside>

      {/* ── Main ── */}
      <main className={`flex-1 flex flex-col ${theme.bgMain} relative transition-colors duration-500`}>
        <header className={`h-20 flex items-center justify-between px-6 md:px-10 border-b ${theme.border} transition-colors duration-500`}>
          <div className="flex items-center gap-6">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className={`p-2 rounded-lg transition-all duration-300 ${darkMode ? 'text-white/60 hover:text-white hover:bg-white/5' : 'text-black/40 hover:text-black hover:bg-black/5'}`}
            >
              <PanelLeft size={20} strokeWidth={1.5} />
            </button>
            <div className="flex items-baseline gap-1 select-none">
              <span className="text-base font-medium tracking-tight">SOLARIS</span>
              <span className={`text-[10px] font-bold ${theme.textMuted} tracking-tighter`}>V1</span>
            </div>
          </div>

          {/* Ações do header */}
          <div className="flex items-center gap-4">
            <button onClick={() => setDarkMode(d => !d)} className={`transition-all duration-300 ${darkMode ? 'text-yellow-400 hover:text-yellow-200' : 'text-slate-400 hover:text-slate-600'}`}>
              {darkMode ? <Sun size={18} strokeWidth={1.5} /> : <Moon size={18} strokeWidth={1.5} />}
            </button>

            {/* Auth button */}
            {authUser ? (
              <button
                onClick={handleLogout}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${theme.border} text-xs font-light transition-all ${theme.textSecondary} hover:text-red-400 hover:border-red-400/20`}
                title="Sair"
              >
                <LogOut size={14} strokeWidth={1.5} />
                <span className="hidden sm:inline">Sair</span>
              </button>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${theme.border} text-xs font-light transition-all ${theme.textSecondary} hover:text-current hover:border-current`}
              >
                <LogIn size={14} strokeWidth={1.5} />
                <span className="hidden sm:inline">Entrar</span>
              </button>
            )}
          </div>
        </header>

        {/* Mensagens */}
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
                <div className={`text-[9px] uppercase tracking-[0.2em] font-bold mb-3 ${theme.textMuted}`}>{msg.role === 'user' ? 'Usuário' : 'Solaris'}</div>
                <div className={`text-base leading-relaxed transition-colors duration-500 ${msg.role === 'user' ? (darkMode ? 'text-white font-medium' : 'text-black font-medium') : (darkMode ? 'text-white/60 font-light' : 'text-gray-600 font-light')}`}>{msg.content}</div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center gap-3">
              <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black/60'} rounded-full animate-bounce [animation-delay:-0.3s]`}></div>
              <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black/60'} rounded-full animate-bounce [animation-delay:-0.15s]`}></div>
              <div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black/60'} rounded-full animate-bounce`}></div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <footer className="p-10 pt-4">
          <div className="max-w-3xl mx-auto relative">
            <div className={`relative flex items-end border-b ${theme.inputBorder} pb-8 ${theme.inputFocus} transition-all duration-500`}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="O que deseja perguntar?"
                className={`flex-1 bg-transparent border-none text-lg ${darkMode ? 'text-white placeholder-white/20' : 'text-black placeholder-black/30'} resize-none focus:outline-none py-2 font-light`}
              />
              <button
                onClick={handleSend}
                disabled={isLoading}
                className={`p-2 mb-3 transition-all duration-300 ${isLoading ? theme.textMuted : (darkMode ? 'text-white hover:scale-110' : 'text-black hover:scale-110')}`}
              >
                {isLoading ? <Loader2 size={20} className="animate-spin" /> : input.trim() ? <Send size={20} strokeWidth={1.5} /> : <Mic size={20} strokeWidth={1.5} />}
              </button>
            </div>
            <div className={`mt-5 flex justify-between items-center text-[9px] ${theme.textMuted} font-bold tracking-[0.2em] uppercase transition-colors duration-500`}>
              <span>aperte enter para enviar</span>
              <span
                onClick={() => fileInputRef.current?.click()}
                className={`flex items-center gap-3 cursor-pointer transition-colors duration-500 mb-2 ${darkMode ? 'hover:text-white' : 'hover:text-black'}`}
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
      ` }} />
    </div>
  );
}