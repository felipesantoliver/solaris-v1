import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export const API_BASE = import.meta.env.VITE_API_BASE || 'https://solaris-backend-s7vm.onrender.com/api';

export function getGuestId() {
  let id = localStorage.getItem('solaris_guest_id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('solaris_guest_id', id); }
  return id;
}