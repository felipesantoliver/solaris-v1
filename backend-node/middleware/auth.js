// backend > middleware > JS auth.js

// ---------------------------------------------------------------------------
// Dependencias
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Configuracao do cliente Supabase
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;

// Inicializa o cliente apenas se as credenciais estiverem definidas.
// Caso contrario, todas as requisicoes cairao no modo convidado.
if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
  console.log('Supabase client initialized for JWT validation');
} else {
  console.warn('SUPABASE_URL or SUPABASE_ANON_KEY not defined. Guest mode will be used for all requests.');
}

// ---------------------------------------------------------------------------
// Middleware de extracao do userId
// ---------------------------------------------------------------------------

/**
 * Extrai o identificador do usuario a partir da requisicao.
 *
 * Cenarios cobertos:
 * - Token Bearer valido         -> userId vindo do Supabase, isGuest = false
 * - Sem token, com x-user-id   -> modo convidado, isGuest = true
 * - Token invalido ou expirado -> 401
 * - Nenhum identificador       -> 401
 */
export async function extractUserId(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

  // ---------------------------------------------------------------------------
  // Autenticacao via token JWT (Supabase)
  // ---------------------------------------------------------------------------

  if (token) {
    if (!supabase) {
      console.warn('Token received but Supabase is not configured. Rejecting.');
      return res.status(401).json({
        error: 'Authentication unavailable. Configure SUPABASE_URL and SUPABASE_ANON_KEY.',
      });
    }

    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(token);

      if (error || !user) {
        console.warn('Invalid or expired token:', error?.message || 'User not found');
        return res.status(401).json({
          error: 'Invalid or expired token. Please log in again.',
        });
      }

      req.userId = user.id;
      req.isGuest = false;
      return next();
    } catch (err) {
      console.error('Error validating token with Supabase:', err.message);
      return res.status(500).json({
        error: 'Internal error validating authentication.',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Modo convidado via header x-user-id
  // ---------------------------------------------------------------------------

  const guestId = req.headers['x-user-id'];
  if (guestId) {
    req.userId = guestId;
    req.isGuest = true;
    return next();
  }

  // ---------------------------------------------------------------------------
  // Nenhum mecanismo de identificacao presente
  // ---------------------------------------------------------------------------

  res.status(401).json({
    error: 'Unauthenticated. Provide a JWT Bearer token or x-user-id header.',
  });
}