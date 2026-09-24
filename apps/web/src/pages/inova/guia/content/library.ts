import type { AreaId, ExerciseItem, PathId } from "./types";

// Fonte: Guia AI First EMR (2ª edição). Nada aqui é inventado.

export const paths: Record<
  PathId,
  { id: PathId; label: string; short: string; message: string; when: string; examples: string; accent: string }
> = {
  ia: {
    id: "ia",
    label: "Comece pela IA",
    short: "IA primeiro",
    message:
      "A IA pode ser o seu primeiro apoio. Use-a para ampliar repertório, organizar, pesquisar, estruturar ou criar uma primeira versão. Depois revise e assuma a entrega.",
    when: "Baixo risco e o resultado passa pela sua revisão. A IA te dá o ponto de partida; você ajusta e assina.",
    examples:
      "Rascunhar um e-mail, resumir, pesquisar, organizar ideias, estruturar uma reunião ou apresentação.",
    accent: "approved",
  },
  "ia-pessoa": {
    id: "ia-pessoa",
    label: "IA + inteligência humana",
    short: "IA + pessoa",
    message:
      "Use a IA para ampliar a análise e explorar possibilidades. Contexto, interpretação e decisão continuam humanos.",
    when: "Impacto médio ou dependência de contexto que a IA não tem. A IA levanta opções; você (e às vezes um colega) valida e decide.",
    examples:
      "Analisar uma planilha, planejar um projeto, preparar uma decisão, analisar capacidade antes de pedir headcount.",
    accent: "azul",
  },
  pessoa: {
    id: "pessoa",
    label: "Pessoa primeiro",
    short: "Pessoa primeiro",
    message:
      "Esta situação exige presença humana desde o início. A IA pode apoiar a preparação, mas não substitui diálogo, julgamento, cuidado ou decisão.",
    when: "Envolve gente, relação, conflito, ética ou uma decisão relevante. A IA, no máximo, ajuda você a se preparar depois.",
    examples: "Feedback, negociação, avaliação, promoção, mérito, desligamento, conflito, estratégia sensível.",
    accent: "coral",
  },
};

export const GOLDEN_RULE =
  "Quanto mais a decisão afeta a vida ou a carreira de uma pessoa, maior deve ser a presença humana. Na dúvida, aumente o nível de participação humana.";

export const areas: { id: AreaId; name: string; help: string; examples: string; human: string }[] = [
  {
    id: "gente-gestao",
    name: "Gente & Gestão",
    help: "Apoiar conversas de carreira, triagem de currículos e comunicação interna.",
    examples: "Roteiros de 1:1 e PDI, descrições de vaga, comunicados, pesquisas de clima.",
    human: "Decisões sobre pessoas, devolutivas, calibração e cuidado com dados pessoais.",
  },
  {
    id: "marketing",
    name: "Marketing",
    help: "Gerar variações de conteúdo, analisar campanhas e acelerar produção criativa.",
    examples: "Textos para redes, roteiros de vídeo, análise de performance.",
    human: "Posicionamento institucional, sensibilidade de marca e validação de dados.",
  },
  {
    id: "produto",
    name: "Produto",
    help: "Sintetizar feedback de usuários e acelerar documentação.",
    examples: "Análise de pesquisas, especificações, roadmaps.",
    human: "Priorização, trade-offs e decisão sobre o que entra no roadmap.",
  },
  {
    id: "tecnologia",
    name: "Tecnologia",
    help: "Apoiar geração e revisão de código, documentação técnica e testes.",
    examples: "Rascunhos de código, revisão de PRs, documentação de APIs.",
    human: "Arquitetura, segurança, revisão final e responsabilidade pelo que vai para produção.",
  },
  {
    id: "financeiro",
    name: "Financeiro",
    help: "Organizar e analisar grandes volumes de dados financeiros.",
    examples: "Conciliações, análise de fluxo de caixa, relatórios gerenciais.",
    human: "Conferência de cálculos, premissas e decisões de investimento.",
  },
  {
    id: "comercial",
    name: "Comercial",
    help: "Preparar abordagens, qualificar leads e apoiar negociações.",
    examples: "Roteiros de venda, respostas a objeções, resumos de cliente.",
    human: "A negociação em si, a leitura de sinais e o compromisso dentro da alçada.",
  },
  {
    id: "cx",
    name: "CX",
    help: "Agilizar respostas mantendo o cuidado humano com o aluno.",
    examples: "Rascunhos de resposta, triagem de dúvidas, base de conhecimento.",
    human: "Empatia, exceções, reclamações e a relação com quem confia na EMR.",
  },
  {
    id: "ensino",
    name: "Ensino",
    help: "Apoiar a produção e o aprimoramento de conteúdos educacionais.",
    examples: "Elaboração de questões, revisão de materiais, estruturação de aulas.",
    human: "Correção técnica, qualidade pedagógica e validação por especialistas.",
  },
  {
    id: "operacoes",
    name: "Operações",
    help: "Organizar processos, identificar gargalos e documentar rotinas.",
    examples: "Mapeamento de processos, checklists, relatórios de eficiência.",
    human: "Confirmar como o processo realmente funciona com quem o executa.",
  },
];

