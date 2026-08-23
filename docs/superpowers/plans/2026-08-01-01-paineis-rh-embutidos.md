# Painéis de RH embutidos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que ADMIN e SUBADMIN cadastrem painéis externos de BI (Power BI, Looker Studio, Metabase) e os vejam embutidos dentro de `/admin`, com a URL validada contra uma allowlist de hosts no backend.

**Architecture:** Contrato em `@legends/shared` primeiro; model `HrDashboard` tenant-scoped no Prisma; validação de URL numa função pura (`lib/embed-url.ts`) consumida pelo service; service com escopo por papel (ADMIN vê tudo, SUBADMIN só empresa + próprio setor) e auditoria transacional; rotas finas sob `/admin/hr-dashboards`; uma seção React em `/admin/paineis` que renderiza os iframes em sandbox; `frame-src` no CSP do nginx.

**Tech Stack:** TypeScript ESM strict, Fastify 4, Prisma 5 + PostgreSQL, Zod, React 18 + React Query + Tailwind, Vitest.

Spec: `docs/superpowers/specs/2026-08-01-paineis-rh-embutidos-design.md`

## Global Constraints

- Fluxo obrigatório: **route → service → Prisma**. Rota valida com Zod (`safeParse` → `400 { message, issues }`), chama o service, serializa em `lib/serialize.ts`. Nenhuma regra de negócio na rota.
- Todo acesso ao model novo passa por `scopedPrisma(companyId)` (`apps/api/src/lib/tenant-scope.ts`); `HrDashboard` precisa entrar em `TENANT_SCOPED_MODELS`.
- Toda mutação de admin grava `recordAuditLog` (`services/audit-log-service.ts`) **dentro do mesmo `$transaction`** da escrita, com `tx: tx as unknown as Prisma.TransactionClient`.
- Migration só via `pnpm db:migrate`; nunca editar migration já aplicada.
- Erro de domínio é classe tipada com `status` (padrão `VoteError`); a rota faz `instanceof` e responde com `err.status`. Erro inesperado sobe.
- Todas as mensagens ao usuário em **português**.
- Testes Vitest colocados ao lado do arquivo. A API roda contra Postgres real: subir com `pnpm db:up` — **nesta máquina o Postgres está na 5432**, então rode os testes sem `LEGENDS_DB_PORT`.
- Limites do contrato, valores exatos: `HR_DASHBOARD_MIN_HEIGHT = 300`, `HR_DASHBOARD_MAX_HEIGHT = 2000`, `HR_DASHBOARD_DEFAULT_HEIGHT = 720`, `HR_DASHBOARD_TITLE_MAX_LENGTH = 120`, `HR_DASHBOARD_DESCRIPTION_MAX_LENGTH = 400`, `HR_DASHBOARD_URL_MAX_LENGTH = 2000`.
- Hosts default da allowlist, valores exatos: `app.powerbi.com`, `lookerstudio.google.com`, `datastudio.google.com`.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `packages/shared/src/hr-dashboard.ts` (criar) | Contrato: DTO, requests, constantes de limite |
| `packages/shared/src/index.ts` (modificar) | Barril |
| `apps/api/prisma/schema.prisma` (modificar) | Model `HrDashboard` + back-relations |
| `apps/api/src/lib/tenant-scope.ts` (modificar) | Registrar `HrDashboard` |
| `apps/api/test/setup.ts` (modificar) | Truncar `hrDashboard` entre testes |
| `apps/api/src/lib/hr-dashboard-error.ts` (criar) | `HrDashboardError` — em `lib/` para `embed-url.ts` e o service compartilharem sem ciclo de import |
| `apps/api/src/lib/embed-url.ts` (criar) | `assertEmbedUrlAllowed` — função pura de validação |
| `apps/api/src/lib/config.ts` (modificar) | `resolveHrDashboardAllowedHosts` |
| `apps/api/src/services/hr-dashboard-service.ts` (criar) | Regra de negócio: escopo por papel, CRUD, auditoria |
| `apps/api/src/lib/serialize.ts` (modificar) | `toHrDashboardDTO` |
| `apps/api/src/routes/hr-dashboards.ts` (criar) | 4 endpoints sob `/admin/hr-dashboards` |
| `apps/api/src/app.ts` (modificar) | Registrar as rotas |
| `apps/web/src/pages/admin/HrDashboardsSection.tsx` (criar) | Tela de gestão + exibição dos iframes |
| `apps/web/src/App.tsx` (modificar) | Rota `/admin/paineis` |
| `apps/web/src/pages/admin/AdminSidebar.tsx` (modificar) | Item "Painéis de RH" |
| `nginx/default.conf` (modificar) | CSP `frame-src` |
| `apps/api/.env.example` (modificar) | Documentar `HR_DASHBOARD_ALLOWED_HOSTS` |

---

### Task 1: Contrato compartilhado e modelo de dados

**Files:**
- Create: `packages/shared/src/hr-dashboard.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/lib/tenant-scope.ts`
- Modify: `apps/api/test/setup.ts`
- Test: `apps/api/src/lib/hr-dashboard-tenant-scope.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `HrDashboardDTO`, `CreateHrDashboardRequest`, `UpdateHrDashboardRequest`, `HrDashboardListResponse`, `HR_DASHBOARD_MIN_HEIGHT`, `HR_DASHBOARD_MAX_HEIGHT`, `HR_DASHBOARD_DEFAULT_HEIGHT`, `HR_DASHBOARD_TITLE_MAX_LENGTH`, `HR_DASHBOARD_DESCRIPTION_MAX_LENGTH`, `HR_DASHBOARD_URL_MAX_LENGTH` (todos de `@legends/shared`); model Prisma `HrDashboard` acessível por `prisma.hrDashboard`.

- [ ] **Step 1: Escrever o contrato compartilhado**

Criar `packages/shared/src/hr-dashboard.ts`:

```ts
/**
 * Contrato dos painéis de RH: painéis externos de BI (Power BI, Looker Studio,
 * Metabase) embutidos em <iframe> dentro da administração. `embedUrl` é sempre
 * validada no backend contra uma allowlist de hosts — o front nunca decide.
 */

export const HR_DASHBOARD_MIN_HEIGHT = 300
export const HR_DASHBOARD_MAX_HEIGHT = 2000
export const HR_DASHBOARD_DEFAULT_HEIGHT = 720
export const HR_DASHBOARD_TITLE_MAX_LENGTH = 120
export const HR_DASHBOARD_DESCRIPTION_MAX_LENGTH = 400
export const HR_DASHBOARD_URL_MAX_LENGTH = 2000

