/**
 * Eventos de calendário cadastrados pela empresa — prova B2B, prazo, campanha,
 * treinamento, comunicado com data. Diferente dos quatro tipos derivados do
 * calendário (aniversário, tempo de casa, férias, reunião), aqui alguém cadastra.
 *
 * Datas são civis (YYYY-MM-DD) do começo ao fim: entram como string, viram
 * `Date` à meia-noite UTC no banco (`@db.Date`) e voltam a string na saída —
 * mesmo contrato de `vacation-service`.
 *
 * Público-alvo: `CalendarEventSector` **vazio significa empresa inteira**. O
 * recorte é sempre do backend; a tela nunca recebe evento que não é do usuário.
 */
import {
  CALENDAR_CATEGORY_FALLBACK_COLOR,
  MAX_CALENDAR_EVENT_RANGE_DAYS,
  audienceReaches,
  calendarCategoryColor,
  canEditCalendarEvent,
  canSeeInternalCalendarEvents,
  expandOccurrences,
  normalizeAudienceTag,
  viewerAudienceTags,
  type CalendarEventDTO,
  type CalendarEventOccurrenceDTO,
  type CalendarEventTypeDTO,
  type CalendarRecurrence,
  type UpsertCalendarEventRequest,
  type UpsertCalendarEventTypeRequest,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { addDays, dayFromYmd, ymdOf } from '../lib/sao-paulo-date'
import { toCalendarEventDTO, toCalendarEventTypeDTO } from '../lib/serialize'
import { recordAuditLog } from './audit-log-service'

export class CalendarEventError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
    this.name = 'CalendarEventError'
  }
}

const WITH_RELATIONS = {
  type: true,
  sectors: { include: { sector: { select: { id: true, name: true } } } },
  createdBy: { select: { name: true } },
} as const

/** Slug a partir do nome, no mesmo espírito dos demais slugs do produto. */
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

// ---------------------------------------------------------------- tipos

export async function listEventTypes(companyId: string): Promise<CalendarEventTypeDTO[]> {
  const types = await scopedPrisma(companyId).calendarEventType.findMany({ orderBy: { name: 'asc' } })
  return types.map(toCalendarEventTypeDTO)
}

export async function createEventType(input: {
  data: UpsertCalendarEventTypeRequest
  actorId: string
  companyId: string
}): Promise<CalendarEventTypeDTO> {
  const slug = slugify(input.data.name)
  if (!slug) throw new CalendarEventError('Informe um nome válido para o tipo.')

  const existing = await scopedPrisma(input.companyId).calendarEventType.findFirst({ where: { slug } })
  if (existing) throw new CalendarEventError('Já existe um tipo com esse nome.', 409)

  const type = await prisma.calendarEventType.create({
    data: {
      name: input.data.name.trim(),
      slug,
      icon: input.data.icon ?? 'event',
      // Categoria do catálogo padrão recadastrada à mão nasce com a cor dela;
      // categoria nova da empresa nasce com a de fallback.
      color: input.data.color ?? calendarCategoryColor(slug),
      companyId: input.companyId,
    },
  })
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'CalendarEventType',
    entityId: type.id,
    action: 'CREATE',
    companyId: input.companyId,
    after: type,
  })
  return toCalendarEventTypeDTO(type)
}

export async function updateEventType(input: {
  id: string
  data: UpsertCalendarEventTypeRequest
  actorId: string
  companyId: string
}): Promise<CalendarEventTypeDTO> {
  const before = await scopedPrisma(input.companyId).calendarEventType.findFirst({ where: { id: input.id } })
  if (!before) throw new CalendarEventError('Tipo não encontrado.', 404)

  const slug = slugify(input.data.name)
  if (!slug) throw new CalendarEventError('Informe um nome válido para o tipo.')
  const clash = await scopedPrisma(input.companyId).calendarEventType.findFirst({
    where: { slug, id: { not: input.id } },
  })
  if (clash) throw new CalendarEventError('Já existe um tipo com esse nome.', 409)

  const type = await prisma.calendarEventType.update({
    where: { id: input.id },
    data: {
      name: input.data.name.trim(),
      slug,
      icon: input.data.icon ?? before.icon,
      color: input.data.color ?? before.color,
    },
  })
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'CalendarEventType',
    entityId: type.id,
    action: 'UPDATE',
    companyId: input.companyId,
    before,
    after: type,
  })
  return toCalendarEventTypeDTO(type)
}

