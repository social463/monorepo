# Desafios — CRUD de administração e vitrine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao Legends a peça que **propõe uma ação** — desafios criados pelo admin, com
recompensa em coins, e uma vitrine onde a pessoa vê e participa.

**Architecture:** Estende o model `Challenge` que já existe na base (vindo do PBI da fila
de submissões) com os campos de catálogo — categoria, imagem, ordem, flags de
visibilidade — e acrescenta as camadas que faltam: rotas de admin e de vitrine, auditoria
e as duas telas. Fluxo `route → service → Prisma`, contrato em `@legends/shared`.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Zod, React 18, React Query, Tailwind 3,
Vitest.

**Spec:** `docs/superpowers/specs/2026-08-01-admin-desafios-crud-design.md`

## Global Constraints

- TypeScript **strict**, ESM puro. Node ≥ 20 (o shell da máquina usa 18 por padrão —
  garanta Node 20 antes de rodar qualquer coisa).
- Mensagens ao usuário em **português**.
- Fluxo `route → service → Prisma`. Rota fina: `safeParse` → `400 { message, issues }`,
  chama o service, serializa com `lib/serialize.ts`. Regra de negócio **só** no service.
- Erro de domínio é classe tipada com `status`; a rota faz `instanceof`. A hierarquia
  `ChallengeError` já existe em `apps/api/src/services/challenge-service.ts`.
- Contrato primeiro: tipos/DTOs/constantes em `packages/shared/src/challenge.ts`,
  já exportado pelo barril `index.ts` (linha 10) — **não** criar export novo.
- Multi-empresa: toda leitura/escrita passa por `scopedPrisma(companyId)`
  (`apps/api/src/lib/tenant-scope.ts`). `Challenge` já está registrado lá.
- Migration nova via `pnpm db:migrate`. **Nunca** editar migration já aplicada —
  em especial `20260801150159_add_challenges`, que é da base.
- Toda mutação de admin grava auditoria com `recordAuditLog`
  (`services/audit-log-service.ts`), **na mesma transação**.
- Testes Vitest **ao lado** do arquivo.

### Banco nesta máquina — leia antes de rodar teste de API

Este worktree tem **container próprio**, já no ar: `legends-db-porgy`, porta **5462**.
Todo comando de teste da API leva o prefixo:

```bash
LEGENDS_DB_PORT=5462 pnpm --filter @legends/api exec vitest run <arquivo>
```

`apps/api/.env` já existe e aponta o `DATABASE_URL` para a 5462, então `pnpm db:migrate`
e `pnpm db:generate` funcionam sem prefixo nenhum.

**Não use 5432, 5442 nem 5452.** Nesta máquina 5432 é o `legends-db` do compose
(compartilhado por todos os worktrees), 5442 é o `legends-db-sandlance` e 5452 é o
`legends-db-walrus` — todos de **outros worktrees**. Apontar para lá lê e trunca banco
alheio e produz falhas fantasma nos dois lados. **Não rode `pnpm db:up` aqui**: ele sobe
o container compartilhado, que não é o desta branch.

Se der erro de conexão, confirme **posse** da porta antes de qualquer outra hipótese —
`nc -z` só prova que alguém responde, não que é o seu container:

```bash
docker port legends-db-porgy    # tem que imprimir 5432/tcp -> 0.0.0.0:5462
```

Durante a implementação rode **só o arquivo de teste do que mudou**. A suíte completa é
lenta e fica para a verificação final.

---

## File Structure

| Arquivo | Responsabilidade | Ação |
| --- | --- | --- |
| `apps/api/prisma/schema.prisma` | model `Challenge` | modificar |
| `apps/api/prisma/migrations/<ts>_challenge_catalog_fields/migration.sql` | rename + colunas | criar |
| `packages/shared/src/challenge.ts` | categorias, DTO, requests | modificar |
| `packages/shared/src/challenge.test.ts` | teste do contrato | modificar |
| `packages/shared/src/third-party.ts` | feature key `desafios` | modificar |
| `apps/api/src/lib/serialize.ts` | `toChallengeDTO` | modificar |
| `apps/api/src/services/challenge-service.ts` | campos novos, reorder, auditoria, vitrine | modificar |
| `apps/api/src/services/challenge-service.test.ts` | testes de service | modificar |
| `apps/api/src/routes/admin-challenges.ts` | CRUD de admin | criar |
| `apps/api/src/routes/admin-challenges.test.ts` | testes de rota admin | criar |
| `apps/api/src/routes/challenges.ts` | vitrine | criar |
| `apps/api/src/routes/challenges.test.ts` | testes da vitrine | criar |
| `apps/api/src/app.ts` | registro das rotas | modificar |
| `apps/web/src/pages/admin/ChallengesSection.tsx` | lista + editor | criar |
| `apps/web/src/pages/ChallengesPage.tsx` | vitrine | criar |
| `apps/web/src/App.tsx` | rotas | modificar |
| `apps/web/src/pages/admin/AdminSidebar.tsx` | item de menu | modificar |

---

### Task 1: Campos de catálogo no `Challenge`

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `Challenge`)
- Create: `apps/api/prisma/migrations/<timestamp>_challenge_catalog_fields/migration.sql`
- Modify: `apps/api/src/services/challenge-service.ts` (usos de `active`)
- Test: `apps/api/src/services/challenge-service.test.ts`

**Interfaces:**
- Produces: coluna `isActive` (era `active`) e as colunas `category`,
  `detailsMarkdown`, `imageKey`, `position`, `requiresReview`, `isPrivate`,
  `isFeatured` em `Challenge`. Todas as tasks seguintes dependem disto.

- [ ] **Step 1: Alterar o model no schema**

Em `apps/api/prisma/schema.prisma`, no `model Challenge`, troque a linha do `active` e
acrescente os campos. O bloco fica assim:

```prisma
/// Desafio proposto pela empresa ou por um setor. A recompensa é por desafio —
/// não passa por CoinRule, que só sabe valor fixo por evento.
model Challenge {
  id          String    @id @default(cuid())
  title       String
  description String
  /// Coins creditados na aprovação. <= 0 não gera lançamento no extrato.
  rewardCoins Int
  /// Chave manual de publicação. Nome com `is` de propósito: booleano chamado
  /// `active`/`status` não diz no call site *ativo o quê*.
  isActive    Boolean   @default(true)
  /// Uma de CHALLENGE_CATEGORIES (@legends/shared). String e não enum do Prisma:
  /// categoria é catálogo de produto, não invariante do banco — incluir uma não
  /// deve custar migration. O default existe só para a migration desta coluna;
  /// a API sempre exige categoria explícita.
  category    String    @default("Engajamento")
  /// Corpo longo em Markdown, renderizado por components/Markdown.tsx.
  /// NUNCA HTML: nada de markup vindo do banco chega ao DOM.
  detailsMarkdown String?
  /// Chave do S3 da imagem de capa. Guarda-se a chave, nunca a URL.
  imageKey    String?
  /// Ordem na vitrine; menor primeiro.
  position    Int       @default(0)
  /// Participação precisa passar pela fila de moderação. Persistido e exposto
  /// aqui; quem consome é o PBI "Resultados de Desafios".
  requiresReview Boolean @default(true)
  /// Não listado: some da vitrine, mas o detalhe continua servindo para quem
  /// está no escopo, de modo que um link compartilhado funciona.
  isPrivate   Boolean   @default(false)
  isFeatured  Boolean   @default(false)
  /// Janela opcional; null dos dois lados = aberto enquanto `isActive`.
  startsAt    DateTime?
  endsAt      DateTime?
  /// null = desafio da empresa inteira (só ADMIN cria e modera).
  sectorId    String?
  companyId   String    @default("company-emr")
  createdById String
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  sector      Sector?               @relation(fields: [sectorId], references: [id])
  company     Company               @relation(fields: [companyId], references: [id])
  createdBy   User                  @relation("ChallengesCreated", fields: [createdById], references: [id])
  submissions ChallengeSubmission[]

  @@index([companyId, isActive, position])
  @@index([companyId, sectorId])
}
```

