# Setorização da empresa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir `Sector` como entidade real do organograma — o admin cria setores, aloca pessoas, restringe quais papéis (roles) e quais features cada setor enxerga, e o Destaque do Mês passa a ser votado e apurado por setor, com janela própria.

**Architecture:** Um novo model `Sector` (com `enabledFeatures: Json`, mesmo formato de `User.enabledFeatures` hoje) e um join `SectorRole` (quais dos 6 papéis existem em cada setor, curadoria de UI). `User.sectorId` e `VotingPeriod.sectorId` viram FKs obrigatórias, com um setor default ("Desenvolvimento de Produto") que replica 1:1 o comportamento atual e serve de fallback em toda borda (migration, Zod, testes). O gate de feature (`requireFeature`) deixa de ser exclusivo de `THIRD_PARTY` e passa a valer para todo mundo (exceto `ADMIN`, que sempre passa), usando a lista de features **já resolvida por papel** que o JWT carrega desde o login.

**Tech Stack:** Fastify 4 + Prisma 5 + PostgreSQL (API), Vite 5 + React 18 + React Query (web), Zod, Vitest.

## Global Constraints

- TypeScript strict, ESM puro; migrations geradas com `pnpm db:migrate`, nunca editando uma já aplicada.
- Mensagens ao usuário em português.
- Rotas finas → lógica em `services/*.ts` → DTO em `lib/serialize.ts`; contrato de tipos em `@legends/shared`.
- Testes Vitest colocados ao lado do código; a API precisa do Postgres local rodando (`pnpm db:up`) e testa contra banco real (`legends_test`, truncado a cada teste via `beforeEach`).
- Durante a implementação, rode só o(s) arquivo(s) de teste do que foi alterado; a suíte completa (`pnpm test`) é a verificação final antes de encerrar o plano.
- **Decisão de compatibilidade adotada neste plano:** `sectorId` é **opcional** em todo payload de API que hoje não o exige (`POST/PATCH /admin/users`, `POST /admin/periods`) — quando omitido, cai no setor default (`DEFAULT_SECTOR_ID`). Isso evita reescrever a suíte de testes hoje existente (dezenas de `POST /admin/users`/`POST /admin/periods` sem `sectorId`) só por causa da sectorização, mantendo o comportamento atual 100% intacto para quem não opta por setor explícito. Sectores diferentes do default sempre exigem o `sectorId` explícito nas telas novas (`SectorsSection`).
- `Sector.id` do setor default é um valor **fixo e conhecido** (`DEFAULT_SECTOR_ID = 'sector-dev-produto'`, definido em `@legends/shared`), inserido via SQL literal na migration — não um `cuid()` aleatório — para poder ser referenciado como `@default(...)` no schema Prisma e em código sem lookup.

---

## Task 1: Shared package — catálogo de features generalizado + tipos de setor

**Files:**
- Modify: `packages/shared/src/third-party.ts` (rename `THIRD_PARTY_FEATURE_KEYS`→`FEATURE_KEYS`, `THIRD_PARTY_FEATURE_LABELS`→`FEATURE_LABELS`, `ThirdPartyFeatureKey`→`FeatureKey`)
- Modify: `packages/shared/src/auth.ts` (`PublicUser` ganha `sectorId`, `sectorFeatures`; usa `FeatureKey`)
- Create: `packages/shared/src/sector.ts`
- Modify: `packages/shared/src/index.ts` (exporta `./sector`)
- Modify: `apps/api/src/lib/serialize.ts` (import renomeado; `toPublicUser` ainda não muda de assinatura aqui — isso é Task 7)
- Modify: `apps/api/src/routes/admin.ts` (import renomeado, `THIRD_PARTY_FEATURE_KEYS`→`FEATURE_KEYS`)
- Modify: `apps/api/src/routes/third-party-invites.ts` (import renomeado)
- Modify: `apps/api/src/services/third-party-invite-service.ts` (import renomeado)
- Modify: `apps/web/src/App.tsx` (import renomeado)
- Modify: `apps/web/src/components/nav-items.ts` (import renomeado; lógica de filtro só muda na Task 8)
- Modify: `apps/web/src/pages/admin/ThirdPartySection.tsx` (import renomeado)
- Test: `packages/shared/src/sector.test.ts` (novo, smoke test dos tipos/constantes)

**Interfaces:**
- Produces: `FEATURE_KEYS: readonly string[]`, `FEATURE_LABELS: Record<FeatureKey, string>`, `type FeatureKey`, `DEFAULT_SECTOR_ID: string`, `interface SectorDTO { id, name, slug, active, enabledFeatures: FeatureKey[], roles: UserRole[] }`, `interface CreateSectorRequest { name, enabledFeatures: FeatureKey[], roles: UserRole[] }`, `interface UpdateSectorRequest { name?, active?, enabledFeatures?: FeatureKey[], roles?: UserRole[] }`.
- Consumes: `UserRole` de `./enums` (já existe).

- [ ] **Step 1: Renomear o catálogo em `third-party.ts`**

```ts
// packages/shared/src/third-party.ts (arquivo inteiro)
export const FEATURE_KEYS = [
  'time',
  'lendas',
  'votar',
  'selos',
  'destaques',
  'notificacoes',
  'resenha',
  'quinta-desenvolvimento',
  'retrospectivas',
  'escritorio',
] as const
export type FeatureKey = (typeof FEATURE_KEYS)[number]

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  time: 'Time',
  lendas: 'Lendas',
  votar: 'Votar',
  selos: 'Galeria de selos',
  destaques: 'Destaques',
  notificacoes: 'Notificações',
  resenha: 'Resenha',
  'quinta-desenvolvimento': 'Quinta de Dev',
  retrospectivas: 'Retrospectivas',
  escritorio: 'Escritório',
}

export const THIRD_PARTY_INVITE_MIN_MINUTES = 60
export const THIRD_PARTY_INVITE_MAX_MINUTES = 14 * 24 * 60

export interface ThirdPartyInviteDTO {
  id: string
  url: string | null
  enabledFeatures: FeatureKey[]
  expiresAt: string
  createdAt: string
  usedAt: string | null
  revokedAt: string | null
}

export interface ThirdPartyInvitePublicDTO {
  createdByName: string
  expiresAt: string
}

export interface CreateThirdPartyInviteRequest {
  expiresInMinutes: number
  enabledFeatures: FeatureKey[]
}

export interface CreateThirdPartyInviteResponse {
  invite: ThirdPartyInviteDTO
}

export interface ThirdPartyInviteListResponse {
  invites: ThirdPartyInviteDTO[]
}

export interface AcceptThirdPartyInviteRequest {
  name: string
  email: string
  password: string
}
```

- [ ] **Step 2: Criar `packages/shared/src/sector.ts`**

```ts
import type { UserRole } from './enums'
import type { FeatureKey } from './third-party'

/** ID fixo do setor criado pela migration de backfill (não é um cuid gerado). */
export const DEFAULT_SECTOR_ID = 'sector-dev-produto'

export interface SectorDTO {
  id: string
  name: string
  slug: string
  active: boolean
  enabledFeatures: FeatureKey[]
  roles: UserRole[]
}

export interface CreateSectorRequest {
  name: string
  enabledFeatures: FeatureKey[]
  roles: UserRole[]
}

export interface UpdateSectorRequest {
  name?: string
  active?: boolean
  enabledFeatures?: FeatureKey[]
  roles?: UserRole[]
}
```

- [ ] **Step 3: Exportar o novo módulo no barrel**

Em `packages/shared/src/index.ts`, adicionar ao final:

```ts
export * from './sector'
```

- [ ] **Step 4: Atualizar `PublicUser` em `packages/shared/src/auth.ts`**

```ts
import type { UserRole, Area } from './enums'
import type { AvatarStyleKey } from './avatar'
import type { CharacterOptions } from './character'
import type { FeatureKey } from './third-party'

export interface PublicUser {
  id: string
  name: string
  email: string | null
  role: UserRole
  area: Area | null
  position: string | null
  squad: string | null
  photoUrl: string | null
  avatarStyle: AvatarStyleKey | null
  avatarSeed: string | null
  avatarOptions: CharacterOptions | null
  active: boolean
  joinedAt: string
  leftAt: string | null
  sectorId: string
  enabledFeatures: FeatureKey[]
  /** Features efetivas do SETOR do usuário (vazio para DTOs de "outro usuário" onde isso não é necessário). */
  sectorFeatures: FeatureKey[]
}

/** Usuário visto pelo admin: inclui campos sensíveis que NÃO vão em PublicUser. */
export interface AdminUserDTO extends PublicUser {
  email: string
  teamsWebhookUrl: string | null
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  name: string
  email: string
  password: string
  position?: string
  squad?: string
}

export interface AuthResponse {
  accessToken: string
  user: PublicUser
}

export interface RefreshResponse {
  accessToken: string
}
```

- [ ] **Step 5: Renomear os usos em `apps/api/src/lib/serialize.ts`**

Trocar o import (linha com `type ThirdPartyFeatureKey`) por `type FeatureKey` e a linha `enabledFeatures: Array.isArray(...) ? (... as ThirdPartyFeatureKey[]) : []` por `as FeatureKey[]`. `sectorId`/`sectorFeatures` **não** entram em `toPublicUser` ainda (isso é Task 7) — por ora só evite quebrar o build: adicione temporariamente `sectorId: user.sectorId, sectorFeatures: [] as FeatureKey[],` no objeto retornado por `toPublicUser` (o campo `sectorId` só existirá em `User` a partir da Task 2 — como as tasks são sequenciais, ao rodar esta Task 1 isoladamente o build do `serialize.ts` ainda vai falhar por falta da coluna. Isso é esperado: rode o typecheck só depois da Task 2 aplicada. Deixe o código já escrito aqui para não precisar tocar o arquivo de novo na Task 7).

- [ ] **Step 6: Renomear os usos restantes**

Em cada um destes arquivos, troque toda ocorrência de `THIRD_PARTY_FEATURE_KEYS`→`FEATURE_KEYS`, `THIRD_PARTY_FEATURE_LABELS`→`FEATURE_LABELS`, `ThirdPartyFeatureKey`→`FeatureKey` (import e uso):
- `apps/api/src/routes/admin.ts`
- `apps/api/src/routes/third-party-invites.ts`
- `apps/api/src/services/third-party-invite-service.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/components/nav-items.ts`
- `apps/web/src/pages/admin/ThirdPartySection.tsx`

- [ ] **Step 7: Escrever o smoke test do novo módulo**

```ts
// packages/shared/src/sector.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_SECTOR_ID } from './sector'
import { FEATURE_KEYS, FEATURE_LABELS } from './third-party'

describe('sector shared types', () => {
  it('expõe um DEFAULT_SECTOR_ID estável', () => {
    expect(DEFAULT_SECTOR_ID).toBe('sector-dev-produto')
  })

  it('todo FEATURE_KEYS tem rótulo em FEATURE_LABELS', () => {
    for (const key of FEATURE_KEYS) {
      expect(FEATURE_LABELS[key]).toBeTruthy()
    }
  })
})
```

- [ ] **Step 8: Rodar o teste**

Run: `pnpm --filter @legends/shared exec vitest run src/sector.test.ts`
Expected: PASS (2 testes)

- [ ] **Step 9: Commit**

```bash
git add packages/shared apps/api/src/lib/serialize.ts apps/api/src/routes/admin.ts apps/api/src/routes/third-party-invites.ts apps/api/src/services/third-party-invite-service.ts apps/web/src/App.tsx apps/web/src/components/nav-items.ts apps/web/src/pages/admin/ThirdPartySection.tsx
git commit -m "refactor(shared): generaliza catálogo de features e adiciona tipos de Setor"
```

---

## Task 2: Prisma — `Sector`, `SectorRole`, `sectorId` em `User`/`VotingPeriod`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_add_sector_core/migration.sql` (via `prisma migrate dev --create-only`, depois editado à mão)
- Test: `apps/api/src/services/sector-service.test.ts` **não** entra aqui (Task 3) — a verificação desta task é rodar a suíte inteira da API e confirmar que segue verde com o backfill.

**Interfaces:**
- Produces: model `Sector` (`id`, `name`, `slug`, `active`, `enabledFeatures: Json`), model `SectorRole` (`sectorId`, `role`), `User.sectorId: String` (FK, default `'sector-dev-produto'`), `VotingPeriod.sectorId: String` (FK, default `'sector-dev-produto'`), `@@unique([sectorId, monthRef])` em `VotingPeriod` (substitui `monthRef @unique`).

- [ ] **Step 1: Editar `apps/api/prisma/schema.prisma`**

Adicionar os dois models novos (posicione depois de `model Squad` ou em qualquer ponto do arquivo, por exemplo logo antes de `model VotingPeriod`):

```prisma
model Sector {
  id              String   @id @default(cuid())
  name            String
  slug            String   @unique
  active          Boolean  @default(true)
  enabledFeatures Json     @default("[]")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  users         User[]
  roles         SectorRole[]
  votingPeriods VotingPeriod[]
}

model SectorRole {
  sectorId String
  role     UserRole

  sector Sector @relation(fields: [sectorId], references: [id], onDelete: Cascade)

  @@id([sectorId, role])
}
```

