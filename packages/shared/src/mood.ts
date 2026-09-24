// Escala de bem-estar de 5 pontos (ordem do positivo ao negativo).
// Espelha o enum MoodLevel do Prisma. Apenas emoji + rótulo — não altera avatar.
export const MOOD_LEVELS = ['GREAT', 'GOOD', 'NEUTRAL', 'LOW', 'HARD'] as const

export type MoodLevel = (typeof MOOD_LEVELS)[number]

export interface MoodOption {
  value: MoodLevel
  emoji: string
  label: string
}

// Ordem de exibição na UI: da esquerda (pior) para a direita (melhor),
// como uma escala visual de carinhas.
export const MOOD_OPTIONS: ReadonlyArray<MoodOption> = [
  { value: 'HARD', emoji: '😢', label: 'Estressado(a)' },
  { value: 'LOW', emoji: '😟', label: 'Desanimado(a)' },
  { value: 'NEUTRAL', emoji: '😐', label: 'Neutro(a)' },
  { value: 'GOOD', emoji: '🙂', label: 'Bem' },
  { value: 'GREAT', emoji: '😄', label: 'Excelente' },
]

/**
 * A frase que o app devolve depois da escolha, por humor.
 *
 * Não é enfeite: quem marca "Estressado(a)" está sendo perguntado o motivo logo
 * em seguida, e um formulário seco depois de um dia ruim soa a interrogatório.
 * A menção à confidencialidade fica aqui porque é a dúvida que trava a resposta
 * — o painel de clima é agregado e tem piso de anonimato (MOOD_ANONYMITY_MIN).
 */
export const MOOD_SUPPORT_MESSAGES: Record<MoodLevel, string> = {
  HARD: 'Sentimos muito. Conte um pouco para podermos te apoiar — seu retorno é confidencial.',
  LOW: 'Dias assim acontecem. Conte o que pesou — seu retorno é confidencial.',
  NEUTRAL: 'Equilíbrio também conta. Se quiser, deixe um comentário.',
  GOOD: 'Que bom saber! Se quiser, conte o que está ajudando.',
  GREAT: 'Excelente! Conte o que fez o dia render, se quiser.',
}

// Tamanho máximo da nota opcional ("o que te faz sentir assim").
export const MOOD_NOTE_MAX_LENGTH = 280

// Nota numérica de cada humor (1 = pior, 5 = melhor). É a escala usada nas
// médias do painel agregado — api e web precisam concordar nela.
export const MOOD_SCORES: Record<MoodLevel, number> = {
  HARD: 1,
  LOW: 2,
  NEUTRAL: 3,
  GOOD: 4,
  GREAT: 5,
}

// Humores considerados negativos: só neles o motivo é oferecido/guardado — e,
// desde a Home v2, EXIGIDO (ver MOOD_REASON_REQUIRED_MESSAGE).
export const NEGATIVE_MOOD_LEVELS = ['LOW', 'HARD'] as const

export function isNegativeMood(mood: MoodLevel): boolean {
  return (NEGATIVE_MOOD_LEVELS as ReadonlyArray<MoodLevel>).includes(mood)
}

/**
 * Motivos oferecidos hoje, na ordem em que aparecem na tela.
 *
 * É o que a API aceita e o que o seletor mostra — NÃO é o conjunto completo do
 * enum: ver MOOD_REASON_LEGACY.
 */
export const MOOD_SELECTABLE_REASONS = [
  'WORKLOAD',
  'COMMUNICATION',
  'TOOLS',
  'PERSONAL',
  'PROCESSES',
  'LEADERSHIP',
  'OTHER',
] as const

/**
 * Motivos que saíram da lista oferecida mas continuam no enum do Prisma.
 *
 * Existem respostas gravadas com eles, e o painel de clima agrega por motivo:
 * apagá-los do enum quebraria a série histórica de quem já respondeu. Ninguém
 * pode escolhê-los de novo — só aparecem em leitura, no painel.
 */
export const MOOD_REASON_LEGACY = ['RECOGNITION', 'TEAM'] as const

