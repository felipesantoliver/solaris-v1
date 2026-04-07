# ✦ Solaris AI

> Assistente de IA pessoal com projetos, memória e múltiplos modelos Gemini.

---

## Visão geral

Solaris é um assistente de IA pessoal construído com React no frontend e Node.js no backend, utilizando os modelos **Gemini 2.5 Flash** e **Gemini 3 Flash com thinking_level (sendo usado como pro)** do Google. Suporta autenticação via Supabase, organização por projetos, memória automática de conversas e upload de arquivos de referência.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Node.js + Express |
| Banco de dados | PostgreSQL via Supabase |
| Auth | Supabase Auth (email + Google OAuth) |
| IA | Google Gemini 2.5 Flash / Pro |
| Deploy frontend | Vercel |
| Deploy backend | Render |

---

## Funcionalidades

- **Projetos** — organize conversas por contexto, com objetivo e estilo de resposta próprios
- **Memória automática** — o Solaris extrai e salva informações relevantes das conversas
- **Modelos Flash e Pro** — Flash para uso geral, Pro para análises mais profundas (requer login)
- **Edição de mensagens** — edite qualquer mensagem e o Solaris regera a resposta
- **Upload de arquivos** — envie PDFs, TXTs, CSVs e outros como referência por projeto
- **Personalidades** — 7 estilos de resposta configuráveis (Direto, Técnico, Analítico, Estratégico, Sarcástico, Bem-humorado, Empático)
- **Modo claro/escuro** — alternância com persistência local
- **Compartilhamento** — copia toda a conversa para a área de transferência
- **Guest mode** — funciona sem login, com migração automática dos dados ao entrar

---

## Estrutura do repositório

```
solaris-v1/
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Componente principal
│   │   ├── main.jsx         # Entry point
│   │   └── index.css        # Estilos globais (Tailwind)
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
│
└── backend/
    ├── server.js            # API Express + integração Gemini
    ├── database.js          # Pool PostgreSQL + helpers + migrations
    ├── package.json
    └── render.yaml          # Config de deploy no Render
```

---

## Variáveis de ambiente

### Backend (Render)

| Variável | Descrição |
|---|---|
| `GEMINI_API_KEY` | Chave da API do Google Gemini |
| `DATABASE_URL` | Connection string do Supabase (Session Pooler) |
| `FRONTEND_URL` | URL do frontend no Vercel (sem barra no final) |
| `PORT` | Porta do servidor (padrão: 3001) |
| `NODE_OPTIONS` | `--dns-result-order=ipv4first` |

### Frontend (Vercel)

| Variável | Descrição |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Chave anon pública do Supabase |
| `VITE_API_BASE` | URL da API do backend no Render |

---

## Rodando localmente

### Backend

```bash
cd backend
npm install
# crie um .env com as variáveis acima
node server.js
```

### Frontend

```bash
cd frontend
npm install
# crie um .env.local com as variáveis VITE_*
npm run dev
```

---

## Deploy

### Backend → Render

O arquivo `render.yaml` já configura o serviço. Basta conectar o repositório no Render e definir as variáveis de ambiente.

> **Importante:** use a connection string do **Session Pooler** do Supabase (não Direct Connection) para garantir compatibilidade com IPv4 no Render.

### Frontend → Vercel

Conecte o repositório no Vercel apontando para a pasta `frontend`. As variáveis `VITE_*` devem ser configuradas no painel do projeto.

---

## Banco de dados

As tabelas são criadas automaticamente no primeiro boot via `initDb()`. O schema inclui:

- `projects` — projetos por usuário
- `chats` — conversas vinculadas a projetos (ou livres)
- `messages` — mensagens com suporte a edição e histórico
- `memories` — memórias extraídas automaticamente por projeto
- `files` — arquivos de referência por projeto
- `user_settings` — personalidade e traços customizados por usuário

---

## Arquitetura preparada para o futuro

O Solaris foi construído com decisões técnicas que antecipam evoluções naturais do produto:

- **Multimodalidade pronta** — estrutura preparada para suporte a geração e análise de imagens via Gemini Imagen, sem necessidade de refatoração do pipeline de mensagens
- **Memória semântica** — o schema de memórias foi desenhado para receber embeddings vetoriais, permitindo que a IA aprenda com o contexto acumulado dos projetos em vez de apenas busca textual
- **Estrutura de projetos** — separação estrita de conversas, arquivos e memórias por objetivo, base para futuros agentes especializados por domínio
- **Interface extensível** — React com suporte a Dark Mode, renderização fluida de Markdown e componentes isolados, facilitando adição de novos modos de interação

---

## Atualizações futuras planejadas

| Funcionalidade | Descrição |
|---|---|
| 🖼️ Geração de imagens | Integração com Gemini Imagen para criar imagens dentro do chat |
| 🧠 Memória semântica | Busca por similaridade com embeddings vetoriais (pgvector) |
| 🤖 Agentes por projeto | Agentes autônomos com ferramentas específicas por contexto |
| 📊 Renderização de Markdown | Formatação completa de código, tabelas e listas nas respostas |
| 🔔 Notificações | Alertas de conclusão para tarefas longas em segundo plano |
| 📱 App mobile | Versão nativa iOS e Android via React Native |
| 🔗 Integrações externas | Conexão com Notion, Google Drive e outros via MCP |
| 👥 Projetos colaborativos | Compartilhamento de projetos entre múltiplos usuários |

---

## Créditos

Desenvolvido por **Felipe Sant'Oliver**.

---

## 📄 Licença

**License: Custom (Non-Commercial)**

Este projeto é disponibilizado para uso pessoal e educacional. O uso comercial requer licença paga.

Entre em contato para mais informações sobre licenciamento comercial.
