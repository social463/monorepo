/**
 * Semente do catálogo de Aprendizado — só para desenvolvimento.
 *
 * A autoria de curso de verdade é da Central de Cursos (PBI #22272); isto existe
 * para que o catálogo, o player e o certificado tenham o que exercitar em dev.
 */

type SeedLessonType = 'VIDEO' | 'TEXT'
type SeedLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'

interface SeedLesson {
  title: string
  type: SeedLessonType
  contentHtml: string
  durationMinutes: number
  /**
   * Link do vídeo, na forma que se copia do navegador
   * (`youtube.com/watch?v=…`, `youtu.be/…`, `vimeo.com/…`). O player normaliza
   * para a URL embutível — ver `toVideoEmbedUrl` em `@legends/shared`.
   */
  videoUrl?: string
}

interface SeedModule {
  title: string
  lessons: SeedLesson[]
}

interface SeedCourse {
  slug: string
  title: string
  shortDescription: string
  description: string
  category: string
  level: SeedLevel
  competencies: string[]
  objectives: string[]
  instructorName: string
  mandatory: boolean
  modules: SeedModule[]
}

function lesson(
  title: string,
  durationMinutes: number,
  body: string,
  type: SeedLessonType = 'TEXT',
  videoUrl?: string,
): SeedLesson {
  return { title, type, durationMinutes, contentHtml: `<p>${body}</p>`, videoUrl }
}