- [ ] **Step 2: Gerar a migration sem aplicar**

```bash
# (container próprio já no ar — não subir o compose)
pnpm --filter @legends/api exec prisma migrate dev \
  --name challenge_catalog_fields --create-only
```

(`pnpm db:migrate` é exatamente `pnpm --filter @legends/api exec prisma migrate dev`;
aqui só se acrescenta o `--create-only`.)

Se `pnpm exec` for interceptado e falhar, use o binário direto:
`apps/api/node_modules/.bin/prisma`.

- [ ] **Step 3: Reescrever o SQL gerado para renomear em vez de recriar**

O Prisma gera `DROP COLUMN "active"` + `ADD COLUMN "isActive"`, o que **apaga o dado**.
Substitua o conteúdo de `migration.sql` por:

```sql
-- Renomeia em vez de dropar: DROP+ADD perderia o estado de publicação dos desafios.
ALTER TABLE "Challenge" RENAME COLUMN "active" TO "isActive";

ALTER TABLE "Challenge" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'Engajamento';
ALTER TABLE "Challenge" ADD COLUMN "detailsMarkdown" TEXT;
ALTER TABLE "Challenge" ADD COLUMN "imageKey" TEXT;
ALTER TABLE "Challenge" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Challenge" ADD COLUMN "requiresReview" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Challenge" ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Challenge" ADD COLUMN "isFeatured" BOOLEAN NOT NULL DEFAULT false;

DROP INDEX "Challenge_companyId_active_idx";
CREATE INDEX "Challenge_companyId_isActive_position_idx"
  ON "Challenge"("companyId", "isActive", "position");
```

Editar este arquivo é legítimo: ele ainda **não foi aplicado** em lugar nenhum. A regra
de nunca editar vale para migration já aplicada — a `20260801150159_add_challenges`, que
não se toca.

- [ ] **Step 4: Aplicar e regenerar o client**

```bash
# (container próprio já no ar — não subir o compose)
pnpm db:migrate
pnpm db:generate
```

- [ ] **Step 5: Corrigir os usos de `active` no service**

Em `apps/api/src/services/challenge-service.ts` há quatro usos. Troque:

```ts
// listChallengesForAdmin — orderBy
orderBy: [{ isActive: 'desc' }, { position: 'asc' }, { createdAt: 'desc' }],
```

```ts
// UpdateChallengeInput
export interface UpdateChallengeInput {
  title?: string
  description?: string
  rewardCoins?: number
  isActive?: boolean
  startsAt?: Date | null
  endsAt?: Date | null
}
```

```ts
export function isChallengeOpen(
  challenge: { isActive: boolean; startsAt: Date | null; endsAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (!challenge.isActive) return false
  if (challenge.startsAt && now < challenge.startsAt) return false
  if (challenge.endsAt && now > challenge.endsAt) return false
  return true
}
```

```ts
// listMyChallenges — where
where: { ...visibleToUserWhere(user.sectorId), isActive: true },
```

- [ ] **Step 6: Corrigir os testes da base**

Em `apps/api/src/services/challenge-service.test.ts`, troque toda ocorrência de
`active:` por `isActive:` (tanto em `data` de criação quanto em asserções).

```bash
grep -n "active" apps/api/src/services/challenge-service.test.ts
```

- [ ] **Step 7: Rodar os testes do service**

```bash
LEGENDS_DB_PORT=5462 pnpm --filter @legends/api exec vitest run src/services/challenge-service.test.ts
```

Esperado: PASS. Se aparecer erro `P2022 column does not exist`, o `pnpm db:migrate` do
Step 4 não pegou — repita.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma apps/api/src/services/challenge-service.ts \
  apps/api/src/services/challenge-service.test.ts
git commit -m "feat(api): campos de catálogo no desafio e active -> isActive"
```

---

### Task 2: Contrato — categorias, DTO e feature key

**Files:**
- Modify: `packages/shared/src/challenge.ts`
- Test: `packages/shared/src/challenge.test.ts`
- Modify: `packages/shared/src/third-party.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `CHALLENGE_CATEGORIES: readonly ChallengeCategory[]`,
  `isChallengeCategory(v: string): v is ChallengeCategory`,
  `CHALLENGE_DETAILS_MAX_LENGTH: number`, `ChallengeDTO` (com os campos novos),
  `CreateChallengeRequest`, `UpdateChallengeRequest`, `ReorderChallengesRequest`,
  `ChallengeListResponse`. A feature key `'desafios'`.

- [ ] **Step 1: Escrever o teste que falha**

Em `packages/shared/src/challenge.test.ts`, acrescente:

```ts
import { describe, expect, it } from 'vitest'
import {
  CHALLENGE_CATEGORIES,
  isChallengeCategory,
  FEATURE_KEYS,
  FEATURE_LABELS,
} from './index'

describe('categorias de desafio', () => {
  it('as sete categorias canônicas em pt-BR, na ordem das abas', () => {
    expect(CHALLENGE_CATEGORIES).toEqual([
      'Cultura',
      'Bem-estar',
      'Inovação',
      'Sustentabilidade',
      'Conhecimento',
      'Engajamento',
      'Especial',
    ])
  })

  it('isChallengeCategory aceita canônica e recusa o resto', () => {
    expect(isChallengeCategory('Bem-estar')).toBe(true)
    expect(isChallengeCategory('bem-estar')).toBe(false)
    expect(isChallengeCategory('Qualquer')).toBe(false)
  })

  it('desafios é feature com rótulo', () => {
    expect(FEATURE_KEYS).toContain('desafios')
    expect(FEATURE_LABELS.desafios).toBe('Desafios')
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
pnpm --filter @legends/shared exec vitest run src/challenge.test.ts
```

Esperado: FAIL — `CHALLENGE_CATEGORIES is not exported`.

- [ ] **Step 3: Acrescentar as categorias e os tipos**

No topo de `packages/shared/src/challenge.ts`:

```ts
/**
 * Categorias canônicas de desafio, em pt-BR e na ordem em que aparecem nas abas.
 * Categoria fora desta lista é recusada com 400 pela rota de admin.
 */
export const CHALLENGE_CATEGORIES = [
  'Cultura',
  'Bem-estar',
  'Inovação',
  'Sustentabilidade',
  'Conhecimento',
  'Engajamento',
  'Especial',
] as const
export type ChallengeCategory = (typeof CHALLENGE_CATEGORIES)[number]

export function isChallengeCategory(value: string): value is ChallengeCategory {
  return (CHALLENGE_CATEGORIES as readonly string[]).includes(value)
}

/** Corpo em Markdown do detalhe. Mesma ordem de grandeza do manifesto de cultura. */
export const CHALLENGE_DETAILS_MAX_LENGTH = 20_000
```

- [ ] **Step 4: Estender o `ChallengeDTO`**

Substitua a interface `ChallengeDTO` existente por:

```ts
export interface ChallengeDTO {
  id: string
  title: string
  description: string
  category: ChallengeCategory
  /** Corpo longo em Markdown; o front renderiza com components/Markdown.tsx. */
  detailsMarkdown: string | null
  /** URL pública derivada da chave do S3; null quando não há capa. */
  imageUrl: string | null
  rewardCoins: number
  isActive: boolean
  position: number
  requiresReview: boolean
  isPrivate: boolean
  isFeatured: boolean
  startsAt: string | null
  endsAt: string | null
  /** null = desafio da empresa inteira. */
  sectorId: string | null
  sectorName: string | null
  submissionCount: number
}
```

