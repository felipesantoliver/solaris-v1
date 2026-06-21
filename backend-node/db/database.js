// db/database.js — Pool PostgreSQL e helpers

import pg from 'pg';
import net from 'net';
import dns from 'dns/promises';
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

// --- Funções auxiliares otimizadas usando pool.query diretamente ---

export async function runAsync(sql, params = []) {
  const p = await getPool();
  const result = await p.query(sql, params);
  // Antes retornava também { lastID: result.oid ?? null }, herdado de uma API
  // estilo sqlite3. `result.oid` nunca funciona em Postgres moderno (o
  // suporte a `WITH OIDS` foi removido no PG 12), então `lastID` era sempre
  // null/0 — e, conferido no código, nada consumia esse campo. Removido.
  // Se precisar do ID inserido no futuro, use `INSERT ... RETURNING id`.
  return { changes: result.rowCount };
}

export async function getAsync(sql, params = []) {
  const p = await getPool();
  const result = await p.query(sql, params);
  return result.rows[0];
}

export async function allAsync(sql, params = []) {
  const p = await getPool();
  const result = await p.query(sql, params);
  return result.rows;
}