export interface HrDashboardDTO {
  id: string
  title: string
  description: string | null
  embedUrl: string
  height: number
  sortOrder: number
  /** null = painel da empresa inteira. */
  sectorId: string | null
  sectorName: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateHrDashboardRequest {
  title: string
  description?: string | null
  embedUrl: string
  height?: number
  sortOrder?: number
  sectorId?: string | null
}

export type UpdateHrDashboardRequest = Partial<CreateHrDashboardRequest>

export interface HrDashboardListResponse {
  dashboards: HrDashboardDTO[]
  /** Hosts aceitos hoje, para o formulário dizer quais ferramentas estão liberadas. */
  allowedHosts: string[]
}

/** Filtro de escopo da listagem — só ADMIN usa; `all` é o default. */
export const HR_DASHBOARD_SCOPE_ALL = 'all'
export const HR_DASHBOARD_SCOPE_COMPANY = 'company'
```

Acrescentar ao fim de `packages/shared/src/index.ts`:

```ts
export * from './hr-dashboard'
```

- [ ] **Step 2: Acrescentar o model ao schema Prisma**

Em `apps/api/prisma/schema.prisma`, acrescentar o model no fim do arquivo:

```prisma
/// Painel externo de BI embutido na administração. `sectorId` null = painel da
/// empresa inteira. A FK de setor é Cascade de propósito: com SetNull, apagar um
/// setor promoveria seus painéis a painéis da empresa e exporia dado de RH do
/// setor para toda a administração.
model HrDashboard {
  id          String   @id @default(cuid())
  title       String
  description String?
  embedUrl    String
  height      Int      @default(720)
  sortOrder   Int      @default(0)
  sectorId    String?
  companyId   String   @default("company-emr")
  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  company   Company @relation(fields: [companyId], references: [id])
  sector    Sector? @relation(fields: [sectorId], references: [id], onDelete: Cascade)
  createdBy User    @relation(fields: [createdById], references: [id])

  @@index([companyId, sectorId, sortOrder])
}
```

Acrescentar a back-relation em cada um dos três models já existentes, junto das outras listas de relação:

- `model Company`: `hrDashboards HrDashboard[]`
- `model Sector`: `hrDashboards HrDashboard[]`
- `model User`: `hrDashboards HrDashboard[]`

- [ ] **Step 3: Gerar a migration e o client**

```bash
pnpm db:up
pnpm db:migrate
```

Quando o Prisma pedir nome da migration, use `add_hr_dashboard`.
Esperado: cria `apps/api/prisma/migrations/<timestamp>_add_hr_dashboard/migration.sql` e regenera o client.

- [ ] **Step 4: Registrar o model no isolamento por empresa e na limpeza dos testes**

Em `apps/api/src/lib/tenant-scope.ts`, acrescentar `'HrDashboard',` ao `Set` `TENANT_SCOPED_MODELS` (logo depois de `'CoinTransaction',`).

Em `apps/api/test/setup.ts`, acrescentar `prisma.hrDashboard.deleteMany(),` como **primeira** linha do array do `$transaction` — antes de `prisma.refreshToken.deleteMany()`. Tem FK para `User` e `Sector`, então precisa sumir antes deles.

- [ ] **Step 5: Escrever o teste de isolamento**

Criar `apps/api/src/lib/hr-dashboard-tenant-scope.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from './prisma'
import { scopedPrisma } from './tenant-scope'

describe('isolamento por empresa do HrDashboard', () => {
  it('injeta o companyId no create e esconde painel de outra empresa', async () => {
    const other = await prisma.company.create({ data: { name: 'Outra', slug: 'outra-hr' } })
    const author = await prisma.user.create({
      data: { name: 'Autora Painel', email: 'autora-painel@empresa.com', passwordHash: 'x', role: 'ADMIN' },
    })

    const created = await scopedPrisma(DEFAULT_COMPANY_ID).hrDashboard.create({
      data: {
        title: 'Headcount',
        embedUrl: 'https://app.powerbi.com/view?r=abc',
        height: 720,
        sortOrder: 0,
        createdById: author.id,
      },
    })
    expect(created.companyId).toBe(DEFAULT_COMPANY_ID)

    const fromOtherCompany = await scopedPrisma(other.id).hrDashboard.findMany()
    expect(fromOtherCompany).toEqual([])

    const fromOwnCompany = await scopedPrisma(DEFAULT_COMPANY_ID).hrDashboard.findMany()
    expect(fromOwnCompany.map((d) => d.id)).toEqual([created.id])
  })
})
```

- [ ] **Step 6: Rodar o teste**

```bash
pnpm --filter @legends/api exec vitest run src/lib/hr-dashboard-tenant-scope.test.ts
```

Esperado: PASS. Se falhar com "hrDashboard is not a function", o Step 3 não regenerou o client — rode `pnpm db:generate`.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/hr-dashboard.ts packages/shared/src/index.ts apps/api/prisma apps/api/src/lib/tenant-scope.ts apps/api/src/lib/hr-dashboard-tenant-scope.test.ts apps/api/test/setup.ts
git commit -m "feat(shared): contrato e modelo de painel de RH"
```

---

### Task 2: Validação de URL de embed

**Files:**
- Create: `apps/api/src/lib/hr-dashboard-error.ts`
- Create: `apps/api/src/lib/embed-url.ts`
- Test: `apps/api/src/lib/embed-url.test.ts`
- Modify: `apps/api/src/lib/config.ts`
- Test: `apps/api/src/lib/config.test.ts` (criar se não existir)
- Modify: `apps/api/.env.example`

**Interfaces:**
- Consumes: nada da Task 1.
- Produces:
  - `class HrDashboardError extends Error { constructor(message: string, public status: number) }` em `lib/hr-dashboard-error.ts`
  - `assertEmbedUrlAllowed(raw: string, allowedHosts: string[]): string` em `lib/embed-url.ts` — devolve a URL normalizada ou lança `HrDashboardError` 400
  - `resolveHrDashboardAllowedHosts(env: { HR_DASHBOARD_ALLOWED_HOSTS?: string }): string[]` em `lib/config.ts`

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/api/src/lib/embed-url.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assertEmbedUrlAllowed } from './embed-url'
import { HrDashboardError } from './hr-dashboard-error'

const HOSTS = ['app.powerbi.com', 'lookerstudio.google.com']

function expectRejected(raw: string, trecho: string) {
  try {
    assertEmbedUrlAllowed(raw, HOSTS)
    throw new Error(`esperava rejeitar ${raw}`)
  } catch (err) {
    expect(err).toBeInstanceOf(HrDashboardError)
    expect((err as HrDashboardError).status).toBe(400)
    expect((err as HrDashboardError).message).toContain(trecho)
  }
}

describe('assertEmbedUrlAllowed', () => {
  it('aceita URL https de host liberado e devolve normalizada', () => {
    expect(assertEmbedUrlAllowed('https://app.powerbi.com/view?r=abc', HOSTS)).toBe(
      'https://app.powerbi.com/view?r=abc',
    )
  })

  it('aceita host liberado escrito em maiúsculas', () => {
    expect(assertEmbedUrlAllowed('https://APP.POWERBI.COM/view', HOSTS)).toBe('https://app.powerbi.com/view')
  })

  it('recusa texto que não é URL', () => {
    expectRejected('não é uma url', 'Informe uma URL válida.')
  })

  it('recusa http', () => {
    expectRejected('http://app.powerbi.com/view', 'Somente endereços https são aceitos.')
  })

  it('recusa javascript:', () => {
    expectRejected('javascript:alert(1)', 'Somente endereços https são aceitos.')
  })

  it('recusa data:', () => {
    expectRejected('data:text/html,<h1>oi</h1>', 'Somente endereços https são aceitos.')
  })

  it('recusa host fora da allowlist', () => {
    expectRejected('https://evil.com/view', 'não está entre as ferramentas liberadas')
  })

  it('recusa subdomínio forjado que só termina com o host liberado', () => {
    expectRejected('https://app.powerbi.com.evil.com/view', 'não está entre as ferramentas liberadas')
  })

  it('recusa URL com credenciais embutidas', () => {
    expectRejected('https://app.powerbi.com@evil.com/view', 'não está entre as ferramentas liberadas')
    expectRejected('https://user:senha@app.powerbi.com/view', 'URL com credenciais não é aceita.')
  })

  it('recusa URL com porta explícita', () => {
    expectRejected('https://app.powerbi.com:8443/view', 'URL com porta não é aceita.')
  })
})
```

Criar (ou acrescentar a) `apps/api/src/lib/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveHrDashboardAllowedHosts } from './config'

