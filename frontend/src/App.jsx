import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Loader2, Plus, Moon, Sun, Mic, FolderPlus, Folder, Check, X,
  Trash2, AlertTriangle, History, GripVertical, PencilLine, Search,
  Share2, PanelLeft, LogIn, LogOut, User, ChevronDown, Pencil,
  RotateCcw, Settings, Save, Zap, Star, Globe, FileText
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
const API_BASE = import.meta.env.VITE_API_BASE || 'https://solaris-backend-s7vm.onrender.com/api';

function getGuestId() {
  let id = localStorage.getItem('solaris_guest_id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('solaris_guest_id', id); }
  return id;
}

async function safeJson(res) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    throw new Error(`Servidor indisponível (${res.status}). Aguarde alguns segundos e tente novamente.`);
  }
  return res.json();
}

// ─── Solar System ──────────────────────────────────────────────────────────
function OrbitLine({ size, themeColor }) {
  return <div className={`absolute border ${themeColor} rounded-full ${size} transition-colors duration-500`} />;
}

function PlanetDot({ size, duration, color, glow, dotSize = 'w-1.5 h-1.5', hasRing = false, darkMode = true }) {
  return (
    <div className={`absolute orbit-rotate ${size}`} style={{ animationDuration: duration }}>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
        <div
          className={`relative z-10 rounded-full ${color} ${dotSize} shadow-sm transition-colors duration-500`}
          style={glow ? { boxShadow: glow } : {}}
        />
        {hasRing && (
          <div style={{
            position: 'absolute', width: '260%', height: '120%',
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)'}`,
            borderRadius: '100%', transform: 'rotate(25deg)',
            background: darkMode
              ? 'radial-gradient(ellipse at center, transparent 38%, rgba(255,255,255,0.06) 44%, rgba(255,255,255,0.12) 50%, transparent 58%)'
              : 'radial-gradient(ellipse at center, transparent 38%, rgba(0,0,0,0.03) 44%, rgba(0,0,0,0.07) 50%, transparent 58%)',
            boxShadow: darkMode ? '0 0 5px rgba(255,255,255,0.12)' : '0 0 5px rgba(0,0,0,0.06)',
          }} />
        )}
      </div>
    </div>
  );
}

