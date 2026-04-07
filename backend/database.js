import pg from 'pg';
import net from 'net';
import dns from 'dns/promises';

// Força IPv4 globalmente no Node antes de qualquer conexão
import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

// Monkey-patch no net.connect para rejeitar qualquer tentativa de IPv6
const _originalConnect = net.connect;
net.connect = function (options, ...args) {
  if (options && typeof options === 'object' && options.host) {
    // Se o host for um endereço IPv6 puro, substitui por localhost para forçar erro visível
    if (net.isIPv6(options.host)) {
      console.error(`🚫 Bloqueando tentativa de conexão IPv6: ${options.host}`);
      options.family = 4;
    }
  }
  return _originalConnect.call(this, options, ...args);
};

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('❌ DATABASE_URL não definida nas variáveis de ambiente');
}

let pool = null;

async function resolveIPv4(hostname) {
  // Tenta resolver IPv4 até 3 vezes com delay
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const addresses = await dns.resolve4(hostname);
      if (addresses && addresses.length > 0) {
        console.log(`✅ IPv4 resolvido (tentativa ${attempt}): ${hostname} -> ${addresses[0]}`);
        return addresses[0];
      }
    } catch (err) {
      console.warn(`⚠️ Tentativa ${attempt}/3 falhou para ${hostname}: ${err.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  return null;
}

async function getPoolConfig() {
  const url = new URL(process.env.DATABASE_URL);
  const hostname = url.hostname;

  console.log(`🔍 Resolvendo hostname: ${hostname}`);

  const ipv4 = await resolveIPv4(hostname);

  if (!ipv4) {
    // Último recurso: usa o hostname diretamente mas força family=4 no pg
    console.warn(`⚠️ Não foi possível resolver IPv4 para ${hostname}. Usando hostname com family=4 forçado.`);
  }

  const config = {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: ipv4 || hostname,
    port: parseInt(url.port || '5432'),
    database: url.pathname.slice(1),
    // Força IPv4 no nível do driver pg
    family: 4,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    // SSL obrigatório para Supabase
    ssl: { rejectUnauthorized: false },
  };

  // Respeita sslmode da URL se presente
  const sslParam = url.searchParams.get('sslmode');
  if (sslParam === 'disable') {
    config.ssl = false;
  } else if (sslParam === 'verify-full' || sslParam === 'verify-ca') {
    config.ssl = { rejectUnauthorized: true };
  }

  console.log(`📦 Config PostgreSQL -> ${config.host}:${config.port} | family: 4 | ssl: ${!!config.ssl}`);
  return config;
}

export async function getPool() {
  if (pool) return pool;

  const config = await getPoolConfig();
  pool = new Pool(config);

  pool.on('error', (err) => {
    console.error('❌ Erro no pool PostgreSQL:', err.message);
  });

  try {
    const client = await pool.connect();
    console.log('✅ Conexão com Supabase PostgreSQL estabelecida com sucesso');
    client.release();
  } catch (err) {
    console.error('❌ Falha na conexão de teste:', err.message);
    pool = null; // reseta para tentar novamente na próxima chamada
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

    const migrations = [
      `ALTER TABLE chats ALTER COLUMN project_id DROP NOT NULL`,
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS edit_history JSONB DEFAULT '[]'`,
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    ];
    for (const sql of migrations) {
      await client.query(sql).catch(() => { });
    }

    console.log('✅ Tabelas verificadas/criadas no Supabase');
  } finally {
    client.release();
  }
}