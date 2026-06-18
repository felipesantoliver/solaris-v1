import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Pencil, RotateCcw, Check, Loader2, Star, Copy, Terminal } from 'lucide-react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import githubGist from 'react-syntax-highlighter/dist/esm/styles/hljs/github-gist';
import githubDark from 'react-syntax-highlighter/dist/esm/styles/hljs/github';

// Registra apenas as linguagens usadas (evita bundle gigante)
import js from 'react-syntax-highlighter/dist/esm/languages/hljs/javascript';
import ts from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript';
import python from 'react-syntax-highlighter/dist/esm/languages/hljs/python';
import java from 'react-syntax-highlighter/dist/esm/languages/hljs/java';
import cpp from 'react-syntax-highlighter/dist/esm/languages/hljs/cpp';
import c from 'react-syntax-highlighter/dist/esm/languages/hljs/c';
import csharp from 'react-syntax-highlighter/dist/esm/languages/hljs/csharp';
import html from 'react-syntax-highlighter/dist/esm/languages/hljs/xml';
import css from 'react-syntax-highlighter/dist/esm/languages/hljs/css';
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import sql from 'react-syntax-highlighter/dist/esm/languages/hljs/sql';
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash';
import go from 'react-syntax-highlighter/dist/esm/languages/hljs/go';
import rust from 'react-syntax-highlighter/dist/esm/languages/hljs/rust';
import php from 'react-syntax-highlighter/dist/esm/languages/hljs/php';
import ruby from 'react-syntax-highlighter/dist/esm/languages/hljs/ruby';
import swift from 'react-syntax-highlighter/dist/esm/languages/hljs/swift';
import kotlin from 'react-syntax-highlighter/dist/esm/languages/hljs/kotlin';
import yaml from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml';
import xml from 'react-syntax-highlighter/dist/esm/languages/hljs/xml';
import markdown from 'react-syntax-highlighter/dist/esm/languages/hljs/markdown';

SyntaxHighlighter.registerLanguage('javascript', js);
SyntaxHighlighter.registerLanguage('js', js);
SyntaxHighlighter.registerLanguage('typescript', ts);
SyntaxHighlighter.registerLanguage('ts', ts);
SyntaxHighlighter.registerLanguage('jsx', js);
SyntaxHighlighter.registerLanguage('tsx', ts);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('py', python);
SyntaxHighlighter.registerLanguage('java', java);
SyntaxHighlighter.registerLanguage('cpp', cpp);
SyntaxHighlighter.registerLanguage('c', c);
SyntaxHighlighter.registerLanguage('csharp', csharp);
SyntaxHighlighter.registerLanguage('cs', csharp);
SyntaxHighlighter.registerLanguage('html', html);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('sh', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('go', go);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('php', php);
SyntaxHighlighter.registerLanguage('ruby', ruby);
SyntaxHighlighter.registerLanguage('rb', ruby);
SyntaxHighlighter.registerLanguage('swift', swift);
SyntaxHighlighter.registerLanguage('kotlin', kotlin);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('yml', yaml);
SyntaxHighlighter.registerLanguage('xml', xml);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('md', markdown);

// Mapa de nomes amigáveis para exibição no header
const LANGUAGE_LABELS = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  py: 'Python',
  python: 'Python',
  cpp: 'C++',
  c: 'C',
  cs: 'C#',
  csharp: 'C#',
  java: 'Java',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  sql: 'SQL',
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
  go: 'Go',
  rust: 'Rust',
  php: 'PHP',
  rb: 'Ruby',
  ruby: 'Ruby',
  swift: 'Swift',
  kotlin: 'Kotlin',
  yaml: 'YAML',
  yml: 'YAML',
  xml: 'XML',
  md: 'Markdown',
  markdown: 'Markdown',
};

