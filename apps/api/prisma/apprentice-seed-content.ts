import type { ApprenticeActivityKind, ApprenticeActivitySchema } from '@legends/shared'

/**
 * Conteúdo inicial da trilha Eu Aprendiz — os seis encontros e as fichas de
 * cada um, portados do protótipo da G&G (`Trilha EMR.zip`).
 *
 * É SEED, não constante do produto: o painel edita tudo isso sem deploy. O que
 * está aqui é o ponto de partida do primeiro ciclo. Por isso o seed só cria o
 * que ainda não existe — rodar de novo não sobrescreve o que a G&G ajustou.
 *
 * Substitui o "modo demonstração" do protótipo, que ligava dados fictícios em
 * cima do conteúdo real. Aqui não há dado fictício: o conteúdo é o verdadeiro, e
 * o que falta é o que os aprendizes ainda não preencheram.
 */

export interface ApprenticeSeedActivity {
  title: string
  kind: ApprenticeActivityKind
  order: number
  schema: ApprenticeActivitySchema
}

export interface ApprenticeSeedMeeting {
  order: number
  title: string
  theme: string
  objectives: string[]
  deliverable: string
  scheduledOn: string
  activities: ApprenticeSeedActivity[]
}

/** O Cartão do Compromisso do Mês. Existe em todos os encontros, com o mesmo formato. */
const commitmentSchema: ApprenticeActivitySchema = {
  eyebrow: 'Eu Aprendiz',
  subtitle: 'Um compromisso por aprendiz, por encontro.',
  blocks: [
    {
      title: 'Até o próximo encontro, eu vou:',
      highlight: true,
      // `vou` é lido pela ficha de revisão do encontro seguinte
      // (`APPRENTICE_COMMITMENT_FIELD_ID`): renomear aqui quebra a revisão.
      fields: [{ id: 'vou', type: 'texto', rows: 2, required: true }],
    },
    {
      title: 'Vou saber que cumpri quando:',
      fields: [{ id: 'cumpri', type: 'linha', required: true }],
    },
  ],
}

/** A revisão do compromisso do encontro anterior. A partir do segundo encontro. */
const reviewSchema: ApprenticeActivitySchema = {
  eyebrow: 'Revisão do compromisso',
  subtitle: 'O que você tinha combinado fazer até hoje.',
  blocks: [
    {
      title: 'Status do cumprimento',
      highlight: true,
      // `status` é o que o painel conta como taxa de cumprimento
      // (`APPRENTICE_REVIEW_STATUS_FIELD_ID`).
      fields: [
        {
          id: 'status',
          type: 'select',
          options: ['Cumpri totalmente', 'Cumpri parcialmente', 'Não cumpri'],
          required: true,
        },
      ],
    },
    {
      title: 'Dificuldades encontradas',
      fields: [
        {
          id: 'dificuldades',
          type: 'texto',
          rows: 3,
          placeholder: 'Quais foram os principais desafios ou barreiras para cumprir este compromisso?',
          required: true,
        },
      ],
    },
    {
      title: 'Aprendizado / próxima ação',
      fields: [
        {
          id: 'proxima',
          type: 'texto',
          rows: 2,
          placeholder: 'O que você fará de diferente para o próximo período?',
          required: true,
        },
      ],
    },
  ],
}

function withRitual(order: number, activities: ApprenticeSeedActivity[]): ApprenticeSeedActivity[] {
  // Ordem na tela: a revisão abre o encontro (olha para trás), as fichas do dia
  // vêm no meio, e o compromisso fecha (olha para a frente).
  const review: ApprenticeSeedActivity[] =
    order > 1
      ? [{ title: 'Revisão do compromisso anterior', kind: 'REVIEW', order: 0, schema: reviewSchema }]
      : []
  return [
    ...review,
    ...activities,
    { title: 'Meu compromisso do mês', kind: 'COMMITMENT', order: 90, schema: commitmentSchema },
  ]
}

