import { describe, expect, it, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { DEFAULT_COMPANY_ID, createEmptyMapDocumentV1 } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  OfficeMeetingConflictError,
  OfficeMeetingError,
  buildMeetingIcsFor,
  cancelOfficeMeeting,
  createOfficeMeeting,
  listRoomMeetings,
  updateOfficeMeeting,
} from './office-meeting-service'

/** Mapa ativo com uma sala 'aurora' — o service valida que a sala existe. */
async function seedMapWithRoom() {
  const document = createEmptyMapDocumentV1({ width: 25, height: 18, tileSize: 32 })
  document.objects.push({
    id: 'room-aurora',
    type: 'meeting-room',
    geometry: { kind: 'rectangle', x: 64, y: 64, width: 160, height: 128 },
    properties: { externalKey: 'aurora', name: 'Aurora', status: 'OPEN', voiceEnabled: true, accessPolicy: 'OPEN' },
  } as never)
  const map = await prisma.officeMap.create({ data: { name: 'Mapa', companyId: DEFAULT_COMPANY_ID } })
  const publication = await prisma.officeMapPublication.create({
    data: {
      mapId: map.id,
      version: 1,
      schemaVersion: document.schemaVersion,
      mapData: document as unknown as Prisma.InputJsonValue,
      companyId: DEFAULT_COMPANY_ID,
    },
  })
  await prisma.officeSetting.create({ data: { companyId: DEFAULT_COMPANY_ID, activeMapPublicationId: publication.id } })
  // `officeMapPublication.create` acima grava o objeto 'meeting-room' só dentro do JSON
  // `mapData` — quem materializa isso em linhas `OfficeRoom` reais é `publishMap`
  // (não chamado aqui). `getActiveOfficeMap` lê de `OfficeRoom`, então sem esta linha
  // toda resolução de sala do service daria 404 (mesmo padrão usado em
  // office-map-service.test.ts > seedRoomAndDesk).
  await prisma.officeRoom.create({
    data: {
      mapPublicationId: publication.id,
      name: 'Aurora',
      externalKey: 'aurora',
      companyId: DEFAULT_COMPANY_ID,
    },
  })
}

async function makeUser(name: string) {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
  })
}

const BASE = {
  roomExternalKey: 'aurora',
  title: 'Planning',
  agenda: null as string | null,
  durationMinutes: 60 as const,
  force: false,
}

beforeEach(seedMapWithRoom)