export const areaName = (id: AreaId) =>
  id === "todas" ? "Todas as áreas" : (areas.find((a) => a.id === id)?.name ?? "Todas as áreas");

export const cycleSteps = [
  { n: 1, title: "Defina o objetivo", detail: "Tenha clareza sobre o resultado, o público, o prazo e os critérios de qualidade." },
  { n: 2, title: "Pergunte para a IA", detail: "Transforme o objetivo em uma instrução clara e compartilhe somente o contexto autorizado." },
  { n: 3, title: "Analise criticamente", detail: "Verifique se a resposta faz sentido, está correta e se aplica à situação." },
  { n: 4, title: "Ajuste", detail: "Refine o prompt, peça exemplos, explore alternativas e corrija premissas." },
  { n: 5, title: "Faça a validação humana", detail: "Confirme fatos, dados, ética, segurança, tom, contexto e impactos." },
  { n: 6, title: "Entregue", detail: "Utilize ou compartilhe o resultado somente quando estiver confortável em assumir a responsabilidade." },
  { n: 7, title: "Compartilhe o aprendizado", detail: "Quando houver valor reutilizável, registre o prompt, solução, resultado ou aprendizado para o time." },
];

export const deliveryChecklist = [
  "Avaliei se e como a IA poderia contribuir para esta entrega, considerando a Bússola de Decisão?",
  "Se pode contribuir, consultei a IA antes de iniciar?",
  "Revisei criticamente a resposta?",
  "Validei os fatos, dados e números importantes?",
  "Adaptei o resultado ao contexto da EMR e da situação específica?",
  "Fui transparente sobre o uso de IA, quando relevante?",
  "Considerei se essa entrega envolve pessoas e precisa de cuidado redobrado?",
  "Estou confortável em assinar essa entrega como minha?",
];

