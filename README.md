# Solaris AI

Assistente pessoal de IA com memória persistente, organização por projetos e suporte a múltiplos modelos Gemini.

## Visão geral

Solaris AI é um assistente projetado para organizar contexto, conhecimento e interações em torno de projetos estruturados. Utiliza React no frontend, Node.js no backend e um microsserviço Python para processamento de áudio, extração de texto, embeddings e busca RAG.

## Funcionalidades principais

- **Memória automática** com extração de informações relevantes
- **Múltiplos modelos** (Gemini Flash e Pro)
- **Personalidades configuráveis** (7 estilos)
- **Projetos** com contexto próprio e fontes externas (URL, texto)
- **Upload de arquivos** (PDF, TXT, CSV, etc.)
- **Edição e histórico de mensagens**
- **Modo convidado** com migração automática
- **Compartilhamento de conversas**
- **Modo claro/escuro** persistente
- **Destaque de código** (modo programador)

## Arquitetura

- **Frontend:** React + Vite + Tailwind CSS, hospedado na Vercel.
- **Backend Node.js:** API REST, integração com Gemini, banco PostgreSQL, orquestração.
- **Microsserviço Python:** FastAPI, Whisper (transcrição), sentence-transformers (embeddings), spaCy (extração de memórias), pypdf (extração de texto).

## Deploy

### Pré-requisitos

- Contas no [GitHub](https://github.com), [Render](https://render.com) e [Vercel](https://vercel.com).
- Banco de dados PostgreSQL (recomendamos [Supabase](https://supabase.com)).
- Chaves de API:
  - Gemini Flash: `GEMINI_FLASH_API_KEY`
  - Gemini Pro: `GEMINI_PRO_API_KEY`
  - (Opcional) GROQ_API_KEY

### Passo a passo

1. **Clone o repositório** e faça push para o GitHub.
2. **Deploy do microsserviço Python** no Render:
   - Crie um Web Service com build command: `pip install -r requirements.txt && python -m spacy download pt_core_news_sm`
   - Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Defina as variáveis: `DATABASE_URL`, `FRONTEND_URL` (URL da Vercel).
   - Copie a URL pública do serviço (ex: `https://solaris-python.onrender.com`).
3. **Deploy do backend Node** no Render:
   - Crie outro Web Service com build command: `npm install`
   - Start command: `node server.js`
   - Variáveis: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GEMINI_FLASH_API_KEY`, `GEMINI_PRO_API_KEY`, `FRONTEND_URL`, `PYTHON_SERVICE_URL` (URL do Python), `GROQ_API_KEY`.
   - Copie a URL pública do Node (ex: `https://solaris-node.onrender.com`).
4. **Deploy do frontend** na Vercel:
   - Importe o repositório, defina build command: `npm run build` e output directory: `dist`.
   - Adicione a variável de ambiente: `VITE_API_BASE = https://solaris-node.onrender.com/api`.
   - Após o deploy, a Vercel fornecerá a URL do frontend (ex: `https://solaris.vercel.app`).
5. **Atualize** as variáveis `FRONTEND_URL` no Node e Python com a URL da Vercel, se necessário (re-deploy).

### Variáveis de ambiente

#### Node (Render)
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `GEMINI_FLASH_API_KEY`
- `GEMINI_PRO_API_KEY`
- `FRONTEND_URL`
- `PYTHON_SERVICE_URL`
- `GROQ_API_KEY` (opcional)

#### Python (Render)
- `DATABASE_URL`
- `FRONTEND_URL`
- `WHISPER_MODEL` (default: tiny)
- `EMBEDDING_MODEL` (default: sentence-transformers/all-MiniLM-L6-v2)

#### Vercel
- `VITE_API_BASE` (URL do Node + /api)

## Desenvolvimento local

1. Clone o repositório.
2. Backend Node: `cd backend-node && npm install && npm run dev`
3. Microsserviço Python: `cd backend-python && pip install -r requirements.txt && python -m spacy download pt_core_news_sm && uvicorn app.main:app --reload`
4. Frontend: `cd frontend && npm install && npm run dev`
5. Configure as variáveis de ambiente localmente (arquivo `.env`).

## Roadmap

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

## Autor

**Felipe Sant'Oliver**

## Licença

MIT