# Mural da empresa: fixar, moderar e medir alcance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao mural corporativo post fixado (um por empresa), auditoria de moderação, registro de leitura por viewport e um painel de alcance por post.

**Architecture:** Segue o fluxo do repo — rota fina (Zod `safeParse` → 400) → service (regra + `CorporateMuralError` com `status`) → Prisma via `scopedPrisma(companyId)`. O contrato entra primeiro em `@legends/shared`. Fixar/desfixar reusa o evento `feed:changed` do hub que já existe; leitura não é broadcast.

**Tech Stack:** Fastify 4, Prisma 5 + PostgreSQL, Zod, Vitest, React 18 + React Query, Tailwind 3, TypeScript ESM strict.

**Spec:** `docs/superpowers/specs/2026-08-01-mural-fixar-moderar-alcance-design.md`

## Global Constraints

- **Sem recorte de setor.** `CorporatePost` não tem `sectorId`. Qualquer `SUBADMIN` e o `ADMIN` fixam, moderam e veem o alcance do mural inteiro. Guard: `[app.authenticate, app.requireAdminOrSubadmin]`.
- **Nunca use `$queryRaw`** para dado tenant-scoped — fura o isolamento do `scopedPrisma` (ver comentário em `apps/api/src/services/coin-admin-service.ts:238`). Agregação só com Prisma (`_count`, `count`, `groupBy`).
- **Nunca use `upsert` através do `scopedPrisma`** — lança `TenantScopeError` (`apps/api/src/lib/tenant-scope.ts:92`). Idempotência via `createMany({ skipDuplicates: true })`.
- **Todo model novo entra em `TENANT_SCOPED_MODELS`** (`apps/api/src/lib/tenant-scope.ts`) — o registro é manual e é o que garante o isolamento por empresa.
- **Nunca edite uma migration já aplicada.** Migration nova via `pnpm db:migrate`.
- **Base do `readPct`:** usuários `active: true` com `role` diferente de `THIRD_PARTY`.
- **Privacidade:** o painel expõe contagem. Nenhum DTO carrega nome de quem leu.
- **Textos ao usuário em português.**
- **Postgres já está de pé na porta padrão 5432** (container `legends-db`, subido pelo compose do worktree `~/Documents/Projects/EMR/Legends`). **Não** prefixe comando nenhum com `LEGENDS_DB_PORT` — essa variável só existe para quem tem outro Postgres ocupando a 5432, e apontá-la para 5442 faria todo teste da API falhar por conexão recusada. O Prisma Client já foi gerado neste worktree e as migrations estão aplicadas.
- **Rotas seguem o caminho já usado no repo:** `/corporate-posts/...` (sem prefixo `/corporate-mural`).

---

## Estrutura de arquivos

**Criados:**
- `apps/api/prisma/migrations/<timestamp>_corporate_post_pin_and_reads/migration.sql` (gerado)
- `apps/web/src/lib/use-corporate-post-read.ts` — hook de marcação de leitura por viewport
- `apps/web/src/lib/use-corporate-post-read.test.ts`
- `apps/web/src/pages/admin/CorporateMuralReachTab.tsx` — tabela de alcance
- `apps/web/src/pages/admin/CorporateMuralReachTab.test.tsx`
- `apps/web/src/pages/mural-corporativo/CorporatePostCard.test.tsx` — o card não tinha teste próprio, e o teste do feed o substitui por um stub
- `apps/api/src/services/corporate-mural-reach.test.ts` — testes do painel de alcance (arquivo próprio; `corporate-mural-service.test.ts` já tem 12 KB)

**Modificados:**
- `apps/api/prisma/schema.prisma` — `CorporatePost` (+`pinnedAt`, `pinnedById`, `pinnedBy`, `reads`, índice), `CorporatePostRead` (novo), back-relations em `User` e `Company`
- `apps/api/src/lib/tenant-scope.ts` — registrar `CorporatePostRead`
- `packages/shared/src/corporate-mural.ts` — `pinnedAt` no DTO, `CorporatePostReachDTO`, `canPinCorporatePost`
- `apps/api/src/lib/serialize.ts` — `pinnedAt` em `toCorporatePostDTO`
- `apps/api/src/services/corporate-mural-service.ts` — `pinPost`, `unpinPost`, `markPostRead`, `getPostReach`, `listFeed`, auditoria em `deletePost`/`deleteComment`
- `apps/api/src/services/corporate-mural-service.test.ts` — pin, leitura, feed, auditoria
- `apps/api/src/routes/corporate-mural.ts` — 4 rotas novas
- `apps/api/src/routes/corporate-mural.test.ts` — 403/204/404
- `apps/web/src/lib/use-corporate-mural.ts` — `usePinCorporatePost`, `useCorporateMuralReach`
- `apps/web/src/pages/mural-corporativo/CorporatePostCard.tsx` — selo "Fixado" + ação de fixar + ref de leitura
- `apps/web/src/pages/mural-corporativo/MuralCorporativoFeed.test.tsx` — só a fixture (`pinnedAt: null`, na Task 2)
- `apps/web/src/pages/admin/ModerationSection.tsx` — abas Votos | Mural
- `apps/web/src/pages/admin/ModerationSection.test.tsx` — troca de abas

---

### Task 1: Prisma — fixação e tabela de leitura

**Files:**
- Modify: `apps/api/prisma/schema.prisma:1139-1162` (model `CorporatePost`), `:171-176` (relations em `User`), `:429-434` (relations em `Company`)
- Modify: `apps/api/src/lib/tenant-scope.ts:31-36`

**Interfaces:**
- Consumes: nada.
- Produces: campos `CorporatePost.pinnedAt: Date | null`, `CorporatePost.pinnedById: string | null`; model `CorporatePostRead { id, postId, userId, companyId, readAt }` com `@@unique([postId, userId])`. Todas as tasks seguintes dependem disto.

- [ ] **Step 1: Adicionar os campos de fixação ao `CorporatePost`**

Em `apps/api/prisma/schema.prisma`, no model `CorporatePost`, depois de `companyId`:

```prisma
  pinnedAt    DateTime?
  pinnedById  String?
```

E, no bloco de relações do mesmo model (depois de `mentions`):

```prisma
  pinnedBy  User?                   @relation("CorporatePostsPinned", fields: [pinnedById], references: [id], onDelete: SetNull)
  reads     CorporatePostRead[]
```

E, junto dos `@@index` existentes:

```prisma
  @@index([companyId, pinnedAt])
```

- [ ] **Step 2: Criar o model `CorporatePostRead`**

Logo depois do model `CorporatePost` (antes de `model CorporatePostComment`):

```prisma
model CorporatePostRead {
  id        String   @id @default(cuid())
  postId    String
  userId    String
  companyId String   @default("company-emr")
  readAt    DateTime @default(now())

  post    CorporatePost @relation(fields: [postId], references: [id], onDelete: Cascade)
  user    User          @relation("CorporatePostReads", fields: [userId], references: [id], onDelete: Cascade)
  company Company       @relation(fields: [companyId], references: [id])

  @@unique([postId, userId])
  @@index([companyId, postId])
}
```

- [ ] **Step 3: Adicionar as back-relations em `User` e `Company`**

No model `User`, junto das outras relações `corporatePost*` (linha ~176):

```prisma
  corporatePostsPinned          CorporatePost[]                @relation("CorporatePostsPinned")
  corporatePostReads            CorporatePostRead[]            @relation("CorporatePostReads")
```

No model `Company`, junto das relações `corporatePost*` (linha ~434):

```prisma
  corporatePostReads            CorporatePostRead[]
```

- [ ] **Step 4: Registrar o model no isolamento por empresa**

Em `apps/api/src/lib/tenant-scope.ts`, dentro do `Set` `TENANT_SCOPED_MODELS`, logo depois de `'CorporatePostCommentMention',`:

```ts
  'CorporatePostRead',
```

Sem esta linha o model **não** ganha filtro por `companyId` e o teste de vazamento entre empresas (Task 6) falha.

- [ ] **Step 5: Gerar a migration e o client**

```bash
pnpm db:up
pnpm db:migrate --name corporate_post_pin_and_reads
pnpm db:generate
```

Esperado: uma migration nova em `apps/api/prisma/migrations/` com `ALTER TABLE "CorporatePost" ADD COLUMN "pinnedAt"`, `"pinnedById"` e `CREATE TABLE "CorporatePostRead"`.

- [ ] **Step 6: Verificar que o schema compila**

```bash
pnpm --filter @legends/api exec vitest run src/lib/tenant-scope.test.ts
```

Esperado: PASS (o arquivo já existe e não muda; serve como fumaça de que o client regenerado carrega).

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/lib/tenant-scope.ts
git commit -m "feat(mural): schema de post fixado e registro de leitura"
```

---

### Task 2: Contrato em `@legends/shared` + serialize

**Files:**
- Modify: `packages/shared/src/corporate-mural.ts`
- Create: `packages/shared/src/corporate-mural.test.ts`
- Modify: `apps/api/src/lib/serialize.ts:430-447` (`toCorporatePostDTO`)

**Interfaces:**
- Consumes: campos da Task 1.
- Produces:
  - `CorporatePostDTO.pinnedAt: string | null`
  - `canPinCorporatePost(role?: string | null): boolean`
  - `CORPORATE_POST_EXCERPT_LENGTH: 80`
  - `interface CorporatePostReachDTO { postId: string; excerpt: string; readers: number; readPct: number; comments: number; reactions: number; createdAt: string }`
  - `interface CorporatePostReachResponse { items: CorporatePostReachDTO[]; audience: number; total: number }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/shared/src/corporate-mural.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { canPinCorporatePost, CORPORATE_POST_EXCERPT_LENGTH } from './corporate-mural'