No `model User`, adicionar o campo (logo abaixo de `role UserRole @default(LEGEND)`) e a relação (perto de `votesGiven`):

```prisma
  role         UserRole @default(LEGEND)
  sectorId     String   @default("sector-dev-produto")
```

```prisma
  sector            Sector         @relation(fields: [sectorId], references: [id])
```

No `model VotingPeriod`, trocar:

```prisma
  monthRef  String             @unique // formato "2026-06"
```

por:

```prisma
  monthRef  String             // formato "2026-06"; único POR SETOR (ver @@unique abaixo)
  sectorId  String             @default("sector-dev-produto")
```

e adicionar, junto às relações do model (perto de `votes  Vote[]`):

```prisma
  sector Sector @relation(fields: [sectorId], references: [id])
```

e no final do model (antes do `}` de fechamento), adicionar:

```prisma
  @@unique([sectorId, monthRef], name: "one_period_per_sector_month")
```

- [ ] **Step 2: Gerar a migration em modo "create-only" (para editar o SQL à mão)**

Run: `cd apps/api && pnpm exec prisma migrate dev --create-only --name add_sector_core`
Expected: cria `apps/api/prisma/migrations/<timestamp>_add_sector_core/migration.sql` com o diff de schema (novas tabelas, novas colunas nullable ou com erro por causa do NOT NULL sem default explícito na sintaxe do diff — o Prisma já deve gerar corretamente as colunas com `DEFAULT` porque o `@default("sector-dev-produto")` foi declarado no schema).

- [ ] **Step 3: Editar o `migration.sql` gerado para inserir o setor default e os papéis, ANTES de qualquer `ALTER TABLE` que dependa do setor existir**

Abra o arquivo gerado no Step 2 e garanta que o conteúdo final tenha exatamente esta ordem (ajuste os nomes de constraint apenas se o Prisma tiver gerado nomes diferentes — mantenha os nomes que o Prisma gerou para as tabelas/índices/FKs, só **insira** os blocos `INSERT INTO` nos pontos indicados):

```sql
-- CreateTable
CREATE TABLE "Sector" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "enabledFeatures" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectorRole" (
    "sectorId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,

    CONSTRAINT "SectorRole_pkey" PRIMARY KEY ("sectorId","role")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sector_slug_key" ON "Sector"("slug");

-- AddForeignKey
ALTER TABLE "SectorRole" ADD CONSTRAINT "SectorRole_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: setor default "Desenvolvimento de Produto" com TODAS as features e TODOS os
-- papéis habilitados, replicando 1:1 o comportamento atual (ninguém perde acesso).
INSERT INTO "Sector" ("id", "name", "slug", "active", "enabledFeatures", "createdAt", "updatedAt")
VALUES (
    'sector-dev-produto',
    'Desenvolvimento de Produto',
    'desenvolvimento-de-produto',
    true,
    '["time","lendas","votar","selos","destaques","notificacoes","resenha","quinta-desenvolvimento","retrospectivas","escritorio"]',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

INSERT INTO "SectorRole" ("sectorId", "role") VALUES
    ('sector-dev-produto', 'LEGEND'),
    ('sector-dev-produto', 'LEAD'),
    ('sector-dev-produto', 'MANAGER'),
    ('sector-dev-produto', 'HEAD'),
    ('sector-dev-produto', 'ADMIN'),
    ('sector-dev-produto', 'THIRD_PARTY');

-- AlterTable (User): sectorId com DEFAULT — backfill automático das linhas existentes.
ALTER TABLE "User" ADD COLUMN "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';

-- AlterTable (VotingPeriod): idem, e troca a unicidade de monthRef global para (sectorId, monthRef).
ALTER TABLE "VotingPeriod" ADD COLUMN "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';
DROP INDEX "VotingPeriod_monthRef_key";
CREATE UNIQUE INDEX "one_period_per_sector_month" ON "VotingPeriod"("sectorId", "monthRef");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VotingPeriod" ADD CONSTRAINT "VotingPeriod_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Pontos de atenção ao editar o arquivo gerado:
- O Prisma pode ter gerado os `ALTER TABLE ... ADD COLUMN` e os `CREATE TABLE` em outra ordem — reordene manualmente para garantir: 1) `CREATE TABLE "Sector"`, 2) `CREATE TABLE "SectorRole"` + sua FK, 3) os dois `INSERT INTO`, 4) os `ALTER TABLE ... ADD COLUMN "sectorId"` de `User` e `VotingPeriod`, 5) o `DROP INDEX`/`CREATE UNIQUE INDEX` de `VotingPeriod`, 6) as duas `FOREIGN KEY` de `User`/`VotingPeriod` apontando pra `Sector`.
- Se o Prisma nomear o índice único de `VotingPeriod` diferente de `one_period_per_sector_month` (ex. `VotingPeriod_sectorId_monthRef_key`), use o nome exatamente como o schema.prisma declarou (`name: "one_period_per_sector_month"` no `@@unique` do Step 1 força esse nome).

- [ ] **Step 4: Aplicar a migration e regenerar o client**

Run: `cd apps/api && pnpm exec prisma migrate dev`
Expected: `The following migration(s) have been applied: <timestamp>_add_sector_core` e `Generated Prisma Client`.

- [ ] **Step 5: Confirmar o backfill manualmente**

Run: `cd apps/api && pnpm exec prisma studio` (ou uma query rápida) — confirme que a tabela `Sector` tem 1 linha (`sector-dev-produto`), `SectorRole` tem 6 linhas, e qualquer `User`/`VotingPeriod` pré-existente no banco de dev tem `sectorId = 'sector-dev-produto'`. Feche o studio depois.

- [ ] **Step 6: Rodar a suíte da API inteira para confirmar que nada quebrou**

Run: `pnpm db:up && pnpm --filter @legends/api test`
Expected: todos os testes passam (o `DEFAULT` do banco cobre os ~190 `prisma.user.create(...)` e ~14 `prisma.votingPeriod.create(...)` existentes nos testes, que não passam `sectorId` explicitamente).

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(api): adiciona Sector/SectorRole e sectorId em User/VotingPeriod com setor default"
```

---

## Task 3: `sector-service.ts` (CRUD)

**Files:**
- Create: `apps/api/src/services/sector-service.ts`
- Test: `apps/api/src/services/sector-service.test.ts`

**Interfaces:**
- Consumes: `prisma` (`apps/api/src/lib/prisma.ts`), `slugify` (`apps/api/src/lib/slug.ts`), `Prisma`/`UserRole` de `@prisma/client`.
- Produces: `class SectorError extends Error { status: number }`, `type SectorWithRoles = Prisma.SectorGetPayload<{ include: { roles: true } }>`, `listSectors(): Promise<SectorWithRoles[]>`, `createSector(input: { name: string; enabledFeatures: string[]; roles: UserRole[] }): Promise<SectorWithRoles>`, `updateSector(id: string, input: { name?: string; active?: boolean; enabledFeatures?: string[]; roles?: UserRole[] }): Promise<SectorWithRoles>`.

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// apps/api/src/services/sector-service.test.ts
import { describe, it, expect } from 'vitest'
import { createSector, updateSector, listSectors, SectorError } from './sector-service'

