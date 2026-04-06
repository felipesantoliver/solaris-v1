🌟 Solaris AI v1

Solaris é um ecossistema de produtividade que utiliza histórico de Projetos Isolados e Inteligência Híbrida para aprender com conversas, arquivos e decisões. O sistema evolui com o tempo, utilizando uma estrutura de fallback para garantir alta disponibilidade e o melhor custo-benefício.

🚀 Status do Projeto: Em Construção
O Solaris está sendo desenvolvido para oferecer uma experiência de chat inteligente com "memória de longo prazo". Atualmente, o sistema conta com:

Arquitetura de Fallback: Integração principal com DeepSeek-Chat (raciocínio lógico) e contingência automática via Gemini 1.5 Flash.

Multimodalidade Pronta: Suporte estruturado para futuras gerações de imagens via Gemini Imagen.

Memória Semântica: Estrutura preparada para embeddings, permitindo que a IA aprenda com o contexto dos projetos.

Estrutura de Projetos: Separação estrita de conversas e arquivos por objetivos específicos.

Interface: Baseada em React com suporte a Dark Mode e renderização fluida de Markdown.

📂 Estrutura do Repositório
Plaintext
Solaris-v1/
├── backend/                # Servidor API (Node.js + Express)
│   ├── server.js           # Servidor principal e rotas (CORS)
│   ├── database.js         # Persistência de dados com SQLite
│   ├── aiService.js        # Lógica de IA Híbrida (DeepSeek + Gemini)
│   └── routes/             # Endpoints: Mensagens, Projetos, Arquivos e Share
├── frontend/               # Interface do Usuário (React + Vite)
│   ├── src/
│   │   ├── App.jsx         # Gerenciamento de estado global
│   │   └── SolarisAgent.jsx # Componente de interface do agente
│   └── public/             # Ativos estáticos


🛠️ Tecnologias Utilizadas
Frontend: React, Tailwind CSS, Lucide Icons, Vite.

Backend: Node.js, Express, SQLite (sql.js / better-sqlite3).

IA & LLMs: DeepSeek API, Google Generative AI SDK (Gemini).

Infra: Render (Backend), Vercel (Frontend), Cron-job.org (Keep-alive).

📄 Licença
Este projeto está sob a licença MIT. Por estar em fase inicial, sinta-se à vontade para contribuir com sugestões e melhorias.