describe('canPinCorporatePost', () => {
  it.each(['ADMIN', 'SUBADMIN'])('deixa %s fixar', (role) => {
    expect(canPinCorporatePost(role)).toBe(true)
  })

  it.each(['HEAD', 'MANAGER', 'LEAD', 'LEGEND', 'THIRD_PARTY'])('bloqueia %s', (role) => {
    expect(canPinCorporatePost(role)).toBe(false)
  })

  it('trata papel ausente como sem permissão', () => {
    expect(canPinCorporatePost(null)).toBe(false)
    expect(canPinCorporatePost(undefined)).toBe(false)
  })

  it('expõe o tamanho do trecho do painel', () => {
    expect(CORPORATE_POST_EXCERPT_LENGTH).toBe(80)
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
pnpm --filter @legends/shared exec vitest run src/corporate-mural.test.ts
```

Esperado: FAIL — `canPinCorporatePost is not a function` / erro de import.

- [ ] **Step 3: Implementar o contrato**

Em `packages/shared/src/corporate-mural.ts`, depois de `canPublishCorporatePost`:

```ts
/**
 * Papéis que fixam post e veem o painel de alcance. O mural é da empresa
 * inteira e não tem `sectorId`, então não há recorte de setor: qualquer
 * subadmin age no mural todo, igual ao que a exclusão já faz. Fonte única — a
 * rota usa `requireAdminOrSubadmin` e a web esconde a ação com isto.
 */
export const CORPORATE_POST_PIN_ROLES = ['ADMIN', 'SUBADMIN'] as const

/** True quando o papel pode fixar/desfixar post e abrir o painel de alcance. */
export function canPinCorporatePost(role?: string | null): boolean {
  return role != null && (CORPORATE_POST_PIN_ROLES as readonly string[]).includes(role)
}

/** Tamanho do trecho do post exibido na tabela de alcance. */
export const CORPORATE_POST_EXCERPT_LENGTH = 80
```

No `CorporatePostDTO`, depois de `createdAt`:

```ts
  /** Instante em que o post foi fixado no topo, ou null. No máximo um por empresa. */
  pinnedAt: string | null
```

E, no fim do arquivo, antes do bloco `CorporateMuralEvent`:

```ts
/**
 * Alcance de um post no painel de G&G: só contagem, nunca a lista nominal de
 * quem leu. `readers` são leitores únicos (garantido pelo @@unique do model);
 * `reactions` é o total de reações, não de pessoas — é o mesmo número que o
 * card do mural exibe.
 */
export interface CorporatePostReachDTO {
  postId: string
  excerpt: string
  readers: number
  readPct: number
  comments: number
  reactions: number
  createdAt: string
}

export interface CorporatePostReachResponse {
  items: CorporatePostReachDTO[]
  /** Denominador do readPct: ativos da empresa, exceto terceirizados. */
  audience: number
  /** Total de posts no recorte, para a paginação. */
  total: number
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

```bash
pnpm --filter @legends/shared exec vitest run src/corporate-mural.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Preencher `pinnedAt` no serializer**

`pinnedAt` é obrigatório no DTO, então a API **não compila** até o serializer preencher. Em `apps/api/src/lib/serialize.ts`, na função `toCorporatePostDTO`, depois da linha `createdAt: post.createdAt.toISOString(),`:

```ts
    pinnedAt: post.pinnedAt ? post.pinnedAt.toISOString() : null,
```

- [ ] **Step 6: Corrigir a única fixture de `CorporatePostDTO` na web**

`pinnedAt` é obrigatório, então a fixture de `apps/web/src/pages/mural-corporativo/MuralCorporativoFeed.test.tsx`
(objeto do item em `feedPage`, linha ~81) para de tipar. Acrescentar depois de `createdAt`:

```ts
      pinnedAt: null,
```

É a **única** fixture de `CorporatePostDTO` na web — as de `pages/resenha/` são `ReviewDTO`
e não mudam. Sem este passo, o `tsc --noEmit` da Task 9 falha.

- [ ] **Step 7: Verificar que a API e a web voltam a compilar**

```bash
pnpm --filter @legends/api exec vitest run src/lib/serialize.test.ts
pnpm --filter @legends/web exec tsc --noEmit -p tsconfig.json
```

Esperado: PASS e typecheck sem erros.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/corporate-mural.ts packages/shared/src/corporate-mural.test.ts apps/api/src/lib/serialize.ts apps/web/src/pages/mural-corporativo/MuralCorporativoFeed.test.tsx
git commit -m "feat(mural): contrato de post fixado e de alcance"
```

---

### Task 3: Service — `pinPost` / `unpinPost`

**Files:**
- Modify: `apps/api/src/services/corporate-mural-service.ts`
- Modify: `apps/api/src/services/corporate-mural-service.test.ts`

**Interfaces:**
- Consumes: Task 1 (`pinnedAt`, `pinnedById`), `recordAuditLog` de `../services/audit-log-service`.
- Produces:
  - `pinPost(input: { postId: string; actorId: string; companyId: string }): Promise<CorporatePostWithRelations>`
  - `unpinPost(input: { postId: string; actorId: string; companyId: string }): Promise<CorporatePostWithRelations>`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao fim de `apps/api/src/services/corporate-mural-service.test.ts` (o arquivo já tem os helpers `makeUser` e `makeAdminActor` no topo):

```ts
describe('corporate-mural-service: fixar post', () => {
  it('fixa um post e registra quem fixou', async () => {
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: admin.id, content: 'aviso', companyId: DEFAULT_COMPANY_ID })

    const pinned = await pinPost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    expect(pinned.pinnedAt).toBeInstanceOf(Date)
    expect(pinned.pinnedById).toBe(admin.id)
  })

  it('fixar um segundo post desfixa o primeiro — nunca há dois fixados', async () => {
    const admin = await makeAdminActor()
    const primeiro = await createPost({ authorId: admin.id, content: 'aviso 1', companyId: DEFAULT_COMPANY_ID })
    const segundo = await createPost({ authorId: admin.id, content: 'aviso 2', companyId: DEFAULT_COMPANY_ID })

    await pinPost({ postId: primeiro.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    await pinPost({ postId: segundo.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const fixados = await prisma.corporatePost.findMany({ where: { pinnedAt: { not: null } } })
    expect(fixados.map((p) => p.id)).toEqual([segundo.id])
  })

  it('desfixa e grava auditoria; desfixar de novo é no-op sem log', async () => {
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: admin.id, content: 'aviso', companyId: DEFAULT_COMPANY_ID })
    await pinPost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const desfixado = await unpinPost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    expect(desfixado.pinnedAt).toBeNull()
    expect(desfixado.pinnedById).toBeNull()

    const logsDepoisDoPrimeiro = await prisma.adminAuditLog.count({ where: { entityId: post.id } })
    await unpinPost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    expect(await prisma.adminAuditLog.count({ where: { entityId: post.id } })).toBe(logsDepoisDoPrimeiro)
  })

  it('grava auditoria da fixação com entityType CorporatePost', async () => {
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: admin.id, content: 'aviso', companyId: DEFAULT_COMPANY_ID })

    await pinPost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const log = await prisma.adminAuditLog.findFirst({ where: { entityId: post.id } })
    expect(log).toMatchObject({ entityType: 'CorporatePost', action: 'UPDATE', actorId: admin.id })
  })

  it('404 em post inexistente', async () => {
    const admin = await makeAdminActor()
    await expect(
      pinPost({ postId: 'nao-existe', actorId: admin.id, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
```

E acrescentar `pinPost` e `unpinPost` ao `import { ... } from './corporate-mural-service'` no topo do arquivo.

- [ ] **Step 2: Rodar os testes e ver falhar**

```bash
pnpm --filter @legends/api exec vitest run src/services/corporate-mural-service.test.ts -t "fixar post"
```

Esperado: FAIL — `pinPost is not a function`.

- [ ] **Step 3: Implementar**

Em `apps/api/src/services/corporate-mural-service.ts`, adicionar ao import do topo:

```ts
import { recordAuditLog } from './audit-log-service'
```

E, depois de `deletePost`:

```ts
/**
 * Fixa um post no topo do mural. **No máximo um fixado por empresa**: a mesma
 * transação desfixa o anterior antes de marcar o novo. Guardamos o instante e
 * o autor (`pinnedAt`/`pinnedById`), não um booleano, porque o histórico
 * importa para auditoria.
 */
export async function pinPost(input: {
  postId: string
  actorId: string
  companyId: string
}): Promise<CorporatePostWithRelations> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.corporatePost.findUnique({
    where: { id: input.postId },
    select: { id: true, pinnedAt: true, pinnedById: true },
  })
  if (!existing) throw new CorporateMuralError('Publicação não encontrada.', 404)

  return db.$transaction(async (tx) => {
    await tx.corporatePost.updateMany({
      where: { pinnedAt: { not: null } },
      data: { pinnedAt: null, pinnedById: null },
    })
    const updated = await tx.corporatePost.update({
      where: { id: input.postId },
      data: { pinnedAt: new Date(), pinnedById: input.actorId },
      include: corporatePostInclude,
    })
    // `tx` é o client estendido por `scopedPrisma`; `recordAuditLog` põe o
    // companyId explícito no data, então o cast só reconcilia a assinatura.
    await recordAuditLog({
      actorId: input.actorId,
      entityType: 'CorporatePost',
      entityId: input.postId,
      action: 'UPDATE',
      before: { pinnedAt: existing.pinnedAt, pinnedById: existing.pinnedById },
      after: { pinnedAt: updated.pinnedAt, pinnedById: updated.pinnedById },
      companyId: input.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return updated
  })
}

/**
 * Desfixa o post. Idempotente: se já não estava fixado, devolve o post sem
 * gravar auditoria — não houve o que desfixar.
 */
export async function unpinPost(input: {
  postId: string
  actorId: string
  companyId: string
}): Promise<CorporatePostWithRelations> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.corporatePost.findUnique({
    where: { id: input.postId },
    select: { id: true, pinnedAt: true, pinnedById: true },
  })
  if (!existing) throw new CorporateMuralError('Publicação não encontrada.', 404)
  if (!existing.pinnedAt) {
    return db.corporatePost.findUniqueOrThrow({
      where: { id: input.postId },
      include: corporatePostInclude,
    })
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.corporatePost.update({
      where: { id: input.postId },
      data: { pinnedAt: null, pinnedById: null },
      include: corporatePostInclude,
    })
    await recordAuditLog({
      actorId: input.actorId,
      entityType: 'CorporatePost',
      entityId: input.postId,
      action: 'UPDATE',
      before: { pinnedAt: existing.pinnedAt, pinnedById: existing.pinnedById },
      after: { pinnedAt: null, pinnedById: null },
      companyId: input.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return updated
  })
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

```bash
pnpm --filter @legends/api exec vitest run src/services/corporate-mural-service.test.ts -t "fixar post"
```

Esperado: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/corporate-mural-service.ts apps/api/src/services/corporate-mural-service.test.ts
git commit -m "feat(mural): fixar e desfixar post com auditoria"
```

---

### Task 4: Service — `listFeed` com o fixado no topo

**Files:**
- Modify: `apps/api/src/services/corporate-mural-service.ts:164-189` (`listFeed`)
- Modify: `apps/api/src/services/corporate-mural-service.test.ts`

**Interfaces:**
- Consumes: `pinPost` (Task 3).
- Produces: `listFeed` mantém a assinatura `(companyId, { cursor?, limit }) => Promise<{ items, nextCursor }>`; muda só a ordem e a exclusão do fixado.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar a `apps/api/src/services/corporate-mural-service.test.ts`:

```ts
describe('corporate-mural-service: feed com post fixado', () => {
  it('põe o fixado no topo mesmo sendo o mais antigo', async () => {
    const admin = await makeAdminActor()
    const antigo = await createPost({ authorId: admin.id, content: 'antigo', companyId: DEFAULT_COMPANY_ID })
    await createPost({ authorId: admin.id, content: 'novo', companyId: DEFAULT_COMPANY_ID })
    await pinPost({ postId: antigo.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const { items } = await listFeed(DEFAULT_COMPANY_ID, { limit: 20 })

    expect(items[0].id).toBe(antigo.id)
    expect(items).toHaveLength(2)
  })

  it('não repete o fixado na página seguinte', async () => {
    const admin = await makeAdminActor()
    const primeiro = await createPost({ authorId: admin.id, content: 'p1', companyId: DEFAULT_COMPANY_ID })
    await createPost({ authorId: admin.id, content: 'p2', companyId: DEFAULT_COMPANY_ID })
    await createPost({ authorId: admin.id, content: 'p3', companyId: DEFAULT_COMPANY_ID })
    await pinPost({ postId: primeiro.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const page1 = await listFeed(DEFAULT_COMPANY_ID, { limit: 1 })
    const page2 = await listFeed(DEFAULT_COMPANY_ID, { limit: 1, cursor: page1.nextCursor! })

    // page1 = [fixado, p3]; o cursor sai do keyset (p3), não do fixado.
    expect(page1.items[0].id).toBe(primeiro.id)
    const idsPage2 = page2.items.map((p) => p.id)
    expect(idsPage2).not.toContain(primeiro.id)
    expect(idsPage2).toHaveLength(1)
  })

  it('sem fixado, o feed segue igual (mais novo primeiro)', async () => {
    const admin = await makeAdminActor()
    await createPost({ authorId: admin.id, content: 'a', companyId: DEFAULT_COMPANY_ID })
    const b = await createPost({ authorId: admin.id, content: 'b', companyId: DEFAULT_COMPANY_ID })

    const { items } = await listFeed(DEFAULT_COMPANY_ID, { limit: 20 })

    expect(items[0].id).toBe(b.id)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @legends/api exec vitest run src/services/corporate-mural-service.test.ts -t "feed com post fixado"
```

Esperado: FAIL — o primeiro item é o post mais novo, não o fixado.

- [ ] **Step 3: Implementar**

Substituir o corpo de `listFeed` em `apps/api/src/services/corporate-mural-service.ts`:

```ts
export async function listFeed(
  companyId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ items: CorporatePostWithRelations[]; nextCursor: string | null }> {
  const db = scopedPrisma(companyId)
  const decoded = opts.cursor ? decodeCursor(opts.cursor) : null

  // O fixado sai do keyset e entra prefixado só na 1ª página. Ordenar por
  // `pinnedAt` dentro do keyset obrigaria a mudar o formato do cursor sem
  // ganho: no máximo um post fica fixado por vez.
  const pinned = await db.corporatePost.findFirst({
    where: { pinnedAt: { not: null }, author: { active: true } },
    include: corporatePostInclude,
    orderBy: { pinnedAt: 'desc' },
  })

  const where: Prisma.CorporatePostWhereInput = {
    author: { active: true },
    ...(pinned ? { id: { not: pinned.id } } : {}),
    ...(decoded
      ? {
          OR: [
            { createdAt: { lt: decoded.createdAt } },
            { createdAt: decoded.createdAt, id: { lt: decoded.id } },
          ],
        }
      : {}),
  }
  const rows = await db.corporatePost.findMany({
    where,
    include: corporatePostInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
  })
  const hasMore = rows.length > opts.limit
  const page = hasMore ? rows.slice(0, opts.limit) : rows
  // O cursor sai SEMPRE do último item do keyset (`page`), nunca do fixado —
  // prefixar o fixado no cursor faria a página seguinte pular posts.
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null
  const items = !decoded && pinned ? [pinned, ...page] : page
  return { items, nextCursor }
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
pnpm --filter @legends/api exec vitest run src/services/corporate-mural-service.test.ts
```

Esperado: PASS — inclusive os testes de cursor que já existiam.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/corporate-mural-service.ts apps/api/src/services/corporate-mural-service.test.ts
git commit -m "feat(mural): post fixado no topo do feed"
```

---

### Task 5: Service — `markPostRead`

**Files:**
- Modify: `apps/api/src/services/corporate-mural-service.ts`
- Modify: `apps/api/src/services/corporate-mural-service.test.ts`

**Interfaces:**
- Consumes: model `CorporatePostRead` (Task 1).
- Produces: `markPostRead(input: { postId: string; userId: string; companyId: string }): Promise<void>`

- [ ] **Step 1: Escrever os testes que falham**

```ts
describe('corporate-mural-service: marcar leitura', () => {
  it('registra a leitura de quem viu o post', async () => {
    const autor = await makeUser('autor-leitura@empresa.com', 'HEAD')
    const leitor = await makeUser('leitor@empresa.com', 'LEGEND')
    const post = await createPost({ authorId: autor.id, content: 'aviso', companyId: DEFAULT_COMPANY_ID })

    await markPostRead({ postId: post.id, userId: leitor.id, companyId: DEFAULT_COMPANY_ID })

    const reads = await prisma.corporatePostRead.findMany({ where: { postId: post.id } })
    expect(reads).toHaveLength(1)
    expect(reads[0]).toMatchObject({ userId: leitor.id, companyId: DEFAULT_COMPANY_ID })
  })

  it('marcar duas vezes não duplica', async () => {
    const autor = await makeUser('autor-leitura2@empresa.com', 'HEAD')
    const leitor = await makeUser('leitor2@empresa.com', 'LEGEND')
    const post = await createPost({ authorId: autor.id, content: 'aviso', companyId: DEFAULT_COMPANY_ID })

    await markPostRead({ postId: post.id, userId: leitor.id, companyId: DEFAULT_COMPANY_ID })
    await markPostRead({ postId: post.id, userId: leitor.id, companyId: DEFAULT_COMPANY_ID })

    expect(await prisma.corporatePostRead.count({ where: { postId: post.id } })).toBe(1)
  })

  it('404 em post inexistente', async () => {
    const leitor = await makeUser('leitor3@empresa.com', 'LEGEND')
    await expect(
      markPostRead({ postId: 'nao-existe', userId: leitor.id, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @legends/api exec vitest run src/services/corporate-mural-service.test.ts -t "marcar leitura"
```

Esperado: FAIL — `markPostRead is not a function`.

- [ ] **Step 3: Implementar**

```ts
/**
 * Marca o post como lido por alguém. Idempotente: o `@@unique([postId, userId])`
 * mais `skipDuplicates` resolvem a repetição em uma ida só ao banco.
 * `upsert` **não** é opção — o `scopedPrisma` lança nele (ver `lib/tenant-scope.ts`).
 */
export async function markPostRead(input: {
  postId: string
  userId: string
  companyId: string
}): Promise<void> {
  const db = scopedPrisma(input.companyId)
  const post = await db.corporatePost.findUnique({ where: { id: input.postId }, select: { id: true } })
  if (!post) throw new CorporateMuralError('Publicação não encontrada.', 404)
  await db.corporatePostRead.createMany({
    data: [{ postId: input.postId, userId: input.userId }],
    skipDuplicates: true,
  })
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
pnpm --filter @legends/api exec vitest run src/services/corporate-mural-service.test.ts -t "marcar leitura"
```

Esperado: PASS (3 testes). O `companyId` vem injetado pelo `scopedPrisma` — não passe explícito no `data`, o `injectCompanyIdIntoRow` cuida disso.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/corporate-mural-service.ts apps/api/src/services/corporate-mural-service.test.ts
git commit -m "feat(mural): registrar leitura de post (idempotente)"
```

---

### Task 6: Service — `getPostReach`

**Files:**
- Modify: `apps/api/src/services/corporate-mural-service.ts`
- Create: `apps/api/src/services/corporate-mural-reach.test.ts`

**Interfaces:**
- Consumes: Tasks 1 e 5, `CorporatePostReachDTO`/`CorporatePostReachResponse` (Task 2).
- Produces: `getPostReach(companyId: string, opts: { sort: 'date_desc' | 'date_asc'; page: number; pageSize: number }): Promise<CorporatePostReachResponse>`

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/api/src/services/corporate-mural-reach.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createPost, createComment, getPostReach, markPostRead, togglePostReaction } from './corporate-mural-service'

const SECTOR = 'sector-dev-produto'

// Atenção: `User.sectorId` é `String` com default (NÃO é nullable) — usuário de
// outra empresa precisa de um setor daquela empresa, não de `null`.
async function makeUser(email: string, role = 'LEGEND', sectorId = SECTOR, companyId = DEFAULT_COMPANY_ID) {
  return prisma.user.create({
    data: { name: email.split('@')[0], email, passwordHash: 'x', role: role as never, sectorId, companyId },
  })
}

describe('getPostReach', () => {
  it('conta leitores únicos, comentários e reações', async () => {
    const autor = await makeUser('autor-alcance@empresa.com', 'HEAD')
    const a = await makeUser('leitor-a@empresa.com')
    const b = await makeUser('leitor-b@empresa.com')
    const post = await createPost({ authorId: autor.id, content: 'comunicado importante', companyId: DEFAULT_COMPANY_ID })

    await markPostRead({ postId: post.id, userId: a.id, companyId: DEFAULT_COMPANY_ID })
    await markPostRead({ postId: post.id, userId: a.id, companyId: DEFAULT_COMPANY_ID })
    await markPostRead({ postId: post.id, userId: b.id, companyId: DEFAULT_COMPANY_ID })
    await createComment({ postId: post.id, authorId: a.id, content: 'boa', companyId: DEFAULT_COMPANY_ID })
    await togglePostReaction({ postId: post.id, userId: a.id, emoji: '🎉', companyId: DEFAULT_COMPANY_ID })
    await togglePostReaction({ postId: post.id, userId: b.id, emoji: '🎉', companyId: DEFAULT_COMPANY_ID })

    const reach = await getPostReach(DEFAULT_COMPANY_ID, { sort: 'date_desc', page: 1, pageSize: 20 })

    expect(reach.items).toHaveLength(1)
    expect(reach.items[0]).toMatchObject({ postId: post.id, readers: 2, comments: 1, reactions: 2 })
    expect(reach.total).toBe(1)
  })

  it('usa a base de ativos não-terceirizados no readPct', async () => {
    const autor = await makeUser('autor-pct@empresa.com', 'HEAD')
    const leitor = await makeUser('leitor-pct@empresa.com')
    await makeUser('inativo-pct@empresa.com')
    await prisma.user.update({ where: { email: 'inativo-pct@empresa.com' }, data: { active: false } })
    await makeUser('terceiro-pct@empresa.com', 'THIRD_PARTY')
    const post = await createPost({ authorId: autor.id, content: 'aviso', companyId: DEFAULT_COMPANY_ID })
    await markPostRead({ postId: post.id, userId: leitor.id, companyId: DEFAULT_COMPANY_ID })

    const reach = await getPostReach(DEFAULT_COMPANY_ID, { sort: 'date_desc', page: 1, pageSize: 20 })

    // base = autor + leitor = 2 (inativo e terceirizado fora). 1/2 = 50%.
    expect(reach.audience).toBe(2)
    expect(reach.items[0].readPct).toBe(50)
  })

  it('não mostra post nem leitura de outra empresa', async () => {
    const outra = await prisma.company.create({
      data: { name: 'Outra', slug: `outra-${Math.random()}` },
    })
    const setorDaOutra = await prisma.sector.create({
      data: { name: 'Setor Outra', slug: `setor-outra-${Math.random()}`, enabledFeatures: [], companyId: outra.id },
    })
    const autorOutra = await makeUser('autor-outra@empresa.com', 'HEAD', setorDaOutra.id, outra.id)
    await createPost({ authorId: autorOutra.id, content: 'segredo da outra', companyId: outra.id })

    const autor = await makeUser('autor-minha@empresa.com', 'HEAD')
    await createPost({ authorId: autor.id, content: 'meu aviso', companyId: DEFAULT_COMPANY_ID })

    const reach = await getPostReach(DEFAULT_COMPANY_ID, { sort: 'date_desc', page: 1, pageSize: 20 })

    expect(reach.items).toHaveLength(1)
    expect(reach.items[0].excerpt).toBe('meu aviso')
  })

  it('ordena por data crescente quando pedido', async () => {
    const autor = await makeUser('autor-ordem@empresa.com', 'HEAD')
    const primeiro = await createPost({ authorId: autor.id, content: 'primeiro', companyId: DEFAULT_COMPANY_ID })
    const segundo = await createPost({ authorId: autor.id, content: 'segundo', companyId: DEFAULT_COMPANY_ID })

    const asc = await getPostReach(DEFAULT_COMPANY_ID, { sort: 'date_asc', page: 1, pageSize: 20 })
    const desc = await getPostReach(DEFAULT_COMPANY_ID, { sort: 'date_desc', page: 1, pageSize: 20 })

    expect(asc.items.map((i) => i.postId)).toEqual([primeiro.id, segundo.id])
    expect(desc.items.map((i) => i.postId)).toEqual([segundo.id, primeiro.id])
  })

  it('corta o trecho em CORPORATE_POST_EXCERPT_LENGTH', async () => {
    const autor = await makeUser('autor-trecho@empresa.com', 'HEAD')
    await createPost({ authorId: autor.id, content: 'x'.repeat(200), companyId: DEFAULT_COMPANY_ID })

    const reach = await getPostReach(DEFAULT_COMPANY_ID, { sort: 'date_desc', page: 1, pageSize: 20 })

    expect(reach.items[0].excerpt).toHaveLength(81) // 80 + o caractere de reticências
    expect(reach.items[0].excerpt.endsWith('…')).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @legends/api exec vitest run src/services/corporate-mural-reach.test.ts
```

Esperado: FAIL — `getPostReach is not a function`.

- [ ] **Step 3: Implementar**

Adicionar `CORPORATE_POST_EXCERPT_LENGTH` e o tipo `CorporatePostReachResponse` ao import de `@legends/shared` no topo do service, e depois:

```ts
/** Trecho do post para a tabela de alcance: uma linha, sem quebra. */
function toExcerpt(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  if (flat.length <= CORPORATE_POST_EXCERPT_LENGTH) return flat
  return `${flat.slice(0, CORPORATE_POST_EXCERPT_LENGTH)}…`
}

/**
 * Painel de alcance: por post, quantas pessoas leram, comentaram e reagiram.
 * Só contagem — a lista nominal de quem leu **nunca** sai daqui.
 *
 * Agregação com Prisma, sem `$queryRaw`: SQL cru furaria o isolamento por
 * empresa do `scopedPrisma` (mesma razão do relatório de coins). O
 * `@@unique([postId, userId])` de `CorporatePostRead` faz `_count.reads` já
 * ser leitores únicos; `_count.reactions` é o total de reações (uma pessoa com
 * três emojis conta três), igual ao número que o card do mural mostra.
 */
export async function getPostReach(
  companyId: string,
  opts: { sort: 'date_desc' | 'date_asc'; page: number; pageSize: number },
): Promise<CorporatePostReachResponse> {
  const db = scopedPrisma(companyId)
  const orderBy: Prisma.CorporatePostOrderByWithRelationInput = {
    createdAt: opts.sort === 'date_asc' ? 'asc' : 'desc',
  }
  const [rows, total, audience] = await Promise.all([
    db.corporatePost.findMany({
      select: {
        id: true,
        content: true,
        createdAt: true,
        _count: { select: { reads: true, comments: true, reactions: true } },
      },
      orderBy,
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    db.corporatePost.count(),
    // Base do percentual: quem de fato enxerga o mural por padrão. O
    // terceirizado só vê com a feature na allowlist individual, então contá-lo
    // deixaria o percentual cronicamente subestimado.
    db.user.count({ where: { active: true, role: { not: 'THIRD_PARTY' } } }),
  ])

  return {
    items: rows.map((row) => ({
      postId: row.id,
      excerpt: toExcerpt(row.content),
      readers: row._count.reads,
      comments: row._count.comments,
      reactions: row._count.reactions,
      readPct: audience > 0 ? Math.round((row._count.reads / audience) * 1000) / 10 : 0,
      createdAt: row.createdAt.toISOString(),
    })),
    audience,
    total,
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
pnpm --filter @legends/api exec vitest run src/services/corporate-mural-reach.test.ts
```

Esperado: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/corporate-mural-service.ts apps/api/src/services/corporate-mural-reach.test.ts
git commit -m "feat(mural): painel de alcance por post"
```

---

### Task 7: Service — auditoria na moderação

**Files:**
- Modify: `apps/api/src/services/corporate-mural-service.ts:200-216` (`deletePost`), `:290-307` (`deleteComment`)
- Modify: `apps/api/src/services/corporate-mural-service.test.ts`

**Interfaces:**
- Consumes: `recordAuditLog` (já importado na Task 3).
- Produces: `deletePost` e `deleteComment` mantêm a assinatura; passam a gravar log quando quem apaga não é o autor.

- [ ] **Step 1: Escrever os testes que falham**

```ts
describe('corporate-mural-service: auditoria da moderação', () => {
  it('grava auditoria quando o admin apaga post de outro autor', async () => {
    const autor = await makeUser('autor-moderado@empresa.com', 'HEAD')
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: autor.id, content: 'polêmico', companyId: DEFAULT_COMPANY_ID })

    await deletePost({ postId: post.id, userId: admin.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID })

    const log = await prisma.adminAuditLog.findFirst({ where: { entityId: post.id } })
    expect(log).toMatchObject({ entityType: 'CorporatePost', action: 'DELETE', actorId: admin.id })
  })

  it('não grava auditoria quando o autor apaga o próprio post', async () => {
    const autor = await makeUser('autor-apaga-proprio@empresa.com', 'HEAD')
    const post = await createPost({ authorId: autor.id, content: 'meu', companyId: DEFAULT_COMPANY_ID })

    await deletePost({ postId: post.id, userId: autor.id, role: 'HEAD', companyId: DEFAULT_COMPANY_ID })

    expect(await prisma.adminAuditLog.count({ where: { entityId: post.id } })).toBe(0)
  })

  it('grava auditoria quando o admin apaga comentário de outro autor', async () => {
    const autor = await makeUser('autor-post-c@empresa.com', 'HEAD')
    const comentarista = await makeUser('comentarista@empresa.com', 'LEGEND')
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: autor.id, content: 'aviso', companyId: DEFAULT_COMPANY_ID })
    const { comment } = await createComment({
      postId: post.id,
      authorId: comentarista.id,
      content: 'comentário ruim',
      companyId: DEFAULT_COMPANY_ID,
    })

    await deleteComment({ commentId: comment.id, userId: admin.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID })

    const log = await prisma.adminAuditLog.findFirst({ where: { entityId: comment.id } })
    expect(log).toMatchObject({ entityType: 'CorporatePostComment', action: 'DELETE', actorId: admin.id })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @legends/api exec vitest run src/services/corporate-mural-service.test.ts -t "auditoria da moderação"
```

Esperado: FAIL — nenhum log encontrado (`log` é `null`).

- [ ] **Step 3: Implementar**

Em `deletePost`, o `select` precisa trazer o conteúdo para o `before` do log. Substituir o corpo:

```ts
export async function deletePost(input: {
  postId: string
  userId: string
  role: string
  companyId: string
}): Promise<void> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.corporatePost.findUnique({
    where: { id: input.postId },
    select: { authorId: true, content: true, createdAt: true },
  })
  if (!existing) throw new CorporateMuralError('Publicação não encontrada.', 404)
  if (existing.authorId !== input.userId && input.role !== 'ADMIN' && input.role !== 'SUBADMIN') {
    throw new CorporateMuralError('Sem permissão para excluir esta publicação.', 403)
  }
  await db.corporatePost.delete({ where: { id: input.postId } })
  // Só ato de moderação vira log: apagar o próprio post é uso normal do mural.
  if (existing.authorId !== input.userId) {
    await recordAuditLog({
      actorId: input.userId,
      entityType: 'CorporatePost',
      entityId: input.postId,
      action: 'DELETE',
      before: { authorId: existing.authorId, content: existing.content, createdAt: existing.createdAt },
      companyId: input.companyId,
    })
  }
}
```

E, em `deleteComment`, o mesmo padrão:

```ts
export async function deleteComment(input: {
  commentId: string
  userId: string
  role: string
  companyId: string
}): Promise<{ postId: string }> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.corporatePostComment.findUnique({
    where: { id: input.commentId },
    select: { authorId: true, postId: true, content: true, createdAt: true },
  })
  if (!existing) throw new CorporateMuralError('Comentário não encontrado.', 404)
  if (existing.authorId !== input.userId && input.role !== 'ADMIN' && input.role !== 'SUBADMIN') {
    throw new CorporateMuralError('Sem permissão para excluir este comentário.', 403)
  }
  await db.corporatePostComment.delete({ where: { id: input.commentId } })
  if (existing.authorId !== input.userId) {
    await recordAuditLog({
      actorId: input.userId,
      entityType: 'CorporatePostComment',
      entityId: input.commentId,
      action: 'DELETE',
      before: {
        authorId: existing.authorId,
        postId: existing.postId,
        content: existing.content,
        createdAt: existing.createdAt,
      },
      companyId: input.companyId,
    })
  }
  return { postId: existing.postId }
}
```

Note que a exclusão **não** entra em transação: o `recordAuditLog` roda depois do `delete`, e a cascata do Prisma já levou comentários/reações junto. Uma transação aqui só serviria para reverter o delete se o log falhasse — e perder o post por causa de um log é pior que um log faltando.

- [ ] **Step 4: Rodar e ver passar**

```bash
pnpm --filter @legends/api exec vitest run src/services/corporate-mural-service.test.ts
```

Esperado: PASS — inclusive os testes de permissão de exclusão que já existiam.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/corporate-mural-service.ts apps/api/src/services/corporate-mural-service.test.ts
git commit -m "feat(mural): auditoria de exclusão por moderação"
```

---

### Task 8: Rotas — pin, unpin, read e reach

**Files:**
- Modify: `apps/api/src/routes/corporate-mural.ts`
- Modify: `apps/api/src/routes/corporate-mural.test.ts`

**Interfaces:**
- Consumes: `pinPost`, `unpinPost`, `markPostRead`, `getPostReach` (Tasks 3–6); `toCorporatePostDTO` (Task 2); `corporateMuralHub`.
- Produces: `POST /corporate-posts/:id/pin`, `DELETE /corporate-posts/:id/pin`, `POST /corporate-posts/:id/read`, `GET /admin/corporate-posts/reach`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar a `apps/api/src/routes/corporate-mural.test.ts` (os helpers `makeUser` e `auth` já existem no topo):

```ts
describe('rotas de fixar, ler e alcance', () => {
  it('admin fixa e desfixa; o post fixado vem primeiro no feed', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    const antigo = await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(admin.token), payload: { content: 'antigo' },
    })
    await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(admin.token), payload: { content: 'novo' },
    })
    const antigoId = antigo.json().post.id

    const pinned = await app.inject({
      method: 'POST', url: `/corporate-posts/${antigoId}/pin`, headers: auth(admin.token),
    })
    expect(pinned.statusCode).toBe(200)
    expect(pinned.json().post.pinnedAt).toEqual(expect.any(String))

    const feed = await app.inject({ method: 'GET', url: '/corporate-posts', headers: auth(admin.token) })
    expect(feed.json().items[0].id).toBe(antigoId)

    const unpinned = await app.inject({
      method: 'DELETE', url: `/corporate-posts/${antigoId}/pin`, headers: auth(admin.token),
    })
    expect(unpinned.statusCode).toBe(200)
    expect(unpinned.json().post.pinnedAt).toBeNull()
    await app.close()
  })

  it('subadmin fixa; lenda e liderança recebem 403', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const sub = await makeUser(app, 'SUBADMIN')
    const head = await makeUser(app, 'HEAD')
    const lenda = await makeUser(app, 'LEGEND')
    const post = await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(admin.token), payload: { content: 'aviso' },
    })
    const id = post.json().post.id

    expect((await app.inject({ method: 'POST', url: `/corporate-posts/${id}/pin`, headers: auth(sub.token) })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: `/corporate-posts/${id}/pin`, headers: auth(head.token) })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: `/corporate-posts/${id}/pin`, headers: auth(lenda.token) })).statusCode).toBe(403)
    await app.close()
  })

  it('marcar leitura responde 204 e é idempotente', async () => {
    const app = buildApp()
    await app.ready()
    const head = await makeUser(app, 'HEAD')
    const lenda = await makeUser(app, 'LEGEND')
    const post = await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(head.token), payload: { content: 'aviso' },
    })
    const id = post.json().post.id

    const first = await app.inject({ method: 'POST', url: `/corporate-posts/${id}/read`, headers: auth(lenda.token) })
    const second = await app.inject({ method: 'POST', url: `/corporate-posts/${id}/read`, headers: auth(lenda.token) })
    expect(first.statusCode).toBe(204)
    expect(second.statusCode).toBe(204)
    expect(await prisma.corporatePostRead.count({ where: { postId: id } })).toBe(1)

    const missing = await app.inject({
      method: 'POST', url: '/corporate-posts/nao-existe/read', headers: auth(lenda.token),
    })
    expect(missing.statusCode).toBe(404)
    await app.close()
  })

  it('o painel de alcance é 200 para admin e 403 para lenda', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const lenda = await makeUser(app, 'LEGEND')
    await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(admin.token), payload: { content: 'aviso medido' },
    })

    const ok = await app.inject({ method: 'GET', url: '/admin/corporate-posts/reach', headers: auth(admin.token) })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().items[0]).toMatchObject({ excerpt: 'aviso medido', readers: 0 })
    expect(ok.json().audience).toBeGreaterThan(0)

    const blocked = await app.inject({ method: 'GET', url: '/admin/corporate-posts/reach', headers: auth(lenda.token) })
    expect(blocked.statusCode).toBe(403)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @legends/api exec vitest run src/routes/corporate-mural.test.ts -t "fixar, ler e alcance"
```

Esperado: FAIL com 404 nas rotas novas.

- [ ] **Step 3: Implementar as rotas**

Em `apps/api/src/routes/corporate-mural.ts`, acrescentar ao import do service:

```ts
  getPostReach,
  markPostRead,
  pinPost,
  unpinPost,
```

Depois do `clampLimit`, o schema de query do painel:

```ts
const reachQuerySchema = z.object({
  sort: z.enum(['date_desc', 'date_asc']).optional().default('date_desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
})
```

E, dentro de `corporateMuralRoutes`, depois da declaração do `guard`:

```ts
  // Fixar/moderar/medir não tem recorte de setor: o mural é da empresa inteira
  // e não tem `sectorId`. Qualquer subadmin age no mural todo, igual à exclusão.
  const adminGuard = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }
```

E as quatro rotas, no fim da função:

```ts
  app.post('/corporate-posts/:id/pin', adminGuard, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const post = await pinPost({
        postId: id,
        actorId: request.user.sub,
        companyId: request.user.companyId,
      })
      // Fixar reordena o feed inteiro — mesmo evento que o post novo emite.
      corporateMuralHub.broadcast({ type: 'feed:changed' })
      return reply.send({ post: toCorporatePostDTO(post, request.user.sub) })
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/corporate-posts/:id/pin', adminGuard, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const post = await unpinPost({
        postId: id,
        actorId: request.user.sub,
        companyId: request.user.companyId,
      })
      corporateMuralHub.broadcast({ type: 'feed:changed' })
      return reply.send({ post: toCorporatePostDTO(post, request.user.sub) })
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  // Leitura NÃO é broadcast: seria ruído inútil e vazaria quem leu o quê.
  app.post('/corporate-posts/:id/read', guard, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await markPostRead({ postId: id, userId: request.user.sub, companyId: request.user.companyId })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/admin/corporate-posts/reach', adminGuard, async (request, reply) => {
    const parsed = reachQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Filtro inválido.', issues: parsed.error.flatten() })
    }
    try {
      const reach = await getPostReach(request.user.companyId, parsed.data)
      return reply.send(reach)
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

- [ ] **Step 4: Rodar e ver passar**

```bash
pnpm --filter @legends/api exec vitest run src/routes/corporate-mural.test.ts
```

Esperado: PASS — os 4 testes novos e os que já existiam.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/corporate-mural.ts apps/api/src/routes/corporate-mural.test.ts
git commit -m "feat(mural): rotas de fixar, marcar leitura e alcance"
```

---

### Task 9: Web — hooks de fixar e de alcance

**Files:**
- Modify: `apps/web/src/lib/use-corporate-mural.ts`

**Interfaces:**
- Consumes: rotas da Task 8; `CorporatePostReachResponse` (Task 2).
- Produces:
  - `usePinCorporatePost(): UseMutationResult<{ post: CorporatePostDTO }, Error, { postId: string; pin: boolean }>`
  - `useCorporateMuralReach(sort: 'date_desc' | 'date_asc'): UseQueryResult<CorporatePostReachResponse>`

- [ ] **Step 1: Implementar os hooks**

Não há teste direto aqui — os hooks são exercitados pelos testes de componente das Tasks 11 e 12. Em `apps/web/src/lib/use-corporate-mural.ts`, acrescentar `useQuery` ao import do `@tanstack/react-query` e `CorporatePostReachResponse` ao import de `@legends/shared`, depois adicionar:

```ts
/** Fixa (pin=true) ou desfixa (pin=false) um post. Só admin/subadmin — a API devolve 403. */
export function usePinCorporatePost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { postId: string; pin: boolean }) =>
      apiFetch<{ post: CorporatePostDTO }>(`/corporate-posts/${vars.postId}/pin`, {
        method: vars.pin ? 'POST' : 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CORPORATE_FEED_KEY }),
  })
}

export function useCorporateMuralReach(sort: 'date_desc' | 'date_asc') {
  return useQuery({
    queryKey: ['admin', 'corporate-posts', 'reach', sort],
    queryFn: () => apiFetch<CorporatePostReachResponse>(`/admin/corporate-posts/reach?sort=${sort}`),
  })
}
```

- [ ] **Step 2: Verificar que a web compila**

```bash
pnpm --filter @legends/web exec tsc --noEmit -p tsconfig.json
```

Esperado: sem erros. (Use o binário via `pnpm exec` — `npx tsc` é interceptado e não é confiável.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/use-corporate-mural.ts
git commit -m "feat(mural): hooks de fixar post e de alcance"
```

---

### Task 10: Web — marcação de leitura por viewport

**Files:**
- Create: `apps/web/src/lib/use-corporate-post-read.ts`
- Create: `apps/web/src/lib/use-corporate-post-read.test.ts`

**Interfaces:**
- Consumes: `POST /corporate-posts/:id/read` (Task 8), `apiFetch` de `./api`.
- Produces: `useCorporatePostRead(postId: string): RefObject<HTMLLIElement>` — o ref é colado no `<li>` do card.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/web/src/lib/use-corporate-post-read.test.ts`:

```ts
import { renderHook } from '@testing-library/react'
import { vi, type Mock, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useCorporatePostRead, __resetCorporatePostReadCache } from './use-corporate-post-read'
import { apiFetch } from './api'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

/** Captura o callback do observer para disparar a interseção à mão. */
let trigger: ((entries: { isIntersecting: boolean }[]) => void) | null = null
const disconnect = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  __resetCorporatePostReadCache()
  mockApiFetch.mockResolvedValue(undefined)
  trigger = null
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        trigger = cb
      }
      observe() {}
      disconnect = disconnect
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useCorporatePostRead', () => {
  it('marca leitura quando o post entra na viewport', () => {
    const { result } = renderHook(() => useCorporatePostRead('post-1'))
    expect(result.current).toBeDefined()
    trigger?.([{ isIntersecting: true }])
    expect(mockApiFetch).toHaveBeenCalledWith('/corporate-posts/post-1/read', { method: 'POST' })
  })

  it('não marca de novo se o post reaparecer na viewport', () => {
    renderHook(() => useCorporatePostRead('post-2'))
    trigger?.([{ isIntersecting: true }])
    trigger?.([{ isIntersecting: true }])
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
  })

  it('não marca enquanto o post está fora da viewport', () => {
    renderHook(() => useCorporatePostRead('post-3'))
    trigger?.([{ isIntersecting: false }])
    expect(mockApiFetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @legends/web exec vitest run src/lib/use-corporate-post-read.test.ts
```

Esperado: FAIL — o módulo não existe.

- [ ] **Step 3: Implementar**

Criar `apps/web/src/lib/use-corporate-post-read.ts`:

```ts
import { useEffect, useRef } from 'react'
import { apiFetch } from './api'

/**
 * Ids já marcados nesta sessão. Vive no módulo, não em estado de React: a
 * marcação é efeito colateral puro e **não pode** virar `setState` nem
 * invalidar o feed — `setState` num efeito que roda durante o scroll é
 * exatamente o loop render→setState→render que estoura a heap do worker de
 * teste (ver AGENTS.md, "Gotchas"), e invalidar traria refetch em cascata.
 * Some no reload, que é o recorte desejado: uma vez por post por sessão.
 */
const marked = new Set<string>()

/** Só para teste — zera o cache de sessão entre casos. */
export function __resetCorporatePostReadCache(): void {
  marked.clear()
}

/**
 * Marca o post como lido quando ele entra na viewport (≥50% visível), uma vez
 * por post por sessão. Devolve o ref que o card cola no `<li>`.
 */
export function useCorporatePostRead(postId: string) {
  const ref = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (marked.has(postId)) return
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        if (marked.has(postId)) return
        marked.add(postId)
        observer.disconnect()
        apiFetch<void>(`/corporate-posts/${postId}/read`, { method: 'POST' }).catch(() => {
          // Falhou? Libera para uma próxima tentativa nesta sessão. Marcar
          // leitura é best-effort: nunca deve estourar erro na cara de ninguém.
          marked.delete(postId)
        })
      },
      { threshold: 0.5 },
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [postId])

  return ref
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
pnpm --filter @legends/web exec vitest run src/lib/use-corporate-post-read.test.ts
```

Esperado: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/use-corporate-post-read.ts apps/web/src/lib/use-corporate-post-read.test.ts
git commit -m "feat(mural): marcar leitura por viewport, uma vez por sessão"
```

---

### Task 11: Web — selo "Fixado" e ação de fixar no card

**Files:**
- Modify: `apps/web/src/pages/mural-corporativo/CorporatePostCard.tsx`
- Create: `apps/web/src/pages/mural-corporativo/CorporatePostCard.test.tsx`
- Modify: `apps/web/src/pages/mural-corporativo/MuralCorporativoFeed.test.tsx:75-93` (fixture `feedPage`)

**Interfaces:**
- Consumes: `canPinCorporatePost` (Task 2), `usePinCorporatePost` (Task 9), `useCorporatePostRead` (Task 10).
- Produces: nada para tasks seguintes.

> **Atenção:** `MuralCorporativoFeed.test.tsx` **substitui o `CorporatePostCard` por um stub**
> (`vi.mock('./CorporatePostCard', …)`, linha 43). Testar selo e ação de fixar lá é
> impossível — o card real nunca renderiza. Por isso o teste vai num arquivo novo.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/web/src/pages/mural-corporativo/CorporatePostCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { CorporatePostDTO } from '@legends/shared'
import { CorporatePostCard } from './CorporatePostCard'
import * as api from '../../lib/api'

const mockUseAuth = vi.fn()
vi.mock('../../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}))

vi.mock('./CorporatePostComments', () => ({
  CorporatePostComments: () => <div />,
}))

const author = {
  id: 'u2', name: 'Bia', email: 'b@x.com', role: 'HEAD', position: null,
  squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null,
  avatarOptions: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z',
}

function makePost(pinnedAt: string | null): CorporatePostDTO {
  return {
    id: 'p1',
    author,
    content: 'Comunicado da empresa toda',
    gif: null,
    image: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    pinnedAt,
    reactions: [],
    reactors: [],
    reactorCount: 0,
    commentCount: 0,
    mentions: [],
  }
}

function viewer(role: string) {
  return {
    user: { id: 'u1', name: 'Quem Vê', role },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  }
}

function wrap(post: CorporatePostDTO) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ul>
          <CorporatePostCard post={post} />
        </ul>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CorporatePostCard: fixar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockUseAuth.mockReturnValue(viewer('LEGEND'))
  })

  it('mostra o selo Fixado quando o post está fixado', () => {
    wrap(makePost('2026-08-01T10:00:00.000Z'))
    expect(screen.getByText('Fixado')).toBeInTheDocument()
  })

  it('não mostra o selo quando o post não está fixado', () => {
    wrap(makePost(null))
    expect(screen.queryByText('Fixado')).not.toBeInTheDocument()
  })

  it('esconde a ação de fixar de quem não é admin', () => {
    wrap(makePost(null))
    expect(screen.queryByRole('button', { name: /fixar publicação/i })).not.toBeInTheDocument()
  })

  it('admin fixa o post pela ação do card', async () => {
    mockUseAuth.mockReturnValue(viewer('ADMIN'))
    const spy = vi.spyOn(api, 'apiFetch').mockResolvedValue({ post: makePost('2026-08-01T10:00:00.000Z') })
    wrap(makePost(null))

    fireEvent.click(screen.getByRole('button', { name: 'Fixar publicação' }))

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/corporate-posts/p1/pin', { method: 'POST' }),
    )
  })

  it('subadmin desafixa o post fixado', async () => {
    mockUseAuth.mockReturnValue(viewer('SUBADMIN'))
    const spy = vi.spyOn(api, 'apiFetch').mockResolvedValue({ post: makePost(null) })
    wrap(makePost('2026-08-01T10:00:00.000Z'))

    fireEvent.click(screen.getByRole('button', { name: 'Desafixar publicação' }))

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/corporate-posts/p1/pin', { method: 'DELETE' }),
    )
  })
})
```

- [ ] **Step 2: Confirmar que a fixture do feed já tem `pinnedAt`**

A Task 2 já acrescentou `pinnedAt: null` à fixture de `MuralCorporativoFeed.test.tsx`.
Confira antes de seguir; se faltar, acrescente agora.

- [ ] **Step 3: Rodar e ver falhar**

```bash
pnpm --filter @legends/web exec vitest run src/pages/mural-corporativo/CorporatePostCard.test.tsx
```

Esperado: FAIL — nem o selo nem o botão existem.

- [ ] **Step 4: Implementar**

Em `apps/web/src/pages/mural-corporativo/CorporatePostCard.tsx`:

Imports — acrescentar `canPinCorporatePost` ao import de `@legends/shared`, `usePinCorporatePost` ao import de `../../lib/use-corporate-mural` e o hook de leitura:

```ts
import { useCorporatePostRead } from '../../lib/use-corporate-post-read'
```

No corpo do componente, depois de `const remove = useDeleteCorporatePost()`:

```ts
  const pin = usePinCorporatePost()
  const readRef = useCorporatePostRead(post.id)
  const canPin = canPinCorporatePost(user?.role)
  const isPinned = post.pinnedAt !== null
