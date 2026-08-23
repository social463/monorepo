# Avatar Personalizado (open-peeps) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Personalizar" mode to the avatar picker that lets a user build a custom DiceBear `open-peeps` avatar by choosing each component (hair, face, facial hair, accessories, mask, skin/clothing/contrast colors) with live preview, alongside the existing 7 seed-shuffle styles.

**Architecture:** A new nullable `avatarOptions` (jsonb) column on `User` stores the chosen component values when `avatarStyle === 'open-peeps'`. The shared package gains the open-peeps variant/color allowlists (single source of truth for the picker UI and backend Zod validation). The web renders open-peeps locally by forcing each chosen component into DiceBear's single-element-array form (with `*Probability` 0/100 for optional components). `PATCH /auth/me` validates and persists the options; the picker gets a mode toggle + per-component editor.

**Tech Stack:** Fastify + Prisma (Postgres jsonb) + Zod (apps/api), React 18 + Vite + Tailwind + React Query (apps/web), `@dicebear/core` + `@dicebear/collection@9.4.2`, shared types in `@legends/shared`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-avatar-open-peeps-custom-design.md`

**Note on current state:** The avatar feature already exists. `AVATAR_STYLE_KEYS` currently holds the 7 seed styles `['personas','bottts','thumbs','croodles','lorelei','micah','toon-head']`. `PublicUser` already has `avatarStyle`/`avatarSeed`. `PATCH /auth/me` already exists with `updateMeSchema`. The web has `apps/web/src/lib/avatar.ts` (`avatarDataUri`, `STYLE_MAP`), `Avatar.tsx`, and `AvatarPicker.tsx` (seed-shuffle gallery). The dev DB is healthy (recently reset+seeded). Postgres runs on localhost:5432. There is ONE pre-existing unrelated failing web test (`src/App.test.tsx`) — leave it; all other tests must pass.

---

## File Structure

**Modified:**
- `apps/api/prisma/schema.prisma` — add `avatarOptions Json?` to `User`.
- `packages/shared/src/avatar.ts` — open-peeps allowlists, `AvatarOptions`, `OPEN_PEEPS_STYLE`, `ALL_AVATAR_STYLE_KEYS`, widen `AvatarStyleKey`, default options.
- `packages/shared/src/auth.ts` — add `avatarOptions` to `PublicUser`.
- `apps/api/src/lib/serialize.ts` — expose `avatarOptions`.
- `apps/api/src/routes/auth.ts` — extend `updateMeSchema` + coherence logic in `PATCH /me`.
- `apps/api/src/routes/auth.test.ts` — tests for open-peeps options.
- `apps/web/src/lib/avatar.ts` — `customAvatarDataUri`, add `openPeeps` to `STYLE_MAP`.
- `apps/web/src/lib/avatar.test.ts` — test `customAvatarDataUri`.
- `apps/web/src/components/Avatar.tsx` — render open-peeps from options.
- `apps/web/src/components/Avatar.test.tsx` — test open-peeps rendering.
- `apps/web/src/components/AvatarPicker.tsx` — mode toggle + open-peeps editor.
- `apps/web/src/components/AvatarPicker.test.tsx` — test the editor + save.

**Created:** a Prisma migration directory (CLI-generated).

---

## Task 1: DB — add `avatarOptions` column

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (User model)
- Create: migration directory (CLI-generated)

- [ ] **Step 1: Add the column**

In `apps/api/prisma/schema.prisma`, add `avatarOptions Json?` to the `User` model immediately after the `avatarSeed String?` line. The avatar-related fields must read:

```prisma
  photoUrl     String?
  avatarStyle  String?
  avatarSeed   String?
  avatarOptions Json?
```

- [ ] **Step 2: Generate and apply the migration**

Run (Postgres is on localhost:5432; dev DB is healthy):

```bash
pnpm --filter @legends/api exec prisma migrate dev --name add_avatar_options
```

Expected: a new `apps/api/prisma/migrations/<timestamp>_add_avatar_options/migration.sql` with `ALTER TABLE "User" ADD COLUMN "avatarOptions" JSONB;` and "Your database is now in sync with your schema." If it reports drift or wants to reset, STOP and report BLOCKED with the output.

- [ ] **Step 3: Typecheck the API**

Run:

```bash
pnpm --filter @legends/api exec tsc --noEmit
```

Expected: PASS. (`user.avatarOptions` is now typed `Prisma.JsonValue | null`.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): add avatarOptions jsonb column to User"
```

---

## Task 2: Shared — open-peeps allowlists, types, defaults

**Files:**
- Modify: `packages/shared/src/avatar.ts`
- Modify: `packages/shared/src/auth.ts`

- [ ] **Step 1: Append open-peeps definitions to `packages/shared/src/avatar.ts`**

The file currently defines `AVATAR_STYLE_KEYS` (7 styles), `AvatarStyleKey`, `AVATAR_STYLE_LABELS`, `DEFAULT_AVATAR_STYLE`, and `UpdateProfileRequest`. Make these changes:

1. Change the `AvatarStyleKey` type to include open-peeps, and add the new style constant + combined keys. Replace the current line:

```ts
export type AvatarStyleKey = (typeof AVATAR_STYLE_KEYS)[number];
```

with:

```ts
/** Style used by the custom component editor (not part of the seed gallery). */
export const OPEN_PEEPS_STYLE = "open-peeps" as const;

/** Every value the `avatarStyle` field may hold (gallery styles + custom). */
export const ALL_AVATAR_STYLE_KEYS = [
  ...AVATAR_STYLE_KEYS,
  OPEN_PEEPS_STYLE,
] as const;

export type AvatarStyleKey = (typeof ALL_AVATAR_STYLE_KEYS)[number];
```

2. Add an `open-peeps` entry to `AVATAR_STYLE_LABELS` (it is typed `Record<AvatarStyleKey, string>`, which now requires it). Change the object to:

```ts
export const AVATAR_STYLE_LABELS: Record<AvatarStyleKey, string> = {
  personas: "Personas",
  bottts: "Bottts",
  thumbs: "Thumbs",
  croodles: "Croodles",
  lorelei: "Lorelei",
  micah: "Micah",
  "toon-head": "Toon Head",
  "open-peeps": "Personalizar",
};
```

3. At the END of the file (after `UpdateProfileRequest`), append the open-peeps allowlists, the `AvatarOptions` type, the picker metadata, and defaults:

```ts
// ── open-peeps custom avatar (CC0 1.0 — no attribution) ──────────────────────
// Variant lists mirror @dicebear/collection@9.4.2 openPeeps.schema. Keep in sync.

export const OPEN_PEEPS_HEAD = [
  "afro", "bangs", "bangs2", "bantuKnots", "bear", "bun", "bun2", "buns",
  "cornrows", "cornrows2", "dreads1", "dreads2", "flatTop", "flatTopLong",
  "grayBun", "grayMedium", "grayShort", "hatBeanie", "hatHip", "hijab", "long",
  "longAfro", "longBangs", "longCurly", "medium1", "medium2", "medium3",
  "mediumBangs", "mediumBangs2", "mediumBangs3", "mediumStraight", "mohawk",
  "mohawk2", "noHair1", "noHair2", "noHair3", "pomp", "shaved1", "shaved2",
  "shaved3", "short1", "short2", "short3", "short4", "short5", "turban",
  "twists", "twists2",
] as const;

export const OPEN_PEEPS_FACE = [
  "angryWithFang", "awe", "blank", "calm", "cheeky", "concerned",
  "concernedFear", "contempt", "cute", "cyclops", "driven", "eatingHappy",
  "explaining", "eyesClosed", "fear", "hectic", "lovingGrin1", "lovingGrin2",
  "monster", "old", "rage", "serious", "smile", "smileBig", "smileLOL",
  "smileTeethGap", "solemn", "suspicious", "tired", "veryAngry",
] as const;

export const OPEN_PEEPS_FACIAL_HAIR = [
  "chin", "full", "full2", "full3", "full4", "goatee1", "goatee2",
  "moustache1", "moustache2", "moustache3", "moustache4", "moustache5",
  "moustache6", "moustache7", "moustache8", "moustache9",
] as const;

export const OPEN_PEEPS_ACCESSORIES = [
  "eyepatch", "glasses", "glasses2", "glasses3", "glasses4", "glasses5",
  "sunglasses", "sunglasses2",
] as const;

export const OPEN_PEEPS_MASK = ["medicalMask", "respirator"] as const;

export const OPEN_PEEPS_SKIN_COLORS = [
  "ffdbb4", "edb98a", "d08b5b", "ae5d29", "694d3d",
] as const;

export const OPEN_PEEPS_CLOTHING_COLORS = [
  "e78276", "ffcf77", "fdea6b", "78e185", "9ddadb", "8fa7df", "e279c7",
] as const;

export const OPEN_PEEPS_HEAD_CONTRAST_COLORS = [
  "2c1b18", "e8e1e1", "ecdcbf", "d6b370", "f59797", "b58143", "a55728",
  "724133", "4a312c", "c93305",
] as const;

/** Selected open-peeps components. `null` on optional ones means "none". */
export interface AvatarOptions {
  head: (typeof OPEN_PEEPS_HEAD)[number];
  face: (typeof OPEN_PEEPS_FACE)[number];
  facialHair: (typeof OPEN_PEEPS_FACIAL_HAIR)[number] | null;
  accessories: (typeof OPEN_PEEPS_ACCESSORIES)[number] | null;
  mask: (typeof OPEN_PEEPS_MASK)[number] | null;
  skinColor: (typeof OPEN_PEEPS_SKIN_COLORS)[number];
  clothingColor: (typeof OPEN_PEEPS_CLOTHING_COLORS)[number];
  headContrastColor: (typeof OPEN_PEEPS_HEAD_CONTRAST_COLORS)[number];
}

/** Picker metadata: variant components (with "none" support) and color components. */
export const OPEN_PEEPS_VARIANT_COMPONENTS = [
  { key: "head", label: "Cabelo", variants: OPEN_PEEPS_HEAD, allowsNone: false },
  { key: "face", label: "Expressão", variants: OPEN_PEEPS_FACE, allowsNone: false },
  { key: "facialHair", label: "Barba", variants: OPEN_PEEPS_FACIAL_HAIR, allowsNone: true },
  { key: "accessories", label: "Acessórios", variants: OPEN_PEEPS_ACCESSORIES, allowsNone: true },
  { key: "mask", label: "Máscara", variants: OPEN_PEEPS_MASK, allowsNone: true },
] as const;

export const OPEN_PEEPS_COLOR_COMPONENTS = [
  { key: "skinColor", label: "Tom de pele", palette: OPEN_PEEPS_SKIN_COLORS },
  { key: "clothingColor", label: "Roupa", palette: OPEN_PEEPS_CLOTHING_COLORS },
  { key: "headContrastColor", label: "Cabelo (contraste)", palette: OPEN_PEEPS_HEAD_CONTRAST_COLORS },
] as const;

export const DEFAULT_OPEN_PEEPS_OPTIONS: AvatarOptions = {
  head: "short1",
  face: "smile",
  facialHair: null,
  accessories: null,
  mask: null,
  skinColor: "edb98a",
  clothingColor: "8fa7df",
  headContrastColor: "2c1b18",
};
```

