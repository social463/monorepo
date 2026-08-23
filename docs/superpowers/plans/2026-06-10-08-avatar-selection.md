# Avatar Selection (DiceBear sprites) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in user pick and edit their own avatar by choosing a free DiceBear sprite style and shuffling through seeds, rendered locally (no external API at view time).

**Architecture:** Two nullable columns (`avatarStyle`, `avatarSeed`) are added to the `User` model and exposed in the `PublicUser` DTO. A new `PATCH /auth/me` endpoint lets a user update their own avatar fields. On the web, a single `Avatar` component renders a DiceBear SVG (generated in-browser with `@dicebear/core`) when style+seed are set, falling back to `photoUrl`, then to initials. An `AvatarPicker` modal on the user's own `ProfilePage` saves the selection and refreshes auth + profile state.

**Tech Stack:** Fastify + Prisma + Postgres (`apps/api`), React 18 + Vite + Tailwind + React Query (`apps/web`), shared types in `packages/shared`, Zod validation, Vitest. New deps: `@dicebear/core@^9.4.2`, `@dicebear/collection@^9.4.2` (web only).

**Avatar styles (CC0 1.0 — no attribution required, per https://www.dicebear.com/licenses/):** `pixel-art`, `pixel-art-neutral`, `thumbs`, `shapes`. Attribution-required styles (e.g. `avataaars`, `fun-emoji` CC BY 4.0) and custom-license styles (`bottts`) are intentionally excluded.

---

## File Structure

**Created:**
- `packages/shared/src/avatar.ts` — avatar style allowlist, labels, default style, `UpdateProfileRequest` type.
- `apps/web/src/lib/avatar.ts` — maps style keys to DiceBear collection styles; `avatarDataUri(style, seed)`; seed suggestions + random-seed helper.
- `apps/web/src/lib/avatar.test.ts` — unit test for `avatarDataUri`.
- `apps/web/src/components/Avatar.tsx` — single avatar renderer (DiceBear → photoUrl → initials), inner-content only so existing wrappers/borders are preserved.
- `apps/web/src/components/Avatar.test.tsx` — component test.
- `apps/web/src/components/AvatarPicker.tsx` — modal: style tabs, seed grid, shuffle, save/cancel.
- `apps/web/src/components/AvatarPicker.test.tsx` — component test.
- A new Prisma migration directory under `apps/api/prisma/migrations/` (auto-named by the CLI).

**Modified:**
- `apps/api/prisma/schema.prisma:27-44` — add `avatarStyle`, `avatarSeed` to `User`.
- `packages/shared/src/auth.ts:3-13` — add the two fields to `PublicUser`.
- `packages/shared/src/index.ts:1-7` — export `./avatar`.
- `apps/api/src/lib/serialize.ts:13-25` — include the two fields in `toPublicUser`.
- `apps/api/src/routes/auth.ts` — add `PATCH /me`.
- `apps/api/src/routes/auth.test.ts` — tests for `PATCH /auth/me`.
- `apps/web/src/auth/AuthContext.tsx` — expose `setUser`.
- `apps/web/src/pages/ProfilePage.tsx` — use `Avatar`, add "Editar avatar" affordance on own profile, mount `AvatarPicker`.
- `apps/web/src/pages/ProfilePage.test.tsx` — mock `useAuth`; existing assertions kept.
- `apps/web/src/components/AppLayout.tsx:167-179` — use `Avatar`.
- `apps/web/src/pages/LegendsPage.tsx:29-35` — use `Avatar`.
- `apps/web/src/pages/TeamPage.tsx:25-33` — use `Avatar`.
- `apps/web/src/pages/VotePage.tsx:205-213` — use `Avatar`.
- `apps/web/package.json` — add DiceBear deps.

---

## Task 1: DB schema — add `avatarStyle` and `avatarSeed`

**Files:**
- Modify: `apps/api/prisma/schema.prisma:27-44`
- Create: migration directory (CLI-generated)

- [ ] **Step 1: Add the columns to the `User` model**

In `apps/api/prisma/schema.prisma`, change the `User` model so the field block reads (add the two `avatar*` lines after `photoUrl`):

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  name         String
  position     String?
  squad        String?
  photoUrl     String?
  avatarStyle  String?
  avatarSeed   String?
  role         UserRole @default(DEV)
  active       Boolean  @default(true)
  joinedAt     DateTime @default(now())
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  votesGiven    Vote[]      @relation("VotesGiven")
  votesReceived Vote[]      @relation("VotesReceived")
  badges        UserBadge[]
}
```

- [ ] **Step 2: Generate and apply the migration**

Run (the dev DB must be up — `docker-compose up -d` if needed):

```bash
pnpm --filter @legends/api exec prisma migrate dev --name add_avatar_style_seed
```

Expected: a new folder `apps/api/prisma/migrations/<timestamp>_add_avatar_style_seed/migration.sql` containing two `ALTER TABLE "User" ADD COLUMN ...` statements, and "Your database is now in sync with your schema." Prisma Client is regenerated.

- [ ] **Step 3: Confirm Prisma Client picks up the fields**

Run:

```bash
pnpm --filter @legends/api exec tsc --noEmit
```

Expected: PASS (no errors). The generated client now types `user.avatarStyle` / `user.avatarSeed` as `string | null`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): add avatarStyle and avatarSeed columns to User"
```