export const LEARNING_SEED: SeedCourse[] = [
  {
    slug: 'lideranca-na-pratica',
    title: 'Liderança na prática',
    shortDescription: 'Como conduzir 1:1, dar feedback e sustentar combinados com o time.',
    description:
      'Um curso curto e direto sobre o dia a dia de quem lidera: preparar a conversa de 1:1, dar feedback que a pessoa consegue usar e acompanhar o combinado até o fim.',
    category: 'Liderança',
    level: 'INTERMEDIATE',
    competencies: ['Liderança', 'Feedback', 'Comunicação'],
    objectives: [
      'Estruturar uma conversa de 1:1 que gera combinado',
      'Dar feedback específico, sem rodeio e sem ataque',
      'Acompanhar o desenvolvimento do time com evidência',
    ],
    instructorName: 'Time de Gente & Gestão',
    mandatory: false,
    modules: [
      {
        title: 'A conversa de 1:1',
        lessons: [
          lesson('Para que serve o 1:1', 12, 'O 1:1 não é status report. É o espaço da pessoa.'),
          lesson('Preparando a pauta', 15, 'Chegue com três perguntas e saia com um combinado.'),
          lesson('Registrando o combinado', 10, 'O que não vira ação escrita não acontece.'),
        ],
      },
      {
        title: 'Feedback que se usa',
        lessons: [
          lesson('Situação, comportamento, impacto', 18, 'A estrutura que tira o julgamento do feedback.', 'VIDEO'),
          lesson('Feedback de reconhecimento', 12, 'Elogio genérico não ensina nada.'),
          lesson('Quando a conversa é difícil', 20, 'Prepare o fato, não o discurso.'),
        ],
      },
    ],
  },
  {
    slug: 'seguranca-da-informacao',
    title: 'Segurança da informação',
    shortDescription: 'O básico obrigatório: senha, phishing, dado de paciente e LGPD no dia a dia.',
    description:
      'Curso obrigatório para toda a empresa. Cobre os riscos reais do nosso contexto: acesso indevido, phishing e o tratamento de dado pessoal.',
    category: 'Compliance',
    level: 'BEGINNER',
    competencies: ['Segurança', 'LGPD'],
    objectives: [
      'Reconhecer uma tentativa de phishing',
      'Aplicar a política de senha e segundo fator',
      'Saber o que pode e o que não pode com dado pessoal',
    ],
    instructorName: 'Time de TI',
    mandatory: true,
    modules: [
      {
        title: 'Fundamentos',
        lessons: [
          lesson('Por que isso é com você', 10, 'A maior parte dos incidentes começa num clique.'),
          lesson('Senha e segundo fator', 12, 'Gerenciador de senhas e 2FA em tudo que dá.'),
          lesson('Reconhecendo phishing', 15, 'Remetente, urgência e link: os três sinais.', 'VIDEO'),
        ],
      },
      {
        title: 'Dado pessoal na prática',
        lessons: [
          lesson('O que a LGPD pede', 18, 'Finalidade, necessidade e transparência.'),
          lesson('Compartilhamento seguro', 12, 'Link com escopo, nunca anexo solto.'),
        ],
      },
    ],
  },
  {
    slug: 'comunicacao-assertiva',
    title: 'Comunicação assertiva',
    shortDescription: 'Dizer o que precisa ser dito sem atropelar ninguém.',
    description:
      'Como estruturar uma mensagem escrita, conduzir uma reunião curta e discordar sem transformar a conversa em disputa.',
    category: 'Comportamental',
    level: 'BEGINNER',
    competencies: ['Comunicação', 'Colaboração'],
    objectives: ['Escrever mensagens que não precisam de segunda leitura', 'Discordar mantendo a relação'],
    instructorName: 'Time de Gente & Gestão',
    mandatory: false,
    modules: [
      {
        title: 'Escrita no trabalho',
        lessons: [
          lesson('Contexto antes do pedido', 10, 'Quem lê precisa saber por que aquilo chegou.'),
          lesson('Uma mensagem, um assunto', 8, 'Assunto misturado vira resposta pela metade.'),
        ],
      },
      {
        title: 'Conversas difíceis',
        lessons: [
          lesson('Discordar sem competir', 16, 'Ataque o problema, não a pessoa.', 'VIDEO'),
          lesson('Fechando com combinado', 10, 'Toda conversa termina com quem faz o quê até quando.'),
        ],
      },
    ],
  },
  {
    slug: 'inteligencia-artificial-no-dia-a-dia',
    title: 'Inteligência artificial no dia a dia',
    shortDescription: 'Onde a IA ajuda de verdade no seu trabalho — e onde ela atrapalha.',
    description:
      'Uso prático de IA generativa no trabalho: bons prompts, revisão crítica do resultado e o que nunca deve ser colado num modelo.',
    category: 'Inteligência Artificial',
    level: 'INTERMEDIATE',
    competencies: ['Inteligência Artificial', 'Produtividade'],
    objectives: ['Escrever prompts com contexto e critério', 'Revisar criticamente o que a IA devolve'],
    instructorName: 'Time de Produtos',
    mandatory: false,
    modules: [
      {
        title: 'Começando bem',
        lessons: [
          lesson('O que a IA faz bem', 12, 'Rascunho, resumo e reescrita — não decisão.'),
          lesson('Anatomia de um bom prompt', 18, 'Contexto, tarefa, formato e restrição.', 'VIDEO'),
        ],
      },
      {
        title: 'Uso responsável',
        lessons: [
          lesson('O que nunca colar num modelo', 14, 'Dado de paciente, credencial e contrato: nunca.'),
          lesson('Checando o resultado', 12, 'Se você não sabe conferir, não use.'),
        ],
      },
    ],
  },
]

interface SeedTrack {
  title: string
  description: string
  category: string
  competencies: string[]
  courseSlugs: string[]
}

export const LEARNING_TRACKS_SEED: SeedTrack[] = [
  {
    title: 'Primeiros passos como líder',
    description: 'A sequência sugerida para quem acabou de assumir um time.',
    category: 'Liderança',
    competencies: ['Liderança', 'Feedback', 'Comunicação'],
    courseSlugs: ['comunicacao-assertiva', 'lideranca-na-pratica'],
  },
  {
    title: 'Trilha obrigatória de entrada',
    description: 'O que toda pessoa precisa concluir nas primeiras semanas.',
    category: 'Compliance',
    competencies: ['Segurança', 'LGPD'],
    courseSlugs: ['seguranca-da-informacao'],
  },
]
