import React, { useState, useMemo } from 'react';
import {
  Search, Plus, Folder, MessageSquare, FileText, Pencil,
  ExternalLink, MoreVertical, Trash2, FolderOpen, X, Check,
  Loader2, Globe, Save
} from 'lucide-react';

// ─── New Project Modal ────────────────────────────────────────────────────────
function NewProjectModal({ darkMode, theme, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const t = {
    bg: darkMode ? 'bg-[#111]' : 'bg-white',
    border: darkMode ? 'border-white/10' : 'border-black/8',
    input: darkMode
      ? 'bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-white/30'
      : 'bg-black/3 border-black/10 text-black placeholder-black/25 focus:border-black/30',
    muted: darkMode ? 'text-white/40' : 'text-black/45',
    label: darkMode ? 'text-white/60' : 'text-black/55',
  };

  async function handleCreate() {
    if (!name.trim()) { setError('Nome é obrigatório'); return; }
    setLoading(true);
    setError('');
    try {
      await onCreate(name.trim(), description.trim(), instructions.trim());
      onClose();
    } catch (e) {
      setError(e.message || 'Erro ao criar projeto');
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`${t.bg} border ${t.border} w-full max-w-xl rounded-2xl shadow-2xl flex flex-col`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <h2 className="text-base font-semibold tracking-tight">Novo projeto</h2>
          <button onClick={onClose} className={`${t.muted} hover:text-current transition-colors`}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-6 space-y-4">
          <div>
            <label className={`text-[11px] font-medium uppercase tracking-widest ${t.label}`}>
              Nome *
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Ex: Startup de IA"
              className={`w-full mt-1.5 px-4 py-2.5 rounded-xl border text-sm transition-colors outline-none ${t.input}`}
            />
          </div>
          <div>
            <label className={`text-[11px] font-medium uppercase tracking-widest ${t.label}`}>
              Descrição curta
            </label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Breve descrição do projeto"
              className={`w-full mt-1.5 px-4 py-2.5 rounded-xl border text-sm transition-colors outline-none ${t.input}`}
            />
          </div>
          <div>
            <label className={`text-[11px] font-medium uppercase tracking-widest ${t.label}`}>
              Instruções do projeto
            </label>
            <p className={`text-[10px] mt-0.5 mb-1.5 ${t.muted}`}>
              Contexto persistente que o assistente usará em todos os chats deste projeto.
            </p>
            <textarea
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              rows={4}
              placeholder="Ex: Você é um assistente especialista em startups de tecnologia. Sempre responda de forma objetiva e com foco em crescimento..."
              className={`w-full px-4 py-3 rounded-xl border text-sm transition-colors outline-none resize-none ${t.input}`}
            />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className={`flex-1 py-2.5 rounded-xl border text-sm transition-all ${
                darkMode
                  ? 'border-white/15 text-white/50 hover:bg-white/5'
                  : 'border-black/15 text-black/50 hover:bg-black/5'
              }`}
            >
              Cancelar
            </button>
            <button
              onClick={handleCreate}
              disabled={loading}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                darkMode
                  ? 'bg-white text-black hover:bg-white/90'
                  : 'bg-black text-white hover:bg-black/85'
              }`}
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              Criar projeto
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────
function ProjectCard({ project, darkMode, theme, onOpen, onOpenDetails, onEdit, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  const chatCount = project.chat_count ?? project.chats?.length ?? 0;
  const fileCount = project.file_count ?? 0;

  // Generate a subtle color accent per project (deterministic from name)
  const accentColors = [
    { from: '#6366f1', to: '#8b5cf6' },
    { from: '#14b8a6', to: '#06b6d4' },
    { from: '#f59e0b', to: '#f97316' },
    { from: '#ec4899', to: '#f43f5e' },
    { from: '#22c55e', to: '#10b981' },
    { from: '#3b82f6', to: '#6366f1' },
  ];
  const colorIndex = (project.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % accentColors.length;
  const accent = accentColors[colorIndex];

  const cardBase = darkMode
    ? 'bg-[#161616] border-white/[0.07] hover:border-white/[0.14]'
    : 'bg-white border-black/[0.06] hover:border-black/[0.13]';

  const metaText = darkMode ? 'text-white/35' : 'text-black/35';
  const descText = darkMode ? 'text-white/50' : 'text-black/50';
  const nameText = darkMode ? 'text-white/90' : 'text-[#111]';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setMenuOpen(false); }}
      onClick={() => onOpenDetails(project)}
      className={`
        relative group cursor-pointer rounded-2xl border transition-all duration-300
        ${cardBase}
        ${hovered ? 'shadow-xl -translate-y-1' : 'shadow-sm'}
        overflow-hidden
      `}
      style={{ willChange: 'transform' }}
    >
      {/* Color strip top */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px] opacity-70"
        style={{ background: `linear-gradient(90deg, ${accent.from}, ${accent.to})` }}
      />

      {/* Card content */}
      <div className="p-5">
        {/* Icon + menu */}
        <div className="flex items-start justify-between mb-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: `linear-gradient(135deg, ${accent.from}22, ${accent.to}33)` }}
          >
            <Folder size={18} style={{ color: accent.from }} strokeWidth={1.5} />
          </div>

          {/* Action buttons on hover */}
          <div className={`flex items-center gap-1 transition-all duration-200 ${hovered ? 'opacity-100' : 'opacity-0'}`}>
            <button
              onClick={e => { e.stopPropagation(); onOpen(project); }}
              title="Ir direto para o chat"
              className={`p-1.5 rounded-lg transition-colors ${
                darkMode ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/8 text-black/40 hover:text-black'
              }`}
            >
              <ExternalLink size={13} />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onEdit(project); }}
              title="Editar"
              className={`p-1.5 rounded-lg transition-colors ${
                darkMode ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/8 text-black/40 hover:text-black'
              }`}
            >
              <Pencil size={13} />
            </button>
            <div className="relative">
              <button
                onClick={e => { e.stopPropagation(); setMenuOpen(m => !m); }}
                title="Mais opções"
                className={`p-1.5 rounded-lg transition-colors ${
                  darkMode ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/8 text-black/40 hover:text-black'
                }`}
              >
                <MoreVertical size={13} />
              </button>
              {menuOpen && (
                <div
                  onClick={e => e.stopPropagation()}
                  className={`absolute right-0 top-8 z-50 min-w-[130px] rounded-xl border shadow-xl py-1 ${
                    darkMode ? 'bg-[#1e1e1e] border-white/10' : 'bg-white border-black/8'
                  }`}
                >
                  <button
                    onClick={() => { setMenuOpen(false); onOpenDetails(project); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                      darkMode ? 'hover:bg-white/5 text-white/70' : 'hover:bg-black/4 text-black/70'
                    }`}
                  >
                    <FolderOpen size={13} /> Ver detalhes
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); onOpen(project); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                      darkMode ? 'hover:bg-white/5 text-white/70' : 'hover:bg-black/4 text-black/70'
                    }`}
                  >
                    <ExternalLink size={13} /> Ir para o chat
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); onEdit(project); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                      darkMode ? 'hover:bg-white/5 text-white/70' : 'hover:bg-black/4 text-black/70'
                    }`}
                  >
                    <Pencil size={13} /> Editar
                  </button>
                  <div className={`my-1 mx-2 border-t ${darkMode ? 'border-white/10' : 'border-black/8'}`} />
                  <button
                    onClick={() => { setMenuOpen(false); onDelete(project); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:text-red-500 transition-colors hover:bg-red-500/5"
                  >
                    <Trash2 size={13} /> Excluir
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Name */}
        <h3 className={`text-sm font-semibold leading-tight mb-1.5 ${nameText}`}>
          {project.name}
        </h3>

        {/* Description */}
        <p className={`text-xs font-light leading-relaxed truncate ${descText}`}>
          {project.summary || project.description || 'Sem descrição'}
        </p>

        {/* Metadata */}
        <div className={`flex items-center gap-4 mt-4 pt-4 border-t ${darkMode ? 'border-white/[0.06]' : 'border-black/[0.05]'}`}>
          <div className={`flex items-center gap-1.5 ${metaText}`}>
            <MessageSquare size={11} strokeWidth={1.5} />
            <span className="text-[11px] font-light">{chatCount} chat{chatCount !== 1 ? 's' : ''}</span>
          </div>
          <div className={`flex items-center gap-1.5 ${metaText}`}>
            <FileText size={11} strokeWidth={1.5} />
            <span className="text-[11px] font-light">{fileCount} arquivo{fileCount !== 1 ? 's' : ''}</span>
          </div>
          {project.tags?.length > 0 && (
            <div className="flex items-center gap-1 ml-auto">
              {project.tags.slice(0, 2).map(tag => (
                <span
                  key={tag}
                  className={`text-[10px] px-1.5 py-0.5 rounded-md font-light ${
                    darkMode ? 'bg-white/8 text-white/40' : 'bg-black/5 text-black/40'
                  }`}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ darkMode, onCreateProject }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 py-24 select-none">
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${
        darkMode ? 'bg-white/5' : 'bg-black/4'
      }`}>
        <FolderOpen size={28} strokeWidth={1} className={darkMode ? 'text-white/25' : 'text-black/25'} />
      </div>
      <div className="text-center space-y-1.5">
        <h3 className={`text-base font-semibold ${darkMode ? 'text-white/80' : 'text-[#111]'}`}>
          Crie seu primeiro projeto
        </h3>
        <p className={`text-sm font-light ${darkMode ? 'text-white/35' : 'text-black/40'}`}>
          Organize chats, arquivos e contexto em um só lugar.
        </p>
      </div>
      <button
        onClick={onCreateProject}
        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
          darkMode
            ? 'bg-white text-black hover:bg-white/90'
            : 'bg-black text-white hover:bg-black/85'
        }`}
      >
        <Plus size={15} />
        Criar projeto
      </button>
    </div>
  );
}

// ─── Main ProjectsView ────────────────────────────────────────────────────────
export function ProjectsView({
  darkMode,
  theme,
  projects,
  onCreateProject,
  onOpenProject,
  onOpenProjectDetails,
  onEditProject,
  onDeleteProject,
}) {
  const [search, setSearch] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      p.summary?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    );
  }, [projects, search]);

  async function handleCreate(name, description, instructions) {
    // Pass instructions as detailed_objective (maps to existing backend field)
    await onCreateProject(name, description, instructions);
  }

  return (
    <div className="flex flex-col h-full">
      {showNewModal && (
        <NewProjectModal
          darkMode={darkMode}
          theme={theme}
          onClose={() => setShowNewModal(false)}
          onCreate={handleCreate}
        />
      )}

      {/* ── Header ── */}
      <div className={`px-8 md:px-12 pt-10 pb-6 border-b ${theme.border} shrink-0`}>
        <div className="flex items-center justify-between mb-6">
          <h1 className={`text-xl font-semibold tracking-tight ${theme.textPrimary}`}>
            Projetos
          </h1>
          <button
            onClick={() => setShowNewModal(true)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              darkMode
                ? 'bg-white text-black hover:bg-white/90'
                : 'bg-black text-white hover:bg-black/85'
            }`}
          >
            <Plus size={15} />
            Novo projeto
          </button>
        </div>

        {/* Search */}
        <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-colors ${
          darkMode
            ? 'bg-white/4 border-white/10 focus-within:border-white/25'
            : 'bg-black/3 border-black/8 focus-within:border-black/20'
        }`}>
          <Search size={15} className={theme.textMuted} strokeWidth={1.5} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar projetos..."
            className={`bg-transparent border-none outline-none text-sm font-light w-full ${
              darkMode
                ? 'text-white placeholder:text-white/25'
                : 'text-black placeholder:text-black/30'
            }`}
          />
          {search && (
            <button onClick={() => setSearch('')} className={theme.textMuted}>
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-8 md:px-12 py-8">
        {projects.length === 0 ? (
          <EmptyState darkMode={darkMode} onCreateProject={() => setShowNewModal(true)} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Search size={28} strokeWidth={1} className={theme.textMuted} />
            <p className={`text-sm font-light ${theme.textSecondary}`}>
              Nenhum projeto encontrado para "{search}"
            </p>
          </div>
        ) : (
          <>
            {/* Project count */}
            <p className={`text-xs font-light mb-6 ${theme.textMuted}`}>
              {filtered.length} projeto{filtered.length !== 1 ? 's' : ''}
              {search ? ` para "${search}"` : ''}
            </p>

            {/* Responsive grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {filtered.map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  darkMode={darkMode}
                  theme={theme}
                  onOpen={onOpenProject}
                  onOpenDetails={onOpenProjectDetails}
                  onEdit={onEditProject}
                  onDelete={onDeleteProject}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}