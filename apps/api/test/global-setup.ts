import { execSync } from 'node:child_process'
import { Client } from 'pg'

const TEST_DB = 'legends_test'
// Porta do host configurável (mesma variável do docker-compose.yml), para quem
// tem outro Postgres ocupando a 5432. Host/credenciais/banco seguem fixos: o
// alvo é sempre o Postgres LOCAL do projeto e o banco `legends_test`, que o
// `test/setup.ts` trunca inteiro a cada teste.
const DB_PORT = process.env.LEGENDS_DB_PORT ?? '5432'
const ADMIN_URL = `postgresql://legends:legends@localhost:${DB_PORT}/legends`
const TEST_URL = `postgresql://legends:legends@localhost:${DB_PORT}/${TEST_DB}?schema=public`

export default async function setup() {
  const client = new Client({ connectionString: ADMIN_URL })
  await client.connect()
  const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB])
  if (res.rowCount === 0) {
    await client.query(`CREATE DATABASE ${TEST_DB}`)
  }
  await client.end()

  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_URL },
  })
}