describe('sector-service', () => {
  it('cria setor com slug, força escritório habilitado e rejeita nome duplicado', async () => {
    const s = await createSector({ name: 'Comercial', enabledFeatures: [], roles: ['LEGEND', 'LEAD'] })
    expect(s.slug).toBe('comercial')
    expect(s.enabledFeatures).toContain('escritorio')
    expect(s.roles.map((r) => r.role).sort()).toEqual(['LEAD', 'LEGEND'])
    await expect(createSector({ name: 'Comercial', enabledFeatures: [], roles: [] })).rejects.toMatchObject({ status: 409 })
  })

  it('atualiza nome, features e papéis habilitados (substitui, não soma)', async () => {
    const s = await createSector({ name: 'Marketing', enabledFeatures: ['votar'], roles: ['LEGEND'] })
    const updated = await updateSector(s.id, {
      name: 'Marketing Digital',
      enabledFeatures: ['votar', 'selos'],
      roles: ['LEGEND', 'HEAD'],
    })
    expect(updated.name).toBe('Marketing Digital')
    expect(updated.slug).toBe('marketing-digital')
    expect(updated.enabledFeatures.sort()).toEqual(['selos', 'votar'])
    expect(updated.roles.map((r) => r.role).sort()).toEqual(['HEAD', 'LEGEND'])
  })

  it('desativa setor (active=false) e listSectors traz todos, ativos e inativos', async () => {
    const s = await createSector({ name: 'Financeiro', enabledFeatures: [], roles: [] })
    const off = await updateSector(s.id, { active: false })
    expect(off.active).toBe(false)
    const all = await listSectors()
    expect(all.some((x) => x.id === s.id && !x.active)).toBe(true)
  })

  it('rejeita update de setor inexistente (404) e nome vazio (400)', async () => {
    await expect(updateSector('nao-existe', { name: 'X' })).rejects.toMatchObject({ status: 404 })
    const s = await createSector({ name: 'RH', enabledFeatures: [], roles: [] })
    await expect(updateSector(s.id, { name: '   ' })).rejects.toMatchObject({ status: 400 })
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/sector-service.test.ts`
Expected: FAIL com `Cannot find module './sector-service'`

- [ ] **Step 3: Implementar `sector-service.ts`**

```ts
// apps/api/src/services/sector-service.ts
import { Prisma, type UserRole } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { slugify } from '../lib/slug'

export class SectorError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'SectorError'
  }
}

export const sectorInclude = { roles: true } as const
export type SectorWithRoles = Prisma.SectorGetPayload<{ include: typeof sectorInclude }>

async function loadSector(id: string): Promise<SectorWithRoles> {
  const sector = await prisma.sector.findUnique({ where: { id }, include: sectorInclude })
  if (!sector) throw new SectorError('Setor não encontrado.', 404)
  return sector
}

export function listSectors(): Promise<SectorWithRoles[]> {
  return prisma.sector.findMany({ include: sectorInclude, orderBy: { name: 'asc' } })
}

/** Todo setor novo nasce com "escritorio" habilitado (funcionalidade conjunta). */
function withEscritorioForced(enabledFeatures: string[]): string[] {
  return Array.from(new Set([...enabledFeatures, 'escritorio']))
}

export async function createSector(input: {
  name: string
  enabledFeatures: string[]
  roles: UserRole[]
}): Promise<SectorWithRoles> {
  const name = input.name.trim()
  if (!name) throw new SectorError('O nome do setor é obrigatório.', 400)
  try {
    const sector = await prisma.sector.create({
      data: {
        name,
        slug: slugify(name),
        enabledFeatures: withEscritorioForced(input.enabledFeatures),
        roles: { create: input.roles.map((role) => ({ role })) },
      },
    })
    return loadSector(sector.id)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new SectorError('Já existe um setor com esse nome.', 409)
    }
    throw err
  }
}

export async function updateSector(
  id: string,
  input: { name?: string; active?: boolean; enabledFeatures?: string[]; roles?: UserRole[] },
): Promise<SectorWithRoles> {
  const data: Prisma.SectorUpdateInput = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new SectorError('O nome do setor é obrigatório.', 400)
    data.name = name
    data.slug = slugify(name)
  }
  if (input.active !== undefined) data.active = input.active
  if (input.enabledFeatures !== undefined) data.enabledFeatures = input.enabledFeatures
  try {
    await prisma.$transaction(async (tx) => {
      await tx.sector.update({ where: { id }, data })
      if (input.roles !== undefined) {
        await tx.sectorRole.deleteMany({ where: { sectorId: id } })
        if (input.roles.length > 0) {
          await tx.sectorRole.createMany({ data: input.roles.map((role) => ({ sectorId: id, role })) })
        }
      }
    })
    return loadSector(id)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') throw new SectorError('Setor não encontrado.', 404)
      if (err.code === 'P2002') throw new SectorError('Já existe um setor com esse nome.', 409)
    }
    throw err
  }
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/services/sector-service.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/sector-service.ts apps/api/src/services/sector-service.test.ts
git commit -m "feat(api): CRUD de setores (sector-service)"
```

---

## Task 4: Rotas `/admin/sectors`

**Files:**
- Modify: `apps/api/src/lib/serialize.ts` (adiciona `toSectorDTO`)
- Modify: `apps/api/src/routes/admin.ts` (adiciona schemas e rotas)
- Test: `apps/api/src/routes/admin.test.ts` (extensão)

**Interfaces:**
- Consumes: `listSectors`, `createSector`, `updateSector`, `SectorError` (Task 3); `SectorDTO`, `FEATURE_KEYS`, `USER_ROLES` (`@legends/shared`).
- Produces: `toSectorDTO(sector: SectorWithRoles): SectorDTO`; rotas `GET/POST /admin/sectors`, `PATCH /admin/sectors/:id`.

- [ ] **Step 1: Escrever os testes de rota (falhando)**

Adicionar ao final de `apps/api/src/routes/admin.test.ts`:

```ts
describe('setores (/admin/sectors)', () => {
  it('lista o setor default criado pela migration', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({ method: 'GET', url: '/admin/sectors', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const sectors = res.json().sectors as Array<{ id: string; name: string; roles: string[] }>
    expect(sectors.some((s) => s.id === 'sector-dev-produto' && s.roles.length === 6)).toBe(true)
    await app.close()
  })

  it('cria um setor novo, forçando escritório habilitado, e rejeita nome duplicado (POST)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Comercial', enabledFeatures: ['votar'], roles: ['LEGEND', 'LEAD'] },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().sector.enabledFeatures.sort()).toEqual(['escritorio', 'votar'])
    expect(res.json().sector.roles.sort()).toEqual(['LEAD', 'LEGEND'])

    const dup = await app.inject({
      method: 'POST',
      url: '/admin/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Comercial', enabledFeatures: [], roles: [] },
    })
    expect(dup.statusCode).toBe(409)
    await app.close()
  })

  it('edita nome, active, features e roles de um setor (PATCH)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const created = await app.inject({
      method: 'POST',
      url: '/admin/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'RH', enabledFeatures: [], roles: ['LEGEND'] },
    })
    const id = created.json().sector.id
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/sectors/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Gente e Cultura', active: false, roles: ['LEGEND', 'HEAD'] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().sector.name).toBe('Gente e Cultura')
    expect(res.json().sector.active).toBe(false)
    expect(res.json().sector.roles.sort()).toEqual(['HEAD', 'LEGEND'])
    await app.close()
  })

  it('forbids non-admin from managing sectors (403)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await devToken(app)
    const res = await app.inject({ method: 'GET', url: '/admin/sectors', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "setores"`
Expected: FAIL (404, rota não existe)

- [ ] **Step 3: Adicionar `toSectorDTO` em `apps/api/src/lib/serialize.ts`**

Adicionar o import de `type SectorWithRoles` (de `'../services/sector-service'`) e `type SectorDTO`, `type FeatureKey` (de `'@legends/shared'`, já importado como bloco — inclua `SectorDTO` na lista existente de imports de `@legends/shared`), e a função no final do arquivo:

```ts
export function toSectorDTO(sector: SectorWithRoles): SectorDTO {
  return {
    id: sector.id,
    name: sector.name,
    slug: sector.slug,
    active: sector.active,
    enabledFeatures: Array.isArray(sector.enabledFeatures) ? (sector.enabledFeatures as FeatureKey[]) : [],
    roles: sector.roles.map((r) => r.role),
  }
}
```

- [ ] **Step 4: Adicionar schemas e rotas em `apps/api/src/routes/admin.ts`**

No topo do arquivo, adicionar aos imports existentes:

```ts
import { listSectors, createSector, updateSector, SectorError } from '../services/sector-service'
```

E `toSectorDTO` na lista de imports de `'../lib/serialize'` já existente. Na lista de imports de `'@legends/shared'`, adicionar `FEATURE_KEYS`.

Perto dos outros schemas Zod (junto a `createSquadSchema`/`updateSquadSchema`), adicionar:

```ts
const createSectorSchema = z.object({
  name: z.string().min(1),
  enabledFeatures: z.array(z.enum(FEATURE_KEYS)).default([]),
  roles: z.array(z.enum(USER_ROLES)).default([]),
})
const updateSectorSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  enabledFeatures: z.array(z.enum(FEATURE_KEYS)).optional(),
  roles: z.array(z.enum(USER_ROLES)).optional(),
})
```

E, dentro de `adminRoutes`, logo depois do bloco de rotas `/admin/squads/:id/members/:userId` (antes de `/admin/users`), adicionar:

```ts
  app.get('/admin/sectors', adminOnly, async (_request, reply) => {
    const sectors = await listSectors()
    return reply.send({ sectors: sectors.map(toSectorDTO) })
  })

  app.post('/admin/sectors', adminOnly, async (request, reply) => {
    const parsed = createSectorSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    try {
      const sector = await createSector(parsed.data)
      return reply.code(201).send({ sector: toSectorDTO(sector) })
    } catch (err) {
      if (err instanceof SectorError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/admin/sectors/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateSectorSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    try {
      const sector = await updateSector(id, parsed.data)
      return reply.send({ sector: toSectorDTO(sector) })
    } catch (err) {
      if (err instanceof SectorError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "setores"`
Expected: PASS (4 testes)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): rotas /admin/sectors (CRUD)"
```

---

## Task 5: `sectorId` em `/admin/users` e `/admin/third-party-users` + validação de papel × setor

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/src/routes/admin.test.ts` (extensão)

**Interfaces:**
- Consumes: `DEFAULT_SECTOR_ID` (`@legends/shared`), `prisma.sector.findUnique` com `include: { roles: true }`.
- Produces: `createUserSchema`/`updateUserSchema` com `sectorId?: string`; `POST/PATCH /admin/users` validam que o `role` efetivo está habilitado (`SectorRole`) no setor efetivo.

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar ao final de `apps/api/src/routes/admin.test.ts`:

```ts
describe('sectorId em /admin/users', () => {
  it('cria lenda sem sectorId (cai no setor default) e com sectorId explícito', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const noSector = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Sem Setor', email: 'semsetor@empresa.com', password: 'changeme123' },
    })
    expect(noSector.statusCode).toBe(201)
    expect(noSector.json().user.sectorId).toBe('sector-dev-produto')

    const sectorRes = await app.inject({
      method: 'POST',
      url: '/admin/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Comercial', enabledFeatures: [], roles: ['LEGEND'] },
    })
    const sectorId = sectorRes.json().sector.id

    const withSector = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Com Setor', email: 'comsetor@empresa.com', password: 'changeme123', sectorId },
    })
    expect(withSector.statusCode).toBe(201)
    expect(withSector.json().user.sectorId).toBe(sectorId)
    await app.close()
  })

  it('rejeita papel não habilitado no setor selecionado (400)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const sectorRes = await app.inject({
      method: 'POST',
      url: '/admin/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Financeiro', enabledFeatures: [], roles: ['LEGEND'] },
    })
    const sectorId = sectorRes.json().sector.id
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Head Indevido', email: 'head-indevido@empresa.com', password: 'changeme123', sectorId, role: 'HEAD' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('move usuário de setor via PATCH e revalida o papel no setor novo', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const created = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Movida', email: 'movida@empresa.com', password: 'changeme123', role: 'HEAD' },
    })
    const id = created.json().user.id
    const sectorRes = await app.inject({
      method: 'POST',
      url: '/admin/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Suporte', enabledFeatures: [], roles: ['LEGEND'] },
    })
    const sectorId = sectorRes.json().sector.id
    const rejected = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sectorId },
    })
    expect(rejected.statusCode).toBe(400)

    const accepted = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sectorId, role: 'LEGEND' },
    })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json().user.sectorId).toBe(sectorId)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "sectorId em"`
Expected: FAIL (o primeiro teste falha porque `sectorId` ainda não existe no schema/response tal como esperado — na real hoje `user.sectorId` já viria preenchido pelo default do banco, mas os testes de "papel não habilitado" e "revalidação" falham porque a validação ainda não existe)

- [ ] **Step 3: Editar `createUserSchema`/`updateUserSchema` e os handlers em `apps/api/src/routes/admin.ts`**

No import de `'@legends/shared'`, adicionar `DEFAULT_SECTOR_ID`.

Em `createUserSchema`, adicionar o campo:

```ts
  sectorId: z.string().min(1).optional(),
```

Em `updateUserSchema`, adicionar o mesmo campo:

```ts
  sectorId: z.string().min(1).optional(),
```

No handler `POST /admin/users`, antes do `try`, validar setor/papel:

```ts
  app.post('/admin/users', adminOnly, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const sectorId = parsed.data.sectorId ?? DEFAULT_SECTOR_ID
    const effectiveRole = parsed.data.role ?? 'LEGEND'
    const sector = await prisma.sector.findUnique({ where: { id: sectorId }, include: { roles: true } })
    if (!sector) return reply.code(400).send({ message: 'Setor inválido.' })
    if (!sector.roles.some((r) => r.role === effectiveRole)) {
      return reply.code(400).send({ message: 'Esse papel não está habilitado para o setor selecionado.' })
    }
    try {
      const passwordHash = await hashPassword(parsed.data.password)
      const user = await prisma.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash,
          position: parsed.data.position,
          squad: parsed.data.squad,
          joinedAt: parsed.data.joinedAt,
          role: parsed.data.role,
          area: parsed.data.area,
          teamsWebhookUrl: parsed.data.teamsWebhookUrl || null,
          sectorId,
        },
      })
      return reply.code(201).send({ user: toAdminUser(user) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'E-mail já cadastrado.' })
      }
      throw err
    }
  })
```

No handler `PATCH /admin/users/:id`, logo depois da linha `const effectiveRole = parsed.data.role ?? existing.role`, adicionar a validação de setor/papel (antes do bloco `enabledFeatures`):

```ts
    const effectiveRole = parsed.data.role ?? existing.role
    if (parsed.data.role !== undefined || parsed.data.sectorId !== undefined) {
      const effectiveSectorId = parsed.data.sectorId ?? existing.sectorId
      const sector = await prisma.sector.findUnique({ where: { id: effectiveSectorId }, include: { roles: true } })
      if (!sector) return reply.code(400).send({ message: 'Setor inválido.' })
      if (!sector.roles.some((r) => r.role === effectiveRole)) {
        return reply.code(400).send({ message: 'Esse papel não está habilitado para o setor selecionado.' })
      }
    }
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "sectorId em"`
Expected: PASS (3 testes)

- [ ] **Step 5: Rodar a suíte inteira de `admin.test.ts` para garantir que nada regrediu**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts`
Expected: PASS (todos os testes, incluindo os pré-existentes)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): sectorId em /admin/users com validação de papel x setor"
```

---

## Task 6: `sectorId` em `/admin/periods` + `voting-service` escopado por setor

**Files:**
- Modify: `apps/api/src/services/admin-service.ts`
- Modify: `apps/api/src/services/voting-service.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/routes/periods.ts`
- Modify: `apps/api/src/routes/votes.ts`
- Modify: `packages/shared/src/vote.ts` (`VotingPeriodDTO` ganha `sectorId`)
- Modify: `apps/api/src/lib/serialize.ts` (`toPeriodDTO` inclui `sectorId`)
- Test: `apps/api/src/services/voting-service.test.ts`, `apps/api/src/routes/admin.test.ts`, `apps/api/src/routes/votes.test.ts` (extensões)

**Interfaces:**
- Consumes: `DEFAULT_SECTOR_ID` (`@legends/shared`).
- Produces: `scheduleVotingPeriod(input: { sectorId: string; monthRef: string; startsAt: Date; endsAt: Date })`, `getCurrentOpenPeriod(sectorId: string, now?: Date)`, `getNextScheduledPeriod(sectorId: string, now?: Date)`, `createVote` rejeita voto cross-setor.

- [ ] **Step 1: Escrever o teste de `voting-service` (falhando)**

Adicionar ao final de `apps/api/src/services/voting-service.test.ts` (se o arquivo não existir com esse nome, criar seguindo o padrão de `sector-service.test.ts`; caso já exista, adicionar este `describe`):

```ts
describe('votação escopada por setor', () => {
  it('rejeita voto em colega de outro setor e permite no mesmo setor', async () => {
    const sectorA = await createSector({ name: 'Setor A', enabledFeatures: [], roles: ['LEGEND'] })
    const sectorB = await createSector({ name: 'Setor B', enabledFeatures: [], roles: ['LEGEND'] })
    const cat = await prisma.category.create({ data: { name: 'Cat', slug: 'cat' } })
    const periodA = await scheduleVotingPeriod({
      sectorId: sectorA.id,
      monthRef: '2026-11',
      startsAt: new Date('2026-11-01'),
      endsAt: new Date('2026-11-30'),
    })
    const periodB = await scheduleVotingPeriod({
      sectorId: sectorB.id,
      monthRef: '2026-11',
      startsAt: new Date('2026-11-01'),
      endsAt: new Date('2026-11-30'),
    })
    expect(periodA.id).not.toBe(periodB.id)

    const voterA = await prisma.user.create({ data: { name: 'Voter A', email: 'va@x.com', passwordHash: 'x', role: 'LEGEND', sectorId: sectorA.id } })
    const votedB = await prisma.user.create({ data: { name: 'Voted B', email: 'vb@x.com', passwordHash: 'x', role: 'LEGEND', sectorId: sectorB.id } })
    const votedA = await prisma.user.create({ data: { name: 'Voted A', email: 'va2@x.com', passwordHash: 'x', role: 'LEGEND', sectorId: sectorA.id } })

    await expect(
      createVote({ voterId: voterA.id, votedId: votedB.id, categoryIds: [cat.id], justification: 'justificativa válida' }),
    ).rejects.toMatchObject({ status: 400 })

    const vote = await createVote({ voterId: voterA.id, votedId: votedA.id, categoryIds: [cat.id], justification: 'justificativa válida' })
    expect(vote.periodId).toBe(periodA.id)
  })

  it('getCurrentOpenPeriod/getNextScheduledPeriod respeitam o setor', async () => {
    const sectorA = await createSector({ name: 'A2', enabledFeatures: [], roles: [] })
    const sectorB = await createSector({ name: 'B2', enabledFeatures: [], roles: [] })
    await scheduleVotingPeriod({ sectorId: sectorA.id, monthRef: '2026-12', startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 100000) })
    const currentA = await getCurrentOpenPeriod(sectorA.id)
    const currentB = await getCurrentOpenPeriod(sectorB.id)
    expect(currentA).not.toBeNull()
    expect(currentB).toBeNull()
  })
})
```

No topo do arquivo de teste, garanta os imports:

```ts
import { createVote, getCurrentOpenPeriod, scheduleVotingPeriod } from './voting-service'
import { createSector } from './sector-service'
import { prisma } from '../lib/prisma'
```

(Ajuste os imports conforme o que já existir no arquivo — não duplique.)

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/voting-service.test.ts`
Expected: FAIL (`scheduleVotingPeriod` não aceita `sectorId`, `getCurrentOpenPeriod` não aceita argumento obrigatório)

