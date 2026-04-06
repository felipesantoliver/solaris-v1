import pg from 'pg';
import dns from 'dns';

// Forçar resolução IPv4 — Render free tier não suporta IPv6
dns.setDefaultResultOrder('ipv4first');

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('❌ DATABASE_URL não definida nas variáveis de ambiente');
}

// Extrair host da connection string e garantir IPv4
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  family: 4, // Forçar IPv4
});

pool.on('error', (err) => {
  console.error('❌ Erro no pool PostgreSQL:', err.message);
});

export async function runAsync(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return { lastID: result.oid ?? null, changes: result.rowCount };
  } finally {
    client.release();
  }
}

export async function getAsync(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows[0] ?? undefined;
  } finally {
    client.release();
  }
}

export async function allAsync(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

export async function initDb() {
  const client = await pool.connect();
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
        id              SERIAL PRIMARY KEY,
        chat_id         TEXT        NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role            TEXT        NOT NULL,
        content         TEXT        NOT NULL,
        edited          BOOLEAN     DEFAULT FALSE,
        edit_history    JSONB       DEFAULT '[]',
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
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
    `);

    // Migrations para tabelas já existentes
    await client.query(`
      ALTER TABLE chats ALTER COLUMN project_id DROP NOT NULL;
    `).catch(() => {});

    await client.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited BOOLEAN DEFAULT FALSE;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS edit_history JSONB DEFAULT '[]';
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    `).catch(() => {});

    console.log('✅ Tabelas verificadas/criadas');
  } finally {
    client.release();
  }
}