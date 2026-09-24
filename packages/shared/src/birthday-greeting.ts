import type { PublicUser } from './auth'
import type { ReactionSummary } from './feedback'

/**
 * Mural de aniversário — as felicitações que os colegas assinam no perfil de
 * quem comemora.
 *
 * **Não é feedback**, e essa é a decisão central. O botão de parabéns abria o
 * `FeedbackComposer` com um rascunho, então "Parabéns, Victoria!" nascia com
 * tipo, categoria, coins e peso de selo, e ia parar no meio da lista de
 * feedbacks da pessoa. Felicitação não tem situação/comportamento/impacto: o
 * guia inteiro do feedback é ruído aqui, e o mínimo de caracteres transformava
 * "Parabéns!" em erro de validação.
 *
 * O que continua sendo feedback continua igual — o ❤️ do card de
 * aniversariantes leva ao perfil e ao `FeedbackComposer` de sempre.
 */

/** O que o mural comemora. Espelha o enum `CelebrationKind` do Prisma. */
export const CELEBRATION_KINDS = ['BIRTH', 'WORK'] as const
export type CelebrationKind = (typeof CELEBRATION_KINDS)[number]

export const CELEBRATION_KIND_LABELS: Record<CelebrationKind, string> = {
  BIRTH: 'Aniversário',
  WORK: 'Aniversário de empresa',
}

export function isCelebrationKind(value: unknown): value is CelebrationKind {
  return typeof value === 'string' && (CELEBRATION_KINDS as readonly string[]).includes(value)
}

/** Teto da felicitação. Curto de propósito: é um cartão, não um feedback. */
export const GREETING_MAX_LENGTH = 280

/**
 * Frases prontas do compositor. São **rascunho**, não resposta pronta: clicar
 * preenche o campo e o texto continua editável — quem quiser mandar só
 * "Parabéns! 🎉" manda, e quem quiser escrever um parágrafo escreve.
 */
export const GREETING_SUGGESTIONS: Record<CelebrationKind, string[]> = {
  BIRTH: [
    'Parabéns! 🎉',
    'Feliz aniversário! 🎂',
    'Muitas felicidades!',
    'Tudo de bom no seu dia! 🥳',
    'Que venha um ano incrível!',
  ],
  WORK: [
    'Parabéns pelo tempo de casa! 🎉',
    'Feliz aniversário de empresa!',
    'Que venham muitos outros!',
    'Obrigado por caminhar com a gente! 🙌',
  ],
}

/**
 * Janela em que o mural aceita assinatura, em dias em torno da data.
 *
 * Abre antes porque quem viaja no dia costuma adiantar o recado, e fecha bem
 * depois porque parabéns atrasado ainda é parabéns — mas em algum momento vira
 * lembrança, e aí o mural fica só para leitura.
 */
export const GREETING_WINDOW_BEFORE_DAYS = 3
export const GREETING_WINDOW_AFTER_DAYS = 30

/** Um mural: a celebração de uma pessoa num ano. */
export interface BirthdayWallOccurrenceDTO {
  kind: CelebrationKind
  /** Ano civil da ocorrência — é ele, com `kind`, que identifica o mural. */
  year: number
  /** Data observada (AAAA-MM-DD), já com a regra de 29/02 aplicada. */
  date: string
  /** Anos completos de casa nessa data. Só em `WORK`. */
  years: number | null
  /** A data é hoje (referência America/Sao_Paulo). */
  isToday: boolean
  /** A janela está aberta: dá para assinar. */
  isOpen: boolean
  /** Quantas assinaturas o mural já tem. */
  greetingCount: number
}

export interface BirthdayGreetingDTO {
  id: string
  author: PublicUser
  message: string
  createdAt: string
  updatedAt: string
  reactions: ReactionSummary[]
  /** Quem vê pode editar/apagar: o autor sempre, o admin como moderação. */
  canEdit: boolean
  canDelete: boolean
}

export interface BirthdayWallResponse {
  /** Murais que existem: os abertos agora e os anos que têm assinatura. */
  occurrences: BirthdayWallOccurrenceDTO[]
  /** O mural exibido — null quando a pessoa não tem nenhum. */
  selected: BirthdayWallOccurrenceDTO | null
  greetings: BirthdayGreetingDTO[]
  /** Dá para assinar ESTE mural (janela aberta e não é o próprio perfil). */
  canSign: boolean
  /** A assinatura de quem está vendo, quando já assinou. */
  mySignatureId: string | null
}

export interface SignBirthdayWallRequest {
  kind: CelebrationKind
  year: number
  message: string
}

export interface UpdateBirthdayGreetingRequest {
  message: string
}

/**
 * Quem pode assinar: qualquer pessoa logada, menos você mesmo.
 *
 * Diferente do feedback, que barra o ADMIN — num mural de aniversário não faz
 * sentido o admin não poder dar parabéns.
 */
export function canSignBirthdayWall(
  viewer: { id?: string } | null | undefined,
  targetId: string,
): boolean {
  return Boolean(viewer?.id) && viewer?.id !== targetId
}

/** "3 dias antes" / "hoje" / "há 2 dias" — o cabeçalho do mural. */
export function celebrationWhenLabel(daysUntil: number): string {
  if (daysUntil === 0) return 'É hoje!'
  if (daysUntil === 1) return 'É amanhã!'
  if (daysUntil > 1) return `Em ${daysUntil} dias`
  if (daysUntil === -1) return 'Foi ontem'
  return `Há ${Math.abs(daysUntil)} dias`
}