---

## Task 2: Shared avatar types + `PublicUser` fields

**Files:**
- Create: `packages/shared/src/avatar.ts`
- Modify: `packages/shared/src/index.ts:1-7`
- Modify: `packages/shared/src/auth.ts:3-13`

- [ ] **Step 1: Create the shared avatar module**

Create `packages/shared/src/avatar.ts`:

```typescript
/** CC0 1.0 DiceBear sprite styles (no attribution required). */
export const AVATAR_STYLE_KEYS = [
  'pixel-art',
  'pixel-art-neutral',
  'thumbs',
  'shapes',
] as const

export type AvatarStyleKey = (typeof AVATAR_STYLE_KEYS)[number]

export const AVATAR_STYLE_LABELS: Record<AvatarStyleKey, string> = {
  'pixel-art': 'Pixel Art',
  'pixel-art-neutral': 'Pixel Neutro',
  thumbs: 'Thumbs',
  shapes: 'Formas',
}

export const DEFAULT_AVATAR_STYLE: AvatarStyleKey = 'pixel-art'

/** Body for PATCH /auth/me. `null` clears the field. */
export interface UpdateProfileRequest {
  avatarStyle?: AvatarStyleKey | null
  avatarSeed?: string | null
}
```

- [ ] **Step 2: Export it from the package index**

In `packages/shared/src/index.ts`, add the export (place it after `./auth`):

```typescript
export * from './enums'
export * from './categories'
export * from './auth'
export * from './avatar'
export * from './vote'
export * from './badge'
export * from './profile'
export * from './showcase'
```

- [ ] **Step 3: Add the fields to `PublicUser`**

In `packages/shared/src/auth.ts`, update the imports and interface:

```typescript
import type { UserRole } from './enums'
import type { AvatarStyleKey } from './avatar'

export interface PublicUser {
  id: string
  name: string
  email: string
  role: UserRole
  position: string | null
  squad: string | null
  photoUrl: string | null
  avatarStyle: AvatarStyleKey | null
  avatarSeed: string | null
  active: boolean
  joinedAt: string
}
```

- [ ] **Step 4: Typecheck the shared package**

Run:

```bash
pnpm --filter @legends/shared exec tsc --noEmit
```