export const maturityLevels = [
  {
    level: 1,
    name: "Descobrindo",
    description: "Ainda conhecendo o que a IA pode fazer. Usa ocasionalmente, com curiosidade, para tarefas simples.",
    strengths: "Curiosidade e abertura para experimentar.",
    nextStep: "Escolha uma tarefa recorrente e simples da sua semana e faça-a em parceria com a IA.",
    actions: [
      "Use a IA para resumir um documento que você leria hoje.",
      "Peça uma explicação progressiva de um tema do seu trabalho.",
      "Anote o que funcionou e o que não funcionou.",
    ],
    exerciseId: "ex-mapear-rotina",
    videoId: "vid-consultou-ia",
  },
  {
    level: 2,
    name: "Experimentando",
    description: "Testa a IA em diferentes situações, sem um padrão definido. Começa a perceber onde ela ajuda mais.",
    strengths: "Disposição para testar em contextos diferentes.",
    nextStep: "Comece a repetir o que já deu certo: transforme um bom uso em hábito semanal.",
    actions: [
      "Refine o mesmo prompt três vezes e compare as respostas.",
      "Use a Bússola antes de uma tarefa relevante.",
      "Compartilhe um aprendizado com o time.",
    ],
    exerciseId: "ex-pratica-prompt",
    videoId: "vid-copiar-colar",
  },
  {
    level: 3,
    name: "Utilizando frequentemente",
    description: "Já incorporou a IA em tarefas do dia a dia. Aplica o ciclo AI First na maior parte das vezes.",
    strengths: "Consistência e ganho real de tempo.",
    nextStep: "Suba o nível da validação: fatos, dados e contexto antes de entregar.",
    actions: [
      "Aplique o checklist AI First em uma entrega importante.",
      "Peça à IA que critique sua própria proposta.",
      "Documente um prompt reutilizável para o time.",
    ],
    exerciseId: "ex-testar-ideia",
    videoId: "vid-planilha",
  },
  {
    level: 4,
    name: "Colaborando com IA",
    description: "Usa a IA como parceira de raciocínio, pede críticas, gera hipóteses, explora ideias antes de decidir.",
    strengths: "Senso crítico e uso da IA para pensar melhor, não só produzir mais.",
    nextStep: "Transforme soluções pontuais em práticas reutilizáveis para a sua área.",
    actions: [
      "Gere hipóteses antes de concluir sobre um dado.",
      "Registre uma vitória rápida como case.",
      "Ajude um colega a melhorar um prompt.",
    ],
    exerciseId: "ex-hipoteses",
    videoId: "vid-headcount",
  },
  {
    level: 5,
    name: "AI First",
    description:
      "Pergunta “como a IA pode ajudar” antes de qualquer tarefa relevante, por hábito. Compartilha aprendizados e ajuda outras pessoas a evoluir.",
    strengths: "Prática consistente, responsabilidade e multiplicação do conhecimento.",
    nextStep: "Escale: leve o que funciona na sua área para outras áreas.",
    actions: [
      "Registre um case com potencial de escala.",
      "Apresente um aprendizado na Comunidade AI First.",
      "Apoie alguém que está começando.",
    ],
    exerciseId: "ex-diario",
    videoId: "vid-colega-lideranca",
  },
];

export const maturityQuestions = [
  "Antes de iniciar uma tarefa relevante, você se pergunta como a IA poderia contribuir?",
  "Você usa a IA para criar uma primeira versão de textos, pautas ou estruturas?",
  "Você refina o prompt quando a primeira resposta não é boa?",
  "Você confere fatos, dados e números antes de assumir uma resposta como verdadeira?",
  "Você adapta o resultado ao contexto da EMR em vez de copiar e colar?",
  "Você identifica com clareza quando deve procurar uma pessoa antes da IA?",
  "Você usa a IA como parceira de raciocínio (crítica, hipóteses, contrapontos)?",
  "Você protege informações sensíveis e usa apenas ferramentas homologadas?",
  "Você compartilha prompts e aprendizados com o time?",
  "Você transforma usos pontuais em práticas reutilizáveis?",
];

export const maturityScale = [
  { value: 1, label: "Nunca" },
  { value: 2, label: "Raramente" },
  { value: 3, label: "Às vezes" },
  { value: 4, label: "Frequentemente" },
  { value: 5, label: "Já faz parte da minha rotina" },
];

export const behaviorsDo = [
  "Avaliar se e como a IA pode contribuir para tarefas relevantes, usando a Bússola de Decisão.",
  "Validar criticamente, checar fatos, dados e números antes de assumir como verdade.",
  "Adaptar ao contexto da EMR e da situação, em vez de copiar e colar.",
  "Proteger informações, usar só ferramentas homologadas.",
  "Experimentar, testar prompts, abordagens e ferramentas homologadas.",
  "Compartilhar aprendizados com o time.",
  "Assumir a responsabilidade pela entrega.",
  "Pedir ajuda quando necessário, a um colega ou à liderança.",
];

export const behaviorsDont = [
  "Copiar respostas sem revisar.",
  "Transferir decisões para a IA, especialmente decisões sobre pessoas.",
  "Expor dados sensíveis em ferramentas não homologadas.",
  "Usar a IA para evitar conversas difíceis, feedback, conflito e negociação são humanos.",
  "Tratar tudo que a IA responde como verdade.",
  "Usar a IA para se eximir da responsabilidade, “foi a IA” nunca é uma resposta.",
];