- [ ] **Step 3: Editar `apps/api/src/services/admin-service.ts`**

```ts
// apps/api/src/services/admin-service.ts (arquivo inteiro)
import type { VotingPeriod } from '@prisma/client'
import { prisma } from '../lib/prisma'

export { monthRefFor } from '../lib/period-state'

interface ScheduleVotingPeriodInput {
  sectorId: string
  monthRef: string
  startsAt: Date
  endsAt: Date
}

/**
 * Agenda o período (destaque do mês) DE UM SETOR. O mês é escolhido pelo admin e a
 * janela `[startsAt, endsAt]` define quando a votação fica aberta. Nasce OPEN e se
 * ativa sozinho por data (ver getCurrentOpenPeriod). (sectorId, monthRef) é único:
 * um período por mês por setor — duplicata cai no P2002.
 */
export function scheduleVotingPeriod(input: ScheduleVotingPeriodInput): Promise<VotingPeriod> {
  return prisma.votingPeriod.create({
    data: { sectorId: input.sectorId, monthRef: input.monthRef, startsAt: input.startsAt, endsAt: input.endsAt, status: 'OPEN' },
  })
}

/**
 * Atualiza a janela de votação de um período e o reabre (status OPEN). Editar
 * a janela de um ciclo que ainda não passou significa "agendá-lo" — então um
 * período antes fechado volta a valer pela nova janela (vira SCHEDULED/ACTIVE).
 * A regra de "mês não passado" é validada na rota (precisa do monthRef atual).
 */
export function updateVotingPeriod(id: string, data: { startsAt: Date; endsAt: Date }): Promise<VotingPeriod> {
  return prisma.votingPeriod.update({ where: { id }, data: { ...data, status: 'OPEN' } })
}

export function closeVotingPeriod(id: string): Promise<VotingPeriod> {
  return prisma.votingPeriod.update({ where: { id }, data: { status: 'CLOSED' } })
}
```

- [ ] **Step 4: Editar `apps/api/src/services/voting-service.ts`**

```ts
// apps/api/src/services/voting-service.ts (arquivo inteiro)
import { Prisma, type VotingPeriod } from '@prisma/client'
import { prisma } from '../lib/prisma'

export class VoteError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'VoteError'
  }
}

export const voteInclude = {
  voter: true,
  voted: true,
  period: true,
  categories: { include: { category: true } },
} as const

export type VoteWithRelations = Prisma.VoteGetPayload<{ include: typeof voteInclude }>

/**
 * Período aberto para votar agora NO SETOR informado: status OPEN cuja janela
 * [startsAt, endsAt] contém `now`. Ativação por data — um período agendado entra
 * sozinho na janela. Em caso de sobreposição, o de início mais recente vence.
 */
export function getCurrentOpenPeriod(sectorId: string, now: Date = new Date()): Promise<VotingPeriod | null> {
  return prisma.votingPeriod.findFirst({
    where: { sectorId, status: 'OPEN', startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { startsAt: 'desc' },
  })
}

/**
 * Próximo período agendado NO SETOR informado: status OPEN cuja janela ainda não
 * começou (startsAt > now), o de início mais cedo.
 */
export function getNextScheduledPeriod(sectorId: string, now: Date = new Date()): Promise<VotingPeriod | null> {
  return prisma.votingPeriod.findFirst({
    where: { sectorId, status: 'OPEN', startsAt: { gt: now } },
    orderBy: { startsAt: 'asc' },
  })
}

interface CreateVoteInput {
  voterId: string
  votedId: string
  categoryIds: string[]
  justification: string
}

export async function createVote(input: CreateVoteInput): Promise<VoteWithRelations> {
  if (input.voterId === input.votedId) {
    throw new VoteError('Você não pode votar em si mesmo.', 400)
  }

  const voter = await prisma.user.findUnique({ where: { id: input.voterId } })
  if (!voter || !voter.active) {
    throw new VoteError('Votante inválido.', 400)
  }
  if (voter.role === 'ADMIN') {
    throw new VoteError('Administradores não votam.', 403)
  }

  const period = await getCurrentOpenPeriod(voter.sectorId)
  if (!period) {
    throw new VoteError('Nenhum período de votação aberto no momento.', 409)
  }

  const voted = await prisma.user.findUnique({ where: { id: input.votedId } })
  if (!voted || !voted.active || voted.role !== 'LEGEND') {
    throw new VoteError('Colega inválido para votação.', 400)
  }
  if (voted.sectorId !== voter.sectorId) {
    throw new VoteError('Você só pode votar em colegas do seu setor.', 400)
  }

  const categoryIds = [...new Set(input.categoryIds)]
  const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } } })
  if (categories.length !== categoryIds.length || categories.some((c) => !c.active)) {
    throw new VoteError('Categoria inválida.', 400)
  }

  try {
    return await prisma.vote.create({
      data: {
        voterId: input.voterId,
        votedId: input.votedId,
        periodId: period.id,
        justification: input.justification,
        categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
      },
      include: voteInclude,
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new VoteError('Você já registrou seu voto neste período.', 409)
    }
    throw err
  }
}

export function listVotesByVoter(voterId: string, periodId: string): Promise<VoteWithRelations[]> {
  return prisma.vote.findMany({
    where: { voterId, periodId },
    include: voteInclude,
    orderBy: { createdAt: 'desc' },
  })
}
```

- [ ] **Step 5: Rodar e confirmar sucesso do `voting-service.test.ts`**

Run: `pnpm --filter @legends/api exec vitest run src/services/voting-service.test.ts`
Expected: PASS (todos os testes, incluindo os 2 novos)

- [ ] **Step 6: Ajustar `packages/shared/src/vote.ts` e `toPeriodDTO`**

Em `packages/shared/src/vote.ts`, adicionar `sectorId: string` em `VotingPeriodDTO`:

```ts
export interface VotingPeriodDTO {
  id: string
  sectorId: string
  monthRef: string
  startsAt: string
  endsAt: string
  status: VotingPeriodStatus
  state: VotingPeriodState
  editable: boolean
}
```

Em `apps/api/src/lib/serialize.ts`, ajustar `toPeriodDTO`:

```ts
export function toPeriodDTO(period: VotingPeriod, now: Date = new Date()): VotingPeriodDTO {
  return {
    id: period.id,
    sectorId: period.sectorId,
    monthRef: period.monthRef,
    startsAt: period.startsAt.toISOString(),
    endsAt: period.endsAt.toISOString(),
    status: period.status,
    state: derivePeriodState(period, now),
    editable: isPeriodEditable(period.monthRef, now),
  }
}
```

- [ ] **Step 7: Ajustar `apps/api/src/routes/periods.ts`**

```ts
// apps/api/src/routes/periods.ts (arquivo inteiro)
import type { FastifyInstance } from 'fastify'
import { getCurrentOpenPeriod, getNextScheduledPeriod } from '../services/voting-service'
import { toPeriodDTO } from '../lib/serialize'

export async function periodRoutes(app: FastifyInstance) {
  app.get('/periods/current', { onRequest: [app.authenticate] }, async (request, reply) => {
    const period = await getCurrentOpenPeriod(request.user.sectorId)
    return reply.send({ period: period ? toPeriodDTO(period) : null })
  })

  app.get('/periods/next', { onRequest: [app.authenticate] }, async (request, reply) => {
    const period = await getNextScheduledPeriod(request.user.sectorId)
    return reply.send({ period: period ? toPeriodDTO(period) : null })
  })
}
```

(`request.user.sectorId` só existirá de fato depois da Task 7, que atualiza o JWT — como as tasks são sequenciais, o typecheck deste arquivo só fecha depois daquela task; deixe o código já correto aqui.)

- [ ] **Step 8: Ajustar `apps/api/src/routes/votes.ts`**

Trocar a linha `const period = await getCurrentOpenPeriod()` (dentro de `GET /votes/me`) por:

```ts
    const period = await getCurrentOpenPeriod(request.user.sectorId)
```

- [ ] **Step 9: Ajustar `/admin/periods` em `apps/api/src/routes/admin.ts`**

Em `schedulePeriodSchema`, adicionar `sectorId`:

```ts
const schedulePeriodSchema = periodWindowSchema.extend({
  monthRef: z.string().regex(/^\d{4}-\d{2}$/),
  sectorId: z.string().min(1).optional(),
})
```

No handler `GET /admin/periods`, aceitar filtro opcional por setor via querystring:

```ts
  app.get('/admin/periods', adminOnly, async (request, reply) => {
    const { sectorId } = request.query as { sectorId?: string }
    const periods = await prisma.votingPeriod.findMany({
      where: sectorId ? { sectorId } : undefined,
      orderBy: { startsAt: 'desc' },
    })
    return reply.send({ periods: periods.map((p) => toPeriodDTO(p)) })
  })
```

No handler `POST /admin/periods`, usar o `sectorId` (com fallback ao default) ao chamar `scheduleVotingPeriod`:

```ts
  app.post('/admin/periods', adminOnly, async (request, reply) => {
    const parsed = schedulePeriodSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos (use monthRef YYYY-MM, startsAt e endsAt)' })
    }
    const { monthRef, startsAt, endsAt } = parsed.data
    const sectorId = parsed.data.sectorId ?? DEFAULT_SECTOR_ID
    const invalid = windowError(startsAt, endsAt)
    if (invalid) return reply.code(400).send({ message: invalid })
    try {
      const period = await scheduleVotingPeriod({ sectorId, monthRef, startsAt, endsAt })
      try {
        await notifyPeriodOpened({ monthRef: period.monthRef })
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      return reply.code(201).send({ period: toPeriodDTO(period) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'Já existe um período para esse mês neste setor.' })
      }
      throw err
    }
  })
```

(`DEFAULT_SECTOR_ID` já foi importado na Task 5.)

- [ ] **Step 10: Escrever/ajustar o teste de `POST /admin/periods` com dois setores**

Adicionar a `apps/api/src/routes/admin.test.ts`:

```ts
it('agenda períodos independentes por setor para o mesmo mês (POST /admin/periods)', async () => {
  const app = buildApp()
  await app.ready()
  const token = await adminToken(app)
  const sectorRes = await app.inject({
    method: 'POST',
    url: '/admin/sectors',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Vendas', enabledFeatures: [], roles: [] },
  })
  const sectorId = sectorRes.json().sector.id

  const defaultPeriod = await app.inject({
    method: 'POST',
    url: '/admin/periods',
    headers: { authorization: `Bearer ${token}` },
    payload: { monthRef: '2027-01', startsAt: '2027-01-01T00:00:00Z', endsAt: '2027-01-31T23:59:59Z' },
  })
  expect(defaultPeriod.statusCode).toBe(201)
  expect(defaultPeriod.json().period.sectorId).toBe('sector-dev-produto')

  const sectorPeriod = await app.inject({
    method: 'POST',
    url: '/admin/periods',
    headers: { authorization: `Bearer ${token}` },
    payload: { monthRef: '2027-01', startsAt: '2027-01-01T00:00:00Z', endsAt: '2027-01-31T23:59:59Z', sectorId },
  })
  expect(sectorPeriod.statusCode).toBe(201)
  expect(sectorPeriod.json().period.sectorId).toBe(sectorId)
  await app.close()
})
```

- [ ] **Step 11: Rodar toda a suíte da API**

Run: `pnpm --filter @legends/api test`
Expected: PASS (a suíte completa continua verde; os testes pré-existentes de `/votes` e `/periods` seguem passando porque `request.user.sectorId` cai no default via JWT assim que a Task 7 estiver aplicada — se rodar esta task isoladamente antes da 7, espere falhas de tipo/undefined em `request.user.sectorId`; ver nota abaixo)

