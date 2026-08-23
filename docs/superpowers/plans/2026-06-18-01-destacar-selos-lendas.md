# Destacar selos na tela de Lendas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que cada usuário escolha, no próprio perfil, até 3 selos para destacar no card da galeria de Lendas; sem escolha, mantém o comportamento atual (3 mais recentes).

**Architecture:** Flag booleana `featured` na linha `UserBadge` (o selo conquistado). A galeria (`listShowcase`) ordena `featured DESC, awardedAt DESC` e o card já corta em 3, então os destaques sobem. Um endpoint `PUT /me/featured-badges` substitui o conjunto de destaques do usuário (route fina → service em transação). No front, a `BadgeGallery` ganha um modo de edição presentacional, e a `ProfilePage` faz a chamada e invalida as queries do React Query.

**Tech Stack:** Fastify 4 + Prisma 5 + PostgreSQL (apps/api), Zod, Vitest; Vite + React 18 + React Query + Tailwind (apps/web); tipos compartilhados em `@legends/shared`.

## Global Constraints

- TypeScript **strict**, ESM puro (`"type": "module"`), Node ≥ 20, pnpm 9.7.
- Fluxo backend: **route (fina, valida com Zod) → service (regra + erro de domínio tipado com `status`) → Prisma**. Não misturar camadas.
- Contrato api⇄web é fonte única em **`@legends/shared`** — altere o tipo lá primeiro.
- Erros de domínio são classes com `readonly status`; a route faz `instanceof` e responde com `err.status`. Erros inesperados sobem (`throw`).
- **Nunca editar uma migration já aplicada** — gere uma nova.
- Mensagens ao usuário em **português**.
- Testes da API rodam contra **Postgres real** — suba com `pnpm db:up` antes (`test/setup.ts` trunca todas as tabelas em `beforeEach`).
- Limite de destaques: **`MAX_FEATURED_BADGES = 3`** (constante única em `@legends/shared`).
- `apiFetch` só envia `Content-Type: application/json` quando há `body`; passe o corpo como `JSON.stringify(...)`.

---

### Task 1: Contrato compartilhado (`@legends/shared`)

Adiciona o campo `featured` ao DTO, a constante de limite e o tipo do payload do endpoint. Tudo que segue depende destes símbolos.

**Files:**
- Modify: `packages/shared/src/badge.ts`

**Interfaces:**
- Produces:
  - `AwardedBadgeDTO.featured: boolean`
  - `const MAX_FEATURED_BADGES = 3`
  - `interface UpdateFeaturedBadgesPayload { badgeIds: string[] }`

- [ ] **Step 1: Editar `packages/shared/src/badge.ts`**

Adicione o campo `featured` em `AwardedBadgeDTO` e, ao final do arquivo, a constante e o tipo de payload. O `AwardedBadgeDTO` fica assim:

```ts
export interface AwardedBadgeDTO {
  id: string
  badge: BadgeDTO
  awardedAt: string
  source: BadgeAwardSource
  awardedBy: { id: string; name: string } | null
  /** Selo escolhido pelo usuário para destacar no card da galeria de Lendas. */
  featured: boolean
}
```

E no fim do arquivo:

```ts
/** Máximo de selos que um usuário pode destacar no card da galeria de Lendas. */
export const MAX_FEATURED_BADGES = 3

/** Corpo de PUT /me/featured-badges — ids de UserBadge a destacar (= AwardedBadgeDTO.id). */
export interface UpdateFeaturedBadgesPayload {
  badgeIds: string[]
}
```

- [ ] **Step 2: Buildar o pacote compartilhado**

