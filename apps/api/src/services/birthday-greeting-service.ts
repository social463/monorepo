import { Prisma } from '@prisma/client'
import {
  FEEDBACK_REACTIONS,
  GREETING_MAX_LENGTH,
  GREETING_WINDOW_AFTER_DAYS,
  GREETING_WINDOW_BEFORE_DAYS,
  canAdminister,
  type CelebrationKind,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { ymdInSaoPaulo } from '../lib/sao-paulo-date'
import { civilDayMonth, daysBetween, occurrenceYmd } from '../lib/celebration-date'
import { createNotification } from './notification-service'

/**
 * Mural de aniversário: as felicitações que os colegas assinam no perfil de
 * quem comemora — de nascimento e de casa.
 *
 * Não passa pelo `feedback-service` de propósito: felicitação não tem tipo,
 * categoria, coins nem peso de selo (ver `@legends/shared/birthday-greeting` e
 * a spec `2026-08-31-mural-de-aniversarios-design.md`).
 */

export class BirthdayGreetingError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'BirthdayGreetingError'
  }
}

export const greetingInclude = {
  author: true,
  reactions: { include: { user: { select: { id: true, name: true } } } },
} as const
export type GreetingRow = Prisma.BirthdayGreetingGetPayload<{ include: typeof greetingInclude }>

/** Uma celebração concreta: a data que o mural comemora, e onde ela está. */
export interface WallOccurrence {
  kind: CelebrationKind
  year: number
  date: string
  years: number | null
  daysUntil: number
  isToday: boolean
  isOpen: boolean
}

type CelebrantDates = { birthDate: Date | null; joinedAt: Date }

function occurrenceFor(
  kind: CelebrationKind,
  dates: CelebrantDates,
  year: number,
  referenceDay: string,
): WallOccurrence | null {
  const source = kind === 'BIRTH' ? dates.birthDate : dates.joinedAt
  if (!source) return null
  const { day, month } = civilDayMonth(source)
  // Aniversário de casa só existe a partir de um ano completo — quem entrou
  // neste ano civil ainda não tem o que comemorar.
  const years = kind === 'WORK' ? year - source.getUTCFullYear() : null
  if (kind === 'WORK' && (years === null || years < 1)) return null

  const date = occurrenceYmd(month, day, year)
  const daysUntil = daysBetween(referenceDay, date)
  return {
    kind,
    year,
    date,
    years,
    daysUntil,
    isToday: daysUntil === 0,
    isOpen: daysUntil <= GREETING_WINDOW_BEFORE_DAYS && daysUntil >= -GREETING_WINDOW_AFTER_DAYS,
  }
}

/**
 * Os murais que existem para a pessoa: os que estão dentro da janela (dá para
 * assinar) e os anos que já têm assinatura (leitura).
 *
 * A janela é varrida em três anos civis, e não só no corrente, porque ela
 * atravessa a virada do ano: em 2 de janeiro, o aniversário de 31 de dezembro
 * ainda está aberto, e ele é uma ocorrência do ano anterior.
 */
export function occurrencesFor(
  dates: CelebrantDates,
  referenceDay: string,
  signedYears: { kind: CelebrationKind; year: number }[] = [],
): WallOccurrence[] {
  const refYear = Number(referenceDay.slice(0, 4))
  const found = new Map<string, WallOccurrence>()

  for (const kind of ['BIRTH', 'WORK'] as const) {
    for (const year of [refYear - 1, refYear, refYear + 1]) {
      const occurrence = occurrenceFor(kind, dates, year, referenceDay)
      if (occurrence?.isOpen) found.set(`${kind}:${year}`, occurrence)
    }
    // Os anos com assinatura entram mesmo fechados: é o histórico do mural.
    for (const signed of signedYears.filter((s) => s.kind === kind)) {
      const key = `${kind}:${signed.year}`
      if (found.has(key)) continue
      const occurrence = occurrenceFor(kind, dates, signed.year, referenceDay)
      if (occurrence) found.set(key, occurrence)
    }
  }

  // Mais recente primeiro: o mural de hoje é o que a pessoa quer ver ao abrir.
  return [...found.values()].sort((a, b) => b.date.localeCompare(a.date))
}

function assertMessage(message: string): string {
  const trimmed = message.trim()
  if (!trimmed) throw new BirthdayGreetingError('Escreva a sua mensagem.', 400)
  if (trimmed.length > GREETING_MAX_LENGTH) {
    throw new BirthdayGreetingError(`A mensagem precisa ter no máximo ${GREETING_MAX_LENGTH} caracteres.`, 400)
  }
  return trimmed
}

