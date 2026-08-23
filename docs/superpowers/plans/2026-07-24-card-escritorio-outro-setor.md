# Card do escritório: colega de outro setor + nome do setor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrige o card do escritório que hoje mostra menos informação pra colega de outro setor
(efeito colateral da sectorização de Lendas), corrige um bug independente onde o fallback do card
ignora o avatar já disponível, e adiciona o nome do setor ao card (Lendas/escritório) e ao perfil.

**Architecture:** Sem migration. `PublicUser` ganha `sectorName: string` (resolvido em lote via
novo helper `sectorNamesFor`, populado só nos 2 call sites relevantes — showcase e perfil — os
demais continuam com `''`). O card do escritório passa a pedir `sectorId=all` (mesmo padrão de
Lendas/Destaques) e o fallback mínimo passa a repassar os campos de avatar do `occupant`.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Vitest, React 18, TypeScript strict/ESM.

## Global Constraints

- Sem migration nesta feature.
- `pnpm db:up` precisa estar de pé antes de rodar testes da API.
- Mensagens ao usuário em pt-BR; identificadores em inglês.
- `toPublicUser` não pode quebrar nenhum call site existente — `sectorName` é opcional com
  default `''`.
- Rode só o(s) arquivo(s) de teste alterado(s) durante a implementação; `pnpm test` completo só
  entra na verificação final (Task 3).

---

### Task 1: `sectorName` em `PublicUser` — resolvido em showcase e perfil

**Files:**
- Modify: `apps/api/src/lib/sector-features.ts` (novo helper `sectorNamesFor`)
- Modify: `packages/shared/src/auth.ts` (`PublicUser.sectorName`)
- Modify: `apps/api/src/lib/serialize.ts` (`toPublicUser` ganha 3º parâmetro opcional)
- Modify: `apps/api/src/routes/users.ts` (`GET /users/showcase` resolve e passa `sectorName`)
- Modify: `apps/api/src/routes/profile.ts` (`GET /users/:id/profile` resolve e passa `sectorName`)
- Test: `apps/api/src/lib/sector-features.test.ts`, `apps/api/src/routes/users.test.ts`,
  `apps/api/src/routes/profile.test.ts`

**Interfaces:**
- Produces: `sectorNamesFor(sectorIds: string[]): Promise<Map<string, string>>`.
- Produces: `PublicUser.sectorName: string` (consumido pela Task 2 — frontend).
- Produces: `toPublicUser(user: User, sectorFeatures: string[] = [], sectorName: string = ''): PublicUser`
  (assinatura estendida, retrocompatível).

- [ ] **Step 1: Escrever o teste do helper (falhando)**

Modify `apps/api/src/lib/sector-features.test.ts` — adicionar ao final do arquivo:

```ts
describe('sectorNamesFor', () => {
  it('resolve o nome de vários setores em uma query', async () => {
    const names = await sectorNamesFor(['sector-dev-produto'])
    expect(names.get('sector-dev-produto')).toBe('Desenvolvimento de Produto')
  })

  it('retorna Map vazio pra lista vazia, sem consultar o banco', async () => {
    const names = await sectorNamesFor([])
    expect(names.size).toBe(0)
  })

  it('ignora setor inexistente (não entra no Map)', async () => {
    const names = await sectorNamesFor(['sector-dev-produto', 'setor-que-nao-existe'])
    expect(names.has('sector-dev-produto')).toBe(true)
    expect(names.has('setor-que-nao-existe')).toBe(false)
  })
})
```

Adicionar `sectorNamesFor` ao import já existente no topo do arquivo:
`import { sectorFeaturesFor, sectorNamesFor } from './sector-features'`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/lib/sector-features.test.ts -t "sectorNamesFor"`
Expected: FAIL — `sectorNamesFor` não existe ainda

- [ ] **Step 3: Implementar o helper**

Modify `apps/api/src/lib/sector-features.ts` (arquivo completo):

```ts
import { prisma } from './prisma'

