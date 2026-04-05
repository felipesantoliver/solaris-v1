🌟 Solaris AI v1



Solaris é um ecossistema de produtividade que utiliza histórico de Projetos Isolados e Embeddings avançados para aprender com conversas, arquivos e decisões, oferecendo respostas que evoluem com o tempo.



Status do Projeto: Em Construção

O Solaris está sendo desenvolvido para oferecer uma experiência de chat inteligente com "memória de longo prazo". Atualmente, o sistema conta com:



Core de IA: Integração com o modelo gemini-1.5-flash.



Memória Semântica: Implementação inicial de embeddings (text-embedding-004) para que a IA aprenda com o contexto dos projetos.



Estrutura de Projetos: Separação de conversas e arquivos por objetivos específicos.



Interface: Baseada em React com suporte a Dark Mode e renderização de Markdown.



Estrutura do Repositório



Solaris-v1/

├── backend/                # Servidor API (Node.js + Express)

│   ├── server.js           # Gerenciamento de rotas e segurança (CORS)

│   ├── database.js         # Banco de dados SQLite (Persistência)

│   ├── aiService.js    # Lógica da IA e processamento de memória

│   └── routes/             # Endpoints de Mensagens, Projetos e Arquivos

├── frontend/               # Interface do Usuário (React + Vite)

│   └── src/

│       └── App.jsx         # Componente principal da aplicação





Como configurar (Deploy Inicial)



Para colocar o Solaris online pela primeira vez:



Backend (Render):



Conecte este repositório ao Render.com.



Configure a variável de ambiente GEMINI\_API\_KEY.



Defina a porta padrão como 3001.



Frontend (Vercel):



Importe o repositório para a Vercel.



Certifique-se de que a API\_BASE no App.jsx aponte para a URL do seu backend no Render.



Tecnologias Utilizadas



Frontend: React, Tailwind CSS, Lucide Icons.



Backend: Node.js, Express, SQLite (via better-sqlite3).



IA: Google Generative AI SDK.



📄 Licença



Este projeto está sob a licença MIT. Por estar em fase inicial, sinta-se à vontade para contribuir com sugestões e melhorias.

