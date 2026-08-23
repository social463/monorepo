import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

/**
 * Destaques do Mês curados pela G&G. A votação (e o destaque derivado dela)
 * segue existindo e não é tocada por nada aqui.
 */

const SECTOR = 'sector-dev-produto'

async function setup() {
  const app = buildApp()
  await app.ready()
  return app
}

async function makeUser(name: string, role = 'LEGEND', sectorId = SECTOR) {
  return prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase()}-${Math.random()}@empresa.com`,
      passwordHash: 'x',
      role: role as never,
      sectorId,
    },
  })
}

function tokenFor(app: Awaited<ReturnType<typeof setup>>, user: { id: string; role: string; sectorId: string }) {
  return app.jwt.sign({
    sub: user.id,
    role: user.role,
    sectorId: user.sectorId,
    companyId: DEFAULT_COMPANY_ID,
    features: [],
  })
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

describe('destaques do mês (curados)', () => {
  it('cadastra várias pessoas de uma vez e agrupa por setor', async () => {
    const app = await setup()
    const admin = await makeUser('Admin', 'ADMIN')
    const outroSetor = await prisma.sector.create({
      data: { name: 'Receita', slug: `receita-${Math.random()}`, enabledFeatures: [] },
    })
    const [bia, caio, duda] = await Promise.all([
      makeUser('Bia'),
      makeUser('Caio'),
      makeUser('Duda', 'LEGEND', outroSetor.id),
    ])

    const criado = await app.inject({
      method: 'POST',
      url: '/monthly-highlights',
      headers: auth(tokenFor(app, admin)),
      payload: { monthRef: '2026-08', userIds: [bia.id, caio.id, duda.id] },
    })
    expect(criado.statusCode).toBe(201)

    const quadro = await app.inject({
      method: 'GET',
      url: '/monthly-highlights?monthRef=2026-08',
      headers: auth(tokenFor(app, bia)),
    })

    expect(quadro.json().total).toBe(3)
    const grupos = quadro.json().groups as { group: { name: string }; people: { person: { name: string } }[] }[]
    expect(grupos).toHaveLength(2)
    const receita = grupos.find((g) => g.group.name === 'Receita')!
    expect(receita.people.map((p) => p.person.name)).toEqual(['Duda'])
    await app.close()
  })

  it('cadastrar de novo a mesma pessoa no mesmo mês não duplica', async () => {
    const app = await setup()
    const admin = await makeUser('Admin', 'ADMIN')
    const bia = await makeUser('Bia')
    const payload = { monthRef: '2026-08', userIds: [bia.id] }

    await app.inject({ method: 'POST', url: '/monthly-highlights', headers: auth(tokenFor(app, admin)), payload })
    const segunda = await app.inject({
      method: 'POST',
      url: '/monthly-highlights',
      headers: auth(tokenFor(app, admin)),
      payload,
    })

    expect(segunda.statusCode).toBe(201)
    expect(await prisma.monthlyHighlight.count({ where: { monthRef: '2026-08' } })).toBe(1)
    await app.close()
  })

  it('o setor é snapshot: mudar de setor depois não reescreve o quadro', async () => {
    const app = await setup()
    const admin = await makeUser('Admin', 'ADMIN')
    const bia = await makeUser('Bia')
    await app.inject({
      method: 'POST',
      url: '/monthly-highlights',
      headers: auth(tokenFor(app, admin)),
      payload: { monthRef: '2026-08', userIds: [bia.id] },
    })

    const novoSetor = await prisma.sector.create({
      data: { name: 'Operações', slug: `operacoes-${Math.random()}`, enabledFeatures: [] },
    })
    await prisma.user.update({ where: { id: bia.id }, data: { sectorId: novoSetor.id } })

    const quadro = await app.inject({
      method: 'GET',
      url: '/monthly-highlights?monthRef=2026-08',
      headers: auth(tokenFor(app, admin)),
    })

    // Ela é de Operações HOJE, mas foi destaque pelo setor de agosto.
    expect(quadro.json().groups[0].group.name).not.toBe('Operações')
    await app.close()
  })

  it('mês sem destaque devolve quadro vazio (a web mostra o texto da G&G)', async () => {
    const app = await setup()
    const bia = await makeUser('Bia')

    const quadro = await app.inject({
      method: 'GET',
      url: '/monthly-highlights?monthRef=2026-01',
      headers: auth(tokenFor(app, bia)),
    })

    expect(quadro.json()).toMatchObject({ monthRef: '2026-01', total: 0, groups: [], canManage: false })
    await app.close()
  })

  it('colaborador e líder não cadastram, editam nem excluem (403)', async () => {
    const app = await setup()
    const admin = await makeUser('Admin', 'ADMIN')
    const lenda = await makeUser('Lenda')
    const lider = await makeUser('Lider', 'LEAD')
    const criado = await app.inject({
      method: 'POST',
      url: '/monthly-highlights',
      headers: auth(tokenFor(app, admin)),
      payload: { monthRef: '2026-08', userIds: [lenda.id] },
    })
    const id = criado.json().highlights[0].id

    for (const quem of [lenda, lider]) {
      const token = auth(tokenFor(app, quem))
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/monthly-highlights',
            headers: token,
            payload: { monthRef: '2026-08', userIds: [lenda.id] },
          })
        ).statusCode,
      ).toBe(403)
      expect(
        (await app.inject({ method: 'DELETE', url: `/monthly-highlights/${id}`, headers: token })).statusCode,
      ).toBe(403)
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `/monthly-highlights/${id}`,
            headers: token,
            payload: { message: 'tentativa' },
          })
        ).statusCode,
      ).toBe(403)
      // …mas os dois enxergam o quadro.
      expect((await app.inject({ method: 'GET', url: '/monthly-highlights', headers: token })).statusCode).toBe(200)
    }
    await app.close()
  })

  it('"Meus reconhecimentos" traz só os da própria pessoa, com a justificativa', async () => {
    const app = await setup()
    const admin = await makeUser('Admin', 'ADMIN')
    const [bia, caio] = await Promise.all([makeUser('Bia'), makeUser('Caio')])
    await app.inject({
      method: 'POST',
      url: '/monthly-highlights',
      headers: auth(tokenFor(app, admin)),
      payload: { monthRef: '2026-08', userIds: [bia.id], message: 'Segurou a virada do sistema.' },
    })
    await app.inject({
      method: 'POST',
      url: '/monthly-highlights',
      headers: auth(tokenFor(app, admin)),
      payload: { monthRef: '2026-07', userIds: [caio.id] },
    })

    const minhas = await app.inject({
      method: 'GET',
      url: '/monthly-highlights/mine',
      headers: auth(tokenFor(app, bia)),
    })

    expect(minhas.json().highlights).toHaveLength(1)
    expect(minhas.json().highlights[0]).toMatchObject({
      monthRef: '2026-08',
      message: 'Segurou a virada do sistema.',
    })
    await app.close()
  })

  it('admin edita a justificativa e exclui, com auditoria', async () => {
    const app = await setup()
    const admin = await makeUser('Admin', 'ADMIN')
    const bia = await makeUser('Bia')
    const criado = await app.inject({
      method: 'POST',
      url: '/monthly-highlights',
      headers: auth(tokenFor(app, admin)),
      payload: { monthRef: '2026-08', userIds: [bia.id] },
    })
    const id = criado.json().highlights[0].id

    const editado = await app.inject({
      method: 'PATCH',
      url: `/monthly-highlights/${id}`,
      headers: auth(tokenFor(app, admin)),
      payload: { message: 'Liderou a entrega do trimestre.' },
    })
    expect(editado.json().highlight.message).toBe('Liderou a entrega do trimestre.')

    const excluido = await app.inject({
      method: 'DELETE',
      url: `/monthly-highlights/${id}`,
      headers: auth(tokenFor(app, admin)),
    })
    expect(excluido.statusCode).toBe(204)
    expect(await prisma.monthlyHighlight.count()).toBe(0)

    const logs = await prisma.adminAuditLog.findMany({ where: { entityType: 'MonthlyHighlight' } })
    expect(logs.map((l) => l.action).sort()).toEqual(['CREATE', 'DELETE', 'UPDATE'])
    await app.close()
  })

  it('mês inválido é 400 e pessoa inexistente é 404', async () => {
    const app = await setup()
    const admin = await makeUser('Admin', 'ADMIN')
    const bia = await makeUser('Bia')
    const token = auth(tokenFor(app, admin))

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/monthly-highlights',
          headers: token,
          payload: { monthRef: '2026-13', userIds: [bia.id] },
        })
      ).statusCode,
    ).toBe(400)

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/monthly-highlights',
          headers: token,
          payload: { monthRef: '2026-08', userIds: ['nao-existe'] },
        })
      ).statusCode,
    ).toBe(404)
    await app.close()
  })

  it('destaque de outra empresa não aparece nem pode ser apagado', async () => {
    const app = await setup()
    const outraEmpresa = await prisma.company.create({
      data: { name: 'Outra Empresa Destaques', slug: `outra-destaques-${Math.random()}` },
    })
    const setorFora = await prisma.sector.create({
      data: { name: 'Fora', slug: `fora-${Math.random()}`, enabledFeatures: [], companyId: outraEmpresa.id },
    })
    const adminFora = await prisma.user.create({
      data: {
        name: 'AdminFora',
        email: `admin-fora-${Math.random()}@x.com`,
        passwordHash: 'x',
        role: 'ADMIN',
        companyId: outraEmpresa.id,
        sectorId: setorFora.id,
      },
    })
    const doFora = await prisma.monthlyHighlight.create({
      data: {
        monthRef: '2026-08',
        userId: adminFora.id,
        sectorId: setorFora.id,
        createdById: adminFora.id,
        companyId: outraEmpresa.id,
      },
    })

    const admin = await makeUser('Admin', 'ADMIN')
    const token = auth(tokenFor(app, admin))
    const quadro = await app.inject({ method: 'GET', url: '/monthly-highlights?monthRef=2026-08', headers: token })
    expect(quadro.json().total).toBe(0)

    const apagar = await app.inject({ method: 'DELETE', url: `/monthly-highlights/${doFora.id}`, headers: token })
    expect(apagar.statusCode).toBe(404)
    await app.close()
  })
})