async function celebrantOrThrow(companyId: string, targetId: string): Promise<CelebrantDates & { name: string }> {
  const target = await scopedPrisma(companyId).user.findUnique({
    where: { id: targetId },
    select: { name: true, birthDate: true, joinedAt: true },
  })
  if (!target) throw new BirthdayGreetingError('Pessoa não encontrada.', 404)
  return target
}

export interface WallView {
  occurrences: (WallOccurrence & { greetingCount: number })[]
  selected: (WallOccurrence & { greetingCount: number }) | null
  greetings: GreetingRow[]
}

/**
 * O mural para exibir. `kind`/`year` escolhem qual; sem eles, vale o primeiro
 * aberto e, na falta, o mais recente — quem abre um perfil quer o mural da vez,
 * não um seletor vazio.
 */
export async function getWall(input: {
  targetId: string
  companyId: string
  kind?: CelebrationKind
  year?: number
  now?: Date
}): Promise<WallView> {
  const referenceDay = ymdInSaoPaulo(input.now ?? new Date())
  const target = await celebrantOrThrow(input.companyId, input.targetId)
  const db = scopedPrisma(input.companyId)

  const counts = await db.birthdayGreeting.groupBy({
    by: ['kind', 'occurrenceYear'],
    where: { targetId: input.targetId },
    _count: { _all: true },
  })
  const countOf = new Map(counts.map((row) => [`${row.kind}:${row.occurrenceYear}`, row._count._all]))

  const occurrences = occurrencesFor(
    target,
    referenceDay,
    counts.map((row) => ({ kind: row.kind as CelebrationKind, year: row.occurrenceYear })),
  ).map((occurrence) => ({
    ...occurrence,
    greetingCount: countOf.get(`${occurrence.kind}:${occurrence.year}`) ?? 0,
  }))

  const requested =
    input.kind && input.year
      ? occurrences.find((o) => o.kind === input.kind && o.year === input.year)
      : undefined
  const selected = requested ?? occurrences.find((o) => o.isOpen) ?? occurrences[0] ?? null

  const greetings = selected
    ? await db.birthdayGreeting.findMany({
        where: { targetId: input.targetId, kind: selected.kind, occurrenceYear: selected.year },
        include: greetingInclude,
        orderBy: { createdAt: 'desc' },
      })
    : []

  return { occurrences, selected, greetings }
}

/**
 * Assina o mural. Uma assinatura por pessoa por mural: assinar de novo
 * **reescreve** a sua, em vez de empilhar — o mural é um cartão coletivo, e
 * quem quis corrigir a frase não deveria virar duas linhas.
 */
export async function signWall(input: {
  targetId: string
  authorId: string
  companyId: string
  kind: CelebrationKind
  year: number
  message: string
  now?: Date
}): Promise<GreetingRow> {
  if (input.targetId === input.authorId) {
    throw new BirthdayGreetingError('Você não pode assinar o seu próprio mural.', 403)
  }
  const message = assertMessage(input.message)
  const referenceDay = ymdInSaoPaulo(input.now ?? new Date())
  const target = await celebrantOrThrow(input.companyId, input.targetId)

  const occurrence = occurrenceFor(input.kind, target, input.year, referenceDay)
  if (!occurrence) throw new BirthdayGreetingError('Essa pessoa não tem essa data cadastrada.', 404)
  if (!occurrence.isOpen) {
    throw new BirthdayGreetingError('O mural deste aniversário já está fechado para novas mensagens.', 409)
  }

  const db = scopedPrisma(input.companyId)
  const existing = await db.birthdayGreeting.findFirst({
    where: {
      targetId: input.targetId,
      authorId: input.authorId,
      kind: input.kind,
      occurrenceYear: input.year,
    },
    select: { id: true },
  })

  const greeting = existing
    ? await db.birthdayGreeting.update({
        where: { id: existing.id },
        data: { message },
        include: greetingInclude,
      })
    : await db.birthdayGreeting.create({
        data: {
          targetId: input.targetId,
          authorId: input.authorId,
          kind: input.kind,
          occurrenceYear: input.year,
          message,
        },
        include: greetingInclude,
      })

  // Só a primeira assinatura avisa: corrigir a própria frase não é notícia
  // nova para quem faz aniversário.
  if (!existing) {
    await notifyGreeting({
      targetId: input.targetId,
      authorId: input.authorId,
      // O nome sai da linha recém-criada: o JWT não carrega nome, e uma consulta
      // extra só para o título da notificação seria desperdício.
      authorName: greeting.author.name,
      companyId: input.companyId,
      kind: input.kind,
    })
  }
  return greeting
}