> Nota de sequenciamento: os Steps 7 e 8 desta task já assumem `request.user.sectorId`, que só passa a existir de fato no JWT na Task 7. Ao implementar as tasks em ordem (como este plano prevê), rode o Step 11 (suíte completa) **depois** de concluir a Task 7, não isoladamente aqui — ou, se preferir validar já, rode a Task 7 antes deste Step 11.

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/services/admin-service.ts apps/api/src/services/voting-service.ts apps/api/src/services/voting-service.test.ts apps/api/src/routes/periods.ts apps/api/src/routes/votes.ts apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts apps/api/src/lib/serialize.ts packages/shared/src/vote.ts
git commit -m "feat(api): períodos e votação escopados por setor"
```

---

## Task 7: JWT + `requireFeature` generalizados

**Files:**
- Modify: `apps/api/src/types/fastify.d.ts`
- Modify: `apps/api/src/lib/jwt.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/routes/office-ws.ts`
- Modify: `apps/api/src/lib/serialize.ts` (`toPublicUser` ganha o parâmetro `sectorFeatures`)
- Test: `apps/api/src/routes/auth.test.ts`, `apps/api/src/routes/votes.test.ts` (extensões)

**Interfaces:**
- Produces: `signAccessToken(app, user, sectorFeatures?: string[]): string`; `toPublicUser(user, sectorFeatures?: string[]): PublicUser`; `request.user: { sub, role, sectorId, features: string[] }`; `app.requireFeature(key)` passa para `ADMIN` sempre e checa `request.user.features` para todos os demais papéis.

- [ ] **Step 1: Atualizar a tipagem do JWT em `apps/api/src/types/fastify.d.ts`**

```ts
// apps/api/src/types/fastify.d.ts (arquivo inteiro)
import '@fastify/jwt'
import type { FastifyReply, FastifyRequest } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireFeature: (key: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: string; sectorId: string; features: string[] }
    user: { sub: string; role: string; sectorId: string; features: string[] }
  }
}
```

- [ ] **Step 2: Atualizar `apps/api/src/lib/jwt.ts`**

```ts
// apps/api/src/lib/jwt.ts (arquivo inteiro)
import type { FastifyInstance } from 'fastify'
import type { User } from '@prisma/client'

export interface AccessTokenPayload {
  sub: string
  role: string
  sectorId: string
  features: string[]
}

/**
 * `sectorFeatures` são as features do SETOR do usuário — ignoradas para
 * THIRD_PARTY, que continua com sua allowlist individual (enabledFeatures do
 * próprio convite), sector-agnostic.
 */
export function signAccessToken(app: FastifyInstance, user: User, sectorFeatures: string[] = []): string {
  const features =
    user.role === 'THIRD_PARTY'
      ? Array.isArray(user.enabledFeatures)
        ? (user.enabledFeatures as string[])
        : []
      : sectorFeatures
  const payload: AccessTokenPayload = { sub: user.id, role: user.role, sectorId: user.sectorId, features }
  return app.jwt.sign(payload)
}
```

- [ ] **Step 3: Generalizar `requireFeature` em `apps/api/src/app.ts`**

Trocar o decorator:

```ts
  app.decorate('requireFeature', function (key: string) {
    return async function (request, reply) {
      if (request.user.role === 'ADMIN') return
      const features = request.user.features ?? []
      if (!features.includes(key)) {
        return reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
      }
    }
  })
```

- [ ] **Step 4: Ajustar `toPublicUser` em `apps/api/src/lib/serialize.ts`**

Trocar a assinatura para aceitar o segundo parâmetro (já preparado na Task 1 com `sectorFeatures: [] as FeatureKey[]` fixo — agora o valor vem de fora):

```ts
export function toPublicUser(user: User, sectorFeatures: string[] = []): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.leftAt ? null : user.email,
    role: user.role,
    area: user.area,
    position: user.position,
    squad: user.squad,
    photoUrl: user.photoUrl,
    avatarStyle: sanitizeAvatarStyle(user.avatarStyle),
    avatarSeed: user.avatarSeed,
    avatarOptions: sanitizeAvatarOptions(user.avatarOptions),
    active: user.active,
    joinedAt: user.joinedAt.toISOString(),
    leftAt: user.leftAt ? user.leftAt.toISOString() : null,
    sectorId: user.sectorId,
    enabledFeatures: Array.isArray(user.enabledFeatures) ? (user.enabledFeatures as FeatureKey[]) : [],
    sectorFeatures: sectorFeatures as FeatureKey[],
  }
}
```

- [ ] **Step 5: Buscar e propagar `sectorFeatures` em `apps/api/src/routes/auth.ts`**

Adicionar, logo abaixo dos imports, o helper:

```ts
async function sectorFeaturesFor(sectorId: string): Promise<string[]> {
  const sector = await prisma.sector.findUnique({ where: { id: sectorId } })
  return Array.isArray(sector?.enabledFeatures) ? (sector.enabledFeatures as string[]) : []
}
```

Em `POST /register`:

```ts
      const user = await registerUser(parsed.data)
      const sectorFeatures = await sectorFeaturesFor(user.sectorId)
      const accessToken = signAccessToken(app, user, sectorFeatures)
      const refresh = await issueRefreshTokenForLogin(user.id, false)
      reply.setCookie(
        REFRESH_COOKIE,
        refresh.rawToken,
        refreshCookieOptions(refresh.persistent, refresh.expiresAt),
      )
      return reply.code(201).send({ accessToken, user: toPublicUser(user, sectorFeatures) })
```

Em `POST /login`:

```ts
      const user = await authenticateUser(parsed.data.email, parsed.data.password)
      const sectorFeatures = await sectorFeaturesFor(user.sectorId)
      const accessToken = signAccessToken(app, user, sectorFeatures)
      const refresh = await issueRefreshTokenForLogin(user.id, parsed.data.remember)
      reply.setCookie(
        REFRESH_COOKIE,
        refresh.rawToken,
        refreshCookieOptions(refresh.persistent, refresh.expiresAt),
      )
      return reply.send({ accessToken, user: toPublicUser(user, sectorFeatures) })
```

Em `POST /refresh`:

```ts
      const accessToken = signAccessToken(app, user, await sectorFeaturesFor(user.sectorId))
```

Em `GET /me`:

```ts
  app.get('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } })
    if (!user) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
    return reply.send({ user: toPublicUser(user, await sectorFeaturesFor(user.sectorId)) })
  })
```

E no final de `PATCH /me` (troque a última linha):

```ts
    return reply.send({ user: toPublicUser(user, await sectorFeaturesFor(user.sectorId)) })
```

- [ ] **Step 6: Ajustar `apps/api/src/routes/office-ws.ts`**

Trocar a linha (dentro do `preValidation`):

```ts
          } else if (payload.role !== 'ADMIN' && !(payload.features ?? []).includes('escritorio')) {
```

- [ ] **Step 7: Escrever o teste de `auth.test.ts` para o novo gate**

Adicionar a `apps/api/src/routes/auth.test.ts` (ajuste o nome do describe conforme o padrão local do arquivo):

```ts
it('lenda sem "votar" habilitado no setor recebe 403 em rota gated por feature', async () => {
  const app = buildApp()
  await app.ready()
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Sem Voto', email: 'semvoto@empresa.com', password: 'changeme123' } })
  const created = await prisma.user.findUniqueOrThrow({ where: { email: 'semvoto@empresa.com' } })
  const sector = await createSector({ name: 'Sem Votação', enabledFeatures: [], roles: ['LEGEND'] })
  await prisma.user.update({ where: { id: created.id }, data: { sectorId: sector.id } })

  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'semvoto@empresa.com', password: 'changeme123' } })
  const token = login.json().accessToken as string

  const res = await app.inject({ method: 'GET', url: '/votes/me', headers: { authorization: `Bearer ${token}` } })
  expect(res.statusCode).toBe(403)
  await app.close()
})
```

Garanta os imports necessários no topo (`createSector` de `'../services/sector-service'`, `prisma` de `'../lib/prisma'`), sem duplicar imports já existentes no arquivo.

- [ ] **Step 8: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/routes/auth.test.ts src/routes/votes.test.ts`
Expected: PASS

- [ ] **Step 9: Rodar a suíte completa da API**

Run: `pnpm --filter @legends/api test`
Expected: PASS (toda a suíte, incluindo as tasks anteriores)

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/types/fastify.d.ts apps/api/src/lib/jwt.ts apps/api/src/app.ts apps/api/src/routes/auth.ts apps/api/src/routes/office-ws.ts apps/api/src/lib/serialize.ts apps/api/src/routes/auth.test.ts
git commit -m "feat(api): JWT e requireFeature generalizados para todos os papéis via setor"
```

---

## Task 8: Frontend — `sectorFeatures` no gate de navegação

**Files:**
- Modify: `apps/web/src/components/nav-items.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`
- Test: `apps/web/src/components/nav-items.test.ts` (extensão)

**Interfaces:**
- Consumes: `PublicUser.sectorFeatures`, `PublicUser.enabledFeatures`, `PublicUser.role` (Task 1/7).
- Produces: `buildNavItems` filtra por `sectorFeatures` para papéis não-THIRD_PARTY (exceto ADMIN, que já retorna cedo); `FeatureGate` idem.

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar a `apps/web/src/components/nav-items.test.ts`:

```ts
it('esconde itens não liberados pelo SETOR para LEGEND/LEAD/MANAGER/HEAD (não só THIRD_PARTY)', () => {
  const restricted = buildNavItems({
    isAdmin: false,
    userId: 'u3',
    role: 'LEGEND',
    sectorFeatures: ['escritorio'],
  })
  expect(restricted.some((item) => item.to === '/escritorio')).toBe(true)
  expect(restricted.some((item) => item.to === '/votar')).toBe(false)
  expect(restricted.some((item) => item.label === 'Home')).toBe(true)
})

