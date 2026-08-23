import type { DevelopmentThursdayEvent, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { postTeamsNotification } from '../lib/teams-client'
import { absoluteUrl } from '../lib/app-url'
import { ymdInSaoPaulo, ymdOf } from '../lib/sao-paulo-date'
import { createNotification } from './notification-service'
import { recordAuditLog } from './audit-log-service'
import { scopedPrisma } from '../lib/tenant-scope'

export const DEVELOPMENT_THURSDAY_TEAMS_WEBHOOK_KEY = 'development_thursday_teams_webhook_url'
export const DEVELOPMENT_THURSDAY_SPRINT_ANCHOR = '2026-07-06'
// Cadência: nova sprint a cada 14 dias, sempre começando numa segunda-feira (06, 20, ...).
export const DEVELOPMENT_THURSDAY_SPRINT_DAYS = 14
// A sprint dura duas semanas mas encerra na sexta-feira da 2ª semana (start + 11 → 17, 31, ...).
export const DEVELOPMENT_THURSDAY_SPRINT_END_OFFSET = 11

const DAY_MS = 24 * 60 * 60 * 1000
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export type DevelopmentThursdayEventWithPresenter = Prisma.DevelopmentThursdayEventGetPayload<{
  include: { presenter: true }
}>

export class DevelopmentThursdayError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}

function utcDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

function normalizeTime(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!TIME_RE.test(trimmed)) {
    throw new DevelopmentThursdayError('Informe o horário no formato HH:mm.')
  }
  return trimmed
}

function validateTimeWindow(startTime: string | null, endTime: string | null): void {
  if ((startTime && !endTime) || (!startTime && endTime)) {
    throw new DevelopmentThursdayError('Informe horário de início e fim.')
  }
  if (startTime && endTime && startTime >= endTime) {
    throw new DevelopmentThursdayError('O horário de fim deve ser depois do início.')
  }
}

function hmInSaoPaulo(now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now)
}

export function isDevelopmentThursdayEventFinished(
  event: Pick<DevelopmentThursdayEvent, 'eventDate' | 'endTime'>,
  now: Date = new Date(),
): boolean {
  const today = ymdInSaoPaulo(now)
  const eventDay = ymdOf(event.eventDate)
  if (eventDay < today) return true
  if (eventDay > today) return false
  return event.endTime ? hmInSaoPaulo(now) >= event.endTime : false
}

export function sprintWindowFor(date: Date): { sprintStart: Date; sprintEnd: Date; eventDate: Date } {
  const anchor = utcDate(DEVELOPMENT_THURSDAY_SPRINT_ANCHOR)
  const day = utcDate(isoDate(date))
  const diffDays = Math.floor((day.getTime() - anchor.getTime()) / DAY_MS)
  const sprintIndex = Math.floor(diffDays / DEVELOPMENT_THURSDAY_SPRINT_DAYS)
  const sprintStart = addDays(anchor, sprintIndex * DEVELOPMENT_THURSDAY_SPRINT_DAYS)
  const sprintEnd = addDays(sprintStart, DEVELOPMENT_THURSDAY_SPRINT_END_OFFSET)
  return { sprintStart, sprintEnd, eventDate: firstThursdayInSprint(sprintStart) }
}

export function firstThursdayInSprint(sprintStart: Date): Date {
  const day = sprintStart.getUTCDay()
  const offset = (4 - day + 7) % 7
  return addDays(sprintStart, offset)
}

export function isAlignedSprintStart(date: Date): boolean {
  return isoDate(sprintWindowFor(date).sprintStart) === isoDate(date)
}

export async function listDevelopmentThursdayEvents(input: {
  from?: Date
  to?: Date
}, companyId: string): Promise<DevelopmentThursdayEventWithPresenter[]> {
  return scopedPrisma(companyId).developmentThursdayEvent.findMany({
    where: {
      ...(input.from || input.to
        ? {
            eventDate: {
              ...(input.from ? { gte: input.from } : {}),
              ...(input.to ? { lte: input.to } : {}),
            },
          }
        : {}),
    },
    include: { presenter: true },
    orderBy: { eventDate: 'asc' },
  })
}

