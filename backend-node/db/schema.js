// db/schema.js
//
// Inicializacao do banco de dados e migracoes com controle de versao.
//
// Responsavel por criar e evoluir o schema do PostgreSQL conforme
// novas funcionalidades sao adicionadas ao sistema. Usa uma tabela
// schema_version para rastrear qual versao esta aplicada e aplicar
// apenas migracoes pendentes no boot do servidor.
//
// Cada migracao e um bloco independente que:
//   - Verifica se a versao atual e inferior a versao alvo
//   - Aplica ALTER TABLE, CREATE INDEX, etc. com IF NOT EXISTS
//   - Trata erros de forma graciosa (colunas/indices ja existentes)
//   - Atualiza schema_version ao final
//
// Schema atual: versao 10
//
// Historico de migracoes:
//   v1  - Tabelas fundamentais (projects, chats, messages, memories,
//         files, file_chunks, user_settings, external_sources, jobs)
//   v2  - Ajustes de nulidade, colunas opcionais e indices
//   v3  - Embedding em memories para busca semantica
//   v4  - Binario de arquivos (BYTEA) para persistencia no Render
//   v5  - Preferencias de notificacao e privacidade
//   v6  - agent_steps para timeline do Modo Agente
//   v7  - Arquivos em chats avulsos (project_id opcional, chat_id)
//   v8  - Memoria compartilhada e instrucoes de projeto
//   v9  - pgvector em file_chunks (embedding_v, embedding_model)
//   v10 - Menu de contexto: archived_at, deleted_at, pinned
//
// Agrupamento logico:
//   1. Constantes e funcoes de controle de versao
//   2. Funcao principal initDb()
//   3. Blocos de migracao (v1 a v10)

import { getPool } from './database.js';

// ---------------------------------------------------------------------------
// 1. CONSTANTES E FUNCOES DE CONTROLE DE VERSAO
// ---------------------------------------------------------------------------

// Versao atual do schema. Incrementada a cada nova migracao.
// O servidor so aplica migracoes com numero maior que a versao
// registrada na tabela schema_version.
const CURRENT_SCHEMA_VERSION = 10;

/**
 * Garante que a tabela schema_version existe.
 * Esta tabela controla qual versao do schema esta aplicada no banco.
 * So deve existir uma linha (id=1) com a versao atual.
 */
async function ensureSchemaVersionTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // Insere a linha de controle se ainda nao existir
  await client.query(`
    INSERT INTO schema_version (id, version)
    VALUES (1, 0)
    ON CONFLICT (id) DO NOTHING;
  `);
}

/**
 * Le a versao atual do schema registrada no banco.
 * Retorna 0 se a linha nao existir (banco vazio).
 */
async function getCurrentSchemaVersion(client) {
  const result = await client.query(`SELECT version FROM schema_version WHERE id = 1`);
  return result.rows[0]?.version || 0;
}

/**
 * Atualiza a versao do schema no banco apos aplicar uma migracao.
 */
async function setSchemaVersion(client, version) {
  await client.query(`UPDATE schema_version SET version = $1, updated_at = NOW() WHERE id = 1`, [version]);
}

// ---------------------------------------------------------------------------
// 2. FUNCAO PRINCIPAL initDb()
// ---------------------------------------------------------------------------

