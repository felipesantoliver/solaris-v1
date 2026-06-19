# Solaris AI

> **Versão atual:** `v1.0.0` — *Solaris Core*

**Acesse em produção:** [solaris-v1.vercel.app](https://solaris-v1.vercel.app)

Assistente pessoal de IA com memória persistente, organização por projetos e suporte a múltiplos modelos de linguagem. Projetado para funcionar como um segundo cérebro: lembra do que foi discutido, organiza conhecimento por contexto e executa código em ambiente seguro.

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

Solaris AI é construído em torno do conceito de **projetos com contexto próprio**. Cada projeto mantém suas memórias, histórico de conversas, arquivos e fontes de conhecimento de forma isolada. O sistema usa embeddings semânticos para recuperação de informações (RAG) e spaCy + Groq para extrair e sintetizar memórias automaticamente ao encerrar cada conversa.

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

**Memória automática** — ao encerrar uma conversa, o sistema analisa o texto com spaCy buscando padrões relevantes (decisões, tecnologias, preferências, regras). Quando `GROQ_API_KEY` está disponível, usa um modelo de linguagem para síntese mais sofisticada. As memórias ficam vinculadas ao projeto (ou ao chat, se avulso) e são injetadas nas próximas conversas.

> ⚠️ **Limitação conhecida:** memórias são extraídas apenas ao encerrar a conversa. Se o usuário fechar a aba ou a sessão cair antes do encerramento, as memórias daquela sessão são perdidas. Extração incremental mid-conversation está no roadmap.

**Seleção de janela de contexto** — o backend seleciona dinamicamente quais memórias e mensagens anteriores incluir em cada requisição, priorizando relevância para não desperdiçar tokens.

**Busca RAG** — recuperação semântica sobre arquivos e fontes do projeto usando embeddings `sentence-transformers/all-MiniLM-L6-v2` (384 dimensões). Os vetores são armazenados no Supabase com pgvector e recuperados via índice HNSW com similaridade de cosseno.

**Modos de memória por projeto:**
- `projeto` — memórias isoladas por projeto
- `global` — memórias compartilhadas entre todos os projetos do usuário

---

### 💬 Conversas

**Streaming de respostas** — respostas chegam em tempo real via Server-Sent Events, com sequência de status visual: `Analisando contexto…` → `Consultando memórias…` → `Preparando resposta…`

**Edição de mensagens** — qualquer mensagem pode ser editada. As mensagens seguintes são descartadas e a resposta é regenerada a partir daquele ponto. O histórico de edições é preservado no banco.

**Histórico paginado** — carregamento de 30 mensagens por página para chats longos.

**Geração automática de título** — gerado via Groq na primeira mensagem, com fallback para as primeiras 6 palavras.

**Rate limiting** — dois níveis de proteção, implementado com Redis (com fallback em memória):

| Tipo de usuário | Limite |
|---|---|
| Convidado | 15 mensagens/min |
| Autenticado | 40 mensagens/min |

> ⚠️ **Nota sobre modo convidado:** o limite de 15 msg/min se aplica por janela de tempo, mas não há limite total de mensagens nem prazo de expiração definido para o ID anônimo. Caso o ID expire, memórias e histórico acumulados são perdidos sem aviso — comportamento que será endereçado em versão futura.

---

### 🤖 Modelos e personalidades

**Múltiplos modelos** — alterne entre Gemini Flash (rápido) e Gemini Pro (mais elaborado). O modelo pode ser definido por projeto ou por conversa.

**7 personalidades configuráveis:**

| Personalidade | Descrição |
|---|---|
| Direto | Respostas curtas e objetivas, sem rodeios |
| Técnico | Terminologia precisa e detalhes de implementação |
| Analítico | Análise profunda, prós e contras |
| Estratégico | Visão macro, planejamento e longo prazo |
| Sarcástico | Irônico e ácido, mas sempre útil |
| Bem-humorado | Descontraído, com analogias divertidas |
| Empático | Caloroso, acolhedor e encorajador |

**Traits personalizados** — instruções livres que complementam o comportamento da personalidade base.

> As personalidades acima são fixas no backend. Para controle total do comportamento do modelo, consulte o roadmap — personalidades completamente customizáveis (system prompt próprio por projeto) estão planejadas.

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

**Transcrição de voz** — grave áudio diretamente no chat. O arquivo é transcrito via Whisper da GROQ API (sem modelo local, sem consumo de RAM extra). Requer `GROQ_API_KEY`.

**Sandbox de execução de código** — snippets Python executados em ambiente Docker isolado:

| Configuração | Valor padrão |
|---|---|
| Timeout | 5 segundos |
| Limite de memória | 128 MB |
| Módulos permitidos | `math`, `statistics`, `json`, `re`, `datetime`, `collections`, `itertools`, `numpy`, `pandas` |

A validação é feita por análise estática de AST antes da execução, bloqueando imports não autorizados. A comunicação é protegida por `INTERNAL_TOKEN`.

> ⚠️ **Limitação conhecida:** o sandbox não suporta bibliotecas de visualização (`matplotlib`, `plotly`). Código que gera gráficos pode ser executado, mas o output gráfico não é exibido — apenas texto e dados. Suporte a gráficos está no roadmap.

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
│   └── utils/              # redis.js, errorHandler.js
│
├── backend-python/         # FastAPI (voz, embeddings, RAG, memórias)  →  Render
│   ├── app/
│   │   ├── routers/        # voice, files, embeddings, search, memories, history, title
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
  ├──► [Backend Python]         embeddings, voz, memórias, títulos
  │      └──► [GROQ API]        Whisper + geração de títulos
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

O backend Node aplica migrações automaticamente no startup (sem ferramenta externa). Schema atual: **versão 4**.

### Tabelas

| Tabela | Descrição |
|---|---|
| `projects` | Projetos do usuário: objetivo, tags, modo de memória, modelo |
| `chats` | Conversas vinculadas a um projeto |
| `messages` | Mensagens com histórico de edições (JSONB) |
| `memories` | Memórias extraídas automaticamente, com embedding para busca |
| `files` | Arquivos: metadados + texto extraído + binário (BYTEA) |
| `file_chunks` | Chunks com `embedding_v vector(384)` (pgvector) |
| `external_sources` | Fontes externas por projeto: URL ou texto livre |
| `user_settings` | Personalidade e traits por usuário |
| `jobs` | Fila de jobs assíncronos com retry e prioridade |
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
| `POST` | `/api/projects` | Cria projeto |
| `PATCH` | `/api/projects/:id` | Atualiza projeto |
| `DELETE` | `/api/projects/:id` | Remove projeto |
| `GET` | `/api/chats` | Lista chats (filtro por projeto) |
| `POST` | `/api/chats` | Cria chat |
| `DELETE` | `/api/chats/:id` | Remove chat |
| `GET` | `/api/chats/:id/messages` | Mensagens paginadas |
| `POST` | `/api/messages` | Envia mensagem (SSE streaming) |
| `PATCH` | `/api/messages/:id` | Edita mensagem |
| `POST` | `/api/files/upload` | Envia arquivo para um projeto |
| `GET` | `/api/files/:projectId` | Lista arquivos do projeto |
| `DELETE` | `/api/files/:id` | Remove arquivo |
| `POST` | `/api/sources` | Adiciona fonte externa |
| `GET` | `/api/sources/:projectId` | Lista fontes do projeto |
| `DELETE` | `/api/sources/:id` | Remove fonte |
| `GET` | `/api/settings/:userId` | Configurações do usuário |
| `POST` | `/api/settings` | Salva personalidade e traits |
| `POST` | `/api/voice/transcribe` | Transcrição de áudio (proxy Python) |

### Microsserviço Python

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/voice/transcribe` | Transcrição via Whisper (GROQ) |
| `POST` | `/files/extract` | Extração de texto de arquivo |
| `POST` | `/embeddings/generate` | Embedding de um texto |
| `POST` | `/embeddings/batch` | Embeddings em lote |
| `POST` | `/search/chunks` | Busca semântica em chunks |
| `POST` | `/memories/extract` | Extração de memórias (spaCy + Groq) |
| `POST` | `/memories/search` | Busca semântica em memórias |
| `POST` | `/history/condense` | Condensa histórico longo |
| `POST` | `/title/generate` | Gera título do chat |
| `POST` | `/intent/detect` | Detecta intenção da mensagem |

### Sandbox

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/execute` | Executa código Python isolado (requer `INTERNAL_TOKEN`) |
| `POST` | `/embeddings/batch` | Embeddings em lote (alternativa) |

---

## Deploy passo a passo

### Pré-requisitos

Crie contas em [GitHub](https://github.com), [Render](https://render.com), [Vercel](https://vercel.com) e [Supabase](https://supabase.com).

Obtenha as chaves de API:
- **Google AI Studio** — `GEMINI_FLASH_API_KEY` e `GEMINI_PRO_API_KEY` em [aistudio.google.com](https://aistudio.google.com)
- **GROQ** — `GROQ_API_KEY` em [console.groq.com](https://console.groq.com) *(gratuito; necessário para voz e geração de títulos)*

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
| `WHISPER_MODEL` | `tiny` |

6. Copie a URL pública após o deploy.

> O modelo de embedding é baixado automaticamente no primeiro uso. O primeiro request pode demorar mais.

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
| `GEMINI_FLASH_API_KEY` | Chave Gemini Flash |
| `GEMINI_PRO_API_KEY` | Chave Gemini Pro |
| `GROQ_API_KEY` | Chave da GROQ (opcional) |
| `FRONTEND_URL` | *(preencher após deploy do frontend)* |
| `PYTHON_SERVICE_URL` | URL do microsserviço Python (passo 3) |
| `SANDBOX_URL` | URL do sandbox (passo 2) |
| `INTERNAL_TOKEN` | Mesmo token definido no sandbox |
| `NODE_OPTIONS` | `--dns-result-order=ipv4first` |
| `PORT` | `3001` |

6. Copie a URL pública após o deploy.

> Na primeira execução, o banco é migrado automaticamente. Confirme nos logs: `✅ Schema atualizado para versão 4`.

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
WHISPER_MODEL=tiny
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
| Memória automática com spaCy + Groq |
| Busca RAG com pgvector + HNSW |
| Execução de código em sandbox Docker |
| Transcrição de voz via Whisper/GROQ |
| Streaming de respostas (SSE) |
| Upload e indexação de arquivos |
| Múltiplos modelos Gemini (Flash/Pro) |
| 7 personalidades configuráveis |
| Modo convidado com migração automática |
| Edição de mensagens com histórico |
| Fila de jobs assíncronos (BullMQ) |

---

### 🔜 Planejado

As funcionalidades abaixo estão organizadas da mais fácil para a mais complexa de implementar.

#### Fácil — baixo esforço, alto impacto imediato

| Funcionalidade | Descrição |
|---|---|
| Suporte a gráficos no sandbox | Adicionar `matplotlib` e `plotly` aos módulos permitidos e retornar imagens base64 como output gráfico |
| Aviso de expiração do modo convidado | Notificar o usuário anônimo antes que seu ID expire, com opção de criar conta para preservar o histórico |
| Renderização Markdown avançada | Melhorias na renderização GFM: suporte a callouts, math (KaTeX), e diagramas Mermaid inline |

#### Médio — impacto significativo, esforço moderado

| Funcionalidade | Descrição |
|---|---|
| Painel de contexto usado na resposta | Exibição expansível (não intrusiva) das memórias e chunks RAG injetados em cada resposta, para depuração e maior transparência |
| Personalidade completamente customizável | System prompt livre por projeto, substituindo (não apenas complementando) as personalidades base — mais poderoso que traits adicionais |
| Extração de memórias incremental | Salvar memórias a cada N mensagens ou ao detectar padrões relevantes mid-conversation, eliminando a perda de contexto por fechamento abrupto de aba |
| Notificações e tarefas em background | Jobs assíncronos visíveis ao usuário: indexação, extração de memórias, geração de títulos com progresso em tempo real |
| Geração de imagens (Gemini Imagen) | Geração de imagens diretamente no chat via Gemini Imagen |

#### Difícil — alta complexidade ou dependência de infraestrutura

| Funcionalidade | Descrição |
|---|---|
| RAG sobre histórico de conversas | Indexação vetorial das mensagens históricas, permitindo buscas como "o que eu decidi sobre X no mês passado" além do que foi sintetizado nas memórias |
| Agentes autônomos por projeto | Execução de tarefas multi-etapa com ferramentas (busca web, execução de código, leitura de arquivos) sem intervenção manual a cada passo |
| Colaboração multiusuário em projetos | Projetos compartilhados com controle de acesso, memórias colaborativas e histórico unificado entre usuários |
| Integrações externas | Conectores com Notion, Google Drive, GitHub e outros serviços como fontes de conhecimento ou destinos de output |
| Aplicativo mobile (React Native) | App nativo iOS/Android com suporte a voz e notificações push |

---

## Autor

**Felipe Sant'Oliver**

## Licença

MIT