export async function createDevelopmentThursdayEvent(input: {
  title: string
  description: string
  presenterId: string
  companyId: string
  eventDate?: Date
  startTime?: string | null
  endTime?: string | null
  sprintStart?: Date
  now?: Date
}): Promise<DevelopmentThursdayEventWithPresenter> {
  const title = input.title.trim()
  const description = input.description.trim()
  if (!title) throw new DevelopmentThursdayError('Informe o título do tema.')
  if (!description) throw new DevelopmentThursdayError('Informe a descrição do tema.')
  const startTime = normalizeTime(input.startTime)
  const endTime = normalizeTime(input.endTime)
  validateTimeWindow(startTime, endTime)

  const selectedEventDate = input.eventDate ? utcDate(isoDate(input.eventDate)) : null
  if (selectedEventDate && isWeekend(selectedEventDate)) {
    throw new DevelopmentThursdayError('Escolha um dia útil para a Quinta de Desenvolvimento.')
  }

  const window = input.sprintStart
    ? {
        sprintStart: input.sprintStart,
        sprintEnd: addDays(input.sprintStart, DEVELOPMENT_THURSDAY_SPRINT_END_OFFSET),
        eventDate: selectedEventDate ?? firstThursdayInSprint(input.sprintStart),
      }
    : sprintWindowFor(selectedEventDate ?? input.now ?? new Date())

  if (input.sprintStart && !isAlignedSprintStart(input.sprintStart)) {
    throw new DevelopmentThursdayError('A sprint informada não segue a cadência de 14 dias da Quinta de Desenvolvimento.')
  }
  if (
    selectedEventDate &&
    (selectedEventDate.getTime() < window.sprintStart.getTime() ||
      selectedEventDate.getTime() > window.sprintEnd.getTime())
  ) {
    throw new DevelopmentThursdayError('A data escolhida precisa estar dentro da sprint selecionada.')
  }

  try {
    const event = await scopedPrisma(input.companyId).developmentThursdayEvent.create({
      data: {
        title,
        description,
        presenterId: input.presenterId,
        sprintStart: window.sprintStart,
        sprintEnd: window.sprintEnd,
        eventDate: window.eventDate,
        startTime,
        endTime,
      },
      include: { presenter: true },
    })
    await notifyDevelopmentThursdayEvent(event)
    return event
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      throw new DevelopmentThursdayError('Já existe um tema cadastrado para essa sprint.', 409)
    }
    throw err
  }
}

export async function updateDevelopmentThursdayEvent(input: {
  id: string
  authorId: string
  companyId: string
  title?: string
  description?: string
  eventDate?: Date
  startTime?: string | null
  endTime?: string | null
}): Promise<DevelopmentThursdayEventWithPresenter> {
  const db = scopedPrisma(input.companyId)
  const current = await db.developmentThursdayEvent.findUnique({
    where: { id: input.id },
    include: { presenter: true },
  })
  if (!current) throw new DevelopmentThursdayError('Tema não encontrado.', 404)
  if (current.presenterId !== input.authorId) {
    throw new DevelopmentThursdayError('Você só pode editar temas cadastrados por você.', 403)
  }

  const data: Prisma.DevelopmentThursdayEventUpdateInput = {}
  if (input.title !== undefined) {
    const title = input.title.trim()
    if (!title) throw new DevelopmentThursdayError('Informe o título do tema.')
    data.title = title
  }
  if (input.description !== undefined) {
    const description = input.description.trim()
    if (!description) throw new DevelopmentThursdayError('Informe a descrição do tema.')
    data.description = description
  }
  if (input.eventDate !== undefined) {
    const eventDate = utcDate(isoDate(input.eventDate))
    if (isWeekend(eventDate)) {
      throw new DevelopmentThursdayError('Escolha um dia útil para a Quinta de Desenvolvimento.')
    }
    if (eventDate.getTime() < current.sprintStart.getTime() || eventDate.getTime() > current.sprintEnd.getTime()) {
      throw new DevelopmentThursdayError('A data escolhida precisa estar dentro da sprint do tema.')
    }
    data.eventDate = eventDate
  }
  if (input.startTime !== undefined || input.endTime !== undefined) {
    const startTime = input.startTime !== undefined ? normalizeTime(input.startTime) : current.startTime
    const endTime = input.endTime !== undefined ? normalizeTime(input.endTime) : current.endTime
    validateTimeWindow(startTime, endTime)
    data.startTime = startTime
    data.endTime = endTime
  }

  return db.developmentThursdayEvent.update({
    where: { id: input.id },
    data,
    include: { presenter: true },
  })
}

