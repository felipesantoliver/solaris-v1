import pg from 'pg';
import net from 'net';
import dns from 'dns/promises';

// Força IPv4 globalmente
import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

// Monkey-patch net.connect para rejeitar IPv6
const _originalConnect = net.connect;
net.connect = function (options, ...args) {
  if (options && typeof options === 'object' && options.host) {
    if (net.isIPv6(options.host)) {
      console.error(`🚫 Bloqueando tentativa de conexão IPv6: ${options.host}`);
      options.family = 4;
    }
  }
  return _originalConnect.call(this, options, ...args);
};

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('❌ DATABASE_URL não definida');
}

let pool = null;

async function resolveIPv4(hostname) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const addresses = await dns.resolve4(hostname);
      if (addresses?.length) {
        console.log(`✅ IPv4 resolvido: ${hostname} -> ${addresses[0]}`);
        return addresses[0];
      }
    } catch (err) {
      console.warn(`⚠️ Tentativa ${attempt}/3 falhou: ${err.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  return null;
}

async function getPoolConfig() {
  const url = new URL(process.env.DATABASE_URL);
  const hostname = url.hostname;
  const ipv4 = await resolveIPv4(hostname);
  const config = {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: ipv4 || hostname,
    port: parseInt(url.port || '5432'),
    database: url.pathname.slice(1),
    family: 4,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  };
  const sslParam = url.searchParams.get('sslmode');
  if (sslParam === 'disable') config.ssl = false;
  else if (sslParam === 'verify-full' || sslParam === 'verify-ca') config.ssl = { rejectUnauthorized: true };
  console.log(`📦 Config PostgreSQL -> ${config.host}:${config.port} | family:4 | ssl:${!!config.ssl}`);
  return config;
}

export async function getPool() {
  if (pool) return pool;
  const config = await getPoolConfig();
  pool = new Pool(config);
  pool.on('error', (err) => console.error('❌ Pool error:', err.message));
  try {
    const client = await pool.connect();
    console.log('✅ Conectado ao Supabase');
    client.release();
  } catch (err) {
    console.error('❌ Falha conexão:', err.message);
    pool = null;
    throw err;
  }
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
    return result.rows[0];
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
    // Tabela projects (com todas as colunas atuais + gemini_version)
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id                 TEXT PRIMARY KEY,
        user_id            TEXT NOT NULL,
        name               TEXT NOT NULL,
        objective          TEXT,
        summary            TEXT,
        detailed_objective TEXT,
        tags               JSONB DEFAULT '[]',
        response_style     TEXT DEFAULT 'direto',
        memory_mode        TEXT DEFAULT 'projeto',
        gemini_version     TEXT DEFAULT 'flash',
        created_at         TIMESTAMPTZ DEFAULT NOW(),
        updated_at         TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id         TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        title      TEXT DEFAULT 'Nova conversa',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id           SERIAL PRIMARY KEY,
        chat_id      TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role         TEXT NOT NULL,
        content      TEXT NOT NULL,
        edited       BOOLEAN DEFAULT FALSE,
        edit_history JSONB DEFAULT '[]',
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS memories (
        id         SERIAL PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        user_id    TEXT,
        content    TEXT NOT NULL,
        source     TEXT DEFAULT 'auto',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS files (
        id             TEXT PRIMARY KEY,
        project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        original_name  TEXT NOT NULL,
        mime_type      TEXT,
        size           INTEGER,
        extracted_text TEXT,
        path           TEXT,
        created_at     TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS file_chunks (
        id          SERIAL PRIMARY KEY,
        file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        chunk_text  TEXT NOT NULL,
        embedding   JSONB,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id        TEXT PRIMARY KEY,
        personality    TEXT DEFAULT 'direto',
        custom_traits  TEXT DEFAULT '',
        updated_at     TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Tabela para fontes externas (URLs e textos)
    await client.query(`
      CREATE TABLE IF NOT EXISTS external_sources (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        type       TEXT NOT NULL CHECK (type IN ('url','text')),
        title      TEXT,
        url        TEXT,
        content    TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Tabela para fila de jobs (upload, embedding, etc)
    await client.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        status      TEXT DEFAULT 'pending',
        payload     JSONB NOT NULL,
        result      JSONB,
        error       TEXT,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        priority    INTEGER DEFAULT 0,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Migrações para adicionar colunas que podem faltar em projetos existentes
    const migrations = [
      `ALTER TABLE chats ALTER COLUMN project_id DROP NOT NULL`,
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS edit_history JSONB DEFAULT '[]'`,
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS summary TEXT`,
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS detailed_objective TEXT`,
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'`,
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS memory_mode TEXT DEFAULT 'projeto'`,
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS gemini_version TEXT DEFAULT 'flash'`,
      `ALTER TABLE memories ADD COLUMN IF NOT EXISTS user_id TEXT`,
      `ALTER TABLE memories ALTER COLUMN project_id DROP NOT NULL`,
    ];
    for (const sql of migrations) {
      await client.query(sql).catch((err) => {
        if (!err.message?.includes('already exists') && !err.message?.includes('duplicate column')) {
          console.warn(`⚠️ Migração ignorada: ${err.message}`);
        }
      });
    }

    // Ajusta default da coluna memory_mode se necessário
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='projects' AND column_name='memory_mode' AND column_default IS NULL
        ) THEN
          ALTER TABLE projects ALTER COLUMN memory_mode SET DEFAULT 'projeto';
        END IF;
      END $$;
    `).catch(() => { });

    console.log('✅ Tabelas verificadas/criadas com sucesso');
  } finally {
    client.release();
  }
}