4. Update `UpdateProfileRequest` to carry options. Replace it with:

```ts
/** Body for PATCH /auth/me. `null` clears the field. */
export interface UpdateProfileRequest {
  avatarStyle?: AvatarStyleKey | null;
  avatarSeed?: string | null;
  avatarOptions?: AvatarOptions | null;
}
```

- [ ] **Step 2: Add `avatarOptions` to `PublicUser`**

In `packages/shared/src/auth.ts`, update the import and interface. The import currently is `import type { AvatarStyleKey } from './avatar'`. Change it to:

```ts
import type { AvatarStyleKey, AvatarOptions } from './avatar'
```

And add the field to `PublicUser` after `avatarSeed`:

```ts
  photoUrl: string | null
  avatarStyle: AvatarStyleKey | null
  avatarSeed: string | null
  avatarOptions: AvatarOptions | null
  active: boolean
  joinedAt: string
```

- [ ] **Step 3: Typecheck shared**

Run:

```bash
pnpm --filter @legends/shared exec tsc --noEmit
```

Expected: PASS. (The API will not compile yet — `toPublicUser` lacks the new field; fixed in Task 3.)

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/avatar.ts packages/shared/src/auth.ts
git commit -m "feat(shared): add open-peeps option allowlists and AvatarOptions type"
```

---

## Task 3: API — serialize + validate + persist options (TDD)

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Test: `apps/api/src/routes/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/routes/auth.test.ts`, add these three tests inside `describe('auth routes', ...)`, before its closing `})`. A `makeApp()` helper already exists.

```typescript
  it('saves open-peeps custom options via PATCH /auth/me', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { token } = reg.json()
    const options = {
      head: 'afro',
      face: 'smile',
      facialHair: null,
      accessories: 'glasses',
      mask: null,
      skinColor: 'edb98a',
      clothingColor: '8fa7df',
      headContrastColor: '2c1b18',
    }
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarStyle: 'open-peeps', avatarSeed: 'base', avatarOptions: options },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.avatarStyle).toBe('open-peeps')
    expect(res.json().user.avatarOptions).toEqual(options)

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(me.json().user.avatarOptions.accessories).toBe('glasses')
    await app.close()
  })

  it('rejects open-peeps options with an unknown variant (400)', async () => {
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
      payload: {
        avatarStyle: 'open-peeps',
        avatarSeed: 'base',
        avatarOptions: {
          head: 'NOT_A_REAL_HEAD',
          face: 'smile',
          facialHair: null,
          accessories: null,
          mask: null,
          skinColor: 'edb98a',
          clothingColor: '8fa7df',
          headContrastColor: '2c1b18',
        },
      },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('clears avatarOptions when switching to a seed style', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { token } = reg.json()
    const options = {
      head: 'afro', face: 'smile', facialHair: null, accessories: null, mask: null,
      skinColor: 'edb98a', clothingColor: '8fa7df', headContrastColor: '2c1b18',
    }
    await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarStyle: 'open-peeps', avatarSeed: 'base', avatarOptions: options },
    })
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarStyle: 'bottts', avatarSeed: 'Felix' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.avatarStyle).toBe('bottts')
    expect(res.json().user.avatarOptions).toBeNull()
    await app.close()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @legends/api test -- auth.test.ts
```

Expected: the three new tests FAIL (options not serialized/validated/persisted yet).

- [ ] **Step 3: Expose `avatarOptions` in `toPublicUser`**

In `apps/api/src/lib/serialize.ts`, update the `@legends/shared` type import to add `AvatarOptions`, and add the field. The import block currently imports `AvatarStyleKey` among others — add `AvatarOptions`:

```typescript
import type {
  AvatarOptions,
  AvatarStyleKey,
  AwardedBadgeDTO,
  BadgeDTO,
  CategoryDTO,
  PublicUser,
  VoteDTO,
  VotingPeriodDTO,
} from '@legends/shared'
```

And in `toPublicUser`, add the field after `avatarSeed`:

```typescript
    avatarStyle: user.avatarStyle as AvatarStyleKey | null,
    avatarSeed: user.avatarSeed,
    avatarOptions: (user.avatarOptions as AvatarOptions | null) ?? null,
