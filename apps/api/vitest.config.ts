import { defineConfig } from 'vitest/config'

/**
 * Banco de teste: SEMPRE local e SEMPRE derivado de `legends_test` — o nome é
 * CONSTRUÍDO aqui, nunca lido de `.env`, porque `test/setup.ts` trunca todas as
 * tabelas a cada teste; um `DATABASE_URL` de ambiente apontando para outro banco
 * viraria perda de dados.
 *
 * `LEGENDS_DB_PORT` existe só para a PORTA do host, para quem tem outro Postgres
 * ocupando a 5432 (ver docker-compose.yml, mesma variável).
 *
 * `LEGENDS_TEST_DB_SUFFIX` existe para WORKTREES PARALELOS. Duas suítes rodando
 * ao mesmo tempo contra o mesmo banco não dão erro honesto: dão deadlock do
 * Postgres e violação de FK em testes que não têm nada a ver com a mudança —
 * horas de investigação para descobrir que o problema era o vizinho. O sufixo é
 * sanitizado e concatenado, então o alvo continua sendo, por construção, um
 * banco `legends_test*` local.
 */
const DB_PORT = process.env.LEGENDS_DB_PORT ?? '5432'
const SUFFIX = (process.env.LEGENDS_TEST_DB_SUFFIX ?? '').replace(/[^a-z0-9_]/g, '')
export const TEST_DB_NAME = `legends_test${SUFFIX}`
export const TEST_DATABASE_URL = `postgresql://legends:legends@localhost:${DB_PORT}/${TEST_DB_NAME}?schema=public`

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: 'test-secret',
      NODE_ENV: 'test',
    },
  },
})
