import React, { useState, useEffect, useMemo, useRef, useId } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, Terminal, Loader2, AlertTriangle } from 'lucide-react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import githubGist from 'react-syntax-highlighter/dist/esm/styles/hljs/github-gist';
import githubDark from 'react-syntax-highlighter/dist/esm/styles/hljs/github';

// Registra apenas as linguagens usadas (evita o bundle gigante do hljs completo)
import js from 'react-syntax-highlighter/dist/esm/languages/hljs/javascript';
import ts from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript';
import python from 'react-syntax-highlighter/dist/esm/languages/hljs/python';
import java from 'react-syntax-highlighter/dist/esm/languages/hljs/java';
import cpp from 'react-syntax-highlighter/dist/esm/languages/hljs/cpp';
import c from 'react-syntax-highlighter/dist/esm/languages/hljs/c';
import csharp from 'react-syntax-highlighter/dist/esm/languages/hljs/csharp';
import xml from 'react-syntax-highlighter/dist/esm/languages/hljs/xml';
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
import markdown from 'react-syntax-highlighter/dist/esm/languages/hljs/markdown';

[
  ['javascript', js], ['js', js], ['typescript', ts], ['ts', ts], ['jsx', js], ['tsx', ts],
  ['python', python], ['py', python], ['java', java], ['cpp', cpp], ['c', c],
  ['csharp', csharp], ['cs', csharp], ['html', xml], ['xml', xml], ['css', css],
  ['json', json], ['sql', sql], ['bash', bash], ['sh', bash], ['shell', bash],
  ['go', go], ['rust', rust], ['php', php], ['ruby', ruby], ['rb', ruby],
  ['swift', swift], ['kotlin', kotlin], ['yaml', yaml], ['yml', yaml], ['markdown', markdown], ['md', markdown],
].forEach(([name, lang]) => SyntaxHighlighter.registerLanguage(name, lang));

const LANGUAGE_LABELS = {
  js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript',
  jsx: 'JSX', tsx: 'TSX', py: 'Python', python: 'Python', cpp: 'C++', c: 'C',
  cs: 'C#', csharp: 'C#', java: 'Java', html: 'HTML', css: 'CSS', json: 'JSON',
  sql: 'SQL', bash: 'Bash', sh: 'Shell', shell: 'Shell', go: 'Go', rust: 'Rust',
  php: 'PHP', rb: 'Ruby', ruby: 'Ruby', swift: 'Swift', kotlin: 'Kotlin',
  yaml: 'YAML', yml: 'YAML', xml: 'XML', md: 'Markdown', markdown: 'Markdown',
  mermaid: 'Diagrama',
};