export const behaviorQuiz = [
  {
    id: "q1",
    scenario:
      "Você pede à IA um texto de feedback, copia e envia por mensagem para a pessoa, sem conversar.",
    isAiFirst: false,
    explanation:
      "Feedback é pessoa primeiro. A IA pode ajudar a organizar fatos e perguntas, mas a conversa precisa de presença, escuta e empatia reais.",
  },
  {
    id: "q2",
    scenario:
      "Antes de montar uma apresentação, você pede à IA um roteiro, ajusta a mensagem central e valida os dados na fonte.",
    isAiFirst: true,
    explanation: "A IA entra antes, como ponto de partida, e você continua no controle do resultado final.",
  },
  {
    id: "q3",
    scenario:
      "Para agilizar, você cola a planilha com nomes e CPFs de alunos em uma ferramenta que você mesmo escolheu.",
    isAiFirst: false,
    explanation:
      "Dados pessoais só em processo autorizado, ferramenta aprovada e com o mínimo de dados necessário. Na dúvida, não compartilhe.",
  },
  {
    id: "q4",
    scenario:
      "A IA te dá uma resposta convincente sobre um número do trimestre. Você confere na fonte oficial antes de usar.",
    isAiFirst: true,
    explanation: "Validar também é trabalhar com IA. Quanto maior o impacto, maior o cuidado na validação.",
  },
  {
    id: "q5",
    scenario:
      "Sua liderança pergunta como você chegou a uma recomendação e você responde: “foi a IA que sugeriu”.",
    isAiFirst: false,
    explanation: "“Foi a IA” nunca é uma resposta. A decisão final tem sempre um nome humano por trás.",
  },
  {
    id: "q6",
    scenario:
      "Você encontrou um prompt que economiza uma hora por semana e registrou para o time reutilizar.",
    isAiFirst: true,
    explanation: "Compartilhar aprendizado também é AI First. Vitórias rápidas contam.",
  },
];

export const leadershipBlocks = [
  { title: "Liderar pelo exemplo", detail: "Usar IA na própria rotina. Ninguém segue quem não pratica." },
  { title: "Desenvolver autonomia", detail: "Estimular com perguntas, não com respostas prontas." },
  { title: "Criar espaço para experimentar", detail: "Experimentação em pequena escala e aprendizagem com segurança." },
  { title: "Remover barreiras", detail: "Priorizar oportunidades relevantes para a área e destravar o time." },
  { title: "Acompanhar resultados", detail: "Olhar impacto, não apenas quantidade de usos ou agentes criados." },
  { title: "Reconhecer vitórias rápidas", detail: "Dar visibilidade e transformar experimentos em aprendizado do time." },
  { title: "Proteger informações", detail: "Reforçar os limites de uso e o uso apenas de ferramentas homologadas." },
  { title: "Assumir decisões humanas", detail: "Decisões estratégicas, humanas e sensíveis continuam sendo da liderança." },
];

export const leadershipQuestions = [
  "Você já consultou a IA?",
  "Como estruturou o prompt?",
  "Que contexto forneceu?",
  "O que ela respondeu?",
  "O que você validou?",
  "Com o que você concorda ou discorda?",
  "Qual parte ainda depende de contexto ou decisão humana?",
];

export const leadershipChecklist = [
  { question: "Estou utilizando IA na minha própria rotina?", evidence: "Exemplos reais e aprendizados compartilhados." },
  { question: "Meu time sabe quando começar pela IA e quando me envolver?", evidence: "Critérios claros e conversas recorrentes." },
  { question: "As soluções estão gerando valor?", evidence: "Indicadores de tempo, qualidade, impacto ou experiência." },
  { question: "Existem riscos ou dados sensíveis?", evidence: "Validação com as áreas responsáveis." },
  { question: "Estou reconhecendo experimentação responsável?", evidence: "Vitórias rápidas visíveis e aprendizados registrados." },
  { question: "Continuo assumindo as decisões que são minhas?", evidence: "Presença ativa em temas humanos, estratégicos e sensíveis." },
];

export const headcountQuestions = [
  "O processo pode ser simplificado? Há etapas que existem só por hábito?",
  "Existem atividades desnecessárias ou retrabalho que dá para eliminar?",
  "Alguma etapa pode ser automatizada ou apoiada por IA?",
  "A IA pode aumentar a capacidade produtiva do time atual?",
  "Já existe uma solução reutilizável em outra área que resolve parte disso?",
  "A necessidade é mesmo de mais pessoas, ou de mais competência, organização ou processo?",
  "Quais atividades continuarão exigindo capacidade, conhecimento e presença humana?",
];