describe('resolveHrDashboardAllowedHosts', () => {
  it('usa a lista padrão quando a env está ausente', () => {
    expect(resolveHrDashboardAllowedHosts({})).toEqual([
      'app.powerbi.com',
      'lookerstudio.google.com',
      'datastudio.google.com',
    ])
  })

  it('usa a lista padrão quando a env está vazia', () => {
    expect(resolveHrDashboardAllowedHosts({ HR_DASHBOARD_ALLOWED_HOSTS: '  ,  ' })).toEqual([
      'app.powerbi.com',
      'lookerstudio.google.com',
      'datastudio.google.com',
    ])
  })

  it('lê a env, normaliza para minúsculas e ignora espaços', () => {
    expect(
      resolveHrDashboardAllowedHosts({ HR_DASHBOARD_ALLOWED_HOSTS: ' App.PowerBI.com , metabase.emr.local ' }),
    ).toEqual(['app.powerbi.com', 'metabase.emr.local'])
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

```bash
pnpm --filter @legends/api exec vitest run src/lib/embed-url.test.ts src/lib/config.test.ts
```

Esperado: FAIL — "Failed to resolve import ./embed-url" e "resolveHrDashboardAllowedHosts is not a function".

- [ ] **Step 3: Implementar o erro de domínio**

Criar `apps/api/src/lib/hr-dashboard-error.ts`:

```ts
/**
 * Erro de domínio dos painéis de RH, no padrão `VoteError`. Mora em `lib/` (e
 * não no service) porque `embed-url.ts` também o lança — deixá-lo no service
 * criaria um ciclo de import entre service e lib.
 */
export class HrDashboardError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'HrDashboardError'
  }
}
```

- [ ] **Step 4: Implementar a validação de URL**

Criar `apps/api/src/lib/embed-url.ts`:

```ts
import { HrDashboardError } from './hr-dashboard-error'

/**
 * Valida uma URL de embed de terceiro antes de ela virar `src` de um iframe.
 * Só https, só host da allowlist, por igualdade EXATA de hostname — comparar por
 * sufixo deixaria passar `app.powerbi.com.evil.com`.
 *
 * Devolve a URL normalizada, que é o valor persistido.
 */
export function assertEmbedUrlAllowed(raw: string, allowedHosts: string[]): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new HrDashboardError('Informe uma URL válida.', 400)
  }

  if (url.protocol !== 'https:') {
    throw new HrDashboardError('Somente endereços https são aceitos.', 400)
  }
  if (url.username !== '' || url.password !== '') {
    throw new HrDashboardError('URL com credenciais não é aceita.', 400)
  }
  if (url.port !== '') {
    throw new HrDashboardError('URL com porta não é aceita.', 400)
  }

  const host = url.hostname.toLowerCase()
  const allowed = allowedHosts.map((entry) => entry.trim().toLowerCase())
  if (!allowed.includes(host)) {
    throw new HrDashboardError(`O endereço ${host} não está entre as ferramentas liberadas.`, 400)
  }

  return url.toString()
}
```

- [ ] **Step 5: Implementar a allowlist configurável**

Acrescentar ao fim de `apps/api/src/lib/config.ts`:

```ts
/**
 * Hosts aceitos como origem de painel de RH embutido. Repetidos no `frame-src`
 * do CSP em `nginx/default.conf` — mexeu aqui, mexa lá.
 */
const HR_DASHBOARD_DEFAULT_ALLOWED_HOSTS = [
  'app.powerbi.com',
  'lookerstudio.google.com',
  'datastudio.google.com',
]

export function resolveHrDashboardAllowedHosts(env: { HR_DASHBOARD_ALLOWED_HOSTS?: string }): string[] {
  const configured = (env.HR_DASHBOARD_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0)
  return configured.length > 0 ? configured : [...HR_DASHBOARD_DEFAULT_ALLOWED_HOSTS]
}
```

Acrescentar ao fim de `apps/api/.env.example`:

```
# Hosts liberados para painéis de RH embutidos (CSV). Vazio = app.powerbi.com,
# lookerstudio.google.com, datastudio.google.com. O host do Metabase interno entra aqui.
# Precisa bater com o frame-src do CSP em nginx/default.conf.
HR_DASHBOARD_ALLOWED_HOSTS=
```

- [ ] **Step 6: Rodar os testes e ver passar**

```bash
pnpm --filter @legends/api exec vitest run src/lib/embed-url.test.ts src/lib/config.test.ts
```

Esperado: PASS, 13 testes.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/embed-url.ts apps/api/src/lib/embed-url.test.ts apps/api/src/lib/hr-dashboard-error.ts apps/api/src/lib/config.ts apps/api/src/lib/config.test.ts apps/api/.env.example
git commit -m "feat(api): validação de URL de embed contra allowlist de hosts"
```

---

### Task 3: Service de painéis de RH

**Files:**
- Create: `apps/api/src/services/hr-dashboard-service.ts`
- Test: `apps/api/src/services/hr-dashboard-service.test.ts`

**Interfaces:**
- Consumes: `assertEmbedUrlAllowed`, `resolveHrDashboardAllowedHosts`, `HrDashboardError` (Task 2); `CreateHrDashboardRequest`, `UpdateHrDashboardRequest`, `HR_DASHBOARD_DEFAULT_HEIGHT` (Task 1); `recordAuditLog` (`services/audit-log-service.ts`); `scopedPrisma`.
- Produces:
  - `interface HrDashboardActor { id: string; role: string; sectorId: string; companyId: string }`
  - `type HrDashboardWithSector = HrDashboard & { sector: { id: string; name: string } | null }`
  - `listHrDashboards(actor: HrDashboardActor, scope?: string): Promise<HrDashboardWithSector[]>`
  - `createHrDashboard(actor: HrDashboardActor, input: CreateHrDashboardRequest): Promise<HrDashboardWithSector>`
  - `updateHrDashboard(actor: HrDashboardActor, id: string, input: UpdateHrDashboardRequest): Promise<HrDashboardWithSector>`
  - `deleteHrDashboard(actor: HrDashboardActor, id: string): Promise<void>`

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/api/src/services/hr-dashboard-service.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { HrDashboardError } from '../lib/hr-dashboard-error'
import {
  createHrDashboard,
  deleteHrDashboard,
  listHrDashboards,
  updateHrDashboard,
  type HrDashboardActor,
} from './hr-dashboard-service'

const URL_OK = 'https://app.powerbi.com/view?r=abc'

let admin: HrDashboardActor
let subadmin: HrDashboardActor
let outroSetorId: string

beforeEach(async () => {
  const outroSetor = await prisma.sector.create({ data: { name: 'Gente e Gestão', slug: 'gente-e-gestao' } })
  outroSetorId = outroSetor.id
  const adminRow = await prisma.user.create({
    data: { name: 'Admin Painel', email: 'admin-painel@empresa.com', passwordHash: 'x', role: 'ADMIN' },
  })
  const subadminRow = await prisma.user.create({
    data: {
      name: 'Sub Painel',
      email: 'sub-painel@empresa.com',
      passwordHash: 'x',
      role: 'SUBADMIN',
      sectorId: outroSetor.id,
    },
  })
  admin = { id: adminRow.id, role: 'ADMIN', sectorId: adminRow.sectorId, companyId: DEFAULT_COMPANY_ID }
  subadmin = { id: subadminRow.id, role: 'SUBADMIN', sectorId: outroSetor.id, companyId: DEFAULT_COMPANY_ID }
})

describe('createHrDashboard', () => {
  it('cria painel da empresa e grava auditoria', async () => {
    const created = await createHrDashboard(admin, { title: 'Headcount', embedUrl: URL_OK })

    expect(created.sectorId).toBeNull()
    expect(created.height).toBe(720)
    expect(await prisma.adminAuditLog.count({ where: { entityType: 'HrDashboard', action: 'CREATE' } })).toBe(1)
  })

  it('recusa host fora da allowlist', async () => {
    await expect(createHrDashboard(admin, { title: 'X', embedUrl: 'https://evil.com/x' })).rejects.toMatchObject({
      status: 400,
    })
  })

  it('força o painel do subadmin para o setor dele quando o setor é omitido', async () => {
    const created = await createHrDashboard(subadmin, { title: 'Turnover', embedUrl: URL_OK })
    expect(created.sectorId).toBe(outroSetorId)
  })

  it('recusa subadmin criando painel de outro escopo', async () => {
    await expect(
      createHrDashboard(subadmin, { title: 'X', embedUrl: URL_OK, sectorId: DEFAULT_SECTOR_ID }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      createHrDashboard(subadmin, { title: 'X', embedUrl: URL_OK, sectorId: null }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('recusa setor inexistente informado pelo admin', async () => {
    await expect(
      createHrDashboard(admin, { title: 'X', embedUrl: URL_OK, sectorId: 'setor-que-nao-existe' }),
    ).rejects.toBeInstanceOf(HrDashboardError)
  })
})

describe('listHrDashboards', () => {
  it('devolve na ordem de sortOrder, com createdAt como desempate', async () => {
    await createHrDashboard(admin, { title: 'Terceiro', embedUrl: URL_OK, sortOrder: 30 })
    await createHrDashboard(admin, { title: 'Primeiro', embedUrl: URL_OK, sortOrder: 10 })
    await createHrDashboard(admin, { title: 'Segundo', embedUrl: URL_OK, sortOrder: 20 })

    const listed = await listHrDashboards(admin)
    expect(listed.map((d) => d.title)).toEqual(['Primeiro', 'Segundo', 'Terceiro'])
  })

  it('mostra ao subadmin os painéis da empresa e do próprio setor, não os de outro setor', async () => {
    await createHrDashboard(admin, { title: 'Da empresa', embedUrl: URL_OK })
    await createHrDashboard(admin, { title: 'Do meu setor', embedUrl: URL_OK, sectorId: outroSetorId })
    await createHrDashboard(admin, { title: 'De outro setor', embedUrl: URL_OK, sectorId: DEFAULT_SECTOR_ID })

    const listed = await listHrDashboards(subadmin)
    expect(listed.map((d) => d.title).sort()).toEqual(['Da empresa', 'Do meu setor'])
  })

  it('filtra por escopo para o admin', async () => {
    await createHrDashboard(admin, { title: 'Da empresa', embedUrl: URL_OK })
    await createHrDashboard(admin, { title: 'Do setor', embedUrl: URL_OK, sectorId: outroSetorId })

    expect((await listHrDashboards(admin, 'company')).map((d) => d.title)).toEqual(['Da empresa'])
    expect((await listHrDashboards(admin, outroSetorId)).map((d) => d.title)).toEqual(['Do setor'])
    expect((await listHrDashboards(admin, 'all')).length).toBe(2)
  })

  it('inclui o nome do setor do painel', async () => {
    await createHrDashboard(admin, { title: 'Do setor', embedUrl: URL_OK, sectorId: outroSetorId })
    const [dashboard] = await listHrDashboards(admin)
    expect(dashboard.sector?.name).toBe('Gente e Gestão')
  })
})

describe('updateHrDashboard', () => {
  it('atualiza campos, revalida a URL e grava auditoria com before/after', async () => {
    const created = await createHrDashboard(admin, { title: 'Headcount', embedUrl: URL_OK })

    const updated = await updateHrDashboard(admin, created.id, {
      title: 'Headcount 2026',
      embedUrl: 'https://lookerstudio.google.com/embed/reporting/xyz',
      height: 900,
    })

    expect(updated.title).toBe('Headcount 2026')
    expect(updated.height).toBe(900)
    const log = await prisma.adminAuditLog.findFirst({ where: { entityType: 'HrDashboard', action: 'UPDATE' } })
    expect((log?.before as { title: string }).title).toBe('Headcount')
    expect((log?.after as { title: string }).title).toBe('Headcount 2026')
  })

  it('recusa URL inválida na atualização', async () => {
    const created = await createHrDashboard(admin, { title: 'Headcount', embedUrl: URL_OK })
    await expect(
      updateHrDashboard(admin, created.id, { embedUrl: 'http://app.powerbi.com/view' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('recusa subadmin editando painel da empresa ou de outro setor', async () => {
    const daEmpresa = await createHrDashboard(admin, { title: 'Da empresa', embedUrl: URL_OK })
    const deOutro = await createHrDashboard(admin, { title: 'De outro', embedUrl: URL_OK, sectorId: DEFAULT_SECTOR_ID })

    await expect(updateHrDashboard(subadmin, daEmpresa.id, { title: 'X' })).rejects.toMatchObject({ status: 403 })
    await expect(updateHrDashboard(subadmin, deOutro.id, { title: 'X' })).rejects.toMatchObject({ status: 403 })
  })

  it('recusa subadmin movendo o próprio painel para outro escopo', async () => {
    const meu = await createHrDashboard(subadmin, { title: 'Meu', embedUrl: URL_OK })
    await expect(updateHrDashboard(subadmin, meu.id, { sectorId: null })).rejects.toMatchObject({ status: 403 })
  })

  it('devolve 404 para painel inexistente', async () => {
    await expect(updateHrDashboard(admin, 'nao-existe', { title: 'X' })).rejects.toMatchObject({ status: 404 })
  })
})

describe('deleteHrDashboard', () => {
  it('apaga e grava auditoria', async () => {
    const created = await createHrDashboard(admin, { title: 'Headcount', embedUrl: URL_OK })
    await deleteHrDashboard(admin, created.id)

    expect(await prisma.hrDashboard.count()).toBe(0)
    expect(await prisma.adminAuditLog.count({ where: { entityType: 'HrDashboard', action: 'DELETE' } })).toBe(1)
  })

  it('recusa subadmin apagando painel da empresa', async () => {
    const created = await createHrDashboard(admin, { title: 'Da empresa', embedUrl: URL_OK })
    await expect(deleteHrDashboard(subadmin, created.id)).rejects.toMatchObject({ status: 403 })
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

```bash
pnpm --filter @legends/api exec vitest run src/services/hr-dashboard-service.test.ts
```

Esperado: FAIL — "Failed to resolve import ./hr-dashboard-service".

- [ ] **Step 3: Implementar o service**

Criar `apps/api/src/services/hr-dashboard-service.ts`:

```ts
import { Prisma, type HrDashboard } from '@prisma/client'
import {
  HR_DASHBOARD_DEFAULT_HEIGHT,
  HR_DASHBOARD_SCOPE_ALL,
  HR_DASHBOARD_SCOPE_COMPANY,
  type CreateHrDashboardRequest,
  type UpdateHrDashboardRequest,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { resolveHrDashboardAllowedHosts } from '../lib/config'
import { assertEmbedUrlAllowed } from '../lib/embed-url'
import { HrDashboardError } from '../lib/hr-dashboard-error'
import { recordAuditLog } from './audit-log-service'

export interface HrDashboardActor {
  id: string
  role: string
  sectorId: string
  companyId: string
}

const sectorInclude = { sector: { select: { id: true, name: true } } } as const

export type HrDashboardWithSector = HrDashboard & { sector: { id: string; name: string } | null }

function validateUrl(raw: string): string {
  return assertEmbedUrlAllowed(raw, resolveHrDashboardAllowedHosts(process.env))
}

/** SUBADMIN só gerencia painel do próprio setor — nem os da empresa, nem os de outro setor. */
function assertCanManage(actor: HrDashboardActor, sectorId: string | null): void {
  if (actor.role === 'SUBADMIN' && sectorId !== actor.sectorId) {
    throw new HrDashboardError('Você só pode gerenciar painéis do seu setor.', 403)
  }
}

/**
 * Escopo de destino de uma escrita. Para o SUBADMIN, `sectorId` omitido assume o
 * setor dele; qualquer escopo explícito diferente (inclusive `null`, que é o
 * painel da empresa) é 403.
 */
function resolveSectorIdForWrite(actor: HrDashboardActor, requested: string | null | undefined): string | null {
  if (actor.role === 'SUBADMIN') {
    if (requested === undefined || requested === actor.sectorId) return actor.sectorId
    throw new HrDashboardError('Você só pode gerenciar painéis do seu setor.', 403)
  }
  return requested ?? null
}

async function assertSectorExists(companyId: string, sectorId: string | null): Promise<void> {
  if (sectorId === null) return
  // `findFirst` (e não `findUnique`) porque a extensão de isolamento acrescenta
  // companyId ao where — não existe unique composto (id, companyId).
  const sector = await scopedPrisma(companyId).sector.findFirst({ where: { id: sectorId } })
  if (!sector) throw new HrDashboardError('Setor não encontrado.', 404)
}

export function listHrDashboards(actor: HrDashboardActor, scope?: string): Promise<HrDashboardWithSector[]> {
  const db = scopedPrisma(actor.companyId)

  let where: Prisma.HrDashboardWhereInput | undefined
  if (actor.role === 'SUBADMIN') {
    where = { OR: [{ sectorId: null }, { sectorId: actor.sectorId }] }
  } else if (scope === HR_DASHBOARD_SCOPE_COMPANY) {
    where = { sectorId: null }
  } else if (scope !== undefined && scope !== HR_DASHBOARD_SCOPE_ALL) {
    where = { sectorId: scope }
  }

  return db.hrDashboard.findMany({
    where,
    include: sectorInclude,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
}

export async function createHrDashboard(
  actor: HrDashboardActor,
  input: CreateHrDashboardRequest,
): Promise<HrDashboardWithSector> {
  const db = scopedPrisma(actor.companyId)
  const embedUrl = validateUrl(input.embedUrl)
  const sectorId = resolveSectorIdForWrite(actor, input.sectorId)
  await assertSectorExists(actor.companyId, sectorId)

  return db.$transaction(async (tx) => {
    const created = await tx.hrDashboard.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        embedUrl,
        height: input.height ?? HR_DASHBOARD_DEFAULT_HEIGHT,
        sortOrder: input.sortOrder ?? 0,
        sectorId,
        createdById: actor.id,
      },
      include: sectorInclude,
    })
    // Cast igual ao dos outros services: o tx da extensão não é um
    // Prisma.TransactionClient cru, mas o companyId vai explícito no recordAuditLog.
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'HrDashboard',
      entityId: created.id,
      action: 'CREATE',
      after: created,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return created
  })
}

export async function updateHrDashboard(
  actor: HrDashboardActor,
  id: string,
  input: UpdateHrDashboardRequest,
): Promise<HrDashboardWithSector> {
  const db = scopedPrisma(actor.companyId)
  const before = await db.hrDashboard.findFirst({ where: { id }, include: sectorInclude })
  if (!before) throw new HrDashboardError('Painel não encontrado.', 404)
  assertCanManage(actor, before.sectorId)

  const data: Prisma.HrDashboardUncheckedUpdateInput = {}
  if (input.title !== undefined) data.title = input.title
  if (input.description !== undefined) data.description = input.description ?? null
  if (input.embedUrl !== undefined) data.embedUrl = validateUrl(input.embedUrl)
  if (input.height !== undefined) data.height = input.height
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder
  if (input.sectorId !== undefined) {
    const nextSectorId = resolveSectorIdForWrite(actor, input.sectorId)
    await assertSectorExists(actor.companyId, nextSectorId)
    data.sectorId = nextSectorId
  }

  return db.$transaction(async (tx) => {
    await tx.hrDashboard.update({ where: { id }, data })
    const after = await tx.hrDashboard.findUniqueOrThrow({ where: { id }, include: sectorInclude })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'HrDashboard',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return after
  })
}

export async function deleteHrDashboard(actor: HrDashboardActor, id: string): Promise<void> {
  const db = scopedPrisma(actor.companyId)
  const before = await db.hrDashboard.findFirst({ where: { id }, include: sectorInclude })
  if (!before) throw new HrDashboardError('Painel não encontrado.', 404)
  assertCanManage(actor, before.sectorId)

  await db.$transaction(async (tx) => {
    await tx.hrDashboard.delete({ where: { id } })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'HrDashboard',
      entityId: id,
      action: 'DELETE',
      before,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
  })
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

```bash
pnpm --filter @legends/api exec vitest run src/services/hr-dashboard-service.test.ts
```

Esperado: PASS, 15 testes. Se `assertSectorExists` reclamar de tipo no `findFirst`, confira que `scopedPrisma` foi usado (e não `prisma` cru).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/hr-dashboard-service.ts apps/api/src/services/hr-dashboard-service.test.ts
git commit -m "feat(api): service de painéis de RH com escopo por papel e auditoria"
```

---

### Task 4: Rotas HTTP

**Files:**
- Create: `apps/api/src/routes/hr-dashboards.ts`
- Test: `apps/api/src/routes/hr-dashboards.test.ts`
- Modify: `apps/api/src/lib/serialize.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: tudo que a Task 3 produz; `HrDashboardError` (Task 2); constantes de limite (Task 1).
- Produces:
  - `toHrDashboardDTO(dashboard: HrDashboardWithSector): HrDashboardDTO` em `lib/serialize.ts`
  - `hrDashboardRoutes(app: FastifyInstance)` registrada em `app.ts`
  - Endpoints: `GET /admin/hr-dashboards?scope=`, `POST /admin/hr-dashboards`, `PATCH /admin/hr-dashboards/:id`, `DELETE /admin/hr-dashboards/:id`

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/api/src/routes/hr-dashboards.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'

const URL_OK = 'https://app.powerbi.com/view?r=abc'

async function criarUsuario(role: string, email: string, sectorId?: string) {
  return prisma.user.create({
    data: { name: `Usuário ${role}`, email, passwordHash: 'x', role: role as never, ...(sectorId ? { sectorId } : {}) },
  })
}

let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  app = buildApp()
  await app.ready()
})

describe('rotas de painéis de RH', () => {
  it('cria e lista painel na ordem de sortOrder', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-rota-painel@empresa.com')
    const token = signAccessToken(app, admin)
    const auth = { authorization: `Bearer ${token}` }

    const segundo = await app.inject({
      method: 'POST', url: '/admin/hr-dashboards', headers: auth,
      payload: { title: 'Segundo', embedUrl: URL_OK, sortOrder: 20 },
    })
    expect(segundo.statusCode).toBe(201)

    const primeiro = await app.inject({
      method: 'POST', url: '/admin/hr-dashboards', headers: auth,
      payload: { title: 'Primeiro', embedUrl: URL_OK, sortOrder: 10, height: 800 },
    })
    expect(primeiro.statusCode).toBe(201)
    expect(primeiro.json().dashboard.height).toBe(800)

    const listagem = await app.inject({ method: 'GET', url: '/admin/hr-dashboards', headers: auth })
    expect(listagem.statusCode).toBe(200)
    expect(listagem.json().dashboards.map((d: { title: string }) => d.title)).toEqual(['Primeiro', 'Segundo'])
    expect(listagem.json().allowedHosts).toContain('app.powerbi.com')
  })

  it('recusa esquema diferente de https com 400 em português', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-http-painel@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'POST', url: '/admin/hr-dashboards', headers: auth,
      payload: { title: 'X', embedUrl: 'http://app.powerbi.com/view' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Somente endereços https são aceitos.')
  })

  it('recusa host fora da allowlist em chamada direta à API', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-host-painel@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'POST', url: '/admin/hr-dashboards', headers: auth,
      payload: { title: 'X', embedUrl: 'https://evil.com/painel' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain('não está entre as ferramentas liberadas')
  })

  it('recusa altura fora de 300–2000', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-altura-painel@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    for (const height of [299, 2001]) {
      const res = await app.inject({
        method: 'POST', url: '/admin/hr-dashboards', headers: auth,
        payload: { title: 'X', embedUrl: URL_OK, height },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().issues).toBeDefined()
    }
  })

  it('bloqueia quem não é admin nem subadmin', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-painel@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, legend)}` }

    const res = await app.inject({ method: 'GET', url: '/admin/hr-dashboards', headers: auth })
    expect(res.statusCode).toBe(403)
  })

  it('exige autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/hr-dashboards' })
    expect(res.statusCode).toBe(401)
  })

  it('esconde do subadmin o painel de outro setor', async () => {
    const setor = await prisma.sector.create({ data: { name: 'Gente e Gestão', slug: 'gente-e-gestao' } })
    const admin = await criarUsuario('ADMIN', 'admin-escopo-painel@empresa.com')
    const sub = await criarUsuario('SUBADMIN', 'sub-escopo-painel@empresa.com', setor.id)
    const adminAuth = { authorization: `Bearer ${signAccessToken(app, admin)}` }
    const subAuth = { authorization: `Bearer ${signAccessToken(app, sub)}` }

    await app.inject({
      method: 'POST', url: '/admin/hr-dashboards', headers: adminAuth,
      payload: { title: 'De outro setor', embedUrl: URL_OK, sectorId: DEFAULT_SECTOR_ID },
    })
    await app.inject({
      method: 'POST', url: '/admin/hr-dashboards', headers: adminAuth,
      payload: { title: 'Do meu setor', embedUrl: URL_OK, sectorId: setor.id },
    })

    const listagem = await app.inject({ method: 'GET', url: '/admin/hr-dashboards', headers: subAuth })
    expect(listagem.json().dashboards.map((d: { title: string }) => d.title)).toEqual(['Do meu setor'])
  })

  it('atualiza e apaga um painel', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-crud-painel@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const criado = await app.inject({
      method: 'POST', url: '/admin/hr-dashboards', headers: auth,
      payload: { title: 'Headcount', embedUrl: URL_OK },
    })
    const id = criado.json().dashboard.id

    const alterado = await app.inject({
      method: 'PATCH', url: `/admin/hr-dashboards/${id}`, headers: auth,
      payload: { title: 'Headcount 2026' },
    })
    expect(alterado.statusCode).toBe(200)
    expect(alterado.json().dashboard.title).toBe('Headcount 2026')

    const apagado = await app.inject({ method: 'DELETE', url: `/admin/hr-dashboards/${id}`, headers: auth })
    expect(apagado.statusCode).toBe(204)
    expect(await prisma.hrDashboard.count()).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

```bash
pnpm --filter @legends/api exec vitest run src/routes/hr-dashboards.test.ts
```

Esperado: FAIL — 404 em todas as rotas, porque elas ainda não existem.

- [ ] **Step 3: Implementar o serializer**

Em `apps/api/src/lib/serialize.ts`, acrescentar o import de tipo `type HrDashboardDTO,` à lista de imports de `@legends/shared`, o import `import type { HrDashboardWithSector } from '../services/hr-dashboard-service'`, e a função no fim do arquivo:

```ts
/** Entidade Prisma (com o setor incluído) → DTO do painel de RH. */
export function toHrDashboardDTO(dashboard: HrDashboardWithSector): HrDashboardDTO {
  return {
    id: dashboard.id,
    title: dashboard.title,
    description: dashboard.description,
    embedUrl: dashboard.embedUrl,
    height: dashboard.height,
    sortOrder: dashboard.sortOrder,
    sectorId: dashboard.sectorId,
    sectorName: dashboard.sector?.name ?? null,
    createdAt: dashboard.createdAt.toISOString(),
    updatedAt: dashboard.updatedAt.toISOString(),
  }
}
```

- [ ] **Step 4: Implementar as rotas**

Criar `apps/api/src/routes/hr-dashboards.ts`:

```ts
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  HR_DASHBOARD_DESCRIPTION_MAX_LENGTH,
  HR_DASHBOARD_MAX_HEIGHT,
  HR_DASHBOARD_MIN_HEIGHT,
  HR_DASHBOARD_TITLE_MAX_LENGTH,
  HR_DASHBOARD_URL_MAX_LENGTH,
} from '@legends/shared'
import { HrDashboardError } from '../lib/hr-dashboard-error'
import { resolveHrDashboardAllowedHosts } from '../lib/config'
import { toHrDashboardDTO } from '../lib/serialize'
import {
  createHrDashboard,
  deleteHrDashboard,
  listHrDashboards,
  updateHrDashboard,
  type HrDashboardActor,
} from '../services/hr-dashboard-service'

const idParamsSchema = z.object({ id: z.string().min(1) })
const listQuerySchema = z.object({ scope: z.string().min(1).optional() })

const baseSchema = {
  title: z.string().trim().min(1).max(HR_DASHBOARD_TITLE_MAX_LENGTH),
  description: z.string().trim().max(HR_DASHBOARD_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  embedUrl: z.string().trim().min(1).max(HR_DASHBOARD_URL_MAX_LENGTH),
  height: z.number().int().min(HR_DASHBOARD_MIN_HEIGHT).max(HR_DASHBOARD_MAX_HEIGHT).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  sectorId: z.string().min(1).nullable().optional(),
}
const createSchema = z.object(baseSchema)
const updateSchema = z.object(baseSchema).partial()

/** Erro de domínio → resposta; o resto sobe. */
function handleHrDashboardError(err: unknown, reply: FastifyReply) {
  if (err instanceof HrDashboardError) return reply.code(err.status).send({ message: err.message })
  throw err
}

function actorFrom(request: { user: { sub: string; role: string; sectorId: string; companyId: string } }): HrDashboardActor {
  return {
    id: request.user.sub,
    role: request.user.role,
    sectorId: request.user.sectorId,
    companyId: request.user.companyId,
  }
}

export async function hrDashboardRoutes(app: FastifyInstance) {
  // Painel de RH é dado de liderança: mesmo a leitura exige ADMIN ou SUBADMIN.
  const guard = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }

  app.get('/admin/hr-dashboards', guard, async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: query.error.issues })
    }
    const dashboards = await listHrDashboards(actorFrom(request), query.data.scope)
    return reply.send({
      dashboards: dashboards.map(toHrDashboardDTO),
      allowedHosts: resolveHrDashboardAllowedHosts(process.env),
    })
  })

  app.post('/admin/hr-dashboards', guard, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const created = await createHrDashboard(actorFrom(request), parsed.data)
      return reply.code(201).send({ dashboard: toHrDashboardDTO(created) })
    } catch (err) {
      return handleHrDashboardError(err, reply)
    }
  })

  app.patch('/admin/hr-dashboards/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const updated = await updateHrDashboard(actorFrom(request), params.data.id, parsed.data)
      return reply.send({ dashboard: toHrDashboardDTO(updated) })
    } catch (err) {
      return handleHrDashboardError(err, reply)
    }
  })

  app.delete('/admin/hr-dashboards/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      await deleteHrDashboard(actorFrom(request), params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handleHrDashboardError(err, reply)
    }
  })
}
```

Em `apps/api/src/app.ts`: acrescentar `import { hrDashboardRoutes } from './routes/hr-dashboards'` junto dos outros imports de rota, e `app.register(hrDashboardRoutes)` logo depois de `app.register(cultureRoutes)`.

- [ ] **Step 5: Rodar os testes e ver passar**

```bash
pnpm --filter @legends/api exec vitest run src/routes/hr-dashboards.test.ts
```

Esperado: PASS, 8 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/hr-dashboards.ts apps/api/src/routes/hr-dashboards.test.ts apps/api/src/lib/serialize.ts apps/api/src/app.ts
git commit -m "feat(api): rotas de painéis de RH sob requireAdminOrSubadmin"
```

