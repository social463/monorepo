import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  createDevelopmentThursdayEvent,
  deleteDevelopmentThursdayEvent,
  findDevelopmentThursdayEventForFeedback,
  firstThursdayInSprint,
  listDevelopmentThursdayEvents,
  sprintWindowFor,
  updateDevelopmentThursdayEvent,
} from './development-thursday-service'

describe('development thursday sprint calendar', () => {
  it('calcula sprints de segunda a sexta da 2ª semana a partir de 2026-07-06', () => {
    const current = sprintWindowFor(new Date('2026-07-07T12:00:00Z'))
    expect(current.sprintStart.toISOString().slice(0, 10)).toBe('2026-07-06')
    expect(current.sprintEnd.toISOString().slice(0, 10)).toBe('2026-07-17')
    expect(current.eventDate.toISOString().slice(0, 10)).toBe('2026-07-09')

    const next = sprintWindowFor(new Date('2026-07-20T00:00:00Z'))
    expect(next.sprintStart.toISOString().slice(0, 10)).toBe('2026-07-20')
    expect(next.sprintEnd.toISOString().slice(0, 10)).toBe('2026-07-31')
  })

  it('mantém o fim de sprint durante o fim de semana entre as sprints', () => {
    // Sábado/domingo (18-19) ainda pertencem à sprint que começou em 06
    const saturday = sprintWindowFor(new Date('2026-07-18T00:00:00Z'))
    expect(saturday.sprintStart.toISOString().slice(0, 10)).toBe('2026-07-06')
    expect(saturday.sprintEnd.toISOString().slice(0, 10)).toBe('2026-07-17')
  })

  it('usa a primeira quinta-feira dentro da sprint', () => {
    expect(firstThursdayInSprint(new Date('2026-07-06T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-07-09')
    expect(firstThursdayInSprint(new Date('2026-07-20T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-07-23')
  })
})

describe('notifyDevelopmentThursdayEvent escopado por empresa', () => {
  it('não notifica usuário de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Quinta', slug: 'outra-empresa-quinta-test' } })
    const presenter = await prisma.user.create({ data: { name: 'Apresentador', email: 'apresentador-quinta@x.com', passwordHash: 'x' } })
    const outsider = await prisma.user.create({
      data: { name: 'ForaQuinta', email: 'fora-quinta@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    // 2026-07-09 é uma quinta-feira (mesma data usada em sprintWindowFor/firstThursdayInSprint
    // acima neste arquivo) — createDevelopmentThursdayEvent rejeita eventDate em fim de semana.
    const event = await createDevelopmentThursdayEvent({
      presenterId: presenter.id,
      companyId: DEFAULT_COMPANY_ID,
      title: 'Tema Escopado',
      description: 'Descrição do tema escopado por empresa.',
      eventDate: new Date('2026-07-09'),
    })
    expect(event).toBeTruthy()

    const notified = await prisma.notification.findFirst({ where: { userId: outsider.id, type: 'DEVELOPMENT_THURSDAY_EVENT' } })
    expect(notified).toBeNull()
  })
})

describe('isolamento por empresa (CRUD)', () => {
  it('listDevelopmentThursdayEvents não retorna tema de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Quinta Lista', slug: 'outra-empresa-quinta-lista-test' } })
    const outsider = await prisma.user.create({
      data: { name: 'ApresentadorOutraEmpresa', email: 'apresentador-outra-empresa@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    await createDevelopmentThursdayEvent({
      presenterId: outsider.id,
      companyId: otherCompany.id,
      title: 'Tema de outra empresa',
      description: 'Não deveria aparecer.',
      eventDate: new Date('2026-07-09'),
    })

    const events = await listDevelopmentThursdayEvents({}, DEFAULT_COMPANY_ID)
    expect(events).toHaveLength(0)
  })

  it('findDevelopmentThursdayEventForFeedback/update/delete tratam tema de outra empresa como inexistente (404)', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Quinta Mut', slug: 'outra-empresa-quinta-mut-test' } })
    const outsider = await prisma.user.create({
      data: { name: 'ApresentadorOutraEmpresaMut', email: 'apresentador-outra-empresa-mut@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const event = await createDevelopmentThursdayEvent({
      presenterId: outsider.id,
      companyId: otherCompany.id,
      title: 'Tema de outra empresa',
      description: 'Não deveria ser acessível.',
      eventDate: new Date('2026-07-09'),
    })

    await expect(findDevelopmentThursdayEventForFeedback(event.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
    await expect(
      updateDevelopmentThursdayEvent({ id: event.id, authorId: outsider.id, companyId: DEFAULT_COMPANY_ID, title: 'Hackeado' }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      deleteDevelopmentThursdayEvent({ id: event.id, authorId: outsider.id, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
