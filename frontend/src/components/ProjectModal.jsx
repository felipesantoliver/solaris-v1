import React, { useState, useEffect, useCallback } from 'react';
import { X, Save, Loader2, Check, Globe, FileText, Trash2 } from 'lucide-react';
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

export function ProjectModal({ project, onClose, onUpdate, darkMode, effectiveUserId }) {
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
    bg: darkMode ? 'bg-[#1E3A5F]' : 'bg-white',
    border: darkMode ? 'border-[#F5A623]/15' : 'border-[#1E3A5F]/10',
    muted: darkMode ? 'text-[#E8F0F9]/40' : 'text-[#1E3A5F]/50',
    text: darkMode ? 'text-[#E8F0F9]/80' : 'text-[#0D1B2A]/80',
    input: darkMode ? 'bg-[#0D1B2A]/60 border-[#F5A623]/15 text-[#E8F0F9] placeholder-[#E8F0F9]/30' : 'bg-[#1E3A5F]/5 border-[#1E3A5F]/10 text-[#0D1B2A] placeholder-[#1E3A5F]/30',
    btn: darkMode ? 'bg-[#F5A623] text-[#0D1B2A] font-semibold hover:bg-[#F5A623]/85' : 'bg-[#0D1B2A] text-white hover:bg-[#1E3A5F]',
    btnOutline: darkMode ? 'border-[#E8F0F9]/20 hover:bg-[#E8F0F9]/5' : 'border-[#1E3A5F]/20 hover:bg-[#1E3A5F]/5',
  };

  const fetchSources = useCallback(async () => {
    if (!project) return;
    try {
      const data = await api.getSources(project.id, effectiveUserId);
      setSources(data);
    } catch (err) { console.error(err); }
  }, [project, effectiveUserId]);

  useEffect(() => { if (project && activeTab === 'sources') fetchSources(); }, [activeTab, project, fetchSources]);

  async function handleUpdate() {
    if (!name.trim()) { setError('Nome é obrigatório'); return; }
    setLoading(true); setError('');
    try {
      const tagsArray = tags.split(',').map(t => t.trim()).filter(t => t);
      const updated = await onUpdate(project.id, {
        name, summary, detailed_objective: detailedObjective,
        tags: tagsArray, response_style: responseStyle, memory_mode: memoryMode
      });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      // A função onUpdate já tratou da atualização no componente pai,
      // nenhuma chamada extra é necessária.
    } catch (err) { setError(err.message); }
    setLoading(false);
  }

  async function addUrlSource() {
    if (!newUrl.trim()) return;
    setAddingSource(true);
    try {
      await api.addUrlSource(project.id, newUrl, newUrlTitle || undefined, effectiveUserId);
      await fetchSources();
      setNewUrl(''); setNewUrlTitle('');
    } catch (err) { alert(err.message); }
    setAddingSource(false);
  }

  async function addTextSource() {
    if (!newText.trim()) return;
    setAddingSource(true);
    try {
      await api.addTextSource(project.id, newText, newTextTitle || 'Texto adicionado', effectiveUserId);
      await fetchSources();
      setNewText(''); setNewTextTitle('');
    } catch (err) { alert(err.message); }
    setAddingSource(false);
  }

  async function deleteSource(sourceId) {
    if (!confirm('Remover esta fonte?')) return;
    try {
      await api.deleteSource(project.id, sourceId, effectiveUserId);
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
          <button onClick={() => setActiveTab('edit')} className={`px-6 py-3 text-sm font-medium transition-all ${activeTab === 'edit' ? (darkMode ? 'border-b-2 border-[#F5A623] text-[#F5A623]' : 'border-b-2 border-[#0D1B2A] text-[#0D1B2A]') : t.muted}`}>Editar</button>
          <button onClick={() => setActiveTab('sources')} className={`px-6 py-3 text-sm font-medium transition-all ${activeTab === 'sources' ? (darkMode ? 'border-b-2 border-[#F5A623] text-[#F5A623]' : 'border-b-2 border-[#0D1B2A] text-[#0D1B2A]') : t.muted}`}>Fontes</button>
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