```

Colar o ref no `<li>` (linha ~72):

```tsx
    <li
      ref={readRef}
      id={post.id}
      className="group/post flex gap-md px-lg py-md transition-colors hover:bg-surface-container-high"
    >
```

Selo — logo depois do `<span>` do tempo relativo (linha ~99), antes do bloco `{canDelete && …}`:

```tsx
          {isPinned && (
            <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-primary/10 px-sm font-label text-label-sm text-primary">
              <Icon name="push_pin" className="text-[14px]" />
              Fixado
            </span>
          )}
```

Ação de fixar — antes do bloco `{canDelete && …}`. Ela leva o `ml-auto` (que hoje está no botão de excluir) para empurrar o grupo à direita; **remova o `ml-auto` do botão de excluir** ao adicionar esta:

```tsx
          {canPin && (
            <button
              type="button"
              onClick={() => pin.mutate({ postId: post.id, pin: !isPinned })}
              disabled={pin.isPending}
              aria-label={isPinned ? 'Desafixar publicação' : 'Fixar publicação'}
              className={`group ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-opacity hover:bg-primary/10 hover:text-primary focus:opacity-100 disabled:opacity-50 ${
                isPinned ? 'text-primary opacity-100' : 'text-on-surface-variant opacity-0 group-hover/post:opacity-100'
              }`}
            >
              <Icon name={isPinned ? 'keep_off' : 'push_pin'} className="text-[18px]" />
            </button>
          )}