- [ ] **Step 5: Acrescentar os requests**

```ts
export interface CreateChallengeRequest {
  title: string
  description: string
  category: ChallengeCategory
  detailsMarkdown?: string | null
  imageKey?: string | null
  rewardCoins: number
  isActive?: boolean
  position?: number
  requiresReview?: boolean
  isPrivate?: boolean
  isFeatured?: boolean
  startsAt?: string | null
  endsAt?: string | null
  sectorId?: string | null
}

export type UpdateChallengeRequest = Partial<CreateChallengeRequest>

/** Ordem nova, na sequência desejada. Ids fora do escopo do ator dão 403. */
export interface ReorderChallengesRequest {
  ids: string[]
}

export interface ChallengeListResponse {
  challenges: ChallengeDTO[]
}
```

- [ ] **Step 6: Acrescentar a feature key**

Em `packages/shared/src/third-party.ts`, acrescente `'desafios'` ao fim de
`FEATURE_KEYS` e o rótulo em `FEATURE_LABELS`:

```ts
export const FEATURE_KEYS = [
  // … as existentes, sem mexer
  'coins',
  'desafios',
] as const
```

```ts
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  // … as existentes, sem mexer
  coins: 'EMR Coins',
  desafios: 'Desafios',
}
```

- [ ] **Step 7: Rodar os testes do shared**

```bash
pnpm --filter @legends/shared exec vitest run src/challenge.test.ts src/sector.test.ts
```

Esperado: PASS. `sector.test.ts` entra porque valida que toda `FEATURE_KEYS` tem rótulo.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/challenge.ts packages/shared/src/challenge.test.ts \
  packages/shared/src/third-party.ts
git commit -m "feat(shared): categorias de desafio, DTO de catálogo e feature key"
```

---

### Task 3: `toChallengeDTO` no serialize

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`
- Test: `apps/api/src/lib/serialize.challenge.test.ts` (criar)

**Interfaces:**
- Consumes: `ChallengeDTO`, `ChallengeCategory` (Task 2); colunas do Task 1.
- Produces: `toChallengeDTO(challenge: ChallengeForDTO): ChallengeDTO`, onde
  `ChallengeForDTO` é a entidade com `sector` incluído e `_count.submissions` opcional.

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/api/src/lib/serialize.challenge.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toChallengeDTO } from './serialize'

const base = {
  id: 'c1',
  title: 'Semana do bem-estar',
  description: 'Mexa o corpo',
  category: 'Bem-estar',
  detailsMarkdown: '## Como participar',
  imageKey: null,
  rewardCoins: 50,
  isActive: true,
  position: 3,
  requiresReview: true,
  isPrivate: false,
  isFeatured: true,
  startsAt: null,
  endsAt: null,
  sectorId: null,
  companyId: 'company-emr',
  createdById: 'u1',
  createdAt: new Date('2026-08-01T12:00:00Z'),
  updatedAt: new Date('2026-08-01T12:00:00Z'),
  sector: null,
}

