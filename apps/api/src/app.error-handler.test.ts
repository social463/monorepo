import { describe, it, expect } from 'vitest'
import { buildApp } from './app'

/**
 * O corpo de um 500 não pode carregar detalhe de servidor. O caso que motivou
 * isto: com `DATABASE_URL` ausente, a mensagem do Prisma — caminho absoluto do
 * arquivo, trecho do `schema.prisma` e nome de coluna — foi parar inteira na
 * tela de login.
 */
describe('tratamento de erro não previsto', () => {
  it('devolve mensagem genérica no 500, sem detalhe interno', async () => {
    const app = buildApp()
    app.get('/teste-erro-interno', async () => {
      throw new Error(
        'Invalid `prisma.user.findUnique()` invocation in /home/app/src/services/auth-service.ts:33\nerror: Environment variable not found: DATABASE_URL.',
      )
    })
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/teste-erro-interno' })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ message: 'Erro inesperado. Tente de novo em instantes.' })
    expect(res.body).not.toContain('prisma')
    expect(res.body).not.toContain('DATABASE_URL')
    expect(res.body).not.toContain('/home/app')
    await app.close()
  })

  it('preserva a mensagem de erro abaixo de 500, que é escrita para o usuário', async () => {
    const app = buildApp()
    app.get('/teste-erro-de-negocio', async (_request, reply) => {
      return reply.code(409).send({ message: 'E-mail já cadastrado.' })
    })
    app.get('/teste-erro-lancado', async () => {
      const err = new Error('Setor não encontrado.') as Error & { statusCode: number }
      err.statusCode = 404
      throw err
    })
    await app.ready()

    const conflito = await app.inject({ method: 'GET', url: '/teste-erro-de-negocio' })
    expect(conflito.statusCode).toBe(409)
    expect(conflito.json()).toEqual({ message: 'E-mail já cadastrado.' })

    const naoEncontrado = await app.inject({ method: 'GET', url: '/teste-erro-lancado' })
    expect(naoEncontrado.statusCode).toBe(404)
    expect(naoEncontrado.json()).toEqual({ message: 'Setor não encontrado.' })
    await app.close()
  })

  it('acima de 500 troca a mensagem, mas mantém o status', async () => {
    // 503 e 502 dizem coisas diferentes de 500 para quem monitora — e o cliente
    // usa o status para decidir se vale tentar de novo.
    const app = buildApp()
    app.get('/teste-indisponivel', async () => {
      const err = new Error('connect ECONNREFUSED 10.0.0.7:5432') as Error & { statusCode: number }
      err.statusCode = 503
      throw err
    })
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/teste-indisponivel' })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ message: 'Erro inesperado. Tente de novo em instantes.' })
    expect(res.body).not.toContain('ECONNREFUSED')
    await app.close()
  })

  it('não afeta o 401 de rota protegida', async () => {
    const app = buildApp()
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/admin/users' })

    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