describe('createOfficeMeeting', () => {
  it('cria a reunião com participantes e notifica cada convidado', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')

    const dto = await createOfficeMeeting({
      ...BASE,
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'),
      participantIds: [bruno.id],
    })

    expect(dto.title).toBe('Planning')
    expect(dto.roomName).toBe('Aurora')
    expect(dto.endsAt).toBe('2099-01-10T15:00:00.000Z')
    expect(dto.participants).toEqual([{ id: bruno.id, name: 'Bruno' }])

    const notifications = await prisma.notification.findMany({ where: { userId: bruno.id } })
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.type).toBe('MEETING_INVITED')
    expect(notifications[0]!.link).toBe('/escritorio?sala=aurora')
  })

  it('recusa sala que não existe no mapa ativo', async () => {
    const ana = await makeUser('Ana')
    await expect(
      createOfficeMeeting({
        ...BASE,
        roomExternalKey: 'inexistente',
        companyId: DEFAULT_COMPANY_ID,
        organizerId: ana.id,
        startsAt: new Date('2099-01-10T14:00:00.000Z'),
        participantIds: [],
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('escritório sem mapa publicado é 404, não 500', async () => {
    // `getActiveOfficeMap` lança `OfficeMapError` aqui; se o service deixasse
    // passar, a route responderia 500 (sendDomainError só traduz OfficeMeetingError).
    await prisma.officeSetting.updateMany({
      where: { companyId: DEFAULT_COMPANY_ID },
      data: { activeMapPublicationId: null },
    })
    const ana = await makeUser('Ana')
    const criando = createOfficeMeeting({
      ...BASE,
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'),
      participantIds: [],
    })
    await expect(criando).rejects.toBeInstanceOf(OfficeMeetingError)
    await expect(criando).rejects.toMatchObject({ status: 404 })
  })

  it('tira o organizador da lista de participantes', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')

    const dto = await createOfficeMeeting({
      ...BASE,
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'),
      participantIds: [ana.id, bruno.id],
    })

    expect(dto.participants).toEqual([{ id: bruno.id, name: 'Bruno' }])
    // Nada de convite para si mesmo.
    expect(await prisma.notification.count({ where: { userId: ana.id } })).toBe(0)
  })

  it('recusa horário no passado', async () => {
    const ana = await makeUser('Ana')
    await expect(
      createOfficeMeeting({
        ...BASE,
        companyId: DEFAULT_COMPANY_ID,
        organizerId: ana.id,
        startsAt: new Date('2020-01-10T14:00:00.000Z'),
        participantIds: [],
      }),
    ).rejects.toBeInstanceOf(OfficeMeetingError)
  })

  it('recusa participante de outra empresa', async () => {
    const ana = await makeUser('Ana')
    // `Company.slug` é obrigatório e único no schema; o brief omitiu — sem ele o
    // `prisma.company.create` falha com PrismaClientValidationError antes mesmo
    // de chegar na asserção de status 400 que este teste verifica.
    const outra = await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'company-outra' } })
    const forasteiro = await prisma.user.create({
      data: { name: 'Zé', email: 'ze@y.com', passwordHash: 'x', role: 'LEGEND', companyId: outra.id },
    })
    await expect(
      createOfficeMeeting({
        ...BASE,
        companyId: DEFAULT_COMPANY_ID,
        organizerId: ana.id,
        startsAt: new Date('2099-01-10T14:00:00.000Z'),
        participantIds: [forasteiro.id],
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('barra horário sobreposto na mesma sala com 409 e lista o conflito', async () => {
    const ana = await makeUser('Ana')
    await createOfficeMeeting({
      ...BASE,
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'),
      participantIds: [],
    })

    const overlapping = createOfficeMeeting({
      ...BASE,
      title: 'Outra',
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:30:00.000Z'),
      participantIds: [],
    })

    await expect(overlapping).rejects.toBeInstanceOf(OfficeMeetingConflictError)
    await overlapping.catch((err: OfficeMeetingConflictError) => {
      expect(err.conflicts).toHaveLength(1)
      expect(err.conflicts[0]!.title).toBe('Planning')
    })
  })

  it('encostar sem sobrepor não é conflito', async () => {
    const ana = await makeUser('Ana')
    await createOfficeMeeting({
      ...BASE,
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'),
      participantIds: [],
    })
    const encostada = await createOfficeMeeting({
      ...BASE,
      title: 'Logo depois',
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T15:00:00.000Z'),
      participantIds: [],
    })
    expect(encostada.title).toBe('Logo depois')
  })

  it('force ignora o conflito', async () => {
    const ana = await makeUser('Ana')
    await createOfficeMeeting({
      ...BASE,
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'),
      participantIds: [],
    })
    const forcada = await createOfficeMeeting({
      ...BASE,
      title: 'Forçada',
      force: true,
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:30:00.000Z'),
      participantIds: [],
    })
    expect(forcada.title).toBe('Forçada')
  })
})

describe('updateOfficeMeeting', () => {
  it('só o organizador edita', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const dto = await createOfficeMeeting({
      ...BASE, companyId: DEFAULT_COMPANY_ID, organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'), participantIds: [bruno.id],
    })
    await expect(
      updateOfficeMeeting(dto.id, bruno.id, DEFAULT_COMPANY_ID, { title: 'Sequestrada' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('muda o horário, sobe o sequence e notifica os participantes', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const dto = await createOfficeMeeting({
      ...BASE, companyId: DEFAULT_COMPANY_ID, organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'), participantIds: [bruno.id],
    })

    const updated = await updateOfficeMeeting(dto.id, ana.id, DEFAULT_COMPANY_ID, {
      startsAt: new Date('2099-01-10T16:00:00.000Z'),
    })

    expect(updated.startsAt).toBe('2099-01-10T16:00:00.000Z')
    expect(updated.endsAt).toBe('2099-01-10T17:00:00.000Z')
    const row = await prisma.officeMeeting.findUniqueOrThrow({ where: { id: dto.id } })
    expect(row.sequence).toBe(1)
    // remindedAt zera: o lembrete do horário antigo não vale mais.
    expect(row.remindedAt).toBeNull()
    const notifications = await prisma.notification.findMany({ where: { userId: bruno.id, type: 'MEETING_UPDATED' } })
    expect(notifications).toHaveLength(1)
  })

  it('avisa cada grupo com o texto certo: quem entrou, quem ficou e quem saiu', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const carla = await makeUser('Carla')
    const dina = await makeUser('Dina')
    const dto = await createOfficeMeeting({
      ...BASE, companyId: DEFAULT_COMPANY_ID, organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'), participantIds: [bruno.id, carla.id],
    })

    // Bruno fica, Carla sai, Dina entra.
    await updateOfficeMeeting(dto.id, ana.id, DEFAULT_COMPANY_ID, {
      startsAt: new Date('2099-01-10T16:00:00.000Z'),
      participantIds: [bruno.id, dina.id],
    })

    const tiposDe = async (userId: string) =>
      (await prisma.notification.findMany({ where: { userId }, select: { type: true } }))
        .map((n) => n.type)
        .sort()
    const textoDe = async (userId: string, type: 'MEETING_INVITED' | 'MEETING_UPDATED' | 'MEETING_CANCELED') =>
      (await prisma.notification.findFirst({ where: { userId, type } }))?.title

    // Quem ficou: MEETING_UPDATED (além do convite original).
    expect(await tiposDe(bruno.id)).toEqual(['MEETING_INVITED', 'MEETING_UPDATED'])
    expect(await textoDe(bruno.id, 'MEETING_UPDATED')).toContain('mudou')

    // Quem entrou agora: convite, nunca "mudou" — ele nunca ouviu falar da reunião.
    expect(await tiposDe(dina.id)).toEqual(['MEETING_INVITED'])
    expect(await textoDe(dina.id, 'MEETING_INVITED')).toContain('Ana marcou "Planning"')

    // Quem saiu: avisado de que caiu da lista, não de que a reunião foi cancelada.
    expect(await tiposDe(carla.id)).toEqual(['MEETING_CANCELED', 'MEETING_INVITED'])
    expect(await textoDe(carla.id, 'MEETING_CANCELED')).toContain('saiu da lista')
    expect(await textoDe(carla.id, 'MEETING_CANCELED')).toContain('continua marcada')
  })

  it('tira o organizador da lista mesmo quando a edição o inclui', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const dto = await createOfficeMeeting({
      ...BASE, companyId: DEFAULT_COMPANY_ID, organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'), participantIds: [bruno.id],
    })

    const updated = await updateOfficeMeeting(dto.id, ana.id, DEFAULT_COMPANY_ID, {
      participantIds: [ana.id, bruno.id],
    })

    expect(updated.participants).toEqual([{ id: bruno.id, name: 'Bruno' }])
    expect(await prisma.notification.count({ where: { userId: ana.id } })).toBe(0)
  })

  it('reunião de outra empresa é 404', async () => {
    const ana = await makeUser('Ana')
    const dto = await createOfficeMeeting({
      ...BASE, companyId: DEFAULT_COMPANY_ID, organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'), participantIds: [],
    })
    await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'company-outra' } })
    await expect(
      updateOfficeMeeting(dto.id, ana.id, 'company-outra', { title: 'X' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('cancelOfficeMeeting', () => {
  it('marca canceledAt, notifica e recusa cancelar duas vezes', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const dto = await createOfficeMeeting({
      ...BASE, companyId: DEFAULT_COMPANY_ID, organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'), participantIds: [bruno.id],
    })

    const canceled = await cancelOfficeMeeting(dto.id, ana.id, DEFAULT_COMPANY_ID)
    expect(canceled.canceled).toBe(true)
    const notifications = await prisma.notification.findMany({ where: { userId: bruno.id, type: 'MEETING_CANCELED' } })
    expect(notifications).toHaveLength(1)

    await expect(cancelOfficeMeeting(dto.id, ana.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 409 })
  })
})

describe('buildMeetingIcsFor', () => {
  it('entrega o arquivo ao participante e barra quem não foi convidado', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const carla = await makeUser('Carla')
    const dto = await createOfficeMeeting({
      ...BASE, companyId: DEFAULT_COMPANY_ID, organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'), participantIds: [bruno.id],
    })

    const { filename, ics } = await buildMeetingIcsFor(dto.id, bruno.id, DEFAULT_COMPANY_ID)
    expect(filename).toBe('planning.ics')
    expect(ics).toContain('BEGIN:VCALENDAR')

    await expect(buildMeetingIcsFor(dto.id, carla.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 403 })
  })
})

describe('listRoomMeetings', () => {
  it('devolve só as da sala e da janela pedida, em ordem cronológica', async () => {
    const ana = await makeUser('Ana')
    const dentro = await createOfficeMeeting({
      ...BASE,
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'),
      participantIds: [],
    })
    await createOfficeMeeting({
      ...BASE,
      title: 'Muito depois',
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-03-10T14:00:00.000Z'),
      participantIds: [],
    })

    const lista = await listRoomMeetings(
      DEFAULT_COMPANY_ID,
      'aurora',
      new Date('2099-01-01T00:00:00.000Z'),
      new Date('2099-01-31T00:00:00.000Z'),
    )
    expect(lista.map((m) => m.id)).toEqual([dentro.id])
  })
})