---

### Task 5: Tela de administração

**Files:**
- Create: `apps/web/src/pages/admin/HrDashboardsSection.tsx`
- Test: `apps/web/src/pages/admin/HrDashboardsSection.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/admin/AdminSidebar.tsx`

**Interfaces:**
- Consumes: endpoints da Task 4; tipos e constantes da Task 1; `apiFetch` (`src/lib/api.ts`); `useAuth` (`src/auth/AuthContext`); `Panel` e `inputCls` (`src/pages/admin/shared.tsx`).
- Produces: `HrDashboardsSection` (named export), rota `/admin/paineis`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/web/src/pages/admin/HrDashboardsSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'ADMIN', name: 'Admin' } }),
}))

import { HrDashboardsSection } from './HrDashboardsSection'

const ALLOWED = ['app.powerbi.com', 'lookerstudio.google.com']

function dashboard(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'd1',
    title: 'Headcount',
    description: 'Pessoas ativas por setor',
    embedUrl: 'https://app.powerbi.com/view?r=abc',
    height: 720,
    sortOrder: 10,
    sectorId: null,
    sectorName: null,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...over,
  }
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <HrDashboardsSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiFetchMock.mockReset()
})

describe('HrDashboardsSection', () => {
  it('mostra estado vazio com a ação de cadastrar o primeiro painel', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/admin/hr-dashboards')) return Promise.resolve({ dashboards: [], allowedHosts: ALLOWED })
      return Promise.resolve({ sectors: [] })
    })

    renderSection()

    expect(await screen.findByText('Nenhum painel cadastrado ainda')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cadastrar o primeiro painel' })).toBeInTheDocument()
  })

  it('renderiza os iframes na ordem de sortOrder, em sandbox e sem navegação no topo', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/admin/hr-dashboards')) {
        return Promise.resolve({
          dashboards: [
            dashboard({ id: 'd1', title: 'Headcount', sortOrder: 10 }),
            dashboard({
              id: 'd2',
              title: 'Turnover',
              sortOrder: 20,
              sectorId: 's1',
              sectorName: 'Gente e Gestão',
              embedUrl: 'https://lookerstudio.google.com/embed/reporting/xyz',
            }),
          ],
          allowedHosts: ALLOWED,
        })
      }
      return Promise.resolve({ sectors: [{ id: 's1', name: 'Gente e Gestão' }] })
    })

    const { container } = renderSection()

    await screen.findByText('Headcount')
    const iframes = Array.from(container.querySelectorAll('iframe'))
    expect(iframes.map((f) => f.getAttribute('title'))).toEqual(['Headcount', 'Turnover'])

    for (const frame of iframes) {
      const sandbox = frame.getAttribute('sandbox') ?? ''
      expect(sandbox).toBe('allow-scripts allow-same-origin')
      expect(sandbox).not.toContain('allow-top-navigation')
      expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
      expect(frame.getAttribute('loading')).toBe('lazy')
    }

    expect(iframes[0].getAttribute('height')).toBe('720')
    expect(screen.getByText('Gente e Gestão')).toBeInTheDocument()
  })

  it('mostra a mensagem de erro do backend ao cadastrar URL recusada', async () => {
    apiFetchMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path.startsWith('/admin/hr-dashboards') && init?.method === 'POST') {
        return Promise.reject(new Error('O endereço evil.com não está entre as ferramentas liberadas.'))
      }
      if (path.startsWith('/admin/hr-dashboards')) return Promise.resolve({ dashboards: [], allowedHosts: ALLOWED })
      return Promise.resolve({ sectors: [] })
    })

    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Cadastrar o primeiro painel' }))
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Painel' } })
    fireEvent.change(screen.getByLabelText('URL de embed'), { target: { value: 'https://evil.com/x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar painel' }))

    await waitFor(() =>
      expect(screen.getByText('O endereço evil.com não está entre as ferramentas liberadas.')).toBeInTheDocument(),
    )
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/HrDashboardsSection.test.tsx
```

Esperado: FAIL — "Failed to resolve import ./HrDashboardsSection".

- [ ] **Step 3: Implementar a seção**

Criar `apps/web/src/pages/admin/HrDashboardsSection.tsx`:

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  HR_DASHBOARD_DEFAULT_HEIGHT,
  HR_DASHBOARD_MAX_HEIGHT,
  HR_DASHBOARD_MIN_HEIGHT,
  HR_DASHBOARD_SCOPE_ALL,
  HR_DASHBOARD_SCOPE_COMPANY,
  type CreateHrDashboardRequest,
  type HrDashboardDTO,
  type HrDashboardListResponse,
  type SectorDTO,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../auth/AuthContext'
import { Panel, inputCls } from './shared'

interface FormState {
  title: string
  description: string
  embedUrl: string
  height: number
  sortOrder: number
  sectorId: string
}

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  embedUrl: '',
  height: HR_DASHBOARD_DEFAULT_HEIGHT,
  sortOrder: 0,
  sectorId: '',
}

function toRequest(form: FormState, isAdmin: boolean): CreateHrDashboardRequest {
  return {
    title: form.title.trim(),
    description: form.description.trim() === '' ? null : form.description.trim(),
    embedUrl: form.embedUrl.trim(),
    height: form.height,
    sortOrder: form.sortOrder,
    // O SUBADMIN não escolhe escopo: o backend força o setor dele.
    ...(isAdmin ? { sectorId: form.sectorId === '' ? null : form.sectorId } : {}),
  }
}

/**
 * Painéis externos de BI embutidos na administração. A URL nunca é validada
 * aqui: quem decide o que pode virar `src` de iframe é o backend, contra a
 * allowlist de hosts — a lista só aparece na tela como dica.
 */
export function HrDashboardsSection() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<string>(HR_DASHBOARD_SCOPE_ALL)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const listKey = ['admin', 'hr-dashboards', scope] as const
  const { data, isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () => apiFetch<HrDashboardListResponse>(`/admin/hr-dashboards?scope=${encodeURIComponent(scope)}`),
  })
  const { data: sectorsData } = useQuery({
    queryKey: ['admin', 'sectors'] as const,
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
    enabled: isAdmin,
  })

  const sectors = sectorsData?.sectors ?? []
  const dashboards = data?.dashboards ?? []
  const allowedHosts = data?.allowedHosts ?? []

  function closeForm() {
    setFormOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    saveMutation.reset()
  }

  const saveMutation = useMutation({
    mutationFn: (payload: { id: string | null; body: CreateHrDashboardRequest }) =>
      apiFetch<{ dashboard: HrDashboardDTO }>(
        payload.id ? `/admin/hr-dashboards/${payload.id}` : '/admin/hr-dashboards',
        { method: payload.id ? 'PATCH' : 'POST', body: JSON.stringify(payload.body) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'hr-dashboards'] })
      closeForm()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/admin/hr-dashboards/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'hr-dashboards'] }),
  })

  function startEdit(dashboard: HrDashboardDTO) {
    setEditingId(dashboard.id)
    setForm({
      title: dashboard.title,
      description: dashboard.description ?? '',
      embedUrl: dashboard.embedUrl,
      height: dashboard.height,
      sortOrder: dashboard.sortOrder,
      sectorId: dashboard.sectorId ?? '',
    })
    setFormOpen(true)
  }

  return (
    <Panel
      title="Painéis de RH"
      action={
        <div className="flex flex-wrap items-center gap-sm">
          {isAdmin && (
            <select
              aria-label="Escopo"
              className={inputCls}
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value={HR_DASHBOARD_SCOPE_ALL}>Todos os escopos</option>
              <option value={HR_DASHBOARD_SCOPE_COMPANY}>Empresa</option>
              {sectors.map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {sector.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="rounded-md bg-primary px-md py-sm font-label text-label-md text-on-primary"
            onClick={() => {
              setEditingId(null)
              setForm(EMPTY_FORM)
              setFormOpen(true)
            }}
          >
            Novo painel
          </button>
        </div>
      }
    >
      {formOpen && (
        <form
          className="mb-lg flex flex-col gap-md rounded-lg border border-outline-variant/40 p-md"
          onSubmit={(event) => {
            event.preventDefault()
            saveMutation.mutate({ id: editingId, body: toRequest(form, isAdmin) })
          }}
        >
          <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
            Título
            <input
              className={inputCls}
              value={form.title}
              onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
              required
            />
          </label>
          <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
            Descrição
            <input
              className={inputCls}
              value={form.description}
              onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
            URL de embed
            <input
              className={inputCls}
              value={form.embedUrl}
              onChange={(event) => setForm((f) => ({ ...f, embedUrl: event.target.value }))}
              required
            />
          </label>
          <p className="font-body text-body-sm text-on-surface-variant">
            Ferramentas liberadas: {allowedHosts.join(', ')}
          </p>
          <div className="flex flex-wrap gap-md">
            <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
              Altura (px)
              <input
                type="number"
                className={inputCls}
                min={HR_DASHBOARD_MIN_HEIGHT}
                max={HR_DASHBOARD_MAX_HEIGHT}
                value={form.height}
                onChange={(event) => setForm((f) => ({ ...f, height: Number(event.target.value) }))}
              />
            </label>
            <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
              Ordem
              <input
                type="number"
                className={inputCls}
                min={0}
                value={form.sortOrder}
                onChange={(event) => setForm((f) => ({ ...f, sortOrder: Number(event.target.value) }))}
              />
            </label>
            {isAdmin && (
              <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
                Escopo do painel
                <select
                  className={inputCls}
                  value={form.sectorId}
                  onChange={(event) => setForm((f) => ({ ...f, sectorId: event.target.value }))}
                >
                  <option value="">Empresa inteira</option>
                  {sectors.map((sector) => (
                    <option key={sector.id} value={sector.id}>
                      {sector.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {saveMutation.isError && (
            <p role="alert" className="font-body text-body-sm text-error">
              {(saveMutation.error as Error).message}
            </p>
          )}
          <div className="flex gap-sm">
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="rounded-md bg-primary px-md py-sm font-label text-label-md text-on-primary disabled:opacity-50"
            >
              Salvar painel
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="rounded-md px-md py-sm font-label text-label-md text-on-surface-variant"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {isLoading && <p className="font-body text-body-sm text-on-surface-variant">Carregando painéis…</p>}

      {!isLoading && dashboards.length === 0 && !formOpen && (
        <div className="flex flex-col items-start gap-md rounded-lg border border-dashed border-outline-variant/60 p-lg">
          <p className="font-headline text-headline-sm text-on-surface">Nenhum painel cadastrado ainda</p>
          <p className="font-body text-body-sm text-on-surface-variant">
            Cadastre um painel do Power BI, Looker Studio ou Metabase para acompanhar os números de RH aqui dentro.
          </p>
          <button
            type="button"
            className="rounded-md bg-primary px-md py-sm font-label text-label-md text-on-primary"
            onClick={() => setFormOpen(true)}
          >
            Cadastrar o primeiro painel
          </button>
        </div>
      )}

      <div className="flex flex-col gap-lg">
        {dashboards.map((dashboard) => (
          <article key={dashboard.id} className="flex flex-col gap-sm rounded-lg border border-outline-variant/40 p-md">
            <header className="flex flex-wrap items-start justify-between gap-sm">
              <div>
                <h4 className="font-headline text-headline-sm text-on-surface">{dashboard.title}</h4>
                {dashboard.description && (
                  <p className="font-body text-body-sm text-on-surface-variant">{dashboard.description}</p>
                )}
                <span className="font-label text-label-sm text-on-surface-variant">
                  {dashboard.sectorName ?? 'Empresa'}
                </span>
              </div>
              <div className="flex flex-wrap gap-sm">
                <a
                  href={dashboard.embedUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-md border border-outline-variant/60 px-md py-sm font-label text-label-sm text-on-surface"
                >
                  Abrir em nova aba
                </a>
                <button
                  type="button"
                  onClick={() => startEdit(dashboard)}
                  className="rounded-md border border-outline-variant/60 px-md py-sm font-label text-label-sm text-on-surface"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(dashboard.id)}
                  className="rounded-md border border-error/60 px-md py-sm font-label text-label-sm text-error"
                >
                  Excluir
                </button>
              </div>
            </header>
            {/*
              `allow-scripts allow-same-origin` juntos só anulariam o sandbox se o
              conteúdo fosse da MESMA origem do Legends — aqui é sempre terceiro, e as
              ferramentas de BI precisam dos dois para autenticar a sessão. Sem
              allow-top-navigation e sem allow-popups de propósito.
            */}
            <iframe
              src={dashboard.embedUrl}
              title={dashboard.title}
              height={dashboard.height}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin"
              className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest"
            />
          </article>
        ))}
      </div>
    </Panel>
  )
}
```

