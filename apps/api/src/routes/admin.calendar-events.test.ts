import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

type App = ReturnType<typeof buildApp>

async function registerUser(app: App, name: string, email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name, email, password: 'changeme123' },
  })
  return { token: res.json().accessToken as string, id: res.json().user.id as string }
}

function tokenFor(
  app: App,
  user: { id: string },
  opts: { role: string; sectorId?: string; companyId?: string; features?: string[] },
) {
  return app.jwt.sign({
    sub: user.id,
    role: opts.role,
    sectorId: opts.sectorId ?? DEFAULT_SECTOR_ID,
    companyId: opts.companyId ?? DEFAULT_COMPANY_ID,
    features: opts.features ?? [],
  })
}

async function seedType(name = 'Provas B2B', slug = 'provas-b2b', companyId = DEFAULT_COMPANY_ID) {
  return prisma.calendarEventType.create({ data: { name, slug, icon: 'quiz', companyId } })
}

const BASE = {
  title: 'Prova Inspirali',
  description: 'Prova de residência do parceiro',
  date: '2026-09-10',
}

describe('admin de eventos de calendário', () => {
  it('exige autenticação', async () => {
    const app = buildApp()
    await app.ready()
    expect((await app.inject({ method: 'GET', url: '/calendar/managed-events' })).statusCode).toBe(401)
    await app.close()
  })

  it('ADMIN global entra mesmo sem a feature no setor', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-cal-ev@x.com')
    const res = await app.inject({
      method: 'GET',
      url: '/calendar/managed-events',
      headers: { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ events: [], types: [] })
    await app.close()
  })

  it('SUBADMIN sem a feature desenvolvimento-produto leva 403', async () => {
    const app = buildApp()
    await app.ready()
    const sub = await registerUser(app, 'Sub', 'sub-cal-ev@x.com')
    const res = await app.inject({
      method: 'GET',
      url: '/calendar/managed-events',
      headers: { authorization: `Bearer ${tokenFor(app, sub, { role: 'SUBADMIN', features: ['gente-gestao'] })}` },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('SUBADMIN do setor com a feature entra', async () => {
    const app = buildApp()
    await app.ready()
    const sub = await registerUser(app, 'Sub', 'sub-cal-ev-ok@x.com')
    const res = await app.inject({
      method: 'GET',
      url: '/calendar/managed-events',
      headers: {
        authorization: `Bearer ${tokenFor(app, sub, { role: 'SUBADMIN', features: ['desenvolvimento-produto'] })}`,
      },
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('cria um tipo e recusa nome repetido', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-tipo@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }

    const criado = await app.inject({
      method: 'POST',
      url: '/admin/calendar-event-types',
      headers,
      payload: { name: 'Provas B2B', icon: 'quiz' },
    })
    expect(criado.statusCode).toBe(201)
    expect(criado.json().type.slug).toBe('provas-b2b')

    const repetido = await app.inject({
      method: 'POST',
      url: '/admin/calendar-event-types',
      headers,
      payload: { name: 'provas b2b' },
    })
    expect(repetido.statusCode).toBe(409)
    await app.close()
  })

  it('não apaga tipo que ainda tem evento', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-tipo-uso@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }
    const type = await seedType()
    await app.inject({ method: 'POST', url: '/calendar/events', headers, payload: { ...BASE, typeId: type.id } })

    const res = await app.inject({ method: 'DELETE', url: `/admin/calendar-event-types/${type.id}`, headers })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('cria evento com público-alvo, lembrete e recorrência', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-ev-full@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }
    const type = await seedType()
    const sector = await prisma.sector.create({
      data: { name: 'Comercial', slug: 'comercial-ev', enabledFeatures: ['calendario'] },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: {
        ...BASE,
        typeId: type.id,
        sectorIds: [sector.id],
        reminderDaysBefore: [7, 1],
        recurrence: 'MONTHLY',
        recurrenceCount: 3,
        startTime: '08:30',
      },
    })
    expect(res.statusCode).toBe(201)
    const event = res.json().event
    expect(event.sectorIds).toEqual([sector.id])
    expect(event.sectorNames).toEqual(['Comercial'])
    // Antecedências chegam ordenadas: a lista vira chave de lembrete.
    expect(event.reminderDaysBefore).toEqual([1, 7])
    expect(event.recurrence).toBe('MONTHLY')
    expect(event.date).toBe('2026-09-10')
    await app.close()
  })

  it('recusa fim de recorrência duplo e fim anterior à data', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-ev-inv@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }
    const type = await seedType()

    const duplo = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, typeId: type.id, recurrence: 'WEEKLY', recurrenceUntil: '2026-12-01', recurrenceCount: 4 },
    })
    expect(duplo.statusCode).toBe(400)

    const antes = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, typeId: type.id, recurrence: 'WEEKLY', recurrenceUntil: '2026-08-01' },
    })
    expect(antes.statusCode).toBe(400)
    await app.close()
  })

  it('recusa payload sem título e sem data', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-ev-zod@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }
    const type = await seedType()

    const semTitulo = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { title: '  ', date: '2026-09-10', typeId: type.id },
    })
    expect(semTitulo.statusCode).toBe(400)

    const semData = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { title: 'X', typeId: type.id },
    })
    expect(semData.statusCode).toBe(400)
    await app.close()
  })

  it('edita e apaga o evento', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-ev-crud@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }
    const type = await seedType()
    const sector = await prisma.sector.create({
      data: { name: 'Setor Alvo', slug: 'setor-alvo-ev', enabledFeatures: ['calendario'] },
    })
    const criado = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, typeId: type.id, sectorIds: [sector.id] },
    })
    const id = criado.json().event.id as string

    const editado = await app.inject({
      method: 'PATCH',
      url: `/calendar/events/${id}`,
      headers,
      payload: { ...BASE, title: 'Prova remarcada', date: '2026-09-17', typeId: type.id, sectorIds: [] },
    })
    expect(editado.statusCode).toBe(200)
    expect(editado.json().event.title).toBe('Prova remarcada')
    // Público-alvo esvaziado volta a ser "empresa inteira".
    expect(editado.json().event.sectorIds).toEqual([])

    expect((await app.inject({ method: 'DELETE', url: `/calendar/events/${id}`, headers })).statusCode).toBe(204)
    expect(await prisma.calendarEvent.count()).toBe(0)
    await app.close()
  })

  it('não enxerga evento de outra empresa', async () => {
    const app = buildApp()
    await app.ready()
    const outra = await prisma.company.create({ data: { name: 'Outra', slug: 'outra-cal-ev' } })
    const type = await seedType('Prazos', 'prazos', outra.id)
    await prisma.calendarEventType.findFirstOrThrow({ where: { id: type.id } })
    const dono = await prisma.user.create({
      data: {
        name: 'Dono',
        email: 'dono-outra-cal@x.com',
        passwordHash: 'x',
        sectorId: DEFAULT_SECTOR_ID,
        companyId: outra.id,
      },
    })
    await prisma.calendarEvent.create({
      data: { title: 'Fechamento', date: new Date('2026-09-01'), typeId: type.id, createdById: dono.id, companyId: outra.id },
    })

    const admin = await registerUser(app, 'Admin', 'admin-cross-cal@x.com')
    const res = await app.inject({
      method: 'GET',
      url: '/calendar/managed-events',
      headers: { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().events).toEqual([])
    expect(res.json().types).toEqual([])
    await app.close()
  })
})

