import React, { useState, useEffect } from 'react';
import { X, Save, Loader2, Check, Trash2 } from 'lucide-react';
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
    bg: darkMode ? 'bg-[#1a1a1a]' : 'bg-white',
    border: darkMode ? 'border-white/10' : 'border-black/8',
    muted: darkMode ? 'text-white/40' : 'text-black/50',
    text: darkMode ? 'text-white/80' : 'text-black/80',
    input: darkMode ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-black/3 border-black/10 text-black placeholder-black/30',
    btn: darkMode ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/90',
    btnOutline: darkMode ? 'border-white/20 hover:bg-white/5' : 'border-black/20 hover:bg-black/5',
    btnDanger: 'bg-red-500 hover:bg-red-600 text-white',
    card: darkMode ? 'border-white/10 hover:border-white/30' : 'border-black/10 hover:border-black/30',
    cardActive: darkMode ? 'border-white bg-white/8' : 'border-black bg-black/6',
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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`${t.bg} border ${t.border} w-full max-w-lg rounded-2xl shadow-2xl max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between p-6 border-b border-current/10">
          <h2 className="text-base font-medium">Configurações</h2>
          <button onClick={onClose} className={t.muted}><X size={16} /></button>
        </div>
        <div className="flex border-b border-current/10">
          <button onClick={() => setActiveTab('profile')} className={`px-6 py-3 text-sm font-medium transition-all ${activeTab === 'profile' ? (darkMode ? 'border-b-2 border-white text-white' : 'border-b-2 border-black text-black') : t.muted}`}>Perfil</button>
          <button onClick={() => setActiveTab('personality')} className={`px-6 py-3 text-sm font-medium transition-all ${activeTab === 'personality' ? (darkMode ? 'border-b-2 border-white text-white' : 'border-b-2 border-black text-black') : t.muted}`}>Personalidade</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin opacity-40" /></div>
          ) : (
            <>
              {activeTab === 'profile' && (
                <div className="space-y-6">
                  {authUser ? (
                    <>
                      <div>
                        <label className={`text-xs uppercase tracking-wider ${t.muted}`}>Nome de exibição</label>
                        <input
                          type="text"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          className={`w-full mt-1 px-4 py-2 rounded-xl border ${t.input}`}
                          placeholder="Como você quer ser chamado?"
                        />
                        <p className={`text-[10px] mt-1 ${t.muted}`}>Este nome será usado nas boas-vindas.</p>
                      </div>
                      <button
                        onClick={updateDisplayName}
                        disabled={saving || !displayName.trim()}
                        className={`w-full py-3 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${t.btn}`}
                      >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : <Save size={16} />}
                        {saved ? 'Salvo!' : 'Atualizar nome'}
                      </button>
                    </>
                  ) : (
                    <p className={`text-sm ${t.muted}`}>Faça login para editar seu perfil.</p>
                  )}
                  <div className="pt-4 border-t border-current/10">
                    <h3 className="text-sm font-medium mb-2 text-red-400">Zona de risco</h3>
                    <p className={`text-xs ${t.muted} mb-3`}>Apaga permanentemente todas as suas conversas. Projetos e arquivos não são afetados.</p>
                    {!confirmDelete ? (
                      <button
                        onClick={() => setConfirmDelete(true)}
                        className={`w-full py-2 rounded-xl text-sm font-medium transition-all ${t.btnDanger}`}
                      >
                        Excluir todos os chats
                      </button>
                    ) : (
                      <div className="flex gap-3">
                        <button
                          onClick={() => setConfirmDelete(false)}
                          className={`flex-1 py-2 rounded-xl border ${t.btnOutline}`}
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={handleDeleteAllChats}
                          disabled={deletingChats}
                          className={`flex-1 py-2 rounded-xl ${t.btnDanger} flex items-center justify-center gap-2`}
                        >
                          {deletingChats ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                          Confirmar exclusão
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {activeTab === 'personality' && (
                <div className="space-y-4">
                  <p className={`text-[10px] uppercase tracking-[0.3em] font-light ${t.muted} mb-2`}>Estilo de resposta</p>
                  <div className="grid grid-cols-2 gap-2 mb-6">
                    {PERSONALITIES.map(p => (
                      <button
                        key={p.id}
                        onClick={() => setPersonality(p.id)}
                        className={`text-left p-3 rounded-xl border transition-all duration-200 ${personality === p.id ? t.cardActive : t.card}`}
                      >
                        <p className={`text-sm font-medium ${personality === p.id ? (darkMode ? 'text-white' : 'text-black') : t.text}`}>{p.label}</p>
                        <p className={`text-xs font-light mt-0.5 ${t.muted}`}>{p.desc}</p>
                      </button>
                    ))}
                  </div>
                  <label className={`text-[10px] uppercase tracking-[0.3em] font-light ${t.muted}`}>Traços adicionais (opcional)</label>
                  <textarea
                    value={customTraits}
                    onChange={e => setCustomTraits(e.target.value)}
                    placeholder="Ex: use analogias com esportes, responda em inglês técnico..."
                    rows={3}
                    className={`w-full px-4 py-3 rounded-xl border text-sm font-light focus:outline-none resize-none ${t.input}`}
                  />
                  <button
                    onClick={savePersonality}
                    disabled={saving}
                    className={`w-full py-3 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${t.btn}`}
                  >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : <Save size={16} />}
                    {saved ? 'Salvo!' : 'Salvar personalidade'}
                  </button>
                </div>
              )}
            </>
          )}
          {error && <p className="text-red-400 text-xs mt-4">{error}</p>}
        </div>
      </div>
    </div>
  );
}