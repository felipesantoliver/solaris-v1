// db/schema.js — initDb e migrações com controle de versão

import { getPool } from './database.js';

// 4.5/4.6: incrementado para 8 — adiciona projects.instructions,
// projects.shared_memory_enabled e memories.chat_id (memória isolada por chat).
// Correção do pipeline de embeddings (RAG): incrementado para 9 — rede de
// segurança best-effort para file_chunks.embedding_v / embedding_model (ver
// migração v9 abaixo e backend-python/migrations/001 e 002, que continuam
// sendo o caminho oficial documentado no README).
const CURRENT_SCHEMA_VERSION = 9;

async function ensureSchemaVersionTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await client.query(`
    INSERT INTO schema_version (id, version)
    VALUES (1, 0)
    ON CONFLICT (id) DO NOTHING;
  `);
}

async function getCurrentSchemaVersion(client) {
  const result = await client.query(`SELECT version FROM schema_version WHERE id = 1`);
  return result.rows[0]?.version || 0;
}

async function setSchemaVersion(client, version) {
  await client.query(`UPDATE schema_version SET version = $1, updated_at = NOW() WHERE id = 1`, [version]);
}

export async function initDb() {
  const p = await getPool();
  const client = await p.connect();
  try {
    await ensureSchemaVersionTable(client);
    const currentVersion = await getCurrentSchemaVersion(client);

    console.log(`📌 Versão atual do schema: ${currentVersion} (target: ${CURRENT_SCHEMA_VERSION})`);

    if (currentVersion >= CURRENT_SCHEMA_VERSION) {
      console.log('✅ Schema já está atualizado.');
      return;
    }

    // ========== MIGRAÇÃO v1 ==========
    if (currentVersion < 1) {
      console.log('🔄 Aplicando migração v1 (criação de tabelas)...');

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
          embedding  JSONB,
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

      await setSchemaVersion(client, 1);
      console.log('✅ Migração v1 aplicada.');
    }

    // ========== MIGRAÇÃO v2 ==========
    if (currentVersion < 2) {
      console.log('🔄 Aplicando migração v2 (alterações e índices)...');

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
        `DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='projects' AND column_name='memory_mode' AND column_default IS NULL
          ) THEN
            ALTER TABLE projects ALTER COLUMN memory_mode SET DEFAULT 'projeto';
          END IF;
        END $$;`,
      ];

      for (const sql of migrations) {
        await client.query(sql).catch(err => {
          if (!err.message?.includes('already exists') && !err.message?.includes('duplicate column')) {
            console.warn(`⚠️ Migração v2 ignorada: ${err.message}`);
          }
        });
      }

      await setSchemaVersion(client, 2);
      console.log('✅ Migração v2 aplicada.');
    }

    // ========== MIGRAÇÃO v3 ==========
    if (currentVersion < 3) {
      console.log('🔄 Aplicando migração v3 (embedding em memories)...');

      await client.query(
        `ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding JSONB`
      ).catch(err => {
        if (!err.message?.includes('already exists') && !err.message?.includes('duplicate column')) {
          console.warn(`⚠️ Migração v3 ignorada: ${err.message}`);
        }
      });

      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_memories_project_embedding
         ON memories(project_id)
         WHERE embedding IS NOT NULL`
      ).catch(() => {});

      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_memories_user_embedding
         ON memories(user_id)
         WHERE embedding IS NOT NULL AND project_id IS NULL`
      ).catch(() => {});

      await setSchemaVersion(client, 3);
      console.log('✅ Migração v3 aplicada.');
    }

    // ========== MIGRAÇÃO v4 ==========
    // Problema 5: armazena o binário do arquivo no banco para não perder no reinício do Render.
    if (currentVersion < 4) {
      console.log('🔄 Aplicando migração v4 (content BYTEA em files)...');

      await client.query(
        `ALTER TABLE files ADD COLUMN IF NOT EXISTS content BYTEA`
      ).catch(err => {
        if (!err.message?.includes('already exists') && !err.message?.includes('duplicate column')) {
          console.warn(`⚠️ Migração v4 ignorada: ${err.message}`);
        }
      });

      // Índice para busca de chunks por arquivo (acelera o RAG)
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_file_chunks_file_id ON file_chunks(file_id)`
      ).catch(() => {});

      await setSchemaVersion(client, 4);
      console.log('✅ Migração v4 aplicada.');
    }

    // ========== MIGRAÇÃO v5 ==========
    // Persiste no backend as preferências de Notificações e Privacidade que antes
    // viviam só no localStorage do navegador (não acompanhavam o usuário entre dispositivos).
    if (currentVersion < 5) {
      console.log('🔄 Aplicando migração v5 (preferências de notificações e privacidade)...');

      const migrations = [
        `ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notif_browser BOOLEAN DEFAULT FALSE`,
        `ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notif_sound BOOLEAN DEFAULT FALSE`,
        `ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS privacy_personalize BOOLEAN DEFAULT TRUE`,
        `ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS privacy_usage BOOLEAN DEFAULT TRUE`,
      ];

      for (const sql of migrations) {
        await client.query(sql).catch(err => {
          if (!err.message?.includes('already exists') && !err.message?.includes('duplicate column')) {
            console.warn(`⚠️ Migração v5 ignorada: ${err.message}`);
          }
        });
      }

      await setSchemaVersion(client, 5);
      console.log('✅ Migração v5 aplicada.');
    }

    // ========== MIGRAÇÃO v6 ==========
    // Modo Agente Autônomo: persiste a timeline de steps (thought/action/
    // observation/extended_reasoning/final) junto da mensagem do assistente,
    // pra ela continuar aparecendo (com a UI de timeline) depois de um reload.
    if (currentVersion < 6) {
      console.log('🔄 Aplicando migração v6 (agent_steps em messages)...');

      await client.query(
        `ALTER TABLE messages ADD COLUMN IF NOT EXISTS agent_steps JSONB`
      ).catch(err => {
        if (!err.message?.includes('already exists') && !err.message?.includes('duplicate column')) {
          console.warn(`⚠️ Migração v6 ignorada: ${err.message}`);
        }
      });

      await setSchemaVersion(client, 6);
      console.log('✅ Migração v6 aplicada.');
    }

    // ========== MIGRAÇÃO v7 ==========
    // 4.1: Anexar arquivo em qualquer chat, não só dentro de projeto.
    // - files.project_id passa a ser opcional (era NOT NULL).
    // - files.chat_id (novo, opcional, FK pra chats) guarda o chat de destino
    //   quando o upload acontece fora de um projeto.
    // - CHECK garante que pelo menos um dos dois esteja preenchido — um
    //   arquivo nunca pode ficar "solto" sem nenhum dono.
    if (currentVersion < 7) {
      console.log('🔄 Aplicando migração v7 (chat_id em files, project_id opcional)...');

      const migrations = [
        `ALTER TABLE files ALTER COLUMN project_id DROP NOT NULL`,
        `ALTER TABLE files ADD COLUMN IF NOT EXISTS chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE`,
        `ALTER TABLE files DROP CONSTRAINT IF EXISTS files_owner_check`,
        `ALTER TABLE files ADD CONSTRAINT files_owner_check CHECK (project_id IS NOT NULL OR chat_id IS NOT NULL)`,
        `CREATE INDEX IF NOT EXISTS idx_files_chat_id ON files(chat_id)`,
      ];

      for (const sql of migrations) {
        await client.query(sql).catch(err => {
          if (!err.message?.includes('already exists') && !err.message?.includes('duplicate column')) {
            console.warn(`⚠️ Migração v7 ignorada: ${err.message}`);
          }
        });
      }

      await setSchemaVersion(client, 7);
      console.log('✅ Migração v7 aplicada.');
    }

    // ========== MIGRAÇÃO v8 ==========
    // 4.5: memória compartilhada (ou isolada) entre chats do mesmo projeto.
    // 4.6: campo de instruções persistentes do projeto, usado no system prompt.
    if (currentVersion < 8) {
      console.log('🔄 Aplicando migração v8 (instructions/shared_memory_enabled em projects, chat_id em memories)...');

      const migrations = [
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS instructions TEXT`,
        // Default FALSE: cada chat do projeto começa com memória isolada;
        // o usuário liga o compartilhamento explicitamente pelo toggle no frontend.
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS shared_memory_enabled BOOLEAN DEFAULT FALSE`,
        `ALTER TABLE memories ADD COLUMN IF NOT EXISTS chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE`,
        `CREATE INDEX IF NOT EXISTS idx_memories_chat_id ON memories(chat_id) WHERE chat_id IS NOT NULL`,
      ];

      for (const sql of migrations) {
        await client.query(sql).catch(err => {
          if (!err.message?.includes('already exists') && !err.message?.includes('duplicate column')) {
            console.warn(`⚠️ Migração v8 ignorada: ${err.message}`);
          }
        });
      }

      await setSchemaVersion(client, 8);
      console.log('✅ Migração v8 aplicada.');
    }

    // ========== MIGRAÇÃO v9 ==========
    // Correção do pipeline de embeddings (RAG): indexFileChunks() passou a
    // gravar file_chunks.embedding_v (vector) e file_chunks.embedding_model
    // (TEXT) — ver domain/ai/embeddings.js. Essas colunas já existem em
    // ambientes onde a migração manual backend-python/migrations/001 e 002
    // foi executada no SQL Editor do Supabase (caminho OFICIAL, documentado
    // no README). Este bloco é só uma rede de segurança best-effort: torna a
    // mesma alteração idempotente e automática no boot do Node, para
    // ambientes novos não ficarem com "schema Node atualizado, mas RAG
    // quebrado por falta de coluna". Cada statement é best-effort porque
    // CREATE EXTENSION pode exigir privilégio que a role da aplicação não
    // tem em alguns provedores gerenciados — nesse caso a migração manual
    // continua sendo necessária (ver README, seção "Migration pgvector").
    if (currentVersion < 9) {
      console.log('🔄 Aplicando migração v9 (pgvector em file_chunks: embedding_v, embedding_model)...');

      const migrations = [
        `CREATE EXTENSION IF NOT EXISTS vector`,
        `ALTER TABLE file_chunks ADD COLUMN IF NOT EXISTS embedding_v vector(384)`,
        `ALTER TABLE file_chunks ADD COLUMN IF NOT EXISTS embedding_model TEXT`,
      ];

      for (const sql of migrations) {
        await client.query(sql).catch(err => {
          if (!err.message?.includes('already exists') && !err.message?.includes('duplicate column')) {
            console.warn(`⚠️ Migração v9 ignorada (best-effort — confira a migração manual no README se o RAG continuar sem resultados): ${err.message}`);
          }
        });
      }

      // Índice HNSW para busca aproximada por similaridade de cosseno —
      // mesmo índice da migração manual 001; IF NOT EXISTS torna a
      // repetição aqui inofensiva.
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_file_chunks_embedding_v_hnsw
         ON file_chunks
         USING hnsw (embedding_v vector_cosine_ops)`
      ).catch(() => {});

      await setSchemaVersion(client, 9);
      console.log('✅ Migração v9 aplicada.');
    }

    console.log(`✅ Schema atualizado para versão ${CURRENT_SCHEMA_VERSION}`);
  } catch (err) {
    console.error('❌ Falha na inicialização do schema:', err);
    throw err;
  } finally {
    client.release();
  }
}