describe('GET /calendar/events', () => {
  it('exige a feature calendario', async () => {
    const app = buildApp()
    await app.ready()
    const user = await registerUser(app, 'Zé', 'ze-sem-cal@x.com')
    const res = await app.inject({
      method: 'GET',
      url: '/calendar/events?from=2026-09-01&to=2026-09-30',
      headers: { authorization: `Bearer ${tokenFor(app, user, { role: 'COLLABORATOR', features: [] })}` },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('expande a recorrência dentro da janela pedida', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-occ@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }
    const type = await seedType()
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, date: '2026-09-01', typeId: type.id, recurrence: 'WEEKLY' },
    })

    const user = await registerUser(app, 'Colega', 'colega-occ@x.com')
    const res = await app.inject({
      method: 'GET',
      url: '/calendar/events?from=2026-09-01&to=2026-09-30',
      headers: { authorization: `Bearer ${tokenFor(app, user, { role: 'COLLABORATOR', features: ['calendario'] })}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().occurrences.map((o: { iso: string }) => o.iso)).toEqual([
      '2026-09-01',
      '2026-09-08',
      '2026-09-15',
      '2026-09-22',
      '2026-09-29',
    ])
    expect(res.json().types).toHaveLength(1)
    await app.close()
  })

  it('evento restrito a setores não sai para quem está fora do público', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-alvo@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }
    const type = await seedType()
    const alvo = await prisma.sector.create({
      data: { name: 'Alvo', slug: 'alvo-occ', enabledFeatures: ['calendario'] },
    })
    const fora = await prisma.sector.create({
      data: { name: 'Fora', slug: 'fora-occ', enabledFeatures: ['calendario'] },
    })
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, date: '2026-09-10', typeId: type.id, sectorIds: [alvo.id] },
    })

    const dentro = await registerUser(app, 'Dentro', 'dentro-occ@x.com')
    const deFora = await registerUser(app, 'Fora', 'fora-occ@x.com')
    const url = '/calendar/events?from=2026-09-01&to=2026-09-30'

    const resDentro = await app.inject({
      method: 'GET',
      url,
      headers: {
        authorization: `Bearer ${tokenFor(app, dentro, { role: 'COLLABORATOR', sectorId: alvo.id, features: ['calendario'] })}`,
      },
    })
    expect(resDentro.json().occurrences).toHaveLength(1)

    const resFora = await app.inject({
      method: 'GET',
      url,
      headers: {
        authorization: `Bearer ${tokenFor(app, deFora, { role: 'COLLABORATOR', sectorId: fora.id, features: ['calendario'] })}`,
      },
    })
    expect(resFora.json().occurrences).toEqual([])
    await app.close()
  })

  it('evento sem público-alvo alcança qualquer setor', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-todos@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }
    const type = await seedType()
    const qualquer = await prisma.sector.create({
      data: { name: 'Qualquer', slug: 'qualquer-occ', enabledFeatures: ['calendario'] },
    })
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, date: '2026-09-10', typeId: type.id },
    })

    const user = await registerUser(app, 'Qualquer um', 'qualquer-occ@x.com')
    const res = await app.inject({
      method: 'GET',
      url: '/calendar/events?from=2026-09-01&to=2026-09-30',
      headers: {
        authorization: `Bearer ${tokenFor(app, user, { role: 'COLLABORATOR', sectorId: qualquer.id, features: ['calendario'] })}`,
      },
    })
    expect(res.json().occurrences).toHaveLength(1)
    await app.close()
  })

  it('recusa intervalo longo demais', async () => {
    const app = buildApp()
    await app.ready()
    const user = await registerUser(app, 'Zé', 'ze-range@x.com')
    const res = await app.inject({
      method: 'GET',
      url: '/calendar/events?from=2026-01-01&to=2028-01-01',
      headers: { authorization: `Bearer ${tokenFor(app, user, { role: 'COLLABORATOR', features: ['calendario'] })}` },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('liderança cadastrando evento', () => {
  it('LEAD, MANAGER e HEAD cadastram; LEGEND e terceiro não', async () => {
    const app = buildApp()
    await app.ready()
    const type = await seedType()
    const casos = [
      { role: 'LEAD', esperado: 201 },
      { role: 'MANAGER', esperado: 201 },
      { role: 'HEAD', esperado: 201 },
      { role: 'LEGEND', esperado: 403 },
      { role: 'THIRD_PARTY', esperado: 403 },
    ]
    for (const caso of casos) {
      const user = await registerUser(app, caso.role, `${caso.role.toLowerCase()}-cal@x.com`)
      const res = await app.inject({
        method: 'POST',
        url: '/calendar/events',
        headers: { authorization: `Bearer ${tokenFor(app, user, { role: caso.role })}` },
        payload: { ...BASE, title: `Evento do ${caso.role}`, typeId: type.id },
      })
      expect(res.statusCode, `papel ${caso.role}`).toBe(caso.esperado)
    }
    await app.close()
  })

  it('líder pode mirar a empresa inteira e setores específicos', async () => {
    const app = buildApp()
    await app.ready()
    const type = await seedType()
    const setor = await prisma.sector.create({
      data: { name: 'Comercial', slug: 'comercial-lead', enabledFeatures: ['calendario'] },
    })
    const lead = await registerUser(app, 'Líder', 'lead-alvo@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, lead, { role: 'LEAD' })}` }

    const empresa = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, title: 'Para todos', typeId: type.id },
    })
    expect(empresa.statusCode).toBe(201)
    expect(empresa.json().event.sectorIds).toEqual([])

    const restrito = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, title: 'Só comercial', typeId: type.id, sectorIds: [setor.id] },
    })
    expect(restrito.statusCode).toBe(201)
    await app.close()
  })

  it('o evento guarda quem cadastrou e quando', async () => {
    const app = buildApp()
    await app.ready()
    const type = await seedType()
    const lead = await registerUser(app, 'Marina Lead', 'marina-lead@x.com')
    const criado = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers: { authorization: `Bearer ${tokenFor(app, lead, { role: 'LEAD' })}` },
      payload: { ...BASE, typeId: type.id },
    })
    expect(criado.json().event.createdById).toBe(lead.id)
    expect(criado.json().event.createdByName).toBe('Marina Lead')
    expect(criado.json().event.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // O rastro acompanha o evento até quem só olha o calendário.
    const espectador = await registerUser(app, 'Zé', 'ze-rastro@x.com')
    const cal = await app.inject({
      method: 'GET',
      url: `/calendar/events?from=${BASE.date}&to=${BASE.date}`,
      headers: {
        authorization: `Bearer ${tokenFor(app, espectador, { role: 'LEGEND', features: ['calendario'] })}`,
      },
    })
    expect(cal.json().occurrences[0].createdByName).toBe('Marina Lead')
    await app.close()
  })

  it('líder edita e apaga o que criou', async () => {
    const app = buildApp()
    await app.ready()
    const type = await seedType()
    const lead = await registerUser(app, 'Líder', 'lead-dono@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, lead, { role: 'LEAD' })}` }
    const criado = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, typeId: type.id },
    })
    const id = criado.json().event.id as string

    const editado = await app.inject({
      method: 'PATCH',
      url: `/calendar/events/${id}`,
      headers,
      payload: { ...BASE, title: 'Remarcada', typeId: type.id },
    })
    expect(editado.statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: `/calendar/events/${id}`, headers })).statusCode).toBe(204)
    await app.close()
  })

  it('líder NÃO mexe em evento de outra pessoa', async () => {
    const app = buildApp()
    await app.ready()
    const type = await seedType()
    const autor = await registerUser(app, 'Autor', 'autor-ev@x.com')
    const outro = await registerUser(app, 'Outro líder', 'outro-lead@x.com')
    const criado = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers: { authorization: `Bearer ${tokenFor(app, autor, { role: 'LEAD' })}` },
      payload: { ...BASE, typeId: type.id },
    })
    const id = criado.json().event.id as string
    const headersOutro = { authorization: `Bearer ${tokenFor(app, outro, { role: 'LEAD' })}` }

    const edicao = await app.inject({
      method: 'PATCH',
      url: `/calendar/events/${id}`,
      headers: headersOutro,
      payload: { ...BASE, title: 'Sequestrado', typeId: type.id },
    })
    expect(edicao.statusCode).toBe(403)
    expect((await app.inject({ method: 'DELETE', url: `/calendar/events/${id}`, headers: headersOutro })).statusCode).toBe(403)
    // O evento continua intacto e do dono original.
    expect((await prisma.calendarEvent.findFirstOrThrow()).title).toBe(BASE.title)
    await app.close()
  })

  it('admin mexe em evento criado por líder', async () => {
    const app = buildApp()
    await app.ready()
    const type = await seedType()
    const lead = await registerUser(app, 'Líder', 'lead-admin-edita@x.com')
    const admin = await registerUser(app, 'Admin', 'admin-edita-lead@x.com')
    const criado = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers: { authorization: `Bearer ${tokenFor(app, lead, { role: 'LEAD' })}` },
      payload: { ...BASE, typeId: type.id },
    })
    const id = criado.json().event.id as string

    const res = await app.inject({
      method: 'PATCH',
      url: `/calendar/events/${id}`,
      headers: { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` },
      payload: { ...BASE, title: 'Ajustado pelo admin', typeId: type.id },
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('líder não cria nem apaga TIPO de evento — isso segue no bloco de admin', async () => {
    const app = buildApp()
    await app.ready()
    const lead = await registerUser(app, 'Líder', 'lead-tipo@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, lead, { role: 'LEAD' })}` }

    const criar = await app.inject({
      method: 'POST',
      url: '/admin/calendar-event-types',
      headers,
      payload: { name: 'Tipo do líder' },
    })
    expect(criar.statusCode).toBe(403)
    await app.close()
  })
})