// Detecta presença de matemática / mermaid sem fazer parse completo do markdown.
// Usado só para decidir se vale a pena baixar katex/mermaid (code-splitting sob demanda).
const MATH_RE = /\$\$[\s\S]+?\$\$|(?:^|[^$\\])\$(?!\$)[^\n$]+?\$(?!\$)/;
const MERMAID_RE = /```mermaid/;

/* ───────────────────────── Bloco de código ───────────────────────── */

function CodeBlock({ language, children, darkMode }) {
  const [copied, setCopied] = useState(false);

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
          {copied ? <><Check size={12} /><span>copiado!</span></> : <><Copy size={12} /><span>copiar código</span></>}
        </button>
      </div>
      <SyntaxHighlighter
        language={lang}
        style={darkMode ? githubDark : githubGist}
        customStyle={{
          margin: 0, borderRadius: 0, fontSize: '0.875rem', lineHeight: '1.6',
          padding: '1rem', background: darkMode ? '#0d1117' : '#f6f8fa',
        }}
        codeTagProps={{ style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }}
      >
        {codeString}
      </SyntaxHighlighter>
    </div>
  );
}

/* ───────────────────────── Diagrama Mermaid (lazy) ───────────────────────── */
// mermaid.js só é baixado quando um bloco ```mermaid``` realmente aparece na mensagem.
// Enquanto a mensagem está em streaming, não tenta renderizar a cada token — só
// dispara o parse 350ms depois do último caractere recebido (debounce), e só quando
// o streaming termina, evitando custo de CPU repetido em código de diagrama incompleto.

let mermaidSingleton = null;
function loadMermaid() {
  if (!mermaidSingleton) mermaidSingleton = import('mermaid').then(m => m.default);
  return mermaidSingleton;
}

function MermaidBlock({ code, darkMode, isStreaming }) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const domId = `mermaid-${rawId}`;
  const [state, setState] = useState({ status: 'pending', svg: '' });

  useEffect(() => {
    if (isStreaming) return undefined;
    let cancelled = false;
    setState(s => (s.status === 'ready' ? s : { status: 'loading', svg: '' }));

    const timer = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        mermaid.initialize({
          startOnLoad: false,
          theme: darkMode ? 'dark' : 'default',
          securityLevel: 'strict',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        });
        const { svg } = await mermaid.render(domId, code);
        if (!cancelled) setState({ status: 'ready', svg });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', svg: '' });
      }
    }, 350);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [code, darkMode, isStreaming, domId]);

  const wrapClass = `my-5 rounded-xl border-2 overflow-x-auto ${darkMode ? 'border-white/20 bg-white/[0.02]' : 'border-black/15 bg-black/[0.015]'}`;

  if (isStreaming || state.status === 'loading' || state.status === 'pending') {
    return (
      <div className={`${wrapClass} flex items-center gap-2 p-4 text-xs font-mono ${darkMode ? 'text-white/40' : 'text-black/40'}`}>
        <Loader2 size={13} className="animate-spin" /> renderizando diagrama…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className={`my-5 rounded-xl border-2 border-red-500/30 bg-red-500/5 p-3`}>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-red-400 mb-2">
          <AlertTriangle size={12} /> não foi possível renderizar este diagrama
        </div>
        <pre className={`text-[11px] whitespace-pre-wrap font-mono opacity-60 ${darkMode ? 'text-white' : 'text-black'}`}>{code}</pre>
      </div>
    );
  }

  return <div className={`${wrapClass} p-4 [&_svg]:mx-auto`} dangerouslySetInnerHTML={{ __html: state.svg }} />;
}

/* ───────────────────────── Error boundary (resiliência) ───────────────────────── */
// Markdown malformado/cortado não derruba o app: qualquer erro de render
// (ex: nó inesperado, plugin instável) cai para texto puro. O boundary "destrava"
// sozinho assim que o conteúdo da mensagem muda (próximo chunk do streaming).

class MarkdownErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.contentKey !== this.props.contentKey) {
      this.setState({ hasError: false });
    }
  }
  render() {
    if (this.state.hasError) {
      return <div className="whitespace-pre-wrap">{this.props.fallbackContent}</div>;
    }
    return this.props.children;
  }
}

/* ───────────────────────── Componente principal ───────────────────────── */

function AdvancedMarkdownBase({ content, darkMode, codingMode = false, isStreaming = false }) {
  const hasMath = useMemo(() => MATH_RE.test(content), [content]);
  const hasMermaid = useMemo(() => MERMAID_RE.test(content), [content]);

  // Plugins de matemática só são importados (e o CSS do KaTeX só é injetado) quando
  // a mensagem realmente contém LaTeX. Mensagens normais nunca pagam esse custo.
  const [mathPlugins, setMathPlugins] = useState(null);
  useEffect(() => {
    if (!hasMath || mathPlugins) return;
    let cancelled = false;
    Promise.all([
      import('remark-math'),
      import('rehype-katex'),
      import('katex/dist/katex.min.css'),
    ]).then(([rm, rk]) => {
      if (!cancelled) setMathPlugins({ remarkMath: rm.default, rehypeKatex: rk.default });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [hasMath, mathPlugins]);

  const remarkPlugins = useMemo(() => {
    const plugins = [remarkGfm];
    if (mathPlugins) plugins.push(mathPlugins.remarkMath);
    return plugins;
  }, [mathPlugins]);

  const rehypePlugins = useMemo(() => {
    if (!mathPlugins) return [];
    return [[mathPlugins.rehypeKatex, { throwOnError: false, strict: false }]];
  }, [mathPlugins]);

  const linkClass = darkMode
    ? 'text-cyan-300/90 hover:text-cyan-200'
    : 'text-cyan-700 hover:text-cyan-900';

  const components = useMemo(() => ({
    strong({ children }) {
      return <strong className="font-semibold">{children}</strong>;
    },
    em({ children }) {
      return <em className="italic">{children}</em>;
    },
    del({ children }) {
      return <del className="opacity-60">{children}</del>;
    },
    a({ children, href }) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={`underline underline-offset-2 decoration-1 ${linkClass}`}>
          {children}
        </a>
      );
    },
    hr() {
      return <hr className={`my-5 ${darkMode ? 'border-white/10' : 'border-black/10'}`} />;
    },
    blockquote({ children }) {
      return (
        <blockquote className={`my-4 py-1.5 pl-4 border-l-4 italic rounded-r-md ${
          darkMode ? 'border-amber-400/40 text-white/65 bg-white/[0.03]' : 'border-amber-500/50 text-black/60 bg-black/[0.025]'
        }`}>
          {children}
        </blockquote>
      );
    },
    ul({ children, className }) {
      const isTaskList = className?.includes('contains-task-list');
      return <ul className={`${isTaskList ? 'list-none pl-0' : 'list-disc list-inside'} space-y-1 my-2`}>{children}</ul>;
    },
    ol({ children }) {
      return <ol className="list-decimal list-inside space-y-1 my-2">{children}</ol>;
    },
    li({ children, className }) {
      const isTask = className?.includes('task-list-item');
      return (
        <li className={`text-base leading-relaxed ${isTask ? 'flex items-start gap-2' : ''}`}>
          {children}
        </li>
      );
    },
    input({ type, checked }) {
      if (type !== 'checkbox') return null;
      return (
        <input
          type="checkbox"
          checked={!!checked}
          disabled
          readOnly
          className="mt-1.5 w-3.5 h-3.5 shrink-0 rounded accent-amber-500 cursor-default"
        />
      );
    },
    p({ children }) {
      return <p className="mb-2 last:mb-0">{children}</p>;
    },
    h1({ children }) {
      return <h1 className={`text-base font-bold mt-4 mb-2 ${darkMode ? 'text-white/90' : 'text-black/90'}`}>{children}</h1>;
    },
    h2({ children }) {
      return <h2 className={`text-sm font-bold mt-3 mb-1 ${darkMode ? 'text-white/85' : 'text-black/85'}`}>{children}</h2>;
    },
    h3({ children }) {
      const isFileName = typeof children?.[0] === 'string' && /^[`\w\-.]+$/.test(children[0]);
      if (isFileName && codingMode) {
        return <h3 className="text-sm font-mono font-bold mt-4 mb-2 text-amber-400 border-l-2 border-amber-400 pl-2">{children}</h3>;
      }
      return <h3 className={`text-sm font-semibold mt-3 mb-1 ${darkMode ? 'text-white/80' : 'text-black/80'}`}>{children}</h3>;
    },
    table({ children }) {
      return (
        <div className={`my-5 overflow-x-auto rounded-lg border ${darkMode ? 'border-white/15' : 'border-black/10'}`}>
          <table className={`w-full text-sm border-collapse [&_tbody_tr:nth-child(even)]:${darkMode ? 'bg-white/[0.035]' : 'bg-black/[0.025]'}`}>
            {children}
          </table>
        </div>
      );
    },
    thead({ children }) {
      return <thead className={darkMode ? 'bg-white/[0.06]' : 'bg-black/[0.04]'}>{children}</thead>;
    },
    th({ children, style }) {
      return (
        <th style={style} className={`px-3 py-2 text-left font-semibold border-b-2 whitespace-nowrap ${darkMode ? 'border-white/15 text-white/85' : 'border-black/15 text-black/80'}`}>
          {children}
        </th>
      );
    },
    td({ children, style }) {
      return (
        <td style={style} className={`px-3 py-2 border-b align-top ${darkMode ? 'border-white/8 text-white/70' : 'border-black/8 text-black/65'}`}>
          {children}
        </td>
      );
    },
    // Spans de código inline (ex: `variavel`). Blocos de código (```) são tratados
    // em `pre`, abaixo — react-markdown v9 não diferencia mais via prop `inline`.
    code({ className, children, ...props }) {
      return (
        <code
          className={`${className || ''} ${codingMode ? 'bg-amber-400/10 text-amber-300' : (darkMode ? 'bg-white/10 text-white/80' : 'bg-black/8 text-black/70')} px-1.5 py-0.5 rounded text-[0.85em] font-mono`}
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }) {
      const codeEl = Array.isArray(children) ? children[0] : children;
      const codeProps = codeEl?.props || {};
      const match = /language-(\w+)/.exec(codeProps.className || '');
      const language = match ? match[1] : '';
      const codeString = String(codeProps.children ?? '').replace(/\n$/, '');

      if (language === 'mermaid') {
        return <MermaidBlock code={codeString} darkMode={darkMode} isStreaming={isStreaming} />;
      }
      if (!codingMode) {
        return (
          <pre className={`my-3 p-3 rounded-lg text-sm font-mono overflow-x-auto ${darkMode ? 'bg-white/5 text-white/80' : 'bg-black/5 text-black/80'}`}>
            <code>{codeString}</code>
          </pre>
        );
      }
      return <CodeBlock language={language} darkMode={darkMode}>{codeString}</CodeBlock>;
    },
  }), [darkMode, codingMode, isStreaming, linkClass]);

  return (
    <MarkdownErrorBoundary fallbackContent={content} contentKey={content}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {content}
      </ReactMarkdown>
    </MarkdownErrorBoundary>
  );
}

// Memo com comparação rasa explícita: só re-renderiza quando o que importa muda.
// Evita reprocessar o AST inteiro do markdown a cada render do componente pai.
const AdvancedMarkdown = React.memo(AdvancedMarkdownBase, (prev, next) =>
  prev.content === next.content &&
  prev.darkMode === next.darkMode &&
  prev.codingMode === next.codingMode &&
  prev.isStreaming === next.isStreaming
);

export default AdvancedMarkdown;