```

E no botão de excluir, trocar `className="group ml-auto flex h-8 …"` por `className="group flex h-8 …"` — sem o `ml-auto`, já que a ação de fixar passou a ocupar esse papel. Quando o usuário não é admin (sem ação de fixar), o `ml-auto` precisa voltar para o excluir: use

```tsx
              className={`group flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant opacity-0 transition-opacity hover:bg-error/10 hover:text-error focus:opacity-100 disabled:opacity-50 group-hover/post:opacity-100 ${canPin ? '' : 'ml-auto'}`}
```

- [ ] **Step 5: Rodar e ver passar**

```bash
pnpm --filter @legends/web exec vitest run src/pages/mural-corporativo/
```

Esperado: PASS — os 5 testes novos do card e os 4 do feed, que seguem verdes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/mural-corporativo/CorporatePostCard.tsx apps/web/src/pages/mural-corporativo/CorporatePostCard.test.tsx apps/web/src/pages/mural-corporativo/MuralCorporativoFeed.test.tsx
git commit -m "feat(mural): selo Fixado e ação de fixar no card"
```

---

### Task 12: Web — aba "Mural" com o painel de alcance

**Files:**
- Create: `apps/web/src/pages/admin/CorporateMuralReachTab.tsx`
- Create: `apps/web/src/pages/admin/CorporateMuralReachTab.test.tsx`
- Modify: `apps/web/src/pages/admin/ModerationSection.tsx`
- Modify: `apps/web/src/pages/admin/ModerationSection.test.tsx`