/**
 * Os três recortes do Calendário Endomarketing que não existem no público por
 * setor: tag de público-alvo, Ação de Comunicação Interna e período de vários
 * dias. Todos são decididos no backend — evento que a pessoa não alcança nunca
 * sai da API.
 */
describe('público-alvo por tag', () => {
  async function cenario(email: string) {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', email)
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }
    const type = await seedType()
    return { app, headers, type }
  }

  const JANELA = '/calendar/events?from=2026-09-01&to=2026-09-30'

  it('evento marcado para Líder não sai para o colaborador', async () => {
    const { app, headers, type } = await cenario('admin-tag@x.com')
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, typeId: type.id, audienceTags: ['Líder'] },
    })

    const legend = await registerUser(app, 'Legend', 'legend-tag@x.com')
    const semTag = await app.inject({
      method: 'GET',
      url: JANELA,
      headers: { authorization: `Bearer ${tokenFor(app, legend, { role: 'LEGEND', features: ['calendario'] })}` },
    })
    expect(semTag.json().occurrences).toHaveLength(0)

    const lead = await registerUser(app, 'Líder', 'lead-tag@x.com')
    const comTag = await app.inject({
      method: 'GET',
      url: JANELA,
      headers: { authorization: `Bearer ${tokenFor(app, lead, { role: 'LEAD', features: ['calendario'] })}` },
    })
    expect(comTag.json().occurrences).toHaveLength(1)
    await app.close()
  })

  it('a tag "Todos" é visibilidade geral, igual a nenhuma tag', async () => {
    const { app, headers, type } = await cenario('admin-todos@x.com')
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, typeId: type.id, audienceTags: ['Todos'] },
    })

    const legend = await registerUser(app, 'Legend', 'legend-todos@x.com')
    const res = await app.inject({
      method: 'GET',
      url: JANELA,
      headers: { authorization: `Bearer ${tokenFor(app, legend, { role: 'LEGEND', features: ['calendario'] })}` },
    })
    expect(res.json().occurrences).toHaveLength(1)
    await app.close()
  })

  it('a tag casa com o nome do setor da pessoa, ignorando acento e caixa', async () => {
    const { app, headers, type } = await cenario('admin-setor-tag@x.com')
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, typeId: type.id, audienceTags: ['gente e gestao'] },
    })

    const gente = await registerUser(app, 'Gente', 'gente-tag@x.com')
    const setor = await prisma.sector.create({
      data: { name: 'Gente e Gestão', slug: 'gente-tag', enabledFeatures: ['calendario'] },
    })
    await prisma.user.update({ where: { id: gente.id }, data: { sectorId: setor.id } })

    const res = await app.inject({
      method: 'GET',
      url: JANELA,
      headers: {
        authorization: `Bearer ${tokenFor(app, gente, { role: 'LEGEND', sectorId: setor.id, features: ['calendario'] })}`,
      },
    })
    expect(res.json().occurrences).toHaveLength(1)
    await app.close()
  })
})