describe('toChallengeDTO', () => {
  it('mapeia os campos de catálogo e resolve o nome do setor', () => {
    const dto = toChallengeDTO({
      ...base,
      sector: { id: 's1', name: 'Gente e Gestão' },
      sectorId: 's1',
    })
    expect(dto.category).toBe('Bem-estar')
    expect(dto.position).toBe(3)
    expect(dto.isFeatured).toBe(true)
    expect(dto.sectorName).toBe('Gente e Gestão')
  })

  it('sem imageKey a URL é null — nunca a chave crua', () => {
    const dto = toChallengeDTO(base)
    expect(dto.imageUrl).toBeNull()
    expect(JSON.stringify(dto)).not.toContain('imageKey')
  })

  it('submissionCount cai para zero quando o _count não vem no include', () => {
    expect(toChallengeDTO(base).submissionCount).toBe(0)
    expect(toChallengeDTO({ ...base, _count: { submissions: 7 } }).submissionCount).toBe(7)
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
LEGENDS_DB_PORT=5462 pnpm --filter @legends/api exec vitest run src/lib/serialize.challenge.test.ts
```

Esperado: FAIL — `toChallengeDTO is not exported`.

- [ ] **Step 3: Implementar**

Ao fim de `apps/api/src/lib/serialize.ts`:

```ts
import type { Challenge } from '@prisma/client'
import type { ChallengeCategory, ChallengeDTO } from '@legends/shared'
import { publicUrlFor, s3Config } from './s3-client'

export type ChallengeForDTO = Challenge & {
  sector: { id: string; name: string } | null
  _count?: { submissions: number }
}

export function toChallengeDTO(challenge: ChallengeForDTO): ChallengeDTO {
  const cfg = s3Config()
  return {
    id: challenge.id,
    title: challenge.title,
    description: challenge.description,
    category: challenge.category as ChallengeCategory,
    detailsMarkdown: challenge.detailsMarkdown,
    // A chave nunca sai daqui: o DTO expõe só a URL derivada.
    imageUrl: challenge.imageKey && cfg ? publicUrlFor(challenge.imageKey, cfg) : null,
    rewardCoins: challenge.rewardCoins,
    isActive: challenge.isActive,
    position: challenge.position,
    requiresReview: challenge.requiresReview,
    isPrivate: challenge.isPrivate,
    isFeatured: challenge.isFeatured,
    startsAt: challenge.startsAt?.toISOString() ?? null,
    endsAt: challenge.endsAt?.toISOString() ?? null,
    sectorId: challenge.sectorId,
    sectorName: challenge.sector?.name ?? null,
    submissionCount: challenge._count?.submissions ?? 0,
  }
}
```

Se `serialize.ts` já importa de `@prisma/client` ou `@legends/shared`, junte os imports
aos existentes em vez de duplicar.

- [ ] **Step 4: Rodar para ver passar**

```bash
LEGENDS_DB_PORT=5462 pnpm --filter @legends/api exec vitest run src/lib/serialize.challenge.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/lib/serialize.challenge.test.ts
git commit -m "feat(api): toChallengeDTO com URL derivada da chave da capa"
```

---

### Task 4: Service — campos novos na escrita e auditoria

**Files:**
- Modify: `apps/api/src/services/challenge-service.ts`
- Test: `apps/api/src/services/challenge-service.test.ts`

**Interfaces:**
- Consumes: colunas do Task 1; `ChallengeCategory`, `isChallengeCategory` (Task 2).
- Produces: `CreateChallengeInput` e `UpdateChallengeInput` estendidos;
  `createChallenge` e `updateChallenge` gravando auditoria;
  `ChallengeInvalidCategoryError` (status 400);
  `challengeAdminInclude` (com `sector` e `_count.submissions`).

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/api/src/services/challenge-service.test.ts`, acrescente. Reaproveite os helpers
`actor`/`adminActor` que já existem no arquivo.

```ts
import { prisma } from '../lib/prisma'

it('cria desafio com os campos de catálogo', async () => {
  const created = await createChallenge(adminActor(admin.id), {
    title: 'Semana do bem-estar',
    description: 'Mexa o corpo',
    category: 'Bem-estar',
    detailsMarkdown: '## Como participar\n\n- Caminhe 30 min',
    imageKey: 'images/capa.png',
    rewardCoins: 50,
    position: 2,
    isFeatured: true,
    requiresReview: false,
    sectorId: null,
  })

  expect(created.category).toBe('Bem-estar')
  expect(created.position).toBe(2)
  expect(created.isFeatured).toBe(true)
  expect(created.requiresReview).toBe(false)
  expect(created.imageKey).toBe('images/capa.png')
})

it('categoria fora da lista canônica é recusada com 400', async () => {
  await expect(
    createChallenge(adminActor(admin.id), {
      title: 'X',
      description: 'D',
      category: 'Fofoca' as never,
      rewardCoins: 10,
      sectorId: null,
    }),
  ).rejects.toMatchObject({ status: 400 })
})

it('criar grava auditoria com o desafio no after', async () => {
  const created = await createChallenge(adminActor(admin.id), {
    title: 'Auditado',
    description: 'D',
    category: 'Cultura',
    rewardCoins: 10,
    sectorId: null,
  })

  const log = await prisma.adminAuditLog.findFirst({
    where: { entityType: 'Challenge', entityId: created.id, action: 'CREATE' },
  })
  expect(log).not.toBeNull()
  expect(log?.actorId).toBe(admin.id)
})

it('editar grava auditoria com before e after', async () => {
  const created = await createChallenge(adminActor(admin.id), {
    title: 'Antes',
    description: 'D',
    category: 'Cultura',
    rewardCoins: 10,
    sectorId: null,
  })
  await updateChallenge(adminActor(admin.id), created.id, { title: 'Depois' })

  const log = await prisma.adminAuditLog.findFirst({
    where: { entityType: 'Challenge', entityId: created.id, action: 'UPDATE' },
  })
  expect(log).not.toBeNull()
  expect((log?.before as { title: string }).title).toBe('Antes')
  expect((log?.after as { title: string }).title).toBe('Depois')
})
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
LEGENDS_DB_PORT=5462 pnpm --filter @legends/api exec vitest run src/services/challenge-service.test.ts
```

Esperado: FAIL — `category` não existe em `CreateChallengeInput`.

- [ ] **Step 3: Estender os inputs e o erro de categoria**

Em `apps/api/src/services/challenge-service.ts`, junto das outras classes de erro:

```ts
export class ChallengeInvalidCategoryError extends ChallengeError {
  constructor() {
    super('Categoria inválida.', 400)
  }
}
```

Substitua `CreateChallengeInput` / `UpdateChallengeInput`:

```ts
export interface CreateChallengeInput {
  title: string
  description: string
  category: string
  detailsMarkdown?: string | null
  imageKey?: string | null
  rewardCoins: number
  isActive?: boolean
  position?: number
  requiresReview?: boolean
  isPrivate?: boolean
  isFeatured?: boolean
  startsAt?: Date | null
  endsAt?: Date | null
  sectorId: string | null
}

export type UpdateChallengeInput = Partial<Omit<CreateChallengeInput, 'sectorId'>> & {
  sectorId?: string | null
}
```

Acrescente o include de admin, com a contagem de participações:

```ts
export const challengeAdminInclude = {
  sector: { select: { id: true, name: true } },
  _count: { select: { submissions: true } },
} as const
```

- [ ] **Step 4: Reescrever `createChallenge` com transação e auditoria**

```ts
import { recordAuditLog } from './audit-log-service'
import { isChallengeCategory } from '@legends/shared'

function assertCategory(category: string): void {
  if (!isChallengeCategory(category)) throw new ChallengeInvalidCategoryError()
}

export async function createChallenge(actor: ChallengeActor, input: CreateChallengeInput) {
  assertCanManageChallenge(actor, input.sectorId)
  assertCategory(input.category)
  const db = scopedPrisma(actor.companyId)

  return db.$transaction(async (tx) => {
    const created = await tx.challenge.create({
      data: {
        title: input.title,
        description: input.description,
        category: input.category,
        detailsMarkdown: input.detailsMarkdown ?? null,
        imageKey: input.imageKey ?? null,
        rewardCoins: input.rewardCoins,
        isActive: input.isActive ?? true,
        position: input.position ?? 0,
        requiresReview: input.requiresReview ?? true,
        isPrivate: input.isPrivate ?? false,
        isFeatured: input.isFeatured ?? false,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        sectorId: input.sectorId,
        createdById: actor.id,
      },
      include: challengeAdminInclude,
    })
    // Cast igual ao de hr-dashboard-service: o tx da extensão de tenant não é um
    // Prisma.TransactionClient cru, mas o companyId vai explícito no recordAuditLog.
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'Challenge',
      entityId: created.id,
      action: 'CREATE',
      after: created,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return created
  })
}
```

- [ ] **Step 5: Reescrever `updateChallenge`**

Monte o `data` campo a campo — nada de `data: input`, que deixaria passar chave não
prevista do corpo da request.

```ts
export async function updateChallenge(
  actor: ChallengeActor,
  id: string,
  input: UpdateChallengeInput,
) {
  const db = scopedPrisma(actor.companyId)
  const before = await db.challenge.findFirst({ where: { id }, include: challengeAdminInclude })
  if (!before) throw new ChallengeNotFoundError()
  assertCanManageChallenge(actor, before.sectorId)
  if (input.category !== undefined) assertCategory(input.category)
  // Mover para outro setor exige poder sobre o destino também.
  if (input.sectorId !== undefined) assertCanManageChallenge(actor, input.sectorId)

  const data: Prisma.ChallengeUncheckedUpdateInput = {}
  if (input.title !== undefined) data.title = input.title
  if (input.description !== undefined) data.description = input.description
  if (input.category !== undefined) data.category = input.category
  if (input.detailsMarkdown !== undefined) data.detailsMarkdown = input.detailsMarkdown ?? null
  if (input.imageKey !== undefined) data.imageKey = input.imageKey ?? null
  if (input.rewardCoins !== undefined) data.rewardCoins = input.rewardCoins
  if (input.isActive !== undefined) data.isActive = input.isActive
  if (input.position !== undefined) data.position = input.position
  if (input.requiresReview !== undefined) data.requiresReview = input.requiresReview
  if (input.isPrivate !== undefined) data.isPrivate = input.isPrivate
  if (input.isFeatured !== undefined) data.isFeatured = input.isFeatured
  if (input.startsAt !== undefined) data.startsAt = input.startsAt ?? null
  if (input.endsAt !== undefined) data.endsAt = input.endsAt ?? null
  if (input.sectorId !== undefined) data.sectorId = input.sectorId

  return db.$transaction(async (tx) => {
    await tx.challenge.update({ where: { id }, data })
    const after = await tx.challenge.findUniqueOrThrow({
      where: { id },
      include: challengeAdminInclude,
    })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'Challenge',
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
```

- [ ] **Step 6: Auditar o delete**

Em `deleteChallenge`, depois da checagem de participações, troque o delete solto por:

```ts
  await scopedPrisma(actor.companyId).$transaction(async (tx) => {
    await tx.challenge.delete({ where: { id } })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'Challenge',
      entityId: id,
      action: 'DELETE',
      before: current,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
  })
```

Troque também o `include: challengeInclude` de `findChallengeOrThrow` por
`challengeAdminInclude`, para o `before` da auditoria sair completo.

- [ ] **Step 7: Rodar os testes**

```bash
LEGENDS_DB_PORT=5462 pnpm --filter @legends/api exec vitest run src/services/challenge-service.test.ts
```

Esperado: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/challenge-service.ts \
  apps/api/src/services/challenge-service.test.ts
git commit -m "feat(api): campos de catálogo e auditoria no CRUD de desafio"
```

---

### Task 5: Service — reordenação e visibilidade da vitrine

**Files:**
- Modify: `apps/api/src/services/challenge-service.ts`
- Test: `apps/api/src/services/challenge-service.test.ts`

**Interfaces:**
- Consumes: tudo do Task 4.
- Produces: `reorderChallenges(actor: ChallengeActor, ids: string[]): Promise<void>`;
  `listMyChallenges` filtrando `isPrivate` e ordenando por `position`;
  `getVisibleChallenge(user, id)` para o detalhe.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('desafio privado não aparece na vitrine', async () => {
  await createChallenge(adminActor(admin.id), {
    title: 'Público', description: 'D', category: 'Cultura',
    rewardCoins: 10, sectorId: null,
  })
  await createChallenge(adminActor(admin.id), {
    title: 'Privado', description: 'D', category: 'Cultura',
    rewardCoins: 10, isPrivate: true, sectorId: null,
  })

  const vitrine = await listMyChallenges(member)
  expect(vitrine.map((v) => v.challenge.title)).toEqual(['Público'])
})

it('desafio inativo não aparece na vitrine', async () => {
  await createChallenge(adminActor(admin.id), {
    title: 'Desligado', description: 'D', category: 'Cultura',
    rewardCoins: 10, isActive: false, sectorId: null,
  })

  expect(await listMyChallenges(member)).toEqual([])
})

it('privado continua acessível pelo detalhe para quem está no escopo', async () => {
  const privado = await createChallenge(adminActor(admin.id), {
    title: 'Privado', description: 'D', category: 'Cultura',
    rewardCoins: 10, isPrivate: true, sectorId: null,
  })

  const found = await getVisibleChallenge(member, privado.id)
  expect(found.title).toBe('Privado')
})

it('reordenar muda a ordem da vitrine', async () => {
  const a = await createChallenge(adminActor(admin.id), {
    title: 'A', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null,
  })
  const b = await createChallenge(adminActor(admin.id), {
    title: 'B', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null,
  })

  await reorderChallenges(adminActor(admin.id), [b.id, a.id])

  const vitrine = await listMyChallenges(member)
  expect(vitrine.map((v) => v.challenge.title)).toEqual(['B', 'A'])
})

it('SUBADMIN não reordena desafio de fora do setor', async () => {
  const alheio = await createChallenge(adminActor(admin.id), {
    title: 'Alheio', description: 'D', category: 'Cultura',
    rewardCoins: 10, sectorId: OTHER_SECTOR_ID,
  })

  await expect(reorderChallenges(actor, [alheio.id])).rejects.toMatchObject({ status: 403 })
})
```

`member` é o usuário comum já usado no arquivo — se não existir um helper, monte
`{ id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: 'company-emr' }`.

- [ ] **Step 2: Rodar para ver falhar**

```bash
LEGENDS_DB_PORT=5462 pnpm --filter @legends/api exec vitest run src/services/challenge-service.test.ts
```

Esperado: FAIL — `reorderChallenges is not exported`.

- [ ] **Step 3: Implementar `reorderChallenges`**

```ts
/**
 * Reordena numa transação: a vitrine nunca é lida com metade da ordem nova.
 * O índice no array vira `position`, então a ordem enviada é a ordem exibida.
 */
export async function reorderChallenges(actor: ChallengeActor, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = scopedPrisma(actor.companyId)

  const challenges = await db.challenge.findMany({ where: { id: { in: ids } } })
  if (challenges.length !== ids.length) throw new ChallengeNotFoundError()
  // Um id de fora do setor derruba a operação inteira — nada de reordenar metade.
  for (const challenge of challenges) assertCanManageChallenge(actor, challenge.sectorId)

  await db.$transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.challenge.update({ where: { id }, data: { position: index } })
    }
    // 'UPDATE' e não 'REORDER': AdminAuditAction é enum do Prisma com apenas
    // CREATE/UPDATE/DELETE. Inventar um valor aqui não compila e violaria o enum
    // no banco. A ordem nova vai no `after`.
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'Challenge',
      entityId: ids[0],
      action: 'UPDATE',
      after: { reorder: ids },
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
  })
}
```

- [ ] **Step 4: Filtrar privado e ordenar por `position` na vitrine**

Em `listMyChallenges`, troque o `findMany` dos desafios:

```ts
  const challenges = await db.challenge.findMany({
    where: { ...visibleToUserWhere(user.sectorId), isActive: true, isPrivate: false },
    include: challengeAdminInclude,
    orderBy: [{ isFeatured: 'desc' }, { position: 'asc' }, { createdAt: 'desc' }],
  })
```

- [ ] **Step 5: Implementar `getVisibleChallenge`**

```ts
/**
 * Detalhe de um desafio para a pessoa. `isPrivate` **não** filtra aqui: privado
 * significa não listado, e um link compartilhado precisa continuar abrindo para
 * quem está no escopo. Desafio de outro setor é tratado como inexistente.
 */
export async function getVisibleChallenge(
  user: { id: string; sectorId: string; companyId: string },
  id: string,
) {
  const challenge = await scopedPrisma(user.companyId).challenge.findFirst({
    where: { id, ...visibleToUserWhere(user.sectorId), isActive: true },
    include: challengeAdminInclude,
  })
  if (!challenge) throw new ChallengeNotFoundError()
  return challenge
}
```

- [ ] **Step 6: Rodar os testes**

```bash
LEGENDS_DB_PORT=5462 pnpm --filter @legends/api exec vitest run src/services/challenge-service.test.ts
```

Esperado: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/challenge-service.ts \
  apps/api/src/services/challenge-service.test.ts
git commit -m "feat(api): reordenação de desafios e visibilidade da vitrine"
```

---

### Task 6: Rotas de administração

**Files:**
- Create: `apps/api/src/routes/admin-challenges.ts`
- Test: `apps/api/src/routes/admin-challenges.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: service do Task 4/5; `toChallengeDTO` (Task 3); constantes do Task 2.
- Produces: `adminChallengeRoutes(app: FastifyInstance)` — `GET/POST /admin/challenges`,
  `PATCH/DELETE /admin/challenges/:id`, `POST /admin/challenges/reorder`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/api/src/routes/admin-challenges.test.ts`. Siga o padrão de
`apps/api/src/routes/hr-dashboards.test.ts` para montar o app e emitir token.

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { buildApp } from '../app'

describe('rotas de admin de desafios', () => {
  it('MEMBER recebe 403', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/challenges',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { title: 'X', description: 'D', category: 'Cultura', rewardCoins: 10 },
    })
    expect(res.statusCode).toBe(403)
  })

  it('categoria fora da lista canônica é 400', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/challenges',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: 'X', description: 'D', category: 'Fofoca', rewardCoins: 10 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('ADMIN cria e recebe 201 com o DTO', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/challenges',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        title: 'Semana do bem-estar',
        description: 'Mexa o corpo',
        category: 'Bem-estar',
        rewardCoins: 50,
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().challenge.category).toBe('Bem-estar')
    expect(res.json().challenge).not.toHaveProperty('imageKey')
  })

  it('SUBADMIN não cria desafio da empresa inteira', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/challenges',
      headers: { authorization: `Bearer ${subadminToken}` },
      payload: {
        title: 'X', description: 'D', category: 'Cultura',
        rewardCoins: 10, sectorId: null,
      },
    })
    expect(res.statusCode).toBe(403)
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
LEGENDS_DB_PORT=5462 pnpm --filter @legends/api exec vitest run src/routes/admin-challenges.test.ts
```

Esperado: FAIL — 404, a rota não existe.

- [ ] **Step 3: Implementar a rota**

Crie `apps/api/src/routes/admin-challenges.ts`:

```ts
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  CHALLENGE_CATEGORIES,
  CHALLENGE_DESCRIPTION_MAX_LENGTH,
  CHALLENGE_DETAILS_MAX_LENGTH,
  CHALLENGE_TITLE_MAX_LENGTH,
} from '@legends/shared'
import { toChallengeDTO } from '../lib/serialize'
import {
  ChallengeError,
  createChallenge,
  deleteChallenge,
  listChallengesForAdmin,
  reorderChallenges,
  updateChallenge,
  type ChallengeActor,
} from '../services/challenge-service'

const idParamsSchema = z.object({ id: z.string().min(1) })
const listQuerySchema = z.object({ sectorId: z.string().min(1).optional() })

const baseSchema = {
  title: z.string().trim().min(1).max(CHALLENGE_TITLE_MAX_LENGTH),
  description: z.string().trim().min(1).max(CHALLENGE_DESCRIPTION_MAX_LENGTH),
  // Enum vindo da const canônica: categoria fora da lista morre aqui, com 400.
  category: z.enum(CHALLENGE_CATEGORIES),
  detailsMarkdown: z.string().max(CHALLENGE_DETAILS_MAX_LENGTH).nullable().optional(),
  imageKey: z.string().min(1).nullable().optional(),
  rewardCoins: z.number().int().min(0),
  isActive: z.boolean().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  requiresReview: z.boolean().optional(),
  isPrivate: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  sectorId: z.string().min(1).nullable().optional(),
}
const createSchema = z.object(baseSchema)
const updateSchema = z.object(baseSchema).partial()
const reorderSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) })

function handleChallengeError(err: unknown, reply: FastifyReply) {
  if (err instanceof ChallengeError) return reply.code(err.status).send({ message: err.message })
  throw err
}

function actorFrom(request: {
  user: { sub: string; role: string; sectorId: string; companyId: string }
}): ChallengeActor {
  return {
    id: request.user.sub,
    role: request.user.role,
    sectorId: request.user.sectorId,
    companyId: request.user.companyId,
  }
}

export async function adminChallengeRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }

  app.get('/admin/challenges', guard, async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: query.error.issues })
    }
    const challenges = await listChallengesForAdmin(actorFrom(request), query.data)
    return reply.send({ challenges: challenges.map(toChallengeDTO) })
  })

  app.post('/admin/challenges', guard, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const created = await createChallenge(actorFrom(request), {
        ...parsed.data,
        sectorId: parsed.data.sectorId ?? null,
      })
      return reply.code(201).send({ challenge: toChallengeDTO(created) })
    } catch (err) {
      return handleChallengeError(err, reply)
    }
  })

  app.patch('/admin/challenges/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Requisição inválida.' })
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const updated = await updateChallenge(actorFrom(request), params.data.id, parsed.data)
      return reply.send({ challenge: toChallengeDTO(updated) })
    } catch (err) {
      return handleChallengeError(err, reply)
    }
  })

  app.post('/admin/challenges/reorder', guard, async (request, reply) => {
    const parsed = reorderSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      await reorderChallenges(actorFrom(request), parsed.data.ids)
      return reply.code(204).send()
    } catch (err) {
      return handleChallengeError(err, reply)
    }
  })

  app.delete('/admin/challenges/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Requisição inválida.' })
    try {
      await deleteChallenge(actorFrom(request), params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handleChallengeError(err, reply)
    }
  })
}
```

Cuidado com a ordem: `POST /admin/challenges/reorder` é declarada **antes** de qualquer
rota `/:id` com método POST. Como só há `PATCH`/`DELETE` em `/:id`, não há colisão — mas
não acrescente um `POST /admin/challenges/:id` depois sem revisar isso.

- [ ] **Step 4: Registrar no app**

Em `apps/api/src/app.ts`, ao lado dos outros imports de rota:

```ts
import { adminChallengeRoutes } from './routes/admin-challenges'
```

E junto dos `app.register(...)`:

```ts
app.register(adminChallengeRoutes)
```

- [ ] **Step 5: Rodar os testes**

```bash
LEGENDS_DB_PORT=5462 pnpm --filter @legends/api exec vitest run src/routes/admin-challenges.test.ts
```

Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin-challenges.ts \
  apps/api/src/routes/admin-challenges.test.ts apps/api/src/app.ts
git commit -m "feat(api): rotas de administração de desafios sob requireAdminOrSubadmin"
```

---

### Task 7: Rota da vitrine

**Files:**
- Create: `apps/api/src/routes/challenges.ts`
- Test: `apps/api/src/routes/challenges.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `listMyChallenges`, `getVisibleChallenge`, `createSubmission` (service);
  `toChallengeDTO` (Task 3).
- Produces: `challengeRoutes(app)` — `GET /challenges`, `GET /challenges/:id`,
  `POST /challenges/:id/participar`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('vitrine não lista inativo nem privado', async () => {
  const app = await buildApp()
  const res = await app.inject({
    method: 'GET',
    url: '/challenges',
    headers: { authorization: `Bearer ${memberToken}` },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().challenges.map((c: { title: string }) => c.title)).toEqual(['Público'])
})

it('markdown do detalhe volta como texto cru, sem HTML executável', async () => {
  const app = await buildApp()
  const res = await app.inject({
    method: 'GET',
    url: `/challenges/${comScript.id}`,
    headers: { authorization: `Bearer ${memberToken}` },
  })
  // A API guarda o texto como veio; quem neutraliza é o renderer, que nunca
  // injeta markup. O contrato aqui é só: nada de campo `detailsHtml`.
  expect(res.json().challenge).not.toHaveProperty('detailsHtml')
  expect(res.json().challenge.detailsMarkdown).toContain('<script>')
})

it('sem token é 401', async () => {
  const app = await buildApp()
  const res = await app.inject({ method: 'GET', url: '/challenges' })
  expect(res.statusCode).toBe(401)
})
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
LEGENDS_DB_PORT=5462 pnpm --filter @legends/api exec vitest run src/routes/challenges.test.ts
```

Esperado: FAIL — 404.

- [ ] **Step 3: Implementar a rota**

```ts
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { CHALLENGE_NOTE_MAX_LENGTH } from '@legends/shared'
import { toChallengeDTO } from '../lib/serialize'
import {
  ChallengeError,
  createSubmission,
  getVisibleChallenge,
  listMyChallenges,
} from '../services/challenge-service'

const idParamsSchema = z.object({ id: z.string().min(1) })
const participateSchema = z.object({
  note: z.string().trim().max(CHALLENGE_NOTE_MAX_LENGTH).optional(),
  evidenceKey: z.string().min(1).optional(),
})

function handleChallengeError(err: unknown, reply: FastifyReply) {
  if (err instanceof ChallengeError) return reply.code(err.status).send({ message: err.message })
  throw err
}

function userFrom(request: { user: { sub: string; sectorId: string; companyId: string } }) {
  return { id: request.user.sub, sectorId: request.user.sectorId, companyId: request.user.companyId }
}

export async function challengeRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate] }

  app.get('/challenges', guard, async (request, reply) => {
    const items = await listMyChallenges(userFrom(request))
    return reply.send({
      challenges: items.map((item) => toChallengeDTO(item.challenge)),
    })
  })

  app.get('/challenges/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Requisição inválida.' })
    try {
      const challenge = await getVisibleChallenge(userFrom(request), params.data.id)
      return reply.send({ challenge: toChallengeDTO(challenge) })
    } catch (err) {
      return handleChallengeError(err, reply)
    }
  })

  app.post('/challenges/:id/participar', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Requisição inválida.' })
    const parsed = participateSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      await createSubmission(userFrom(request), params.data.id, parsed.data)
      return reply.code(201).send({ ok: true })
    } catch (err) {
      return handleChallengeError(err, reply)
    }
  })
}
```

- [ ] **Step 4: Registrar no app**

```ts
import { challengeRoutes } from './routes/challenges'
```

```ts
app.register(challengeRoutes)
```

- [ ] **Step 5: Rodar os testes**

```bash
LEGENDS_DB_PORT=5462 pnpm --filter @legends/api exec vitest run src/routes/challenges.test.ts
```

Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/challenges.ts apps/api/src/routes/challenges.test.ts \
  apps/api/src/app.ts
git commit -m "feat(api): vitrine de desafios com detalhe e participação"
```