function CodeBlock({ language, children, darkMode }) {
  const [copied, setCopied] = useState(false);

  // Normaliza children para string, evitando o bug "[object Object]"
  const codeString = Array.isArray(children)
    ? children.map(c => (typeof c === 'string' ? c : '')).join('')
    : String(children ?? '');

  const lang = language?.toLowerCase() || 'text';
  const displayLabel = LANGUAGE_LABELS[lang] || language || 'Código';

  const handleCopy = () => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`my-5 rounded-xl overflow-hidden shadow-lg border-2 ${darkMode ? 'border-white/20' : 'border-black/15'}`}>
      {/* Header: linguagem + botão copiar */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-b-2 ${darkMode ? 'bg-white/5 border-white/20' : 'bg-black/5 border-black/15'}`}>
        <div className="flex items-center gap-2">
          <Terminal size={13} className="text-amber-400/80" />
          <span className={`text-xs font-mono font-semibold tracking-wide uppercase ${darkMode ? 'text-white/60' : 'text-black/50'}`}>
            {displayLabel}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className={`flex items-center gap-1.5 text-[11px] font-semibold transition-all duration-200 px-3 py-1.5 rounded-lg border ${
            copied
              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
              : darkMode
                ? 'bg-white/10 border-white/20 text-white/70 hover:bg-white/20 hover:text-white hover:border-white/40'
                : 'bg-black/8 border-black/20 text-black/60 hover:bg-black/15 hover:text-black hover:border-black/40'
          }`}
        >
          {copied ? (
            <>
              <Check size={12} />
              <span>copiado!</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>copiar código</span>
            </>
          )}
        </button>
      </div>

      {/* Corpo: código com syntax highlighting */}
      <SyntaxHighlighter
        language={lang}
        style={darkMode ? githubDark : githubGist}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: '0.875rem',
          lineHeight: '1.6',
          padding: '1rem',
          background: darkMode ? '#0d1117' : '#f6f8fa',
        }}
        codeTagProps={{ style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }}
      >
        {codeString}
      </SyntaxHighlighter>
    </div>
  );
}

export const MessageBubble = React.memo(({
  msg,
  index,
  darkMode,
  theme,
  onEdit,
  isEditing,
  editValue,
  setEditValue,
  onEditSave,
  onEditCancel,
  isLoading,
  programmingMode,
  isLastAssistant,
  isStreaming,
}) => {
  const [showHistory, setShowHistory] = useState(false);
  const editRef = useRef(null);

  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus();
      editRef.current.style.height = 'auto';
      editRef.current.style.height = editRef.current.scrollHeight + 'px';
    }
  }, [isEditing]);

  const hasHistory = Array.isArray(msg.edit_history) && msg.edit_history.length > 0;

  const showCursor = isLastAssistant && isStreaming && msg.content.length > 0;

  // Estilo base para mensagens do assistente
  const assistantTextClass = `text-base leading-relaxed transition-colors duration-500 ${
    darkMode ? 'text-white/60 font-light' : 'text-gray-600 font-light'
  }`;

  const renderContent = () => {
    // Mensagens do usuário: sempre texto puro
    if (msg.role === 'user') {
      return (
        <div className={`text-base leading-relaxed transition-colors duration-500 whitespace-pre-wrap ${
          darkMode ? 'text-white font-medium' : 'text-black font-medium'
        }`}>
          {msg.content}
        </div>
      );
    }

    // Mensagens do assistente: sempre ReactMarkdown (bold, listas, etc.)
    // Se a mensagem foi enviada com code mode, também renderiza blocos de código
    const msgHasCodeMode = msg.codingMode === true;

    return (
      <div className={`relative ${assistantTextClass}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Negrito e itálico funcionam em todos os modos
            strong({ children }) {
              return <strong className="font-semibold">{children}</strong>;
            },
            em({ children }) {
              return <em className="italic">{children}</em>;
            },
            // Listas
            ul({ children }) {
              return <ul className="list-disc list-inside space-y-1 my-2">{children}</ul>;
            },
            ol({ children }) {
              return <ol className="list-decimal list-inside space-y-1 my-2">{children}</ol>;
            },
            li({ children }) {
              return <li className="text-base leading-relaxed">{children}</li>;
            },
            // Parágrafos
            p({ children }) {
              return <p className="mb-2 last:mb-0">{children}</p>;
            },
            // Código inline: sempre renderizado
            // Blocos de código: só com syntax highlighting se msg foi enviada com code mode
            code({ node, inline, className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              const language = match ? match[1] : '';
              if (!inline) {
                return msgHasCodeMode
                  ? <CodeBlock language={language} darkMode={darkMode}>{children}</CodeBlock>
                  : (
                    <pre className={`my-3 p-3 rounded-lg text-sm font-mono overflow-x-auto ${darkMode ? 'bg-white/5 text-white/80' : 'bg-black/5 text-black/80'}`}>
                      <code>{children}</code>
                    </pre>
                  );
              }
              return (
                <code
                  className={`${className} ${msgHasCodeMode ? 'bg-amber-400/10 text-amber-300' : (darkMode ? 'bg-white/10 text-white/80' : 'bg-black/8 text-black/70')} px-1.5 py-0.5 rounded text-[0.85em] font-mono`}
                  {...props}
                >
                  {children}
                </code>
              );
            },
            h3({ children, ...props }) {
              const isFileName = /^[`\w\-\.]+$/.test(children);
              if (isFileName && msgHasCodeMode) {
                return <h3 className="text-sm font-mono font-bold mt-4 mb-2 text-amber-400 border-l-2 border-amber-400 pl-2" {...props}>{children}</h3>;
              }
              return <h3 className={`text-sm font-semibold mt-3 mb-1 ${darkMode ? 'text-white/80' : 'text-black/80'}`} {...props}>{children}</h3>;
            },
            h1({ children, ...props }) {
              return <h1 className={`text-base font-bold mt-4 mb-2 ${darkMode ? 'text-white/90' : 'text-black/90'}`} {...props}>{children}</h1>;
            },
            h2({ children, ...props }) {
              return <h2 className={`text-sm font-bold mt-3 mb-1 ${darkMode ? 'text-white/85' : 'text-black/85'}`} {...props}>{children}</h2>;
            },
          }}
        >
          {msg.content}
        </ReactMarkdown>
        {showCursor && (
          <span className={`inline-block w-0.5 h-4 ml-0.5 align-middle animate-pulse ${darkMode ? 'bg-white/60' : 'bg-black/60'}`} />
        )}
      </div>
    );
  };

  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group/msg animate-in fade-in slide-in-from-bottom-2 duration-700`}>
      <div className={`max-w-[70%] ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
        <div className={`text-[9px] uppercase tracking-[0.2em] font-bold mb-3 ${theme.textMuted}`}>
          {msg.role === 'user' ? (
            <span className="flex items-center gap-1.5 justify-end">
              Você
              {msg.codingMode && <span className="text-[8px] bg-cyan-500/15 text-cyan-400/70 px-1.5 rounded-full">code</span>}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              Solaris{msg.model === 'pro' && <span className="flex items-center gap-0.5 text-amber-400 opacity-70"><Star size={8} />pro</span>}
              {msg.codingMode && <span className="ml-2 text-[8px] bg-amber-500/20 text-amber-300 px-1.5 rounded-full">modo programador</span>}
            </span>
          )}
          {msg.edited && <span className="ml-2 normal-case tracking-normal font-normal opacity-50">(editado)</span>}
        </div>
        {isEditing ? (
          <div className="text-left">
            <textarea
              ref={editRef}
              value={editValue}
              onChange={e => { setEditValue(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEditSave(); } if (e.key === 'Escape') onEditCancel(); }}
              className={`w-full bg-transparent border-b ${theme.inputBorder} text-base leading-relaxed resize-none focus:outline-none py-1 font-light ${darkMode ? 'text-white' : 'text-black'}`}
              rows={1}
            />
            <div className="flex items-center gap-3 mt-2 justify-end">
              <button onClick={onEditCancel} className={`text-xs ${theme.textMuted} hover:text-current transition-colors`}>cancelar</button>
              <button
                onClick={onEditSave}
                disabled={isLoading || !editValue.trim()}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all ${darkMode ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-black/10 text-black hover:bg-black/20'} disabled:opacity-40`}
              >
                {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}Salvar e regerar
              </button>
            </div>
          </div>
        ) : (
          <>
            {renderContent()}
            {msg.role === 'user' && !isLoading && (
              <div className="flex items-center gap-2 mt-1.5 justify-end opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200">
                {hasHistory && (
                  <button onClick={() => setShowHistory(!showHistory)} className={`flex items-center gap-1 text-[10px] ${theme.textMuted} hover:text-current transition-colors`}>
                    <RotateCcw size={10} />{msg.edit_history.length}v
                  </button>
                )}
                <button onClick={() => onEdit(index, msg.content)} className={`flex items-center gap-1 text-[10px] ${theme.textMuted} hover:text-current transition-colors`}>
                  <Pencil size={10} />editar
                </button>
              </div>
            )}
          </>
        )}
        {showHistory && hasHistory && !isEditing && (
          <div className={`mt-3 text-left border-l-2 ${darkMode ? 'border-white/10' : 'border-black/10'} pl-3 space-y-2`}>
            <p className={`text-[10px] uppercase tracking-widest ${theme.textMuted} mb-2`}>Versões anteriores</p>
            {msg.edit_history.map((h, i) => (
              <p key={i} className={`text-xs ${theme.textMuted} font-light`}>
                <span className="opacity-50 mr-2">{i + 1}.</span>{h.content}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});