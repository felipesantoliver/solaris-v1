import React, { useState } from 'react';
import { X, Loader2 } from 'lucide-react';

export function AuthModal({ onClose, darkMode, onAuthSuccess, onGoogleLogin, onLogin, onSignUp }) {
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

  const handleGoogle = async () => {
    setLoading(true); setError('');
    try {
      await onGoogleLogin();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    setLoading(true); setError(''); setInfo('');
    try {
      if (mode === 'register') {
        if (!displayName.trim()) { setError('Informe como quer ser chamado.'); setLoading(false); return; }
        const result = await onSignUp(email, password, displayName);
        if (result?.needsEmailConfirmation) {
          setInfo('Verifique seu email.');
          setLoading(false);
          return;
        }
        onAuthSuccess(result);
      } else {
        const user = await onLogin(email, password);
        onAuthSuccess(user);
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

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
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
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