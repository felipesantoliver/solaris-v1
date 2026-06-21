// Conteúdo estático do "Manual do Agente". Cada tópico tem título, descrição
// curta (usada também na busca) e um corpo em parágrafos. Pensado para ser
// fácil de atualizar no futuro — basta editar/adicionar objetos aqui, sem
// tocar em nenhum componente.
export const MANUAL_TOPICS = [
  {
    id: 'projetos',
    title: 'Projetos',
    description: 'O que são projetos e como organizam suas conversas, memórias e arquivos.',
    body: [
      'Um projeto é um espaço de trabalho isolado dentro do Solaris. Cada projeto tem seu próprio nome, objetivo, resumo, tags, personalidade, modelo preferido, modo de memória, histórico de conversas, fontes externas e arquivos.',
      'Tudo o que acontece dentro de um projeto fica isolado dos demais: memórias, contexto e fontes de um projeto nunca vazam para outro, nem para os chats avulsos (fora de qualquer projeto).',
      'Você pode criar quantos projetos quiser pela barra lateral ("Novo projeto") ou pela tela de Projetos, e mover conversas existentes para dentro ou fora de um projeto a qualquer momento.',
    ],
  },
  {
    id: 'memoria',
    title: 'Memória',
    description: 'Como funciona a memória automática e os escopos por projeto ou global.',
    body: [
      'Depois de cada resposta do assistente, o sistema analisa o texto em busca de informações relevantes (decisões, preferências, regras, tecnologias) e salva isso como memória — sem que você precise pedir.',
      'O escopo da memória depende de onde a conversa acontece: dentro de um projeto, as memórias ficam exclusivas daquele projeto; fora de um projeto, ficam vinculadas apenas ao chat avulso em questão.',
      'Cada projeto também pode definir seu próprio modo de memória: "projeto" (isolada), "global" (compartilhada entre todos os projetos do usuário) ou "nenhuma" (memória desativada).',
      'Memórias duplicadas ou muito parecidas são filtradas automaticamente antes de serem salvas, e o sistema seleciona dinamicamente quais memórias e mensagens anteriores entram em cada resposta, para não desperdiçar contexto.',
    ],
  },
  {
    id: 'rag',
    title: 'RAG (arquivos e fontes)',
    description: 'Como funciona a busca semântica sobre arquivos enviados e fontes externas.',
    body: [
      'RAG (Retrieval-Augmented Generation) é a busca semântica que o Solaris faz sobre os arquivos e fontes de um projeto para trazer informações relevantes para dentro da conversa.',
      'Você pode enviar arquivos (PDF, TXT, CSV e outros formatos de texto) ou adicionar fontes externas — URLs ou blocos de texto livre — como base de conhecimento de um projeto.',
      'O conteúdo enviado é extraído, dividido em pedaços menores (chunks) e transformado em vetores numéricos (embeddings). Quando você faz uma pergunta, o sistema busca os pedaços mais parecidos com a sua pergunta e os usa para montar uma resposta mais precisa.',
      'Uma limitação atual: o RAG indexa arquivos e fontes externas, mas não indexa o histórico de conversas antigas — ou seja, o assistente não consegue buscar diretamente em mensagens passadas, apenas no que já foi resumido como memória.',
    ],
  },
  {
    id: 'modos',
    title: 'Modos Flash e Pro',
    description: 'A diferença entre o modo rápido (Flash) e o modo avançado (Pro).',
    body: [
      'O Flash é o modo de resposta rápido e direto, ideal para perguntas do dia a dia e tarefas simples.',
      'O Pro é um modo mais avançado: a pergunta passa por um pré-processamento e é refinada em etapas antes da resposta final, o que resulta em respostas mais precisas e aprofundadas. O modo Pro também pode realizar buscas na internet para trazer informações atualizadas.',
      'O modo Pro está disponível apenas para usuários autenticados — no modo convidado, somente o Flash fica habilitado. Você pode trocar de modo a qualquer momento, por projeto ou por conversa.',
    ],
  },
  {
    id: 'agente',
    title: 'Modo Agente',
    description: 'Ferramentas autônomas: busca RAG, sandbox de execução de código e mais.',
    body: [
      'O Modo Agente Autônomo é ativado pelo botão "Agente" ao lado do botão "Programação", no campo de mensagem.',
      'Quando ativado, a mensagem passa a rodar em um loop de decisão: a cada rodada, o modelo escolhe se chama uma ferramenta — busca em arquivos do projeto (RAG), execução de código em sandbox isolado, ou busca na internet — ou se já tem informação suficiente para responder.',
      'Cada decisão do agente aparece como uma etapa em tempo real na conversa: raciocínio, chamada de ferramenta, resultado e resposta final.',
      'A execução de código acontece em um ambiente isolado (sandbox), com tempo e memória limitados, e passa por validação antes de rodar — por segurança, apenas um conjunto definido de bibliotecas é permitido.',
    ],
  },
];