---

### Task 8: Web — seção de administração

**Files:**
- Create: `apps/web/src/pages/admin/ChallengesSection.tsx`
- Test: `apps/web/src/pages/admin/ChallengesSection.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/admin/AdminSidebar.tsx`

**Interfaces:**
- Consumes: `GET/POST /admin/challenges`, `PATCH/DELETE /admin/challenges/:id`,
  `POST /admin/challenges/reorder`; `ChallengeDTO`, `CHALLENGE_CATEGORIES`.
- Produces: `ChallengesSection` (export nomeado).

- [ ] **Step 1: Escrever o teste que falha**

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ChallengesSection } from './ChallengesSection'

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn(async () => ({
    challenges: [
      {
        id: 'c1', title: 'Semana do bem-estar', description: 'Mexa o corpo',
        category: 'Bem-estar', detailsMarkdown: null, imageUrl: null,
        rewardCoins: 50, isActive: true, position: 0, requiresReview: true,
        isPrivate: false, isFeatured: false, startsAt: null, endsAt: null,
        sectorId: null, sectorName: null, submissionCount: 0,
      },
    ],
  })),
}))

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ChallengesSection />
    </QueryClientProvider>,
  )
}

describe('ChallengesSection', () => {
  it('lista os desafios com categoria e recompensa', async () => {
    renderSection()
    expect(await screen.findByText('Semana do bem-estar')).toBeInTheDocument()
    expect(screen.getByText('Bem-estar')).toBeInTheDocument()
  })

  it('oferece todas as categorias canônicas no formulário', async () => {
    renderSection()
    await screen.findByText('Semana do bem-estar')
    expect(screen.getByRole('option', { name: 'Sustentabilidade' })).toBeInTheDocument()
  })
})
```

Se o teste precisar do `AuthContext` (para saber se é ADMIN), envolva com o mesmo
provider usado em `HrDashboardsSection.test.tsx`.

- [ ] **Step 2: Rodar para ver falhar**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/ChallengesSection.test.tsx
```

