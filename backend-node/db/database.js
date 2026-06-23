// backend-node > db > JS database.js

// ---------------------------------------------------------------------------
// DNS - Resolucao forcada para IPv4
// ---------------------------------------------------------------------------

// Modulos ESM sao avaliados antes da execucao do corpo do modulo importador,
// portanto esta chamada precisa estar aqui como rede de seguranca. Nao pode
// ser delegada ao server.js.
import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

// ---------------------------------------------------------------------------
// Dependencias principais
// ---------------------------------------------------------------------------

import pg from 'pg';
import net from 'net';
import dns from 'dns/promises';

// ---------------------------------------------------------------------------
// Bloqueio de conexoes IPv6 no nivel do socket
// ---------------------------------------------------------------------------

// Rejeita enderecos IPv6 no momento da criacao do socket para garantir que
// o pool do pg sempre se conecte via IPv4.
const _originalConnect = net.connect;
net.connect = function (options, ...args) {
  if (options && typeof options === 'object' && options.host) {
    if (net.isIPv6(options.host)) {
      console.error(`Blocking IPv6 connection attempt: ${options.host}`);
      options.family = 4;
    }
  }
  return _originalConnect.call(this, options, ...args);
};

// ---------------------------------------------------------------------------
// Extracao do pool a partir do pg
// ---------------------------------------------------------------------------

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Validacao da variavel de ambiente obrigatoria
// ---------------------------------------------------------------------------

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined');
}

// ---------------------------------------------------------------------------
// Variavel de cache do pool (singleton)
// ---------------------------------------------------------------------------

let pool = null;

// ---------------------------------------------------------------------------
// Funcao auxiliar: resolucao de hostname para IPv4 com retentativas
// ---------------------------------------------------------------------------

async function resolveIPv4(hostname) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const addresses = await dns.resolve4(hostname);
      if (addresses?.length) {
        console.log(`IPv4 resolved: ${hostname} -> ${addresses[0]}`);
        return addresses[0];
      }
    } catch (err) {
      console.warn(`DNS attempt ${attempt}/3 failed: ${err.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Construcao da configuracao do pool a partir da DATABASE_URL
// ---------------------------------------------------------------------------

async function getPoolConfig() {
  const url = new URL(process.env.DATABASE_URL);
  const hostname = url.hostname;
  const ipv4 = await resolveIPv4(hostname);

  // Determina o modo SSL com base no parametro sslmode da URL
  const sslParam = url.searchParams.get('sslmode');
  let ssl = { rejectUnauthorized: false };
  if (sslParam === 'disable') ssl = false;
  else if (sslParam === 'verify-full' || sslParam === 'verify-ca') ssl = { rejectUnauthorized: true };

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
    ssl,
  };

  console.log(`PostgreSQL config -> ${config.host}:${config.port} | family:4 | ssl:${!!config.ssl}`);
  return config;
}

// ---------------------------------------------------------------------------
// Funcao principal de obtencao do pool (inicializacao sob demanda)
// ---------------------------------------------------------------------------

export async function getPool() {
  if (pool) return pool;

  const config = await getPoolConfig();
  pool = new Pool(config);

  // Loga erros emitidos pelo pool sem derrubar o processo
  pool.on('error', (err) => console.error('Pool error:', err.message));

  // Testa a conexao assim que o pool e criado
  try {
    const client = await pool.connect();
    console.log('Connected to Supabase PostgreSQL');
    client.release();
  } catch (err) {
    console.error('Connection failed:', err.message);
    pool = null;
    throw err;
  }

  return pool;
}

// ---------------------------------------------------------------------------
// Helpers de consulta - wrappers finos sobre pool.query
// ---------------------------------------------------------------------------

// Executa INSERT, UPDATE ou DELETE.
// Dica: utilize INSERT ... RETURNING id se precisar do ID da linha inserida.
export async function runAsync(sql, params = []) {
  const p = await getPool();
  const result = await p.query(sql, params);
  return { changes: result.rowCount };
}

// Retorna a primeira linha do resultado (ou undefined).
export async function getAsync(sql, params = []) {
  const p = await getPool();
  const result = await p.query(sql, params);
  return result.rows[0];
}

// Retorna todas as linhas do resultado.
export async function allAsync(sql, params = []) {
  const p = await getPool();
  const result = await p.query(sql, params);
  return result.rows;
}