export async function deleteDevelopmentThursdayEvent(input: {
  id: string
  authorId: string
  companyId: string
}): Promise<void> {
  const db = scopedPrisma(input.companyId)
  const current = await db.developmentThursdayEvent.findUnique({
    where: { id: input.id },
    select: { presenterId: true, _count: { select: { feedbacks: true } } },
  })
  if (!current) throw new DevelopmentThursdayError('Tema não encontrado.', 404)
  if (current.presenterId !== input.authorId) {
    throw new DevelopmentThursdayError('Você só pode excluir temas cadastrados por você.', 403)
  }
  if (current._count.feedbacks > 0) {
    throw new DevelopmentThursdayError('Não é possível excluir um tema com feedbacks registrados.', 409)
  }
  await db.developmentThursdayEvent.delete({ where: { id: input.id } })
}

export async function findDevelopmentThursdayEventForFeedback(id: string, companyId: string) {
  const event = await scopedPrisma(companyId).developmentThursdayEvent.findUnique({
    where: { id },
    include: { presenter: true },
  })
  if (!event) throw new DevelopmentThursdayError('Tema não encontrado.', 404)
  return event
}

export async function getDevelopmentThursdaySettings(companyId: string): Promise<{ teamsWebhookUrl: string | null }> {
  const setting = await prisma.appSetting.findUnique({ where: { key_companyId: { key: DEVELOPMENT_THURSDAY_TEAMS_WEBHOOK_KEY, companyId } } })
  return { teamsWebhookUrl: setting?.value ?? null }
}

export async function updateDevelopmentThursdaySettings(input: {
  teamsWebhookUrl: string | null
  actorId: string
  companyId: string
}): Promise<{ teamsWebhookUrl: string | null }> {
  // `AppSetting` tem chave composta (key, companyId) — scopedPrisma não é usado aqui porque
  // sua injeção genérica de companyId no `where` não cobre o `findUnique`/`upsert` de uma
  // unique composta (o seletor precisa vir inteiro em `key_companyId`); companyId vai
  // explícito nos dois lados (where e create) igual ao restante da linha.
  const value = input.teamsWebhookUrl?.trim() || null
  const before = await prisma.appSetting.findUnique({ where: { key_companyId: { key: DEVELOPMENT_THURSDAY_TEAMS_WEBHOOK_KEY, companyId: input.companyId } } })
  const setting = await prisma.appSetting.upsert({
    where: { key_companyId: { key: DEVELOPMENT_THURSDAY_TEAMS_WEBHOOK_KEY, companyId: input.companyId } },
    create: { key: DEVELOPMENT_THURSDAY_TEAMS_WEBHOOK_KEY, companyId: input.companyId, value },
    update: { value },
  })
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'AppSetting',
    entityId: DEVELOPMENT_THURSDAY_TEAMS_WEBHOOK_KEY,
    action: before ? 'UPDATE' : 'CREATE',
    before,
    after: setting,
    companyId: input.companyId,
  })
  return { teamsWebhookUrl: setting.value ?? null }
}

async function notifyDevelopmentThursdayEvent(event: DevelopmentThursdayEventWithPresenter): Promise<void> {
  const title = `${event.presenter.name} cadastrou um tema para a Quinta de Desenvolvimento: ${event.title}`
  const link = '/quinta-desenvolvimento'
  const users = await scopedPrisma(event.presenter.companyId).user.findMany({
    where: { active: true, role: { notIn: ['ADMIN', 'SUBADMIN'] } },
    select: { id: true },
  })
  for (const user of users) {
    await createNotification({
      userId: user.id,
      type: 'DEVELOPMENT_THURSDAY_EVENT',
      actorId: event.presenterId,
      title,
      link,
      metadata: { eventId: event.id },
      skipTeamsMirror: true,
      companyId: event.presenter.companyId,
    })
  }

  const { teamsWebhookUrl } = await getDevelopmentThursdaySettings(event.presenter.companyId)
  if (!teamsWebhookUrl) return
  await postTeamsNotification(teamsWebhookUrl, {
    title,
    body: event.description,
    ctaUrl: absoluteUrl(link),
    ctaLabel: 'Ver calendário',
    emoji: '📚',
  })
}