Esperado: FAIL — o módulo não existe.

- [ ] **Step 3: Implementar a seção**

Espelhe `apps/web/src/pages/admin/HrDashboardsSection.tsx` na estrutura. O esqueleto:

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CHALLENGE_CATEGORIES,
  type ChallengeDTO,
  type ChallengeListResponse,
  type CreateChallengeRequest,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../auth/AuthContext'
import { Panel, inputCls } from './shared'

interface FormState {
  title: string
  description: string
  category: string
  detailsMarkdown: string
  imageKey: string | null
  rewardCoins: number
  isActive: boolean
  requiresReview: boolean
  isPrivate: boolean
  isFeatured: boolean
}

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  category: 'Engajamento',
  detailsMarkdown: '',
  imageKey: null,
  rewardCoins: 0,
  isActive: true,
  requiresReview: true,
  isPrivate: false,
  isFeatured: false,
}

function toRequest(form: FormState): CreateChallengeRequest {
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    category: form.category as CreateChallengeRequest['category'],
    detailsMarkdown: form.detailsMarkdown.trim() === '' ? null : form.detailsMarkdown,
    imageKey: form.imageKey,
    rewardCoins: form.rewardCoins,
    isActive: form.isActive,
    requiresReview: form.requiresReview,
    isPrivate: form.isPrivate,
    isFeatured: form.isFeatured,
  }
}