/** Features habilitadas para o setor (via `Sector.enabledFeatures`); [] se o setor não existir. */
export async function sectorFeaturesFor(sectorId: string): Promise<string[]> {
  const sector = await prisma.sector.findUnique({ where: { id: sectorId } })
  return Array.isArray(sector?.enabledFeatures) ? (sector.enabledFeatures as string[]) : []
}

/** Nome de cada setor, em lote (evita N+1 ao resolver vários usuários de setores diferentes). */
export async function sectorNamesFor(sectorIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(sectorIds)]
  if (unique.length === 0) return new Map()
  const sectors = await prisma.sector.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
  return new Map(sectors.map((s) => [s.id, s.name]))
}
```

- [ ] **Step 4: Rodar o teste do helper e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/lib/sector-features.test.ts`
Expected: PASS (5 testes — 2 pré-existentes de `sectorFeaturesFor` + 3 novos)

- [ ] **Step 5: Adicionar `sectorName` ao `PublicUser` e ao `toPublicUser`**

Modify `packages/shared/src/auth.ts`:

```ts
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
  /** Nome do setor — resolvido só onde relevante (showcase, perfil); '' nos demais DTOs. */
  sectorName: string
  enabledFeatures: FeatureKey[]
  /** Features efetivas do SETOR do usuário (vazio para DTOs de "outro usuário" onde isso não é necessário). */
  sectorFeatures: FeatureKey[]
}
```

Modify `apps/api/src/lib/serialize.ts` — a função `toPublicUser` (mantém tudo igual, só adiciona o
3º parâmetro e o campo no retorno):

```ts
export function toPublicUser(user: User, sectorFeatures: string[] = [], sectorName = ''): PublicUser {
  return {
    id: user.id,
    name: user.name,
    // E-mail é ocultado para ex-lendas (quem já saiu do time).
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
    sectorName,
    enabledFeatures: Array.isArray(user.enabledFeatures) ? (user.enabledFeatures as FeatureKey[]) : [],
    sectorFeatures: sectorFeatures as FeatureKey[],
  }
}
```

- [ ] **Step 6: Escrever os testes de rota (falhando)**

Modify `apps/api/src/routes/users.test.ts` — dentro de `describe('GET /users/showcase', ...)`,
adicionar (depois dos testes de `sectorId` já existentes):

```ts
  it('inclui sectorName correto por entry, inclusive misturando setores com ?sectorId=all', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'viewer-sectorname@empresa.com')
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-users-showcase-sectorname@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Showcase F (sectorName)', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    await prisma.user.create({ data: { name: 'Do Setor F', email: 'do-setor-f@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })

    const res = await app.inject({ method: 'GET', url: '/users/showcase?sectorId=all', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const entries = res.json().entries as Array<{ user: { name: string; sectorName: string } }>
    const found = entries.find((e) => e.user.name === 'Do Setor F')
    expect(found?.user.sectorName).toBe('Setor Showcase F (sectorName)')
    const viewerEntry = entries.find((e) => e.user.name.startsWith('viewer-sectorname'))
    expect(viewerEntry?.user.sectorName).toBe('Desenvolvimento de Produto')
  })
```

Modify `apps/api/src/routes/profile.test.ts` — dentro de `describe('profile routes', ...)`,
adicionar (depois do teste `'votingEnabled reflete a feature "votar" do SETOR do dono do perfil...'`):

```ts
  it('inclui o nome do setor do dono do perfil (user.sectorName)', async () => {
    const { app, token, target } = await setup()
    const res = await app.inject({ method: 'GET', url: `/users/${target.id}/profile`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.sectorName).toBe('Desenvolvimento de Produto')
    await app.close()
  })
```

- [ ] **Step 7: Rodar e confirmar que falham**

Run: `pnpm --filter @legends/api exec vitest run src/routes/users.test.ts src/routes/profile.test.ts -t "sectorName"`
Expected: FAIL — `sectorName` ainda não é resolvido nas rotas (vem `''`)

