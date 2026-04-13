import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Pencil, RotateCcw, Check, Loader2, Star, Copy, Terminal } from 'lucide-react';
import 'highlight.js/styles/github-dark.css';

const LANGUAGE_LABELS = {
  js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript',
  jsx: 'JSX', tsx: 'TSX', py: 'Python', python: 'Python', cpp: 'C++', c: 'C',
  cs: 'C#', csharp: 'C#', java: 'Java', html: 'HTML', css: 'CSS', json: 'JSON',
  sql: 'SQL', bash: 'Bash', sh: 'Shell', shell: 'Shell', go: 'Go', rust: 'Rust',
  php: 'PHP', rb: 'Ruby', ruby: 'Ruby', swift: 'Swift', kotlin: 'Kotlin',
  yaml: 'YAML', yml: 'YAML', xml: 'XML', md: 'Markdown', markdown: 'Markdown',
};

// Fix bug [object Object]: normaliza content que pode vir como string ou array Anthropic
function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(block => {
      if (typeof block === 'string') return block;
      if (block && typeof block === 'object') {
        if (block.type === 'text') return block.text || '';
        if (block.text) return block.text;
      }
      return '';
    }).join('');
  }
  if (content && typeof content === 'object' && content.text) return content.text;
  return '';
}

function CodeBlock({ language, children, darkMode }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayLabel = LANGUAGE_LABELS[language?.toLowerCase()] || language || 'código';

  return (
    <div style={{
      margin: '16px 0',
      borderRadius: '8px',
      overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.1)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
      fontFamily: "'Söhne Mono', ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace",
    }}>
      {/* Header estilo ChatGPT */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        backgroundColor: '#2f2f2f',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Terminal size={13} style={{ color: '#9ca3af' }} />
          <span style={{
            fontSize: '12px',
            fontFamily: 'monospace',
            fontWeight: 600,
            color: '#9ca3af',
            letterSpacing: '0.03em',
          }}>
            {displayLabel}
          </span>
        </div>
        <button
          onClick={handleCopy}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '12px',
            color: copied ? '#4ade80' : '#9ca3af',
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '4px 8px', borderRadius: '6px',
            transition: 'all 0.15s',
          }}
        >
          {copied ? (
            <><Check size={12} style={{ color: '#4ade80' }} /><span>copiado</span></>
          ) : (
            <><Copy size={12} /><span>copiar</span></>
          )}
        </button>
      </div>

      {/* Corpo — sempre dark, igual ao ChatGPT */}
      <pre style={{
        margin: 0, padding: '16px', overflowX: 'auto',
        backgroundColor: '#1e1e1e',
        fontSize: '13px', lineHeight: 1.6,
      }}>
        <code style={{
          color: '#e5e7eb',
          fontFamily: 'inherit',
          whiteSpace: 'pre',
        }}>
          {children}
        </code>
      </pre>
    </div>
  );
}