- [ ] **Step 4: Ligar a rota e o item de menu**

Em `apps/web/src/App.tsx`:
- import junto dos outros: `import { HrDashboardsSection } from './pages/admin/HrDashboardsSection'`
- dentro do `<Route path="/admin" …>`, depois da linha de `moderacao`: `<Route path="paineis" element={<HrDashboardsSection />} />` (sem `StrictAdminOnly` — o SUBADMIN precisa entrar).

Em `apps/web/src/pages/admin/AdminSidebar.tsx`, no grupo `Visão geral`, deixar `items` assim:

```ts
items: [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/paineis', label: 'Painéis de RH' },
],
```

Sem `adminOnly` e sem `featureKey`: o SUBADMIN de Gente e Gestão precisa ver o item.

- [ ] **Step 5: Rodar os testes e ver passar**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/HrDashboardsSection.test.tsx src/pages/admin/AdminSidebar.test.tsx
```

Esperado: PASS. Se `AdminSidebar.test.tsx` falhar por contar itens do grupo "Visão geral", ajuste a expectativa do teste existente para incluir "Painéis de RH".

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/admin/HrDashboardsSection.tsx apps/web/src/pages/admin/HrDashboardsSection.test.tsx apps/web/src/App.tsx apps/web/src/pages/admin/AdminSidebar.tsx
git commit -m "feat(web): tela de painéis de RH embutidos na administração"
```

