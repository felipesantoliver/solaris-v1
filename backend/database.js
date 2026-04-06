import pg from 'pg';
import dns from 'dns/promises';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('❌ DATABASE_URL não definida nas variáveis de ambiente');
}

// Resolve o host para IPv4 antes de conectar — Render free tier não suporta IPv6
async function resolveIPv4(connectionString) {
  try {
    const url = new URL(connectionString);
    const hostname = url.hostname;
    // Já é IPv4 literal
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return connectionString;
    const result = await dns.resolve4(hostname);
    if (!result || result.length === 0) return connectionString;
    const ipv4 = result[0];
    url.hostname = ipv4;
    // Manter o hostname original como parâmetro SNI para o SSL
    return url.toString();
  } catch {
    return connectionString;
  }
}

let pool;

export async function getPool() {
  if (pool) return pool;
  const resolvedUrl = await resolveIPv4(process.env.DATABASE_URL);
  pool = new Pool({
    connectionString: resolvedUrl,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', (err) => {
    console.error('❌ Erro no pool PostgreSQL:', err.message);
  });
  return pool;
}

export async function runAsync(sql, params = []) {
  const p = await getPool();
  const client = await p.connect();
  try {
    const result = await client.query(sql, params);
    return { lastID: result.oid ?? null, changes: result.rowCount };
  } finally {
    client.release();
  }
}

export async function getAsync(sql, params = []) {
  const p = await getPool();
  const client = await p.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows[0] ?? undefined;
  } finally {
    client.release();
  }
}

export async function allAsync(sql, params = []) {
  const p = await getPool();
  const client = await p.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

export async function initDb() {
  const p = await getPool();
  const client = await p.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id             TEXT PRIMARY KEY,
        user_id        TEXT        NOT NULL,
        name           TEXT        NOT NULL,
        objective      TEXT,
        response_style TEXT        DEFAULT 'direto',
        memory_mode    TEXT        DEFAULT 'isolado',
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        updated_at     TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS chats (
        id         TEXT PRIMARY KEY,
        project_id TEXT        REFERENCES projects(id) ON DELETE CASCADE,
        title      TEXT        DEFAULT 'Nova conversa',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id           SERIAL PRIMARY KEY,
        chat_id      TEXT        NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role         TEXT        NOT NULL,
        content      TEXT        NOT NULL,
        edited       BOOLEAN     DEFAULT FALSE,
        edit_history JSONB       DEFAULT '[]',
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS memories (
        id         SERIAL PRIMARY KEY,
        project_id TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        content    TEXT        NOT NULL,
        source     TEXT        DEFAULT 'auto',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS files (
        id             TEXT PRIMARY KEY,
        project_id     TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        original_name  TEXT        NOT NULL,
        mime_type      TEXT,
        size           INTEGER,
        extracted_text TEXT,
        path           TEXT,
        created_at     TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id        TEXT PRIMARY KEY,
        personality    TEXT        DEFAULT 'direto',
        custom_traits  TEXT        DEFAULT '',
        updated_at     TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Migrations seguras para tabelas já existentes
    const migrations = [
      `ALTER TABLE chats ALTER COLUMN project_id DROP NOT NULL`,
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS edit_history JSONB DEFAULT '[]'`,
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
      `CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        personality TEXT DEFAULT 'direto',
        custom_traits TEXT DEFAULT '',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
    ];
    for (const sql of migrations) {
      await client.query(sql).catch(() => {});
    }

    console.log('✅ Tabelas verificadas/criadas');
  } finally {
    client.release();
  }
}