**Interfaces:**
- Consumes: `useCorporateMuralReach` (Task 9), `Panel` de `./shared`.
- Produces: `CorporateMuralReachTab()` — componente sem props.

- [ ] **Step 1: Escrever o teste do painel**

Criar `apps/web/src/pages/admin/CorporateMuralReachTab.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock, describe, it, expect, beforeEach } from 'vitest'
import { CorporateMuralReachTab } from './CorporateMuralReachTab'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

beforeEach(() => {
  vi.clearAllMocks()
  mockApiFetch.mockResolvedValue({
    items: [
      { postId: 'p1', excerpt: 'aviso de férias coletivas', readers: 12, readPct: 25, comments: 3, reactions: 7, createdAt: '2026-07-30T12:00:00.000Z' },
    ],
    audience: 48,
    total: 1,
  })
})

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CorporateMuralReachTab />
    </QueryClientProvider>,
  )
}

describe('CorporateMuralReachTab', () => {
  it('mostra leitores únicos, percentual e o denominador', async () => {
    renderTab()
    expect(await screen.findByText('aviso de férias coletivas')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByText(/48 pessoas/)).toBeInTheDocument()
  })

  it('não expõe nome de quem leu', async () => {
    renderTab()
    await screen.findByText('aviso de férias coletivas')
    expect(screen.queryByText(/quem leu/i)).not.toBeInTheDocument()
  })

  it('inverte a ordem ao clicar no cabeçalho de data', async () => {
    renderTab()
    await screen.findByText('aviso de férias coletivas')
    fireEvent.click(screen.getByRole('button', { name: /data/i }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/corporate-posts/reach?sort=date_asc'),
    )
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/CorporateMuralReachTab.test.tsx
```