export async function deleteEventType(input: { id: string; actorId: string; companyId: string }): Promise<void> {
  const before = await scopedPrisma(input.companyId).calendarEventType.findFirst({ where: { id: input.id } })
  if (!before) throw new CalendarEventError('Tipo não encontrado.', 404)

  // Tipo em uso não some: apagar levaria junto o histórico de eventos, e o
  // admin não tem como saber disso pela tela. Manda ele esvaziar antes.
  const inUse = await scopedPrisma(input.companyId).calendarEvent.count({ where: { typeId: input.id } })
  if (inUse > 0) {
    throw new CalendarEventError('Este tipo ainda tem eventos. Remova ou mude o tipo deles primeiro.', 409)
  }

  await prisma.calendarEventType.delete({ where: { id: input.id } })
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'CalendarEventType',
    entityId: input.id,
    action: 'DELETE',
    companyId: input.companyId,
    before,
  })
}

// ---------------------------------------------------------------- eventos

/**
 * Tags do público-alvo prontas para o banco: sem espaço sobrando, sem vazia e
 * sem repetida. A deduplicação é pela forma **comparável** (`G&G` e `g & g` são
 * a mesma tag) mas o que fica gravado é a primeira grafia digitada — é ela que
 * a tela mostra.
 */
function normalizeAudience(tags: readonly string[] | undefined): string[] {
  const vistas = new Set<string>()
  const out: string[] = []
  for (const bruta of tags ?? []) {
    const tag = bruta.trim()
    if (!tag) continue
    const chave = normalizeAudienceTag(tag)
    if (!chave || vistas.has(chave)) continue
    vistas.add(chave)
    out.push(tag)
  }
  return out
}

/** Valida a regra e devolve os campos já normalizados para o banco. */
async function normalize(
  data: UpsertCalendarEventRequest,
  companyId: string,
): Promise<{
  title: string
  description: string
  date: Date
  endDate: Date | null
  startTime: string | null
  endTime: string | null
  typeId: string
  color: string | null
  audienceTags: string[]
  isInternalComm: boolean
  recurrence: CalendarRecurrence
  recurrenceUntil: Date | null
  recurrenceCount: number | null
  reminderDaysBefore: number[]
  sectorIds: string[]
}> {
  const title = data.title.trim()
  if (!title) throw new CalendarEventError('Informe o título do evento.')

  const type = await scopedPrisma(companyId).calendarEventType.findFirst({ where: { id: data.typeId } })
  if (!type) throw new CalendarEventError('Tipo de evento não encontrado.', 404)

  if (data.endDate && data.endDate < data.date) {
    throw new CalendarEventError('A data de fim não pode ser anterior à de início.')
  }
  // Hora de fim sem hora de início não diz nada, e num evento de um dia só ela
  // precisa vir depois — senão a faixa da grade nasceria com altura negativa.
  if (data.endTime && !data.startTime) {
    throw new CalendarEventError('Informe a hora de início antes da hora de fim.')
  }
  if (data.startTime && data.endTime && !data.endDate && data.endTime <= data.startTime) {
    throw new CalendarEventError('A hora de fim precisa ser depois da de início.')
  }

  const recurrence = data.recurrence ?? 'NONE'
  if (recurrence === 'NONE' && (data.recurrenceUntil || data.recurrenceCount)) {
    throw new CalendarEventError('Evento sem repetição não tem fim de recorrência.')
  }
  if (data.recurrenceUntil && data.recurrenceCount) {
    throw new CalendarEventError('Escolha um fim para a repetição: data ou número de ocorrências, não os dois.')
  }
  if (data.recurrenceUntil && data.recurrenceUntil < data.date) {
    throw new CalendarEventError('O fim da repetição não pode ser anterior à data do evento.')
  }

  const sectorIds = [...new Set(data.sectorIds ?? [])]
  if (sectorIds.length > 0) {
    const found = await scopedPrisma(companyId).sector.count({ where: { id: { in: sectorIds } } })
    if (found !== sectorIds.length) throw new CalendarEventError('Setor não encontrado.', 404)
  }

  return {
    title,
    description: (data.description ?? '').trim(),
    date: dayFromYmd(data.date),
    // Fim igual ao início é evento de um dia: guardar `null` mantém uma leitura
    // só de "cabe num dia", em vez de duas equivalentes.
    endDate: data.endDate && data.endDate !== data.date ? dayFromYmd(data.endDate) : null,
    startTime: data.startTime ?? null,
    endTime: data.startTime ? (data.endTime ?? null) : null,
    typeId: data.typeId,
    // Cor igual à da categoria não vira sobrescrita: assim, mudar a cor da
    // categoria depois arrasta os eventos dela junto, que é o esperado.
    color: data.color && data.color.toLowerCase() !== type.color.toLowerCase() ? data.color.toLowerCase() : null,
    audienceTags: normalizeAudience(data.audienceTags),
    isInternalComm: data.isInternalComm ?? false,
    recurrence,
    recurrenceUntil: data.recurrenceUntil ? dayFromYmd(data.recurrenceUntil) : null,
    recurrenceCount: data.recurrenceCount ?? null,
    // Ordenado e sem repetição: a lista vira chave de lembrete, e ordem
    // instável faria dois cadastros iguais parecerem diferentes na auditoria.
    reminderDaysBefore: [...new Set(data.reminderDaysBefore ?? [])].sort((a, b) => a - b),
    sectorIds,
  }
}

