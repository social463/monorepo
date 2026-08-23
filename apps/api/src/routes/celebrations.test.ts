import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

describe('GET /celebrations', () => {
  it('exige autenticação (401)', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/celebrations' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('devolve o aniversariante e o aniversário de casa de hoje', async () => {
    const app = buildApp()
    await app.ready()
    const viewerReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Quem Olha', email: 'cel-viewer@x.com', password: 'changeme123' } })
    const viewerToken = viewerReg.json().accessToken as string
    const personReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Aniversariante', email: 'cel-person@x.com', password: 'changeme123' } })
    const personId = personReg.json().user.id as string

    // "Hoje" vem do relógio real (America/Sao_Paulo): derivamos a data civil
    // corrente em vez de congelar o tempo. A lógica de dia/mês/anos é testada em
    // celebration-service.test.ts, onde `now` é injetável.
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const [year, month, day] = ymd.split('-')
    const joinYear = Number(year) - 2
    await prisma.user.update({
      where: { id: personId },
      data: {
        birthDate: new Date(`1990-${month}-${day}T00:00:00.000Z`),
        joinedAt: new Date(`${joinYear}-${month}-${day}T00:00:00.000Z`),
      },
    })

    const res = await app.inject({ method: 'GET', url: '/celebrations', headers: { authorization: `Bearer ${viewerToken}` } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      referenceDay: string
      birthdays: { upcoming: { user: { id: string }; daysUntil: number }[] }
      workAnniversaries: { upcoming: { user: { id: string }; years: number; daysUntil: number }[] }
    }
    expect(body.referenceDay).toBe(ymd)
    const birthdayToday = body.birthdays.upcoming.filter((b) => b.daysUntil === 0)
    const anniversaryToday = body.workAnniversaries.upcoming.filter((w) => w.daysUntil === 0)
    expect(birthdayToday.map((b) => b.user.id)).toEqual([personId])
    expect(anniversaryToday.map((w) => [w.user.id, w.years])).toEqual([[personId, 2]])
    await app.close()
  })

  it('recusa month em formato inválido (400)', async () => {
    const app = buildApp()
    await app.ready()
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'M', email: 'cel-month@x.com', password: 'changeme123' } })
    const token = reg.json().accessToken as string
    const res = await app.inject({ method: 'GET', url: '/celebrations?month=2026-13-01', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