Expected: PASS. (The API will not compile yet because `toPublicUser` is missing the new fields — that is fixed in Task 3.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/avatar.ts packages/shared/src/index.ts packages/shared/src/auth.ts
git commit -m "feat(shared): add avatar style types and PublicUser avatar fields"
```

---

## Task 3: Serialize fields + `PATCH /auth/me` endpoint (TDD)

**Files:**
- Modify: `apps/api/src/lib/serialize.ts:13-25`
- Modify: `apps/api/src/routes/auth.ts`
- Test: `apps/api/src/routes/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/routes/auth.test.ts`, add these three tests inside the existing `describe('auth routes', ...)` block, just before its closing `})`:

```typescript
  it('updates the current user avatar via PATCH /auth/me', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { token } = reg.json()
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarStyle: 'pixel-art', avatarSeed: 'Felix' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.avatarStyle).toBe('pixel-art')
    expect(res.json().user.avatarSeed).toBe('Felix')

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(me.json().user.avatarSeed).toBe('Felix')
    await app.close()
  })

  it('rejects an unknown avatar style with 400', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { token } = reg.json()
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarStyle: 'avataaars', avatarSeed: 'Felix' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejects PATCH /auth/me without a token (401)', async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      payload: { avatarStyle: 'pixel-art', avatarSeed: 'Felix' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @legends/api test -- auth.test.ts
```

Expected: the three new tests FAIL (the first returns 404/405 or 200 without the fields; the route does not exist yet).

- [ ] **Step 3: Add the new fields to `toPublicUser`**

In `apps/api/src/lib/serialize.ts`, update the imports and `toPublicUser`:

```typescript
import type { Badge, Category, Prisma, User, VotingPeriod } from '@prisma/client'
import type {
  AvatarStyleKey,
  AwardedBadgeDTO,
  BadgeDTO,
  CategoryDTO,
  PublicUser,
  VoteDTO,
  VotingPeriodDTO,
} from '@legends/shared'
import type { VoteWithRelations } from '../services/voting-service'
import { derivePeriodState, isPeriodEditable } from './period-state'

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    position: user.position,
    squad: user.squad,
    photoUrl: user.photoUrl,
    avatarStyle: user.avatarStyle as AvatarStyleKey | null,
    avatarSeed: user.avatarSeed,
    active: user.active,
    joinedAt: user.joinedAt.toISOString(),
  }
}
```

- [ ] **Step 4: Add the `PATCH /me` route**

In `apps/api/src/routes/auth.ts`, update the imports at the top to include Zod helpers and the style allowlist, and add the route. First, ensure the imports include `z` (already present) and the shared allowlist:

```typescript
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AVATAR_STYLE_KEYS } from '@legends/shared'
import { AuthError, authenticateUser, registerUser } from '../services/auth-service'
import { toPublicUser } from '../lib/serialize'
import { prisma } from '../lib/prisma'
```

Add this schema next to the other schemas near the top of the file (after `loginSchema`):

```typescript
const updateMeSchema = z.object({
  avatarStyle: z.enum(AVATAR_STYLE_KEYS).nullable().optional(),
  avatarSeed: z.string().min(1).max(64).nullable().optional(),
})
```

Then add the route inside `authRoutes`, immediately after the existing `app.get('/me', ...)` handler (before the closing `}` of `authRoutes`):

```typescript
  app.patch('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = updateMeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    const user = await prisma.user.update({
      where: { id: request.user.sub },
      data: parsed.data,
    })
    return reply.send({ user: toPublicUser(user) })
  })
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @legends/api test -- auth.test.ts
```

Expected: all auth tests PASS (including the three new ones).

- [ ] **Step 6: Run the full API suite + typecheck**

Run:

```bash
pnpm --filter @legends/api test && pnpm --filter @legends/api exec tsc --noEmit
```

Expected: PASS. (Existing tests that read `PublicUser` are unaffected — the new fields are additive.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/routes/auth.ts apps/api/src/routes/auth.test.ts
git commit -m "feat(api): expose avatar fields and add PATCH /auth/me"
```

---