export const securitySemaphore = {
  pode: {
    label: "Pode",
    subtitle: "Conteúdo autorizado em ferramenta homologada.",
    items: ["Textos genéricos, ideias e rascunhos sem dados pessoais, sim, em ferramentas homologadas pela EMR."],
  },
  validacao: {
    label: "Com validação",
    subtitle: "Depende de autorização, finalidade, processo e proteção.",
    items: [
      "Dados de alunos (nome, CPF, notas, contato), somente em processo especificamente autorizado pela EMR, com ferramenta aprovada para essa finalidade e o mínimo de dados necessário. Sempre que possível, anonimizados.",
      "Dados pessoais de colaboradores, não, salvo processo específico validado por Gente & Gestão.",
      "Informações financeiras ou estratégicas não públicas, não, salvo autorização explícita da liderança.",
      "Contratos e documentos jurídicos sigilosos, não, sem validação prévia do Jurídico.",
    ],
  },
  naoPode: {
    label: "Não pode",
    subtitle: "Credenciais e informações não autorizadas.",
    items: ["Senhas, tokens e credenciais de acesso, nunca, em nenhuma hipótese."],
  },
};

export const sensitiveInfo = [
  { title: "Dados pessoais de alunos", detail: "Nome completo, CPF, contato, notas, histórico acadêmico ou financeiro." },
  { title: "Dados pessoais de colaboradores", detail: "Salário, avaliações de desempenho, dados de saúde, informações de contratação ou desligamento." },
  { title: "Informações da empresa", detail: "Métricas não públicas, planos estratégicos, contratos, informações financeiras internas." },
  { title: "Credenciais", detail: "Senhas, tokens de acesso, chaves de API e credenciais de qualquer sistema." },
];

export const securityPractices = [
  "Homologação vem primeiro. Use apenas as ferramentas de IA homologadas pela EMR. Em caso de dúvida, pergunte antes de usar.",
  "Anonimizar é uma camada extra, não um substituto. Remova nomes, CPFs, e-mails e outros identificadores, mas isso não autoriza usar uma ferramenta não homologada.",
  "Reserve um minuto para entender o que a ferramenta faz com o que você envia a ela.",
  "Se não tiver certeza se pode compartilhar uma informação, a resposta mais segura é não compartilhar ainda.",
  "Uma ferramenta homologada hoje pode mudar de status, fique atento às comunicações de Tecnologia e Gente & Gestão.",
];

