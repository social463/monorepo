import { defineConfig } from 'vitest/config'

/**
 * Banco de teste: SEMPRE local e SEMPRE `legends_test` — cravado aqui (e não
 * lido de `.env`) de propósito, porque `test/setup.ts` trunca todas as tabelas
 * a cada teste; um `DATABASE_URL` de ambiente apontando para outro banco viraria
 * perda de dados. `LEGENDS_DB_PORT` existe só para a PORTA do host, para quem
 * tem outro Postgres ocupando a 5432 (ver docker-compose.yml, mesma variável).
 */
const DB_PORT = process.env.LEGENDS_DB_PORT ?? '5432'
export const TEST_DATABASE_URL = `postgresql://legends:legends@localhost:${DB_PORT}/legends_test?schema=public`

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