## Task 4: Install DiceBear + web avatar lib (TDD)

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/lib/avatar.ts`
- Test: `apps/web/src/lib/avatar.test.ts`

- [ ] **Step 1: Install DiceBear**

Run:

```bash
pnpm --filter @legends/web add @dicebear/core@^9.4.2 @dicebear/collection@^9.4.2
```

Expected: `apps/web/package.json` lists both under `dependencies`.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/lib/avatar.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { avatarDataUri, AVATAR_SEED_SUGGESTIONS, randomSeed } from './avatar'

describe('avatarDataUri', () => {
  it('returns an SVG data URI for a style + seed', () => {
    const uri = avatarDataUri('pixel-art', 'Felix')
    expect(uri.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('is deterministic for the same style + seed', () => {
    expect(avatarDataUri('thumbs', 'Mochi')).toBe(avatarDataUri('thumbs', 'Mochi'))
  })

  it('exposes seed suggestions and a random seed generator', () => {
    expect(AVATAR_SEED_SUGGESTIONS.length).toBeGreaterThanOrEqual(6)
    expect(randomSeed()).toMatch(/^[a-z0-9]+$/)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
pnpm --filter @legends/web test -- avatar.test.ts
```

Expected: FAIL with "Cannot find module './avatar'".

- [ ] **Step 4: Create the avatar lib**

Create `apps/web/src/lib/avatar.ts`:

```typescript
import { createAvatar } from '@dicebear/core'
import { pixelArt, pixelArtNeutral, thumbs, shapes } from '@dicebear/collection'
import type { AvatarStyleKey } from '@legends/shared'

const STYLE_MAP = {
  'pixel-art': pixelArt,
  'pixel-art-neutral': pixelArtNeutral,
  thumbs,
  shapes,
} as const

/** Renders a deterministic DiceBear SVG as a data URI, entirely in-browser. */
export function avatarDataUri(style: AvatarStyleKey, seed: string): string {
  return createAvatar(STYLE_MAP[style], { seed, size: 128 }).toDataUri()
}

/** Friendly fixed seeds shown in the picker grid. */
export const AVATAR_SEED_SUGGESTIONS = [
  'Aneka',
  'Felix',
  'Mimi',
  'Boots',
  'Cleo',
  'Loki',
  'Nova',
  'Bandit',
  'Ziggy',
  'Mochi',
  'Pepper',
  'Pixel',
] as const

/** Short random seed for the "shuffle" action. */
export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
pnpm --filter @legends/web test -- avatar.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/src/lib/avatar.ts apps/web/src/lib/avatar.test.ts pnpm-lock.yaml
git commit -m "feat(web): add DiceBear and avatar rendering lib"
```

---

## Task 5: `Avatar` component (TDD)

The `Avatar` component renders only the inner content (an `<img>` or an initials `<span>`) so that every existing call site keeps its own wrapper `<div>` with borders/sizing. Priority: DiceBear (style+seed) → `photoUrl` → initials.

**Files:**
- Create: `apps/web/src/components/Avatar.tsx`
- Test: `apps/web/src/components/Avatar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/Avatar.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Avatar } from './Avatar'

describe('Avatar', () => {
  it('shows initials when no avatar is set', () => {
    render(<Avatar user={{ name: 'Ana Souza', avatarStyle: null, avatarSeed: null, photoUrl: null }} />)
    expect(screen.getByText('AS')).toBeInTheDocument()
  })

  it('renders a DiceBear image when style and seed are set', () => {
    render(
      <Avatar
        user={{ name: 'Ana Souza', avatarStyle: 'pixel-art', avatarSeed: 'Felix', photoUrl: null }}
      />,
    )
    const img = screen.getByRole('img', { name: 'Ana Souza' })
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
  })

  it('falls back to photoUrl when no DiceBear style is set', () => {
    render(
      <Avatar
        user={{ name: 'Ana Souza', avatarStyle: null, avatarSeed: null, photoUrl: 'https://x/y.png' }}
      />,
    )
    expect(screen.getByRole('img', { name: 'Ana Souza' }).getAttribute('src')).toBe('https://x/y.png')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @legends/web test -- Avatar.test.tsx
```

Expected: FAIL with "Cannot find module './Avatar'".

- [ ] **Step 3: Create the component**

