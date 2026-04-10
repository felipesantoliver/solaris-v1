// supabase.js — Cliente Supabase e helpers de autenticação

import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export const API_BASE = import.meta.env.VITE_API_BASE || 'https://solaris-backend-s7vm.onrender.com/api';

// ID de convidado (fallback para usuários não autenticados)
export function getGuestId() {
  let id = localStorage.getItem('solaris_guest_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('solaris_guest_id', id);
  }
  return id;
}

/**
 * Obtém o ID do usuário autenticado via Supabase.
 * Retorna null se não houver sessão ativa.
 */
export async function getAuthUserId() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) {
    return null;
  }
  return session.user.id;
}

/**
 * Retorna o userId efetivo: o do usuário autenticado ou o guestId.
 * Use esta função para obter o identificador do usuário atual.
 */
export async function getEffectiveUserId() {
  const authUserId = await getAuthUserId();
  return authUserId || getGuestId();
}

/**
 * Retorna os headers necessários para chamadas autenticadas à API backend.
 * Inclui o token JWT do Supabase (Authorization: Bearer <token>) se o usuário estiver logado.
 * Caso contrário, envia apenas x-user-id com o guestId (modo convidado).
 */
export async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = {};

  if (session?.access_token) {
    // Autenticado: usa token JWT padrão
    headers['Authorization'] = `Bearer ${session.access_token}`;
  } else {
    // Convidado: envia apenas o identificador (backend deve tratar como acesso limitado)
    headers['x-user-id'] = getGuestId();
  }

  return headers;
}