export const exercises: ExerciseItem[] = [
  { id: "ex-mapear-rotina", title: "Mapeie sua rotina", description: "Pegue uma tarefa que você realiza semanalmente. Identifique quanto tempo ela leva, quais etapas são repetitivas e quais poderiam ser feitas com apoio de IA.", minutes: 20, tags: ["rotina", "tempo"] },
  { id: "ex-revisao-4", title: "Revisão em quatro passos", description: "Escolha um documento e peça para a IA: resumir, reorganizar, melhorar a clareza e encontrar riscos ou inconsistências.", minutes: 15, tags: ["revisão"] },
  { id: "ex-preparar-reuniao", title: "Prepare uma reunião", description: "Antes de uma reunião, peça para a IA sugerir a pauta, perguntas-guia, riscos do tema e as decisões que se espera alcançar.", minutes: 10, tags: ["reunião"] },
  { id: "ex-segunda-opiniao", title: "Segunda opinião", description: "Escolha uma decisão pequena que você tomaria sozinho. Peça a opinião da IA antes, compare com o que você pensava e decida.", minutes: 10, tags: ["decisão"] },
  { id: "ex-traduza", title: "Traduza o complexo", description: "Peça para a IA explicar um tema técnico do seu trabalho para alguém de outra área, em linguagem simples.", minutes: 10, tags: ["comunicação"] },
  { id: "ex-pratica-prompt", title: "Prática de prompt", description: "Escreva um prompt, veja a resposta, refine o prompt três vezes seguidas e compare a evolução das respostas.", minutes: 15, tags: ["prompt"] },
  { id: "ex-testar-ideia", title: "Teste uma ideia", description: "Peça para a IA assumir o papel de crítico e apontar fragilidades em uma ideia ou proposta sua antes de apresentá-la.", minutes: 10, tags: ["crítica"] },
  { id: "ex-brainstorm", title: "Brainstorming ampliado", description: "Use a IA para gerar dez ideias para um desafio real do seu time, mesmo que só duas sejam aproveitáveis.", minutes: 15, tags: ["ideias"] },
  { id: "ex-resumo-relampago", title: "Resumo relâmpago", description: "Peça para a IA resumir um material extenso (artigo, relatório, transcrição) em cinco tópicos principais.", minutes: 10, tags: ["resumo"] },
  { id: "ex-hipoteses", title: "Gere hipóteses", description: "Escolha um dado ou resultado do seu trabalho e peça para a IA sugerir possíveis explicações antes de você concluir sozinho.", minutes: 15, tags: ["dados"] },
  { id: "ex-porque", title: "Pergunte o porquê", description: "Peça para a IA explicar o “porquê” por trás de uma resposta, não só o “que fazer”, e veja o que você aprende com isso.", minutes: 10, tags: ["aprender"] },
  { id: "ex-simular-conversa", title: "Simule uma conversa", description: "Peça para a IA simular perguntas de uma entrevista ou conversa difícil que você vai ter, e pratique suas respostas.", minutes: 20, tags: ["conversa"] },
  { id: "ex-simplificar", title: "Simplifique um processo", description: "Descreva um processo do seu time e peça para a IA sugerir uma versão mais simples ou eficiente dele.", minutes: 20, tags: ["processo"] },
  { id: "ex-comparar", title: "Compare respostas", description: "Compare duas respostas da IA para a mesma pergunta, feitas de formas diferentes, e identifique o que mudou o resultado.", minutes: 10, tags: ["prompt"] },
  { id: "ex-diario", title: "Diário de aprendizagem", description: "Ao final da semana, escreva três coisas que você aprendeu usando IA e compartilhe com o seu time.", minutes: 15, tags: ["compartilhar"] },
];

export const exerciseById = (id: string) => exercises.find((e) => e.id === id);

export const aiRoles = [
  { role: "Pesquisador", when: "Levantar informações e referências", questions: "“O que já existe sobre isso?” “Quais as principais referências?”" },
  { role: "Analista", when: "Interpretar dados e resultados", questions: "“Que padrões você identifica?” “O que foge do esperado?”" },
  { role: "Planejador", when: "Estruturar projetos e cronogramas", questions: "“Como dividir isso em etapas?” “Quais os riscos de prazo?”" },
  { role: "Professor", when: "Aprender um assunto novo do zero", questions: "“Explique como se eu não soubesse nada.” “Dê um exemplo simples.”" },
  { role: "Especialista", when: "Aprofundar em um tema técnico", questions: "“Qual a visão de um especialista em [tema]?”" },
  { role: "Crítico", when: "Testar a solidez de uma ideia", questions: "“Que falhas você encontra?” “O que um cético diria?”" },
  { role: "Revisor", when: "Revisar textos e entregas", questions: "“O que está incorreto, confuso ou incompleto aqui?”" },
  { role: "Redator", when: "Produzir uma primeira versão", questions: "“Escreva uma primeira versão sobre [tema] para [público].”" },
  { role: "Facilitador", when: "Conduzir dinâmicas e reuniões", questions: "“Como estruturar essa dinâmica para o time?”" },
  { role: "Mentor", when: "Refletir sobre carreira e desenvolvimento", questions: "“Que perguntas eu deveria me fazer antes dessa decisão?”" },
  { role: "Coach", when: "Explorar objetivos e planos de ação", questions: "“Me ajude a estruturar um plano para [objetivo].”" },
  { role: "Entrevistador", when: "Preparar ou simular conversas importantes", questions: "“Que perguntas um entrevistador faria sobre [tema]?”" },
  { role: "Consultor", when: "Segunda opinião estratégica", questions: "“Se você fosse consultor da EMR, o que recomendaria?”" },
];

