// backend/middleware/auth.js — Extração de userId via JWT (Supabase) ou header x-user-id

export async function extractUserId(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);

    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (!error && user) {
          req.userId = user.id;
          return next();
        }
      } catch (err) {
        console.warn('⚠️ Falha na validação JWT do Supabase:', err.message);
      }
    } else {
      console.warn('⚠️ SUPABASE_URL/ANON_KEY não definidas. JWT ignorado.');
    }
  }

  const guestId = req.headers['x-user-id'];
  if (guestId) {
    req.userId = guestId;
    return next();
  }

  res.status(401).json({ error: 'Usuário não autenticado. Forneça um token JWT ou x-user-id.' });
}