---

### Task 6: CSP no nginx e verificação final

**Files:**
- Modify: `nginx/default.conf`

**Interfaces:**
- Consumes: a lista de hosts default definida na Task 2 (`HR_DASHBOARD_DEFAULT_ALLOWED_HOSTS`).
- Produces: header `Content-Security-Policy` com `frame-src` nas respostas do `location /`.

- [ ] **Step 1: Acrescentar o header**

Em `nginx/default.conf`, dentro do bloco `location / { … }`, antes do `try_files`:

```nginx
    # Painéis de RH são iframes de terceiro. A política tem UMA diretiva só de
    # propósito: sem default-src, nada além de frames fica restrito, então
    # Phaser (blob workers), LiveKit (wss), imagens do S3 e estilos inline do
    # Tailwind seguem funcionando. Uma CSP completa é tarefa própria.
    #
    # Esta lista precisa bater com HR_DASHBOARD_DEFAULT_ALLOWED_HOSTS /
    # HR_DASHBOARD_ALLOWED_HOSTS em apps/api/src/lib/config.ts.
    add_header Content-Security-Policy "frame-src 'self' https://app.powerbi.com https://lookerstudio.google.com https://datastudio.google.com;" always;
```

- [ ] **Step 2: Validar a sintaxe do nginx**