```

- [ ] **Step 4: Extend validation + persistence in `PATCH /me`**

In `apps/api/src/routes/auth.ts`:

1. Update imports. Add `Prisma` from `@prisma/client` and the open-peeps allowlists from shared. The file currently imports `{ AVATAR_STYLE_KEYS } from '@legends/shared'`. Change the import section to:

```typescript
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import {
  ALL_AVATAR_STYLE_KEYS,
  OPEN_PEEPS_ACCESSORIES,
  OPEN_PEEPS_CLOTHING_COLORS,
  OPEN_PEEPS_FACE,
  OPEN_PEEPS_FACIAL_HAIR,
  OPEN_PEEPS_HEAD,
  OPEN_PEEPS_HEAD_CONTRAST_COLORS,
  OPEN_PEEPS_MASK,
  OPEN_PEEPS_SKIN_COLORS,
} from '@legends/shared'
import { AuthError, authenticateUser, registerUser } from '../services/auth-service'
import { toPublicUser } from '../lib/serialize'
import { prisma } from '../lib/prisma'
```

2. Replace the existing `updateMeSchema` definition with one that validates the style against ALL keys and adds the options object:

```typescript
const avatarOptionsSchema = z.object({
  head: z.enum(OPEN_PEEPS_HEAD),
  face: z.enum(OPEN_PEEPS_FACE),
  facialHair: z.enum(OPEN_PEEPS_FACIAL_HAIR).nullable(),
  accessories: z.enum(OPEN_PEEPS_ACCESSORIES).nullable(),
  mask: z.enum(OPEN_PEEPS_MASK).nullable(),
  skinColor: z.enum(OPEN_PEEPS_SKIN_COLORS),
  clothingColor: z.enum(OPEN_PEEPS_CLOTHING_COLORS),
  headContrastColor: z.enum(OPEN_PEEPS_HEAD_CONTRAST_COLORS),
})

const updateMeSchema = z.object({
  avatarStyle: z.enum(ALL_AVATAR_STYLE_KEYS).nullable().optional(),
  avatarSeed: z.string().min(1).max(64).nullable().optional(),
  avatarOptions: avatarOptionsSchema.nullable().optional(),
})
```

3. Replace the body of the existing `app.patch('/me', ...)` handler with the coherence logic. The handler must become:

```typescript
  app.patch('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = updateMeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    const { avatarStyle, avatarSeed, avatarOptions } = parsed.data
    const data: Prisma.UserUpdateInput = {}
    if (avatarStyle !== undefined) data.avatarStyle = avatarStyle
    if (avatarSeed !== undefined) data.avatarSeed = avatarSeed

    if (avatarStyle === 'open-peeps') {
      if (!avatarOptions) {
        return reply.code(400).send({ message: 'Dados inválidos' })
      }
      data.avatarOptions = avatarOptions as Prisma.InputJsonValue
    } else if (avatarStyle !== undefined) {
      // switching to a seed style clears any custom options
      data.avatarOptions = Prisma.DbNull
    } else if (avatarOptions !== undefined) {
      data.avatarOptions =
        avatarOptions === null ? Prisma.DbNull : (avatarOptions as Prisma.InputJsonValue)
    }

    const user = await prisma.user.update({ where: { id: request.user.sub }, data })
    return reply.send({ user: toPublicUser(user) })
  })
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @legends/api test -- auth.test.ts
```

Expected: all auth tests PASS (including the three new ones).

- [ ] **Step 6: Full API suite + typecheck**

Run:

```bash
pnpm --filter @legends/api test && pnpm --filter @legends/api exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/routes/auth.ts apps/api/src/routes/auth.test.ts
git commit -m "feat(api): validate and persist open-peeps avatar options"
```

---

## Task 4: Web lib — `customAvatarDataUri` (TDD)

**Files:**
- Modify: `apps/web/src/lib/avatar.ts`
- Test: `apps/web/src/lib/avatar.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/web/src/lib/avatar.test.ts`, add this block (keep the existing tests). Add the import for the new function at the top — change the existing import line to include `customAvatarDataUri`:

```typescript
import { avatarDataUri, customAvatarDataUri, AVATAR_SEED_SUGGESTIONS, randomSeed } from './avatar'
import type { AvatarOptions } from '@legends/shared'
```

Then add, after the existing `describe('avatarDataUri', ...)` block:

```typescript
const SAMPLE_OPTIONS: AvatarOptions = {
  head: 'afro',
  face: 'smile',
  facialHair: 'goatee1',
  accessories: 'glasses',
  mask: null,
  skinColor: 'edb98a',
  clothingColor: '8fa7df',
  headContrastColor: '2c1b18',
}