export const MessageBubble = React.memo(({
  msg, index, darkMode, theme, onEdit, isEditing, editValue, setEditValue,
  onEditSave, onEditCancel, isLoading, programmingMode, isLastAssistant, isStreaming,
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
  const contentStr = normalizeContent(msg.content);
  const showCursor = isLastAssistant && isStreaming && contentStr.length > 0;

  const renderContent = () => {
    if (msg.role === 'assistant' && programmingMode) {
      const textColor = darkMode ? 'rgba(255,255,255,0.85)' : '#111827';
      return (
        <div className="relative" style={{ color: textColor, fontSize: '14px', lineHeight: '1.75' }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              code({ node, inline, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const language = match ? match[1] : '';
                return !inline ? (
                  <CodeBlock language={language} darkMode={darkMode}>
                    {String(children).replace(/\n$/, '')}
                  </CodeBlock>
                ) : (
                  <code style={{
                    backgroundColor: darkMode ? 'rgba(251,191,36,0.12)' : 'rgba(0,0,0,0.07)',
                    color: darkMode ? '#fbbf24' : '#b45309',
                    padding: '1px 6px', borderRadius: '4px',
                    fontSize: '0.85em', fontFamily: 'monospace',
                  }} {...props}>{children}</code>
                );
              },
              p({ children }) {
                return <p style={{ margin: '0 0 12px 0', color: darkMode ? 'rgba(255,255,255,0.82)' : '#1f2937' }}>{children}</p>;
              },
              h1({ children }) { return <h1 style={{ fontSize: '1.25em', fontWeight: 700, margin: '20px 0 8px', color: darkMode ? '#fff' : '#111' }}>{children}</h1>; },
              h2({ children }) { return <h2 style={{ fontSize: '1.1em', fontWeight: 700, margin: '16px 0 6px', color: darkMode ? '#fff' : '#111' }}>{children}</h2>; },
              h3({ children, ...props }) {
                const isFileName = typeof children === 'string' && /^[`\w\-\.]+$/.test(children);
                return isFileName
                  ? <h3 style={{ fontSize: '13px', fontFamily: 'monospace', fontWeight: 700, margin: '16px 0 8px', color: '#f59e0b', borderLeft: '2px solid #f59e0b', paddingLeft: '8px' }} {...props}>{children}</h3>
                  : <h3 style={{ fontSize: '1em', fontWeight: 600, margin: '12px 0 4px', color: darkMode ? '#fff' : '#111' }} {...props}>{children}</h3>;
              },
              ul({ children }) { return <ul style={{ paddingLeft: '20px', margin: '8px 0', color: darkMode ? 'rgba(255,255,255,0.82)' : '#1f2937' }}>{children}</ul>; },
              ol({ children }) { return <ol style={{ paddingLeft: '20px', margin: '8px 0', color: darkMode ? 'rgba(255,255,255,0.82)' : '#1f2937' }}>{children}</ol>; },
              li({ children }) { return <li style={{ margin: '4px 0' }}>{children}</li>; },
              strong({ children }) { return <strong style={{ fontWeight: 700, color: darkMode ? '#fff' : '#111' }}>{children}</strong>; },
              blockquote({ children }) {
                return <blockquote style={{
                  borderLeft: `3px solid ${darkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'}`,
                  paddingLeft: '12px', margin: '8px 0',
                  color: darkMode ? 'rgba(255,255,255,0.55)' : '#6b7280',
                  fontStyle: 'italic',
                }}>{children}</blockquote>;
              },
            }}
          >
            {contentStr}
          </ReactMarkdown>
          {showCursor && (
            <span className={`inline-block w-0.5 h-4 ml-0.5 align-middle animate-pulse ${darkMode ? 'bg-white/60' : 'bg-black/60'}`} />
          )}
        </div>
      );
    }

    return (
      <div className={`text-base leading-relaxed transition-colors duration-500 whitespace-pre-wrap ${
        msg.role === 'user'
          ? (darkMode ? 'text-white font-medium' : 'text-black font-medium')
          : (darkMode ? 'text-white/60 font-light' : 'text-gray-600 font-light')
      }`}>
        {contentStr}
        {showCursor && (
          <span className={`inline-block w-0.5 h-4 ml-0.5 align-middle animate-pulse ${darkMode ? 'bg-white/40' : 'bg-black/40'}`} />
        )}
      </div>
    );
  };

  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group/msg animate-in fade-in slide-in-from-bottom-2 duration-700`}>
      <div className={`max-w-[70%] ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
        <div className={`text-[9px] uppercase tracking-[0.2em] font-bold mb-3 ${theme.textMuted}`}>
          {msg.role === 'user' ? 'Você' : (
            <span className="flex items-center gap-1.5">
              Solaris{msg.model === 'pro' && <span className="flex items-center gap-0.5 text-amber-400 opacity-70"><Star size={8} />pro</span>}
              {programmingMode && msg.role === 'assistant' && <span className="ml-2 text-[8px] bg-amber-500/20 text-amber-300 px-1.5 rounded-full">modo programador</span>}
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
                <button onClick={() => onEdit(index, contentStr)} className={`flex items-center gap-1 text-[10px] ${theme.textMuted} hover:text-current transition-colors`}>
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
                <span className="opacity-50 mr-2">{i + 1}.</span>{normalizeContent(h.content)}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
