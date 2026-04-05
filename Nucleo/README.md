# 🌟 Solaris AI v2

Assistente de IA com organização por projetos, memória semântica evolutiva e suporte a arquivos.

---

## 🚀 Instalação rápida

### Pré-requisitos
- Node.js 18+
- Chave de API do Google Gemini (https://aistudio.google.com/app/apikey)

### 1. Backend

```bash
cd backend
npm install
```

**Configure sua chave de API** — edite `geminiService.js` e substitua `'SUA_CHAVE_AQUI'` pela sua chave, **ou** use variável de ambiente (recomendado):

```bash
# Linux/Mac
export GEMINI_API_KEY=sua_chave_aqui
node server.js

# Windows (PowerShell)
$env:GEMINI_API_KEY="sua_chave_aqui"
node server.js
```

O backend sobe em `http://localhost:3001`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Acesse `http://localhost:5173`.

---

## 📁 Estrutura

```
solaris-completo/
├── backend/
│   ├── server.js           # Entrada principal Express
│   ├── database.js         # SQLite + schema
│   ├── geminiService.js    # IA, embeddings, memória
│   ├── fileProcessor.js    # Extração de texto (PDF, DOCX, etc.)
│   └── routes/
│       ├── projects.js     # CRUD projetos + memórias
│       ├── messages.js     # Chats e mensagens
│       ├── files.js        # Upload e gestão de arquivos
│       └── share.js        # Links de compartilhamento
└── frontend/
    └── src/
        └── App.jsx         # Interface completa
```

---

## ✅ Correções aplicadas (v1 → v2)

| Problema | Correção |
|---|---|
| `toggleDarkMode` não definida | Função substituída por `setDarkMode(v => !v)` inline |
| `handleInput` não definida | Função adicionada com auto-resize do textarea |
| `handleKeyDown` não definida | Função adicionada com suporte a Shift+Enter |
| Modelo de embedding desatualizado | `embedding-001` → `text-embedding-004` |
| Chat não encontrava `project_id` | Rota de mensagens agora faz lookup do chat no DB |
| Deleção de chat sem rota backend | Rota `DELETE /api/messages/chat/:id` implementada |
| Sem tratamento de erro na API | Try/catch com timeout de 30s em todas as chamadas |
| Memórias duplicadas | Verificação de similaridade > 0.92 antes de salvar |
| Upload sem feedback | Toast de progresso adicionado |
| CORS restritivo | Configuração CORS explícita com origins corretos |
| Dark mode não persistia | Salvo no `localStorage` |
| Sidebar sem responsividade | Sidebar mobile com overlay adicionada |
| Sem visualização de memórias | Modal completo com listagem e deleção |
| Sem edição de projeto | Modal de configurações com PATCH |
| Título do chat sempre "Nova conversa" | Auto-geração de título via Gemini após 1ª mensagem |
| Sem renderização de markdown | Parser markdown simples integrado |

## 🆕 Melhorias v2

- **Renderização de markdown** nas respostas da IA (negrito, código, listas, etc.)
- **Sidebar responsiva** com menu mobile
- **Modal de Memórias** — visualize, gerencie e delete memórias do projeto
- **Modal de Configurações** — edite nome, objetivo, estilo e memória do projeto ativo
- **Indicador de contexto** no footer (modo memória, estilo, arquivos ativos)
- **Breadcrumb** no header mostrando projeto ativo
- **Threshold de relevância** nas buscas semânticas (score > 0.6)
- **Deduplicação de memórias** (similaridade > 0.92)
- **Auto-título de chats** gerado pela IA após primeira mensagem
- **Timeout de 30s** nas chamadas à API do Gemini
- **Suporte a mais tipos de arquivo** (.ts, .yaml, .sh, .env, etc.)
- **WAL mode** no SQLite para melhor performance de escrita
- **Índices no banco** para queries mais rápidas
- **Contador de caracteres** no input

---

## 🔑 Variáveis de ambiente (opcionais)

| Variável | Padrão | Descrição |
|---|---|---|
| `GEMINI_API_KEY` | — | Chave da API Google Gemini (**obrigatória**) |
| `PORT` | `3001` | Porta do backend |
| `FRONTEND_URL` | `http://localhost:5173` | URL do frontend (para CORS e links de share) |

---

## 📡 Endpoints da API

### Projetos
- `GET /api/projects` — Lista projetos do usuário
- `POST /api/projects` — Cria projeto
- `GET /api/projects/:id` — Detalhes + chats
- `PATCH /api/projects/:id` — Atualiza projeto
- `DELETE /api/projects/:id` — Remove projeto
- `GET /api/projects/:id/memories` — Lista memórias
- `DELETE /api/projects/:id/memories/:memId` — Remove memória

### Mensagens
- `GET /api/messages/chat/:chatId` — Histórico do chat
- `POST /api/messages/chat/:chatId` — Envia mensagem
- `POST /api/messages/project/:projectId/chat` — Cria chat
- `DELETE /api/messages/chat/:chatId` — Deleta chat

### Arquivos
- `GET /api/files/project/:projectId` — Lista arquivos
- `POST /api/files/project/:projectId` — Upload (multipart)
- `DELETE /api/files/:fileId` — Remove arquivo

### Compartilhamento
- `POST /api/share/project/:projectId` — Gera/retorna link
- `GET /api/share/:token` — Acessa projeto via token
