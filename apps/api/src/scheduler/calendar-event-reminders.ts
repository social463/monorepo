/**
 * Lembrete de evento de calendário: nas antecedências configuradas no cadastro
 * (`reminderDaysBefore`, em dias), uma notificação in-app para o público-alvo —
 * que o `createNotification` já espelha como card na DM do Teams de quem tem
 * webhook.
 *
 * Antecedência é em DIAS, então "3 dias antes" não é um instante: é um dia. O
 * tick é horário e o disparo acontece às 9h de São Paulo do dia
 * `ocorrência − daysBefore` (molde do `nudges.ts`, não o de 60s das reuniões).
 *
 * A reivindicação é o próprio INSERT em `CalendarEventReminderSent`, protegido
 * pela unique `(eventId, occurrenceDate, daysBefore)`: de duas tentativas
 * concorrentes (tick sobreposto, ou dois processos) só uma insere; a outra leva
 * P2002 e pula. Diferente do `remindedAt` de `OfficeMeeting`, a granularidade é
 * a **ocorrência**, porque evento recorrente com duas antecedências tem várias
 * linhas legítimas.
 *
 * Trade-off herdado do molde e aceito igual: reivindica antes de notificar, então
 * falha na entrega perde aquele lembrete — não há nova tentativa.
 */
import { Prisma } from '@prisma/client'
import { CALENDAR_REMINDER_HOUR, expandOccurrences, type FeatureKey } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { extractEventTimeRange, formatEventTimeRange } from '../lib/event-time-range'
import { addDays, dayFromYmd, hourInSaoPaulo, ymdInSaoPaulo, ymdOf } from '../lib/sao-paulo-date'
import { createNotification } from '../services/notification-service'
import { listEventsWithReminders } from '../services/calendar-event-service'

const TICK_MS = 60 * 60 * 1000

/** Maior antecedência que o cadastro oferece — teto da janela que o tick olha. */
const MAX_OFFSET_DAYS = 30

/** `enabledFeatures` é coluna Json: chega como `unknown` e precisa ser provada. */
function hasFeature(enabledFeatures: unknown, key: string): boolean {
  return Array.isArray(enabledFeatures) && (enabledFeatures as FeatureKey[]).includes(key as FeatureKey)
}

function hasCalendarFeature(enabledFeatures: unknown): boolean {
  return hasFeature(enabledFeatures, 'calendario')
}

/**
 * Um tick. `now` é injetável (testável sem timers). Fora da hora do disparo não
 * faz nada: o lembrete do dia sai uma vez, de manhã.
 */
export async function runCalendarEventReminderTick(now: Date): Promise<void> {
  if (hourInSaoPaulo(now) !== CALENDAR_REMINDER_HOUR) return

  const today = ymdInSaoPaulo(now)
  const events = await listEventsWithReminders(today, MAX_OFFSET_DAYS)

  for (const event of events) {
    for (const daysBefore of event.reminderDaysBefore) {
      // Hoje é o dia do lembrete para a ocorrência que cai `daysBefore` à frente.
      const occurrenceIso = addDays(today, daysBefore)
      const cai = expandOccurrences(
        {
          date: ymdOf(event.date),
          recurrence: event.recurrence,
          recurrenceUntil: event.recurrenceUntil ? ymdOf(event.recurrenceUntil) : null,
          recurrenceCount: event.recurrenceCount,
        },
        occurrenceIso,
        occurrenceIso,
      )
      if (cai.length === 0) continue

      try {
        // O INSERT É a reivindicação: unique violada (P2002) significa que
        // outro tick já pegou esta combinação. Nada de checar antes e inserir
        // depois — entre as duas chamadas cabe outro processo.
        await prisma.calendarEventReminderSent.create({
          data: { eventId: event.id, occurrenceDate: dayFromYmd(occurrenceIso), daysBefore },
        })
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
        console.error(`[calendar-event-reminders] falha ao reivindicar evento ${event.id}`, err)
        continue
      }

      try {
        await notificar(event, occurrenceIso, daysBefore)
      } catch (err) {
        console.error(`[calendar-event-reminders] falha ao notificar evento ${event.id}`, err)
      }
    }
  }
}

