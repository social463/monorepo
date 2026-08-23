import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'

describe('GET /mural', () => {
  it('exige autenticação (401)', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/mural' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('devolve itens com feedback compartilhado', async () => {
    const app = buildApp()
    await app.ready()
    const authorReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Autor', email: 'mural-a@x.com', password: 'changeme123' } })
    const authorToken = authorReg.json().accessToken as string
    const targetReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Alvo', email: 'mural-t@x.com', password: 'changeme123' } })
    const targetToken = targetReg.json().accessToken as string
    const targetId = targetReg.json().user.id as string
    const created = await app.inject({
      method: 'POST', url: `/users/${targetId}/feedbacks`, headers: { authorization: `Bearer ${authorToken}` },
      payload: { message: 'Feedback bem específico para o mural do time.', category: 'POSITIVO' },
    })
    const fbId = created.json().feedback.id as string
    await app.inject({ method: 'POST', url: `/feedbacks/${fbId}/share`, headers: { authorization: `Bearer ${targetToken}` } })

    const res = await app.inject({ method: 'GET', url: '/mural', headers: { authorization: `Bearer ${targetToken}` } })
    expect(res.statusCode).toBe(200)
    const items = res.json().items as { type: string; id: string }[]
    expect(items.some((i) => i.type === 'feedback' && i.id === fbId)).toBe(true)
    await app.close()
  })
})