Create `apps/web/src/components/Avatar.tsx`:

```typescript
import { useMemo } from 'react'
import type { AvatarStyleKey } from '@legends/shared'
import { avatarDataUri } from '../lib/avatar'

export interface AvatarSource {
  name: string
  avatarStyle?: AvatarStyleKey | null
  avatarSeed?: string | null
  photoUrl?: string | null
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()
}

/**
 * Inner avatar content (image or initials). Callers provide their own wrapper
 * element for sizing/borders. Resolution order: DiceBear sprite → photoUrl → initials.
 */
export function Avatar({
  user,
  initialsClassName = 'font-label text-label-sm font-bold text-primary',
}: {
  user: AvatarSource
  initialsClassName?: string
}) {
  const generated = useMemo(
    () => (user.avatarStyle && user.avatarSeed ? avatarDataUri(user.avatarStyle, user.avatarSeed) : null),
    [user.avatarStyle, user.avatarSeed],
  )
  const src = generated ?? user.photoUrl ?? null

  if (src) {
    return <img src={src} alt={user.name} className="h-full w-full object-cover" />
  }
  return <span className={initialsClassName}>{initials(user.name)}</span>
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm --filter @legends/web test -- Avatar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Avatar.tsx apps/web/src/components/Avatar.test.tsx
git commit -m "feat(web): add Avatar component"
```

---

## Task 6: Expose `setUser` from AuthContext

The picker must update the in-memory auth user after saving so the header avatar refreshes immediately.

**Files:**
- Modify: `apps/web/src/auth/AuthContext.tsx`

- [ ] **Step 1: Add `setUser` to the context value**

In `apps/web/src/auth/AuthContext.tsx`, update the interface and the provider value:

```typescript
interface AuthContextValue {
  user: PublicUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  setUser: (user: PublicUser) => void
}
```

And update the provider's returned value (the `useState` already exposes `setUser` — just pass it through):

```typescript
  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
```

- [ ] **Step 2: Typecheck the web app**

Run:

```bash
pnpm --filter @legends/web exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/auth/AuthContext.tsx
git commit -m "feat(web): expose setUser from AuthContext"
```

---

## Task 7: `AvatarPicker` modal (TDD)

A modal dialog: style tabs across the allowlist, a grid of seed previews for the active style, a "Embaralhar" (shuffle) button to regenerate seeds, and Save/Cancel. Save calls `PATCH /auth/me`, then updates auth state and invalidates the profile query.

**Files:**
- Create: `apps/web/src/components/AvatarPicker.tsx`
- Test: `apps/web/src/components/AvatarPicker.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/AvatarPicker.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest'
import { AvatarPicker } from './AvatarPicker'
import { apiFetch } from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const setUser = vi.fn()
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Ana Souza' }, setUser }),
}))

const mockApiFetch = apiFetch as unknown as Mock

function renderPicker(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AvatarPicker onClose={onClose} />
    </QueryClientProvider>,
  )
  return { onClose }
}

describe('AvatarPicker', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the style options', () => {
    renderPicker()
    expect(screen.getByRole('button', { name: 'Pixel Art' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Formas' })).toBeInTheDocument()
  })

  it('saves the selected avatar via PATCH /auth/me and closes', async () => {
    mockApiFetch.mockResolvedValue({
      user: { id: 'u1', name: 'Ana Souza', avatarStyle: 'pixel-art', avatarSeed: 'Felix' },
    })
    const { onClose } = renderPicker()

    // pick the first seed tile, then save
    fireEvent.click(screen.getAllByRole('button', { name: /Selecionar avatar/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled())
    const [path, options] = mockApiFetch.mock.calls[0]
    expect(path).toBe('/auth/me')
    expect(options.method).toBe('PATCH')
    const body = JSON.parse(options.body)
    expect(body.avatarStyle).toBe('pixel-art')
    expect(typeof body.avatarSeed).toBe('string')
    await waitFor(() => expect(setUser).toHaveBeenCalled())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @legends/web test -- AvatarPicker.test.tsx
```

