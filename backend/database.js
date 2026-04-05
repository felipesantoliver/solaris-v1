import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'database.sqlite');

let db = null;
let SQL = null;

// Inicializa sql.js
async function initSQL() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

// Abre ou cria o banco de dados
async function openDb() {
  if (!db) {
    await initSQL();

    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }
  }
  return db;
}

// Salva o banco de dados em disco
function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// Promise wrapper para executar SQL
async function runAsync(sql, params = []) {
  const database = await openDb();
  try {
    database.run(sql, params);
    saveDb();
    return { lastID: null, changes: database.getRowsModified() };
  } catch (err) {
    throw new Error(`SQL Error: ${err.message}`);
  }
}

// Promise wrapper para GET
async function getAsync(sql, params = []) {
  const database = await openDb();
  try {
    const stmt = database.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  } catch (err) {
    throw new Error(`SQL Error: ${err.message}`);
  }
}

// Promise wrapper para ALL
async function allAsync(sql, params = []) {
  const database = await openDb();
  try {
    const stmt = database.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  } catch (err) {
    throw new Error(`SQL Error: ${err.message}`);
  }
}

export async function initDb() {
  const database = await openDb();

  // Cria todas as tabelas
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      objective TEXT,
      response_style TEXT DEFAULT 'direto',
      memory_mode TEXT DEFAULT 'isolado',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT DEFAULT 'Nova conversa',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      source TEXT DEFAULT 'auto',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      extracted_text TEXT,
      path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `;

  // Executa cada CREATE TABLE separadamente
  const statements = createTableSQL.split(';').filter(s => s.trim());
  for (const stmt of statements) {
    try {
      database.run(stmt);
    } catch {
      // Tabela já existe, ignora
    }
  }

  saveDb();
  console.log('✅ Tabelas verificadas/criadas');
}

export { runAsync, getAsync, allAsync };