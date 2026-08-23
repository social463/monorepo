import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createActionItem, createSeries, listCompletedActionsForProfile, updateActionItem } from './one-on-one-service'

async function makeUser(name: string) {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@empresa.com`, passwordHash: 'x', companyId: DEFAULT_COMPANY_ID },
  })
}
const viewerOf = (user: { id: string }) => ({ userId: user.id, companyId: DEFAULT_COMPANY_ID })

async function combinadoConcluido(autor: { id: string }, outro: { id: string }, descricao: string) {
  const { meetings } = await createSeries(viewerOf(autor), {
    counterpartId: outro.id,
    date: '2026-08-10',
    startTime: '10:00',
    durationMinutes: 30,
    recurrence: 'NONE',
  })
  const acao = await createActionItem(viewerOf(autor), meetings[0].id, {
    description: descricao,
    ownerId: outro.id,
    dueDate: null,
  })
  await updateActionItem(viewerOf(autor), acao.id, { status: 'DONE' })
  return acao
}

describe('combinados concluídos no perfil', () => {
  it('no próprio perfil, traz o que a pessoa combinou com qualquer colega', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const carla = await makeUser('Carla')
    await combinadoConcluido(ana, bruno, 'Levantar escopo com o Bruno')
    await combinadoConcluido(ana, carla, 'Revisar o onboarding com a Carla')

    const doPerfilDela = await listCompletedActionsForProfile(viewerOf(ana), ana.id)

    expect(doPerfilDela.map((a) => a.description).sort()).toEqual([
      'Levantar escopo com o Bruno',
      'Revisar o onboarding com a Carla',
    ])
  })

  it('no perfil de outra pessoa, traz só o que os dois combinaram entre si', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const carla = await makeUser('Carla')
    await combinadoConcluido(ana, bruno, 'Combinado com o Bruno')
    await combinadoConcluido(ana, carla, 'Combinado com a Carla')

    const doPerfilDoBruno = await listCompletedActionsForProfile(viewerOf(ana), bruno.id)

    expect(doPerfilDoBruno).toHaveLength(1)
    expect(doPerfilDoBruno[0].description).toBe('Combinado com o Bruno')
    expect(doPerfilDoBruno[0].counterpart.id).toBe(bruno.id)
  })

  /** A promessa central da feature, levada ao perfil: conversa fechada não vira vitrine. */
  it('quem não participou do 1:1 não lê o combinado no perfil de ninguém', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const xereta = await makeUser('Xereta')
    await combinadoConcluido(ana, bruno, 'Assunto entre Ana e Bruno')

    expect(await listCompletedActionsForProfile(viewerOf(xereta), ana.id)).toEqual([])
    expect(await listCompletedActionsForProfile(viewerOf(xereta), bruno.id)).toEqual([])
  })

  it('ADMIN também não lê — o perfil não abre porta que o encontro fecha', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const chefe = await prisma.user.create({
      data: {
        name: 'Chefe',
        email: 'chefe@empresa.com',
        passwordHash: 'x',
        role: 'ADMIN',
        companyId: DEFAULT_COMPANY_ID,
      },
    })
    await combinadoConcluido(ana, bruno, 'Assunto entre Ana e Bruno')

    expect(await listCompletedActionsForProfile(viewerOf(chefe), ana.id)).toEqual([])
  })

  it('combinado ainda em aberto não aparece — a seção é de histórico', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const { meetings } = await createSeries(viewerOf(ana), {
      counterpartId: bruno.id,
      date: '2026-08-10',
      startTime: '10:00',
      durationMinutes: 30,
      recurrence: 'NONE',
    })
    await createActionItem(viewerOf(ana), meetings[0].id, {
      description: 'Ainda pendente',
      ownerId: bruno.id,
      dueDate: null,
    })

    expect(await listCompletedActionsForProfile(viewerOf(ana), bruno.id)).toEqual([])
  })

  it('traz quem é o responsável e quando fechou', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    await combinadoConcluido(ana, bruno, 'Levantar escopo')

    const [acao] = await listCompletedActionsForProfile(viewerOf(ana), bruno.id)

    expect(acao.owner.id).toBe(bruno.id)
    expect(acao.completedAt).not.toBeNull()
  })
})