Expected: FAIL with "Cannot find module './AvatarPicker'".

- [ ] **Step 3: Create the component**

Create `apps/web/src/components/AvatarPicker.tsx`:

```typescript
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AVATAR_STYLE_KEYS,
  AVATAR_STYLE_LABELS,
  DEFAULT_AVATAR_STYLE,
  type AvatarStyleKey,
  type PublicUser,
} from '@legends/shared'
import { apiFetch, ApiError } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { avatarDataUri, AVATAR_SEED_SUGGESTIONS, randomSeed } from '../lib/avatar'
import { Icon } from './Icon'

export function AvatarPicker({ onClose }: { onClose: () => void }) {
  const { user, setUser } = useAuth()
  const queryClient = useQueryClient()
  const [style, setStyle] = useState<AvatarStyleKey>(user?.avatarStyle ?? DEFAULT_AVATAR_STYLE)
  const [seeds, setSeeds] = useState<string[]>([...AVATAR_SEED_SUGGESTIONS])
  const [selectedSeed, setSelectedSeed] = useState<string | null>(user?.avatarSeed ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function shuffle() {
    setSeeds(Array.from({ length: 12 }, () => randomSeed()))
  }

  async function save() {
    if (!selectedSeed) {
      setError('Escolha um avatar antes de salvar.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch<{ user: PublicUser }>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ avatarStyle: style, avatarSeed: selectedSeed }),
      })
      setUser(res.user)
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Escolher avatar"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg"
    >
      <div className="w-full max-w-lg rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
        <div className="mb-lg flex items-center justify-between">
          <h3 className="font-headline text-headline-md text-on-surface">Escolher avatar</h3>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="text-on-surface-variant hover:text-primary"
          >
            <Icon name="close" className="text-[22px]" />
          </button>
        </div>

        {/* Style tabs */}
        <div className="mb-lg flex flex-wrap gap-sm">
          {AVATAR_STYLE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setStyle(key)}
              className={`rounded-full border px-md py-xs font-label text-label-sm transition-colors ${
                style === key
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-outline-variant/50 bg-surface-container-high text-on-surface'
              }`}
            >
              {AVATAR_STYLE_LABELS[key]}
            </button>
          ))}
        </div>

        {/* Seed grid */}
        <div className="mb-lg grid grid-cols-4 gap-md sm:grid-cols-6">
          {seeds.map((seed) => (
            <button
              key={seed}
              type="button"
              aria-label={`Selecionar avatar ${seed}`}
              onClick={() => setSelectedSeed(seed)}
              className={`flex aspect-square items-center justify-center overflow-hidden rounded-lg border-2 bg-surface-container-highest transition-all ${
                selectedSeed === seed ? 'border-primary' : 'border-transparent hover:border-outline-variant/50'
              }`}
            >
              <img src={avatarDataUri(style, seed)} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>

        {error && <p className="mb-md font-label text-label-sm text-error">{error}</p>}

        <div className="flex items-center justify-between gap-md">
          <button
            type="button"
            onClick={shuffle}
            className="inline-flex items-center gap-sm rounded-md border border-outline-variant/50 px-md py-sm font-label text-label-md text-on-surface transition-colors hover:border-primary"
          >
            <Icon name="shuffle" className="text-[18px]" />
            Embaralhar
          </button>
          <div className="flex gap-sm">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-all hover:bg-primary-container active:scale-[0.98] disabled:opacity-60"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

> Note: `close` and `shuffle` are Material Symbols icon names already used by the `Icon` component convention in this codebase. If `Icon` validates names against a list, add `close` and `shuffle` there.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm --filter @legends/web test -- AvatarPicker.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/AvatarPicker.tsx apps/web/src/components/AvatarPicker.test.tsx
git commit -m "feat(web): add AvatarPicker modal"
```

---