/**
 * Liderança só mexe no que ela mesma criou; admin e subadmin do bloco mexem em
 * qualquer um. Sem isso, um líder apagaria o comunicado da empresa inteira
 * publicado por outra pessoa.
 */
function assertCanEdit(
  actor: { actorId: string; actorRole: string; actorFeatures: string[]; actorAdminAccess?: boolean },
  event: { createdById: string; isInternalComm: boolean },
): void {
  // Evento interno que a pessoa não pode nem VER responde "não encontrado", e
  // não "sem permissão": 403 confirmaria a existência do registro que a G&G
  // marcou justamente para não existir fora dela.
  if (event.isInternalComm && !canSeeInternalCalendarEvents(actor.actorRole, actor.actorFeatures, actor.actorAdminAccess)) {
    throw new CalendarEventError('Evento não encontrado.', 404)
  }
  const pode = canEditCalendarEvent(
    {
      id: actor.actorId,
      role: actor.actorRole,
      sectorFeatures: actor.actorFeatures,
      adminAccess: actor.actorAdminAccess,
    },
    event,
  )
  if (!pode) throw new CalendarEventError('Você só pode editar eventos que cadastrou.', 403)
}

/**
 * Lista de gestão. O recorte de comunicação interna vale aqui também: quem
 * cadastra evento não é necessariamente do time de G&G — a liderança cadastra e
 * não pode enxergar o que a G&G marcou como interno.
 */
export async function listEvents(viewer: {
  companyId: string
  role: string | null
  sectorFeatures: string[]
  adminAccess?: boolean
}): Promise<CalendarEventDTO[]> {
  const veInterno = canSeeInternalCalendarEvents(viewer.role, viewer.sectorFeatures, viewer.adminAccess)
  const events = await scopedPrisma(viewer.companyId).calendarEvent.findMany({
    where: veInterno ? {} : { isInternalComm: false },
    include: WITH_RELATIONS,
    orderBy: { date: 'desc' },
  })
  return events.map(toCalendarEventDTO)
}

/**
 * Um evento inteiro, para o formulário de edição. Existe porque a tela do
 * calendário só tem OCORRÊNCIAS (data expandida, sem a regra que as gerou), e
 * editar exige a regra: recorrência, setores, lembretes. Passa pelas mesmas
 * guardas de edição — quem não pode mexer não lê o cadastro.
 */
export async function getManagedEvent(input: {
  id: string
  actorId: string
  actorRole: string
  actorFeatures: string[]
  actorAdminAccess?: boolean
  companyId: string
}): Promise<CalendarEventDTO> {
  const event = await scopedPrisma(input.companyId).calendarEvent.findFirst({
    where: { id: input.id },
    include: WITH_RELATIONS,
  })
  if (!event) throw new CalendarEventError('Evento não encontrado.', 404)
  assertCanEdit(input, event)
  return toCalendarEventDTO(event)
}

export async function createEvent(input: {
  data: UpsertCalendarEventRequest
  actorId: string
  companyId: string
}): Promise<CalendarEventDTO> {
  const normalized = await normalize(input.data, input.companyId)
  const { sectorIds, ...fields } = normalized

  const event = await prisma.calendarEvent.create({
    data: {
      ...fields,
      createdById: input.actorId,
      companyId: input.companyId,
      sectors: { create: sectorIds.map((sectorId) => ({ sectorId })) },
    },
    include: WITH_RELATIONS,
  })
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'CalendarEvent',
    entityId: event.id,
    action: 'CREATE',
    companyId: input.companyId,
    after: toCalendarEventDTO(event),
  })
  return toCalendarEventDTO(event)
}