type EventoComPublico = Awaited<ReturnType<typeof listEventsWithReminders>>[number]

async function notificar(event: EventoComPublico, occurrenceIso: string, daysBefore: number): Promise<void> {
  const sectorIds = event.sectors.map((s) => s.sectorId)

  // Público-alvo vazio é a empresa inteira. Dentro dele, só recebe quem tem a
  // feature `calendario` — a mesma que dá acesso à tela. A feature é do SETOR,
  // então o filtro é aplicado sobre os setores, não sobre o usuário.
  const sectors = await prisma.sector.findMany({
    where: {
      companyId: event.companyId,
      ...(sectorIds.length > 0 ? { id: { in: sectorIds } } : {}),
    },
    select: { id: true, enabledFeatures: true },
  })
  // Ação de Comunicação Interna é registro da G&G: o lembrete não pode vazar
  // para o colaborador o evento que a tela esconde dele. O filtro é em memória
  // porque `enabledFeatures` é coluna Json — não existe `has` no `where`.
  const alvo = sectors
    .filter((s) => hasCalendarFeature(s.enabledFeatures))
    .filter((s) => !event.isInternalComm || hasFeature(s.enabledFeatures, 'gente-gestao'))
    .map((s) => s.id)
  if (alvo.length === 0) return

  const users = await prisma.user.findMany({
    where: { active: true, companyId: event.companyId, sectorId: { in: alvo } },
    select: { id: true },
  })

  const title = `${event.type.name}: "${event.title}" ${quandoLabel(daysBefore)}`

  // A descrição fica de fora do card de propósito: é texto de cadastro (datas
  // repetidas, gabarito) que não ajuda quem só quer saber quando é. O que
  // interessa dela — início e fim — vira o fato "Horário".
  const horario = formatEventTimeRange(extractEventTimeRange(event.description, event.startTime))
  const facts = [{ title: 'Quando', value: dataPorExtenso(occurrenceIso) }]
  if (horario) facts.push({ title: 'Horário', value: horario })

  for (const user of users) {
    await createNotification({
      userId: user.id,
      type: 'CALENDAR_EVENT_REMINDER',
      title,
      link: `/calendario?dia=${occurrenceIso}`,
      metadata: { eventId: event.id, occurrenceDate: occurrenceIso, daysBefore },
      teamsFacts: facts,
      companyId: event.companyId,
    })
  }
}

/**
 * O lembrete fala do ponto de vista de quem lê hoje — "daqui a 7 dias", não o
 * rótulo do cadastro ("7 dias antes"), que descreve a regra, não a data.
 */
function quandoLabel(daysBefore: number): string {
  if (daysBefore === 0) return 'é hoje'
  if (daysBefore === 1) return 'é amanhã'
  return `é daqui a ${daysBefore} dias`
}

/**
 * A data civil por extenso. O `T12:00:00Z` com `timeZone: 'UTC'` mantém o dia
 * exatamente como veio: meia-noite UTC formatada em qualquer fuso a oeste
 * voltaria um dia.
 */
const DATA_POR_EXTENSO = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

function dataPorExtenso(iso: string): string {
  return DATA_POR_EXTENSO.format(new Date(`${iso}T12:00:00Z`))
}

/**
 * Tick horário — a antecedência é em dias, então não há motivo para olhar mais
 * de uma vez por hora. Não sobe em teste (que usa só buildApp).
 */
export function startCalendarEventReminderScheduler(): void {
  if (process.env.NODE_ENV === 'test') return
  setInterval(() => {
    runCalendarEventReminderTick(new Date()).catch((err) =>
      console.error('[calendar-event-reminders] tick falhou', err),
    )
  }, TICK_MS)
}
