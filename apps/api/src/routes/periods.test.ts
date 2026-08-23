import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

function currentOpenPeriodData() {
  const now = new Date()
  return {
    monthRef: now.toISOString().slice(0, 7),
    startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    endsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    status: 'OPEN' as const,
  }
}

async function tokenFor(app: ReturnType<typeof buildApp>) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
  })
  return res.json().accessToken as string
}

describe('GET /periods/current', () => {
  it('returns the open period when one exists', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app)
    const period = await prisma.votingPeriod.create({ data: currentOpenPeriodData() })
    const res = await app.inject({
      method: 'GET',
      url: '/periods/current',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().period.monthRef).toBe(period.monthRef)
    await app.close()
  })

  it('returns null when there is no open period', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app)
    const res = await app.inject({
      method: 'GET',
      url: '/periods/current',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().period).toBeNull()
    await app.close()
  })
})

describe('GET /periods/next', () => {
  it('returns the next scheduled period', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app)
    await prisma.votingPeriod.create({
      data: { monthRef: '2027-01', startsAt: new Date('2027-01-01'), endsAt: new Date('2027-01-31'), status: 'OPEN' },
    })
    const res = await app.inject({ method: 'GET', url: '/periods/next', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().period.monthRef).toBe('2027-01')
    expect(res.json().period.state).toBe('SCHEDULED')
    await app.close()
  })

  it('returns null when there is no upcoming period', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app)
    const res = await app.inject({ method: 'GET', url: '/periods/next', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().period).toBeNull()
    await app.close()
  })
})
