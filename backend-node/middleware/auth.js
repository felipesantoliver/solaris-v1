// backend/middleware/auth.js — Validação JWT via Supabase + fallback para convidado (x-user-id)

import { createClient } from '@supabase/supabase-js';

// Cliente Supabase singleton (criado uma única vez com as variáveis de ambiente)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
  console.log('✅ Supabase client inicializado para validação JWT');
} else {
  console.warn('⚠️ SUPABASE_URL ou SUPABASE_ANON_KEY não definidas. O modo convidado será usado para todas as requisições.');
}

/**
 * Middleware que extrai o userId da requisição.
 *
 * - Se houver um token Bearer válido, extrai o userId do Supabase.
 * - Se não houver token, usa o header x-user-id (modo convidado).
 * - Se o token for inválido, retorna 401.
 * - Se nenhum identificador for fornecido, retorna 401.
 */
export async function extractUserId(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

  // Caso 1: Token JWT presente
  if (token) {
    // Se o Supabase não estiver configurado, não podemos validar o token
    if (!supabase) {
      console.warn('⚠️ Token recebido, mas Supabase não está configurado. Rejeitando.');
      return res.status(401).json({ error: 'Autenticação indisponível. Configure SUPABASE_URL e SUPABASE_ANON_KEY.' });
    }

    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);

      if (error || !user) {
        console.warn('❌ Token inválido ou expirado:', error?.message || 'Usuário não encontrado');
        return res.status(401).json({ error: 'Token inválido ou expirado. Faça login novamente.' });
      }

      // Token válido – define o userId autenticado
      req.userId = user.id;
      req.isGuest = false;
      return next();
    } catch (err) {
      console.error('❌ Erro ao validar token com Supabase:', err.message);
      return res.status(500).json({ error: 'Erro interno ao validar autenticação.' });
    }
  }

  // Caso 2: Sem token – tenta modo convidado via x-user-id
  const guestId = req.headers['x-user-id'];
  if (guestId) {
    req.userId = guestId;
    req.isGuest = true;
    return next();
  }

  // Caso 3: Nenhum identificador fornecido
  res.status(401).json({ error: 'Usuário não autenticado. Forneça um token JWT ou x-user-id.' });
}