// ─── Model Toggle ──────────────────────────────────────────────────────────
function ModelToggle({ model, onChange, authUser, darkMode }) {
  const isPro = model === 'pro';
  if (!authUser) {
    return (
      <div className="mb-3" title="Faça login para usar o modo Pro">
        <button disabled className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium uppercase tracking-widest opacity-30 cursor-not-allowed ${darkMode ? 'border-white/10 text-white/40' : 'border-black/10 text-black/40'}`}>
          <Zap size={10} />Flash
        </button>
      </div>
    );
  }
  return (
    <div className="mb-3 flex items-center gap-1">
      <button onClick={() => onChange('flash')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium uppercase tracking-widest transition-all ${!isPro ? (darkMode ? 'border-white/60 text-white bg-white/10' : 'border-black/60 text-black bg-black/8') : (darkMode ? 'border-white/10 text-white/30 hover:text-white/60' : 'border-black/10 text-black/30 hover:text-black/60')}`}><Zap size={10} />Flash</button>
      <button onClick={() => onChange('pro')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium uppercase tracking-widest transition-all ${isPro ? 'border-amber-400/80 text-amber-400 bg-amber-400/10' : (darkMode ? 'border-white/10 text-white/30 hover:text-amber-400/60 hover:border-amber-400/30' : 'border-black/10 text-black/30 hover:text-amber-500/60 hover:border-amber-400/30')}`}><Star size={10} />Pro</button>
    </div>
  );
}

// ─── Auth Modal ────────────────────────────────────────────────────────────
function AuthModal({ onClose, darkMode, onAuthSuccess }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const t = {
    bg: darkMode ? 'bg-[#1a1a1a]' : 'bg-white',
    border: darkMode ? 'border-white/10' : 'border-black/8',
    muted: darkMode ? 'text-white/40' : 'text-black/50',
    input: darkMode ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-black/3 border-black/10 text-black placeholder-black/30',
    btn: darkMode ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/90',
    google: darkMode ? 'border-white/10 hover:bg-white/5 text-white/80' : 'border-black/10 hover:bg-black/5 text-black/70',
    tab: darkMode ? 'text-white/30 hover:text-white/60' : 'text-black/30 hover:text-black/60',
    tabActive: darkMode ? 'text-white border-b border-white' : 'text-black border-b border-black',
  };

  async function handleGoogle() {
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) { setError(error.message); setLoading(false); }
  }

  async function handleSubmit() {
    setLoading(true); setError(''); setInfo('');
    if (mode === 'register') {
      if (!displayName.trim()) { setError('Informe como quer ser chamado.'); setLoading(false); return; }
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName.trim() } } });
      if (error) { setError(error.message); setLoading(false); return; }
      if (data.user && !data.session) { setInfo('Verifique seu email.'); setLoading(false); return; }
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
      <div className={`${t.bg} border ${t.border} w-full max-w-sm rounded-2xl p-8 shadow-2xl`}>
        <div className="flex gap-6 mb-8">
          <button onClick={() => { setMode('login'); setError(''); setInfo(''); }} className={`text-sm font-light pb-1 transition-all ${mode === 'login' ? t.tabActive : t.tab}`}>Entrar</button>
          <button onClick={() => { setMode('register'); setError(''); setInfo(''); }} className={`text-sm font-light pb-1 transition-all ${mode === 'register' ? t.tabActive : t.tab}`}>Criar conta</button>
          <button onClick={onClose} className={`ml-auto ${t.muted} hover:text-current`}><X size={16} /></button>
        </div>
        <div className="flex flex-col gap-3">
          <button onClick={handleGoogle} disabled={loading} className={`flex items-center justify-center gap-3 w-full py-3 rounded-xl border ${t.google} text-sm font-light transition-all`}>
            <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
            Continuar com Google
          </button>
          <div className={`flex items-center gap-3 my-1 ${t.muted}`}><div className="flex-1 h-px bg-current opacity-20" /><span className="text-xs">ou</span><div className="flex-1 h-px bg-current opacity-20" /></div>
          {mode === 'register' && (<input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Como quer ser chamado?" className={`w-full px-4 py-3 rounded-xl border text-sm font-light focus:outline-none ${t.input}`} />)}
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className={`w-full px-4 py-3 rounded-xl border text-sm font-light focus:outline-none ${t.input}`} />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} placeholder="Senha" className={`w-full px-4 py-3 rounded-xl border text-sm font-light focus:outline-none ${t.input}`} />
          {error && <p className="text-red-400 text-xs">{error}</p>}{info && <p className="text-emerald-400 text-xs">{info}</p>}
          <button onClick={handleSubmit} disabled={loading} className={`w-full py-3 rounded-xl text-sm font-medium transition-all mt-1 ${t.btn}`}>{loading ? <Loader2 size={16} className="animate-spin mx-auto" /> : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Modal (personalidade global) ─────────────────────────────────
const PERSONALITIES = [
  { id: 'direto', label: 'Direto', desc: 'Respostas curtas e objetivas, sem rodeios.' },
  { id: 'tecnico', label: 'Técnico', desc: 'Terminologia precisa e detalhes de implementação.' },
  { id: 'analitico', label: 'Analítico', desc: 'Análise profunda, prós e contras.' },
  { id: 'estrategico', label: 'Estratégico', desc: 'Visão macro, planejamento e longo prazo.' },
  { id: 'sarcastico', label: 'Sarcástico', desc: 'Irônico e ácido, mas sempre útil.' },
  { id: 'bem_humorado', label: 'Bem-humorado', desc: 'Descontraído, com analogias divertidas.' },
  { id: 'empatico', label: 'Empático', desc: 'Caloroso, acolhedor e encorajador.' },
];

function SettingsModal({ onClose, darkMode, effectiveUserId }) {
  const [personality, setPersonality] = useState('direto');
  const [customTraits, setCustomTraits] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const t = {
    bg: darkMode ? 'bg-[#1a1a1a]' : 'bg-white',
    border: darkMode ? 'border-white/10' : 'border-black/8',
    muted: darkMode ? 'text-white/40' : 'text-black/50',
    text: darkMode ? 'text-white/80' : 'text-black/80',
    input: darkMode ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-black/3 border-black/10 text-black placeholder-black/30',
    card: darkMode ? 'border-white/10 hover:border-white/30' : 'border-black/10 hover:border-black/30',
    cardActive: darkMode ? 'border-white bg-white/8' : 'border-black bg-black/6',
    btn: darkMode ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/90',
  };

  useEffect(() => {
    fetch(`${API_BASE}/settings`, { headers: { 'x-user-id': effectiveUserId } }).then(r => r.json()).then(d => { setPersonality(d.personality || 'direto'); setCustomTraits(d.custom_traits || ''); }).catch(() => { }).finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': effectiveUserId }, body: JSON.stringify({ personality, custom_traits: customTraits }) });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch { }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`${t.bg} border ${t.border} w-full max-w-lg rounded-2xl p-8 shadow-2xl max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-8"><div><h2 className="text-base font-medium">Configurações</h2><p className={`text-xs font-light mt-0.5 ${t.muted}`}>Personalidade do Solaris</p></div><button onClick={onClose} className={`${t.muted} hover:text-current`}><X size={16} /></button></div>
        {loading ? (<div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin opacity-40" /></div>) : (<>
          <p className={`text-[10px] uppercase tracking-[0.3em] font-light ${t.muted} mb-4`}>Estilo de resposta</p>
          <div className="grid grid-cols-2 gap-2 mb-6">{PERSONALITIES.map(p => (<button key={p.id} onClick={() => setPersonality(p.id)} className={`text-left p-3 rounded-xl border transition-all duration-200 ${personality === p.id ? t.cardActive : t.card}`}><p className={`text-sm font-medium ${personality === p.id ? (darkMode ? 'text-white' : 'text-black') : t.text}`}>{p.label}</p><p className={`text-xs font-light mt-0.5 ${t.muted}`}>{p.desc}</p></button>))}</div>
          <p className={`text-[10px] uppercase tracking-[0.3em] font-light ${t.muted} mb-3`}>Traços adicionais (opcional)</p>
          <textarea value={customTraits} onChange={e => setCustomTraits(e.target.value)} placeholder="Ex: use analogias com esportes, responda em inglês técnico..." rows={3} className={`w-full px-4 py-3 rounded-xl border text-sm font-light focus:outline-none resize-none mb-6 ${t.input}`} />
          <button onClick={handleSave} disabled={saving} className={`w-full py-3 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${t.btn}`}>{saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : <Save size={16} />}{saved ? 'Salvo!' : 'Salvar configurações'}</button>
        </>)}
      </div>
    </div>
  );
}

// ─── MessageBubble ─────────────────────────────────────────────────────────
function MessageBubble({ msg, index, darkMode, theme, onEdit, isEditing, editValue, setEditValue, onEditSave, onEditCancel, isLoading }) {
  const [showHistory, setShowHistory] = useState(false);
  const editRef = useRef(null);
  useEffect(() => { if (isEditing && editRef.current) { editRef.current.focus(); editRef.current.style.height = 'auto'; editRef.current.style.height = editRef.current.scrollHeight + 'px'; } }, [isEditing]);
  const hasHistory = Array.isArray(msg.edit_history) && msg.edit_history.length > 0;
  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group/msg animate-in fade-in slide-in-from-bottom-2 duration-700`}>
      <div className={`max-w-[70%] ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
        <div className={`text-[9px] uppercase tracking-[0.2em] font-bold mb-3 ${theme.textMuted}`}>{msg.role === 'user' ? 'Você' : (<span className="flex items-center gap-1.5">Solaris{msg.model === 'pro' && <span className="flex items-center gap-0.5 text-amber-400 opacity-70"><Star size={8} />pro</span>}</span>)}{msg.edited && <span className="ml-2 normal-case tracking-normal font-normal opacity-50">(editado)</span>}</div>
        {isEditing ? (
          <div className="text-left"><textarea ref={editRef} value={editValue} onChange={e => { setEditValue(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEditSave(); } if (e.key === 'Escape') onEditCancel(); }} className={`w-full bg-transparent border-b ${theme.inputBorder} text-base leading-relaxed resize-none focus:outline-none py-1 font-light ${darkMode ? 'text-white' : 'text-black'}`} rows={1} /><div className="flex items-center gap-3 mt-2 justify-end"><button onClick={onEditCancel} className={`text-xs ${theme.textMuted} hover:text-current transition-colors`}>cancelar</button><button onClick={onEditSave} disabled={isLoading || !editValue.trim()} className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all ${darkMode ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-black/10 text-black hover:bg-black/20'} disabled:opacity-40`}>{isLoading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}Salvar e regerar</button></div></div>
        ) : (
          <div><div className={`text-base leading-relaxed transition-colors duration-500 whitespace-pre-wrap ${msg.role === 'user' ? (darkMode ? 'text-white font-medium' : 'text-black font-medium') : (darkMode ? 'text-white/60 font-light' : 'text-gray-600 font-light')}`}>{msg.content}</div>{msg.role === 'user' && !isLoading && (<div className="flex items-center gap-2 mt-1.5 justify-end opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200">{hasHistory && (<button onClick={() => setShowHistory(!showHistory)} className={`flex items-center gap-1 text-[10px] ${theme.textMuted} hover:text-current transition-colors`}><RotateCcw size={10} />{msg.edit_history.length}v</button>)}<button onClick={() => onEdit(index, msg.content)} className={`flex items-center gap-1 text-[10px] ${theme.textMuted} hover:text-current transition-colors`}><Pencil size={10} />editar</button></div>)}</div>
        )}
        {showHistory && hasHistory && !isEditing && (<div className={`mt-3 text-left border-l-2 ${darkMode ? 'border-white/10' : 'border-black/10'} pl-3 space-y-2`}><p className={`text-[10px] uppercase tracking-widest ${theme.textMuted} mb-2`}>Versões anteriores</p>{msg.edit_history.map((h, i) => (<p key={i} className={`text-xs ${theme.textMuted} font-light`}><span className="opacity-50 mr-2">{i + 1}.</span>{h.content}</p>))}</div>)}
      </div>
    </div>
  );
}

// ─── Project Settings Modal (edição e fontes) ──────────────────────────────
function ProjectSettingsModal({ project, onClose, onUpdate, darkMode, effectiveUserId }) {
  const [name, setName] = useState(project?.name || '');
  const [summary, setSummary] = useState(project?.summary || '');
  const [detailedObjective, setDetailedObjective] = useState(project?.detailed_objective || '');
  const [tags, setTags] = useState(Array.isArray(project?.tags) ? project.tags.join(', ') : '');
  const [responseStyle, setResponseStyle] = useState(project?.response_style || 'direto');
  const [memoryMode, setMemoryMode] = useState(project?.memory_mode || 'projeto');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [sources, setSources] = useState([]);
  const [newUrl, setNewUrl] = useState('');
  const [newUrlTitle, setNewUrlTitle] = useState('');
  const [newText, setNewText] = useState('');
  const [newTextTitle, setNewTextTitle] = useState('');
  const [addingSource, setAddingSource] = useState(false);
  const [activeTab, setActiveTab] = useState('edit');

  const t = {
    bg: darkMode ? 'bg-[#1a1a1a]' : 'bg-white',
    border: darkMode ? 'border-white/10' : 'border-black/8',
    muted: darkMode ? 'text-white/40' : 'text-black/50',
    text: darkMode ? 'text-white/80' : 'text-black/80',
    input: darkMode ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-black/3 border-black/10 text-black placeholder-black/30',
    btn: darkMode ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/90',
    btnOutline: darkMode ? 'border-white/20 hover:bg-white/5' : 'border-black/20 hover:bg-black/5',
  };

  const fetchSources = useCallback(async () => {
    if (!project) return;
    try {
      const res = await fetch(`${API_BASE}/projects/${project.id}/sources`, { headers: { 'x-user-id': effectiveUserId } });
      const data = await res.json();
      setSources(data);
    } catch (err) { console.error(err); }
  }, [project, effectiveUserId]);

  useEffect(() => { if (project && activeTab === 'sources') fetchSources(); }, [activeTab, project, fetchSources]);

  async function handleUpdate() {
    if (!name.trim()) { setError('Nome é obrigatório'); return; }
    setLoading(true); setError('');
    try {
      const tagsArray = tags.split(',').map(t => t.trim()).filter(t => t);
      const res = await fetch(`${API_BASE}/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': effectiveUserId },
        body: JSON.stringify({ name, summary, detailed_objective: detailedObjective, tags: tagsArray, response_style: responseStyle, memory_mode: memoryMode }),
      });
      if (!res.ok) throw new Error('Erro ao atualizar');
      const updated = await res.json();
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      onUpdate(updated);
    } catch (err) { setError(err.message); }
    setLoading(false);
  }

  async function addUrlSource() {
    if (!newUrl.trim()) return;
    setAddingSource(true);
    try {
      const res = await fetch(`${API_BASE}/projects/${project.id}/sources/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': effectiveUserId },
        body: JSON.stringify({ url: newUrl, title: newUrlTitle || undefined }),
      });
      if (!res.ok) throw new Error('Falha ao adicionar URL');
      await fetchSources();
      setNewUrl(''); setNewUrlTitle('');
    } catch (err) { alert(err.message); }
    setAddingSource(false);
  }

  async function addTextSource() {
    if (!newText.trim()) return;
    setAddingSource(true);
    try {
      const res = await fetch(`${API_BASE}/projects/${project.id}/sources/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': effectiveUserId },
        body: JSON.stringify({ title: newTextTitle || 'Texto adicionado', content: newText }),
      });
      if (!res.ok) throw new Error('Falha ao adicionar texto');
      await fetchSources();
      setNewText(''); setNewTextTitle('');
    } catch (err) { alert(err.message); }
    setAddingSource(false);
  }

  async function deleteSource(sourceId) {
    if (!confirm('Remover esta fonte?')) return;
    try {
      await fetch(`${API_BASE}/projects/${project.id}/sources/${sourceId}`, { method: 'DELETE', headers: { 'x-user-id': effectiveUserId } });
      await fetchSources();
    } catch (err) { alert(err.message); }
  }

  if (!project) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`${t.bg} border ${t.border} w-full max-w-2xl rounded-2xl shadow-2xl max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between p-6 border-b border-current/10">
          <h2 className="text-lg font-medium">Configurar Projeto</h2>
          <button onClick={onClose} className={t.muted}><X size={20} /></button>
        </div>
        <div className="flex border-b border-current/10">
          <button onClick={() => setActiveTab('edit')} className={`px-6 py-3 text-sm font-medium transition-all ${activeTab === 'edit' ? (darkMode ? 'border-b-2 border-white text-white' : 'border-b-2 border-black text-black') : t.muted}`}>Editar</button>
          <button onClick={() => setActiveTab('sources')} className={`px-6 py-3 text-sm font-medium transition-all ${activeTab === 'sources' ? (darkMode ? 'border-b-2 border-white text-white' : 'border-b-2 border-black text-black') : t.muted}`}>Fontes</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'edit' ? (
            <div className="space-y-4">
              <div><label className={`text-xs uppercase tracking-wider ${t.muted}`}>Nome do projeto *</label><input type="text" value={name} onChange={e => setName(e.target.value)} className={`w-full mt-1 px-4 py-2 rounded-xl border ${t.input}`} /></div>
              <div><label className={`text-xs uppercase tracking-wider ${t.muted}`}>Resumo curto</label><input type="text" value={summary} onChange={e => setSummary(e.target.value)} className={`w-full mt-1 px-4 py-2 rounded-xl border ${t.input}`} placeholder="Breve descrição do projeto" /></div>
              <div><label className={`text-xs uppercase tracking-wider ${t.muted}`}>Objetivo detalhado</label><textarea value={detailedObjective} onChange={e => setDetailedObjective(e.target.value)} rows={3} className={`w-full mt-1 px-4 py-2 rounded-xl border ${t.input}`} placeholder="Descreva em detalhes o que este projeto busca alcançar..." /></div>
              <div><label className={`text-xs uppercase tracking-wider ${t.muted}`}>Tags (separadas por vírgula)</label><input type="text" value={tags} onChange={e => setTags(e.target.value)} className={`w-full mt-1 px-4 py-2 rounded-xl border ${t.input}`} placeholder="ex: IA, backend, finanças" /></div>
              <div><label className={`text-xs uppercase tracking-wider ${t.muted}`}>Estilo de resposta</label><select value={responseStyle} onChange={e => setResponseStyle(e.target.value)} className={`w-full mt-1 px-4 py-2 rounded-xl border ${t.input}`}>{PERSONALITIES.map(p => (<option key={p.id} value={p.id}>{p.label}</option>))}</select></div>
              <div><label className={`text-xs uppercase tracking-wider ${t.muted}`}>Modo de memória</label><select value={memoryMode} onChange={e => setMemoryMode(e.target.value)} className={`w-full mt-1 px-4 py-2 rounded-xl border ${t.input}`}><option value="projeto">Apenas deste projeto</option><option value="global">Global (todos os projetos)</option><option value="nenhuma">Nenhuma (economiza tokens)</option></select><p className={`text-[10px] mt-1 ${t.muted}`}>Memórias são extraídas automaticamente de conversas importantes.</p></div>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <button onClick={handleUpdate} disabled={loading} className={`w-full py-3 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${t.btn}`}>{loading ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : <Save size={16} />}{saved ? 'Salvo!' : 'Salvar alterações'}</button>
            </div>
          ) : (
            <div className="space-y-6">
              <div><h3 className="text-sm font-medium mb-2">Adicionar fonte externa</h3>
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input type="text" placeholder="URL (ex: https://...)" value={newUrl} onChange={e => setNewUrl(e.target.value)} className={`flex-1 px-4 py-2 rounded-xl border ${t.input}`} />
                    <input type="text" placeholder="Título (opcional)" value={newUrlTitle} onChange={e => setNewUrlTitle(e.target.value)} className={`flex-1 px-4 py-2 rounded-xl border ${t.input}`} />
                    <button onClick={addUrlSource} disabled={addingSource} className={`px-4 py-2 rounded-xl border ${t.btnOutline}`}>{addingSource ? <Loader2 size={16} className="animate-spin" /> : <Globe size={16} />}</button>
                  </div>
                  <div className="flex gap-2">
                    <textarea placeholder="Cole o texto aqui..." value={newText} onChange={e => setNewText(e.target.value)} rows={2} className={`flex-1 px-4 py-2 rounded-xl border ${t.input}`} />
                    <div>
                      <input type="text" placeholder="Título" value={newTextTitle} onChange={e => setNewTextTitle(e.target.value)} className={`w-full mb-2 px-4 py-2 rounded-xl border ${t.input}`} />
                      <button onClick={addTextSource} disabled={addingSource} className={`w-full px-4 py-2 rounded-xl border ${t.btnOutline}`}>{addingSource ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}</button>
                    </div>
                  </div>
                </div>
              </div>
              <div><h3 className="text-sm font-medium mb-2">Fontes atuais</h3>
                {sources.length === 0 ? (<p className={`text-xs ${t.muted}`}>Nenhuma fonte externa adicionada.</p>) : (
                  <div className="space-y-2">
                    {sources.map(s => (
                      <div key={s.id} className={`flex items-center justify-between p-3 rounded-xl border ${t.border}`}>
                        <div className="flex items-center gap-2">
                          <div className="p-1 rounded-lg bg-current/10">{s.type === 'url' ? <Globe size={14} /> : <FileText size={14} />}</div>
                          <div>
                            <p className="text-sm font-medium">{s.title || (s.type === 'url' ? s.url : 'Texto')}</p>
                            <p className={`text-xs ${t.muted}`}>{s.type === 'url' ? s.url : `${s.content?.substring(0, 60)}...`}</p>
                          </div>
                        </div>
                        <button onClick={() => deleteSource(s.id)} className="text-red-400 hover:text-red-500"><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="p-6 border-t border-current/10 flex justify-end">
          <button onClick={onClose} className={`px-6 py-2 rounded-xl border ${t.btnOutline}`}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

// ─── App principal ──────────────────────────────────────────────────────────
export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('solaris_dark') !== 'false');
  const [model, setModel] = useState('flash');
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
  const [showMoreProjects, setShowMoreProjects] = useState(false);
  const [editingMsgIndex, setEditingMsgIndex] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [authUser, setAuthUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [sendError, setSendError] = useState('');
  const [uploadStatus, setUploadStatus] = useState(null);
  const [editingChatTitleId, setEditingChatTitleId] = useState(null);
  const [editingChatTitleValue, setEditingChatTitleValue] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [editingProject, setEditingProject] = useState(null);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const moreProjectsRef = useRef(null);

  const statusSequence = [
    { text: "Analisando contexto...", duration: 400 },
    { text: "Consultando memórias do projeto...", duration: 400 },
    { text: "Preparando resposta...", duration: 300 }
  ];
  const showStatusSequence = async () => {
    for (const step of statusSequence) {
      setStatusMessage(step.text);
      await new Promise(r => setTimeout(r, step.duration));
    }
    setStatusMessage('');
  };

  const streamResponse = async (chatId, projectId, userMessage, modelKey) => {
    const response = await fetch(`${API_BASE}/messages/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': effectiveUserId, 'x-model': authUser ? modelKey : 'flash' },
      body: JSON.stringify({ project_id: projectId || null, chat_id: chatId, message: userMessage }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let assistantMessageIndex = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.chunk) {
              if (assistantMessageIndex === null) {
                setMessages(prev => { const newMsg = { role: 'assistant', content: parsed.chunk, model: modelKey }; assistantMessageIndex = prev.length; return [...prev, newMsg]; });
              } else {
                setMessages(prev => { const updated = [...prev]; updated[assistantMessageIndex] = { ...updated[assistantMessageIndex], content: updated[assistantMessageIndex].content + parsed.chunk }; return updated; });
              }
            }
          } catch (e) { console.warn('Erro ao parsear SSE:', e); }
        }
      }
    }
  };

  const guestIdRef = useRef(getGuestId());
  const effectiveUserId = authUser?.id || guestIdRef.current;
  const displayName = authUser?.user_metadata?.display_name || authUser?.user_metadata?.full_name || authUser?.email?.split('@')[0] || null;
  const hasUserStartedChat = messages.some(m => m.role === 'user');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setAuthUser(session?.user ?? null); setAuthReady(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => { setAuthUser(session?.user ?? null); });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (!authUser && model === 'pro') setModel('flash'); }, [authUser]);

  async function migrateGuestData(userId) {
    const guestId = guestIdRef.current;
    if (!guestId || guestId === userId) return;
    await fetch(`${API_BASE}/migrate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guest_id: guestId, user_id: userId }) }).catch(() => { });
  }
  async function handleAuthSuccess(user) { await migrateGuestData(user.id); setAuthUser(user); setShowAuthModal(false); }
  async function handleLogout() { await supabase.auth.signOut(); setModel('flash'); setAuthUser(null); setProjects([]); setChatHistory([]); setActiveChatId(null); setActiveProjectId(null); setMessages([]); }

  const buildHeaders = useCallback((extra = {}) => ({ 'Content-Type': 'application/json', 'x-user-id': effectiveUserId, 'x-model': authUser ? model : 'flash', ...extra }), [effectiveUserId, authUser, model]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isLoading, isStreaming]);
  useEffect(() => { localStorage.setItem('solaris_dark', darkMode); }, [darkMode]);
  useEffect(() => { const h = (e) => { if (moreProjectsRef.current && !moreProjectsRef.current.contains(e.target)) setShowMoreProjects(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  useEffect(() => { if (authReady) fetchProjects(); }, [authReady, effectiveUserId]);

  async function fetchProjects() {
    try { const r = await fetch(`${API_BASE}/projects`, { headers: { 'x-user-id': effectiveUserId } }); if (!r.ok) { setProjects([]); return; } const d = await r.json(); setProjects(Array.isArray(d) ? d : []); } catch { setProjects([]); }
  }
  useEffect(() => {
    if (!activeProjectId) { setChatHistory([]); return; }
    setActiveChatId(null); setMessages([]);
    (async () => {
      try { const r = await fetch(`${API_BASE}/projects/${activeProjectId}`, { headers: { 'x-user-id': effectiveUserId } }); if (!r.ok) { setChatHistory([]); return; } const d = await r.json(); setChatHistory(d.chats || []); if (d.chats?.length > 0) setActiveChatId(d.chats[0].id); } catch { setChatHistory([]); }
    })();
  }, [activeProjectId]);
  useEffect(() => {
    if (!activeChatId) { setMessages([]); return; }
    (async () => { try { const r = await fetch(`${API_BASE}/messages/chat/${activeChatId}`, { headers: { 'x-user-id': effectiveUserId } }); if (!r.ok) return; const msgs = await r.json(); setMessages(Array.isArray(msgs) ? msgs : []); } catch { } })();
  }, [activeChatId]);

  async function createChat(projectId) {
    const endpoint = projectId ? `${API_BASE}/projects/${projectId}/chats` : `${API_BASE}/projects/none/chats`;
    const r = await fetch(endpoint, { method: 'POST', headers: buildHeaders(), body: JSON.stringify({ title: 'Nova conversa' }) });
    if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || `Erro ${r.status} ao criar chat`); }
    return r.json();
  }

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading || isStreaming) return;
    setSendError(''); setEditingMsgIndex(null); setInput(''); if (textareaRef.current) textareaRef.current.style.height = 'auto';
    let chatId = activeChatId;
    const projectId = activeProjectId;
    if (!chatId) {
      try { const nc = await createChat(projectId); setChatHistory(prev => { if (prev.find(c => c.id === nc.id)) return prev; return [nc, ...prev]; }); setActiveChatId(nc.id); chatId = nc.id; } catch (err) { setSendError(`Não foi possível iniciar conversa: ${err.message}`); setInput(text); return; }
    }
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setIsLoading(true); await showStatusSequence(); setIsStreaming(true); setIsLoading(false);
    try { await streamResponse(chatId, projectId, text, model); } catch (err) {
      console.error('Streaming falhou, usando fallback:', err);
      try { const r = await fetch(`${API_BASE}/messages`, { method: 'POST', headers: buildHeaders(), body: JSON.stringify({ project_id: projectId || null, chat_id: chatId, message: text }) }); const d = await safeJson(r); if (!r.ok) throw new Error(d.error || 'Erro no servidor'); setMessages(prev => [...prev, { role: 'assistant', content: d.response, model: d.model }]); } catch (fallbackErr) { setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${fallbackErr.message}` }]); }
    } finally { setIsStreaming(false); setStatusMessage(''); }
  };
  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };
  const handleInput = (e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`; };
  const handleEdit = (index, content) => { setEditingMsgIndex(index); setEditValue(content); };
  const handleEditCancel = () => { setEditingMsgIndex(null); setEditValue(''); };
  const handleEditSave = async () => {
    if (!editValue.trim() || isLoading || isStreaming || editingMsgIndex === null) return;
    const original = messages[editingMsgIndex];
    const newContent = editValue.trim();
    const newMessages = messages.slice(0, editingMsgIndex + 1).map((m, i) => i === editingMsgIndex ? { ...m, content: newContent, edited: true, edit_history: [...(m.edit_history || []), { content: m.content, edited_at: new Date().toISOString() }] } : m);
    setMessages(newMessages); setEditingMsgIndex(null); setEditValue('');
    setIsLoading(true); await showStatusSequence(); setIsStreaming(true); setIsLoading(false);
    try { const r = await fetch(`${API_BASE}/messages/edit`, { method: 'POST', headers: buildHeaders(), body: JSON.stringify({ chat_id: activeChatId, project_id: activeProjectId, message_index: editingMsgIndex, new_content: newContent, original_content: original.content }) }); const d = await safeJson(r); setMessages(prev => [...prev, { role: 'assistant', content: d.response, model: d.model }]); } catch { setMessages(prev => [...prev, { role: 'assistant', content: 'Erro ao regerar.' }]); } finally { setIsStreaming(false); setStatusMessage(''); }
  };
  const handleShare = () => { const text = messages.map(m => `${m.role === 'user' ? 'VOCÊ' : 'SOLARIS'}: ${m.content}`).join('\n\n'); navigator.clipboard.writeText(text).catch(() => { }); setShowShareToast(true); setTimeout(() => setShowShareToast(false), 3000); };
  const createProject = async () => {
    if (!newProjectName.trim()) { setIsCreatingProject(false); return; }
    try {
      const r = await fetch(`${API_BASE}/projects`, { method: 'POST', headers: buildHeaders(), body: JSON.stringify({ name: newProjectName.trim(), summary: '', detailed_objective: '', tags: [], response_style: 'direto', memory_mode: 'projeto' }) });
      if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || `Erro ${r.status}`); }
      const p = await r.json(); setProjects(prev => [p, ...prev]); setNewProjectName(''); setIsCreatingProject(false); setActiveProjectId(p.id);
    } catch (err) { setSendError(`Não foi possível criar projeto: ${err.message}`); }
  };
  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;
    const { type, data } = itemToDelete;
    try {
      if (type === 'project') { await fetch(`${API_BASE}/projects/${data.id}`, { method: 'DELETE', headers: { 'x-user-id': effectiveUserId } }); setProjects(prev => prev.filter(p => p.id !== data.id)); if (activeProjectId === data.id) { setActiveProjectId(null); setChatHistory([]); setActiveChatId(null); setMessages([]); } }
      else { await fetch(`${API_BASE}/projects/${activeProjectId || 'none'}/chats/${data.id}`, { method: 'DELETE', headers: { 'x-user-id': effectiveUserId } }); const updated = chatHistory.filter(c => c.id !== data.id); setChatHistory(updated); if (activeChatId === data.id) { setActiveChatId(updated.length > 0 ? updated[0].id : null); if (updated.length === 0) setMessages([]); } }
    } catch (err) { console.error(err); }
    setItemToDelete(null);
  };
  const handleNewChat = () => { setActiveChatId(null); setMessages([]); setSendError(''); };
  const startRenameChatTitle = (e, chat) => { e.stopPropagation(); setEditingChatTitleId(chat.id); setEditingChatTitleValue(chat.title || ''); };
  const confirmRenameChatTitle = async (chatId) => { const newTitle = editingChatTitleValue.trim(); setEditingChatTitleId(null); setEditingChatTitleValue(''); if (!newTitle) return; try { const r = await fetch(`${API_BASE}/chats/${chatId}/title`, { method: 'PATCH', headers: buildHeaders(), body: JSON.stringify({ title: newTitle }) }); if (!r.ok) return; const { title } = await r.json(); setChatHistory(prev => prev.map(c => c.id === chatId ? { ...c, title } : c)); } catch { } };
  const onDragStart = (e, id) => { setDraggedItemId(id); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => { e.currentTarget.style.opacity = '0.4'; }, 0); };
  const onDragOver = (e, id) => { e.preventDefault(); if (!draggedItemId || draggedItemId === id) return; const from = projects.findIndex(p => p.id === draggedItemId); const to = projects.findIndex(p => p.id === id); if (from === -1 || to === -1) return; const arr = [...projects]; arr.splice(to, 0, arr.splice(from, 1)[0]); setProjects(arr); };
  const onDragEnd = (e) => { e.currentTarget.style.opacity = '1'; setDraggedItemId(null); };
  const handleFileUpload = async (e) => { const file = e.target.files?.[0]; if (!file) return; e.target.value = ''; if (!activeProjectId) { setUploadStatus({ type: 'error', message: 'Selecione um projeto para enviar arquivos.' }); setTimeout(() => setUploadStatus(null), 3000); return; } const fd = new FormData(); fd.append('file', file); setUploadStatus({ type: 'uploading', message: `Enviando ${file.name}...` }); try { const res = await fetch(`${API_BASE}/files/${activeProjectId}`, { method: 'POST', headers: { 'x-user-id': effectiveUserId }, body: fd }); if (!res.ok) throw new Error('Falha no upload'); setUploadStatus({ type: 'success', message: `${file.name} enviado com sucesso!` }); setTimeout(() => setUploadStatus(null), 3000); } catch (err) { console.error(err); setUploadStatus({ type: 'error', message: `Erro ao enviar ${file.name}` }); setTimeout(() => setUploadStatus(null), 4000); } };
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
  const extraProjects = projects.slice(3);
  const filteredChats = searchQuery.trim() ? chatHistory.filter(c => c.title?.toLowerCase().includes(searchQuery.toLowerCase())) : chatHistory;
  const ProjectItem = ({ project, isActive, compact = false }) => (
    <div draggable onDragStart={e => onDragStart(e, project.id)} onDragOver={e => onDragOver(e, project.id)} onDragEnd={onDragEnd} onClick={() => { setActiveProjectId(project.id); setShowMoreProjects(false); }} className={`flex items-center justify-between p-2.5 -ml-2 rounded-lg cursor-grab active:cursor-grabbing transition-all group/item ${isActive ? theme.projectActive : theme.projectHover} ${draggedItemId === project.id ? 'bg-blue-500/10' : ''}`}>
      <div className="flex items-center gap-3 overflow-hidden pointer-events-none">{!compact && <GripVertical size={12} className={`${theme.textMuted} opacity-0 group-hover/item:opacity-100 transition-opacity`} />}<Folder size={14} className={isActive ? 'text-current opacity-60' : theme.textMuted} /><span className={`text-xs font-light truncate ${compact ? 'max-w-[140px]' : 'max-w-[100px]'} ${isActive ? 'font-normal' : theme.textSecondary}`}>{project.name}</span></div>
      <div className="flex items-center gap-1"><button onClick={e => { e.stopPropagation(); setEditingProject(project); }} className="opacity-0 group-hover/item:opacity-100 p-1 hover:text-amber-400 transition-colors"><Settings size={12} /></button><button onClick={e => { e.stopPropagation(); setItemToDelete({ type: 'project', data: project }); }} className="opacity-0 group-hover/item:opacity-100 p-1 hover:text-red-500 transition-all duration-200"><Trash2 size={12} /></button></div>
    </div>
  );
  const WelcomeScreen = () => (<div className="flex flex-col items-center justify-center h-full gap-6 px-8 text-center animate-in fade-in duration-700"><div className={`text-3xl font-extralight ${darkMode ? 'text-white/10' : 'text-black/10'}`}>✦</div><div><p className={`text-base font-light ${theme.textSecondary}`}>Olá{displayName ? `, ${displayName}` : ''}.</p><p className={`text-sm font-light mt-1 ${theme.textMuted}`}>{activeProjectId ? 'Nenhuma conversa ainda. Comece digitando.' : 'Como posso ajudar hoje?'}</p></div></div>);
  return (
    <div className={`flex h-screen ${darkMode ? 'bg-[#050505] text-white' : 'bg-[#fafafa] text-[#1a1a1a]'} font-sans antialiased overflow-hidden transition-colors duration-500`}>
      {showAuthModal && <AuthModal darkMode={darkMode} onClose={() => setShowAuthModal(false)} onAuthSuccess={handleAuthSuccess} />}
      {showSettingsModal && authUser && <SettingsModal darkMode={darkMode} onClose={() => setShowSettingsModal(false)} effectiveUserId={effectiveUserId} />}
      {editingProject && <ProjectSettingsModal project={editingProject} onClose={() => setEditingProject(null)} onUpdate={(updated) => { setProjects(prev => prev.map(p => p.id === updated.id ? updated : p)); if (activeProjectId === updated.id) setActiveProjectId(updated.id); setEditingProject(null); }} darkMode={darkMode} effectiveUserId={effectiveUserId} />}
      <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-[110] px-6 py-3 rounded-full bg-emerald-500 text-white text-xs font-bold tracking-widest uppercase shadow-2xl transition-all duration-500 ${showShareToast ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>Copiado para a área de transferência</div>
      {itemToDelete && (<div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"><div className={`${theme.modalBg} border ${theme.border} w-full max-w-sm rounded-2xl p-8 shadow-2xl`}><div className="flex flex-col items-center text-center"><div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4"><AlertTriangle className="text-red-500" size={24} /></div><h3 className="text-lg font-medium mb-2">Apagar?</h3><p className={`text-sm ${theme.textSecondary} mb-8`}>Apagar "<span className="font-semibold">{itemToDelete.data.name || itemToDelete.data.title}</span>"?</p><div className="flex w-full gap-3"><button onClick={() => setItemToDelete(null)} className={`flex-1 py-3 rounded-xl border ${theme.border} text-xs font-bold uppercase tracking-widest hover:bg-black/5 transition-colors`}>Cancelar</button><button onClick={handleDeleteConfirm} className="flex-1 py-3 rounded-xl bg-red-500 text-white text-xs font-bold uppercase tracking-widest hover:bg-red-600 transition-colors">Eliminar</button></div></div></div></div>)}
      <aside className={`hidden lg:flex flex-col border-r ${theme.border} ${theme.bgAside} relative transition-all duration-500 ease-in-out shrink-0 ${isSidebarOpen ? 'w-72' : 'w-20'}`}>
        <div className={`flex flex-col h-full overflow-hidden transition-all duration-500 ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <div className="px-8 pt-12 pb-6 flex flex-col gap-5 shrink-0"><button onClick={handleNewChat} className={`flex items-center gap-3 w-full text-left transition-colors ${theme.textPrimary} group`}><PencilLine size={18} strokeWidth={1.2} /><span className="text-sm font-light">Novo Chat</span></button><div className="flex items-center gap-3 w-full"><Search size={18} strokeWidth={1.2} className={theme.textPrimary} /><input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Buscar conversa" className={`bg-transparent border-none p-0 text-sm font-light w-full focus:outline-none ${darkMode ? 'text-white placeholder:text-white/20' : 'text-black placeholder:text-black/30'}`} /></div></div>
          <div className="px-8 flex flex-col flex-1 overflow-y-auto custom-scrollbar">
            <div className="relative w-full aspect-square flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity duration-700 mb-10 shrink-0"><div className={`w-6 h-6 ${darkMode ? 'bg-[#ffd700]' : 'bg-[#ffcc00] border border-amber-600/10'} rounded-full z-10`} style={{ boxShadow: '0 0 25px rgba(255,204,0,0.35)' }} /><OrbitLine size="w-10 h-10" themeColor={theme.orbit} /><OrbitLine size="w-14 h-14" themeColor={theme.orbit} /><OrbitLine size="w-20 h-20" themeColor={theme.orbit} /><OrbitLine size="w-24 h-24" themeColor={theme.orbit} /><OrbitLine size="w-32 h-32" themeColor={theme.orbit} /><OrbitLine size="w-40 h-40" themeColor={theme.orbit} /><OrbitLine size="w-48 h-48" themeColor={theme.orbit} /><OrbitLine size="w-56 h-56" themeColor={theme.orbit} /><PlanetDot size="w-10 h-10" duration="3s" color={darkMode ? 'bg-[#888]' : 'bg-[#666]'} dotSize="w-1 h-1" darkMode={darkMode} /><PlanetDot size="w-14 h-14" duration="5s" color="bg-[#e3bb76]" dotSize="w-1.5 h-1.5" darkMode={darkMode} /><PlanetDot size="w-20 h-20" duration="8s" color="bg-[#2271b3]" dotSize="w-2 h-2" glow={darkMode ? '0 0 10px rgba(34,113,179,0.9)' : '0 0 8px rgba(34,113,179,0.5)'} darkMode={darkMode} /><PlanetDot size="w-24 h-24" duration="12s" color="bg-[#e27b58]" dotSize="w-1 h-1" darkMode={darkMode} /><PlanetDot size="w-32 h-32" duration="20s" color="bg-[#d39c7e]" dotSize="w-2.5 h-2.5" darkMode={darkMode} /><PlanetDot size="w-40 h-40" duration="28s" color="bg-[#eadaa4]" dotSize="w-2 h-2" hasRing darkMode={darkMode} /><PlanetDot size="w-48 h-48" duration="36s" color="bg-[#a6d1e6]" dotSize="w-1.5 h-1.5" darkMode={darkMode} /><PlanetDot size="w-56 h-56" duration="45s" color="bg-[#4b70dd]" dotSize="w-1.5 h-1.5" darkMode={darkMode} /></div>
            <div className="flex flex-col gap-4 mb-8 shrink-0"><h2 className={`text-[10px] font-light tracking-[0.4em] uppercase ${theme.textSecondary}`}>PROJETOS</h2>{isCreatingProject ? (<div className={`flex items-center gap-2 p-2 -ml-2 rounded-lg border ${theme.inputBorder}`}><input autoFocus type="text" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') createProject(); if (e.key === 'Escape') { setIsCreatingProject(false); setNewProjectName(''); } }} placeholder="Nome do projeto..." className="bg-transparent border-none text-xs w-full focus:outline-none font-light" /><button onClick={createProject} className="text-emerald-500"><Check size={14} /></button><button onClick={() => { setIsCreatingProject(false); setNewProjectName(''); }} className="text-red-400"><X size={14} /></button></div>) : (<button onClick={() => setIsCreatingProject(true)} className={`flex items-center gap-3 p-2 -ml-2 rounded-lg text-left transition-all ${theme.projectHover} group`}><FolderPlus size={18} className={`${theme.textSecondary} group-hover:text-current`} strokeWidth={1.5} /><span className={`text-sm font-light ${theme.textPrimary}`}>Novo projeto</span></button>)}<div className="flex flex-col gap-1">{visibleProjects.map(p => <ProjectItem key={p.id} project={p} isActive={activeProjectId === p.id} />)}</div>{extraProjects.length > 0 && (<div className="relative" ref={moreProjectsRef}><button onClick={() => setShowMoreProjects(!showMoreProjects)} className={`flex items-center gap-2 p-2 -ml-2 rounded-lg w-full transition-all ${theme.projectHover}`}><ChevronDown size={14} className={`${theme.textMuted} transition-transform ${showMoreProjects ? 'rotate-180' : ''}`} /><span className={`text-xs font-light ${theme.textMuted}`}>+{extraProjects.length} projeto{extraProjects.length > 1 ? 's' : ''}</span></button>{showMoreProjects && (<div className={`absolute left-0 right-0 z-50 mt-1 rounded-xl border ${theme.border} ${darkMode ? 'bg-[#141414]' : 'bg-white'} shadow-xl py-2 px-2 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-200`}>{extraProjects.map(p => <ProjectItem key={p.id} project={p} isActive={activeProjectId === p.id} compact />)}</div>)}</div>)}</div>
            <div className="flex flex-col gap-4 mb-10 shrink-0"><h2 className={`text-[10px] font-light tracking-[0.4em] uppercase ${theme.textSecondary}`}>CONVERSAS</h2>{filteredChats.length === 0 && (<p className={`text-xs font-light ${theme.textMuted}`}>As conversas aparecerão aqui.</p>)}<div className="flex flex-col gap-1">{filteredChats.map(chat => (<div key={chat.id} onClick={() => { if (editingChatTitleId !== chat.id) setActiveChatId(chat.id); }} className={`flex items-center justify-between p-2 -ml-2 rounded-lg cursor-pointer transition-all group/chat ${activeChatId === chat.id ? theme.projectActive : theme.projectHover}`}><div className="flex items-center gap-3 overflow-hidden flex-1 min-w-0"><History size={14} className={`shrink-0 ${activeChatId === chat.id ? 'text-current opacity-60' : theme.textMuted}`} />{editingChatTitleId === chat.id ? (<input autoFocus type="text" value={editingChatTitleValue} onChange={e => setEditingChatTitleValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') confirmRenameChatTitle(chat.id); if (e.key === 'Escape') { setEditingChatTitleId(null); setEditingChatTitleValue(''); } }} onBlur={() => confirmRenameChatTitle(chat.id)} onClick={e => e.stopPropagation()} className={`text-xs font-light bg-transparent border-none focus:outline-none w-full min-w-0 ${darkMode ? 'text-white' : 'text-black'}`} maxLength={50} />) : (<span className={`text-xs font-light truncate max-w-[100px] ${activeChatId === chat.id ? 'font-normal' : theme.textSecondary}`}>{chat.title}</span>)}</div><div className="flex items-center gap-0.5 opacity-0 group-hover/chat:opacity-100 transition-all duration-200 shrink-0"><button onClick={e => startRenameChatTitle(e, chat)} title="Renomear" className={`p-1 hover:text-current transition-colors ${theme.textMuted}`}><Pencil size={11} /></button><button onClick={e => { e.stopPropagation(); setItemToDelete({ type: 'chat', data: chat }); }} className="p-1 hover:text-red-500 transition-all duration-200"><Trash2 size={12} /></button></div></div>))}</div></div>
          </div>
          <div className={`px-8 shrink-0 border-t ${theme.border}`}>{displayName && (<div className={`pt-4 pb-2 flex items-center gap-2 ${theme.textSecondary}`}><User size={12} strokeWidth={1.5} /><span className="text-xs font-light truncate">{displayName}</span></div>)}<div className="flex flex-col py-4"><span className={`text-[8px] font-extralight uppercase tracking-[0.4em] ${darkMode ? 'text-white/20' : 'text-black/30'} mb-0.5`}>Criado por</span><span className={`text-sm italic tracking-wide ${darkMode ? 'text-white/50' : 'text-black/60'}`} style={{ fontFamily: 'Georgia, serif' }}>felipe sant'oliver</span></div></div>
        </div>
      </aside>
      <main className={`flex-1 flex flex-col ${theme.bgMain} relative transition-colors duration-500`}>
        <header className={`h-20 flex items-center justify-between px-6 md:px-10 border-b ${theme.border} transition-colors duration-500`}>
          <div className="flex items-center gap-4"><button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className={`p-2 rounded-lg transition-all ${darkMode ? 'text-white/60 hover:text-white hover:bg-white/5' : 'text-black/40 hover:text-black hover:bg-black/5'}`}><PanelLeft size={20} strokeWidth={1.5} /></button><div className="flex items-baseline gap-1 select-none"><span className="text-base font-medium tracking-tight">SOLARIS</span><span className={`text-[10px] font-bold ${theme.textMuted} tracking-tighter`}>V1</span></div>{activeProjectId && (<div className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-black/5'}`}><Folder size={12} className={theme.textMuted} /><span className={`text-xs font-light ${theme.textSecondary}`}>{projects.find(p => p.id === activeProjectId)?.name}</span><button onClick={() => setActiveProjectId(null)} className={`ml-1 ${theme.textMuted} hover:text-red-400 transition-colors`} title="Sair do projeto"><X size={10} /></button></div>)}</div>
          <div className="flex items-center gap-3">{authUser && (<button onClick={() => setShowSettingsModal(true)} className={`p-2 rounded-lg transition-all ${darkMode ? 'text-white/40 hover:text-white hover:bg-white/5' : 'text-black/40 hover:text-black hover:bg-black/5'}`} title="Configurações"><Settings size={18} strokeWidth={1.5} /></button>)}<button onClick={() => setDarkMode(d => !d)} className={`transition-all ${darkMode ? 'text-yellow-400 hover:text-yellow-200' : 'text-slate-400 hover:text-slate-600'}`}>{darkMode ? <Sun size={18} strokeWidth={1.5} /> : <Moon size={18} strokeWidth={1.5} />}</button>{authUser ? (<button onClick={handleLogout} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${theme.border} text-xs font-light transition-all ${theme.textSecondary} hover:text-red-400 hover:border-red-400/20`}><LogOut size={14} strokeWidth={1.5} /><span className="hidden sm:inline">Sair</span></button>) : (<button onClick={() => setShowAuthModal(true)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${theme.border} text-xs font-light transition-all ${theme.textSecondary} hover:text-current hover:border-current`}><LogIn size={14} strokeWidth={1.5} /><span className="hidden sm:inline">Entrar</span></button>)}</div>
        </header>
        <div className="flex-1 relative overflow-y-auto px-6 md:px-20 py-10 custom-scrollbar transition-colors duration-500">
          {hasUserStartedChat && (<div className="sticky top-0 z-30 flex justify-end pointer-events-none mb-[-40px]"><button onClick={handleShare} className={`pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-full border ${theme.border} ${darkMode ? 'bg-white/5 hover:bg-white/10' : 'bg-black/5 hover:bg-black/10'} backdrop-blur-md transition-all group shadow-sm`}><Share2 size={14} className={`${theme.textSecondary} group-hover:text-current`} /><span className={`text-[10px] font-bold uppercase tracking-widest ${theme.textSecondary} group-hover:text-current`}>Compartilhar</span></button></div>)}
          {messages.length === 0 ? <WelcomeScreen /> : (<div className="space-y-12">{messages.map((msg, i) => (<MessageBubble key={i} msg={msg} index={i} darkMode={darkMode} theme={theme} onEdit={handleEdit} isEditing={editingMsgIndex === i} editValue={editValue} setEditValue={setEditValue} onEditSave={handleEditSave} onEditCancel={handleEditCancel} isLoading={isLoading || isStreaming} />))}</div>)}
          {(isLoading || isStreaming) && (<div className="flex items-center gap-3 mt-12"><div className="flex gap-1"><div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black/60'} rounded-full animate-bounce [animation-delay:-0.3s]`} /><div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black/60'} rounded-full animate-bounce [animation-delay:-0.15s]`} /><div className={`w-1.5 h-1.5 ${darkMode ? 'bg-white/40' : 'bg-black/60'} rounded-full animate-bounce`} /></div>{statusMessage && (<span className={`text-xs font-light tracking-wide ${theme.textSecondary} animate-pulse`}>{statusMessage}</span>)}{isStreaming && !statusMessage && (<span className={`text-xs font-light tracking-wide ${theme.textSecondary} animate-pulse`}>Gerando resposta...</span>)}</div>)}
          <div ref={messagesEndRef} />
        </div>
        <footer className="p-10 pt-4"><div className="max-w-3xl mx-auto"><ModelToggle model={model} onChange={setModel} authUser={authUser} darkMode={darkMode} />{sendError && (<p className="text-red-400 text-xs mb-3 flex items-center gap-1.5"><AlertTriangle size={12} />{sendError}</p>)}{uploadStatus && (<div className={`mb-3 text-xs flex items-center gap-2 ${uploadStatus.type === 'error' ? 'text-red-400' : uploadStatus.type === 'success' ? 'text-emerald-400' : 'text-amber-400'}`}>{uploadStatus.type === 'uploading' && <Loader2 size={12} className="animate-spin" />}{uploadStatus.type === 'success' && <Check size={12} />}{uploadStatus.type === 'error' && <AlertTriangle size={12} />}<span>{uploadStatus.message}</span></div>)}<div className={`relative flex items-end border-b ${theme.inputBorder} pb-8 ${theme.inputFocus} transition-all duration-500`}><textarea ref={textareaRef} value={input} onChange={handleInput} onKeyDown={handleKeyDown} rows={1} placeholder="O que deseja perguntar?" className={`flex-1 bg-transparent border-none text-lg ${darkMode ? 'text-white placeholder-white/20' : 'text-black placeholder-black/30'} resize-none focus:outline-none py-2 font-light`} /><button onClick={handleSend} disabled={isLoading || isStreaming || !input.trim()} className={`p-2 mb-3 transition-all ${(isLoading || isStreaming || !input.trim()) ? theme.textMuted : (darkMode ? 'text-white hover:scale-110' : 'text-black hover:scale-110')}`}>{(isLoading || isStreaming) ? <Loader2 size={20} className="animate-spin" /> : input.trim() ? <Send size={20} strokeWidth={1.5} /> : <Mic size={20} strokeWidth={1.5} />}</button></div><div className={`mt-5 flex justify-between items-center text-[9px] ${theme.textMuted} font-bold tracking-[0.2em] uppercase`}><span>enter para enviar · shift+enter nova linha</span><div className="flex items-center gap-4">{!authUser && (<span onClick={() => setShowAuthModal(true)} className="flex items-center gap-1.5 cursor-pointer text-amber-400/60 hover:text-amber-400 transition-colors mb-2"><Star size={10} /> Entrar para usar Pro</span>)}<span onClick={() => fileInputRef.current?.click()} className={`flex items-center gap-3 cursor-pointer ${darkMode ? 'hover:text-white' : 'hover:text-black'} transition-colors mb-2`}><Plus size={10} /> Anexo</span></div></div></div></footer>
      </main>
      <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} accept=".pdf,.txt,.md,.json,.js,.ts,.py,.css,.html,.csv" />
      <style dangerouslySetInnerHTML={{ __html: `@keyframes rotate-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }.orbit-rotate { animation: rotate-slow linear infinite; }.custom-scrollbar::-webkit-scrollbar { width: 3px; }.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }.custom-scrollbar::-webkit-scrollbar-thumb { background: ${theme.scrollbar}; border-radius: 10px; }` }} />
    </div>
  );
}