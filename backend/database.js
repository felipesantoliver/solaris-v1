import pg from 'pg';
import dns from 'dns/promises';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('❌ DATABASE_URL não definida nas variáveis de ambiente');
}

// Cache do pool
let pool = null;

// Função para obter configuração do pool forçando IPv4
async function getPoolConfig() {
  const originalUrl = process.env.DATABASE_URL;
  const url = new URL(originalUrl);
  const hostname = url.hostname;

  console.log(`🔍 Resolvendo hostname: ${hostname}`);

  // Tenta resolver IPv4 explicitamente
  let ipv4 = null;
  try {
    const addresses = await dns.resolve4(hostname);
    if (addresses && addresses.length > 0) {
      ipv4 = addresses[0];
      console.log(`✅ ${hostname} -> IPv4: ${ipv4}`);
    } else {
      console.warn(`⚠️ Nenhum registro IPv4 encontrado para ${hostname}`);
    }
  } catch (err) {
    console.warn(`⚠️ Falha ao resolver IPv4 para ${hostname}: ${err.message}`);
  }

  // Extrai parâmetros de conexão
  const config = {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: ipv4 || hostname,
    port: parseInt(url.port || '5432'),
    database: url.pathname.slice(1),
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };

  // Trata SSL do Supabase (geralmente 'require' ou 'prefer')
  const sslParam = url.searchParams.get('sslmode');
  if (sslParam === 'require' || sslParam === 'prefer' || sslParam === 'allow') {
    config.ssl = { rejectUnauthorized: false };
  } else if (sslParam === 'verify-ca' || sslParam === 'verify-full') {
    config.ssl = { rejectUnauthorized: true }; // padrão seguro
  }

  // FORÇA IPv4 se tivermos um IP numérico
  if (ipv4) {
    config.family = 4;
  }

  return config;
}

export async function getPool() {
  if (pool) return pool;

  const config = await getPoolConfig();
  console.log(`📦 Criando pool PostgreSQL -> ${config.host}:${config.port} (family: ${config.family || 'auto'})`);

  pool = new Pool(config);

  pool.on('error', (err) => {
    console.error('❌ Erro no pool PostgreSQL:', err.message);
  });

  // Teste de conexão inicial
  try {
    const client = await pool.connect();
    console.log('✅ Conexão com Supabase PostgreSQL estabelecida com sucesso');
    client.release();
  } catch (err) {
    console.error('❌ Falha na conexão de teste:', err.message);
    throw err;
  }

  return pool;
}

// Helpers para queries
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

// Inicialização das tabelas (mantida igual)
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

    // Migrações incrementais
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