## Task 8: Wire ProfilePage + replace all avatar render sites

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.tsx`
- Modify: `apps/web/src/pages/ProfilePage.test.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx:167-179`
- Modify: `apps/web/src/pages/LegendsPage.tsx:29-35`
- Modify: `apps/web/src/pages/TeamPage.tsx:25-33`
- Modify: `apps/web/src/pages/VotePage.tsx:205-213`

- [ ] **Step 1: Mock `useAuth` in the ProfilePage test and add an "own profile" assertion**

`ProfilePage` will start calling `useAuth()`, so its existing test needs the hook mocked. In `apps/web/src/pages/ProfilePage.test.tsx`, add this mock near the top (after the existing `vi.mock('../lib/api', ...)` block). The route param id in that test is `u1`, so make the mocked auth user `u1` to exercise the own-profile path:

```typescript
const setUser = vi.fn()
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Bruno Lima' }, setUser }),
}))
```

Add this test inside the existing `describe('ProfilePage', ...)` block:

```typescript
  it('shows the edit-avatar button on your own profile', async () => {
    setupFetch()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/perfil/u1']}>
          <Routes>
            <Route path="/perfil/:id" element={<ProfilePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('button', { name: 'Editar avatar' })).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the test to verify the new test fails**

Run:

```bash
pnpm --filter @legends/web test -- ProfilePage.test.tsx
```

Expected: the new "shows the edit-avatar button" test FAILS (button not found). Existing tests should still pass (the `useAuth` mock satisfies the new import).

- [ ] **Step 3: Update ProfilePage to use Avatar + mount the picker**

In `apps/web/src/pages/ProfilePage.tsx`, update the imports (add `useAuth`, `Avatar`, `AvatarPicker`) and remove the now-unused local `initials` helper:

```typescript
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { ProfileDTO, VoteDTO } from '@legends/shared'
import { apiFetch } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { Icon } from '../components/Icon'
import { Avatar } from '../components/Avatar'
import { AvatarPicker } from '../components/AvatarPicker'
import { categoryIcon } from '../lib/icons'
import { BadgeEmblem } from '../components/BadgeEmblem'
```

Delete the local `initials` function (lines 10-17) — it now lives inside `Avatar`.

Add state + ownership flag near the other `useState` calls inside the component:

```typescript
  const { user: authUser } = useAuth()
  const [pickerOpen, setPickerOpen] = useState(false)
  const isOwnProfile = authUser?.id === id
```

Replace the avatar block (the `<div className="relative shrink-0">…</div>` at lines 75-90) with:

```typescript
          <div className="relative shrink-0">
            <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-full border-4 border-primary bg-surface-container-highest md:h-36 md:w-36">
              <Avatar
                user={user}
                initialsClassName="font-headline text-headline-xl font-bold text-primary"
              />
            </div>
            {isOwnProfile && (
              <button
                type="button"
                aria-label="Editar avatar"
                onClick={() => setPickerOpen(true)}
                className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-surface bg-primary text-on-primary transition-transform hover:scale-110"
              >
                <Icon name="edit" className="text-[18px]" />
              </button>
            )}
            {user.role === 'ADMIN' && !isOwnProfile && (
              <span className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-primary">
                <Icon name="verified" filled className="text-[16px] text-on-primary" />
              </span>
            )}
          </div>
```

At the end of the component, render the picker. Change the outermost return so the `<section>` is wrapped, or add the modal just before the closing `</section>`. Add immediately before the final `</section>`:

```typescript
      {pickerOpen && <AvatarPicker onClose={() => setPickerOpen(false)} />}
```

- [ ] **Step 4: Run the ProfilePage test to verify it passes**

Run:

```bash
pnpm --filter @legends/web test -- ProfilePage.test.tsx
```

Expected: PASS (all tests, including the new edit-avatar one).

- [ ] **Step 5: Replace the avatar render in AppLayout**

In `apps/web/src/components/AppLayout.tsx`, add the import near the other component imports:

```typescript
import { Avatar } from './Avatar'
```

Replace the inner content of the header avatar wrapper (lines 168-178, the `{user?.photoUrl ? (...) : (...)}` block) with:

```typescript
                {user ? (
                  <Avatar user={user} />
                ) : (
                  <span className="font-label text-label-sm font-bold text-primary">—</span>
                )}
```

If `initials` is now unused in this file, remove its definition.

- [ ] **Step 6: Replace the avatar render in LegendsPage**

In `apps/web/src/pages/LegendsPage.tsx`, add `import { Avatar } from '../components/Avatar'`. Replace the `{user.photoUrl ? (...) : (...)}` block (lines 30-35) with:

```typescript
          <Avatar user={user} initialsClassName="font-headline text-headline-md font-bold text-primary" />
```

Remove the now-unused local `initials` helper if present in this file.

- [ ] **Step 7: Replace the avatar render in TeamPage**

In `apps/web/src/pages/TeamPage.tsx`, add `import { Avatar } from '../components/Avatar'`. Replace the `{member.photoUrl ? (...) : (...)}` block (lines 26-33) with:

```typescript
            <Avatar user={member} />
```

Remove the now-unused local `initials` helper if present in this file.

- [ ] **Step 8: Replace the avatar render in VotePage**

In `apps/web/src/pages/VotePage.tsx`, add `import { Avatar } from '../components/Avatar'`. Replace the `{member.photoUrl ? (...) : (...)}` block (lines 207-213) with:

```typescript
                        <Avatar user={member} />
```

Remove the now-unused local `initials` helper if present in this file.

- [ ] **Step 9: Run the full web suite + typecheck**

Run:

```bash
pnpm --filter @legends/web test && pnpm --filter @legends/web exec tsc --noEmit
```

Expected: PASS. The existing AppLayout/Legends/Vote tests use mocks with `photoUrl: null` and no avatar fields; `Avatar` treats missing `avatarStyle`/`avatarSeed` as undefined → falls back to initials, so those assertions still hold.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/ProfilePage.tsx apps/web/src/pages/ProfilePage.test.tsx apps/web/src/components/AppLayout.tsx apps/web/src/pages/LegendsPage.tsx apps/web/src/pages/TeamPage.tsx apps/web/src/pages/VotePage.tsx
git commit -m "feat(web): render avatars via Avatar component and add picker to ProfilePage"
```

---

## Task 9: Full verification

- [ ] **Step 1: Run the entire test suite**

Run:

```bash
pnpm -r test
```

Expected: all packages PASS.

- [ ] **Step 2: Typecheck every package**

Run:

```bash
pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Manual smoke test (optional but recommended)**

Run the stack (`docker-compose up -d`, then `pnpm --filter @legends/api dev` and `pnpm --filter @legends/web dev`), log in, open your own profile, click the edit-avatar button, pick a style + seed, shuffle, save, and confirm the avatar updates on the profile hero and in the header without a page reload.

- [ ] **Step 4: Final commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "chore(web): avatar selection cleanup"
```

---

## Self-Review Notes

- **Spec coverage:** user picks a free sprite (DiceBear CC0 styles, Task 4/7), can edit & re-select (AvatarPicker shuffle + save, Task 7), changes persist (PATCH /auth/me + columns, Tasks 1–3) and render everywhere (Avatar component across 5 sites, Tasks 5/8).
- **Type consistency:** `AvatarStyleKey` / `AVATAR_STYLE_KEYS` / `AVATAR_STYLE_LABELS` / `DEFAULT_AVATAR_STYLE` defined once in `packages/shared/src/avatar.ts` and reused by API (Zod enum) and web. `avatarDataUri(style, seed)`, `AVATAR_SEED_SUGGESTIONS`, `randomSeed()` exported from `apps/web/src/lib/avatar.ts` and consumed by `Avatar` and `AvatarPicker` with matching signatures. `setUser` added to `AuthContextValue` and used by `AvatarPicker`.
- **Coexistence with M365 photos spec:** `Avatar` resolves DiceBear → `photoUrl` → initials, so a future M365 photo in `photoUrl` still shows for users who never pick a sprite.
```