Run: `pnpm --filter @legends/shared build`
Expected: build conclui sem erros de tipo.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/badge.ts
git commit -m "feat(shared): featured em AwardedBadgeDTO + MAX_FEATURED_BADGES"
```

---

### Task 2: Coluna `featured` em `UserBadge` (Prisma + migration)

Adiciona a coluna no schema e gera a migration. Default `false` cobre todas as linhas existentes — sem backfill.

**Files:**
- Modify: `apps/api/prisma/schema.prisma:160-176`
- Create: `apps/api/prisma/migrations/<timestamp>_add_userbadge_featured/migration.sql` (gerada)

**Interfaces:**
- Produces: campo `featured Boolean @default(false)` no model `UserBadge` (e no Prisma Client gerado).

- [ ] **Step 1: Editar o model `UserBadge` em `apps/api/prisma/schema.prisma`**

Adicione a linha `featured` logo após `awardedAt`:

```prisma
model UserBadge {
  id          String           @id @default(cuid())
  userId      String
  badgeId     String
  periodId    String?
  source      BadgeAwardSource @default(AUTO)
  awardedById String?
  awardedAt   DateTime         @default(now())
  featured    Boolean          @default(false)

  user      Badge ... // (mantenha as relações existentes inalteradas)
}
```

(Mantenha as relações `user`/`badge`/`awardedBy`, o `@@unique` e o `@@index` exatamente como estão — só insira a linha `featured`.)

- [ ] **Step 2: Subir o Postgres (se ainda não estiver de pé)**

Run: `pnpm db:up`
Expected: container do Postgres em execução.

- [ ] **Step 3: Gerar e aplicar a migration**

Run: `pnpm --filter @legends/api exec prisma migrate dev --name add_userbadge_featured`
Expected: cria `apps/api/prisma/migrations/<timestamp>_add_userbadge_featured/`, aplica no banco e regenera o Prisma Client. A migration SQL deve conter algo como `ALTER TABLE "UserBadge" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): coluna featured em UserBadge"
```

---

### Task 3: Service — destaques no showcase + `setFeaturedBadges` + serialize

Faz o showcase ordenar destaques primeiro, adiciona o service que substitui o conjunto de destaques (validando posse e limite) e inclui `featured` no DTO.

**Files:**
- Modify: `apps/api/src/services/profile-service.ts`
- Modify: `apps/api/src/lib/serialize.ts:103-111`
- Test: `apps/api/src/services/profile-service.test.ts`

**Interfaces:**
- Consumes: `MAX_FEATURED_BADGES` (Task 1), coluna `featured` (Task 2).
- Produces:
  - `class ProfileError extends Error { readonly status: number }`
  - `setFeaturedBadges(userId: string, badgeIds: string[]): Promise<AwardedBadge[]>` — `AwardedBadge` é o tipo já exportado/usado em `profile-service.ts` (`Prisma.UserBadgeGetPayload<{ include: { badge: true; awardedBy: true } }>`).
  - `listShowcase()` passa a retornar, por usuário, badges ordenados `featured DESC, awardedAt DESC`.
  - `toAwardedBadgeDTO` passa a incluir `featured`.

- [ ] **Step 1: Escrever os testes que falham em `apps/api/src/services/profile-service.test.ts`**

Adicione, ao final do arquivo (antes do `})` que fecha o `describe`, ou num novo `describe`), helpers e testes. Coloque no topo do arquivo o import:

```ts
import { getUserProfile, listShowcase, listVotesReceived, setFeaturedBadges, ProfileError } from './profile-service'
```

E acrescente este bloco no fim do arquivo:

```ts
describe('featured badges', () => {
  async function makeBadge(slug: string) {
    return prisma.badge.create({
      data: { slug, name: slug, description: 'd', kind: 'IMPACT', iconKey: 'fire', threshold: 0 },
    })
  }

  it('coloca os selos destacados na frente no showcase', async () => {
    const user = await makeUser('Vitrine')
    const b1 = await makeBadge('antigo')
    const b2 = await makeBadge('novo')
    // antigo é o mais recente por awardedAt; sem destaque viria primeiro
    const oldUb = await prisma.userBadge.create({ data: { userId: user.id, badgeId: b1.id, awardedAt: new Date('2026-06-02') } })
    await prisma.userBadge.create({ data: { userId: user.id, badgeId: b2.id, awardedAt: new Date('2026-06-01') } })

    await setFeaturedBadges(user.id, [oldUb.id])

    const rows = await listShowcase()
    const row = rows.find((r) => r.user.id === user.id)!
    expect(row.badges[0].id).toBe(oldUb.id)
    expect(row.badges[0].featured).toBe(true)
  })

  it('substitui o conjunto de destaques (idempotente)', async () => {
    const user = await makeUser('Troca')
    const b1 = await makeBadge('um')
    const b2 = await makeBadge('dois')
    const ub1 = await prisma.userBadge.create({ data: { userId: user.id, badgeId: b1.id } })
    const ub2 = await prisma.userBadge.create({ data: { userId: user.id, badgeId: b2.id } })

    await setFeaturedBadges(user.id, [ub1.id])
    await setFeaturedBadges(user.id, [ub2.id])

    const after = await prisma.userBadge.findMany({ where: { userId: user.id, featured: true } })
    expect(after.map((u) => u.id)).toEqual([ub2.id])
  })

  it('rejeita selo que não pertence ao usuário', async () => {
    const user = await makeUser('Dono')
    const outro = await makeUser('Outro')
    const badge = await makeBadge('alheio')
    const ub = await prisma.userBadge.create({ data: { userId: outro.id, badgeId: badge.id } })

    await expect(setFeaturedBadges(user.id, [ub.id])).rejects.toBeInstanceOf(ProfileError)
  })

  it('rejeita acima do limite de destaques', async () => {
    const user = await makeUser('Excesso')
    const ids: string[] = []
    for (let i = 0; i < 4; i += 1) {
      const badge = await makeBadge(`selo-${i}`)
      const ub = await prisma.userBadge.create({ data: { userId: user.id, badgeId: badge.id } })
      ids.push(ub.id)
    }
    await expect(setFeaturedBadges(user.id, ids)).rejects.toBeInstanceOf(ProfileError)
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `pnpm --filter @legends/api test -- profile-service`
Expected: FAIL — `setFeaturedBadges`/`ProfileError` não existem (erro de import/compilação).

- [ ] **Step 3: Implementar no `apps/api/src/services/profile-service.ts`**

Adicione o import do limite no topo:

```ts
import { MAX_FEATURED_BADGES } from '@legends/shared'
```

Troque o `orderBy` do `userBadge.findMany` dentro de `listShowcase()` (linha ~33) para ordenar destaques primeiro:

```ts
prisma.userBadge.findMany({
  include: { badge: true, awardedBy: true },
  orderBy: [{ featured: 'desc' }, { awardedAt: 'desc' }],
}),
```

E adicione, ao final do arquivo, a classe de erro e o service:

```ts
export class ProfileError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ProfileError'
  }
}

/**
 * Substitui o conjunto de selos destacados do usuário na galeria de Lendas.
 * Valida que todos os ids pertencem a ele e respeita MAX_FEATURED_BADGES.
 * Idempotente: zera os destaques atuais e marca apenas os escolhidos.
 */
export async function setFeaturedBadges(userId: string, badgeIds: string[]): Promise<AwardedBadge[]> {
  const unique = [...new Set(badgeIds)]
  if (unique.length > MAX_FEATURED_BADGES) {
    throw new ProfileError(`Você pode destacar no máximo ${MAX_FEATURED_BADGES} selos.`, 400)
  }
  if (unique.length > 0) {
    const owned = await prisma.userBadge.findMany({
      where: { id: { in: unique }, userId },
      select: { id: true },
    })
    if (owned.length !== unique.length) {
      throw new ProfileError('Selo não encontrado entre os seus.', 400)
    }
  }

  await prisma.$transaction([
    prisma.userBadge.updateMany({ where: { userId, featured: true }, data: { featured: false } }),
    ...(unique.length > 0
      ? [prisma.userBadge.updateMany({ where: { userId, id: { in: unique } }, data: { featured: true } })]
      : []),
  ])

  return prisma.userBadge.findMany({
    where: { userId },
    include: { badge: true, awardedBy: true },
    orderBy: [{ featured: 'desc' }, { awardedAt: 'desc' }],
  })
}
```

- [ ] **Step 4: Incluir `featured` no DTO em `apps/api/src/lib/serialize.ts`**

Em `toAwardedBadgeDTO` (linha ~103), adicione o campo no objeto retornado:

```ts
export function toAwardedBadgeDTO(awarded: AwardedBadgePayload): AwardedBadgeDTO {
  return {
    id: awarded.id,
    badge: toBadgeDTO(awarded.badge),
    awardedAt: awarded.awardedAt.toISOString(),
    source: awarded.source,
    awardedBy: awarded.awardedBy ? { id: awarded.awardedBy.id, name: awarded.awardedBy.name } : null,
    featured: awarded.featured,
  }
}
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `pnpm --filter @legends/api test -- profile-service`
Expected: PASS (4 novos testes verdes; os existentes continuam verdes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/profile-service.ts apps/api/src/services/profile-service.test.ts apps/api/src/lib/serialize.ts
git commit -m "feat(api): destaca selos no showcase e service setFeaturedBadges"
```

---

### Task 4: Endpoint `PUT /me/featured-badges`

Route fina que valida o corpo com Zod, chama o service e serializa a saída.

**Files:**
- Modify: `apps/api/src/routes/profile.ts`
- Test: `apps/api/src/routes/profile.test.ts`

**Interfaces:**
- Consumes: `setFeaturedBadges`, `ProfileError` (Task 3); `MAX_FEATURED_BADGES` (Task 1); `toAwardedBadgeDTO` (já importado em profile.ts).
- Produces: `PUT /me/featured-badges` → `200 { badges: AwardedBadgeDTO[] }`; `400 { message, issues? }`; `401` sem auth.

- [ ] **Step 1: Escrever os testes que falham em `apps/api/src/routes/profile.test.ts`**

Adicione um novo `describe` ao final do arquivo (depois do `describe('profile routes', ...)`). Note que `setup()` registra a usuária **Ana** e devolve `token` dela; os selos destacados devem pertencer a Ana (`reg.json().user.id`). Ajuste `setup()` para também retornar o id da Ana:

Primeiro, no `setup()` existente, troque a linha do token por:

```ts
  const token = reg.json().accessToken as string
  const meId = reg.json().user.id as string
```

e o `return` por:

```ts
  return { app, token, meId, target }
```

Depois adicione o bloco de testes:

```ts
describe('PUT /me/featured-badges', () => {
  async function makeOwnedBadge(meId: string, slug: string) {
    const badge = await prisma.badge.create({
      data: { slug, name: slug, description: 'd', kind: 'IMPACT', iconKey: 'fire', threshold: 0 },
    })
    return prisma.userBadge.create({ data: { userId: meId, badgeId: badge.id } })
  }

  it('destaca os selos escolhidos e retorna a lista com featured', async () => {
    const { app, token, meId } = await setup()
    const ub = await makeOwnedBadge(meId, 'meu-selo')

    const res = await app.inject({
      method: 'PUT',
      url: '/me/featured-badges',
      headers: { authorization: `Bearer ${token}` },
      payload: { badgeIds: [ub.id] },
    })

    expect(res.statusCode).toBe(200)
    const featured = res.json().badges.find((b: { id: string; featured: boolean }) => b.id === ub.id)
    expect(featured.featured).toBe(true)
    await app.close()
  })

  it('aceita lista vazia (limpa os destaques)', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'PUT',
      url: '/me/featured-badges',
      headers: { authorization: `Bearer ${token}` },
      payload: { badgeIds: [] },
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('rejeita acima do limite (400)', async () => {
    const { app, token, meId } = await setup()
    const ids: string[] = []
    for (let i = 0; i < 4; i += 1) {
      const ub = await makeOwnedBadge(meId, `extra-${i}`)
      ids.push(ub.id)
    }
    const res = await app.inject({
      method: 'PUT',
      url: '/me/featured-badges',
      headers: { authorization: `Bearer ${token}` },
      payload: { badgeIds: ids },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejeita selo de outro usuário (400)', async () => {
    const { app, token, target } = await setup()
    const badge = await prisma.badge.create({
      data: { slug: 'alheio', name: 'alheio', description: 'd', kind: 'IMPACT', iconKey: 'fire', threshold: 0 },
    })
    const ub = await prisma.userBadge.create({ data: { userId: target.id, badgeId: badge.id } })
    const res = await app.inject({
      method: 'PUT',
      url: '/me/featured-badges',
      headers: { authorization: `Bearer ${token}` },
      payload: { badgeIds: [ub.id] },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('exige autenticação (401)', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'PUT', url: '/me/featured-badges', payload: { badgeIds: [] } })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- routes/profile`
Expected: FAIL — rota inexistente (404 onde se espera 200/400).

- [ ] **Step 3: Implementar a rota em `apps/api/src/routes/profile.ts`**

Atualize os imports do topo do arquivo:

```ts
import { z } from 'zod'
import { MAX_FEATURED_BADGES } from '@legends/shared'
import { getUserProfile, listVotesReceived, setFeaturedBadges, ProfileError } from '../services/profile-service'
```

(mantenha os demais imports já existentes). Acima de `export async function profileRoutes`, declare o schema:

```ts
const featuredBadgesSchema = z.object({
  badgeIds: z.array(z.string()).max(MAX_FEATURED_BADGES),
})
```

E, dentro de `profileRoutes`, adicione a rota (por exemplo logo após `GET /users/:id/votes`):

```ts
  app.put('/me/featured-badges', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = featuredBadgesSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    try {
      const badges = await setFeaturedBadges(request.user.sub, parsed.data.badgeIds)
      return reply.send({ badges: badges.map(toAwardedBadgeDTO) })
    } catch (err) {
      if (err instanceof ProfileError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- routes/profile`
Expected: PASS (5 novos testes verdes; os existentes continuam verdes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/profile.ts apps/api/src/routes/profile.test.ts
git commit -m "feat(api): endpoint PUT /me/featured-badges"
```

---

### Task 5: `BadgeGallery` — modo de edição de destaques

Componente presentacional: gerencia o estado local da seleção e chama `onSaveFeatured` com os ids escolhidos. Sem chamada HTTP aqui.

**Files:**
- Modify: `apps/web/src/pages/profile/BadgeGallery.tsx`
- Test: `apps/web/src/pages/profile/BadgeGallery.test.tsx`

**Interfaces:**
- Consumes: `AwardedBadgeDTO.featured`, `MAX_FEATURED_BADGES` (Task 1).
- Produces: novas props opcionais em `BadgeGallery`:
  - `editable?: boolean` (default `false`)
  - `onSaveFeatured?: (badgeIds: string[]) => Promise<void> | void`

- [ ] **Step 1: Escrever os testes que falham em `apps/web/src/pages/profile/BadgeGallery.test.tsx`**

Adicione ao final do arquivo (dentro do `describe('BadgeGallery', ...)`). Use `userEvent`. Acrescente o import no topo:

```ts
import userEvent from '@testing-library/user-event'
```

E os testes:

```ts
  it('não mostra edição quando não é editável', () => {
    wrap(<BadgeGallery badges={badges} emptyLabel="vazio" />)
    expect(screen.queryByRole('button', { name: /escolher destaques/i })).not.toBeInTheDocument()
  })

  it('salva os ids dos selos selecionados', async () => {
    const onSaveFeatured = vi.fn().mockResolvedValue(undefined)
    wrap(<BadgeGallery badges={badges} emptyLabel="vazio" editable onSaveFeatured={onSaveFeatured} />)

    await userEvent.click(screen.getByRole('button', { name: /escolher destaques/i }))
    await userEvent.click(screen.getByRole('button', { name: /Conector do Time/i }))
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }))

    expect(onSaveFeatured).toHaveBeenCalledWith(['ub1'])
  })

  it('limita a seleção a MAX_FEATURED_BADGES', async () => {
    const many: AwardedBadgeDTO[] = [0, 1, 2, 3].map((i) => ({
      id: `u${i}`,
      awardedAt: '2026-06-01T00:00:00.000Z',
      source: 'AUTO',
      awardedBy: null,
      featured: false,
      badge: { id: `b${i}`, slug: `s${i}`, name: `Selo ${i}`, description: 'd', kind: 'IMPACT', iconKey: 'fire', threshold: 0, categorySlug: null },
    }))
    wrap(<BadgeGallery badges={many} emptyLabel="vazio" editable onSaveFeatured={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /escolher destaques/i }))
    await userEvent.click(screen.getByRole('button', { name: /Selo 0/i }))
    await userEvent.click(screen.getByRole('button', { name: /Selo 1/i }))
    await userEvent.click(screen.getByRole('button', { name: /Selo 2/i }))
    // o quarto deve estar desabilitado (limite atingido)
    expect(screen.getByRole('button', { name: /Selo 3/i })).toBeDisabled()
  })
```

Acrescente o import de `vi` se ainda não houver: troque a primeira linha para `import { describe, it, expect, vi } from 'vitest'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- BadgeGallery`
Expected: FAIL — não há botão "Escolher destaques".

- [ ] **Step 3: Implementar o modo de edição em `apps/web/src/pages/profile/BadgeGallery.tsx`**

Reescreva o componente para suportar edição. Conteúdo completo do arquivo:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MAX_FEATURED_BADGES, type AwardedBadgeDTO } from '@legends/shared'
import { BadgeEmblem } from '../../components/BadgeEmblem'

export function BadgeGallery({
  badges,
  emptyLabel,
  className = '',
  highlightId,
  editable = false,
  onSaveFeatured,
}: {
  badges: AwardedBadgeDTO[]
  emptyLabel: string
  className?: string
  /** Quando vindo do mural (deep-link): rola até e destaca este selo (id do UserBadge). */
  highlightId?: string | null
  /** Habilita o modo de edição de destaques (perfil do próprio usuário). */
  editable?: boolean
  /** Persiste o conjunto de destaques (ids de UserBadge). */
  onSaveFeatured?: (badgeIds: string[]) => Promise<void> | void
}) {
  const scrolledRef = useRef(false)
  useEffect(() => {
    scrolledRef.current = false
  }, [highlightId])
  useEffect(() => {
    if (!highlightId || scrolledRef.current) return
    if (!badges.some((b) => b.id === highlightId)) return
    scrolledRef.current = true
    document.getElementById(`badge-${highlightId}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [highlightId, badges])

  const featuredIds = useMemo(() => badges.filter((b) => b.featured).map((b) => b.id), [badges])
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string[]>(featuredIds)
  const [saving, setSaving] = useState(false)

  function startEditing() {
    setSelected(featuredIds)
    setEditing(true)
  }
  function cancelEditing() {
    setSelected(featuredIds)
    setEditing(false)
  }
  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= MAX_FEATURED_BADGES) return prev
      return [...prev, id]
    })
  }
  async function save() {
    if (!onSaveFeatured) return
    setSaving(true)
    try {
      await onSaveFeatured(selected)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const canEdit = editable && badges.length > 0 && Boolean(onSaveFeatured)

  return (
    <div className={`rounded-xl border border-outline-variant/40 bg-surface-container p-lg ${className}`}>
      <div className="mb-lg flex items-center justify-between gap-sm">
        <h3 className="font-headline text-headline-md text-on-surface">Galeria de selos</h3>
        {editing ? (
          <span className="font-label text-label-sm text-on-surface-variant">
            {selected.length}/{MAX_FEATURED_BADGES} em destaque
          </span>
        ) : (
          <Link to="/selos" className="font-label text-label-md text-primary hover:underline">
            Ver todos
          </Link>
        )}
      </div>

      {canEdit && (
        <div className="mb-md flex items-center justify-end gap-sm">
          {editing ? (
            <>
              <button
                type="button"
                onClick={cancelEditing}
                disabled={saving}
                className="rounded-md border border-outline-variant/60 px-md py-xs font-label text-label-sm text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-md bg-primary px-md py-xs font-label text-label-sm font-bold text-on-primary transition-colors hover:bg-primary-container disabled:opacity-50"
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={startEditing}
              className="rounded-md border border-outline-variant/60 px-md py-xs font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
            >
              Escolher destaques
            </button>
          )}
        </div>
      )}

      {editing && (
        <p className="mb-md text-body-sm text-on-surface-variant">
          Escolha até {MAX_FEATURED_BADGES} selos para destacar no card da galeria de Lendas.
        </p>
      )}

      {badges.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">{emptyLabel}</p>
      ) : (
        <div className="grid grid-cols-3 gap-md">
          {badges.map((awarded) => {
            const isSelected = selected.includes(awarded.id)
            const limitReached = selected.length >= MAX_FEATURED_BADGES
            const baseClass =
              'group flex flex-col items-center rounded-lg border bg-surface-container-high p-md transition-all'
            if (editing) {
              return (
                <button
                  key={awarded.id}
                  type="button"
                  onClick={() => toggle(awarded.id)}
                  disabled={!isSelected && limitReached}
                  aria-pressed={isSelected}
                  className={`${baseClass} ${isSelected ? 'border-primary ring-2 ring-primary/40' : 'border-outline-variant/20 hover:border-outline-variant/50'} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <div className="mb-sm transition-transform group-hover:scale-110">
                    <BadgeEmblem badge={awarded.badge} size={64} />
                  </div>
                  <p className="text-center font-label text-label-sm text-on-surface">{awarded.badge.name}</p>
                </button>
              )
            }
            return (
              <div
                key={awarded.id}
                id={`badge-${awarded.id}`}
                title={awarded.badge.description}
                className={`${baseClass} cursor-default ${awarded.featured ? 'border-primary/50' : 'border-outline-variant/20 hover:border-outline-variant/50'} ${awarded.id === highlightId ? 'mural-highlight' : ''}`}
              >
                <div className="mb-sm transition-transform group-hover:scale-110">
                  <BadgeEmblem badge={awarded.badge} size={64} />
                </div>
                <p className="text-center font-label text-label-sm text-on-surface">{awarded.badge.name}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web test -- BadgeGallery`
Expected: PASS (testes novos e existentes verdes — o teste de `highlightId` continua válido pois o modo normal mantém `id="badge-..."` e a classe `mural-highlight`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/profile/BadgeGallery.tsx apps/web/src/pages/profile/BadgeGallery.test.tsx
git commit -m "feat(web): modo de edição de destaques na BadgeGallery"
```

---

### Task 6: Ligar a `BadgeGallery` na `ProfilePage`

Passa `editable` (só no próprio perfil) e o `onSaveFeatured` que chama a API e invalida as queries `["profile", id]` e `["showcase"]`.

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.tsx`
- Test: `apps/web/src/pages/ProfilePage.test.tsx`

**Interfaces:**
- Consumes: props `editable`/`onSaveFeatured` de `BadgeGallery` (Task 5); `UpdateFeaturedBadgesPayload` (Task 1); endpoint `PUT /me/featured-badges` (Task 4).

- [ ] **Step 1: Implementar a ligação em `apps/web/src/pages/ProfilePage.tsx`**

Adicione `useQueryClient` ao import do React Query (linha 3) e `UpdateFeaturedBadgesPayload` ao import de tipos (linha 4):

```ts
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProfileDTO, UpdateFeaturedBadgesPayload, VoteDTO } from "@legends/shared";
```

Dentro do componente `ProfilePage`, logo após `const isOwnProfile = authUser?.id === id;` (linha ~70), declare o client e o handler:

```ts
  const queryClient = useQueryClient();

  async function saveFeatured(badgeIds: string[]) {
    const body: UpdateFeaturedBadgesPayload = { badgeIds };
    await apiFetch(`/me/featured-badges`, { method: "PUT", body: JSON.stringify(body) });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["profile", id] }),
      queryClient.invalidateQueries({ queryKey: ["showcase"] }),
    ]);
  }
```

Nas **duas** ocorrências de `<BadgeGallery ... />` (o ramo `!isLead` por volta da linha 225 e o ramo `isLead` por volta da linha 389), adicione as props `editable` e `onSaveFeatured`. Ex. no ramo `!isLead`:

```tsx
          <BadgeGallery
            badges={badges}
            emptyLabel="Nenhum selo conquistado ainda."
            className="col-span-12 lg:col-span-5"
            highlightId={highlightBadgeId}
            editable={isOwnProfile}
            onSaveFeatured={saveFeatured}
          />
```

E no ramo `isLead`:

```tsx
          <BadgeGallery
            badges={badges}
            emptyLabel="Nenhum selo atribuído ainda."
            className="col-span-12 lg:col-span-5"
            highlightId={highlightBadgeId}
            editable={isOwnProfile}
            onSaveFeatured={saveFeatured}
          />
```

- [ ] **Step 2: Escrever o teste em `apps/web/src/pages/ProfilePage.test.tsx`**

Abra o arquivo e siga o padrão de mocks já usado nele (provavelmente mocka `apiFetch` e `useAuth`). Adicione um teste que, com `authUser.id === id` e um perfil com ≥1 selo, o botão "Escolher destaques" aparece e ao salvar chama `apiFetch` com `PUT /me/featured-badges`.

Use o helper/setup existente do arquivo. Esqueleto a adaptar aos mocks locais (não reinvente o setup — reaproveite o que o arquivo já tem para renderizar a ProfilePage do próprio usuário com selos):

```tsx
  it("permite o próprio usuário escolher destaques", async () => {
    // ... renderizar ProfilePage como dono do perfil, com badges contendo
    //     um selo de id 'ub1' (featured: false). Reaproveite o setup do arquivo.
    await userEvent.click(await screen.findByRole("button", { name: /escolher destaques/i }));
    await userEvent.click(screen.getByRole("button", { name: /Conector do Time/i }));
    await userEvent.click(screen.getByRole("button", { name: /salvar/i }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/me/featured-badges",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ badgeIds: ["ub1"] }) }),
    );
  });
```

> Nota para quem implementa: leia primeiro `ProfilePage.test.tsx` e use exatamente o mesmo mecanismo de mock de `apiFetch`/`useAuth`/dados de perfil que os testes existentes usam (nome do mock, formato do `ProfileDTO`, como o `id` do `useParams` é definido). O selo deve pertencer ao próprio usuário e ter `featured: false`.

- [ ] **Step 3: Rodar e ver passar**

Run: `pnpm --filter @legends/web test -- ProfilePage`
Expected: PASS (teste novo e existentes verdes).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ProfilePage.tsx apps/web/src/pages/ProfilePage.test.tsx
git commit -m "feat(web): perfil escolhe selos destacados na galeria de Lendas"
```

---

### Task 7: Verificação ponta a ponta

Garante que tudo compila e os testes passam juntos. (A `LegendsPage` **não** precisa de mudança: já exibe `badges.slice(0, 3)` e o backend ordena destaques primeiro.)

**Files:** nenhum (apenas verificação)

- [ ] **Step 1: Build geral**

Run: `pnpm build`
Expected: todos os workspaces buildam sem erro de tipo.

- [ ] **Step 2: Suíte completa (Postgres de pé)**

Run: `pnpm db:up && pnpm test`
Expected: PASS em api e web.

- [ ] **Step 3 (opcional, manual): conferir no app**

Run: `pnpm dev`
Verifique: abrir o próprio perfil → "Escolher destaques" → selecionar até 3 → Salvar; abrir `/lendas` e confirmar que os selos escolhidos aparecem primeiro no card.

---

## Self-Review

**Spec coverage:**
- Schema/migration `featured` → Task 2. ✓
- Contrato (`AwardedBadgeDTO.featured`, `MAX_FEATURED_BADGES`, payload) → Task 1. ✓
- Serialize inclui `featured` → Task 3 (Step 4). ✓
- Endpoint `PUT /me/featured-badges` (route fina + Zod) → Task 4. ✓
- Service `setFeaturedBadges` (posse, limite, transação, idempotente) → Task 3. ✓
- `listShowcase` ordena `featured DESC, awardedAt DESC` (fallback automático) → Task 3. ✓
- `BadgeGallery` modo edição (toggle, limite, salvar/cancelar) → Task 5. ✓
- `ProfilePage` liga `editable`/`onSaveFeatured` + invalida `["profile", id]` e `["showcase"]` → Task 6. ✓
- `LegendsPage` sem mudança de lógica → Task 7 (nota). ✓
- Testes API (showcase ordering, fallback, posse, limite, idempotência, endpoint 200/400/401) → Tasks 3 e 4. ✓
- Testes web (toggle, limite, payload do salvar) → Tasks 5 e 6. ✓
- Fora de escopo (ordenação manual, realce novo no card, mudança no perfil) → respeitado. ✓

**Placeholder scan:** Os únicos pontos "a adaptar" são no teste da Task 6, por dependerem do mecanismo de mock já existente em `ProfilePage.test.tsx` — instruído explicitamente a reaproveitar o setup do arquivo, não a inventar. Sem TBD/TODO de implementação.

**Type consistency:** `setFeaturedBadges(userId, badgeIds): Promise<AwardedBadge[]>`, `ProfileError`, `MAX_FEATURED_BADGES`, `UpdateFeaturedBadgesPayload`, props `editable`/`onSaveFeatured` e `AwardedBadgeDTO.featured` usados de forma consistente entre tasks. O `featured` flui Prisma → serialize → DTO → front sem renomeações.