// Categoria do mal-estar. Espelha o enum MoodReason do Prisma — selecionáveis
// primeiro, legado no fim.
export const MOOD_REASONS = [...MOOD_SELECTABLE_REASONS, ...MOOD_REASON_LEGACY] as const

export type MoodReason = (typeof MOOD_REASONS)[number]
export type SelectableMoodReason = (typeof MOOD_SELECTABLE_REASONS)[number]

export const MOOD_REASON_LABELS: Record<MoodReason, string> = {
  WORKLOAD: 'Sobrecarga de demandas / Volume de trabalho',
  COMMUNICATION: 'Problemas ou ruídos na comunicação interna',
  TOOLS: 'Dificuldades técnicas / Ferramentas de trabalho',
  PERSONAL: 'Fatores externos / Questões pessoais',
  PROCESSES: 'Falta de clareza nas metas ou processos',
  LEADERSHIP: 'Problemas com a liderança',
  OTHER: 'Outro motivo',
  RECOGNITION: 'Reconhecimento',
  TEAM: 'Time',
}

/** Mensagem única de api e web quando falta o motivo num humor negativo. */
export const MOOD_REASON_REQUIRED_MESSAGE = 'Escolha o motivo para registrar esse humor.'

/**
 * Mensagem de quem tenta responder duas vezes no mesmo dia.
 *
 * Vale a PRIMEIRA resposta: poder trocar depois convida a corrigir o próprio
 * humor para o que parece aceitável, e o painel de clima passaria a medir isso
 * em vez do dia real. A tela não oferece o botão, e a API também recusa — senão
 * a regra valeria só para quem usa a interface.
 */
export const MOOD_ALREADY_ANSWERED_MESSAGE = 'Você já registrou seu humor hoje. Amanhã tem outra.'

// Rótulo do balde de quem não escolheu motivo (registros antigos incluídos).
export const MOOD_REASON_UNSET_LABEL = 'Não informado'

// Piso de anonimato: nenhum recorte (dia, setor, período) com menos de
// MOOD_ANONYMITY_MIN respostas é exibido ou devolvido pela API — abaixo disso
// o número seria pequeno o bastante para apontar uma pessoa.
//
// Em 08/09/2026 a G&G desligou o piso, baixando-o de 3 para 1: o termômetro
// existe para a pessoa estressada ser vista, e o time pequeno — ou o dia de
// pouca resposta — era exatamente onde ela sumia. O que se troca é real e foi
// aceito: com 1 registro no recorte, o humor deixa de ser anônimo por dedução
// (num setor de duas pessoas, "um Estressado hoje" aponta para alguém).
//
// O piso continua sendo o mecanismo, e não código morto: subir este número de
// volta para 3 restaura a supressão inteira — série, distribuição de hoje,
// média da semana e ranking de motivos — sem tocar em mais nada.
export const MOOD_ANONYMITY_MIN = 1

// Janela mínima/máxima da série do termômetro: fora disso `/admin/mood/overview`
// devolve 400. Moram aqui, e não só no service, porque o filtro de período da
// aba Clima precisa da MESMA regra para não oferecer um recorte que a API
// recusa — era o que fazia o atalho "Hoje" (1 dia) virar "Erro ao carregar o
// termômetro de humor" na tela.
//
// O mínimo era 7 por dois motivos: recorte curto não forma tendência e não
// protegia o anonimato. O segundo caiu junto com o piso (ver
// MOOD_ANONYMITY_MIN), e o primeiro nunca foi motivo para RECUSAR a consulta —
// a G&G pediu para ver o dia de hoje, e uma série de um ponto é um gráfico
// pobre, não um erro. Daí 1: o atalho "Hoje" volta a responder.
export const MOOD_OVERVIEW_MIN_DAYS = 1
export const MOOD_OVERVIEW_MAX_DAYS = 90

// `day` em YYYY-MM-DD (data civil em America/Sao_Paulo).
// `mood` é null quando o usuário ainda não registrou hoje.
// `note` é a nota opcional do dia (null quando não há registro ou veio vazia).
// `reason` é a categoria opcional do mal-estar (só existe em humor negativo).
export interface TodayMoodDTO {
  day: string
  mood: MoodLevel | null
  note: string | null
  reason: MoodReason | null
}