Esperado: FAIL — o módulo não existe.

- [ ] **Step 3: Implementar o painel**

Criar `apps/web/src/pages/admin/CorporateMuralReachTab.tsx`:

```tsx
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { useCorporateMuralReach } from '../../lib/use-corporate-mural'

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * Alcance dos comunicados do mural: por post, quantas pessoas leram, comentaram
 * e reagiram. Só contagem — a lista nominal de quem leu não existe no contrato,
 * de propósito.
 */
export function CorporateMuralReachTab() {
  const [sort, setSort] = useState<'date_desc' | 'date_asc'>('date_desc')
  const reach = useCorporateMuralReach(sort)

  if (reach.isLoading) {
    return <p className="text-body-sm text-on-surface-variant">Carregando…</p>
  }
  if (reach.isError) {
    return (
      <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
        <Icon name="error" className="text-[16px]" />
        Erro ao carregar o alcance dos comunicados.
      </p>
    )
  }
  if (!reach.data || reach.data.items.length === 0) {
    return <p className="text-body-sm text-on-surface-variant">Nenhum comunicado publicado ainda.</p>
  }

  return (
    <div className="flex flex-col gap-md">
      <p className="text-body-sm text-on-surface-variant">
        Base de {reach.data.audience} pessoas ativas na empresa.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-outline-variant/40 font-label text-label-sm text-on-surface-variant">
              <th className="py-sm pr-md font-bold">Comunicado</th>
              <th className="py-sm pr-md font-bold">Leitores</th>
              <th className="py-sm pr-md font-bold">% da base</th>
              <th className="py-sm pr-md font-bold">Comentários</th>
              <th className="py-sm pr-md font-bold">Reações</th>
              <th className="py-sm font-bold">
                <button
                  type="button"
                  onClick={() => setSort((s) => (s === 'date_desc' ? 'date_asc' : 'date_desc'))}
                  className="flex items-center gap-xs text-on-surface-variant transition-colors hover:text-primary"
                >
                  Data
                  <Icon
                    name={sort === 'date_desc' ? 'arrow_downward' : 'arrow_upward'}
                    className="text-[14px]"
                  />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {reach.data.items.map((item) => (
              <tr key={item.postId} className="border-b border-outline-variant/20 text-body-sm text-on-surface">
                <td className="max-w-[20rem] truncate py-sm pr-md">{item.excerpt}</td>
                <td className="py-sm pr-md">{item.readers}</td>
                <td className="py-sm pr-md">{item.readPct}%</td>
                <td className="py-sm pr-md">{item.comments}</td>
                <td className="py-sm pr-md">{item.reactions}</td>
                <td className="whitespace-nowrap py-sm text-on-surface-variant">{formatDate(item.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar o teste do painel e ver passar**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/CorporateMuralReachTab.test.tsx
```

