import React, { useState, useEffect } from 'react';
import { X, Save, Loader2, Check, Trash2, User, Sparkles, Database, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';

const PERSONALITIES = [
  { id: 'direto', label: 'Direto', desc: 'Respostas curtas e objetivas, sem rodeios.' },
  { id: 'tecnico', label: 'Técnico', desc: 'Terminologia precisa e detalhes de implementação.' },
  { id: 'analitico', label: 'Analítico', desc: 'Análise profunda, prós e contras.' },
  { id: 'estrategico', label: 'Estratégico', desc: 'Visão macro, planejamento e longo prazo.' },
  { id: 'sarcastico', label: 'Sarcástico', desc: 'Irônico e ácido, mas sempre útil.' },
  { id: 'bem_humorado', label: 'Bem-humorado', desc: 'Descontraído, com analogias divertidas.' },
  { id: 'empatico', label: 'Empático', desc: 'Caloroso, acolhedor e encorajador.' },
];

const TABS = [
  { id: 'profile', label: 'Perfil', icon: User },
  { id: 'personality', label: 'Personalidade', icon: Sparkles },
  { id: 'data', label: 'Controles de dados', icon: Database },
];

export function SettingsModal({ onClose, darkMode, effectiveUserId, authUser, onAuthUpdate, onDeleteAllChats }) {
  const [activeTab, setActiveTab] = useState('profile');
  const [displayName, setDisplayName] = useState('');
  const [personality, setPersonality] = useState('direto');
  const [customTraits, setCustomTraits] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [deletingChats, setDeletingChats] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const t = {
    bg: darkMode ? 'bg-[#1f1f1f]' : 'bg-white',
    sidebarBg: darkMode ? 'bg-[#171717]' : 'bg-[#f7f7f8]',
    border: darkMode ? 'border-white/10' : 'border-black/8',
    muted: darkMode ? 'text-white/40' : 'text-black/45',
    text: darkMode ? 'text-white/85' : 'text-black/85',
    input: darkMode
      ? 'bg-white/5 border-white/10 text-white placeholder-white/30 focus:border-white/30'
      : 'bg-black/[0.03] border-black/10 text-black placeholder-black/30 focus:border-black/30',
    btn: darkMode ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/90',
    btnOutline: darkMode ? 'border-white/15 hover:bg-white/5' : 'border-black/15 hover:bg-black/5',
    btnDanger: 'bg-red-500 hover:bg-red-600 text-white',
    card: darkMode ? 'border-white/10 hover:border-white/25' : 'border-black/10 hover:border-black/25',
    cardActive: darkMode ? 'border-white bg-white/8' : 'border-black bg-black/[0.04]',
    sidebarActive: darkMode ? 'bg-white/10 text-white' : 'bg-black/[0.06] text-black',
    sidebarHover: darkMode ? 'hover:bg-white/5' : 'hover:bg-black/[0.04]',
    closeHover: darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5',
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        if (authUser) {
          const name = authUser.user_metadata?.display_name || authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || '';
          setDisplayName(name);
        }
        const data = await api.getSettings(effectiveUserId);
        setPersonality(data.personality || 'direto');
        setCustomTraits(data.custom_traits || '');
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    fetchData();
  }, [authUser, effectiveUserId]);

  const updateDisplayName = async () => {
    if (!authUser) return;
    setSaving(true);
    try {
      await onAuthUpdate(displayName.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const savePersonality = async () => {
    setSaving(true);
    try {
      await api.saveSettings(effectiveUserId, personality, customTraits);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) { setError(err.message); }
    setSaving(false);
  };

  const handleDeleteAllChats = async () => {
    setDeletingChats(true);
    try {
      await onDeleteAllChats();
      window.location.reload();
    } catch (err) {
      setError(err.message);
      setDeletingChats(false);
      setConfirmDelete(false);
    }
  };

  const activeTabMeta = TABS.find(tb => tb.id === activeTab);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={`${t.bg} border ${t.border} w-full max-w-3xl h-[640px] max-h-[88vh] rounded-2xl shadow-2xl flex overflow-hidden`}
      >
        {/* Sidebar */}
        <div className={`${t.sidebarBg} w-16 sm:w-64 shrink-0 border-r ${t.border} flex flex-col p-2 sm:p-3`}>
          <button
            onClick={onClose}
            className={`self-start p-2 mb-3 rounded-lg ${t.muted} ${t.closeHover} transition-colors`}
          >
            <X size={18} />
          </button>
          <nav className="flex flex-col gap-0.5">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center justify-center sm:justify-start gap-3 px-2.5 sm:px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    active ? t.sidebarActive : `${t.text} ${t.sidebarHover}`
                  }`}
                >
                  <Icon size={17} className={active ? '' : t.muted} />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-6 sm:px-8 pt-6 pb-4 shrink-0">
            <h2 className="text-lg font-semibold">{activeTabMeta?.label}</h2>
          </div>

          <div className="flex-1 overflow-y-auto px-6 sm:px-8 pb-8">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 size={20} className="animate-spin opacity-40" />
              </div>
            ) : (
              <>
                {activeTab === 'profile' && (
                  <div className="space-y-6">
                    {authUser ? (
                      <div className={`pb-6 border-b ${t.border}`}>
                        <label className={`text-xs uppercase tracking-wider ${t.muted}`}>Nome de exibição</label>
                        <input
                          type="text"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          className={`w-full mt-2 px-4 py-2.5 rounded-xl border ${t.input} focus:outline-none transition-colors`}
                          placeholder="Como você quer ser chamado?"
                        />
                        <p className={`text-[11px] mt-2 ${t.muted}`}>Este nome será usado nas boas-vindas.</p>
                        <button
                          onClick={updateDisplayName}
                          disabled={saving || !displayName.trim()}
                          className={`mt-4 px-5 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${t.btn} disabled:opacity-50`}
                        >
                          {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : <Save size={16} />}
                          {saved ? 'Salvo!' : 'Atualizar nome'}
                        </button>
                      </div>
                    ) : (
                      <p className={`text-sm ${t.muted}`}>Faça login para editar seu perfil.</p>
                    )}
                  </div>
                )}

                {activeTab === 'personality' && (
                  <div className="space-y-4">
                    <p className={`text-[11px] uppercase tracking-[0.2em] font-medium ${t.muted} mb-3`}>Estilo de resposta</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6">
                      {PERSONALITIES.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setPersonality(p.id)}
                          className={`text-left p-3 rounded-xl border transition-all duration-200 ${
                            personality === p.id ? t.cardActive : t.card
                          }`}
                        >
                          <p className={`text-sm font-medium ${personality === p.id ? (darkMode ? 'text-white' : 'text-black') : t.text}`}>
                            {p.label}
                          </p>
                          <p className={`text-xs font-light mt-0.5 ${t.muted}`}>{p.desc}</p>
                        </button>
                      ))}
                    </div>
                    <label className={`text-[11px] uppercase tracking-[0.2em] font-medium ${t.muted}`}>
                      Traços adicionais (opcional)
                    </label>
                    <textarea
                      value={customTraits}
                      onChange={(e) => setCustomTraits(e.target.value)}
                      placeholder="Ex: use analogias com esportes, responda em inglês técnico..."
                      rows={3}
                      className={`w-full mt-2 px-4 py-3 rounded-xl border text-sm font-light focus:outline-none resize-none transition-colors ${t.input}`}
                    />
                    <button
                      onClick={savePersonality}
                      disabled={saving}
                      className={`w-full py-3 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${t.btn} disabled:opacity-50`}
                    >
                      {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : <Save size={16} />}
                      {saved ? 'Salvo!' : 'Salvar personalidade'}
                    </button>
                  </div>
                )}

                {activeTab === 'data' && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle size={15} className="text-red-400" />
                      <h3 className="text-sm font-medium text-red-400">Zona de risco</h3>
                    </div>
                    <p className={`text-xs ${t.muted} mb-4`}>
                      Apaga permanentemente todas as suas conversas. Projetos e arquivos não são afetados.
                    </p>
                    {!confirmDelete ? (
                      <button
                        onClick={() => setConfirmDelete(true)}
                        className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${t.btnDanger}`}
                      >
                        Excluir todos os chats
                      </button>
                    ) : (
                      <div className="flex gap-3">
                        <button
                          onClick={() => setConfirmDelete(false)}
                          className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors ${t.btnOutline}`}
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={handleDeleteAllChats}
                          disabled={deletingChats}
                          className={`flex-1 py-2.5 rounded-xl text-sm font-medium ${t.btnDanger} flex items-center justify-center gap-2 disabled:opacity-50`}
                        >
                          {deletingChats ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                          Confirmar exclusão
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            {error && <p className="text-red-400 text-xs mt-4">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}