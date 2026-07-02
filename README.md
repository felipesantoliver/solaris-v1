# Solaris AI

> **Versão atual:** `v1.0.0` — *Solaris Core*

**Acesse em produção:** [solaris-v1.vercel.app](https://solaris-v1.vercel.app)

Assistente pessoal de IA com memória persistente, organização por projetos e suporte a múltiplos modelos de linguagem. Projetado para funcionar como um segundo cérebro: lembra do que foi discutido, organiza conhecimento por contexto e executa código em ambiente seguro.

O projeto nasce de um estudo de frontend feito mão, melhoria continua e otimização com python e claude ai

---

## Sumário

- [Visão geral](#visão-geral)
- [Funcionalidades](#funcionalidades)
- [Arquitetura](#arquitetura)
- [Banco de dados](#banco-de-dados)
- [APIs e rotas](#apis-e-rotas)
- [Deploy passo a passo](#deploy-passo-a-passo)
- [Desenvolvimento local](#desenvolvimento-local)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Roadmap](#roadmap)

---

## Visão geral

Solaris AI é construído em torno do conceito de **projetos com contexto próprio**. Cada projeto mantém suas memórias, histórico de conversas, arquivos e fontes de conhecimento de forma isolada. O sistema usa embeddings semânticos para recuperação de informações (RAG) e spaCy + Groq para extrair e sintetizar memórias automaticamente após cada resposta.

A arquitetura é distribuída em quatro serviços independentes:

| Serviço | Tecnologia | Hospedagem |
|---|---|---|
| Frontend | React 18 + Vite | Vercel |
| Backend principal | Node.js + Express | Render |
| Microsserviço de NLP | Python + FastAPI | Render |
| Sandbox de código | Docker + FastAPI | Render |

---

## Funcionalidades

### 🧠 Memória e contexto

**Escopo das memórias:**

| Contexto | Escopo da memória |
|---|---|
| Dentro de um projeto | Memórias exclusivas daquele projeto — isoladas de todos os outros |
| Fora de projeto (chat avulso) | Memórias vinculadas apenas àquele chat específico |

> Memórias nunca vazam entre projetos. Um projeto não tem acesso às memórias de outro, nem ao histórico de chats avulsos. Isso garante isolamento total de contexto.

**Memória automática** — após cada resposta do assistente, o sistema analisa o texto com spaCy buscando padrões relevantes (decisões, tecnologias, preferências, regras). Quando `GROQ_API_KEY` está disponível, usa um modelo de linguagem para síntese mais sofisticada. As memórias ficam vinculadas ao projeto (ou ao chat, se avulso) e são injetadas nas próximas conversas. Duplicatas são filtradas por similaridade de Jaccard antes de serem salvas.

**Seleção de janela de contexto** — o backend seleciona dinamicamente quais memórias e mensagens anteriores incluir em cada requisição, priorizando relevância para não desperdiçar tokens.

**Busca RAG** — recuperação semântica sobre arquivos e fontes do projeto usando embeddings `sentence-transformers/all-MiniLM-L6-v2` (384 dimensões). Os vetores são armazenados no Supabase com pgvector e recuperados via índice HNSW com similaridade de cosseno.

**Modos de memória por projeto:**
- `projeto` — memórias isoladas por projeto
- `global` — memórias compartilhadas entre todos os projetos do usuário
- `nenhuma` — memória desativada; nenhuma informação é extraída ou injetada

---

### 💬 Conversas

**Streaming de respostas** — respostas chegam em tempo real via Server-Sent Events. O backend emite eventos granulares de progresso (`searching`, `thinking`, `generating`) que o frontend traduz em um indicador visual: `Analisando contexto…` durante a busca em chats de projeto (RAG sobre fontes/documentos) ou `Consultando memórias…` em chats avulsos (memória global); `Preparando resposta…` enquanto o system prompt é montado; e o indicador desaparece no instante em que o texto da resposta começa a chegar, chunk a chunk.

**Edição de mensagens** — qualquer mensagem pode ser editada. As mensagens seguintes são descartadas e a resposta é regenerada a partir daquele ponto. O histórico de edições é preservado no banco.

**Histórico paginado** — carregamento de 30 mensagens por página para chats longos.

**Geração automática de título** — gerado via Groq na primeira mensagem, com fallback para as primeiras 7 palavras.

**Menu de contexto da conversa** — cada conversa na sidebar tem um menu (três pontinhos) com cinco ações: **fixar** (mantém a conversa no topo da lista, antes das demais, independente da data); **renomear** (edição inline do título); **mover para projeto** (realoca a conversa entre projetos ou para fora de qualquer projeto); **arquivar** (some da listagem padrão sem apagar nada — recuperável via `include_archived=true`; a tela dedicada de "Arquivados" ainda não existe); e **excluir** (soft delete via `deleted_at`, com confirmação antes de aplicar — preserva mensagens e arquivos da conversa em vez de um DELETE definitivo em cascata).

**Rate limiting** — dois níveis de proteção, implementado com Redis (com fallback em memória):

| Tipo de usuário | Limite |
|---|---|
| Convidado | 15 mensagens/min |
| Autenticado | 40 mensagens/min |

> ⚠️ **Nota sobre modo convidado:** o limite de 15 msg/min se aplica por janela de tempo, mas não há limite total de mensagens nem prazo de expiração definido para o ID anônimo. Caso o ID expire, memórias e histórico acumulados são perdidos sem aviso — comportamento que será endereçado em versão futura.

---

### 🤖 Modelos e personalidades

**Múltiplos modelos** — alterne entre dois modos de resposta. O **Flash** usa o Gemini diretamente — rápido e objetivo, ideal para perguntas diretas e tarefas do dia a dia. O **Pro** é um modo avançado que vai além do modelo base: a pergunta passa por um pré-processamento, é refinada e trabalhada em etapas quase iterativas antes de gerar a resposta final, resultando em respostas mais precisas, confiáveis e aprofundadas. O modo Pro também realiza buscas na internet para incorporar informações atualizadas, garantindo que a resposta não fique limitada ao conhecimento estático do modelo. O modo pode ser definido por projeto ou trocado por conversa.

> O modo Pro está disponível **apenas para usuários autenticados**. No modo convidado, somente o Flash está habilitado.

**Personalidade por projeto** — cada projeto pode ter sua própria personalidade (`response_style`), que tem prioridade sobre a personalidade global do usuário enquanto a conversa estiver dentro daquele projeto. Ao criar ou editar um projeto, é possível escolher um dos 7 presets abaixo **ou** escrever livremente a personalidade desejada. Texto livre é automaticamente reescrito por um modelo de linguagem (Groq, via microsserviço Python) em uma instrução de sistema compacta e objetiva antes de ser salvo — economiza tokens em toda mensagem trocada no projeto, já que esse texto entra no prompt de cada chamada ao modelo. Se a Groq estiver indisponível, um fallback local (normalização de espaços + corte por tamanho) garante que a criação do projeto nunca seja bloqueada por isso. Fora de um projeto (chat avulso), vale a personalidade global do usuário normalmente.

**7 personalidades pré-definidas (presets):**

| Personalidade | Descrição |
|---|---|
| Direto | Respostas curtas e objetivas, sem rodeios |
| Técnico | Terminologia precisa e detalhes de implementação |
| Analítico | Análise profunda, prós e contras |
| Estratégico | Visão macro, planejamento e longo prazo |
| Sarcástico | Irônico e ácido, mas sempre útil |
| Bem-humorado | Descontraído, com analogias divertidas |
| Empático | Caloroso, acolhedor e encorajador |

**Traits personalizados** — instruções livres do usuário que complementam a personalidade ativa (global ou de projeto) em qualquer um dos dois casos.

> Os presets continuam fixos no backend — a flexibilidade está em poder sobrescrevê-los com texto livre por projeto, sem precisar editar código.

---

### 📁 Projetos e arquivos

**Projetos** — cada um tem nome, objetivo, resumo, tags, personalidade, modelo preferido, modo de memória, histórico, fontes e arquivos. Completamente isolados entre si.

**Fontes externas** — adicione URLs ou blocos de texto livre como base de conhecimento. O conteúdo é indexado automaticamente para busca RAG.

**Upload de arquivos** — suporte a PDF, TXT, CSV e outros formatos de texto. O conteúdo é extraído, segmentado em chunks e vetorizado. Os binários ficam na coluna `BYTEA` do banco para não se perderem em reinícios do Render.

**Pipeline de indexação RAG:**

```
1. Arquivo enviado ao backend Node via multipart/form-data
2. Texto extraído e enviado ao microsserviço Python
3. Python segmenta em chunks e gera embeddings em lote
4. Vetores armazenados em file_chunks.embedding_v (vector(384))
5. Nas conversas, busca HNSW recupera os chunks mais relevantes
```

> ⚠️ **Limitação conhecida:** o RAG indexa arquivos e fontes externas, mas não indexa o histórico de conversas antigas. O modelo não consegue responder "o que eu decidi sobre X no mês passado" com base no histórico bruto — apenas com o que foi sintetizado nas memórias. Indexação vetorial sobre mensagens históricas está no roadmap.

---

### 🎙️ Voz e código

**Transcrição de voz** — grave áudio diretamente no chat. O arquivo é transcrito via API Whisper da Groq (modelo `whisper-large-v3-turbo`), sem rodar nada localmente e sem consumo de RAM extra. Requer `GROQ_API_KEY`.

**Sandbox de execução de código** — snippets Python executados em ambiente Docker isolado:

| Configuração | Valor padrão |
|---|---|
| Timeout | 5 segundos |
| Limite de memória | 128 MB |
| Módulos permitidos | `math`, `statistics`, `json`, `re`, `datetime`, `collections`, `itertools`, `numpy`, `pandas` |

A validação é feita por análise estática de AST antes da execução, bloqueando imports não autorizados. A comunicação é protegida por `INTERNAL_TOKEN`.

> ⚠️ **Limitação conhecida:** o sandbox não suporta bibliotecas de visualização (`matplotlib`, `plotly`). Código que gera gráficos pode ser executado, mas o output gráfico não é exibido — apenas texto e dados. Suporte a gráficos está no roadmap.

---

### 🤖 Modo Agente Autônomo

Ativado pelo botão "Agente" ao lado do "Programação" no campo de mensagem. Em vez do streaming direto do chat normal, a mensagem vai para `POST /api/agent/run` (SSE), que roda um loop real de function calling do Gemini: a cada rodada o modelo decide se chama uma ferramenta (`rag_search`, `python_sandbox`, `web_search`) ou se já tem o suficiente pra responder. Cada decisão vira um step na timeline (raciocínio, chamada de ferramenta, resultado, resposta final), renderizado em tempo real pelo componente `AgentChatTimeline`.

Com **Raciocínio Estendido** ativado (Modo Pro), o resumo do "pensamento" do Gemini (`thinkingConfig.includeThoughts`) também aparece como um step próprio na timeline, antes da resposta final.

`rag_search` e `python_sandbox` chamam, respectivamente, o microsserviço Python (RAG) e o sandbox Docker já usados pelo resto do app — nenhuma ferramenta nova precisa ser implantada. `web_search` está com a ferramenta declarada (o modelo pode "tentar" chamá-la), mas sem provedor configurado ainda: a chamada retorna um erro gracioso em vez de um resultado inventado.

**Syntax highlighting** — modo programador com destaque de código via `react-syntax-highlighter`.

**Renderização Markdown** — suporte completo a tabelas, listas, blocos de código e formatação GFM via `react-markdown` + `remark-gfm`.

---

### 👤 Conta e interface

**Modo convidado** — use sem cadastro com um ID anônimo local. Ao criar uma conta, histórico e memórias são migrados automaticamente.

**Autenticação via Supabase** — login seguro com persistência de sessão.

**Tema claro/escuro** — persistido por usuário, com suporte em todos os componentes.

**Interface responsiva** — React 18, Tailwind CSS e ícones Lucide.

---

## Arquitetura

```
solaris-v1/
├── frontend/               # React 18 + Vite + Tailwind CSS  →  Vercel
│   └── src/
│       ├── components/     # Sidebar, ChatWindow, MessageInput, Modals...
│       ├── hooks/          # useChat, useAuth, useProjects
│       └── services/       # api.js (cliente HTTP centralizado)
│
├── backend-node/           # Node.js + Express (API REST principal)  →  Render
│   ├── domain/
│   │   ├── routers/        # projects, chats, messages, files, sources, settings, voice
│   │   └── ai/             # gemini.js, prompt.js
│   ├── db/                 # schema.js (migrações automáticas), database.js
│   ├── middleware/         # auth.js
│   └── utils/              # redis.js, errorHandler.js, jobQueue.js, circuitBreaker.js
│
├── backend-python/         # FastAPI (voz, embeddings, RAG, memórias)  →  Render
│   ├── app/
│   │   ├── routers/        # voice, files, embeddings, search, memories, history, title, intent
│   │   ├── ml_models.py    # SentenceTransformer + spaCy (lazy loading)
│   │   └── utils/          # groq_client.py, math_utils.py
│   └── migrations/         # 001_add_pgvector_file_chunks.sql
│
└── sandbox/                # FastAPI + Docker (execução isolada de código)  →  Render
    └── app/
        └── main.py         # AST validation + subprocess execution
```

### Fluxo de comunicação

```
Usuário
  │
  ▼
[Frontend — Vercel]
  │  HTTPS + SSE (streaming)
  ▼
[Backend Node — Render]
  ├──► [Supabase PostgreSQL]    dados, memórias, arquivos, jobs
  ├──► [Redis]                  rate limiting e cache (opcional)
  ├──► [Google Gemini API]      geração de respostas
  ├──► [Backend Python]         embeddings, voz, memórias, títulos, intenção
  │      └──► [GROQ API]        Whisper + geração de títulos + classificação de intenção
  └──► [Sandbox Docker]         execução isolada de código Python
```

### Stack por camada

| Camada | Tecnologias | Hospedagem |
|---|---|---|
| Frontend | React 18, Vite 5, Tailwind CSS 3, Supabase JS, Lucide | Vercel |
| Backend principal | Node.js ≥18, Express 4, pg, BullMQ, ioredis, multer | Render |
| Microsserviço Python | Python 3.12, FastAPI 0.115, sentence-transformers, spaCy 3.8, groq | Render |
| Sandbox | Python 3.12, FastAPI, Docker | Render |
| Banco de dados | PostgreSQL (Supabase) + pgvector | Supabase |
| Cache / fila | Redis + BullMQ (opcional) | — |

---

## Banco de dados

O backend Node aplica migrações automaticamente no startup (sem ferramenta externa). Schema atual: **versão 10**.

### Tabelas

| Tabela | Descrição |
|---|---|
| `projects` | Projetos do usuário: objetivo, tags, modo de memória, modelo e personalidade própria (`response_style`, com prioridade sobre a personalidade global) |
| `chats` | Conversas vinculadas a um projeto (ou avulsas). Suporta fixar (`pinned`), arquivar (`archived_at`) e exclusão reversível (`deleted_at`, soft delete) |
| `messages` | Mensagens com histórico de edições (JSONB) |
| `memories` | Memórias extraídas automaticamente após cada resposta, com embedding para busca |
| `files` | Arquivos: metadados + texto extraído + binário (BYTEA) |
| `file_chunks` | Chunks com `embedding_v vector(384)` (pgvector) |
| `external_sources` | Fontes externas por projeto: URL ou texto livre |
| `user_settings` | Personalidade e traits por usuário |
| `jobs` | Fila de jobs assíncronos (upload e indexação) com retry e prioridade |
| `schema_version` | Controle de versão das migrações |

### Migration pgvector (Supabase)

Execute `backend-python/migrations/001_add_pgvector_file_chunks.sql` manualmente no SQL Editor do Supabase. O script:

1. Habilita a extensão `vector` (pgvector)
2. Adiciona a coluna `embedding_v vector(384)` em `file_chunks`
3. Migra embeddings existentes de JSONB para o tipo nativo `vector`
4. Cria índice **HNSW** com `vector_cosine_ops` para busca por similaridade

> O Supabase já inclui pgvector por padrão — não é necessário instalá-lo manualmente.

---

## APIs e rotas

### Backend Node.js (`/api`)

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/projects` | Lista projetos do usuário |
| `GET` | `/api/projects/:id` | Projeto com seus chats |
| `POST` | `/api/projects` | Cria projeto (aceita `response_style` como preset ou texto livre) |
| `PATCH` | `/api/projects/:id` | Atualiza projeto |
| `DELETE` | `/api/projects/:id` | Remove projeto |
| `GET` | `/api/projects/:projectId/chats` | Chats do projeto, paginado (`?include_archived=true` inclui arquivados; padrão ignora) |
| `POST` | `/api/projects/:id/chats` | Cria chat (`:id` pode ser `none` para chat avulso) |
| `DELETE` | `/api/projects/:id/chats/:chatId` | Remove chat (soft delete via `deleted_at`) |
| `PATCH` | `/api/chats/:chatId/title` | Renomeia chat |
| `PATCH` | `/api/chats/:chatId/project` | Move chat para outro projeto (ou para fora de qualquer projeto, com `project_id: null`) |
| `PATCH` | `/api/chats/:chatId/archive` | Arquiva/desarquiva chat (`{ archived: true }` ou `{ archived: false }`) |
| `PATCH` | `/api/chats/:chatId/pin` | Fixa/desafixa chat no topo da sidebar (`{ pinned: true }` ou `{ pinned: false }`) |
| `GET` | `/api/user/chats` | Chats avulsos do usuário, paginado (`?include_archived=true` inclui arquivados; padrão ignora) |
| `DELETE` | `/api/user/chats` | Remove todos os chats avulsos do usuário |
| `GET` | `/api/messages/chat/:chatId` | Mensagens paginadas de um chat |
| `POST` | `/api/messages/stream` | Envia mensagem (SSE streaming, eventos `progress`/`chunk`/`title`/`maxTokens`/`done`/`error`) |
| `POST` | `/api/messages` | Envia mensagem (fallback não-streaming) |
| `PATCH` | `/api/messages/:messageId` | Edita mensagem (descarta e regenera as seguintes) |
| `POST` | `/api/agent/run` | Modo Agente Autônomo (SSE, eventos `thought`/`extended_reasoning`/`action`/`observation`/`final`/`error`/`done`) — loop de function calling com `rag_search`/`python_sandbox`/`web_search` |
| `GET` | `/api/files/:projectId` | Lista arquivos do projeto |
| `POST` | `/api/files/:projectId` | Envia arquivo para o projeto (multipart) |
| `DELETE` | `/api/files/:projectId/:fileId` | Remove arquivo |
| `GET` | `/api/files/:id/download` | Baixa o binário original do arquivo |
| `GET` | `/api/projects/:projectId/sources` | Lista fontes externas do projeto |
| `POST` | `/api/projects/:projectId/sources/url` | Adiciona fonte externa via URL |
| `POST` | `/api/projects/:projectId/sources/text` | Adiciona fonte externa via texto livre |
| `DELETE` | `/api/projects/:projectId/sources/:sourceId` | Remove fonte |
| `GET` | `/api/settings` | Configurações do usuário autenticado (via header de auth) |
| `POST` / `PUT` | `/api/settings` | Salva personalidade, traits, notificações e privacidade (upsert parcial) |
| `POST` | `/api/migrate` | Migra histórico/memórias/configurações de convidado para conta logada |
| `GET` | `/api/share/:chatId` | Visualização pública (somente leitura) de um chat compartilhado |
| `POST` | `/api/voice/transcribe` | Transcrição de áudio (proxy Python) |

### Microsserviço Python

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/voice/transcribe` | Transcrição via Whisper (GROQ) |
| `POST` | `/files/extract-text` | Extração de texto de arquivo |
| `POST` | `/embeddings/generate` | Embedding de um texto |
| `POST` | `/embeddings/batch` | Embeddings em lote |
| `POST` | `/search/rag` | Busca semântica em chunks (RAG) |
| `POST` | `/memories/extract` | Extração de memórias (spaCy + Groq) |
| `POST` | `/memories/synthesize` | Síntese semântica de memórias relevantes |
| `POST` | `/history/synthesize` | Condensa histórico longo |
| `POST` | `/title/generate` | Gera título do chat |
| `POST` | `/intent/classify` | Classifica intenção da mensagem |
| `POST` | `/tools/condense-chunk` | Condensa chunk de texto por heurística |
| `POST` | `/tools/generate-title` | Gera título com fallback local |
| `POST` | `/tools/optimize-personality` | Reescreve personalidade customizada (texto livre) de forma compacta; fallback local se a Groq estiver indisponível |

### Sandbox

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/tools/python-exec` | Executa código Python isolado (requer `INTERNAL_TOKEN`) |
| `POST` | `/tools/condense-chunk` | Condensa chunk de texto por heurística |

---

## Deploy passo a passo

### Pré-requisitos

Crie contas em [GitHub](https://github.com), [Render](https://render.com), [Vercel](https://vercel.com) e [Supabase](https://supabase.com).

Obtenha as chaves de API:
- **Google AI Studio** — `GEMINI_FLASH_API_KEY` e `GEMINI_PRO_API_KEY` em [aistudio.google.com](https://aistudio.google.com)
- **GROQ** — `GROQ_API_KEY` em [console.groq.com](https://console.groq.com) *(gratuito; necessário para voz, títulos e classificação de intenção)*

---

### Passo 1 — Banco de dados (Supabase)

1. Crie um novo projeto no Supabase.
2. Em **Project Settings → Database**, copie a **Connection String (URI)** → será o `DATABASE_URL`.
3. Em **Project Settings → API**, copie a **Project URL** (`SUPABASE_URL`) e a **anon public key** (`SUPABASE_ANON_KEY`).
4. No **SQL Editor**, execute o arquivo `backend-python/migrations/001_add_pgvector_file_chunks.sql`.

> As demais tabelas são criadas automaticamente pelo backend Node no primeiro start.

---

### Passo 2 — Sandbox (Render — Docker)

> O sandbox precisa estar no ar antes do backend Node.

1. No Render, crie um **Web Service** apontando para a pasta `sandbox`.
2. Selecione **Environment: Docker**.
3. Defina as variáveis:

| Variável | Valor |
|---|---|
| `INTERNAL_TOKEN` | String aleatória longa (ex: UUID de [uuidgenerator.net](https://www.uuidgenerator.net)) |
| `PORT` | `8000` |

4. Após o deploy, copie a URL pública (ex: `https://solaris-sandbox-xxxx.onrender.com`).

---

### Passo 3 — Microsserviço Python (Render)

1. Crie um **Web Service** apontando para a pasta `backend-python`.
2. Selecione **Environment: Python 3.12.0**.
3. **Build command:**
   ```bash
   pip install --upgrade pip "setuptools>=68.0.0,<81" wheel && pip install -r requirements.txt && python -m spacy download pt_core_news_sm
   ```
4. **Start command:**
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port $PORT
   ```
5. Defina as variáveis:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | Connection string do Supabase |
| `FRONTEND_URL` | *(preencher após o deploy do frontend)* |
| `NODE_URL` | *(preencher após o deploy do Node)* |
| `GROQ_API_KEY` | Sua chave da GROQ |
| `EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` |

6. Copie a URL pública após o deploy.

> O modelo de embedding é baixado automaticamente no primeiro uso. O primeiro request pode demorar mais. A transcrição de voz usa `whisper-large-v3-turbo` via API Groq — nenhum modelo local é carregado.

---

### Passo 4 — Backend Node.js (Render)

1. Crie um **Web Service** apontando para a pasta `backend-node`.
2. Selecione **Environment: Node** (versão ≥ 18).
3. **Build command:** `npm install`
4. **Start command:** `node server.js`
5. Defina as variáveis:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | Connection string do Supabase |
| `SUPABASE_URL` | Project URL do Supabase |
| `SUPABASE_ANON_KEY` | Anon key do Supabase |
| `GEMINI_FLASH_API_KEY` | Chave Gemini (modo Flash) |
| `GEMINI_PRO_API_KEY` | Chave Gemini (modo Pro — pode ser a mesma, ou uma chave separada para billing) |
| `GROQ_API_KEY` | Chave da GROQ (opcional) |
| `FRONTEND_URL` | *(preencher após deploy do frontend)* |
| `PYTHON_SERVICE_URL` | URL do microsserviço Python (passo 3) |
| `SANDBOX_URL` | URL do sandbox (passo 2) |
| `INTERNAL_TOKEN` | Mesmo token definido no sandbox |
| `NODE_OPTIONS` | `--dns-result-order=ipv4first` |
| `PORT` | `3001` |

6. Copie a URL pública após o deploy.

> Na primeira execução, o banco é migrado automaticamente. Confirme nos logs: `✅ Schema atualizado para versão 10`.

---

### Passo 5 — Frontend (Vercel)

1. Importe o repositório no Vercel.
2. Configure o projeto:
   - **Root Directory:** `frontend`
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
   - **Framework:** Vite
3. Defina as variáveis:

| Variável | Valor |
|---|---|
| `VITE_API_BASE` | `https://<url-do-node>/api` |
| `VITE_SUPABASE_URL` | Project URL do Supabase |
| `VITE_SUPABASE_ANON_KEY` | Anon key do Supabase |

4. Clique em **Deploy** e copie a URL gerada.

---

### Passo 6 — Ajuste final de CORS

Volte ao Render e atualize `FRONTEND_URL` nos serviços **backend-node** e **backend-python** com a URL da Vercel. Em seguida, faça **Manual Deploy** nos dois para aplicar a mudança.

---

### Keep-alive (plano gratuito)

O Render suspende serviços após 15 minutos de inatividade. Configure um cronjob externo para fazer ping a cada 10 minutos:

```
https://<url-do-node>/api/health
```

Opção gratuita: [cron-job.org](https://cron-job.org). Os três serviços têm endpoint `/health`.

---

## Desenvolvimento local

### Pré-requisitos

- Node.js ≥ 18
- Python 3.12
- Docker *(opcional, para o sandbox)*

```bash
git clone https://github.com/felipesantolivers/solaris-v1.git
cd solaris-v1
```

### Backend Node

```bash
cd backend-node
cp .env.example .env
npm install
npm run dev
# http://localhost:3001
```

### Microsserviço Python

```bash
cd backend-python
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python -m spacy download pt_core_news_sm
cp .env.example .env
uvicorn app.main:app --reload --port 8001
# http://localhost:8001
```

### Sandbox

```bash
# Sem Docker
cd sandbox
uvicorn app.main:app --reload --port 8002

# Com Docker
docker build -t solaris-sandbox .
docker run -p 8002:8000 -e INTERNAL_TOKEN=seu-token-local solaris-sandbox
```

### Frontend

```bash
cd frontend
npm install
# .env:
# VITE_API_BASE=http://localhost:3001/api
# VITE_SUPABASE_URL=...
# VITE_SUPABASE_ANON_KEY=...
npm run dev
# http://localhost:5173
```

---

## Variáveis de ambiente

<details>
<summary>Ver todas as variáveis</summary>

### Backend Node

```env
DATABASE_URL=postgresql://...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
GEMINI_FLASH_API_KEY=AIza...
GEMINI_PRO_API_KEY=AIza...
GROQ_API_KEY=gsk_...
FRONTEND_URL=https://solaris-v1.vercel.app
PYTHON_SERVICE_URL=https://backend-python-xxxx.onrender.com
SANDBOX_URL=https://solaris-sandbox-xxxx.onrender.com
INTERNAL_TOKEN=seu-token-secreto
NODE_OPTIONS=--dns-result-order=ipv4first
PORT=3001
```

### Backend Python

```env
DATABASE_URL=postgresql://...
FRONTEND_URL=https://solaris-v1.vercel.app
NODE_URL=https://solaris-backend-xxxx.onrender.com
GROQ_API_KEY=gsk_...
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
```

### Sandbox

```env
INTERNAL_TOKEN=seu-token-secreto
PORT=8000
```

### Frontend

```env
VITE_API_BASE=https://solaris-backend-xxxx.onrender.com/api
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

</details>

---

## Roadmap

### ✅ Implementado

| Funcionalidade |
|---|
| Memória automática com spaCy + Groq (extração após cada resposta) |
| Busca RAG com pgvector + HNSW |
| Execução de código em sandbox Docker |
| Transcrição de voz via Whisper Large V3 Turbo (GROQ) |
| Streaming de respostas (SSE) |
| Upload e indexação de arquivos |
| Modos Flash e Pro (Flash direto via Gemini; Pro com pré-processamento iterativo e busca na internet) |
| 7 personalidades configuráveis |
| Classificação de intenção por mensagem (técnico, planejamento, revisão, continuação, geral) |
| Modo convidado com migração automática |
| Edição de mensagens com histórico |
| Fila de jobs assíncronos (BullMQ) para upload e indexação de arquivos |
| Personalidade por projeto, com prioridade sobre a personalidade global e otimização automática de texto livre via IA |
| Indicadores granulares de progresso no streaming (SSE: `searching` → `thinking` → `generating`) |
| Modo Agente Autônomo (`POST /api/agent/run`, SSE): loop de function calling real do Gemini com `rag_search` (documentos do projeto) e `python_sandbox` (execução isolada via serviço separado); raciocínio estendido (Pro) via `thinkingConfig.includeThoughts`. `web_search` está com a "assinatura" da ferramenta pronta, mas sem provedor configurado — devolve erro gracioso até integrar um (Tavily/SerpAPI/etc.) |
| Menu de contexto da conversa na sidebar: fixar, renomear, mover para projeto, arquivar e excluir (soft delete) |

---

### 🔜 Planejado

As funcionalidades abaixo estão organizadas da mais fácil para a mais complexa de implementar.

#### Médio — impacto significativo, esforço moderado

| Funcionalidade | Descrição |
|---|---|
| Seção "Arquivados" na sidebar | UI para listar/restaurar conversas arquivadas — o backend já suporta (`?include_archived=true`), falta a tela |
| Geração de imagens (Gemini Imagen) | Geração de imagens diretamente no chat via Gemini Imagen |
| Busca web real no Modo Agente | Integrar um provedor (Tavily/SerpAPI/Bing) na ferramenta `web_search`, hoje um stub |

#### Difícil — alta complexidade ou dependência de infraestrutura

| Funcionalidade | Descrição |
|---|---|
| Colaboração multiusuário em projetos | Projetos compartilhados com controle de acesso, memórias colaborativas e histórico unificado entre usuários |

---

## Autor

**Felipe Sant'Oliver**

## Licença

MIT