```bash
docker run --rm -v "$PWD/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27-alpine nginx -t
```

Esperado: `syntax is ok` e `test is successful`.

- [ ] **Step 3: Rodar a suíte completa**

```bash
pnpm db:up
pnpm test
```

Esperado: PASS em `@legends/shared`, `@legends/api` e `@legends/web`. Falha de API com `ECONNREFUSED` significa Postgres fora do ar — confira o `pnpm db:up`.

- [ ] **Step 4: Verificar tipos**

```bash
pnpm build
```

Esperado: build dos três workspaces sem erro de tipo.

- [ ] **Step 5: Commit**

```bash
git add nginx/default.conf
git commit -m "feat(infra): CSP com frame-src para os painéis de RH embutidos"
```

---

## Verificação dos critérios de aceite

| # | Critério | Onde é verificado |
|---|---|---|
| 1 | Painel cadastrado aparece embutido, na ordem definida | Task 4 Step 1 ("cria e lista painel na ordem de sortOrder"), Task 5 Step 1 ("renderiza os iframes na ordem de sortOrder") |
| 2 | Esquema diferente de https → 400 em português | Task 2 Step 1 ("recusa http", "recusa javascript:"), Task 4 Step 1 ("recusa esquema diferente de https") |
| 3 | Host fora da allowlist → 400, inclusive por chamada direta | Task 4 Step 1 ("recusa host fora da allowlist em chamada direta à API") |
| 4 | Altura fora de 300–2000 recusada | Task 4 Step 1 ("recusa altura fora de 300–2000") |
| 5 | Iframe com sandbox e sem navegação no topo | Task 5 Step 1 ("em sandbox e sem navegação no topo") |
| 6 | Painel de um setor não aparece para quem é de outro | Task 3 Step 1 ("mostra ao subadmin os painéis da empresa e do próprio setor"), Task 4 Step 1 ("esconde do subadmin o painel de outro setor") |
| 7 | Estado vazio com ação de cadastrar o primeiro | Task 5 Step 1 ("mostra estado vazio com a ação de cadastrar o primeiro painel") |