it('THIRD_PARTY continua sendo filtrado pela allowlist individual (enabledFeatures), não pelo setor', () => {
  const restricted = buildNavItems({
    isAdmin: false,
    userId: 'u4',
    role: 'THIRD_PARTY',
    enabledFeatures: ['votar'],
    sectorFeatures: ['escritorio'],
  })
  expect(restricted.some((item) => item.to === '/votar')).toBe(true)
  expect(restricted.some((item) => item.to === '/escritorio')).toBe(false)
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/components/nav-items.test.ts`
Expected: FAIL (`sectorFeatures` não existe no parâmetro de `buildNavItems`; o teste de LEGEND restrito falha porque hoje `role !== 'THIRD_PARTY'` retorna tudo sem filtrar)

- [ ] **Step 3: Editar `apps/web/src/components/nav-items.ts`**

```ts
// apps/web/src/components/nav-items.ts (arquivo inteiro)
import type { FeatureKey, UserRole } from "@legends/shared";

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** Only match the exact path (used for the home route). */
  end?: boolean;
  /** Mostra o selo pulsante "Aberta" quando a votação está aberta. */
  showOpenBadge?: boolean;
  /** Chave de feature associada (para filtro por setor/terceirizado); ausente = sempre visível. */
  feature?: FeatureKey;
}

// Admins gerenciam a plataforma: não votam nem têm perfil próprio.
// Para eles, Admin é a ação principal e vem antes de Time.
export function buildNavItems(args: {
  isAdmin: boolean;
  userId?: string;
  role?: UserRole;
  enabledFeatures?: FeatureKey[];
  sectorFeatures?: FeatureKey[];
}): NavItem[] {
  const { isAdmin, userId, role, enabledFeatures, sectorFeatures } = args;
  if (isAdmin) {
    return [
      { to: '/admin', label: 'Admin', icon: 'shield_person' },
      { to: '/time', label: 'Time', icon: 'groups', end: true },
      { to: '/lendas', label: 'Lendas', icon: 'workspace_premium' },
      { to: '/resenha', label: 'Resenha', icon: 'forum' },
      { to: '/quinta-desenvolvimento', label: 'Quinta de Dev', icon: 'school' },
      { to: '/admin/resenha', label: 'Moderar resenha', icon: 'gavel' },
      { to: '/selos', label: 'Galeria de selos', icon: 'military_tech' },
      { to: '/destaques', label: 'Destaques', icon: 'trophy' },
      { to: '/notificacoes', label: 'Notificações', icon: 'notifications' },
    ];
  }
  const items: NavItem[] = [
    // Home é o ponto de partida (pulso do time).
    { to: '/', label: 'Home', icon: 'home', end: true },
    // Meu perfil vem logo abaixo.
    ...(userId
      ? [{ to: `/perfil/${userId}`, label: 'Meu perfil', icon: 'person' }]
      : []),
    { to: '/time', label: 'Time', icon: 'groups', end: true, feature: 'time' },
    { to: '/lendas', label: 'Lendas', icon: 'workspace_premium', feature: 'lendas' },
    { to: '/resenha', label: 'Resenha', icon: 'forum', feature: 'resenha' },
    { to: '/quinta-desenvolvimento', label: 'Quinta de Dev', icon: 'school', feature: 'quinta-desenvolvimento' },
    { to: '/escritorio', label: 'Escritório', icon: 'chair', feature: 'escritorio' },
    { to: '/selos', label: 'Galeria de selos', icon: 'military_tech', feature: 'selos' },
    { to: '/votar', label: 'Votar', icon: 'how_to_vote', showOpenBadge: true, feature: 'votar' },
    { to: '/retrospectivas', label: 'Retrospectivas', icon: 'dashboard', feature: 'retrospectivas' },
    { to: '/destaques', label: 'Destaques', icon: 'trophy', feature: 'destaques' },
    { to: '/notificacoes', label: 'Notificações', icon: 'notifications', feature: 'notificacoes' },
  ];

  const effective = role === 'THIRD_PARTY' ? (enabledFeatures ?? []) : (sectorFeatures ?? []);
  const enabled = new Set(effective);
  return items.filter((item) => !item.feature || enabled.has(item.feature));
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/components/nav-items.test.ts`
Expected: PASS (todos os testes, incluindo os pré-existentes e os 2 novos — o teste antigo `'esconde itens não liberados para THIRD_PARTY e mantém tudo para as demais roles'` vai passar a falhar; ajuste-o no Step 5)

- [ ] **Step 5: Atualizar o teste pré-existente que assumia "todas as demais roles veem tudo"**

Em `apps/web/src/components/nav-items.test.ts`, o teste `'esconde itens não liberados para THIRD_PARTY e mantém tudo para as demais roles'` precisa passar `sectorFeatures` para `LEGEND` continuar vendo tudo (comportamento real: setor default tem todas as features). Ajuste a primeira chamada dentro dele:

```ts
    const full = buildNavItems({ isAdmin: false, userId: 'u1', role: 'LEGEND', sectorFeatures: ['time', 'lendas', 'resenha', 'quinta-desenvolvimento', 'escritorio', 'selos', 'votar', 'retrospectivas', 'destaques', 'notificacoes'] })
```

(mantenha o restante do teste como está — a parte de `THIRD_PARTY` com `enabledFeatures: ['escritorio']` continua correta sem alteração.)

- [ ] **Step 6: Rodar de novo para confirmar que nada mais quebrou**

Run: `pnpm --filter @legends/web exec vitest run src/components/nav-items.test.ts`
Expected: PASS (todos)

- [ ] **Step 7: Editar `apps/web/src/App.tsx` (generalizar `FeatureGate`)**

Trocar a função:

```tsx
/** Bloqueia quem não tem a feature habilitada (pelo setor, ou pela allowlist individual se for terceirizado). Admin sempre passa. */
function FeatureGate({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  const { user } = useAuth()
  if (!user || user.role === 'ADMIN') return <>{children}</>
  const enabled = user.role === 'THIRD_PARTY' ? user.enabledFeatures : user.sectorFeatures
  if (!enabled.includes(feature)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
```

E o import do tipo no topo do arquivo:

```tsx
import type { FeatureKey } from '@legends/shared'
```

- [ ] **Step 8: Editar `apps/web/src/components/AppLayout.tsx`**

Trocar a chamada de `buildNavItems`:

```tsx
  const navItems = buildNavItems({
    isAdmin,
    userId: user?.id,
    role: user?.role,
    enabledFeatures: user?.enabledFeatures,
    sectorFeatures: user?.sectorFeatures,
  });
```

- [ ] **Step 9: Rodar a suíte de web relevante**

Run: `pnpm --filter @legends/web exec vitest run src/components/nav-items.test.ts src/App.test.tsx`
Expected: PASS (se `App.test.tsx` não existir, rode só `nav-items.test.ts` e confirme visualmente com `pnpm --filter @legends/web build` que o TypeScript fecha)

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/nav-items.ts apps/web/src/components/nav-items.test.ts apps/web/src/App.tsx apps/web/src/components/AppLayout.tsx
git commit -m "feat(web): gate de navegação por feature do setor para todos os papéis"
```

---

## Task 9: Admin UI — aba "Setores"

**Files:**
- Create: `apps/web/src/pages/admin/SectorsSection.tsx`
- Modify: `apps/web/src/pages/admin/TabBar.tsx`
- Modify: `apps/web/src/pages/AdminPage.tsx`
- Test: `apps/web/src/pages/admin/SectorsSection.test.tsx`

**Interfaces:**
- Consumes: `SectorDTO`, `CreateSectorRequest`, `UpdateSectorRequest`, `FEATURE_KEYS`, `FEATURE_LABELS`, `USER_ROLES`, `USER_ROLE_LABELS` (`@legends/shared`); `Panel`, `inputCls` (`./shared`); `apiFetch`, `ApiError` (`../../lib/api`).
- Produces: componente `SectorsSection` exportado; nova aba `"setores"` em `AdminTabId`.

- [ ] **Step 1: Adicionar a aba em `apps/web/src/pages/admin/TabBar.tsx`**

```tsx
export type AdminTabId =
  | "periodos"
  | "setores"
  | "lendas"
  | "terceirizados"
  | "selos"
  | "categorias"
  | "squads"
  | "quinta-dev"
  | "moderacao"
  | "retrospectivas"
  | "mapas"
  | "escritorio";

export const ADMIN_TABS: { id: AdminTabId; label: string }[] = [
  { id: "periodos", label: "Períodos" },
  { id: "setores", label: "Setores" },
  { id: "lendas", label: "Lendas" },
  { id: "terceirizados", label: "Terceirizados" },
  { id: "selos", label: "Selos" },
  { id: "categorias", label: "Categorias" },
  { id: "squads", label: "Squads" },
  { id: "quinta-dev", label: "Quinta Dev" },
  { id: "moderacao", label: "Moderação" },
  { id: "retrospectivas", label: "Retrospectivas" },
  { id: "mapas", label: "Mapas" },
  { id: "escritorio", label: "Escritório" },
];
```

(o restante do arquivo — o componente `TabBar` — não muda.)

- [ ] **Step 2: Escrever o teste de `SectorsSection` (falhando)**

```tsx
// apps/web/src/pages/admin/SectorsSection.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SectorsSection } from './SectorsSection'
import * as api from '../../lib/api'

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SectorsSection />
    </QueryClientProvider>,
  )
}

describe('SectorsSection', () => {
  beforeEach(() => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (url: string) => {
      if (url === '/admin/sectors') {
        return {
          sectors: [
            { id: 'sector-dev-produto', name: 'Desenvolvimento de Produto', slug: 'desenvolvimento-de-produto', active: true, enabledFeatures: ['escritorio', 'votar'], roles: ['LEGEND', 'LEAD'] },
          ],
        }
      }
      throw new Error(`unexpected url ${url}`)
    })
  })

  it('lista os setores existentes com suas features e papéis', async () => {
    renderWithClient()
    await waitFor(() => expect(screen.getByText('Desenvolvimento de Produto')).toBeInTheDocument())
    expect(screen.getByLabelText('Escritório')).toBeChecked()
    expect(screen.getByLabelText('Lenda')).toBeChecked()
  })

  it('abre o formulário de criação ao clicar em "+ Adicionar setor"', async () => {
    renderWithClient()
    await waitFor(() => expect(screen.getByText('Desenvolvimento de Produto')).toBeInTheDocument())
    await userEvent.click(screen.getByText('+ Adicionar setor'))
    expect(screen.getByLabelText('Nome do novo setor')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/SectorsSection.test.tsx`
Expected: FAIL (`Cannot find module './SectorsSection'`)

- [ ] **Step 4: Implementar `apps/web/src/pages/admin/SectorsSection.tsx`**

```tsx
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SectorDTO, FeatureKey, UserRole } from '@legends/shared'
import { FEATURE_KEYS, FEATURE_LABELS, USER_ROLES, USER_ROLE_LABELS } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Panel, inputCls } from './shared'

function FeatureChecklist({
  selected,
  onToggle,
}: {
  selected: Set<FeatureKey>
  onToggle: (key: FeatureKey) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-sm sm:grid-cols-3">
      {FEATURE_KEYS.map((key) => (
        <label key={key} className="flex items-center gap-xs font-label text-label-sm text-on-surface">
          <input type="checkbox" aria-label={FEATURE_LABELS[key]} checked={selected.has(key)} onChange={() => onToggle(key)} />
          {FEATURE_LABELS[key]}
        </label>
      ))}
    </div>
  )
}

function RoleChecklist({
  selected,
  onToggle,
}: {
  selected: Set<UserRole>
  onToggle: (role: UserRole) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-sm sm:grid-cols-3">
      {USER_ROLES.map((role) => (
        <label key={role} className="flex items-center gap-xs font-label text-label-sm text-on-surface">
          <input type="checkbox" aria-label={USER_ROLE_LABELS[role]} checked={selected.has(role)} onChange={() => onToggle(role)} />
          {USER_ROLE_LABELS[role]}
        </label>
      ))}
    </div>
  )
}

function SectorForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [features, setFeatures] = useState<Set<FeatureKey>>(new Set(['escritorio']))
  const [roles, setRoles] = useState<Set<UserRole>>(new Set(['LEGEND']))
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ sector: SectorDTO }>('/admin/sectors', {
        method: 'POST',
        body: JSON.stringify({ name, enabledFeatures: Array.from(features), roles: Array.from(roles) }),
      }),
    onSuccess: () => {
      setName('')
      setError(null)
      onCreated()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao criar setor.'),
  })

  function toggleFeature(key: FeatureKey) {
    setFeatures((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleRole(role: UserRole) {
    setRoles((prev) => {
      const next = new Set(prev)
      if (next.has(role)) next.delete(role)
      else next.add(role)
      return next
    })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    create.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="mb-lg flex flex-col gap-sm rounded-lg border border-outline-variant/30 bg-surface-container-low p-md">
      <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
        Nome do setor
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do novo setor" placeholder="Ex.: Comercial" />
      </label>
      <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Features habilitadas</p>
      <FeatureChecklist selected={features} onToggle={toggleFeature} />
      <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Papéis habilitados</p>
      <RoleChecklist selected={roles} onToggle={toggleRole} />
      {error && (
        <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {error}
        </p>
      )}
      <div>
        <button type="submit" className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container">
          Criar setor
        </button>
      </div>
    </form>
  )
}

function SectorRow({ sector, onSave }: { sector: SectorDTO; onSave: (id: string, data: { name: string; active: boolean; enabledFeatures: FeatureKey[]; roles: UserRole[] }) => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(sector.name)
  const [features, setFeatures] = useState<Set<FeatureKey>>(new Set(sector.enabledFeatures))
  const [roles, setRoles] = useState<Set<UserRole>>(new Set(sector.roles))

  function toggleFeature(key: FeatureKey) {
    setFeatures((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleRole(role: UserRole) {
    setRoles((prev) => {
      const next = new Set(prev)
      if (next.has(role)) next.delete(role)
      else next.add(role)
      return next
    })
  }

  if (editing) {
    return (
      <li className="flex flex-col gap-sm rounded-lg border border-primary/40 bg-surface-container-low p-md">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} aria-label={`Nome do setor ${sector.name}`} />
        <FeatureChecklist selected={features} onToggle={toggleFeature} />
        <RoleChecklist selected={roles} onToggle={toggleRole} />
        <div className="flex gap-sm">
          <button
            onClick={() => {
              onSave(sector.id, { name: name.trim(), active: sector.active, enabledFeatures: Array.from(features), roles: Array.from(roles) })
              setEditing(false)
            }}
            className="rounded-md bg-primary px-md py-1 font-label text-label-sm font-bold text-on-primary hover:bg-primary-container"
          >
            Salvar
          </button>
          <button onClick={() => setEditing(false)} className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:text-on-surface">
            Cancelar
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className="flex flex-col gap-sm rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
      <div className="flex items-center justify-between">
        <span className={sector.active ? 'text-on-surface' : 'text-on-surface-variant line-through'}>{sector.name}</span>
        <div className="flex shrink-0 gap-sm">
          <button onClick={() => setEditing(true)} className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary">
            Editar
          </button>
          <button
            onClick={() => onSave(sector.id, { name: sector.name, active: !sector.active, enabledFeatures: sector.enabledFeatures, roles: sector.roles })}
            className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
          >
            {sector.active ? 'Desativar' : 'Ativar'}
          </button>
        </div>
      </div>
      <FeatureChecklist selected={new Set(sector.enabledFeatures)} onToggle={() => {}} />
      <RoleChecklist selected={new Set(sector.roles)} onToggle={() => {}} />
    </li>
  )
}

export function SectorsSection() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)

  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
  })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'sectors'] })
  const updateSector = useMutation({
    mutationFn: (vars: { id: string; data: { name: string; active: boolean; enabledFeatures: FeatureKey[]; roles: UserRole[] } }) =>
      apiFetch<{ sector: SectorDTO }>(`/admin/sectors/${vars.id}`, { method: 'PATCH', body: JSON.stringify(vars.data) }),
    onSuccess: invalidate,
  })

  const sectors = sectorsQuery.data?.sectors ?? []

  return (
    <Panel
      title="Setores"
      action={
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
        >
          {showForm ? 'Cancelar' : '+ Adicionar setor'}
        </button>
      }
    >
      {showForm && <SectorForm onCreated={() => { setShowForm(false); invalidate() }} />}
      <ul className="flex flex-col gap-md">
        {sectors.map((sector) => (
          <SectorRow key={sector.id} sector={sector} onSave={(id, data) => updateSector.mutate({ id, data })} />
        ))}
      </ul>
    </Panel>
  )
}
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/SectorsSection.test.tsx`
Expected: PASS (2 testes)

- [ ] **Step 6: Ligar a aba em `apps/web/src/pages/AdminPage.tsx`**

Adicionar o import e a renderização condicional:

```tsx
import { SectorsSection } from "./admin/SectorsSection";
```

```tsx
      {activeTab === "periodos" && <PeriodsSection />}
      {activeTab === "setores" && <SectorsSection />}
      {activeTab === "lendas" && <CollaboratorsSection />}
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/admin/SectorsSection.tsx apps/web/src/pages/admin/SectorsSection.test.tsx apps/web/src/pages/admin/TabBar.tsx apps/web/src/pages/AdminPage.tsx
git commit -m "feat(web): aba Setores no painel admin"
```

---

## Task 10: Admin UI — seletor de setor em Lendas, Terceirizados e Períodos

**Files:**
- Modify: `apps/web/src/pages/admin/CollaboratorsSection.tsx`
- Modify: `apps/web/src/pages/admin/ThirdPartySection.tsx`
- Modify: `apps/web/src/pages/admin/PeriodsSection.tsx`
- Test: `apps/web/src/pages/admin/PeriodsSection.test.tsx` (extensão, se existir; senão criar smoke test mínimo)

**Interfaces:**
- Consumes: `SectorDTO` (`@legends/shared`), query `['admin', 'sectors']` (mesma key usada na Task 9, reaproveitada via cache do React Query).

- [ ] **Step 1: Adicionar seletor de setor em `CollaboratorsSection.tsx`**

No topo do arquivo, adicionar aos imports:

```tsx
import type { AdminUserDTO, UserRole, Area, SectorDTO } from '@legends/shared'
```

Dentro de `CollaboratorRow`, adicionar o estado e o campo (junto aos demais `useState`):

```tsx
  const [sectorId, setSectorId] = useState(member.sectorId)
```

E no `onSave` (assinatura da prop e chamada), incluir `sectorId`:

```tsx
  onSave: (
    id: string,
    data: { name: string; email: string; position: string; squad: string; joinedAt: string; role: UserRole; area: Area | null; sectorId: string; password?: string; teamsWebhookUrl: string | null },
  ) => void
```

```tsx
    onSave(member.id, {
      name: name.trim(),
      email: email.trim(),
      position: position.trim(),
      squad: squad.trim(),
      joinedAt,
      role,
      area,
      sectorId,
      password: trimmedPassword || undefined,
      teamsWebhookUrl: teamsWebhookUrl.trim() || null,
    })
```

No formulário de edição (dentro do `if (editing)`), adicionar o `<select>` de setor (precisa da lista de setores — passe via prop `sectors: SectorDTO[]` para `CollaboratorRow`):

```tsx
function CollaboratorRow({
  member,
  sectors,
  onSave,
  onToggle,
  onSetLeft,
}: {
  member: AdminUserDTO
  sectors: SectorDTO[]
  onSave: (...) => void
  ...
}) {
```

```tsx
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Setor
            <select className={inputCls} value={sectorId} onChange={(e) => setSectorId(e.target.value)} aria-label="Setor do colaborador">
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
```

No componente `CollaboratorsSection`, buscar os setores e repassar:

```tsx
  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
  })
  const sectors = sectorsQuery.data?.sectors ?? []
```

E, no `.map` que renderiza `CollaboratorRow`, passar `sectors={sectors}`.

- [ ] **Step 2: Aplicar a mesma mudança em `ThirdPartySection.tsx`**

No topo do arquivo, adicionar `SectorDTO` ao import de `'@legends/shared'`.

Em `ThirdPartyUserEdit`, adicionar o campo:

```tsx
export interface ThirdPartyUserEdit {
  name: string
  email: string
  position: string
  squad: string
  joinedAt: string
  area: Area | null
  sectorId: string
  password?: string
  teamsWebhookUrl: string | null
  enabledFeatures: FeatureKey[]
}
```

Em `ThirdPartyRow`, adicionar a prop `sectors` e o estado:

```tsx
function ThirdPartyRow({
  member,
  sectors,
  onSave,
  onToggleActive,
}: {
  member: AdminUserDTO
  sectors: SectorDTO[]
  onSave: (id: string, data: ThirdPartyUserEdit) => Promise<unknown>
  onToggleActive: (id: string, active: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(member.name)
  const [email, setEmail] = useState(member.email)
  const [position, setPosition] = useState(member.position ?? '')
  const [squad, setSquad] = useState(member.squad ?? '')
  const [joinedAt, setJoinedAt] = useState(member.joinedAt.slice(0, 10))
  const [area, setArea] = useState<Area | null>(member.area)
  const [sectorId, setSectorId] = useState(member.sectorId)
  const [password, setPassword] = useState('')
```

No `handleSave`, incluir `sectorId` no payload:

```tsx
      await onSave(member.id, {
        name: name.trim(),
        email: email.trim(),
        position: position.trim(),
        squad: squad.trim(),
        joinedAt,
        area,
        sectorId,
        password: trimmedPassword || undefined,
        teamsWebhookUrl: teamsWebhookUrl.trim() || null,
        enabledFeatures: Array.from(features),
      })
```

No formulário de edição (dentro do `if (editing)`, logo depois do `<select>` de Área), adicionar:

```tsx
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Setor
            <select className={inputCls} value={sectorId} onChange={(e) => setSectorId(e.target.value)} aria-label="Setor do terceirizado">
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
```

No componente `ThirdPartySection`, buscar os setores e repassar para `ThirdPartyRow`:

```tsx
  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
  })
  const sectors = sectorsQuery.data?.sectors ?? []
```

```tsx
        {usersQuery.data?.users.map((member) => (
          <ThirdPartyRow
            key={member.id}
            member={member}
            sectors={sectors}
            onSave={(id, data) => updateUser.mutateAsync({ id, data })}
            onToggleActive={(id, active) => toggleActive.mutate({ id, active })}
          />
        ))}
```

No mock de `apps/web/src/pages/admin/ThirdPartySection.test.tsx` (pré-existente), adicione ao `apiFetch` mockado um caso para a URL `/admin/sectors` retornando `{ sectors: [{ id: 'sector-dev-produto', name: 'Desenvolvimento de Produto', slug: 'desenvolvimento-de-produto', active: true, enabledFeatures: [], roles: [] }] }`, senão os testes existentes quebram por causa da nova query.

- [ ] **Step 3: Adicionar seletor de setor em `PeriodsSection.tsx`**

Buscar os setores e adicionar um `<select>` no formulário de agendamento (`handleSchedulePeriod`), e um filtro por setor na listagem:

```tsx
  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
  })
  const sectors = sectorsQuery.data?.sectors ?? []
  const [selectedSectorId, setSelectedSectorId] = useState('')
```

No `periodsQuery`, incluir o filtro:

```tsx
  const periodsQuery = useQuery({
    queryKey: ['admin', 'periods', selectedSectorId],
    queryFn: () =>
      apiFetch<{ periods: VotingPeriodDTO[] }>(
        selectedSectorId ? `/admin/periods?sectorId=${selectedSectorId}` : '/admin/periods',
      ),
  })
```

E no formulário de agendamento (`schedulePeriod.mutate`), incluir `sectorId: periodForm.sectorId` (adicione `sectorId: ''` a `emptyPeriod` e um `<select>` no form, seguindo o padrão dos outros campos de `periodForm`).

- [ ] **Step 4: Rodar a suíte de web relevante**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin`
Expected: PASS (todas as seções de admin, incluindo `ThirdPartySection.test.tsx` pré-existente — ajuste esse teste se ele quebrar por falta do mock de `['admin', 'sectors']`, adicionando ao mock de `apiFetch` um caso para essa URL retornando uma lista com o setor default)

- [ ] **Step 5: Rodar o build do web para fechar o TypeScript**

Run: `pnpm --filter @legends/web build`
Expected: build passa sem erros de tipo

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/admin/CollaboratorsSection.tsx apps/web/src/pages/admin/ThirdPartySection.tsx apps/web/src/pages/admin/ThirdPartySection.test.tsx apps/web/src/pages/admin/PeriodsSection.tsx
git commit -m "feat(web): seletor de setor em Lendas, Terceirizados e Períodos"
```

---

## Verificação final

- [ ] Run: `pnpm db:up && pnpm test` (suíte completa: api + web + shared)
Expected: tudo verde.
- [ ] Run: `pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit && pnpm --filter @legends/shared exec tsc --noEmit`
Expected: sem erros (lembrete do repo: `pnpm build`/Vitest não fazem typecheck completo sozinhos).

---

## Task 11: Escopar por setor as superfícies de leitura restantes (Lendas, Destaques, notificações de período, pool de candidatos da votação)

**Contexto (por que esta task existe):** a revisão final de todo o branch (depois das Tasks 1-10, todas já aprovadas) encontrou que o *design spec* desta feature afirmava que "/votar e /destaques já herdam o escopo por setor via API", mas nenhuma task efetivamente implementou esse filtro em 4 superfícies de leitura: o pool de candidatos da votação (`GET /users`, consumido por `VotePage`), a galeria de Lendas (`GET /users/showcase`), o feed de Destaques (`GET /highlights`) e as notificações de abertura/fechamento de período (`notifyPeriodOpened`/`notifyPeriodClosed`, que hoje avisam TODOS os usuários ativos, não só os do setor do período). Sem regressão hoje (só existe o setor default), mas quebra a segmentação prometida assim que um segundo setor existir de verdade.

**Decisão de escopo tomada aqui:** `GET /users` em si (usado também pelo Time, pelo escritório — `PeopleList` — e por menções/retro) **não** é filtrado por setor — ele continua uma lista global, porque o escritório é uma funcionalidade conjunta (ver design spec) e filtrar `/users` quebraria a lista de pessoas do escritório compartilhado. Em vez disso, o pool de candidatos da votação é filtrado **no frontend**, comparando `u.sectorId` com o `sectorId` do período de votação atual (`useCurrentPeriod()`, que já é resolvido pelo setor do usuário logado no backend) — evita tocar em `/users` e evita depender de `useAuth()` dentro de `VotePage` (que exigiria envolver o teste existente em `AuthProvider`, ampliando bastante o escopo do teste sem necessidade).

**Files:**
- Modify: `apps/api/src/services/profile-service.ts` (`listShowcase` ganha `sectorId?: string`)
- Modify: `apps/api/src/routes/users.ts` (`GET /users/showcase` passa `request.user.sectorId`)
- Modify: `apps/api/src/services/profile-service.test.ts` (novo teste)
- Modify: `apps/api/src/routes/users.test.ts` (novo teste)
- Modify: `apps/api/src/services/highlight-service.ts` (`listPublishedHighlights` ganha `sectorId?: string`)
- Modify: `apps/api/src/routes/highlights.ts` (`GET /highlights` passa `request.user.sectorId`)
- Modify: `apps/api/src/services/highlight-service.orchestration.test.ts` (ajusta a chamada existente)
- Modify: `apps/api/src/routes/highlights.test.ts` (novo teste)
- Modify: `apps/api/src/services/notification-service.ts` (`broadcastToActive`/`notifyPeriodOpened`/`notifyPeriodClosed` ganham `sectorId`)
- Modify: `apps/api/src/services/notification-service.test.ts` (ajusta 3 chamadas existentes + novo teste)
- Modify: `apps/api/src/routes/admin.ts` (passa `period.sectorId` para `notifyPeriodOpened`/`notifyPeriodClosed`)
- Modify: `apps/web/src/pages/VotePage.tsx` (`votableUsers` filtra também por `sectorId`)
- Modify: `apps/web/src/pages/VotePage.test.tsx` (ajusta fixtures + novo teste)

**Interfaces:**
- Consumes: `request.user.sectorId` (já existe desde a Task 7); `VotingPeriodDTO.sectorId` (já existe desde a Task 6); `createSector` (`../services/sector-service`, para os testes que precisam de um segundo setor).
- Produces: `listShowcase(opts: { former?: boolean; sectorId?: string })`, `listPublishedHighlights(sectorId?: string)`, `broadcastToActive(type, title, link, sectorId?)`, `notifyPeriodOpened(period: { monthRef: string; sectorId: string })`, `notifyPeriodClosed(period: { monthRef: string; sectorId: string })`.

- [ ] **Step 1: Escrever os testes de `profile-service.test.ts` e `users.test.ts` (falhando)**

Adicionar a `apps/api/src/services/profile-service.test.ts`, dentro do `describe('profile service', ...)`:

```ts
  it('listShowcase filtra por sectorId quando informado', async () => {
    const sectorA = await createSector({ name: 'Setor Showcase A', enabledFeatures: [], roles: [] })
    const sectorB = await createSector({ name: 'Setor Showcase B', enabledFeatures: [], roles: [] })
    counter += 1
    const devA = await prisma.user.create({ data: { name: 'Dev A', email: `deva-${counter}@empresa.com`, passwordHash: 'x', sectorId: sectorA.id } })
    counter += 1
    const devB = await prisma.user.create({ data: { name: 'Dev B', email: `devb-${counter}@empresa.com`, passwordHash: 'x', sectorId: sectorB.id } })

    const rowsA = await listShowcase({ sectorId: sectorA.id })
    expect(rowsA.map((r) => r.user.id)).toContain(devA.id)
    expect(rowsA.map((r) => r.user.id)).not.toContain(devB.id)

    const all = await listShowcase()
    expect(all.map((r) => r.user.id)).toContain(devA.id)
    expect(all.map((r) => r.user.id)).toContain(devB.id)
  })
```

No topo do arquivo, adicionar o import: `import { createSector } from './sector-service'` (junto aos demais imports já existentes, sem duplicar).

Adicionar a `apps/api/src/routes/users.test.ts`, dentro do `describe('GET /users/showcase', ...)`:

```ts
  it('mostra só a galeria do próprio setor do usuário logado', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'viewer@empresa.com')
    const sectorB = await createSector({ name: 'Setor Showcase B (rota)', enabledFeatures: [], roles: [] })
    await prisma.user.create({ data: { name: 'De Outro Setor', email: 'outro-setor@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })

    const res = await app.inject({ method: 'GET', url: '/users/showcase', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const entries = res.json().entries as Array<{ user: { name: string } }>
    expect(entries.map((e) => e.user.name)).not.toContain('De Outro Setor')
    await app.close()
  })
```

No topo do arquivo, adicionar `import { createSector } from '../services/sector-service'` (verifique se `registerAndToken` já existe no arquivo — é o helper usado pelos testes vizinhos; reaproveite-o, não recrie).

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/profile-service.test.ts src/routes/users.test.ts`
Expected: FAIL (2 novos testes falham — `listShowcase`/rota ainda não filtram por setor)

- [ ] **Step 3: Editar `apps/api/src/services/profile-service.ts`**

Trocar a assinatura e o `where` de `listShowcase`:

```ts
export async function listShowcase(opts: { former?: boolean; sectorId?: string } = {}): Promise<ShowcaseRow[]> {
  // Avalia selos de tempo de casa de todos antes de montar a galeria, para não depender
  // de visita a perfil. Best-effort: falha aqui não derruba as Lendas (apenas loga).
  try {
    await evaluateTenureBadgesForAllUsers()
  } catch (err) {
    console.error('Falha ao avaliar selos de tempo de casa para a galeria', err)
  }

  const [users, voteCounts, userBadges] = await Promise.all([
    prisma.user.findMany({
      where: {
        ...(opts.former ? { leftAt: { not: null } } : { active: true }),
        ...(opts.sectorId ? { sectorId: opts.sectorId } : {}),
      },
    }),
    prisma.vote.groupBy({ by: ['votedId'], where: publishedVoteWhere, _count: { _all: true } }),
    prisma.userBadge.findMany({ include: { badge: true, awardedBy: true }, orderBy: [{ featured: 'desc' }, { awardedAt: 'desc' }] }),
  ])
```

(o restante da função não muda — `voteCounts`/`userBadges` continuam sem filtro de setor, mas como o array final de `rows` é construído a partir de `users` já filtrado, nenhum dado de outro setor vaza no resultado.)

- [ ] **Step 4: Editar `apps/api/src/routes/users.ts`**

```ts
    const rows = await listShowcase({
      former: former === '1' || former === 'true',
      sectorId: request.user.sectorId,
    })
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/services/profile-service.test.ts src/routes/users.test.ts`
Expected: PASS (todos os testes, incluindo os 2 novos)

- [ ] **Step 6: Escrever o teste de `highlights.test.ts` (falhando) e ajustar `highlight-service.orchestration.test.ts`**

Adicionar a `apps/api/src/routes/highlights.test.ts`, dentro do `describe('GET /highlights', ...)`:

```ts
  it('mostra só os destaques do próprio setor do usuário logado', async () => {
    const app = buildApp(); await app.ready()
    const token = await devToken(app)
    const sectorB = await createSector({ name: 'Setor Destaques B', enabledFeatures: [], roles: [] })
    const bruno = await prisma.user.create({ data: { name: 'Bruno', email: 'bruno-destaque@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })
    await prisma.votingPeriod.create({
      data: { monthRef: '2026-08', startsAt: new Date('2026-08-01'), endsAt: new Date('2026-08-31'), status: 'CLOSED',
        sectorId: sectorB.id, winnerId: bruno.id, winnerVotes: 3, highlightText: 'oi', highlightImagePath: '/highlights/2026-08.png', highlightStatus: 'PUBLISHED' },
    })

    const res = await app.inject({ method: 'GET', url: '/highlights', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const list = res.json().highlights as Array<{ monthRef: string }>
    expect(list.map((h) => h.monthRef)).not.toContain('2026-08')
    await app.close()
  })
```

No topo do arquivo, adicionar `import { createSector } from '../services/sector-service'`.

Em `apps/api/src/services/highlight-service.orchestration.test.ts`, trocar a linha `const list = await listPublishedHighlights()` (dentro do teste `'publishes and awards the HIGHLIGHT badge to the winner'`) por:

```ts
    const list = await listPublishedHighlights(period.sectorId)
```

- [ ] **Step 7: Rodar e confirmar falha do novo teste de rota**

Run: `pnpm --filter @legends/api exec vitest run src/routes/highlights.test.ts src/services/highlight-service.orchestration.test.ts`
Expected: FAIL (o novo teste de `highlights.test.ts` falha; `orchestration.test.ts` deve compilar mas pode falhar até o Step 8)

- [ ] **Step 8: Editar `apps/api/src/services/highlight-service.ts`**

```ts
export async function listPublishedHighlights(sectorId?: string): Promise<PublishedHighlight[]> {
  const periods = await prisma.votingPeriod.findMany({
    where: { highlightStatus: 'PUBLISHED', ...(sectorId ? { sectorId } : {}) },
    include: { winner: true },
    orderBy: { monthRef: 'desc' },
  })
  return periods.map((p) => ({ period: p, winner: p.winner }))
}
```

- [ ] **Step 9: Editar `apps/api/src/routes/highlights.ts`**

```ts
import type { FastifyInstance } from 'fastify'
import { listPublishedHighlights } from '../services/highlight-service'
import { toHighlightDTO } from '../lib/serialize'

export async function highlightRoutes(app: FastifyInstance) {
  app.get('/highlights', { onRequest: [app.authenticate, app.requireFeature('destaques')] }, async (request, reply) => {
    const entries = await listPublishedHighlights(request.user.sectorId)
    return reply.send({ highlights: entries.map(toHighlightDTO) })
  })
}
```

(`/admin/highlights`, em `admin.ts`, continua chamando `listPublishedHighlights()` sem argumento — o admin enxerga os destaques de todos os setores, de propósito; não altere essa rota.)

- [ ] **Step 10: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/routes/highlights.test.ts src/services/highlight-service.orchestration.test.ts src/services/highlight-service.test.ts`
Expected: PASS (todos)

- [ ] **Step 11: Ajustar as 3 chamadas existentes em `notification-service.test.ts` e escrever o novo teste (falhando)**

Nas 3 chamadas já existentes `await notifyPeriodOpened({ monthRef: '2026-06' })` (linhas ~103, ~171, ~224 — confira o texto exato antes de editar), trocar por:

```ts
await notifyPeriodOpened({ monthRef: '2026-06', sectorId: DEFAULT_SECTOR_ID })
```

Adicionar o import `import { DEFAULT_SECTOR_ID } from '@legends/shared'` no topo do arquivo.

Adicionar um novo teste, no `describe('notification-service write path', ...)`:

```ts
  it('notifyPeriodOpened avisa só os usuários do setor do período', async () => {
    const sectorB = await createSector({ name: 'Setor Notificação B', enabledFeatures: [], roles: [] })
    counter += 1
    const userDefault = await prisma.user.create({ data: { name: 'Do Setor Default', email: `default-${counter}@empresa.com`, passwordHash: 'x', active: true } })
    counter += 1
    const userSectorB = await prisma.user.create({ data: { name: 'Do Setor B', email: `setorb-${counter}@empresa.com`, passwordHash: 'x', active: true, sectorId: sectorB.id } })

    await notifyPeriodOpened({ monthRef: '2026-09', sectorId: sectorB.id })

    expect(await prisma.notification.count({ where: { userId: userSectorB.id, type: 'PERIOD_OPENED' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: userDefault.id, type: 'PERIOD_OPENED' } })).toBe(0)
  })
```

Ajuste o helper `counter`/criação de usuário para o padrão já existente no arquivo (confira o topo do arquivo antes de escrever — pode já haver um `counter` e um helper `mkUser`; reaproveite-os em vez de duplicar). Adicione `import { createSector } from './sector-service'` se ainda não existir no arquivo.

- [ ] **Step 12: Rodar e confirmar falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/notification-service.test.ts`
Expected: FAIL (as 3 chamadas ajustadas devem compilar mas o novo teste falha)

- [ ] **Step 13: Editar `apps/api/src/services/notification-service.ts`**

```ts
async function broadcastToActive(
  type: Prisma.NotificationCreateInput['type'],
  title: string,
  link: string | null = null,
  sectorId?: string,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { active: true, ...(sectorId ? { sectorId } : {}) },
    select: { id: true, teamsWebhookUrl: true },
  })
  const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  await prisma.$transaction([
    prisma.notification.createMany({ data: users.map((u) => ({ userId: u.id, type, title, link })) }),
    prisma.notification.deleteMany({ where: { userId: { in: users.map((u) => u.id) }, createdAt: { lt: cutoff } } }),
  ])
  const ctaUrl = absoluteUrl(link)
  for (const user of users) {
```

(a linha `for (const user of users) {` e tudo abaixo dela já existe — não duplique, só confirme que o restante do corpo da função permanece igual.)

```ts
export async function notifyPeriodOpened(period: { monthRef: string; sectorId: string }): Promise<void> {
  await broadcastToActive('PERIOD_OPENED', `A votação de ${monthLabel(period.monthRef)} está aberta!`, '/votar', period.sectorId)
}

export async function notifyPeriodClosed(period: { monthRef: string; sectorId: string }): Promise<void> {
  await broadcastToActive('PERIOD_CLOSED', `A votação de ${monthLabel(period.monthRef)} foi encerrada.`, null, period.sectorId)
}
```

- [ ] **Step 14: Editar as duas chamadas em `apps/api/src/routes/admin.ts`**

Trocar:

```ts
        await notifyPeriodOpened({ monthRef: period.monthRef })
```

por:

```ts
        await notifyPeriodOpened({ monthRef: period.monthRef, sectorId: period.sectorId })
```

E, no handler de fechamento:

```ts
        await notifyPeriodClosed({ monthRef: period.monthRef })
```

por:

```ts
        await notifyPeriodClosed({ monthRef: period.monthRef, sectorId: period.sectorId })
```

- [ ] **Step 15: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/services/notification-service.test.ts src/routes/admin.test.ts`
Expected: PASS (todos)

- [ ] **Step 16: Escrever o teste de `VotePage.test.tsx` (falhando) e ajustar as fixtures existentes**

No mock de `/periods/current` já existente em `setupFetch()`, adicionar `sectorId: 'sector-dev-produto'` ao objeto `period`. No mock de `/users`, adicionar `sectorId: 'sector-dev-produto'` ao objeto do Bruno Lima.

Adicionar um novo teste, no `describe('VotePage', ...)`:

```ts
  it('não lista como candidato alguém de outro setor', async () => {
    mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      if (path === '/users') {
        return Promise.resolve({
          users: [
            { id: 'u2', name: 'Bruno Lima', email: 'bruno@empresa.com', role: 'LEGEND', position: null, squad: null, photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z', sectorId: 'sector-dev-produto' },
            { id: 'u3', name: 'De Outro Setor', email: 'outro@empresa.com', role: 'LEGEND', position: null, squad: null, photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z', sectorId: 'sector-b' },
          ],
        })
      }
      if (path === '/categories') return Promise.resolve({ categories: [] })
      if (path === '/periods/current') {
        return Promise.resolve({
          period: { id: 'p1', sectorId: 'sector-dev-produto', monthRef: '2026-06', startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-06-30T23:59:59.000Z', status: 'OPEN' },
        })
      }
      if (path === '/votes/me') return Promise.resolve({ votes: [] })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    renderPage()
    expect(await screen.findByRole('radio', { name: /Bruno Lima/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /De Outro Setor/ })).not.toBeInTheDocument()
  })
```

- [ ] **Step 17: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/VotePage.test.tsx`
Expected: FAIL (o novo teste falha — hoje `votableUsers` mostraria os dois)

- [ ] **Step 18: Editar `apps/web/src/pages/VotePage.tsx`**

Trocar:

```tsx
  const votableUsers = useMemo(
    () => users.filter((u) => u.role === "LEGEND"),
    [users],
  );
```

por:

```tsx
  // Só colegas do MESMO setor do período atual são candidatos — o período já
  // vem escopado pelo setor do usuário logado (getCurrentOpenPeriod no backend).
  const votableUsers = useMemo(
    () => users.filter((u) => u.role === "LEGEND" && u.sectorId === period?.sectorId),
    [users, period?.sectorId],
  );
```

- [ ] **Step 19: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/VotePage.test.tsx`
Expected: PASS (todos, incluindo os pré-existentes e o novo)

- [ ] **Step 20: Rodar a suíte completa e o typecheck**

Run: `pnpm --filter @legends/api test && pnpm --filter @legends/web test && pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit`
Expected: tudo verde, zero erros de tipo.

- [ ] **Step 21: Commit**

```bash
git add apps/api/src/services/profile-service.ts apps/api/src/services/profile-service.test.ts apps/api/src/routes/users.ts apps/api/src/routes/users.test.ts apps/api/src/services/highlight-service.ts apps/api/src/routes/highlights.ts apps/api/src/routes/highlights.test.ts apps/api/src/services/highlight-service.orchestration.test.ts apps/api/src/services/notification-service.ts apps/api/src/services/notification-service.test.ts apps/api/src/routes/admin.ts apps/web/src/pages/VotePage.tsx apps/web/src/pages/VotePage.test.tsx
git commit -m "$(cat <<'EOF'
fix(sectorização): escopa por setor Lendas, Destaques, notificações de período e pool de votação

A revisão final do branch encontrou que o design spec prometia esse
escopo como "herdado automaticamente", mas nenhuma task do plano
original de fato filtrava essas 4 superfícies de leitura por setor.
Sem regressão hoje (só existe o setor default), mas quebraria a
segmentação assim que um segundo setor real existisse.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