describe('customAvatarDataUri', () => {
  it('returns an SVG data URI for open-peeps options', () => {
    expect(customAvatarDataUri('base', SAMPLE_OPTIONS).startsWith('data:image/svg+xml')).toBe(true)
  })

  it('renders a valid avatar when optional components are "none"', () => {
    const none: AvatarOptions = { ...SAMPLE_OPTIONS, facialHair: null, accessories: null, mask: null }
    expect(customAvatarDataUri('base', none).startsWith('data:image/svg+xml')).toBe(true)
  })

  it('is deterministic for the same seed + options', () => {
    expect(customAvatarDataUri('base', SAMPLE_OPTIONS)).toBe(customAvatarDataUri('base', SAMPLE_OPTIONS))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @legends/web test -- avatar.test.ts
```

Expected: FAIL — `customAvatarDataUri` is not exported.

- [ ] **Step 3: Implement `customAvatarDataUri` + add `openPeeps` to the style map**

In `apps/web/src/lib/avatar.ts`, update the collection import to include `openPeeps`, add it to `STYLE_MAP` (which is typed `Record<AvatarStyleKey, ...>` — now requires an `open-peeps` entry), import the `AvatarOptions` type, and add the function. The top of the file currently is:

```typescript
import { createAvatar, type Style } from '@dicebear/core'
import { personas, bottts, thumbs, croodles, lorelei, micah, toonHead } from '@dicebear/collection'
import type { AvatarStyleKey } from '@legends/shared'

const STYLE_MAP: Record<AvatarStyleKey, Style<Record<string, unknown>>> = {
  personas: personas as Style<Record<string, unknown>>,
  bottts: bottts as Style<Record<string, unknown>>,
  thumbs: thumbs as Style<Record<string, unknown>>,
  croodles: croodles as Style<Record<string, unknown>>,
  lorelei: lorelei as Style<Record<string, unknown>>,
  micah: micah as Style<Record<string, unknown>>,
  'toon-head': toonHead as Style<Record<string, unknown>>,
}
```

Change it to:

```typescript
import { createAvatar, type Style } from '@dicebear/core'
import {
  personas,
  bottts,
  thumbs,
  croodles,
  lorelei,
  micah,
  toonHead,
  openPeeps,
} from '@dicebear/collection'
import type { AvatarStyleKey, AvatarOptions } from '@legends/shared'

const STYLE_MAP: Record<AvatarStyleKey, Style<Record<string, unknown>>> = {
  personas: personas as Style<Record<string, unknown>>,
  bottts: bottts as Style<Record<string, unknown>>,
  thumbs: thumbs as Style<Record<string, unknown>>,
  croodles: croodles as Style<Record<string, unknown>>,
  lorelei: lorelei as Style<Record<string, unknown>>,
  micah: micah as Style<Record<string, unknown>>,
  'toon-head': toonHead as Style<Record<string, unknown>>,
  'open-peeps': openPeeps as Style<Record<string, unknown>>,
}
```

Then add this function after `avatarDataUri` (keep `avatarDataUri`, `AVATAR_SEED_SUGGESTIONS`, `randomSeed` as they are):

```typescript
/**
 * Renders an open-peeps avatar from explicit component choices.
 * Each chosen component is forced via a single-element array; optional
 * components use *Probability 100 (chosen) / 0 (none).
 */
export function customAvatarDataUri(seed: string, options: AvatarOptions): string {
  const built: Record<string, unknown> = {
    seed,
    size: 128,
    head: [options.head],
    face: [options.face],
    skinColor: [options.skinColor],
    clothingColor: [options.clothingColor],
    headContrastColor: [options.headContrastColor],
  }

  if (options.facialHair) {
    built.facialHair = [options.facialHair]
    built.facialHairProbability = 100
  } else {
    built.facialHairProbability = 0
  }

  if (options.accessories) {
    built.accessories = [options.accessories]
    built.accessoriesProbability = 100
  } else {
    built.accessoriesProbability = 0
  }

  if (options.mask) {
    built.mask = [options.mask]
    built.maskProbability = 100
  } else {
    built.maskProbability = 0
  }

  return createAvatar(STYLE_MAP['open-peeps'], built).toDataUri()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm --filter @legends/web test -- avatar.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/avatar.ts apps/web/src/lib/avatar.test.ts
git commit -m "feat(web): render open-peeps avatars from explicit options"
```

---

## Task 5: Avatar component — render from options (TDD)

**Files:**
- Modify: `apps/web/src/components/Avatar.tsx`
- Test: `apps/web/src/components/Avatar.test.tsx`

- [ ] **Step 1: Write the failing test**

In `apps/web/src/components/Avatar.test.tsx`, add this test inside `describe('Avatar', ...)` (keep existing tests):

```typescript
  it('renders an open-peeps image when avatarStyle is open-peeps with options', () => {
    render(
      <Avatar
        user={{
          name: 'Ana Souza',
          avatarStyle: 'open-peeps',
          avatarSeed: 'base',
          avatarOptions: {
            head: 'afro',
            face: 'smile',
            facialHair: null,
            accessories: 'glasses',
            mask: null,
            skinColor: 'edb98a',
            clothingColor: '8fa7df',
            headContrastColor: '2c1b18',
          },
          photoUrl: null,
        }}
      />,
    )
    const img = screen.getByRole('img', { name: 'Ana Souza' })
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @legends/web test -- Avatar.test.tsx
```

Expected: FAIL — `avatarOptions` is not an accepted prop / not used, so it falls back to initials (no img with that name) OR a type error in the test. Either way the assertion fails.

- [ ] **Step 3: Support options in `Avatar`**

In `apps/web/src/components/Avatar.tsx`, update the imports, the `AvatarSource` interface, and the `generated` memo. The file currently imports `avatarDataUri` and types `AvatarSource` without options. Change the top imports to:

```typescript
import { useMemo } from 'react'
import type { AvatarStyleKey, AvatarOptions } from '@legends/shared'
import { avatarDataUri, customAvatarDataUri } from '../lib/avatar'
```

Add `avatarOptions` to `AvatarSource`:

```typescript
export interface AvatarSource {
  name: string
  avatarStyle?: AvatarStyleKey | null
  avatarSeed?: string | null
  avatarOptions?: AvatarOptions | null
  photoUrl?: string | null
}
```

Replace the `generated` memo with one that handles open-peeps first:

```typescript
  const generated = useMemo(() => {
    if (user.avatarStyle === 'open-peeps' && user.avatarOptions) {
      return customAvatarDataUri(user.avatarSeed ?? '', user.avatarOptions)
    }
    if (user.avatarStyle && user.avatarSeed) {
      return avatarDataUri(user.avatarStyle, user.avatarSeed)
    }
    return null
  }, [user.avatarStyle, user.avatarSeed, user.avatarOptions])
```

(The rest of the component — `src = generated ?? user.photoUrl ?? null`, the `<img>` with `imgClassName`, and the initials fallback — stays unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm --filter @legends/web test -- Avatar.test.tsx
```

Expected: PASS (all Avatar tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Avatar.tsx apps/web/src/components/Avatar.test.tsx
git commit -m "feat(web): render custom open-peeps avatars in Avatar component"
```

---

## Task 6: AvatarPicker — mode toggle + open-peeps editor (TDD)

**Files:**
- Modify: `apps/web/src/components/AvatarPicker.tsx`
- Test: `apps/web/src/components/AvatarPicker.test.tsx`

- [ ] **Step 1: Write the failing test**

In `apps/web/src/components/AvatarPicker.test.tsx`, add this test inside `describe('AvatarPicker', ...)` (keep existing tests). It mocks the same `useAuth` already mocked at the top of the file (`user: { id: 'u1', name: 'Ana Souza' }`), so the picker opens in "Sortear" mode; the test switches to "Personalizar" and saves.

```typescript
  it('saves a custom open-peeps avatar from the Personalizar tab', async () => {
    mockApiFetch.mockResolvedValue({
      user: { id: 'u1', name: 'Ana Souza', avatarStyle: 'open-peeps' },
    })
    const onClose = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <AvatarPicker onClose={onClose} />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Personalizar' }))
    // editor is visible
    expect(screen.getByRole('button', { name: 'Aleatório' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled())
    const [path, options] = mockApiFetch.mock.calls[0]
    expect(path).toBe('/auth/me')
    expect(options.method).toBe('PATCH')
    const body = JSON.parse(options.body)
    expect(body.avatarStyle).toBe('open-peeps')
    expect(body.avatarOptions).toBeTruthy()
    expect(body.avatarOptions.head).toBeTruthy()
    expect(body.avatarOptions.face).toBeTruthy()
    await waitFor(() => expect(setUser).toHaveBeenCalled())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @legends/web test -- AvatarPicker.test.tsx
```

Expected: FAIL — there is no "Personalizar" button / no "Aleatório" button yet.

- [ ] **Step 3: Rewrite `AvatarPicker.tsx` with the mode toggle + editor**

Replace the entire contents of `apps/web/src/components/AvatarPicker.tsx` with:

```typescript
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AVATAR_STYLE_KEYS,
  AVATAR_STYLE_LABELS,
  DEFAULT_AVATAR_STYLE,
  DEFAULT_OPEN_PEEPS_OPTIONS,
  OPEN_PEEPS_COLOR_COMPONENTS,
  OPEN_PEEPS_VARIANT_COMPONENTS,
  type AvatarOptions,
  type AvatarStyleKey,
  type PublicUser,
} from '@legends/shared'
import { apiFetch, ApiError } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import {
  avatarDataUri,
  customAvatarDataUri,
  AVATAR_SEED_SUGGESTIONS,
  randomSeed,
} from '../lib/avatar'
import { Icon } from './Icon'

type Mode = 'shuffle' | 'custom'

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function randomOptions(): AvatarOptions {
  return {
    head: pick(OPEN_PEEPS_VARIANT_COMPONENTS[0].variants),
    face: pick(OPEN_PEEPS_VARIANT_COMPONENTS[1].variants),
    facialHair: Math.random() < 0.4 ? pick(OPEN_PEEPS_VARIANT_COMPONENTS[2].variants) : null,
    accessories: Math.random() < 0.5 ? pick(OPEN_PEEPS_VARIANT_COMPONENTS[3].variants) : null,
    mask: null,
    skinColor: pick(OPEN_PEEPS_COLOR_COMPONENTS[0].palette),
    clothingColor: pick(OPEN_PEEPS_COLOR_COMPONENTS[1].palette),
    headContrastColor: pick(OPEN_PEEPS_COLOR_COMPONENTS[2].palette),
  } as AvatarOptions
}

/** Cycles a variant component, threading "none" (null) at the start when allowed. */
function cycleVariant(
  current: string | null,
  variants: readonly string[],
  allowsNone: boolean,
  dir: 1 | -1,
): string | null {
  const list: (string | null)[] = allowsNone ? [null, ...variants] : [...variants]
  const idx = list.indexOf(current)
  const next = (idx + dir + list.length) % list.length
  return list[next]
}

export function AvatarPicker({ onClose }: { onClose: () => void }) {
  const { user, setUser } = useAuth()
  const queryClient = useQueryClient()

  const [mode, setMode] = useState<Mode>(user?.avatarStyle === 'open-peeps' ? 'custom' : 'shuffle')

  // shuffle mode
  const [style, setStyle] = useState<AvatarStyleKey>(
    user?.avatarStyle && user.avatarStyle !== 'open-peeps' ? user.avatarStyle : DEFAULT_AVATAR_STYLE,
  )
  const [seeds, setSeeds] = useState<string[]>([...AVATAR_SEED_SUGGESTIONS])
  const [selectedSeed, setSelectedSeed] = useState<string | null>(
    user?.avatarStyle !== 'open-peeps' ? user?.avatarSeed ?? null : null,
  )

  // custom mode
  const [options, setOptions] = useState<AvatarOptions>(
    user?.avatarOptions ?? DEFAULT_OPEN_PEEPS_OPTIONS,
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function shuffle() {
    setSeeds(Array.from({ length: 12 }, () => randomSeed()))
  }

  function setOption<K extends keyof AvatarOptions>(key: K, value: AvatarOptions[K]) {
    setOptions((prev) => ({ ...prev, [key]: value }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const body =
        mode === 'custom'
          ? {
              avatarStyle: 'open-peeps' as const,
              avatarSeed: user?.avatarSeed ?? randomSeed(),
              avatarOptions: options,
            }
          : { avatarStyle: style, avatarSeed: selectedSeed }

      if (mode === 'shuffle' && !selectedSeed) {
        setError('Escolha um avatar antes de salvar.')
        setSaving(false)
        return
      }

      const res = await apiFetch<{ user: PublicUser }>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify(body),
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
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
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

        {/* Mode toggle */}
        <div className="mb-lg flex gap-sm">
          {(['shuffle', 'custom'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded-md border px-md py-sm font-label text-label-md transition-colors ${
                mode === m
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-outline-variant/50 bg-surface-container-high text-on-surface'
              }`}
            >
              {m === 'shuffle' ? 'Sortear' : 'Personalizar'}
            </button>
          ))}
        </div>

        {mode === 'shuffle' ? (
          <>
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

            <div className="mb-lg grid grid-cols-4 gap-md sm:grid-cols-6">
              {seeds.map((seed) => (
                <button
                  key={seed}
                  type="button"
                  aria-label={`Selecionar avatar ${seed}`}
                  onClick={() => setSelectedSeed(seed)}
                  className={`flex aspect-square items-center justify-center overflow-hidden rounded-lg border-2 bg-surface-container-highest transition-all ${
                    selectedSeed === seed
                      ? 'border-primary'
                      : 'border-transparent hover:border-outline-variant/50'
                  }`}
                >
                  <img src={avatarDataUri(style, seed)} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>

            <div className="mb-lg flex">
              <button
                type="button"
                onClick={shuffle}
                className="inline-flex items-center gap-sm rounded-md border border-outline-variant/50 px-md py-sm font-label text-label-md text-on-surface transition-colors hover:border-primary"
              >
                <Icon name="shuffle" className="text-[18px]" />
                Embaralhar
              </button>
            </div>
          </>
        ) : (
          <div className="mb-lg flex flex-col gap-lg">
            {/* Live preview */}
            <div className="flex justify-center">
              <div className="h-32 w-32 overflow-hidden rounded-full border-4 border-primary bg-surface-container-highest">
                <img
                  src={customAvatarDataUri(user?.avatarSeed ?? 'preview', options)}
                  alt="Prévia do avatar"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>

            {/* Variant components */}
            {OPEN_PEEPS_VARIANT_COMPONENTS.map((comp) => {
              const value = options[comp.key as keyof AvatarOptions] as string | null
              const display = value ?? 'Nenhum'
              return (
                <div key={comp.key} className="flex items-center justify-between gap-md">
                  <span className="font-label text-label-md text-on-surface">{comp.label}</span>
                  <div className="flex items-center gap-sm">
                    <button
                      type="button"
                      aria-label={`${comp.label} anterior`}
                      onClick={() =>
                        setOption(
                          comp.key as keyof AvatarOptions,
                          cycleVariant(value, comp.variants, comp.allowsNone, -1) as never,
                        )
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-outline-variant/50 text-on-surface hover:border-primary"
                    >
                      <Icon name="chevron_left" className="text-[18px]" />
                    </button>
                    <span className="min-w-24 text-center font-label text-label-sm text-on-surface-variant">
                      {display}
                    </span>
                    <button
                      type="button"
                      aria-label={`${comp.label} próximo`}
                      onClick={() =>
                        setOption(
                          comp.key as keyof AvatarOptions,
                          cycleVariant(value, comp.variants, comp.allowsNone, 1) as never,
                        )
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-outline-variant/50 text-on-surface hover:border-primary"
                    >
                      <Icon name="chevron_right" className="text-[18px]" />
                    </button>
                  </div>
                </div>
              )
            })}

            {/* Color components */}
            {OPEN_PEEPS_COLOR_COMPONENTS.map((comp) => {
              const value = options[comp.key as keyof AvatarOptions] as string
              return (
                <div key={comp.key} className="flex items-center justify-between gap-md">
                  <span className="font-label text-label-md text-on-surface">{comp.label}</span>
                  <div className="flex flex-wrap gap-xs">
                    {comp.palette.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`${comp.label} ${color}`}
                        onClick={() => setOption(comp.key as keyof AvatarOptions, color as never)}
                        style={{ backgroundColor: `#${color}` }}
                        className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                          value === color ? 'border-primary' : 'border-transparent'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )
            })}

            <div className="flex">
              <button
                type="button"
                onClick={() => setOptions(randomOptions())}
                className="inline-flex items-center gap-sm rounded-md border border-outline-variant/50 px-md py-sm font-label text-label-md text-on-surface transition-colors hover:border-primary"
              >
                <Icon name="shuffle" className="text-[18px]" />
                Aleatório
              </button>
            </div>
          </div>
        )}

        {error && <p className="mb-md font-label text-label-sm text-error">{error}</p>}

        <div className="flex justify-end gap-sm">
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
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm --filter @legends/web test -- AvatarPicker.test.tsx
```

Expected: PASS (all AvatarPicker tests — the existing "renders the style options" and "saves the selected avatar" still pass because shuffle mode is unchanged and is the default).

- [ ] **Step 5: Typecheck + full web suite**

Run:

```bash
pnpm --filter @legends/web exec tsc --noEmit && pnpm --filter @legends/web test
```

Expected: tsc PASS; web tests all PASS except the single pre-existing `src/App.test.tsx` failure.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/AvatarPicker.tsx apps/web/src/components/AvatarPicker.test.tsx
git commit -m "feat(web): add open-peeps customization mode to AvatarPicker"
```

---

## Task 7: Full verification

- [ ] **Step 1: Typecheck all packages**

Run:

```bash
pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 2: Run all tests**

Run:

```bash
pnpm --filter @legends/api test && pnpm --filter @legends/web test
```

Expected: API all PASS; web all PASS except the pre-existing `src/App.test.tsx` failure (confirm it is the ONLY failure and it is that file).

- [ ] **Step 3: Manual smoke test (recommended)**

Start the stack (`docker-compose up -d`, `pnpm --filter @legends/api dev`, `pnpm --filter @legends/web dev`), log in, open your own profile, click "Editar avatar", switch to "Personalizar", cycle some components, pick colors, click "Aleatório", then "Salvar". Confirm the profile hero and header update immediately to the custom open-peeps avatar without a page reload.

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), shared allowlists/types/defaults (Task 2), serialize + validation + coherence-clear (Task 3), local rendering with probability handling (Task 4), Avatar resolution order incl. open-peeps (Task 5), mode toggle + per-component editor + colors + Aleatório + save (Task 6). All eight components covered (head, face, facialHair, accessories, mask, skinColor, clothingColor, headContrastColor).
- **Type consistency:** `AvatarOptions` defined once in shared and reused by serialize, the Zod schema (field-by-field), `customAvatarDataUri`, `Avatar`, and `AvatarPicker`. `customAvatarDataUri(seed, options)` signature identical across lib/test/component. `ALL_AVATAR_STYLE_KEYS` used by the API enum and `STYLE_MAP` (Record over the widened `AvatarStyleKey`, hence the required `open-peeps` entry). `OPEN_PEEPS_VARIANT_COMPONENTS`/`OPEN_PEEPS_COLOR_COMPONENTS` drive both UI and (via the underlying enums) backend validation.
- **Prisma jsonb null:** clearing uses `Prisma.DbNull` (not TS `null`), setting uses the object cast to `Prisma.InputJsonValue` — the known Prisma `Json?` requirement.
- **Coexistence:** seed-shuffle mode and the 7 styles are unchanged; `photoUrl` fallback intact. open-peeps is CC0 (no attribution); the CC BY 4.0 gallery-style attribution remains a separate open item.
```
