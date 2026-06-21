import React, { useMemo, useState } from 'react';
import {
  ArrowLeft, Search, BookOpen, SlidersHorizontal, Info, Moon, Sun, X,
} from 'lucide-react';
import { MANUAL_TOPICS } from '../config/manualContent';

const NAV_ITEMS = [
  { id: 'manual', label: 'Manual do Agente', icon: BookOpen },
  { id: 'preferencias', label: 'Preferências', icon: SlidersHorizontal },
  { id: 'sobre', label: 'Sobre', icon: Info },
];

// ─── Manual do Agente ────────────────────────────────────────────────────────
function ManualSection({ darkMode, theme }) {
  const [query, setQuery] = useState('');

  // Busca leve e instantânea, 100% no frontend — filtra por título e descrição.
  const filteredTopics = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MANUAL_TOPICS;
    return MANUAL_TOPICS.filter(
      t => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    );
  }, [query]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className={`text-lg font-semibold tracking-tight ${theme.textPrimary}`}>Manual do Agente</h2>
        <p className={`text-sm font-light mt-1 ${theme.textSecondary}`}>
          Um guia rápido sobre como cada parte do Solaris funciona.
        </p>
      </div>

      {/* Lupa de pesquisa */}
      <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-colors ${
        darkMode
          ? 'bg-white/4 border-white/10 focus-within:border-white/25'
          : 'bg-black/3 border-black/8 focus-within:border-black/20'
      }`}>
        <Search size={15} className={theme.textMuted} strokeWidth={1.5} />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar no manual..."
          className={`bg-transparent border-none outline-none text-sm font-light w-full ${
            darkMode ? 'text-white placeholder:text-white/25' : 'text-black placeholder:text-black/30'
          }`}
        />
        {query && (
          <button onClick={() => setQuery('')} className={theme.textMuted}>
            <X size={13} />
          </button>
        )}
      </div>

      {filteredTopics.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Search size={26} strokeWidth={1} className={theme.textMuted} />
          <p className={`text-sm font-light ${theme.textSecondary}`}>
            Nenhum tópico encontrado para "{query}"
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredTopics.map(topic => (
            <details
              key={topic.id}
              className={`group rounded-xl border transition-colors ${theme.border} ${darkMode ? 'bg-white/[0.03]' : 'bg-black/[0.02]'}`}
            >
              <summary className="flex items-center justify-between gap-3 cursor-pointer list-none px-5 py-4">
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${theme.textPrimary}`}>{topic.title}</p>
                  <p className={`text-xs font-light mt-0.5 ${theme.textSecondary}`}>{topic.description}</p>
                </div>
                <span className={`shrink-0 text-xs ${theme.textMuted} transition-transform group-open:rotate-180`}>▾</span>
              </summary>
              <div className={`px-5 pb-5 flex flex-col gap-3 border-t ${theme.border} pt-4`}>
                {topic.body.map((paragraph, i) => (
                  <p key={i} className={`text-sm font-light leading-relaxed ${theme.textSecondary}`}>
                    {paragraph}
                  </p>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Preferências ────────────────────────────────────────────────────────────
function PreferenciasSection({ darkMode, setDarkMode, theme }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className={`text-lg font-semibold tracking-tight ${theme.textPrimary}`}>Preferências</h2>
        <p className={`text-sm font-light mt-1 ${theme.textSecondary}`}>
          Ajustes gerais de aparência do Solaris.
        </p>
      </div>

      <div className={`rounded-xl border divide-y ${theme.border} ${darkMode ? 'divide-white/10' : 'divide-black/5'}`}>
        <div className="flex items-center justify-between gap-6 px-5 py-4">
          <div className="min-w-0">
            <p className={`text-sm font-medium ${theme.textPrimary}`}>Tema</p>
            <p className={`text-xs font-light mt-0.5 ${theme.textSecondary}`}>Claro ou escuro.</p>
          </div>
          <button
            onClick={() => setDarkMode(d => !d)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-light transition-all ${theme.border} ${theme.textSecondary} hover:text-current`}
          >
            {darkMode ? <Sun size={14} strokeWidth={1.5} /> : <Moon size={14} strokeWidth={1.5} />}
            {darkMode ? 'Escuro' : 'Claro'}
          </button>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-4">
          <div className="min-w-0">
            <p className={`text-sm font-medium ${theme.textPrimary}`}>Idioma</p>
            <p className={`text-xs font-light mt-0.5 ${theme.textSecondary}`}>
              Apenas português está disponível por enquanto.
            </p>
          </div>
          <span className={`text-xs font-light px-3 py-1.5 rounded-lg border ${theme.border} ${theme.textMuted}`}>
            Português (BR)
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Sobre ───────────────────────────────────────────────────────────────────
function SobreSection({ theme }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className={`text-lg font-semibold tracking-tight ${theme.textPrimary}`}>Sobre</h2>
        <p className={`text-sm font-light mt-1 ${theme.textSecondary}`}>
          Informações sobre o Solaris.
        </p>
      </div>
      <div className={`rounded-xl border px-5 py-4 flex flex-col gap-2 ${theme.border}`}>
        <p className={`text-sm font-light ${theme.textSecondary}`}>
          <span className={`font-medium ${theme.textPrimary}`}>Solaris</span> é um assistente pessoal de IA com
          memória persistente, organização por projetos e suporte a múltiplos modelos de linguagem — projetado
          para funcionar como um segundo cérebro.
        </p>
        <p className={`text-xs font-light ${theme.textMuted}`}>Versão atual: v1.0.0 — Solaris Core</p>
      </div>
    </div>
  );
}

export function HelpCenterView({ darkMode, setDarkMode, theme, onBack }) {
  const [activeSection, setActiveSection] = useState('manual');

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className={`flex items-center gap-3 px-8 md:px-12 pt-10 pb-6 border-b ${theme.border} shrink-0`}>
        <button
          onClick={onBack}
          title="Voltar"
          className={`p-1.5 -ml-1.5 rounded-lg transition-all ${theme.textMuted} hover:text-current ${theme.projectHover}`}
        >
          <ArrowLeft size={18} strokeWidth={1.5} />
        </button>
        <h1 className={`text-xl font-semibold tracking-tight ${theme.textPrimary}`}>Configurações</h1>
      </div>

      {/* ── Corpo: sub-sidebar + conteúdo ── */}
      <div className="flex flex-1 overflow-hidden">
        <nav className={`hidden sm:flex flex-col gap-1 w-56 shrink-0 px-4 py-6 border-r ${theme.border} overflow-y-auto custom-scrollbar`}>
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-light transition-all ${
                  active ? theme.projectActive : `${theme.textSecondary} ${theme.projectHover}`
                }`}
              >
                <Icon size={16} strokeWidth={1.5} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Nav mobile (abas horizontais) */}
        <div className="sm:hidden flex flex-col flex-1 overflow-hidden">
          <div className={`flex items-center gap-1 px-4 py-3 border-b ${theme.border} overflow-x-auto shrink-0`}>
            {NAV_ITEMS.map(item => {
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-light whitespace-nowrap transition-all ${
                    active ? theme.projectActive : `${theme.textSecondary} ${theme.projectHover}`
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-8">
            {activeSection === 'manual' && <ManualSection darkMode={darkMode} theme={theme} />}
            {activeSection === 'preferencias' && <PreferenciasSection darkMode={darkMode} setDarkMode={setDarkMode} theme={theme} />}
            {activeSection === 'sobre' && <SobreSection theme={theme} />}
          </div>
        </div>

        <div className="hidden sm:block flex-1 overflow-y-auto custom-scrollbar px-8 md:px-12 py-8">
          {activeSection === 'manual' && <ManualSection darkMode={darkMode} theme={theme} />}
          {activeSection === 'preferencias' && <PreferenciasSection darkMode={darkMode} setDarkMode={setDarkMode} theme={theme} />}
          {activeSection === 'sobre' && <SobreSection theme={theme} />}
        </div>
      </div>
    </div>
  );
}