export function ChallengesSection() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data } = useQuery({
    queryKey: ['admin', 'challenges'],
    queryFn: () => apiFetch<ChallengeListResponse>('/admin/challenges'),
  })
  const challenges = data?.challenges ?? []

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'challenges'] })

  const save = useMutation({
    mutationFn: async () => {
      const body = JSON.stringify(toRequest(form))
      if (editingId) {
        return apiFetch(`/admin/challenges/${editingId}`, { method: 'PATCH', body })
      }
      return apiFetch('/admin/challenges', { method: 'POST', body })
    },
    onSuccess: () => {
      setForm(EMPTY_FORM)
      setEditingId(null)
      setError(null)
      void invalidate()
    },
    onError: (err: Error) => setError(err.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/challenges/${id}`, { method: 'DELETE' }),
    onSuccess: () => void invalidate(),
    onError: (err: Error) => setError(err.message),
  })

  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch('/admin/challenges/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: () => void invalidate(),
  })

  /** Troca o desafio de lugar com o vizinho e manda a sequência inteira. */
  function move(index: number, delta: number) {
    const next = [...challenges]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    reorder.mutate(next.map((c) => c.id))
  }

  function startEdit(challenge: ChallengeDTO) {
    setEditingId(challenge.id)
    setForm({
      title: challenge.title,
      description: challenge.description,
      category: challenge.category,
      detailsMarkdown: challenge.detailsMarkdown ?? '',
      imageKey: null,
      rewardCoins: challenge.rewardCoins,
      isActive: challenge.isActive,
      requiresReview: challenge.requiresReview,
      isPrivate: challenge.isPrivate,
      isFeatured: challenge.isFeatured,
    })
  }

  return (
    <div className="flex flex-col gap-lg">
      <Panel title={editingId ? 'Editar desafio' : 'Novo desafio'}>
        {error && <p className="text-error">{error}</p>}

        <input
          className={inputCls}
          placeholder="Título"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />

        <select
          className={inputCls}
          aria-label="Categoria"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
        >
          {CHALLENGE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>

        <textarea
          className={inputCls}
          placeholder="Descrição curta"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />

        <textarea
          className={inputCls}
          placeholder="Detalhe (Markdown)"
          rows={8}
          value={form.detailsMarkdown}
          onChange={(e) => setForm({ ...form, detailsMarkdown: e.target.value })}
        />

        <input
          className={inputCls}
          type="number"
          min={0}
          aria-label="Recompensa em coins"
          value={form.rewardCoins}
          onChange={(e) => setForm({ ...form, rewardCoins: Number(e.target.value) })}
        />

        <label>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />{' '}
          Ativo
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.requiresReview}
            onChange={(e) => setForm({ ...form, requiresReview: e.target.checked })}
          />{' '}
          Exige moderação
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.isPrivate}
            onChange={(e) => setForm({ ...form, isPrivate: e.target.checked })}
          />{' '}
          Privado (não aparece na vitrine)
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.isFeatured}
            onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })}
          />{' '}
          Em destaque
        </label>

        <button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
          {editingId ? 'Salvar' : 'Criar desafio'}
        </button>
      </Panel>

      <Panel title="Desafios">
        <ul className="flex flex-col gap-sm">
          {challenges.map((challenge, index) => (
            <li key={challenge.id} className="flex items-center gap-sm">
              <div className="flex-1">
                <p className="font-semibold">{challenge.title}</p>
                <p className="text-body-sm">{challenge.category}</p>
                <p className="text-body-sm">
                  {challenge.rewardCoins} coins · {challenge.submissionCount} participações
                  {!challenge.isActive && ' · inativo'}
                  {challenge.isPrivate && ' · privado'}
                  {challenge.isFeatured && ' · em destaque'}
                </p>
              </div>
              <button type="button" aria-label="Subir" onClick={() => move(index, -1)}>
                ↑
              </button>
              <button type="button" aria-label="Descer" onClick={() => move(index, 1)}>
                ↓
              </button>
              <button type="button" onClick={() => startEdit(challenge)}>
                Editar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Excluir o desafio "${challenge.title}"?`)) {
                    remove.mutate(challenge.id)
                  }
                }}
              >
                Excluir
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
```

Notas de acabamento, a fazer dentro desta task:

- **Capa:** acrescente um `<input type="file">` que chama
  `POST /uploads/images/presign`, sobe o arquivo para a `uploadUrl` devolvida e guarda a
  **chave** (`key`) em `form.imageKey` — nunca a URL.
- **Setor:** só o ADMIN escolhe. Envolva o campo de setor em `{isAdmin && …}`; o backend
  já força o setor do SUBADMIN, então o SUBADMIN simplesmente não vê o campo.
- Classes de Tailwind: siga as da seção vizinha; as usadas acima são indicativas.

- [ ] **Step 4: Rodar para ver passar**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/ChallengesSection.test.tsx
```

