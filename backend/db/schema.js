// db/schema.js — initDb e migrações

import { getPool } from './database.js';

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

    // Tabela chats com suporte a user_id (para chats avulsos)
    await client.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id         TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        user_id    TEXT,
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

    // Migrações para adicionar colunas que podem faltar em tabelas existentes
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
      `ALTER TABLE chats ADD COLUMN IF NOT EXISTS user_id TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id)`,
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