/** Best-effort: falha de notificação não derruba a felicitação. */
async function notifyGreeting(input: {
  targetId: string
  authorId: string
  authorName: string
  companyId: string
  kind: CelebrationKind
}): Promise<void> {
  try {
    await createNotification({
      userId: input.targetId,
      type: 'BIRTHDAY_GREETING_RECEIVED',
      actorId: input.authorId,
      title:
        input.kind === 'BIRTH'
          ? `${input.authorName} assinou o seu mural de aniversário 🎂`
          : `${input.authorName} assinou o seu mural de aniversário de empresa 🎉`,
      link: `/perfil/${input.targetId}?mural=aniversario`,
      metadata: { kind: input.kind },
      companyId: input.companyId,
    })
  } catch (err) {
    console.error('[birthday-greeting] falha ao notificar', err)
  }
}

async function greetingOrThrow(companyId: string, id: string): Promise<GreetingRow> {
  const greeting = await scopedPrisma(companyId).birthdayGreeting.findUnique({
    where: { id },
    include: greetingInclude,
  })
  if (!greeting) throw new BirthdayGreetingError('Mensagem não encontrada.', 404)
  return greeting
}

/** O autor manda na própria mensagem; a moderação é só do admin. */
export function canModerate(actor: { role?: string; adminAccess?: boolean }): boolean {
  return canAdminister({ role: actor.role, adminAccess: actor.adminAccess })
}

export async function updateGreeting(input: {
  id: string
  authorId: string
  companyId: string
  message: string
}): Promise<GreetingRow> {
  const greeting = await greetingOrThrow(input.companyId, input.id)
  // Editar é só do autor, inclusive para o admin: moderar é apagar o que não
  // cabe, não reescrever o que o colega assinou.
  if (greeting.authorId !== input.authorId) {
    throw new BirthdayGreetingError('Você só pode editar a sua mensagem.', 403)
  }
  return scopedPrisma(input.companyId).birthdayGreeting.update({
    where: { id: input.id },
    data: { message: assertMessage(input.message) },
    include: greetingInclude,
  })
}

export async function removeGreeting(input: {
  id: string
  actorId: string
  actor: { role?: string; adminAccess?: boolean }
  companyId: string
}): Promise<void> {
  const greeting = await greetingOrThrow(input.companyId, input.id)
  if (greeting.authorId !== input.actorId && !canModerate(input.actor)) {
    throw new BirthdayGreetingError('Você só pode apagar a sua mensagem.', 403)
  }
  await scopedPrisma(input.companyId).birthdayGreeting.delete({ where: { id: input.id } })
}

/** Liga/desliga a reação de quem chamou — mesmo contrato do mural de feedbacks. */
export async function toggleReaction(input: {
  greetingId: string
  userId: string
  emoji: string
  companyId: string
}): Promise<GreetingRow> {
  if (!(FEEDBACK_REACTIONS as readonly string[]).includes(input.emoji)) {
    throw new BirthdayGreetingError('Reação inválida.', 400)
  }
  await greetingOrThrow(input.companyId, input.greetingId)
  const db = scopedPrisma(input.companyId)
  const existing = await db.birthdayGreetingReaction.findFirst({
    where: { greetingId: input.greetingId, userId: input.userId, emoji: input.emoji },
    select: { id: true },
  })
  if (existing) await db.birthdayGreetingReaction.delete({ where: { id: existing.id } })
  else
    await db.birthdayGreetingReaction.create({
      data: { greetingId: input.greetingId, userId: input.userId, emoji: input.emoji },
    })
  return greetingOrThrow(input.companyId, input.greetingId)
}

/**
 * Quantas assinaturas cada mural aberto de HOJE já tem, por pessoa — é o número
 * que o card de aniversariantes da Home mostra ("3 já assinaram").
 */
export async function countGreetingsForToday(
  companyId: string,
  targets: { userId: string; kind: CelebrationKind; year: number }[],
): Promise<Map<string, number>> {
  if (targets.length === 0) return new Map()
  const rows = await scopedPrisma(companyId).birthdayGreeting.groupBy({
    by: ['targetId', 'kind', 'occurrenceYear'],
    where: { OR: targets.map((t) => ({ targetId: t.userId, kind: t.kind, occurrenceYear: t.year })) },
    _count: { _all: true },
  })
  return new Map(rows.map((row) => [`${row.targetId}:${row.kind}:${row.occurrenceYear}`, row._count._all]))
}