- [ ] **Step 8: Popular `sectorName` em `GET /users/showcase`**

Modify `apps/api/src/routes/users.ts` (arquivo completo):

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { listShowcase } from '../services/profile-service'
import { sectorNamesFor } from '../lib/sector-features'
import { toAwardedBadgeDTO, toPublicUser } from '../lib/serialize'

const showcaseQuerySchema = z.object({ former: z.string().optional(), sectorId: z.string().optional() })

export async function userRoutes(app: FastifyInstance) {
  app.get('/users', { onRequest: [app.authenticate] }, async (request, reply) => {
    const users = await prisma.user.findMany({
      // Time: colegas do mesmo setor, menos admins. Inclui lideranças (LEAD), que fazem parte do
      // time e têm perfil, mas não recebem votos (filtradas na tela de votação).
      where: {
        active: true,
        role: { notIn: ['ADMIN', 'SUBADMIN'] },
        id: { not: request.user.sub },
        sectorId: request.user.sectorId,
      },
      orderBy: { name: 'asc' },
    })
    return reply.send({ users: users.map((u) => toPublicUser(u)) })
  })

  // Galeria de conquistas: devs ativos com reconhecimentos e selos agregados.
  // Com ?former=1 (ou true), retorna ex-lendas em vez dos ativos.
  // Com ?sectorId=<id>, mostra outro setor (padrão: o próprio); ?sectorId=all mostra todos.
  // THIRD_PARTY nunca escolhe: o parâmetro é ignorado, sempre vê o próprio setor.
  app.get('/users/showcase', { onRequest: [app.authenticate, app.requireFeature('lendas')] }, async (request, reply) => {
    const parsed = showcaseQuerySchema.safeParse(request.query)
    const former = parsed.success ? parsed.data.former : undefined
    const requestedSectorId = parsed.success ? parsed.data.sectorId : undefined
    const sectorId =
      request.user.role === 'THIRD_PARTY'
        ? request.user.sectorId
        : requestedSectorId === 'all'
          ? undefined
          : (requestedSectorId ?? request.user.sectorId)
    const rows = await listShowcase({
      former: former === '1' || former === 'true',
      sectorId,
    })
    const sectorNames = await sectorNamesFor(rows.map((row) => row.user.sectorId))
    return reply.send({
      entries: rows.map((row) => ({
        user: toPublicUser(row.user, [], sectorNames.get(row.user.sectorId) ?? ''),
        recognitions: row.recognitions,
        badges: row.badges.map(toAwardedBadgeDTO),
      })),
    })
  })
}
```

- [ ] **Step 9: Popular `sectorName` em `GET /users/:id/profile`**

Modify `apps/api/src/routes/profile.ts` — só o handler `/users/:id/profile` muda (o resto do
arquivo — `/users/:id`, `/users/:id/votes`, `/me/featured-badges` — fica igual):

```ts
  app.get('/users/:id/profile', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const profile = await getUserProfile(id)
    if (!profile) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
    // Avaliação preguiçosa dos selos de tempo de casa: best-effort, nunca derruba o perfil.
    try {
      const awarded = await evaluateTenureBadgesForUser(id)
      if (awarded.length > 0) {
        await notifyBadgesEarned(id, awarded.map((b) => b.badgeId))
      }
    } catch (err) {
      request.log.error(err)
    }
    const badges = await listBadgesForUser(id)
    const actions = await listUserActions(id)
    const sectorFeatures = await sectorFeaturesFor(profile.user.sectorId)
    const votingEnabled = sectorFeatures.includes('votar')
    const sectorName = (await sectorNamesFor([profile.user.sectorId])).get(profile.user.sectorId) ?? ''
    return reply.send({
      user: toPublicUser(profile.user, [], sectorName),
      stats: {
        totalVotesReceived: profile.totalVotesReceived,
        monthsRecognized: profile.monthsRecognized,
      },
      categoryBreakdown: profile.categoryBreakdown,
      months: profile.months,
      badges: badges.map(toAwardedBadgeDTO),
      actions: actions.map((c) => toRetroActionItemDTO(c, c.room.sprint, squadLabel(c.room.squads))),
      votingEnabled,
    })
  })
