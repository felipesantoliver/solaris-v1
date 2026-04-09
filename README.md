Solaris AI

Assistente pessoal de IA com memória persistente, organização por projetos e suporte a múltiplos modelos Gemini, construído sobre uma arquitetura modular e escalável.

Visão geral

Solaris AI é um assistente projetado para organizar contexto, conhecimento e interações em torno de projetos estruturados.

A aplicação utiliza React no frontend e Node.js no backend, integrando os modelos Gemini 2.5 Flash e Gemini 3 Flash Preview (Pro), permitindo desde respostas rápidas até análises mais profundas.

A arquitetura foi refatorada para um modelo modular orientado a domínio, com separação clara entre:

banco de dados
lógica de IA
rotas HTTP
hooks e estado
componentes de interface

Isso torna o sistema mais testável, manutenível e preparado para evolução.

Stack
| Camada          | Tecnologia                           |
| --------------- | ------------------------------------ |
| Frontend        | React 18 + Vite + Tailwind CSS       |
| Backend         | Node.js + Express                    |
| Banco de dados  | PostgreSQL (Supabase)                |
| Autenticação    | Supabase Auth (Email + Google OAuth) |
| IA              | Gemini 2.5 Flash / Gemini 3 Pro      |
| Deploy frontend | Vercel                               |
| Deploy backend  | Render                               |

Funcionalidades:

Inteligência e contexto
Memória automática com extração de informações relevantes
Suporte a múltiplos modelos (Flash e Pro)
Personalidades configuráveis (7 estilos)
Uso de fontes externas (URLs e textos)

Organização
Projetos com contexto próprio
Conversas isoladas por objetivo
Upload de arquivos (PDF, TXT, CSV, etc.)
Histórico com edição de mensagens

Experiência
Modo guest com migração automática
Compartilhamento de conversas
Modo claro/escuro persistente
Destaque de código (modo programador)

Estrutura do repositório

solaris/
├── .gitignore
├── README.md
├── LICENSE
├── package.json
│
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── package-lock.json
│   ├── server.js
│   ├── render.yaml
│   ├── db/
│   │   ├── database.js
│   │   └── schema.js
│   ├── domain/
│   │   ├── ai/
│   │   │   ├── gemini.js
│   │   │   ├── prompt.js
│   │   │   └── embeddings.js
│   │   └── routers/
│   │       ├── projects.js
│   │       ├── chats.js
│   │       ├── messages.js
│   │       ├── files.js
│   │       ├── sources.js
│   │       └── settings.js
│   └── utils/
│       ├── errorHandler.js
│       └── jobQueue.js
│
└── frontend/
    ├── .env.example
    ├── index.html
    ├── package.json
    ├── package-lock.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── vercel.json
    └── src/
        ├── main.jsx
        ├── index.css
        ├── App.jsx
        ├── config/
        │   └── supabase.js
        ├── services/
        │   └── api.js
        ├── hooks/
        │   ├── useAuth.js
        │   ├── useProjects.js
        │   └── useChat.js
        └── components/
            ├── Sidebar.jsx
            ├── ChatWindow.jsx
            ├── MessageInput.jsx
            ├── ProjectModal.jsx
            ├── SettingsModal.jsx
            ├── AuthModal.jsx
            └── ui/
                ├── SolarSystem.jsx
                ├── ConfirmDialog.jsx
                ├── ShareModal.jsx
                ├── MessageBubble.jsx
                ├── ModelToggle.jsx
                └── Orbit.jsx

Variáveis de ambiente:

Backend (Render)
| Variável               | Descrição                                      |
| ---------------------- | ---------------------------------------------- |
| `GEMINI_FLASH_API_KEY` | API Key do Gemini Flash                        |
| `GEMINI_PRO_API_KEY`   | API Key do Gemini Pro (opcional)               |
| `DATABASE_URL`         | Connection string do Supabase (Session Pooler) |
| `FRONTEND_URL`         | URL do frontend                                |
| `PORT`                 | Porta do servidor                              |

Frontend (Vercel)
| Variável                 | Descrição               |
| ------------------------ | ----------------------- |
| `VITE_SUPABASE_URL`      | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Chave pública           |
| `VITE_API_BASE`          | URL da API              |

Execução local:

Backend:
cd backend
npm install
cp .env.example .env
node server.js

Frontend:
cd frontend
npm install
cp .env.example .env.local
npm run dev

Deploy
Backend (Render)
Utiliza o arquivo render.yaml
Configurar variáveis de ambiente no painel
Recomenda-se usar a connection string do Session Pooler do Supabase
Frontend (Vercel)
Apontar para a pasta /frontend
Configurar variáveis VITE_*
Banco de dados

O schema é inicializado automaticamente via initDb().

Principais tabelas
projects — organização por contexto
chats — conversas
messages — mensagens com histórico de edição
memories — memória persistente por projeto
files — arquivos enviados
file_chunks — chunks com embeddings
external_sources — fontes externas
user_settings — preferências do usuário
jobs — processamento assíncrono
Arquitetura e evolução

O projeto foi estruturado para suportar evolução incremental sem reescrita:

Suporte planejado a multimodalidade (imagens)
Estrutura pronta para memória semântica com embeddings
Base para agentes especializados por projeto
Processamento assíncrono para tarefas pesadas
Frontend modular e extensível

Roadmap
| Funcionalidade       | Descrição                      |
| -------------------- | ------------------------------ |
| Geração de imagens   | Integração com Gemini Imagen   |
| Memória semântica    | Busca vetorial com embeddings  |
| Agentes por projeto  | Execução autônoma por contexto |
| Markdown avançado    | Renderização completa          |
| Notificações         | Tarefas em segundo plano       |
| Aplicativo mobile    | Versão com React Native        |
| Integrações externas | Notion, Google Drive, etc.     |
| Colaboração          | Projetos multiusuário          |

Autor
Felipe Sant'Oliver

Licença
MIT