export async function updateEvent(input: {
  id: string
  data: UpsertCalendarEventRequest
  actorId: string
  actorRole: string
  actorFeatures: string[]
  actorAdminAccess?: boolean
  companyId: string
}): Promise<CalendarEventDTO> {
  const before = await scopedPrisma(input.companyId).calendarEvent.findFirst({
    where: { id: input.id },
    include: WITH_RELATIONS,
  })
  if (!before) throw new CalendarEventError('Evento não encontrado.', 404)
  assertCanEdit(input, before)

  const normalized = await normalize(input.data, input.companyId)
  const { sectorIds, ...fields } = normalized

  const event = await prisma.$transaction(async (tx) => {
    await tx.calendarEventSector.deleteMany({ where: { eventId: input.id } })
    return tx.calendarEvent.update({
      where: { id: input.id },
      data: { ...fields, sectors: { create: sectorIds.map((sectorId) => ({ sectorId })) } },
      include: WITH_RELATIONS,
    })
  })

  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'CalendarEvent',
    entityId: event.id,
    action: 'UPDATE',
    companyId: input.companyId,
    before: toCalendarEventDTO(before),
    after: toCalendarEventDTO(event),
  })
  return toCalendarEventDTO(event)
}

export async function deleteEvent(input: {
  id: string
  actorId: string
  actorRole: string
  actorFeatures: string[]
  actorAdminAccess?: boolean
  companyId: string
}): Promise<void> {
  const before = await scopedPrisma(input.companyId).calendarEvent.findFirst({
    where: { id: input.id },
    include: WITH_RELATIONS,
  })
  if (!before) throw new CalendarEventError('Evento não encontrado.', 404)
  assertCanEdit(input, before)

  // Cascade leva setores e reivindicações de lembrete junto: apagado o evento,
  // lembrete pendente some com ele — que é o comportamento esperado.
  await prisma.calendarEvent.delete({ where: { id: input.id } })
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'CalendarEvent',
    entityId: input.id,
    action: 'DELETE',
    companyId: input.companyId,
    before: toCalendarEventDTO(before),
  })
}

// ---------------------------------------------------------------- leitura do calendário

/**
 * Eventos que alcançam um setor: os sem público-alvo (empresa inteira) mais os
 * marcados para aquele setor. Usuário sem setor (ex.: admin da empresa) vê só
 * os de empresa inteira — não há setor dele para casar.
 */
function visibilityWhere(sectorId: string | null) {
  return sectorId
    ? { OR: [{ sectors: { none: {} } }, { sectors: { some: { sectorId } } }] }
    : { sectors: { none: {} } }
}

/**
 * Quem está pedindo o calendário — o que decide o que ele alcança. Vem do
 * token, exceto o nome do setor e o cargo: esses dois saem do banco a cada
 * leitura, porque não são claim do JWT e pôr lá faria toda troca de cargo
 * esperar até 15 minutos para valer no público-alvo.
 */
export interface CalendarViewer {
  userId: string
  companyId: string
  sectorId: string | null
  sectorFeatures: string[]
  role: string | null
  adminAccess?: boolean
}

/**
 * As ocorrências que caem em `[from, to]` para quem está pedindo, já expandidas
 * a partir da regra de recorrência.
 *
 * O recorte por data no banco é grosseiro de propósito: um evento recorrente
 * começa antes da janela e ainda assim tem ocorrência dentro dela, então o
 * `where` só descarta o que **começa depois** do fim da janela (e o que já
 * terminou). Quem decide de fato é o `expandOccurrences`.
 *
 * Três recortes de público, todos no backend — evento que a pessoa não alcança
 * nunca sai daqui:
 *
 * 1. **Setor** (`CalendarEventSector`), no `where`.
 * 2. **Comunicação interna**, no `where`: só admin e time de G&G.
 * 3. **Tags de público-alvo**, em memória. Fica fora do SQL porque a comparação
 *    é normalizada (sem acento, sem caixa, sem pontuação) e o conjunto já está
 *    limitado à janela — empurrar isso para o Postgres exigiria uma coluna
 *    espelho só para o `hasSome`.
 */
