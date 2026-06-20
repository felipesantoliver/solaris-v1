import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, getGuestId } from '../config/supabase';
import { api } from '../services/api';

export function useAuth() {
  const [authUser, setAuthUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const guestIdRef = useRef(getGuestId());

  const migrateGuestData = useCallback(async (userId) => {
    const guestId = guestIdRef.current;
    if (!guestId || guestId === userId) return;
    await api.migrateGuest(guestId, userId).catch(() => {});
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthUser(session?.user ?? null);
      setAuthReady(true);
    });
    // Observação: usamos o `event` (e não só a `session`) para migrar os dados do
    // convidado também no fluxo de login via Google (OAuth). Nesse fluxo o usuário
    // é redirecionado de volta para a página e a sessão chega aqui via evento
    // 'SIGNED_IN' — não passa por handleLogin/handleSignUp, que já migram
    // explicitamente para o fluxo de email/senha. Chamar migrateGuestData() de novo
    // ali é inofensivo (a rota /migrate é idempotente e o guard acima ignora
    // chamadas redundantes quando guestId já foi migrado).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthUser(session?.user ?? null);
      if (event === 'SIGNED_IN' && session?.user) {
        migrateGuestData(session.user.id);
      }
    });
    return () => subscription.unsubscribe();
  }, [migrateGuestData]);

  const handleLogin = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await migrateGuestData(data.user.id);
    setAuthUser(data.user);
    return data.user;
  }, [migrateGuestData]);

  const handleSignUp = useCallback(async (email, password, displayName) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName.trim() } }
    });
    if (error) throw error;
    if (data.user && !data.session) {
      return { needsEmailConfirmation: true };
    }
    await migrateGuestData(data.user.id);
    setAuthUser(data.user);
    return data.user;
  }, [migrateGuestData]);

  const handleGoogleLogin = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) throw error;
  }, []);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    setAuthUser(null);
  }, []);

  const updateDisplayName = useCallback(async (displayName) => {
    if (!authUser) throw new Error('Não autenticado');
    const { error } = await supabase.auth.updateUser({
      data: { display_name: displayName.trim() }
    });
    if (error) throw error;
    // Atualiza o estado local
    setAuthUser(prev => prev ? { ...prev, user_metadata: { ...prev.user_metadata, display_name: displayName.trim() } } : null);
  }, [authUser]);

  const effectiveUserId = authUser?.id || guestIdRef.current;
  const displayName = authUser?.user_metadata?.display_name || authUser?.user_metadata?.full_name || authUser?.email?.split('@')[0] || null;

  return {
    authUser,
    authReady,
    effectiveUserId,
    displayName,
    handleLogin,
    handleSignUp,
    handleGoogleLogin,
    handleLogout,
    updateDisplayName,
  };
}