Esperado: PASS.

- [ ] **Step 5: Ligar rota e menu**

Em `apps/web/src/App.tsx`, junto dos outros imports de seção:

```tsx
import { ChallengesSection } from './pages/admin/ChallengesSection'
```

E no bloco de rotas aninhadas sob `/admin`, ao lado de `<Route path="paineis" …>`:

```tsx
<Route path="desafios" element={<ChallengesSection />} />
```

Em `apps/web/src/pages/admin/AdminSidebar.tsx`, no mesmo grupo de *Moderação*:

```ts
{ to: '/admin/desafios', label: 'Desafios', featureKey: 'desafios' },
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/admin/ChallengesSection.tsx \
  apps/web/src/pages/admin/ChallengesSection.test.tsx \
  apps/web/src/App.tsx apps/web/src/pages/admin/AdminSidebar.tsx
git commit -m "feat(web): tela de administração de desafios"
```

---

### Task 9: Web — vitrine

**Files:**
- Create: `apps/web/src/pages/ChallengesPage.tsx`
- Test: `apps/web/src/pages/ChallengesPage.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `GET /challenges`, `GET /challenges/:id`,
  `POST /challenges/:id/participar`; `ChallengeDTO`; `Markdown` de
  `../components/Markdown`.
- Produces: `ChallengesPage` (export nomeado).

- [ ] **Step 1: Escrever o teste que falha**

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ChallengesPage } from './ChallengesPage'

const challenge = {
  id: 'c1', title: 'Semana do bem-estar', description: 'Mexa o corpo',
  category: 'Bem-estar',
  detailsMarkdown: '## Regras\n\n<script>window.__x = 1</script>',
  imageUrl: null, rewardCoins: 50, isActive: true, position: 0,
  requiresReview: true, isPrivate: false, isFeatured: false,
  startsAt: null, endsAt: null, sectorId: null, sectorName: null,
  submissionCount: 0,
}

vi.mock('../lib/api', () => ({ apiFetch: vi.fn(async () => ({ challenges: [challenge] })) }))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChallengesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ChallengesPage', () => {
  it('mostra o desafio com categoria e recompensa', async () => {
    renderPage()
    expect(await screen.findByText('Semana do bem-estar')).toBeInTheDocument()
    expect(screen.getByText('Bem-estar')).toBeInTheDocument()
  })

  it('script no detalhe vira texto, nunca elemento', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await screen.findByText('Semana do bem-estar')

    // Abrir o detalhe é o que torna esta asserção real: com o detalhe fechado
    // o markdown nem é renderizado e o teste passaria sem provar nada.
    await user.click(screen.getByRole('button', { name: 'Ver detalhe' }))
    expect(await screen.findByText('Regras')).toBeInTheDocument()

    // O renderer não injeta markup: não existe <script> no DOM, e a global
    // que o payload tentaria criar continua indefinida.
    expect(container.querySelector('script')).toBeNull()
    expect((window as unknown as { __x?: number }).__x).toBeUndefined()
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
pnpm --filter @legends/web exec vitest run src/pages/ChallengesPage.test.tsx
```

Esperado: FAIL — o módulo não existe.

- [ ] **Step 3: Implementar a vitrine**

A prop do componente é **`content`** (`Markdown({ content, className })`, definida em
`apps/web/src/components/Markdown.tsx:176`) — não `source`.

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChallengeDTO, ChallengeListResponse } from '@legends/shared'
import { apiFetch } from '../lib/api'
import { Markdown } from '../components/Markdown'

export function ChallengesPage() {
  const queryClient = useQueryClient()
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['challenges'],
    queryFn: () => apiFetch<ChallengeListResponse>('/challenges'),
  })
  const challenges = data?.challenges ?? []

  const participate = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/challenges/${id}/participar`, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['challenges'] }),
  })

  if (isLoading) return <p>Carregando desafios…</p>
  if (challenges.length === 0) return <p>Nenhum desafio disponível no momento.</p>

  return (
    <div className="flex flex-col gap-lg">
      <h1 className="text-title-lg">Desafios</h1>

      <ul className="grid gap-md sm:grid-cols-2">
        {challenges.map((challenge: ChallengeDTO) => (
          <li key={challenge.id} className="flex flex-col gap-sm rounded-lg p-md">
            {challenge.imageUrl && (
              <img
                src={challenge.imageUrl}
                alt=""
                className="max-w-full rounded-md object-cover"
              />
            )}

            <p className="text-body-sm">{challenge.category}</p>
            <h2 className="text-title-md">{challenge.title}</h2>
            {challenge.isFeatured && <span className="text-body-sm">Em destaque</span>}
            <p>{challenge.description}</p>
            <p className="text-body-sm">{challenge.rewardCoins} coins</p>

            {openId === challenge.id && challenge.detailsMarkdown && (
              // Markdown vira elementos React: markup vindo do banco nunca chega
              // ao DOM. Nada de dangerouslySetInnerHTML aqui, em hipótese alguma.
              <Markdown content={challenge.detailsMarkdown} />
            )}

            <div className="flex gap-sm">
              {challenge.detailsMarkdown && (
                <button
                  type="button"
                  onClick={() => setOpenId(openId === challenge.id ? null : challenge.id)}
                >
                  {openId === challenge.id ? 'Fechar' : 'Ver detalhe'}
                </button>
              )}
              <button
                type="button"
                onClick={() => participate.mutate(challenge.id)}
                disabled={participate.isPending}
              >
                Participar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

O botão *Ver detalhe* precisa ter esse nome acessível exato — o teste do Step 1 o
encontra por `getByRole('button', { name: 'Ver detalhe' })` e clica nele antes de
asseverar que nenhum `<script>` chegou ao DOM.

Classes de Tailwind: siga as das páginas vizinhas; as acima são indicativas.

- [ ] **Step 4: Rodar para ver passar**

```bash
pnpm --filter @legends/web exec vitest run src/pages/ChallengesPage.test.tsx
```

Esperado: PASS.

- [ ] **Step 5: Ligar a rota**

Em `apps/web/src/App.tsx`, junto das rotas autenticadas de topo (perto de
`<Route path="/mural-feedbacks" …>`):

```tsx
<Route path="/desafios" element={<ChallengesPage />} />
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ChallengesPage.tsx apps/web/src/pages/ChallengesPage.test.tsx \
  apps/web/src/App.tsx
git commit -m "feat(web): vitrine de desafios com detalhe em Markdown"
```

---

## Verificação final

Só depois da Task 9. O container próprio já isola esta branch, então não é preciso
esperar os outros worktrees pararem:

```bash
LEGENDS_DB_PORT=5462 pnpm test
```

Se aparecerem centenas de falhas sem relação com desafios, confirme primeiro a posse da
porta (`docker port legends-db-porgy`) antes de investigar o código: sem o `-p`, o vitest
cai no banco de outro worktree e as falhas não são suas.

## Cobertura dos critérios de aceite

| Critério | Task |
| --- | --- |
| Desafio e recompensa gravados atomicamente | 1 — `rewardCoins` é coluna do próprio desafio; não há segunda escrita que possa falhar (ver spec, D3) |
| Desafio inativo ou privado não aparece na vitrine | 5 |
| Reordenar altera a ordem da vitrine | 5 |
| Categoria fora da lista é recusada com 400 | 2 (const), 4 (service), 6 (rota) |
| `<script>` no detalhe nunca executa | 9 — renderizado por `Markdown.tsx`, que não injeta markup |
| Voucher vinculado a produto ativo | — fora de escopo: não existe loja no Legends (ver spec, D2) |
| Só admin/subadmin cria e edita; resto 403 | 6 |
| SUBADMIN restrito ao próprio setor | 4, 5 |