export const glossary = [
  { term: "Prompt", meaning: "O pedido ou pergunta que você escreve para a IA. Quanto mais claro e contextualizado, melhor a resposta." },
  { term: "LLM", meaning: "“Large Language Model”, a tecnologia por trás de ferramentas como o ChatGPT, treinada com enormes quantidades de texto." },
  { term: "Agente", meaning: "Um papel ou função que a IA assume para te ajudar melhor, como pesquisador, revisor ou mentor." },
  { term: "Copiloto", meaning: "Uma IA que trabalha ao seu lado, apoiando uma tarefa específica, mas sempre sob sua condução." },
  { term: "Alucinação", meaning: "Quando a IA apresenta uma informação incorreta ou inventada como se fosse verdadeira." },
  { term: "Contexto", meaning: "As informações de fundo que você dá à IA para que a resposta seja mais precisa e relevante." },
  { term: "Token", meaning: "A menor unidade de texto que uma IA processa, aproximadamente um pedaço de palavra." },
  { term: "IA Generativa", meaning: "O tipo de IA capaz de criar conteúdo novo, textos, imagens, código, a partir de um pedido." },
  { term: "Automação", meaning: "Um processo que passa a acontecer sem intervenção manual repetida. Costuma seguir regras fixas." },
];

export const convictions = [
  { title: "Pessoas primeiro", detail: "Toda decisão sobre o uso da IA começa por “como isso melhora a experiência das pessoas?”." },
  { title: "A IA amplia a capacidade humana", detail: "Redesenhar tarefas, reduzir o repetitivo e liberar tempo para trabalhos de maior valor." },
  { title: "A responsabilidade continua humana", detail: "A ferramenta sugere; você decide, revisa e assina." },
  { title: "A IA não substitui relacionamento nem ética", detail: "Empatia, escuta e julgamento ético são sempre humanos." },
  { title: "A IA acelera o aprendizado", detail: "Usada bem, vira uma professora particular, se você perguntar o porquê, não só o quê." },
];

export const principles = [
  { title: "Senso crítico", detail: "A IA sugere, você decide. Isso faz sentido? Está certo? Representa bem a EMR?" },
  { title: "Responsabilidade", detail: "Usamos a IA para ampliar capacidade, não para transferir responsabilidades." },
  { title: "Transparência", detail: "Se usou IA para algo importante, comente com naturalidade." },
  { title: "Experimentação e melhoria contínua", detail: "Teste em pequena escala, refine prompts e transforme cada uso em aprendizado." },
  { title: "Colaboração e aprendizagem constante", detail: "Compartilhe prompts e aprendizados. Ninguém precisa desenvolver essa fluência sozinho." },
  { title: "Segurança das informações", detail: "Informações sigilosas só em ferramentas homologadas. Proteger dados é proteger confiança." },
];

export const weeklyChallenge = {
  id: "des-01",
  title: "Desafio AI First da semana",
  text: "Escolha uma tarefa recorrente e identifique o que pode ser eliminado, simplificado, automatizado ou apoiado por IA.",
  instruction:
    "Separe 20 minutos. Descreva a tarefa como ela realmente acontece hoje (não como deveria ser). Depois use o prompt abaixo, valide o resultado com quem executa o processo e escolha uma única mudança para testar nesta semana.",
  promptId: "pr-simplificar-processo",
  exerciseId: "ex-simplificar",
  situationId: "sit-processo",
};

export const weeklyDiscovery = {
  id: "desc-01",
  title: "Você sabia que a IA pode ajudar você a…",
  highlight: "Testar sua proposta antes de apresentá-la.",
  text: "Peça à IA que assuma o papel de crítica: fragilidades, riscos e as perguntas difíceis que podem aparecer na sala.",
  situationId: "sit-testar-ideia",
  promptId: "pr-critico",
};

export const microcopy = [
  "Quem ajuda primeiro?",
  "IA amplia. Você decide.",
  "Uma boa pergunta muda o ponto de partida.",
  "Validar também é trabalhar com IA.",
  "Na dúvida, aumente a presença humana.",
  "Não transfira responsabilidade. Amplie capacidade.",
  "Vitórias rápidas contam.",
  "Compartilhar aprendizado também é AI First.",
  "Você não precisa aprender sozinho.",
  "A IA organiza. Pessoas avaliam. Lideranças decidem.",
  "Proteger dados é proteger pessoas.",
];