/**
 * Inicializa o banco de dados aplicando migracoes pendentes.
 *
 * Chamada uma vez no boot do servidor Node (server.js).
 * O pool de conexoes e obtido e uma conexao exclusiva e usada
 * para garantir que as migracoes rodem atomicamente.
 *
 * Fluxo:
 *   1. Obtem conexao do pool
 *   2. Garante que schema_version existe
 *   3. Le a versao atual do banco
 *   4. Se ja estiver na versao mais recente, encerra
 *   5. Aplica cada migracao pendente em ordem crescente
 *   6. Cada migracao atualiza schema_version ao final
 *
 * Tratamento de erros:
 *   - Erros de "coluna ja existe" sao ignorados (IF NOT EXISTS)
 *   - Erros de "indice ja existe" sao ignorados
 *   - Erros de "extensao ja existe" sao ignorados
 *   - Outros erros sao logados e a migracao especifica e pulada
 *   - Erro fatal: propaga para o chamador (servidor nao inicia)
 */
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

    // -----------------------------------------------------------------------
    // 3. BLOCOS DE MIGRACAO (v1 a v10)
    // -----------------------------------------------------------------------

    // =====================================================================
    // MIGRACAO v1: Tabelas fundamentais
    // =====================================================================
    // Cria todas as tabelas principais do sistema.
    // Estrutura inicial: projects, chats, messages, memories, files,
    // file_chunks, user_settings, external_sources, jobs.
    if (currentVersion < 1) {
      console.log('🔄 Aplicando migração v1 (criação de tabelas)...');

      // Tabela de projetos: agrupa chats, memorias e arquivos.
      // Cada projeto tem seu proprio contexto isolado.
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

      // Tabela de conversas: vinculadas a um projeto ou avulsas (project_id nulo).
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

      // Tabela de mensagens: historico completo de cada conversa.
      // Suporte a edicao com historico preservado em edit_history.
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

      // Tabela de memorias: extraidas automaticamente das respostas.
      // Vinculadas a projeto (ou chat avulso, via chat_id adicionado na v8).
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

      // Tabela de arquivos: metadados e texto extraido.
      // O binario e armazenado na coluna content (BYTEA, adicionada na v4).
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

      // Tabela de chunks: segmentos de texto com embeddings para busca RAG.
      // embedding_v (vector) adicionado na v9 para busca semantica eficiente.
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

      // Tabela de configuracoes do usuario: personalidade, traits,
      // preferencias de notificacao e privacidade (expandida na v5).
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_settings (
          user_id        TEXT PRIMARY KEY,
          personality    TEXT DEFAULT 'direto',
          custom_traits  TEXT DEFAULT '',
          updated_at     TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // Tabela de fontes externas: URLs ou texto livre indexados para RAG.
      // O conteudo e extraido e armazenado na coluna content.
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

      // Tabela de jobs: fila de tarefas assincronas (upload, indexacao).
      // Usada pelo BullMQ ou processamento manual com retry.
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

    // =====================================================================
    // MIGRACAO v2: Ajustes de nulidade, colunas opcionais e indices
    // =====================================================================
    // Corrige restricoes e adiciona colunas que ficaram de fora na v1.
    // Permite chats avulsos (project_id nulo) e adiciona indices de busca.
    if (currentVersion < 2) {
      console.log('🔄 Aplicando migração v2 (alterações e índices)...');

      const migrations = [
        // Permite chats sem projeto (conversas avulsas)
        `ALTER TABLE chats ALTER COLUMN project_id DROP NOT NULL`,
        // Colunas de edicao de mensagens
        `ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited BOOLEAN DEFAULT FALSE`,
        `ALTER TABLE messages ADD COLUMN IF NOT EXISTS edit_history JSONB DEFAULT '[]'`,
        `ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
        // Colunas adicionais de projeto
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS summary TEXT`,
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS detailed_objective TEXT`,
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'`,
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS memory_mode TEXT DEFAULT 'projeto'`,
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS gemini_version TEXT DEFAULT 'flash'`,
        // Memorias podem pertencer a usuarios sem projeto (chat avulso)
        `ALTER TABLE memories ADD COLUMN IF NOT EXISTS user_id TEXT`,
        `ALTER TABLE memories ALTER COLUMN project_id DROP NOT NULL`,
        // Chats vinculados a usuario (para chats avulsos)
        `ALTER TABLE chats ADD COLUMN IF NOT EXISTS user_id TEXT`,
        // Indice para busca de chats por usuario
        `CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id)`,
        // Corrige valor padrao de memory_mode se estiver nulo
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

    // =====================================================================
    // MIGRACAO v3: Embedding em memorias para busca semantica
    // =====================================================================
    // Adiciona coluna embedding (JSONB) em memories para busca por
    // similaridade de cosseno. Indices parciais para otimizar consultas
    // filtrando apenas memorias que ja possuem embedding.
    if (currentVersion < 3) {
      console.log('🔄 Aplicando migração v3 (embedding em memories)...');

      await client.query(
        `ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding JSONB`
      ).catch(err => {
        if (!err.message?.includes('already exists') && !err.message?.includes('duplicate column')) {
          console.warn(`⚠️ Migração v3 ignorada: ${err.message}`);
        }
      });

      // Indice parcial: so indexa memorias de projeto com embedding preenchido
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_memories_project_embedding
         ON memories(project_id)
         WHERE embedding IS NOT NULL`
      ).catch(() => {});

      // Indice parcial: memorias de usuario (chats avulsos) com embedding
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_memories_user_embedding
         ON memories(user_id)
         WHERE embedding IS NOT NULL AND project_id IS NULL`
      ).catch(() => {});

      await setSchemaVersion(client, 3);
      console.log('✅ Migração v3 aplicada.');
    }

    // =====================================================================
    // MIGRACAO v4: Binario de arquivos (BYTEA) para persistencia
    // =====================================================================
    // Armazena o conteudo binario do arquivo no banco para que ele
    // sobreviva a reinicios do Render (que perde o sistema de arquivos).
    // Tambem adiciona indice para acelerar busca de chunks por arquivo.
    if (currentVersion < 4) {
      console.log('🔄 Aplicando migração v4 (content BYTEA em files)...');

      await client.query(
        `ALTER TABLE files ADD COLUMN IF NOT EXISTS content BYTEA`
      ).catch(err => {
        if (!err.message?.includes('already exists') && !err.message?.includes('duplicate column')) {
          console.warn(`⚠️ Migração v4 ignorada: ${err.message}`);
        }
      });

      // Indice para busca de chunks por arquivo (acelera RAG)
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_file_chunks_file_id ON file_chunks(file_id)`
      ).catch(() => {});

      await setSchemaVersion(client, 4);
      console.log('✅ Migração v4 aplicada.');
    }

    // =====================================================================
    // MIGRACAO v5: Preferencias de notificacao e privacidade
    // =====================================================================
    // Persiste no banco as preferencias que antes viviam apenas no
    // localStorage do navegador. Isso permite que as configuracoes
    // acompanhem o usuario entre dispositivos.
    if (currentVersion < 5) {
      console.log('🔄 Aplicando migração v5 (preferências de notificações e privacidade)...');

      const migrations = [
        // Notificacao via navegador (push notifications)
        `ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notif_browser BOOLEAN DEFAULT FALSE`,
        // Som ao receber resposta
        `ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notif_sound BOOLEAN DEFAULT FALSE`,
        // Personalizacao baseada em uso (IA adaptativa)
        `ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS privacy_personalize BOOLEAN DEFAULT TRUE`,
        // Compartilhamento anonimo de dados de uso para melhoria do servico
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

    // =====================================================================
    // MIGRACAO v6: agent_steps para timeline do Modo Agente
    // =====================================================================
    // Persiste a timeline de passos do Modo Agente Autonomo
    // (thought, action, observation, extended_reasoning, final)
    // junto da mensagem do assistente. Isso permite que a UI de
    // timeline seja restaurada apos um reload da pagina.
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

    // =====================================================================
    // MIGRACAO v7: Arquivos em chats avulsos
    // =====================================================================
    // Permite anexar arquivos em qualquer chat, nao apenas dentro de
    // projetos.
    //
    // Alteracoes:
    //   - files.project_id: deixa de ser NOT NULL
    //   - files.chat_id: novo campo opcional com FK para chats
    //   - CHECK constraint: garante que pelo menos um dos dois
    //     (project_id ou chat_id) esteja preenchido — um arquivo
    //     nunca pode ficar "solto" sem dono
    if (currentVersion < 7) {
      console.log('🔄 Aplicando migração v7 (chat_id em files, project_id opcional)...');

      const migrations = [
        `ALTER TABLE files ALTER COLUMN project_id DROP NOT NULL`,
        `ALTER TABLE files ADD COLUMN IF NOT EXISTS chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE`,
        // Remove constraint antiga se existir e recria com a nova regra
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

    // =====================================================================
    // MIGRACAO v8: Memoria compartilhada e instrucoes de projeto
    // =====================================================================
    // 4.5: Suporte a memoria compartilhada entre chats do mesmo projeto.
    // 4.6: Campo de instrucoes persistentes do projeto (usado no system prompt
    //      como complemento a personalidade).
    //
    // Alteracoes:
    //   - projects.instructions: instrucoes/traits especificos do projeto
    //   - projects.shared_memory_enabled: se TRUE, memorias sao compartilhadas
    //     entre todos os chats do projeto (default FALSE = isoladas por chat)
    //   - memories.chat_id: vinculo opcional da memoria a um chat especifico
    if (currentVersion < 8) {
      console.log('🔄 Aplicando migração v8 (instructions/shared_memory_enabled em projects, chat_id em memories)...');

      const migrations = [
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS instructions TEXT`,
        // Default FALSE: cada chat do projeto comeca com memoria isolada;
        // o usuario ativa o compartilhamento pelo toggle no frontend
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS shared_memory_enabled BOOLEAN DEFAULT FALSE`,
        `ALTER TABLE memories ADD COLUMN IF NOT EXISTS chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE`,
        // Indice parcial para buscar memorias de um chat especifico
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

    // =====================================================================
    // MIGRACAO v9: pgvector em file_chunks (embedding_v, embedding_model)
    // =====================================================================
    // Correcao do pipeline de embeddings (RAG): indexFileChunks() passou
    // a gravar file_chunks.embedding_v (vector nativo do pgvector) e
    // file_chunks.embedding_model (TEXT com o nome do modelo usado).
    //
    // IMPORTANTE: Esta migracao e uma rede de seguranca best-effort.
    // O caminho OFICIAL documentado no README e executar os scripts
    // backend-python/migrations/001 e 002 manualmente no SQL Editor
    // do Supabase. Este bloco existe apenas para ambientes novos
    // nao ficarem com o schema do Node atualizado mas o RAG quebrado
    // por falta das colunas do pgvector.
    //
    // Limitacao: CREATE EXTENSION pode exigir privilegios de superuser
    // que a role da aplicacao nao tem em provedores gerenciados.
    // Nesse caso, a migracao manual continua sendo necessaria.
    if (currentVersion < 9) {
      console.log('🔄 Aplicando migração v9 (pgvector em file_chunks: embedding_v, embedding_model)...');

      const migrations = [
        // Habilita extensao pgvector (pode falhar sem privilegios de superuser)
        `CREATE EXTENSION IF NOT EXISTS vector`,
        // Coluna nativa vector(384) para embeddings do all-MiniLM-L6-v2
        `ALTER TABLE file_chunks ADD COLUMN IF NOT EXISTS embedding_v vector(384)`,
        // Nome do modelo usado para gerar o embedding (rastreabilidade)
        `ALTER TABLE file_chunks ADD COLUMN IF NOT EXISTS embedding_model TEXT`,
      ];

      for (const sql of migrations) {
        await client.query(sql).catch(err => {
          if (!err.message?.includes('already exists') && !err.message?.includes('duplicate column')) {
            console.warn(`⚠️ Migração v9 ignorada (best-effort — confira a migração manual no README se o RAG continuar sem resultados): ${err.message}`);
          }
        });
      }

      // Indice HNSW para busca aproximada por similaridade de cosseno.
      // Mesmo indice criado pela migracao manual 001; IF NOT EXISTS
      // torna a repeticao inofensiva.
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_file_chunks_embedding_v_hnsw
         ON file_chunks
         USING hnsw (embedding_v vector_cosine_ops)`
      ).catch(() => {});

      await setSchemaVersion(client, 9);
      console.log('✅ Migração v9 aplicada.');
    }

    // =====================================================================
    // MIGRACAO v10: Menu de contexto da conversa
    // =====================================================================
    // Adiciona suporte a tres novas operacoes na sidebar:
    //
    //   - archived_at: Arquivar conversa (some da listagem padrao mas
    //     permanece acessivel via include_archived=true).
    //     A secao "Arquivados" na UI ainda nao existe, mas o backend
    //     ja suporta o parametro de consulta.
    //
    //   - deleted_at: Soft delete — preserva mensagens e arquivos em
    //     vez de um DELETE em cascata definitivo. Permite recuperacao
    //     futura via funcionalidade de lixeira (planejada).
    //
    //   - pinned: Fixar conversa no topo da sidebar. Conversas fixadas
    //     aparecem antes das demais na ordenacao (ORDER BY pinned DESC,
    //     updated_at DESC).
    //
    // Indices parciais otimizam as consultas filtrando apenas registros
    // que possuem os campos preenchidos.
    if (currentVersion < 10) {
      console.log('🔄 Aplicando migração v10 (archived_at/deleted_at/pinned em chats)...');

      const migrations = [
        `ALTER TABLE chats ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`,
        `ALTER TABLE chats ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
        `ALTER TABLE chats ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT FALSE`,
        // Indices parciais: so indexam registros com os campos preenchidos
        `CREATE INDEX IF NOT EXISTS idx_chats_archived_at ON chats(archived_at) WHERE archived_at IS NOT NULL`,
        `CREATE INDEX IF NOT EXISTS idx_chats_deleted_at ON chats(deleted_at) WHERE deleted_at IS NOT NULL`,
        `CREATE INDEX IF NOT EXISTS idx_chats_pinned ON chats(pinned) WHERE pinned = TRUE`,
      ];

      for (const sql of migrations) {
        await client.query(sql).catch(err => {
          if (!err.message?.includes('already exists') && !err.message?.includes('duplicate column')) {
            console.warn(`⚠️ Migração v10 ignorada: ${err.message}`);
          }
        });
      }

      await setSchemaVersion(client, 10);
      console.log('✅ Migração v10 aplicada.');
    }

    console.log(`✅ Schema atualizado para versão ${CURRENT_SCHEMA_VERSION}`);
  } catch (err) {
    console.error('❌ Falha na inicialização do schema:', err);
    throw err;
  } finally {
    client.release();
  }
}