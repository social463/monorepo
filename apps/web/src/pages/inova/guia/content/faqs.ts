import type { FaqItem } from "./types";

// Fonte: Guia AI First EMR: Seção 13. Respostas mantidas fiéis ao guia.

export const faqs: FaqItem[] = [
  {
    id: "faq-substituir",
    question: "A IA vai substituir meu trabalho?",
    category: "Trabalho e carreira",
    answer: [
      "A IA não substitui automaticamente uma profissão, mas já está transformando a forma como muitas atividades são realizadas. Tarefas repetitivas, operacionais e que seguem padrões tendem a ser cada vez mais apoiadas ou automatizadas pela tecnologia.",
      "Na EMR, queremos utilizar a IA para ampliar a capacidade das pessoas, reduzir retrabalho e liberar tempo para atividades que exigem contexto, julgamento, criatividade, estratégia, cuidado e relacionamento.",
      "Nosso objetivo não é substituir pessoas, mas construir uma organização em que pessoas e tecnologia trabalhem melhor juntas.",
    ],
    tags: ["carreira", "emprego", "substituir"],
  },
  {
    id: "faq-ficar-para-tras",
    question: "Se eu não usar IA, vou ficar para trás?",
    category: "Trabalho e carreira",
    answer: [
      "A capacidade de utilizar IA de forma responsável já está se tornando uma competência importante no mercado de trabalho, inclusive em funções que não são de tecnologia. No Brasil, a fluência em IA apareceu como a habilidade que mais cresce no levantamento Skills on the Rise 2025, do LinkedIn.",
      "Na EMR, desenvolver essa fluência também fará parte da nossa evolução profissional. Isso não significa que todos precisam se tornar especialistas ou aprender tudo de uma vez. Significa estar aberto para experimentar, aprender e incorporar a IA de forma consciente à própria rotina.",
      "O mais importante é começar: escolha uma atividade simples, teste, valide o resultado e evolua aos poucos.",
    ],
    tags: ["carreira", "fluência"],
  },
  {
    id: "faq-promocao",
    question: "A IA vai decidir quem é promovido?",
    category: "Trabalho e carreira",
    answer: [
      "Não. Decisões sobre promoção, mérito, avaliação de desempenho, movimentação ou desligamento continuam sendo humanas.",
      "A IA pode apoiar a organização de informações, identificar dados que precisam ser analisados ou ajudar a preparar uma discussão. Porém, ela não conhece sozinha todo o contexto, a trajetória, as relações, os impactos e as particularidades envolvidas em uma decisão sobre pessoas.",
      "A análise, a calibração e a decisão final continuam sendo responsabilidade das lideranças e das instâncias definidas pela EMR.",
    ],
    tags: ["promoção", "pessoas", "decisão"],
  },
  {
    id: "faq-especialista",
    question: "Preciso ser especialista em tecnologia para utilizar IA?",
    category: "Trabalho e carreira",
    answer: [
      "Não. A cultura AI First é para todas as pessoas da EMR, independentemente da área, do cargo ou do nível de conhecimento técnico.",
      "Você pode começar utilizando a IA para atividades simples, como organizar ideias, estruturar um texto, preparar uma reunião, aprender um assunto novo ou revisar uma entrega.",
      "A fluência é desenvolvida com prática, senso crítico e curiosidade, não apenas com conhecimento técnico.",
    ],
    tags: ["iniciante", "técnico"],
  },
  {
    id: "faq-avaliacao-desempenho",
    question: "O que muda na minha Avaliação de Desempenho?",
    category: "Trabalho e carreira",
    answer: [
      "A cultura AI First não será avaliada apenas pela quantidade de ferramentas ou agentes que uma pessoa utiliza. O mais importante será observar como ela incorpora os comportamentos esperados: abertura para aprender, experimentação responsável, senso crítico, melhoria contínua, colaboração, compartilhamento de conhecimento e responsabilidade pelas entregas.",
      "A utilização responsável da IA fará parte das conversas de desenvolvimento e dos processos de Avaliação de Desempenho.",
      "Não se espera domínio imediato. Espera-se evolução, disposição para aprender e aplicação consciente na rotina.",
    ],
    tags: ["avaliação", "desempenho"],
  },
  {
    id: "faq-confiar",
    question: "Posso confiar totalmente nas respostas da IA?",
    category: "Confiança na IA",
    answer: [
      "Não. A IA pode produzir respostas incorretas, incompletas, desatualizadas ou inventadas, mesmo utilizando uma linguagem muito convincente.",
      "Por isso, utilize a resposta como ponto de partida, e não como verdade automática. Verifique fatos, datas, números, referências e informações importantes em fontes confiáveis.",
      "Quanto maior o impacto da entrega ou da decisão, maior deve ser o cuidado na validação.",
    ],
    tags: ["alucinação", "validação"],
  },
  {
    id: "faq-discordar",
    question: "E se a IA discordar de mim?",
    category: "Confiança na IA",
    answer: [
      "A discordância pode ser útil. Ela pode revelar uma perspectiva que você ainda não considerou, mas não significa que a IA esteja certa ou que você esteja errado.",
      "Analise os argumentos, verifique as fontes, considere o contexto e, quando necessário, converse com alguém que tenha conhecimento sobre o tema.",
      "A IA amplia o repertório. O julgamento final continua sendo humano.",
    ],
    tags: ["senso crítico"],
  },
  {
    id: "faq-reutilizar",
    question: "Posso utilizar a mesma resposta para situações diferentes?",
    category: "Uso diário",
    answer: [
      "Geralmente, não sem ajustes. Mesmo quando as situações parecem semelhantes, podem existir diferenças de contexto, público, momento, objetivo e impacto. Copiar e utilizar uma resposta sem revisão é um dos principais riscos no uso da IA.",
      "Antes de reutilizar, pergunte: essa resposta se aplica realmente a esta situação? O contexto continua o mesmo? O tom está adequado? Existe alguma informação que precisa ser atualizada? Estou confortável em assumir esta entrega como minha?",
    ],
    tags: ["copiar", "contexto"],
  },
  {
    id: "faq-avisar",
    question: "Preciso avisar toda vez que utilizar IA?",
    category: "Uso diário",
    answer: [
      "Não é necessário avisar sobre cada uso simples da rotina. A transparência deve ser natural e proporcional à relevância da participação da IA.",
      "Informe quando ela tiver contribuído de forma material para uma entrega importante, uma análise, uma recomendação ou um conteúdo que leva o seu nome.",
      "A transparência não reduz o valor da sua entrega. Ela demonstra responsabilidade sobre o processo.",
    ],
    tags: ["transparência"],
  },
  {
    id: "faq-ferramentas",
    question: "Que ferramentas de IA posso utilizar?",
    category: "Segurança",
    answer: [
      "Utilize somente ferramentas homologadas pela EMR e dentro das condições definidas para cada uma delas.",
      "A homologação não significa que qualquer informação pode ser inserida na ferramenta. Mesmo em ambientes autorizados, é necessário respeitar regras de segurança, necessidade de uso, confidencialidade e proteção de dados.",
      "Em caso de dúvida, procure sua liderança, Gente & Gestão ou o time de Tecnologia/Engenharia.",
    ],
    tags: ["ferramentas", "homologação"],
  },
  {
    id: "faq-dados-alunos",
    question: "Posso colocar dados de alunos em ferramentas de IA?",
    category: "Segurança",
    answer: [
      "Não utilize dados de alunos apenas porque uma ferramenta está homologada.",
      "Dados pessoais ou sigilosos somente poderão ser utilizados quando houver um processo específico autorizado pela EMR, uma finalidade legítima e uma ferramenta aprovada para aquela utilização. Sempre que possível e aplicável, os dados devem ser anonimizados e limitados ao mínimo necessário.",
      "Na dúvida, não compartilhe a informação antes de consultar Tecnologia/Engenharia ou Gente & Gestão.",
    ],
    tags: ["dados", "alunos", "LGPD"],
  },
  {
    id: "faq-feedback-dificil",
    question: "Posso utilizar IA para preparar um feedback difícil?",
    category: "Ética",
    answer: [
      "Sim. A IA pode ajudar a organizar fatos, separar percepções de comportamentos observáveis, revisar o tom, sugerir perguntas e preparar possíveis caminhos para a conversa.",
      "Porém, não deve escrever um feedback genérico para ser simplesmente copiado e enviado. A conversa precisa ser conduzida pela liderança, com contexto, escuta, respeito e empatia reais.",
      "A IA pode ajudar na preparação. A relação e a responsabilidade pelo feedback continuam humanas.",
    ],
    tags: ["feedback", "ética"],
  },
  {
    id: "faq-uso-inadequado",
    question: "O que acontece se eu utilizar IA de forma inadequada?",
    category: "Ética",
    answer: [
      "Cada situação será analisada considerando o contexto, o impacto, a intencionalidade e os riscos envolvidos.",
      "Quando houver dúvida, dificuldade ou erro sem intenção, o primeiro movimento deve ser orientar, corrigir e fortalecer o aprendizado. Quando houver compartilhamento indevido de dados ou algum risco de segurança, é fundamental comunicar imediatamente para que a empresa possa avaliar e conter o impacto.",
      "Usos intencionais, recorrentes ou contrários às orientações da empresa serão tratados com a seriedade aplicável a qualquer comportamento que viole nossas políticas e nossa cultura. O mais importante é não esconder um erro.",
    ],
    tags: ["erro", "incidente"],
  },
  {
    id: "faq-pedir-ajuda",
    question: "Quando devo pedir ajuda antes de utilizar IA?",
    category: "Ética",
    answer: [
      "Procure orientação sempre que a situação envolver: dados pessoais, confidenciais ou estratégicos; decisões sobre pessoas; contratos ou temas jurídicos; conflito ou questão ética; impacto financeiro ou reputacional relevante; comunicação institucional ou externa sensível; qualquer situação em que você não se sinta seguro para decidir sozinho.",
      "Pedir ajuda não significa falta de autonomia. Significa reconhecer o risco e agir com responsabilidade.",
    ],
    tags: ["ajuda", "risco"],
  },
  {
    id: "faq-prompt",
    question: "Como faço um bom prompt?",
    category: "Aprendizado",
    answer: [
      "Comece explicando com clareza: o que você precisa; qual é o objetivo; quem receberá o resultado (público); qual contexto a IA precisa conhecer; qual o tom a ser utilizado; qual formato espera; quais critérios ou limites devem ser respeitados.",
      "Quanto melhor for o contexto permitido, mais útil tende a ser a resposta. Porém, nunca inclua dados pessoais, informações sigilosas ou conteúdos não autorizados apenas para obter uma resposta mais completa.",
      "Um bom prompt ajuda. Uma boa validação continua sendo indispensável.",
    ],
    tags: ["prompt", "contexto"],
  },
  {
    id: "faq-comecar",
    question: "Por onde eu começo?",
    category: "Aprendizado",
    answer: [
      "Comece por uma atividade real e simples da sua rotina: organizar uma pauta, resumir um documento, estruturar um e-mail, aprender um assunto ou revisar uma apresentação.",
      "Escolha um exercício da seção Exercícios para Desenvolver AI First, teste durante a semana e compare o processo antes e depois: a entrega ficou melhor? Você ganhou tempo? Aprendeu alguma coisa? O resultado exigiu muitos ajustes? Esse uso pode se tornar parte da sua rotina?",
      "A cultura AI First se desenvolve pela prática consistente, não pela pressa.",
    ],
    tags: ["começar", "prática"],
  },
  {
    id: "faq-evoluindo",
    question: "Como sei se estou evoluindo?",
    category: "Aprendizado",
    answer: [
      "Evoluir não significa apenas utilizar IA com mais frequência. Significa utilizá-la melhor.",
      "Sinais de evolução: você identifica com mais clareza quando a IA pode ajudar; estrutura prompts melhores; valida as respostas com mais senso crítico; consegue diferenciar quando deve recorrer a uma pessoa; reduz tempo gasto em atividades repetitivas; melhora a qualidade das entregas; compartilha aprendizados; transforma soluções pontuais em práticas reutilizáveis.",
    ],
    tags: ["maturidade", "evolução"],
  },
  {
    id: "faq-aprender",
    question: "Posso usar IA para me ajudar a aprender algo novo?",
    category: "Aprendizado",
    answer: [
      "Sim, e é um dos usos mais valiosos, peça explicações, exemplos e até pequenos testes para checar seu entendimento.",
    ],
    tags: ["aprender"],
  },
  {
    id: "faq-colegas",
    question: "Usar IA significa deixar de procurar meus colegas?",
    category: "Liderança",
    answer: [
      "Não. AI First não significa trabalhar de forma isolada ou substituir a colaboração.",
      "A IA pode ajudar a responder dúvidas iniciais, organizar pensamentos e ampliar repertório antes de envolver outra pessoa. Isso torna as conversas mais produtivas e reduz dependências desnecessárias.",
      "Situações que exigem contexto, alinhamento, experiência, construção conjunta ou relacionamento continuam dependendo das pessoas. AI First não muda quem decide. Muda quem ajuda primeiro.",
    ],
    tags: ["colaboração"],
  },
  {
    id: "faq-papel-lideranca",
    question: "Qual é o papel da liderança nessa transformação?",
    category: "Liderança",
    answer: [
      "A liderança deve utilizar IA na própria rotina, liderar pelo exemplo e criar espaço para que o time experimente e aprenda.",
      "Antes de entregar imediatamente uma resposta, pode estimular a autonomia com perguntas como: “Você já consultou a IA?”, “Como estruturou o seu prompt?”, “O que ela respondeu?”, “O que você validou?”, “Que parte ainda depende de nós?”.",
      "Isso não significa se afastar ou deixar o colaborador sem apoio. Situações envolvendo pessoas, decisões estratégicas, riscos, conflitos ou falta de contexto exigem a presença e a responsabilidade da liderança.",
    ],
    tags: ["liderança", "autonomia"],
  },
  {
    id: "faq-duvidas-guia",
    question: "Com quem posso tirar dúvidas sobre este guia?",
    category: "Liderança",
    answer: [
      "Para dúvidas sobre como aplicar o AI First na sua rotina, converse primeiro com sua liderança ou com Gente & Gestão.",
      "Para questões relacionadas a ferramentas, acessos, segurança da informação ou tratamento de dados, procure também Tecnologia/Engenharia e os canais oficiais definidos pela EMR.",
    ],
    tags: ["ajuda", "canais"],
  },
];

export const faqById = (id: string) => faqs.find((f) => f.id === id);
export const faqCategories = Array.from(new Set(faqs.map((f) => f.category)));