```

E o import no topo do arquivo passa a trazer `sectorNamesFor` também:
`import { sectorFeaturesFor, sectorNamesFor } from '../lib/sector-features'`.

- [ ] **Step 10: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api exec vitest run src/lib/sector-features.test.ts src/routes/users.test.ts src/routes/profile.test.ts`
Expected: PASS (todos, inclusive os pré-existentes)

- [ ] **Step 11: Typecheck**

Run: `pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/lib/sector-features.ts apps/api/src/lib/sector-features.test.ts packages/shared/src/auth.ts apps/api/src/lib/serialize.ts apps/api/src/routes/users.ts apps/api/src/routes/users.test.ts apps/api/src/routes/profile.ts apps/api/src/routes/profile.test.ts
git commit -m "feat(api): PublicUser ganha sectorName, resolvido no showcase e no perfil"
```

---

### Task 2: Frontend — card do escritório (fix) + exibição do setor

**Files:**
- Modify: `apps/web/src/office/useOfficeInteractions.ts` (busca `sectorId=all`)
- Modify: `apps/web/src/office/CharacterCard.tsx` (fallback repassa avatar do occupant)
- Modify: `apps/web/src/components/LegendCard.tsx` (badge de setor)
- Modify: `apps/web/src/pages/ProfilePage.tsx` (chip de setor)
- Modify: `apps/web/src/pages/ProfilePage.test.tsx` (cobre a badge nova)

**Interfaces:**
- Consumes: `PublicUser.sectorName` (Task 1).

- [ ] **Step 1: Card do escritório busca `sectorId=all`**

Modify `apps/web/src/office/useOfficeInteractions.ts` — trocar o bloco da query de showcase:

```ts
  const { data: showcase } = useQuery({
    queryKey: ['showcase', 'ativas', 'all'],
    queryFn: () => apiFetch<{ entries: ShowcaseEntry[] }>('/users/showcase?sectorId=all'),
    staleTime: 60_000,
  })
```

(era `queryKey: ['showcase', 'ativas']` e `queryFn` sem `?sectorId=all` — resto do arquivo não
muda.)

- [ ] **Step 2: Fallback do card repassa avatar do occupant**

Modify `apps/web/src/office/CharacterCard.tsx` — na linha do fallback mínimo, trocar:

```tsx
            <Avatar user={{ name: occupant.name }} initialsClassName="font-headline text-title-lg font-bold text-primary" />
```

por:

```tsx
            <Avatar user={occupant} initialsClassName="font-headline text-title-lg font-bold text-primary" />
```

(`OfficeOccupant` já tem todos os campos que `AvatarSource`/`CharacterSource` esperam —
`name`, `photoUrl`, `avatarStyle`, `avatarSeed`, `avatarOptions` — nenhuma outra mudança no
arquivo.)

- [ ] **Step 3: Badge de setor no `LegendCard`**

Modify `apps/web/src/components/LegendCard.tsx` — logo abaixo do `<span>` de cargo (o que hoje
mostra `{user.position ?? 'Desenvolvimento de Produto'}`), adicionar:

```tsx
      <span className={`mt-xs rounded-full bg-primary/10 font-label text-primary ${compact ? 'px-sm py-0.5 text-[11px]' : 'px-md py-xs text-label-sm'}`}>
        {user.position ?? 'Desenvolvimento de Produto'}
      </span>
      {user.sectorName && (
        <span className="mt-xs font-label text-label-sm text-on-surface-variant">{user.sectorName}</span>
      )}
```

- [ ] **Step 4: Chip de setor no `ProfilePage`**