Esperado: PASS (3 testes).

- [ ] **Step 5: Escrever o teste das abas**

Adicionar a `apps/web/src/pages/admin/ModerationSection.test.tsx`, dentro do `describe` existente — e acrescentar ao `setupFetch` a resposta do alcance:

```ts
    if (path.startsWith('/admin/corporate-posts/reach')) {
      return Promise.resolve({
        items: [{ postId: 'p1', excerpt: 'comunicado medido', readers: 5, readPct: 50, comments: 1, reactions: 2, createdAt: '2026-07-30T12:00:00.000Z' }],
        audience: 10,
        total: 1,
      })
    }
```

E os casos:

```ts
  it('abre na aba de votos', async () => {
    renderSection()
    expect(await screen.findByText(/texto a moderar/)).toBeInTheDocument()
    expect(screen.queryByText('comunicado medido')).not.toBeInTheDocument()
  })

  it('troca para a aba do mural e mostra o alcance', async () => {
    renderSection()
    await screen.findByText(/texto a moderar/)
    fireEvent.click(screen.getByRole('tab', { name: 'Mural' }))
    expect(await screen.findByText('comunicado medido')).toBeInTheDocument()
  })
```

- [ ] **Step 6: Rodar e ver falhar**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/ModerationSection.test.tsx
```

Esperado: FAIL — não existe `role="tab"`.

- [ ] **Step 7: Implementar as abas**

Substituir `apps/web/src/pages/admin/ModerationSection.tsx` inteiro:

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { VoteDTO } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Panel } from './shared'
import { CorporateMuralReachTab } from './CorporateMuralReachTab'

type Tab = 'votos' | 'mural'

const TABS: { id: Tab; label: string }[] = [
  { id: 'votos', label: 'Votos' },
  { id: 'mural', label: 'Mural' },
]

function VotesTab() {
  const queryClient = useQueryClient()
  const votesQuery = useQuery({
    queryKey: ['admin', 'votes'],
    queryFn: () => apiFetch<{ votes: VoteDTO[] }>('/admin/votes'),
  })
  const removeVote = useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`/admin/votes/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'votes'] }),
  })

  return (
    <>
      {votesQuery.data && votesQuery.data.votes.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhum voto registrado.</p>
      )}
      <ul className="flex flex-col gap-2">
        {votesQuery.data?.votes.map((vote) => (
          <li key={vote.id} className="flex items-start justify-between gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
            <div className="min-w-0">
              <p className="font-label text-label-md text-on-surface">
                {vote.voter.name} → {vote.voted.name}
                <span className="ml-2 font-body text-body-sm text-on-surface-variant">· {vote.categories.map((c) => c.name).join(", ")}</span>
              </p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{vote.justification}</p>
            </div>
            <button
              onClick={() => removeVote.mutate(vote.id)}
              className="shrink-0 rounded-md border border-error/40 px-3 py-1 font-label text-label-sm text-error transition-colors hover:border-error"
            >
              Remover
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

export function ModerationSection() {
  const [tab, setTab] = useState<Tab>('votos')

  return (
    <Panel title="Moderação">
      <div role="tablist" aria-label="Moderação" className="mb-lg flex gap-xs border-b border-outline-variant/40">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-md py-sm font-label text-label-md transition-colors ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'votos' ? <VotesTab /> : <CorporateMuralReachTab />}
    </Panel>
  )
}
```

O título do Panel muda de "Moderação de votos" para "Moderação" — a seção agora tem duas abas.

- [ ] **Step 8: Rodar e ver passar**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/ModerationSection.test.tsx src/pages/admin/CorporateMuralReachTab.test.tsx
```

Esperado: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/admin/CorporateMuralReachTab.tsx apps/web/src/pages/admin/CorporateMuralReachTab.test.tsx apps/web/src/pages/admin/ModerationSection.tsx apps/web/src/pages/admin/ModerationSection.test.tsx
git commit -m "feat(mural): aba de alcance dos comunicados na Moderação"
```

---

### Task 13: Verificação final

**Files:** nenhum (só verificação).

- [ ] **Step 1: Rodar a suíte inteira**

```bash
pnpm db:up
pnpm test
```

Esperado: PASS em `@legends/shared`, `@legends/api` e `@legends/web`. A suíte completa é lenta — é verificação final, não roda a cada iteração.

- [ ] **Step 2: Conferir o build**

```bash
pnpm build
```

Esperado: sucesso nos três workspaces.

- [ ] **Step 3: Checar os critérios de aceite à mão**

Suba com `pnpm dev` e confirme, logado como ADMIN:

1. Fixar um post o leva ao topo do mural com o selo "Fixado".
2. Fixar um segundo desfixa o primeiro — nunca há dois selos.
3. Numa segunda aba logada como LEGEND, o feed reordena sozinho ao fixar (WebSocket).
4. A lenda não vê o botão de fixar.
5. Rolar por um post registra leitura; rolar de novo não incrementa (confira em `/admin/moderacao`, aba Mural).
6. O painel mostra leitores e % da base, e nenhum nome de leitor.

- [ ] **Step 4: Commit final (se algo foi ajustado)**

```bash
git add -A
git commit -m "chore(mural): ajustes da verificação final"
```

---

## Notas de revisão

**Cobertura do spec.** Cada seção do design tem task: dados → 1; contrato + serialize → 2; `pinPost`/`unpinPost` → 3; ordenação do feed → 4; `markPostRead` → 5; `getPostReach` → 6; auditoria da moderação → 7; rotas e WebSocket → 8; hooks web → 9; leitura por viewport → 10; selo e ação → 11; aba de alcance → 12.

**Ponto de atenção na Task 4.** O `nextCursor` sai do último item do **keyset** (`page`), nunca do array final (`items`). Se sair de `items`, a primeira página com fixado devolve um cursor errado e a página seguinte pula posts. É o erro mais fácil de cometer no plano inteiro.

**Ponto de atenção na Task 5.** Não passe `companyId` no `data` do `createMany` — o `scopedPrisma` injeta, e passar um valor divergente faz o `injectCompanyIdIntoRow` lançar `TenantScopeError`.

**Ponto de atenção na Task 10.** Nada de `setState` no caminho da marcação de leitura, e nada de `invalidateQueries`. O teto de heap do worker em `apps/web/vite.config.ts` existe para esse loop falhar rápido — se um teste de web começar a estourar memória, é aqui.

**Ponto de atenção na Task 11.** `MuralCorporativoFeed.test.tsx` faz `vi.mock('./CorporatePostCard')`: qualquer asserção sobre o card real feita lá passa a testar o stub, não o componente. Por isso o teste do selo/ação vive em arquivo próprio.

**Ponto de atenção nas Tasks 6 e 12.** `User.sectorId` é `String` com default, **não é nullable** — usuário de outra empresa precisa de um `Sector` criado naquela empresa. E `Company.id` é `cuid()` automático: não passe `id` à mão no `create`.