describe('Ação de Comunicação Interna', () => {
  const JANELA = '/calendar/events?from=2026-09-01&to=2026-09-30'

  async function eventoInterno(email: string) {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', email)
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }
    const type = await seedType()
    const res = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, typeId: type.id, isInternalComm: true },
    })
    return { app, headers, type, eventId: res.json().event.id as string }
  }

  it('some da API para o colaborador — não só da tela', async () => {
    const { app } = await eventoInterno('admin-interno@x.com')
    const legend = await registerUser(app, 'Legend', 'legend-interno@x.com')
    const res = await app.inject({
      method: 'GET',
      url: JANELA,
      headers: { authorization: `Bearer ${tokenFor(app, legend, { role: 'LEGEND', features: ['calendario'] })}` },
    })
    expect(res.json().occurrences).toHaveLength(0)
    await app.close()
  })

  it('o time de Gente e Gestão enxerga — o setor inteiro, não só o subadmin', async () => {
    const { app } = await eventoInterno('admin-interno2@x.com')
    const gente = await registerUser(app, 'Gente', 'gente-interno@x.com')
    const res = await app.inject({
      method: 'GET',
      url: JANELA,
      headers: {
        authorization: `Bearer ${tokenFor(app, gente, { role: 'LEGEND', features: ['calendario', 'gente-gestao'] })}`,
      },
    })
    expect(res.json().occurrences).toHaveLength(1)
    expect(res.json().occurrences[0].isInternalComm).toBe(true)
    await app.close()
  })

  it('o admin enxerga', async () => {
    const { app, headers } = await eventoInterno('admin-interno3@x.com')
    const res = await app.inject({ method: 'GET', url: JANELA, headers })
    expect(res.json().occurrences).toHaveLength(1)
    await app.close()
  })

  it('some também da lista de gestão de quem não pode vê-lo', async () => {
    const { app } = await eventoInterno('admin-interno4@x.com')
    const lead = await registerUser(app, 'Líder', 'lead-interno@x.com')
    const res = await app.inject({
      method: 'GET',
      url: '/calendar/managed-events',
      headers: { authorization: `Bearer ${tokenFor(app, lead, { role: 'LEAD' })}` },
    })
    expect(res.json().events).toHaveLength(0)
    await app.close()
  })

  it('líder de fora da G&G recebe 404 ao tentar editar — e não 403, que confirmaria a existência', async () => {
    const { app, eventId, type } = await eventoInterno('admin-interno5@x.com')
    const lead = await registerUser(app, 'Líder', 'lead-interno2@x.com')
    const res = await app.inject({
      method: 'PATCH',
      url: `/calendar/events/${eventId}`,
      headers: { authorization: `Bearer ${tokenFor(app, lead, { role: 'LEAD' })}` },
      payload: { ...BASE, title: 'Sequestrado', typeId: type.id },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('período de vários dias e cor', () => {
  it('devolve o fim da ocorrência e aparece numa janela que começa no meio dela', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-periodo@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }
    const type = await seedType()
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, date: '2026-09-28', endDate: '2026-10-03', typeId: type.id },
    })

    // A janela de outubro NÃO contém o início do evento — só o meio dele. Sem o
    // recorte por `endDate`, o dia 1º de outubro apareceria vazio.
    const res = await app.inject({
      method: 'GET',
      url: '/calendar/events?from=2026-10-01&to=2026-10-31',
      headers,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().occurrences).toHaveLength(1)
    expect(res.json().occurrences[0]).toMatchObject({ iso: '2026-09-28', endIso: '2026-10-03' })
    await app.close()
  })

  it('a duração em dias acompanha cada ocorrência da recorrência', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-recorrente@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }
    const type = await seedType()
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, date: '2026-09-01', endDate: '2026-09-03', typeId: type.id, recurrence: 'MONTHLY' },
    })

    const res = await app.inject({ method: 'GET', url: '/calendar/events?from=2026-11-01&to=2026-11-30', headers })
    expect(res.json().occurrences[0]).toMatchObject({ iso: '2026-11-01', endIso: '2026-11-03' })
    await app.close()
  })

  it('a cor sai da categoria; só o que difere dela vira sobrescrita', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-cor@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }
    const type = await prisma.calendarEventType.create({
      data: { name: 'Campanha', slug: 'campanha', icon: 'ads_click', color: '#f59e0b', companyId: DEFAULT_COMPANY_ID },
    })

    const padrao = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, typeId: type.id, color: '#f59e0b' },
    })
    // Cor igual à da categoria não fica gravada: assim, repintar a categoria
    // depois arrasta os eventos dela junto.
    expect(padrao.json().event.color).toBeNull()

    const custom = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, typeId: type.id, color: '#123456' },
    })
    expect(custom.json().event.color).toBe('#123456')

    const res = await app.inject({ method: 'GET', url: '/calendar/events?from=2026-09-01&to=2026-09-30', headers })
    const cores = res.json().occurrences.map((o: { color: string }) => o.color).sort()
    expect(cores).toEqual(['#123456', '#f59e0b'])
    await app.close()
  })

  it('recusa fim anterior ao início e hora de fim sem hora de início', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-invalido@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }
    const type = await seedType()

    const invertido = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, date: '2026-09-10', endDate: '2026-09-01', typeId: type.id },
    })
    expect(invertido.statusCode).toBe(400)

    const soFim = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, typeId: type.id, endTime: '15:00' },
    })
    expect(soFim.statusCode).toBe(400)
    await app.close()
  })
})

describe('GET /calendar/events/:id', () => {
  it('devolve o cadastro inteiro para quem pode editar', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-get-um@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }
    const type = await seedType()
    const criado = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, typeId: type.id, audienceTags: ['Líder'], recurrence: 'WEEKLY' },
    })

    const res = await app.inject({ method: 'GET', url: `/calendar/events/${criado.json().event.id}`, headers })
    expect(res.statusCode).toBe(200)
    expect(res.json().event).toMatchObject({ audienceTags: ['Líder'], recurrence: 'WEEKLY' })
    await app.close()
  })

  it('líder não lê o cadastro de outra pessoa', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-get-dois@x.com')
    const headers = { authorization: `Bearer ${tokenFor(app, admin, { role: 'ADMIN' })}` }
    const type = await seedType()
    const criado = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers,
      payload: { ...BASE, typeId: type.id },
    })

    const lead = await registerUser(app, 'Líder', 'lead-get@x.com')
    const res = await app.inject({
      method: 'GET',
      url: `/calendar/events/${criado.json().event.id}`,
      headers: { authorization: `Bearer ${tokenFor(app, lead, { role: 'LEAD' })}` },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})