Modify `apps/web/src/pages/ProfilePage.tsx` — no grupo de chips que hoje tem `user.squad` e "Na
equipe desde", adicionar um chip de setor (mesmo padrão visual do chip de squad, logo antes dele):

```tsx
                <div className="mb-lg flex flex-wrap justify-center gap-sm md:justify-start">
                  {user.sectorName && (
                    <span className="rounded-full border border-outline-variant/50 bg-surface-container-high px-md py-xs font-label text-label-sm text-on-surface-variant">
                      {user.sectorName}
                    </span>
                  )}
                  {user.squad && (
                    <span className="rounded-full border border-outline-variant/50 bg-surface-container-high px-md py-xs font-label text-label-sm text-on-surface">
                      {user.squad}
                    </span>
                  )}
```

(o resto do bloco — "Na equipe desde", "Ex-Lenda" — fica igual, só a abertura da `<div>` e o novo
`{user.sectorName && (...)}` entram antes do `{user.squad && (...)}` já existente.)

- [ ] **Step 5: Escrever o teste do chip de setor (falhando)**

Modify `apps/web/src/pages/ProfilePage.test.tsx` — no fixture de `/users/u1/profile` dentro de
`setupFetch()`, adicionar `sectorName: "Desenvolvimento de Produto"` logo após o campo `active:
true,` do objeto `user` (mesmo objeto que já tem `id`, `name`, `email`, `role`, `position`,
`squad`, `photoUrl`, `active`, `joinedAt`):

```ts
        user: {
          id: "u1",
          name: "Bruno Lima",
          email: "b@e.com",
          role: "LEGEND",
          position: "Backend",
          squad: "Core",
          photoUrl: null,
          active: true,
          sectorName: "Desenvolvimento de Produto",
          joinedAt: "2026-01-01T00:00:00.000Z",
        },
```

E adicionar um novo teste dentro de `describe("ProfilePage", ...)`, depois do teste
`"renders the profile, stats, badges, category breakdown and received votes"`:

```ts
  it("mostra o chip com o nome do setor do dono do perfil", async () => {
    renderPage();
    expect(await screen.findByText("Desenvolvimento de Produto")).toBeInTheDocument();
  });
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/ProfilePage.test.tsx -t "chip"`
Expected: FAIL — o chip ainda não existe em `ProfilePage.tsx`

- [ ] **Step 7: Rodar todos os testes afetados e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/pages/ProfilePage.test.tsx src/pages/LegendsPage.test.tsx src/pages/HighlightsPage.test.tsx`
Expected: PASS em todos (os de Lendas/Destaques não deveriam ter sido afetados pela badge nova no
`LegendCard`, mas rodar os três garante que nenhuma asserção de texto colidiu com a nova badge)

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/office/useOfficeInteractions.ts apps/web/src/office/CharacterCard.tsx apps/web/src/components/LegendCard.tsx apps/web/src/pages/ProfilePage.tsx apps/web/src/pages/ProfilePage.test.tsx
git commit -m "fix(web): card do escritorio busca todos os setores e repassa avatar no fallback; mostra setor no card e no perfil"
```

---

### Task 3: Verificação final

**Files:** nenhum (só execução)

- [ ] **Step 1: Subir o Postgres de teste**

Run: `pnpm db:up` (ou confirme que o container `legends-db` já está de pé)

- [ ] **Step 2: Rodar a suíte completa**

Run: `pnpm test`
Expected: todos os workspaces passam

- [ ] **Step 3: Typecheck de cada workspace**

Run: `pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: sucesso

- [ ] **Step 5: Revisão manual (se o dev server estiver disponível)**

Suba `pnpm dev`, entre no escritório e clique num personagem de outro setor — confirme que o card
mostra cargo e selos normalmente (não mais o fallback mínimo), e que o avatar customizado aparece
mesmo antes de qualquer fetch de showcase resolver. Confirme que o nome do setor aparece no card
(Lendas e escritório) e no perfil de qualquer usuário.