export async function listOccurrences(
  input: CalendarViewer & { from: string; to: string },
): Promise<CalendarEventOccurrenceDTO[]> {
  if (input.from > input.to) throw new CalendarEventError('Intervalo inválido.')
  const span = (dayFromYmd(input.to).getTime() - dayFromYmd(input.from).getTime()) / 86_400_000
  if (span > MAX_CALENDAR_EVENT_RANGE_DAYS) {
    throw new CalendarEventError('Intervalo muito longo.')
  }

  const veInterno = canSeeInternalCalendarEvents(input.role, input.sectorFeatures, input.adminAccess)
  const perfil = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { position: true, sector: { select: { name: true } } },
  })
  const minhasTags = viewerAudienceTags({
    role: input.role,
    sectorName: perfil?.sector?.name ?? null,
    sectorFeatures: input.sectorFeatures,
    position: perfil?.position ?? null,
  })

  const events = await scopedPrisma(input.companyId).calendarEvent.findMany({
    where: {
      AND: [
        visibilityWhere(input.sectorId),
        ...(veInterno ? [] : [{ isInternalComm: false }]),
        { date: { lte: dayFromYmd(input.to) } },
        { OR: [{ recurrenceUntil: null }, { recurrenceUntil: { gte: dayFromYmd(input.from) } }] },
        // Evento sem repetição que já passou não interessa; com repetição, a
        // data é só o começo da série e o corte fica com a expansão. `endDate`
        // entra na conta porque um evento de vários dias que COMEÇOU antes da
        // janela ainda está acontecendo dentro dela.
        {
          OR: [
            { recurrence: { not: 'NONE' } },
            { date: { gte: dayFromYmd(input.from) } },
            { endDate: { gte: dayFromYmd(input.from) } },
          ],
        },
      ],
    },
    include: { type: true, createdBy: { select: { name: true } } },
  })

  const occurrences: CalendarEventOccurrenceDTO[] = []
  for (const event of events) {
    if (!audienceReaches(event.audienceTags, minhasTags)) continue

    const inicio = ymdOf(event.date)
    // Duração em dias da regra, replicada em cada ocorrência: evento de 3 dias
    // que se repete todo mês ocupa 3 dias em cada mês, e não só no primeiro.
    const duracao = event.endDate
      ? Math.round((dayFromYmd(ymdOf(event.endDate)).getTime() - dayFromYmd(inicio).getTime()) / 86_400_000)
      : 0
    // A janela da expansão abre `duracao` dias antes: a ocorrência que começa
    // fora dela mas termina dentro precisa aparecer, senão o dia 1 do mês não
    // mostra a campanha que começou no fim do mês anterior.
    const isos = expandOccurrences(
      {
        date: inicio,
        recurrence: event.recurrence,
        recurrenceUntil: event.recurrenceUntil ? ymdOf(event.recurrenceUntil) : null,
        recurrenceCount: event.recurrenceCount,
      },
      addDays(input.from, -duracao),
      input.to,
    )
    for (const iso of isos) {
      const endIso = duracao > 0 ? addDays(iso, duracao) : iso
      if (endIso < input.from) continue
      occurrences.push({
        eventId: event.id,
        iso,
        endIso,
        title: event.title,
        description: event.description,
        startTime: event.startTime,
        endTime: event.endTime,
        typeSlug: event.type.slug,
        typeName: event.type.name,
        typeIcon: event.type.icon,
        color: event.color ?? event.type.color ?? CALENDAR_CATEGORY_FALLBACK_COLOR,
        audienceTags: event.audienceTags,
        isInternalComm: event.isInternalComm,
        createdById: event.createdById,
        createdByName: event.createdBy.name,
        createdAt: event.createdAt.toISOString(),
      })
    }
  }
  return occurrences
}

/**
 * Os eventos com lembrete configurado cuja ocorrência cai na janela que o
 * scheduler precisa olhar hoje: da data de hoje até a maior antecedência
 * possível à frente. Devolve o evento cru — quem expande e decide é o tick.
 */
export async function listEventsWithReminders(todayYmd: string, maxOffset: number) {
  return prisma.calendarEvent.findMany({
    where: {
      NOT: { reminderDaysBefore: { isEmpty: true } },
      OR: [{ recurrenceUntil: null }, { recurrenceUntil: { gte: dayFromYmd(todayYmd) } }],
      date: { lte: dayFromYmd(addDays(todayYmd, maxOffset)) },
    },
    include: { type: true, sectors: { select: { sectorId: true } } },
  })
}