export const APPRENTICE_MEETINGS_SEED: ApprenticeSeedMeeting[] = [
  {
    order: 1,
    title: 'Onde eu estou',
    theme: 'Devolutiva do diagnóstico, mapa de forças e contrato da trilha',
    objectives: [
      'Devolver os resultados do diagnóstico de forma agregada e mostrar, item por item, como cada resposta influenciou o desenho da trilha.',
      'Fazer com que cada aprendiz nomeie o próprio momento profissional, suas forças e a lacuna que quer atacar no ciclo.',
      'Firmar coletivamente o contrato de convivência e o compromisso individual com o ciclo.',
    ],
    deliverable:
      'Mapa de Forças e Metas preenchido, Linha do Tempo desenhada e Contrato da Trilha assinado.',
    scheduledOn: '2026-09-15',
    activities: withRitual(1, [
      {
        title: 'Mapa de Forças e Metas',
        kind: 'ACTIVITY',
        order: 1,
        schema: {
          eyebrow: 'Eu Aprendiz · Encontro 1',
          subtitle: 'Onde eu estou hoje, o que eu já sei fazer e o que eu quero desenvolver.',
          blocks: [
            {
              title: 'Momento profissional',
              fields: [
                {
                  id: 'momento',
                  type: 'texto',
                  rows: 2,
                  placeholder: 'Onde você está hoje no seu setor?',
                  required: true,
                },
              ],
            },
            {
              title: 'Minhas duas forças',
              fields: [
                { id: 'forca1', label: 'Força 1', type: 'linha', required: true },
                { id: 'forca2', label: 'Força 2', type: 'linha', required: true },
              ],
            },
            {
              title: 'A lacuna que quero atacar',
              fields: [
                {
                  id: 'lacuna',
                  type: 'texto',
                  rows: 2,
                  placeholder: 'O que você quer desenvolver nos próximos meses?',
                  required: true,
                },
              ],
            },
            {
              title: 'O que eu espero desta trilha',
              fields: [
                {
                  id: 'espero',
                  type: 'texto',
                  rows: 2,
                  placeholder: 'Escreva em uma ou duas frases.',
                  required: true,
                },
              ],
            },
          ],
        },
      },
      {
        title: 'Linha do Tempo',
        kind: 'ACTIVITY',
        order: 2,
        schema: {
          eyebrow: 'Eu Aprendiz · Encontro 1',
          subtitle: 'Cinco momentos que te trouxeram até aqui — os bons, os difíceis e os de virada.',
          blocks: [
            {
              title: 'Momentos marcantes',
              // Campo `lista`: é o que permitiu a Linha do Tempo virar ficha
              // dinâmica em vez de continuar componente fixo em código.
              fields: [
                {
                  id: 'eventos',
                  type: 'lista',
                  items: 5,
                  required: true,
                  fields: [
                    { id: 'titulo', label: 'Momento marcante', type: 'linha' },
                    {
                      id: 'tipo',
                      label: 'Tipo',
                      type: 'select',
                      options: ['Difícil', 'Bom', 'De virada'],
                    },
                    { id: 'descricao', label: 'O que aconteceu?', type: 'linha' },
                  ],
                },
              ],
            },
            {
              title: 'Reflexão final',
              fields: [
                {
                  id: 'reflexao',
                  type: 'texto',
                  rows: 3,
                  placeholder: 'O que esses momentos dizem sobre você hoje?',
                  required: true,
                },
              ],
            },
          ],
        },
      },
    ]),
  },
  {
    order: 2,
    title: 'Minha voz',
    theme: 'Comunicação profissional e apresentação em público',
    objectives: [
      'Dar uma estrutura simples e reutilizável para organizar qualquer fala profissional.',
      'Fazer cada um falar em público duas vezes no mesmo encontro, com feedback entre as rodadas, para que a evolução seja percebida no próprio dia.',
      'Ensinar a dar feedback estruturado — competência que a turma recebe bem, mas não pratica na direção inversa.',
    ],
    deliverable: 'Pitch pessoal de 60 segundos gravado, em duas versões.',
    scheduledOn: '2026-10-06',
    activities: withRitual(2, [
      {
        title: 'Roteiro do Pitch',
        kind: 'ACTIVITY',
        order: 1,
        schema: {
          eyebrow: 'Eu Aprendiz · Encontro 2',
          subtitle: 'Sessenta segundos, três partes. Escreva em tópicos — texto corrido vira leitura.',
          footer: 'Preencha duas vezes: uma para a rodada 1 e outra para a rodada 2.',
          blocks: [
            { title: 'Rodada', fields: [{ id: 'rodada', label: 'Rodada', type: 'select', options: ['1', '2'] }] },
            {
              number: 1,
              title: 'Contexto',
              time: '15 segundos',
              note: 'Quem eu sou e onde eu atuo. Curto, sem rodeio.',
              fields: [{ id: 'contexto', type: 'linha', placeholder: 'Uma frase', required: true }],
            },
            {
              number: 2,
              title: 'Conteúdo',
              time: '30 segundos',
              note: 'O que eu faço e UM exemplo concreto de entrega. Exemplo, não descrição de rotina.',
              fields: [{ id: 'conteudo', type: 'texto', rows: 3, required: true }],
            },
            {
              number: 3,
              title: 'Chamada',
              time: '15 segundos',
              note: 'O que eu quero construir daqui pra frente. É o que fica na cabeça de quem escuta.',
              fields: [{ id: 'chamada', type: 'texto', rows: 2, required: true }],
            },
            {
              title: 'Feedback que eu recebi',
              highlight: true,
              fields: [
                { id: 'euVi', label: 'Eu vi — o que a pessoa observou', type: 'linha' },
                { id: 'euSugiro', label: 'Eu sugiro — o que eu vou ajustar', type: 'linha' },
              ],
            },
          ],
        },
      },
    ]),
  },
  {
    order: 3,
    title: 'Pensar bem, resolver melhor',
    theme: 'Resolução de problemas e visão de processos',
    objectives: [
      'Entregar um método simples e replicável para atacar problemas: separar fato de interpretação, achar causa, gerar opções e decidir.',
      'Fazer cada aprendiz explicar o próprio setor para quem não o conhece — e resolver o problema de um setor que não é o seu.',
      'Produzir um plano de ação real, aplicável no mês seguinte, que o gestor consiga ver.',
    ],
    deliverable: 'Plano de ação de uma página, com uma ação, um responsável e uma data.',
    scheduledOn: '2026-11-03',
    activities: withRitual(3, [
      {
        title: 'Fato · Causa · Opções · Decisão',
        kind: 'ACTIVITY',
        order: 1,
        schema: {
          eyebrow: 'Eu Aprendiz · Encontro 3',
          subtitle: 'Um problema real por ficha. Sem nome de pessoa, só processo.',
          footer: 'Uma ficha por caso. A decisão é preenchida pelo dono do problema.',
          blocks: [
            {
              title: 'Identificação do caso',
              fields: [
                { id: 'setor', label: 'Setor do caso', type: 'linha' },
                { id: 'dono', label: 'Dono do problema', type: 'linha' },
                { id: 'preenchidaPor', label: 'Preenchida por', type: 'linha' },
              ],
            },
            {
              number: 1,
              title: 'Fato',
              note: 'O que acontece, de forma observável. Sem interpretação e sem culpado.',
              fields: [{ id: 'fato', type: 'texto', rows: 2, required: true }],
            },
            {
              number: 2,
              title: 'Causa',
              note: 'Por que acontece. Aplique os cinco porquês até chegar em algo acionável.',
              fields: [
                { id: 'causa1', label: '1', type: 'linha', required: true },
                { id: 'causa2', label: '2', type: 'linha' },
                { id: 'causa3', label: '3', type: 'linha' },
              ],
            },
            {
              number: 3,
              title: 'Opções',
              note: 'Pelo menos três caminhos possíveis, do mais simples ao mais complexo.',
              fields: [
                { id: 'opcaoA', label: 'A', type: 'linha', required: true },
                { id: 'opcaoB', label: 'B', type: 'linha' },
                { id: 'opcaoC', label: 'C', type: 'linha' },
              ],
            },
            {
              number: 4,
              title: 'Decisão (preenchida só pelo dono do problema)',
              highlight: true,
              fields: [
                { id: 'vouFazer', label: 'O que eu vou fazer', type: 'linha' },
                { id: 'ateQuando', label: 'Até quando', type: 'linha' },
                { id: 'comQuem', label: 'Com quem preciso falar', type: 'linha' },
              ],
            },
          ],
        },
      },
    ]),
  },
  {
    order: 4,
    title: 'Ferramentas que me destacam',
    theme: 'Excel, Inteligência Artificial e produtividade',
    objectives: [
      'Ensinar três recursos de Excel que resolvem problemas reais da rotina dos três setores envolvidos.',
      'Ensinar a construir um bom comando de IA e a checar o resultado, estabelecendo a regra de confidencialidade da EMR.',
      'Fazer cada aprendiz sair com uma rotina do próprio trabalho efetivamente reorganizada ou automatizada.',
    ],
    deliverable: 'Guia de Bolso de IA Responsável assinado e o Desafio 3 em 30 definido.',
    scheduledOn: '2026-12-15',
    activities: withRitual(4, [
      {
        title: 'Guia de Bolso de IA',
        kind: 'ACTIVITY',
        order: 1,
        schema: {
          eyebrow: 'Eu Aprendiz · Encontro 4',
          subtitle:
            'Somos uma empresa de educação médica. O que entra numa ferramenta pública sai do nosso controle.',
          footer: 'O aceite de cada aprendiz fica registrado com nome e data.',
          blocks: [
            {
              title: 'Nunca digite em ferramenta pública',
              highlight: true,
              items: [
                {
                  lines: [
                    'Dado pessoal de colaborador ou candidato: nome, CPF, salário, informação de saúde',
                    'Dado de aluno ou cliente da EMR',
                    'Contrato ou informação financeira não divulgada',
                    'Senha, credencial ou documento marcado como confidencial',
                  ],
                },
              ],
            },
            {
              title: 'Sempre faça',
              items: [
                {
                  lines: [
                    'Revise a saída antes de usar',
                    'Confira números e nomes contra a fonte original',
                    'Assuma a responsabilidade: a ferramenta não assina o e-mail, você assina',
                  ],
                },
              ],
            },
            {
              title: 'Em dúvida',
              items: [
                {
                  lines: [
                    'Pergunte a Gente e Gestão antes de digitar',
                    'Na dúvida, tire o dado e descreva a situação de forma genérica',
                  ],
                },
              ],
            },
            {
              title: 'O que a nossa turma acrescentou',
              fields: [
                { id: 'turma1', type: 'linha' },
                { id: 'turma2', type: 'linha' },
              ],
            },
            {
              title: 'Aceite',
              highlight: true,
              fields: [
                {
                  id: 'aceite',
                  label: 'Eu li, entendi e me comprometo com estas regras',
                  type: 'checkbox',
                  required: true,
                },
              ],
            },
          ],
        },
      },
    ]),
  },
  {
    order: 5,
    title: 'Mapa de Carreira',
    theme: 'Visão de futuro, carreira e empregabilidade',
    objectives: [
      'Expor os aprendizes a áreas da EMR que eles não conhecem, em formato de conversa e não de palestra.',
      'Fazer cada um construir o próprio Mapa de Carreira, ligando forças e interesses a caminhos possíveis.',
      'Deixar currículo e LinkedIn em estado apresentável antes do encerramento do contrato.',
    ],
    deliverable: 'Mapa de Carreira preenchido, com três caminhos possíveis.',
    scheduledOn: '2027-01-12',
    activities: withRitual(5, [
      {
        title: 'Mapa de Carreira',
        kind: 'ACTIVITY',
        order: 1,
        schema: {
          eyebrow: 'Eu Aprendiz · Encontro 5',
          subtitle:
            'Use evidência concreta da sua jornada. Suas folhas do Encontro 1 estão no seu portfólio.',
          blocks: [
            {
              number: 1,
              title: 'O que eu faço bem',
              note: 'Com evidência da minha jornada.',
              fields: [{ id: 'facoBem', type: 'texto', rows: 3, required: true }],
            },
            {
              number: 2,
              title: 'O que me dá energia',
              note: 'O que eu faria mesmo sem precisar.',
              fields: [{ id: 'energia', type: 'texto', rows: 3, required: true }],
            },
            {
              number: 3,
              title: 'O que o mercado procura',
              note: 'Do que eu ouvi no painel de hoje.',
              fields: [{ id: 'mercado', type: 'texto', rows: 3 }],
            },
            {
              number: 4,
              title: 'O que eu ainda não sei',
              note: 'E preciso aprender para chegar lá.',
              fields: [{ id: 'naoSei', type: 'texto', rows: 3 }],
            },
            {
              title: 'Três caminhos possíveis para os próximos dois anos',
              note: 'Três, não um. A ficha existe para evitar a falsa escolha única.',
              fields: [
                { id: 'caminho1', label: '1 · Caminho', type: 'linha', required: true },
                { id: 'passo1', label: '1 · Primeiro passo', type: 'linha' },
                { id: 'caminho2', label: '2 · Caminho', type: 'linha' },
                { id: 'passo2', label: '2 · Primeiro passo', type: 'linha' },
                { id: 'caminho3', label: '3 · Caminho', type: 'linha' },
                { id: 'passo3', label: '3 · Primeiro passo', type: 'linha' },
              ],
            },
            {
              title: 'Checklist de posicionamento',
              note: 'O que precisa estar pronto antes do encerramento do contrato.',
              fields: [
                {
                  id: 'curriculo',
                  label: 'Currículo de uma página — atividades descritas por resultado, não por tarefa',
                  type: 'checkbox',
                },
                {
                  id: 'linkedin',
                  label: 'LinkedIn atualizado — foto, título e resumo de três linhas',
                  type: 'checkbox',
                },
                {
                  id: 'experiencia',
                  label: 'Experiência na EMR descrita, com números sempre que for possível',
                  type: 'checkbox',
                },
                {
                  id: 'carta',
                  label: 'Carta de recomendação solicitada a Gente e Gestão',
                  type: 'checkbox',
                },
              ],
            },
            {
              title: 'Três pessoas da EMR com quem eu quero manter contato',
              note: 'E como eu vou fazer isso.',
              highlight: true,
              fields: [
                { id: 'pessoa1', label: '1', type: 'linha' },
                { id: 'pessoa2', label: '2', type: 'linha' },
                { id: 'pessoa3', label: '3', type: 'linha' },
              ],
            },
          ],
        },
      },
    ]),
  },
  {
    order: 6,
    title: 'O que eu levo',
    theme: 'Encerramento, portfólio e apresentação para liderança',
    objectives: [
      'Fazer cada aprendiz sintetizar e apresentar publicamente a própria jornada para gestores e liderança.',
      'Entregar formalmente o Portfólio de Conquistas, os certificados e as cartas de recomendação.',
      'Ritualizar o encerramento de dois contratos e a continuidade de um, garantindo memória para o próximo ciclo.',
    ],
    deliverable: 'Apresentação de 3 minutos, Portfólio de Conquistas e carta para o eu do futuro.',
    scheduledOn: '2027-02-09',
    activities: withRitual(6, [
      {
        title: 'Minha Jornada na EMR',
        kind: 'ACTIVITY',
        order: 1,
        schema: {
          eyebrow: 'Eu Aprendiz · Encontro 6',
          subtitle: 'Três minutos, três partes. O tempo é cronometrado — o formato é livre.',
          footer: 'Ensaio cronometrado antes de os convidados entrarem.',
          blocks: [
            {
              number: 1,
              title: 'De onde eu saí',
              time: '45 segundos',
              note: 'Como cheguei à EMR e o que eu não sabia fazer quando entrei.',
              fields: [{ id: 'sai', type: 'texto', rows: 2, required: true }],
            },
            {
              number: 2,
              title: 'O que eu construí',
              time: '90 segundos',
              note: 'Duas ou três entregas concretas, com evidência. É o coração da apresentação.',
              fields: [
                { id: 'construi1', label: '1', type: 'linha', required: true },
                { id: 'construi2', label: '2', type: 'linha' },
                { id: 'construi3', label: '3', type: 'linha' },
              ],
            },
            {
              number: 3,
              title: 'O que eu levo',
              time: '45 segundos',
              note: 'Uma competência que fica comigo e o próximo passo que eu já sei qual é.',
              fields: [{ id: 'levo', type: 'texto', rows: 2, required: true }],
            },
            {
              title: 'Obrigatório citar pelo menos duas destas entregas',
              highlight: true,
              fields: [
                {
                  id: 'cita1',
                  label: 'Plano de ação e a resposta do meu gestor — Encontro 3',
                  type: 'checkbox',
                },
                {
                  id: 'cita2',
                  label: 'Desafio 3 em 30: o que mudou na minha rotina — Encontro 4',
                  type: 'checkbox',
                },
                {
                  id: 'cita3',
                  label: 'Mapa de Carreira: o caminho que eu escolhi — Encontro 5',
                  type: 'checkbox',
                },
              ],
            },
          ],
        },
      },
    ]),
  },
]

export const APPRENTICE_CLASSES_SEED = [
  { name: 'Turma A', shift: 'Manhã' },
  { name: 'Turma B', shift: 'Tarde' },
]

export const APPRENTICE_CONTRACT_SEED = [
  'Chegar no horário combinado e avisar com antecedência quando não for possível.',
  'Entregar o material do encontro até a data acordada.',
  'Respeitar a fala de cada pessoa e ouvir até o fim.',
  'Usar as ferramentas de IA com responsabilidade e sempre indicar o uso.',
  'Cuidar das informações internas da EMR: nada sai daqui sem autorização.',
  'Pedir ajuda quando precisar. Pedir ajuda faz parte da trilha.',
]
