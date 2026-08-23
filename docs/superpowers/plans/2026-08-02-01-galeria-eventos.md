# Galeria de eventos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar álbuns de fotos de eventos da empresa no Legends — G&G cria o álbum e sobe fotos em lote; qualquer pessoa com a feature `galeria` vê a grade, abre o lightbox, reage e comenta.

**Architecture:** Backend em `route → service → Prisma`, com quatro models novos tenant-scoped (`EventAlbum`, `EventPhoto`, `EventPhotoReaction`, `EventPhotoComment`). Foto vai para o S3 por URL pré-assinada de PUT; o banco guarda só a `storageKey` e o `serialize.ts` resolve a URL pública. Escrita sob `requireSectorFeature('gente-gestao')`, leitura sob `requireFeature('galeria')`.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Zod, `@aws-sdk/client-s3`, React 18 + React Query + Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-02-galeria-eventos-design.md`

## Global Constraints

- TypeScript **strict**, ESM puro. Node ≥ 20. **O shell desta máquina abre em Node 18** — prefixe todo comando com
  `PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"` e confirme com `node -v` antes de rodar qualquer coisa.
- O Postgres deste worktree é o container **`legends-db-barnacle`, porta 5492** (já de pé, migrations aplicadas, Prisma Client gerado). Todo comando de teste da API leva `LEGENDS_DB_PORT=5492`. **Nunca use 5442** — é o banco de outro worktree, e apontar para lá causa centenas de falhas fantasma nos dois lados.
- Rode sempre a partir da raiz do repo (`/Users/waghnerreis/orca/workspaces/Legends/barnacle`), com caminhos absolutos.
- Testes da API rodam contra Postgres real: `pnpm db:up` antes, e **nesta máquina** todo comando de teste da API leva `LEGENDS_DB_PORT=5492`.
- Toda mensagem voltada ao usuário em **português**.
- Todo model novo leva `companyId` (`@default("company-emr")`) + índice, e **precisa ser registrado em `TENANT_SCOPED_MODELS`** (`apps/api/src/lib/tenant-scope.ts`) — sem isso o `scopedPrisma` o ignora em silêncio.
- Todo model novo precisa entrar no `deleteMany()` de `apps/api/test/setup.ts`, **antes** de `prisma.user.deleteMany()`, senão a suíte quebra por FK.
- Rota fina: Zod `safeParse` → `400 { message, issues }` → service → `serialize.ts`. Regra de negócio só no service.
- Contrato primeiro: tipo em `packages/shared` antes dos dois lados.
- Mutação de admin grava `recordAuditLog`, dentro da transação quando houver.
- Nunca editar migration já aplicada — sempre `pnpm db:migrate`.
- Toda mensagem de commit termina com:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- Durante a implementação rode só o(s) arquivo(s) de teste tocados. `pnpm test` completo é lento e só entra na verificação final.

---

### Task 1: Contrato compartilhado

**Files:**
- Create: `packages/shared/src/event-album.ts`
- Create: `packages/shared/src/event-album.test.ts`
- Modify: `packages/shared/src/index.ts` (adicionar o `export *`)
- Modify: `packages/shared/src/third-party.ts` (chave e label da feature `galeria`)

**Interfaces:**
- Consumes: `ReactionSummary` (`./feedback`), `PublicUser` (`./auth`), `REVIEW_REACTIONS` (`./review`).
- Produces: `EventAlbumDTO`, `EventPhotoDTO`, `EventAlbumDetailResponse`, `EventAlbumListResponse`, `EventPhotoCommentDTO`, `EventPhotoCommentListResponse`, `CreateEventAlbumRequest`, `UpdateEventAlbumRequest`, `EventPhotoInput`, `AddEventPhotosRequest`, `SetEventAlbumCoverRequest`, `CreateEventPhotoCommentRequest`, `ToggleEventPhotoReactionRequest`, `EVENT_PHOTO_MAX_BATCH`, `EVENT_ALBUM_TITLE_MAX_LENGTH`, `EVENT_ALBUM_DESCRIPTION_MAX_LENGTH`, `EVENT_PHOTO_COMMENT_MAX_LENGTH`, `EVENT_PHOTO_REACTIONS`, feature key `'galeria'`.

Nota de desvio do spec: o spec previa um `EventPhotoReactionSummary` próprio com `reactors: ReactorRef[]`. Usamos o `ReactionSummary` que já existe (`emoji`, `count`, `reactedByMe`, `users`) porque o `summarizeReactions` do `serialize.ts` já produz exatamente essa forma — tipo novo aqui seria duplicação.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/event-album.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { FEATURE_KEYS, FEATURE_LABELS } from './third-party'
import { EVENT_PHOTO_MAX_BATCH, EVENT_PHOTO_REACTIONS } from './event-album'
import { REVIEW_REACTIONS } from './review'

describe('contrato da galeria de eventos', () => {
  it('expõe a feature de colaborador `galeria` com label', () => {
    expect(FEATURE_KEYS).toContain('galeria')
    expect(FEATURE_LABELS.galeria).toBe('Galeria de eventos')
  })

  it('limita o lote de upload a 20 fotos', () => {
    expect(EVENT_PHOTO_MAX_BATCH).toBe(20)
  })

  it('reusa o conjunto de emojis da resenha, sem inventar emoji novo', () => {
    expect(EVENT_PHOTO_REACTIONS).toEqual(REVIEW_REACTIONS)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/shared exec vitest run src/event-album.test.ts`
Expected: FAIL — `Failed to resolve import "./event-album"`.

- [ ] **Step 3: Create the contract file**

Create `packages/shared/src/event-album.ts`:

```ts
import type { PublicUser } from './auth'
import type { ReactionSummary } from './feedback'
import { REVIEW_REACTIONS } from './review'

/** Máximo de fotos por lote de upload. Não limita o tamanho do álbum — só a leva. */
export const EVENT_PHOTO_MAX_BATCH = 20
export const EVENT_ALBUM_TITLE_MAX_LENGTH = 120
export const EVENT_ALBUM_DESCRIPTION_MAX_LENGTH = 2000
export const EVENT_PHOTO_COMMENT_MAX_LENGTH = 500

/** Mesmo conjunto do mural corporativo e da resenha — sem emoji exclusivo da galeria. */
export const EVENT_PHOTO_REACTIONS = REVIEW_REACTIONS
export type EventPhotoReactionEmoji = (typeof EVENT_PHOTO_REACTIONS)[number]

/** Álbum como aparece na grade. `coverUrl` já vem resolvida — o front não monta URL. */
export interface EventAlbumDTO {
  id: string
  title: string
  description: string | null
  /** ISO-8601, ou null quando o álbum não tem data de evento. */
  eventDate: string | null
  coverUrl: string | null
  photoCount: number
  createdAt: string
}

export interface EventPhotoDTO {
  id: string
  albumId: string
  url: string
  width: number | null
  height: number | null
  createdAt: string
  reactions: ReactionSummary[]
  commentCount: number
}

export interface EventPhotoCommentDTO {
  id: string
  photoId: string
  author: PublicUser
  body: string
  createdAt: string
  /** O visitante pode apagar este comentário? (autor, ou quem administra G&G) */
  canDelete: boolean
}

export interface EventAlbumListResponse {
  albums: EventAlbumDTO[]
}

export interface EventAlbumDetailResponse {
  album: EventAlbumDTO
  photos: EventPhotoDTO[]
}

export interface EventPhotoCommentListResponse {
  comments: EventPhotoCommentDTO[]
}

export interface CreateEventAlbumRequest {
  title: string
  description?: string | null
  eventDate?: string | null
}

export interface UpdateEventAlbumRequest {
  title?: string
  description?: string | null
  eventDate?: string | null
}

/** Uma foto já enviada ao storage, confirmada para o álbum. */
export interface EventPhotoInput {
  storageKey: string
  width?: number | null
  height?: number | null
}

export interface AddEventPhotosRequest {
  photos: EventPhotoInput[]
}

export interface SetEventAlbumCoverRequest {
  photoId: string
}

export interface CreateEventPhotoCommentRequest {
  body: string
}

export interface ToggleEventPhotoReactionRequest {
  emoji: EventPhotoReactionEmoji
}
```

- [ ] **Step 4: Add the feature key**

In `packages/shared/src/third-party.ts`, add `'galeria'` as the last entry of `COLLABORATOR_FEATURE_KEYS`:

```ts
  'pdi',
  'assistente',
  'galeria',
] as const
```

And the label, in `FEATURE_LABELS`, right after `assistente`:

```ts
  assistente: 'Assistente de RH',
  galeria: 'Galeria de eventos',
```

- [ ] **Step 5: Export from the barrel**

In `packages/shared/src/index.ts`, add after `export * from './culture'`:

```ts
export * from './event-album'
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @legends/shared exec vitest run src/event-album.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/event-album.ts packages/shared/src/event-album.test.ts packages/shared/src/index.ts packages/shared/src/third-party.ts
git commit -m "feat(shared): contrato da galeria de eventos e feature galeria"
```

---

### Task 2: Models Prisma, migration e isolamento por empresa

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (4 models novos + relações inversas em `User` e `Company`)
- Modify: `apps/api/src/lib/tenant-scope.ts` (registrar os 4 models)
- Modify: `apps/api/test/setup.ts` (truncar os 4 models)
- Create: migration gerada por `pnpm db:migrate`
- Create: `apps/api/src/lib/event-album-tenant-scope.test.ts`

**Interfaces:**
- Consumes: nada das tasks anteriores.
- Produces: `prisma.eventAlbum`, `prisma.eventPhoto`, `prisma.eventPhotoReaction`, `prisma.eventPhotoComment` com os campos abaixo — todas as tasks seguintes dependem desses nomes.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/event-album-tenant-scope.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from './prisma'
import { scopedPrisma } from './tenant-scope'

async function makeCompany(id: string) {
  return prisma.company.create({ data: { id, name: id, slug: id } })
}

describe('isolamento por empresa da galeria', () => {
  it('não devolve álbum de outra empresa', async () => {
    await makeCompany('company-outra')
    const autor = await prisma.user.create({
      data: { name: 'Autor', email: `autor-${Math.random()}@empresa.com`, passwordHash: 'x', sectorId: 'sector-dev-produto' },
    })
    await prisma.eventAlbum.create({
      data: { title: 'Confra da EMR', createdById: autor.id, companyId: 'company-emr' },
    })
    await prisma.eventAlbum.create({
      data: { title: 'Confra alheia', createdById: autor.id, companyId: 'company-outra' },
    })

    const visiveis = await scopedPrisma('company-emr').eventAlbum.findMany()

    expect(visiveis.map((a) => a.title)).toEqual(['Confra da EMR'])
  })

  it('injeta o companyId do escopo ao criar', async () => {
    const autor = await prisma.user.create({
      data: { name: 'Autor', email: `autor-${Math.random()}@empresa.com`, passwordHash: 'x', sectorId: 'sector-dev-produto' },
    })
    const album = await scopedPrisma('company-emr').eventAlbum.create({
      data: { title: 'Hackathon', createdById: autor.id },
    })
    expect(album.companyId).toBe('company-emr')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm db:up && LEGENDS_DB_PORT=5492 pnpm --filter @legends/api exec vitest run src/lib/event-album-tenant-scope.test.ts`
Expected: FAIL — `prisma.eventAlbum` é `undefined`.

- [ ] **Step 3: Add the models to the schema**

Append to `apps/api/prisma/schema.prisma`:

```prisma
/// Álbum de fotos de um evento da empresa (confraternização, hackathon, onboarding).
model EventAlbum {
  id           String    @id @default(cuid())
  title        String
  description  String?
  eventDate    DateTime?
  /// Capa: FK para uma foto do próprio álbum. SetNull para que apagar a foto-capa
  /// não deixe o álbum apontando para objeto inexistente — a grade cai no fallback.
  coverPhotoId String?   @unique
  createdById  String
  companyId    String    @default("company-emr")
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  cover     EventPhoto?  @relation("AlbumCover", fields: [coverPhotoId], references: [id], onDelete: SetNull)
  photos    EventPhoto[] @relation("AlbumPhotos")
  createdBy User         @relation("EventAlbumsCreated", fields: [createdById], references: [id])
  company   Company      @relation(fields: [companyId], references: [id])

  @@index([companyId, eventDate])
}

/// Foto de um álbum. Guarda a CHAVE do objeto no S3, nunca a URL — URL assinada
/// expira e URL pública gravada engessa o bucket. O serialize resolve a pública.
model EventPhoto {
  id           String   @id @default(cuid())
  albumId      String
  storageKey   String
  width        Int?
  height       Int?
  uploadedById String
  companyId    String   @default("company-emr")
  createdAt    DateTime @default(now())

  album      EventAlbum           @relation("AlbumPhotos", fields: [albumId], references: [id], onDelete: Cascade)
  coverOf    EventAlbum?          @relation("AlbumCover")
  uploadedBy User                 @relation("EventPhotosUploaded", fields: [uploadedById], references: [id])
  company    Company              @relation(fields: [companyId], references: [id])
  reactions  EventPhotoReaction[]
  comments   EventPhotoComment[]

  @@index([albumId, createdAt])
  @@index([companyId])
}

model EventPhotoReaction {
  id        String   @id @default(cuid())
  photoId   String
  userId    String
  emoji     String
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")

  photo   EventPhoto @relation(fields: [photoId], references: [id], onDelete: Cascade)
  user    User       @relation("EventPhotoReactions", fields: [userId], references: [id], onDelete: Cascade)
  company Company    @relation(fields: [companyId], references: [id])

  @@unique([photoId, userId, emoji])
  @@index([photoId])
  @@index([companyId])
}

model EventPhotoComment {
  id        String   @id @default(cuid())
  photoId   String
  authorId  String
  body      String
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")

  photo   EventPhoto @relation(fields: [photoId], references: [id], onDelete: Cascade)
  author  User       @relation("EventPhotoComments", fields: [authorId], references: [id], onDelete: Cascade)
  company Company    @relation(fields: [companyId], references: [id])

  @@index([photoId, createdAt])
  @@index([companyId])
}
```

- [ ] **Step 4: Add the inverse relation fields**

O Prisma exige o outro lado de cada relação. In `model User`, add:

```prisma
  eventAlbumsCreated   EventAlbum[]         @relation("EventAlbumsCreated")
  eventPhotosUploaded  EventPhoto[]         @relation("EventPhotosUploaded")
  eventPhotoReactions  EventPhotoReaction[] @relation("EventPhotoReactions")
  eventPhotoComments   EventPhotoComment[]  @relation("EventPhotoComments")
```

In `model Company`, add:

```prisma
  eventAlbums         EventAlbum[]
  eventPhotos         EventPhoto[]
  eventPhotoReactions EventPhotoReaction[]
  eventPhotoComments  EventPhotoComment[]
```

- [ ] **Step 5: Generate the migration**

Run: `pnpm db:migrate --name add_event_albums`
Expected: uma migration nova em `apps/api/prisma/migrations/<timestamp>_add_event_albums/`. Nenhuma migration existente é modificada.

Se a migration falhar por drift no banco de dev (worktrees compartilham o `legends-db`), **não** aceite o reset sugerido pelo Prisma — pare e reporte.

- [ ] **Step 6: Register in tenant-scope**

In `apps/api/src/lib/tenant-scope.ts`, add to `TENANT_SCOPED_MODELS` (after `'AssistantFeedback'`):

```ts
  'EventAlbum',
  'EventPhoto',
  'EventPhotoReaction',
  'EventPhotoComment',
```

- [ ] **Step 7: Register in the test truncation**

In `apps/api/test/setup.ts`, add inside the `$transaction([...])` array, **before** `prisma.challengeSubmission.deleteMany()` (ordem importa: filhos antes dos pais, e tudo antes de `user.deleteMany()`):

```ts
    prisma.eventPhotoComment.deleteMany(),
    prisma.eventPhotoReaction.deleteMany(),
    prisma.eventPhoto.deleteMany(),
    prisma.eventAlbum.deleteMany(),
```

Atenção: `EventAlbum.coverPhotoId` aponta para `EventPhoto`. `eventPhoto.deleteMany()` antes de `eventAlbum.deleteMany()` funciona porque a FK é `SetNull`, não `Restrict`.

- [ ] **Step 8: Run test to verify it passes**

Run: `LEGENDS_DB_PORT=5492 pnpm --filter @legends/api exec vitest run src/lib/event-album-tenant-scope.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma apps/api/src/lib/tenant-scope.ts apps/api/src/lib/event-album-tenant-scope.test.ts apps/api/test/setup.ts
git commit -m "feat(api): models de album de evento com isolamento por empresa"
```

---

### Task 3: Storage — chave, presign e helper de upload no web

**Files:**
- Modify: `apps/api/src/lib/s3-client.ts` (`buildEventPhotoKey`)
- Modify: `apps/api/src/lib/s3-client.test.ts` (teste da chave)
- Modify: `apps/api/src/routes/image-uploads.ts` (rota de presign)
- Modify: `apps/api/src/routes/image-uploads.test.ts` (testes da rota)
- Modify: `apps/web/src/lib/upload.ts` (`uploadEventPhoto`)

**Interfaces:**
- Consumes: `IMAGE_MAX_BYTES`, `ALLOWED_IMAGE_CONTENT_TYPES`, `isAllowedImageContentType` (`@legends/shared`).
- Produces:
  - `buildEventPhotoKey(companyId: string, contentType: AllowedImageContentType, id?: string): string`
  - `POST /uploads/event-photos/presign` → `{ uploadUrl: string; key: string }`
  - `uploadEventPhoto(file: File): Promise<EventPhotoInput>` (web)

- [ ] **Step 1: Write the failing test for the key builder**

Add to `apps/api/src/lib/s3-client.test.ts`:

```ts
describe('buildEventPhotoKey', () => {
  it('namespaceia a foto por empresa, com a extensão do content-type', () => {
    expect(buildEventPhotoKey('company-emr', 'image/jpeg', 'abc')).toBe('event-photos/company-emr/abc.jpg')
    expect(buildEventPhotoKey('company-emr', 'image/webp', 'abc')).toBe('event-photos/company-emr/abc.webp')
  })
})
```

Add `buildEventPhotoKey` to the existing import at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `LEGENDS_DB_PORT=5492 pnpm --filter @legends/api exec vitest run src/lib/s3-client.test.ts`
Expected: FAIL — `buildEventPhotoKey is not a function`.

- [ ] **Step 3: Implement the key builder**

In `apps/api/src/lib/s3-client.ts`, after `buildChallengeEvidenceKey`:

```ts
/**
 * Chave da foto de um álbum de evento: event-photos/<companyId>/<uuid>.<ext>.
 * Prefixo próprio (não `reviews/`) e namespaced por empresa. A chave nasce SEMPRE
 * no servidor — o cliente nunca escolhe onde a foto é gravada.
 */
export function buildEventPhotoKey(
  companyId: string,
  contentType: AllowedImageContentType,
  id: string = randomUUID(),
): string {
  return `event-photos/${companyId}/${id}.${EXT_BY_TYPE[contentType]}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `LEGENDS_DB_PORT=5492 pnpm --filter @legends/api exec vitest run src/lib/s3-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the presign route**

Add to `apps/api/src/routes/image-uploads.test.ts`. O arquivo já tem `makeUser(app, role)` (2 argumentos, `features: []` fixo) e os helpers `enableS3()` / `disableS3()` — reuse os três como estão. `ADMIN` passa em `requireSectorFeature` sem feature nenhuma, e `LEGEND` nunca passa: é exatamente o que os testes precisam.

```ts
describe('presign de foto de evento', () => {
  it('recusa content-type fora do permitido, em português', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    const res = await app.inject({
      method: 'POST',
      url: '/uploads/event-photos/presign',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { contentType: 'application/pdf', size: 1000 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Formato não suportado. Use JPEG, PNG, WebP ou GIF.')
    await app.close()
  })

  it('recusa arquivo acima do limite, em português', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    const res = await app.inject({
      method: 'POST',
      url: '/uploads/event-photos/presign',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { contentType: 'image/jpeg', size: IMAGE_MAX_BYTES + 1 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Imagem muito grande (máx. 10MB).')
    await app.close()
  })

  it('nega quem não administra Gente e Gestão', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const colaborador = await makeUser(app, 'LEGEND')

    const res = await app.inject({
      method: 'POST',
      url: '/uploads/event-photos/presign',
      headers: { authorization: `Bearer ${colaborador.token}` },
      payload: { contentType: 'image/jpeg', size: 1000 },
    })

    expect(res.statusCode).toBe(403)
    await app.close()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `LEGENDS_DB_PORT=5492 pnpm --filter @legends/api exec vitest run src/routes/image-uploads.test.ts`
Expected: FAIL — a rota responde 404.

- [ ] **Step 7: Implement the presign route**

In `apps/api/src/routes/image-uploads.ts`, add `buildEventPhotoKey` to the import from `../lib/s3-client` and append this route inside `imageUploadRoutes`:

```ts
  // Foto de álbum de evento: só quem administra Gente e Gestão sobe (a galeria é
  // publicada por G&G, não por qualquer colaborador). Mesmos tipo/tamanho de
  // imagem já padronizados em @legends/shared — sem limite novo. A resposta NÃO
  // devolve URL: quem resolve a pública é o serialize, a partir da chave salva.
  app.post(
    '/uploads/event-photos/presign',
    { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] },
    async (request, reply) => {
      if (!s3Config()) return reply.code(503).send({ message: 'Uploads de imagem desabilitados.' })

      const parsed = presignSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
      }
      const { contentType, size } = parsed.data
      if (!isAllowedImageContentType(contentType)) {
        return reply.code(400).send({ message: 'Formato não suportado. Use JPEG, PNG, WebP ou GIF.' })
      }
      if (size > IMAGE_MAX_BYTES) {
        return reply.code(400).send({ message: 'Imagem muito grande (máx. 10MB).' })
      }

      const key = buildEventPhotoKey(request.user.companyId, contentType as AllowedImageContentType)
      const uploadUrl = await presignImageUpload({ key, contentType })
      return reply.send({ uploadUrl, key })
    },
  )
```

Nota: `enableS3()` é obrigatório em cada teste — sem as variáveis `S3_*` a rota responde 503 antes de chegar na validação de tipo/tamanho, e os testes de 400 falhariam por motivo errado. O `afterEach` que já existe no arquivo restaura o ambiente.

- [ ] **Step 8: Run test to verify it passes**

Run: `LEGENDS_DB_PORT=5492 pnpm --filter @legends/api exec vitest run src/routes/image-uploads.test.ts`
Expected: PASS.

- [ ] **Step 9: Add the web upload helper**

In `apps/web/src/lib/upload.ts`, add `EventPhotoInput` to the type imports from `@legends/shared` and append:

```ts
/**
 * Fluxo da foto de álbum de evento: valida → dimensões → presign → PUT no S3.
 * Devolve a CHAVE (mais as dimensões lidas no browser), não uma URL: quem resolve
 * a URL pública é a API, no serialize, a partir da chave confirmada no álbum.
 */
export async function uploadEventPhoto(file: File): Promise<EventPhotoInput> {
  validateImageFile(file)
  const { width, height } = await readImageDimensions(file)
  const presign = await apiFetch<{ uploadUrl: string; key: string }>('/uploads/event-photos/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType: file.type, size: file.size }),
  })
  // PUT direto no S3 (fetch cru, fora do apiFetch): sem Authorization.
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!put.ok) throw new UploadError('Falha ao enviar a foto.')
  return { storageKey: presign.key, width, height }
}
```

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/lib/s3-client.ts apps/api/src/lib/s3-client.test.ts apps/api/src/routes/image-uploads.ts apps/api/src/routes/image-uploads.test.ts apps/web/src/lib/upload.ts
git commit -m "feat(api): presign de foto de album de evento"
```

---

### Task 4: Service do álbum — CRUD, fotos, capa e exclusão sem órfão

**Files:**
- Create: `apps/api/src/services/event-album-service.ts`
- Create: `apps/api/src/services/event-album-service.test.ts`

**Interfaces:**
- Consumes: `scopedPrisma` (`../lib/tenant-scope`), `deleteS3Object` (`../lib/s3-client`), `recordAuditLog` (`./audit-log-service`), `prisma` (`../lib/prisma`), tipos da Task 1, models da Task 2.
- Produces:
  - `class EventAlbumError extends Error { status: number }`
  - `listAlbums(companyId: string): Promise<{ album: EventAlbumRow; photoCount: number; coverKey: string | null }[]>`
  - `getAlbumWithPhotos(id: string, companyId: string, viewerId: string)` → `{ album, photoCount, coverKey, photos }`
  - `createAlbum(input: CreateEventAlbumRequest, companyId: string, actorId: string)`
  - `updateAlbum(id: string, input: UpdateEventAlbumRequest, companyId: string, actorId: string)`
  - `deleteAlbum(id: string, companyId: string, actorId: string): Promise<void>`
  - `addPhotos(albumId: string, input: AddEventPhotosRequest, companyId: string, actorId: string)`
  - `deletePhoto(albumId: string, photoId: string, companyId: string, actorId: string): Promise<void>`
  - `setCover(albumId: string, photoId: string, companyId: string, actorId: string)`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/event-album-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '../lib/prisma'

// `s3Config` também é stubado: sem ele `removeObjects` sai cedo e o teste de
// exclusão passaria sem nunca exercitar o apagamento no storage.
vi.mock('../lib/s3-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/s3-client')>()
  return {
    ...actual,
    deleteS3Object: vi.fn().mockResolvedValue(undefined),
    s3Config: () => ({ bucket: 'b', region: 'us-east-1', publicBaseUrl: 'https://cdn.exemplo.com' }),
  }
})

// Conta as operações Prisma da galeria para provar que a listagem não faz N+1.
const { opLog } = vi.hoisted(() => ({ opLog: [] as string[] }))

vi.mock('../lib/tenant-scope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tenant-scope')>()
  const MODELS = ['eventAlbum', 'eventPhoto', 'eventPhotoReaction', 'eventPhotoComment']
  return {
    ...actual,
    scopedPrisma: (companyId: string) => {
      const db = actual.scopedPrisma(companyId)
      return new Proxy(db as object, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver)
          if (typeof prop !== 'string' || !MODELS.includes(prop)) return value
          return new Proxy(value as object, {
            get(delegate, op, r2) {
              const fn = Reflect.get(delegate, op, r2)
              if (typeof fn !== 'function') return fn
              return (...args: unknown[]) => {
                opLog.push(`${prop}.${String(op)}`)
                return (fn as (...a: unknown[]) => unknown).apply(delegate, args)
              }
            },
          })
        },
      }) as typeof db
    },
  }
})

import { deleteS3Object } from '../lib/s3-client'
import {
  addPhotos,
  createAlbum,
  deleteAlbum,
  deletePhoto,
  EventAlbumError,
  listAlbums,
  setCover,
} from './event-album-service'

const COMPANY = 'company-emr'

async function makeActor() {
  return prisma.user.create({
    data: { name: 'G&G', email: `gg-${Math.random()}@empresa.com`, passwordHash: 'x', sectorId: 'sector-dev-produto' },
  })
}

describe('event-album-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    opLog.length = 0
  })

  it('apaga o álbum, as fotos e os objetos do storage — nada fica órfão', async () => {
    const actor = await makeActor()
    const album = await createAlbum({ title: 'Confra 2026' }, COMPANY, actor.id)
    await addPhotos(
      album.id,
      { photos: [{ storageKey: 'event-photos/company-emr/a.jpg' }, { storageKey: 'event-photos/company-emr/b.jpg' }] },
      COMPANY,
      actor.id,
    )

    await deleteAlbum(album.id, COMPANY, actor.id)

    expect(await prisma.eventAlbum.count()).toBe(0)
    expect(await prisma.eventPhoto.count()).toBe(0)
    const apagadas = (deleteS3Object as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).sort()
    expect(apagadas).toEqual(['event-photos/company-emr/a.jpg', 'event-photos/company-emr/b.jpg'])
  })

  it('grava auditoria de DELETE do álbum', async () => {
    const actor = await makeActor()
    const album = await createAlbum({ title: 'Hackathon' }, COMPANY, actor.id)

    await deleteAlbum(album.id, COMPANY, actor.id)

    const logs = await prisma.adminAuditLog.findMany({ where: { entityType: 'EventAlbum' } })
    expect(logs.map((l) => l.action).sort()).toEqual(['CREATE', 'DELETE'])
  })

  it('apagar a foto-capa anula a capa em vez de deixar chave morta', async () => {
    const actor = await makeActor()
    const album = await createAlbum({ title: 'Onboarding' }, COMPANY, actor.id)
    const [foto] = await addPhotos(album.id, { photos: [{ storageKey: 'k1.jpg' }] }, COMPANY, actor.id)
    await setCover(album.id, foto.id, COMPANY, actor.id)

    await deletePhoto(album.id, foto.id, COMPANY, actor.id)

    const recarregado = await prisma.eventAlbum.findUniqueOrThrow({ where: { id: album.id } })
    expect(recarregado.coverPhotoId).toBeNull()
    expect(deleteS3Object).toHaveBeenCalledWith('k1.jpg')
  })

  it('recusa capa que não é foto do álbum', async () => {
    const actor = await makeActor()
    const a = await createAlbum({ title: 'A' }, COMPANY, actor.id)
    const b = await createAlbum({ title: 'B' }, COMPANY, actor.id)
    const [fotoDeB] = await addPhotos(b.id, { photos: [{ storageKey: 'k2.jpg' }] }, COMPANY, actor.id)

    await expect(setCover(a.id, fotoDeB.id, COMPANY, actor.id)).rejects.toMatchObject({
      name: 'EventAlbumError',
      status: 400,
    })
  })

  it('lista com a contagem de fotos sem consultar álbum a álbum', async () => {
    const actor = await makeActor()
    const a = await createAlbum({ title: 'A', eventDate: '2026-05-01T00:00:00.000Z' }, COMPANY, actor.id)
    const b = await createAlbum({ title: 'B', eventDate: '2026-06-01T00:00:00.000Z' }, COMPANY, actor.id)
    await addPhotos(a.id, { photos: [{ storageKey: 'k3.jpg' }, { storageKey: 'k4.jpg' }] }, COMPANY, actor.id)

    const lista = await listAlbums(COMPANY)

    // Mais recente primeiro.
    expect(lista.map((i) => i.album.id)).toEqual([b.id, a.id])
    expect(lista.find((i) => i.album.id === a.id)?.photoCount).toBe(2)
    expect(lista.find((i) => i.album.id === b.id)?.photoCount).toBe(0)
  })

  it('404 ao mexer em álbum de outra empresa', async () => {
    const actor = await makeActor()
    const album = await createAlbum({ title: 'Da EMR' }, COMPANY, actor.id)
    await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'outra' } })

    await expect(deleteAlbum(album.id, 'company-outra', actor.id)).rejects.toMatchObject({ status: 404 })
    expect(await prisma.eventAlbum.count()).toBe(1)
  })

  it('recusa lote acima do máximo', async () => {
    const actor = await makeActor()
    const album = await createAlbum({ title: 'Grande' }, COMPANY, actor.id)
    const photos = Array.from({ length: 21 }, (_, i) => ({ storageKey: `k${i}.jpg` }))

    await expect(addPhotos(album.id, { photos }, COMPANY, actor.id)).rejects.toMatchObject({ status: 400 })
  })

  it('lista 20 álbuns sem uma consulta por álbum (sem N+1)', async () => {
    const actor = await makeActor()
    for (let i = 0; i < 20; i++) {
      await createAlbum({ title: `Álbum ${i}` }, COMPANY, actor.id)
    }
    opLog.length = 0

    const lista = await listAlbums(COMPANY)

    expect(lista).toHaveLength(20)
    // Exatamente duas idas ao banco: os álbuns e o groupBy das contagens.
    expect(opLog).toEqual(['eventAlbum.findMany', 'eventPhoto.groupBy'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `LEGENDS_DB_PORT=5492 pnpm --filter @legends/api exec vitest run src/services/event-album-service.test.ts`
Expected: FAIL — `Failed to resolve import "./event-album-service"`.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/services/event-album-service.ts`:

```ts
import {
  EVENT_PHOTO_MAX_BATCH,
  type AddEventPhotosRequest,
  type CreateEventAlbumRequest,
  type UpdateEventAlbumRequest,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { deleteS3Object, s3Config } from '../lib/s3-client'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'

export class EventAlbumError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'EventAlbumError'
  }
}

const ENTITY = 'EventAlbum'

/**
 * Remove os objetos do storage depois que o banco já foi ajustado. S3 não entra
 * em transação: a etapa é best-effort e a falha é logada, como a avaliação de
 * selos pós-voto. O pior caso é um objeto sobrando no bucket — nunca uma foto
 * fantasma na tela, que é o que aconteceria na ordem inversa.
 */
async function removeObjects(keys: string[]): Promise<void> {
  if (!s3Config()) return
  for (const key of keys) {
    try {
      await deleteS3Object(key)
    } catch (err) {
      console.error('[event-album] falha ao apagar objeto do storage', { key, err })
    }
  }
}

async function findAlbumOrThrow(id: string, companyId: string) {
  const album = await scopedPrisma(companyId).eventAlbum.findFirst({ where: { id } })
  if (!album) throw new EventAlbumError('Álbum não encontrado.', 404)
  return album
}

/**
 * Álbuns da empresa, do evento mais recente para o mais antigo, com a contagem
 * de fotos e a chave da capa. A contagem sai de UM `groupBy` — nada de consultar
 * álbum a álbum, que é justamente o N+1 do portal de origem.
 */
export async function listAlbums(companyId: string) {
  const db = scopedPrisma(companyId)
  const albums = await db.eventAlbum.findMany({
    orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }],
    include: { cover: { select: { storageKey: true } } },
  })
  const counts = await db.eventPhoto.groupBy({ by: ['albumId'], _count: { _all: true } })
  const countByAlbum = new Map(counts.map((c) => [c.albumId, c._count._all]))

  return albums.map((album) => ({
    album,
    photoCount: countByAlbum.get(album.id) ?? 0,
    coverKey: album.cover?.storageKey ?? null,
  }))
}

/** Álbum com as fotos, reações e contagem de comentários — para a tela do álbum. */
export async function getAlbumWithPhotos(id: string, companyId: string) {
  const db = scopedPrisma(companyId)
  const album = await db.eventAlbum.findFirst({
    where: { id },
    include: { cover: { select: { storageKey: true } } },
  })
  if (!album) throw new EventAlbumError('Álbum não encontrado.', 404)

  const photos = await db.eventPhoto.findMany({
    where: { albumId: id },
    orderBy: { createdAt: 'asc' },
    include: {
      reactions: { include: { user: true } },
      _count: { select: { comments: true } },
    },
  })

  return { album, photoCount: photos.length, coverKey: album.cover?.storageKey ?? null, photos }
}

function parseEventDate(value: string | null | undefined): Date | null {
  if (value == null || value === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new EventAlbumError('Data do evento inválida.', 400)
  return date
}

export async function createAlbum(input: CreateEventAlbumRequest, companyId: string, actorId: string) {
  const album = await scopedPrisma(companyId).eventAlbum.create({
    data: {
      title: input.title.trim(),
      description: input.description?.trim() || null,
      eventDate: parseEventDate(input.eventDate),
      createdById: actorId,
    },
  })
  await recordAuditLog({
    actorId,
    companyId,
    entityType: ENTITY,
    entityId: album.id,
    action: 'CREATE',
    after: album,
  })
  return album
}

export async function updateAlbum(
  id: string,
  input: UpdateEventAlbumRequest,
  companyId: string,
  actorId: string,
) {
  const before = await findAlbumOrThrow(id, companyId)
  const album = await scopedPrisma(companyId).eventAlbum.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.eventDate !== undefined ? { eventDate: parseEventDate(input.eventDate) } : {}),
    },
  })
  await recordAuditLog({ actorId, companyId, entityType: ENTITY, entityId: id, action: 'UPDATE', before, after: album })
  return album
}

/**
 * Apaga álbum, fotos, reações e comentários (cascata do Prisma) e só então os
 * objetos do storage. As chaves são coletadas ANTES do delete — depois não há
 * de onde tirá-las.
 */
export async function deleteAlbum(id: string, companyId: string, actorId: string): Promise<void> {
  const album = await findAlbumOrThrow(id, companyId)
  const photos = await scopedPrisma(companyId).eventPhoto.findMany({
    where: { albumId: id },
    select: { storageKey: true },
  })

  await prisma.$transaction(async (tx) => {
    // A capa aponta para uma foto do próprio álbum: zerar antes evita que a FK
    // segure o delete numa ordem infeliz de cascata.
    await tx.eventAlbum.update({ where: { id }, data: { coverPhotoId: null } })
    await tx.eventAlbum.delete({ where: { id } })
    await recordAuditLog({
      actorId,
      companyId,
      entityType: ENTITY,
      entityId: id,
      action: 'DELETE',
      before: album,
      tx,
    })
  })

  await removeObjects(photos.map((p) => p.storageKey))
}

/** Confirma no álbum as fotos já enviadas ao storage. */
export async function addPhotos(
  albumId: string,
  input: AddEventPhotosRequest,
  companyId: string,
  actorId: string,
) {
  await findAlbumOrThrow(albumId, companyId)
  if (input.photos.length === 0) {
    throw new EventAlbumError('Envie ao menos uma foto.', 400)
  }
  if (input.photos.length > EVENT_PHOTO_MAX_BATCH) {
    throw new EventAlbumError(`Envie no máximo ${EVENT_PHOTO_MAX_BATCH} fotos por vez.`, 400)
  }

  const db = scopedPrisma(companyId)
  const created = []
  for (const photo of input.photos) {
    created.push(
      await db.eventPhoto.create({
        data: {
          albumId,
          storageKey: photo.storageKey,
          width: photo.width ?? null,
          height: photo.height ?? null,
          uploadedById: actorId,
        },
      }),
    )
  }

  await recordAuditLog({
    actorId,
    companyId,
    entityType: ENTITY,
    entityId: albumId,
    action: 'UPDATE',
    after: { addedPhotos: created.length },
  })
  return created
}

export async function deletePhoto(
  albumId: string,
  photoId: string,
  companyId: string,
  actorId: string,
): Promise<void> {
  const db = scopedPrisma(companyId)
  const photo = await db.eventPhoto.findFirst({ where: { id: photoId, albumId } })
  if (!photo) throw new EventAlbumError('Foto não encontrada.', 404)

  // `coverPhotoId` é SetNull: apagar a foto-capa anula a capa sozinho.
  await db.eventPhoto.delete({ where: { id: photoId } })
  await recordAuditLog({
    actorId,
    companyId,
    entityType: ENTITY,
    entityId: albumId,
    action: 'UPDATE',
    before: { removedPhotoId: photoId },
  })
  await removeObjects([photo.storageKey])
}

export async function setCover(albumId: string, photoId: string, companyId: string, actorId: string) {
  const db = scopedPrisma(companyId)
  await findAlbumOrThrow(albumId, companyId)
  const photo = await db.eventPhoto.findFirst({ where: { id: photoId, albumId } })
  if (!photo) throw new EventAlbumError('A capa precisa ser uma foto deste álbum.', 400)

  const album = await db.eventAlbum.update({ where: { id: albumId }, data: { coverPhotoId: photoId } })
  await recordAuditLog({
    actorId,
    companyId,
    entityType: ENTITY,
    entityId: albumId,
    action: 'UPDATE',
    after: { coverPhotoId: photoId },
  })
  return album
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `LEGENDS_DB_PORT=5492 pnpm --filter @legends/api exec vitest run src/services/event-album-service.test.ts`
Expected: PASS (8 testes).

Se `deleteAlbum` falhar por FK circular no Postgres, confira que o `update` que zera `coverPhotoId` está **antes** do `delete` na transação.

Se o Proxy do `opLog` não interceptar as chamadas (o cliente estendido do Prisma pode expor os delegates de um jeito que o `Reflect.get` não alcance), **não** remova a asserção de N+1 — é critério de aceite. Troque o Proxy por `vi.spyOn` em cada delegate usado (`prisma.eventAlbum` / `prisma.eventPhoto`) registrando as chamadas na mesma lista, e mantenha a expectativa de duas operações.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/event-album-service.ts apps/api/src/services/event-album-service.test.ts
git commit -m "feat(api): service de album de evento com exclusao sem orfao"
```

---

### Task 5: Serialização e rotas de leitura

**Files:**
- Modify: `apps/api/src/lib/serialize.ts` (`toEventAlbumDTO`, `toEventPhotoDTO`, `toEventPhotoCommentDTO`)
- Create: `apps/api/src/routes/event-albums.ts`
- Create: `apps/api/src/routes/event-albums.test.ts`
- Modify: `apps/api/src/app.ts` (registrar a rota)

**Interfaces:**
- Consumes: service da Task 4, DTOs da Task 1, `publicUrlFor`/`s3Config` (`./s3-client`), `summarizeReactions` e `toPublicUser` (já em `serialize.ts`).
- Produces:
  - `toEventAlbumDTO(input: { album: EventAlbum; photoCount: number; coverKey: string | null }): EventAlbumDTO`
  - `toEventPhotoDTO(photo: EventPhotoWithRelations, viewerId: string): EventPhotoDTO`
  - `toEventPhotoCommentDTO(comment, ctx: { viewerId: string; canModerate: boolean }): EventPhotoCommentDTO`
  - `GET /event-albums`, `GET /event-albums/:id`
  - `eventAlbumRoutes(app: FastifyInstance)`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/event-albums.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

vi.mock('../lib/s3-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/s3-client')>()
  return {
    ...actual,
    deleteS3Object: vi.fn().mockResolvedValue(undefined),
    s3Config: () => ({ bucket: 'b', region: 'us-east-1', publicBaseUrl: 'https://cdn.exemplo.com' }),
  }
})

async function makeUser(
  app: ReturnType<typeof buildApp>,
  role: string,
  features: string[] = ['galeria', 'gente-gestao'],
  companyId = 'company-emr',
) {
  const user = await prisma.user.create({
    data: {
      name: role.toLowerCase(),
      email: `${role.toLowerCase()}-${Math.random()}@empresa.com`,
      passwordHash: 'x',
      role: role as never,
      sectorId: 'sector-dev-produto',
      companyId,
    },
  })
  const token = app.jwt.sign({ sub: user.id, role, sectorId: 'sector-dev-produto', companyId, features })
  return { user, token }
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

describe('galeria — leitura', () => {
  it('lista álbuns do mais recente para o mais antigo, com capa e contagem', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'ADMIN')

    const criado = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(gg.token),
      payload: { title: 'Confra 2026', eventDate: '2026-05-10T00:00:00.000Z' },
    })
    const albumId = criado.json().album.id
    const fotos = await app.inject({
      method: 'POST',
      url: `/admin/event-albums/${albumId}/photos`,
      headers: auth(gg.token),
      payload: { photos: [{ storageKey: 'event-photos/company-emr/a.jpg', width: 800, height: 600 }] },
    })
    await app.inject({
      method: 'PATCH',
      url: `/admin/event-albums/${albumId}/cover`,
      headers: auth(gg.token),
      payload: { photoId: fotos.json().photos[0].id },
    })

    const colaborador = await makeUser(app, 'LEGEND', ['galeria'])
    const res = await app.inject({ method: 'GET', url: '/event-albums', headers: auth(colaborador.token) })

    expect(res.statusCode).toBe(200)
    expect(res.json().albums[0]).toMatchObject({
      title: 'Confra 2026',
      photoCount: 1,
      coverUrl: 'https://cdn.exemplo.com/event-photos/company-emr/a.jpg',
    })
    await app.close()
  })

  it('nega a leitura de quem não tem a feature galeria', async () => {
    const app = buildApp()
    await app.ready()
    const semFeature = await makeUser(app, 'LEGEND', [])

    const res = await app.inject({ method: 'GET', url: '/event-albums', headers: auth(semFeature.token) })

    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('não mostra álbum de outra empresa', async () => {
    const app = buildApp()
    await app.ready()
    await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'outra' } })
    const daOutra = await makeUser(app, 'ADMIN', ['galeria', 'gente-gestao'], 'company-outra')
    await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(daOutra.token),
      payload: { title: 'Confra alheia' },
    })

    const daEmr = await makeUser(app, 'LEGEND', ['galeria'])
    const res = await app.inject({ method: 'GET', url: '/event-albums', headers: auth(daEmr.token) })

    expect(res.json().albums).toEqual([])
    await app.close()
  })

  it('serve 20 álbuns numa resposta só', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'ADMIN')
    for (let i = 0; i < 20; i++) {
      await app.inject({
        method: 'POST',
        url: '/admin/event-albums',
        headers: auth(gg.token),
        payload: { title: `Álbum ${i}` },
      })
    }

    const res = await app.inject({ method: 'GET', url: '/event-albums', headers: auth(gg.token) })

    expect(res.json().albums).toHaveLength(20)
    await app.close()
  })
})
```

A prova de que não há N+1 mora na Task 4 (`opLog`), no nível do service, onde dá para contar operações Prisma de forma determinística — `prisma.$on('query')` não serve aqui porque `lib/prisma.ts` instancia o client sem `log: [{ emit: 'event', level: 'query' }]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `LEGENDS_DB_PORT=5492 pnpm --filter @legends/api exec vitest run src/routes/event-albums.test.ts`
Expected: FAIL — 404 em todas as rotas.

- [ ] **Step 3: Add the serializers**

In `apps/api/src/lib/serialize.ts`, add the types to the `@legends/shared` and `@prisma/client` imports, then append:

```ts
export type EventAlbumForDTO = {
  album: EventAlbum
  photoCount: number
  coverKey: string | null
}

/** A chave nunca sai daqui: o DTO expõe só a URL pública derivada. */
export function toEventAlbumDTO({ album, photoCount, coverKey }: EventAlbumForDTO): EventAlbumDTO {
  const cfg = s3Config()
  return {
    id: album.id,
    title: album.title,
    description: album.description,
    eventDate: album.eventDate?.toISOString() ?? null,
    coverUrl: coverKey && cfg ? publicUrlFor(coverKey, cfg) : null,
    photoCount,
    createdAt: album.createdAt.toISOString(),
  }
}

export type EventPhotoWithRelations = EventPhoto & {
  reactions: (EventPhotoReaction & { user: User })[]
  _count: { comments: number }
}

export function toEventPhotoDTO(photo: EventPhotoWithRelations, viewerId: string): EventPhotoDTO {
  const cfg = s3Config()
  return {
    id: photo.id,
    albumId: photo.albumId,
    url: cfg ? publicUrlFor(photo.storageKey, cfg) : '',
    width: photo.width,
    height: photo.height,
    createdAt: photo.createdAt.toISOString(),
    reactions: summarizeReactions(photo.reactions, viewerId, EVENT_PHOTO_REACTIONS),
    commentCount: photo._count.comments,
  }
}

export function toEventPhotoCommentDTO(
  comment: EventPhotoComment & { author: User },
  ctx: { viewerId: string; canModerate: boolean },
): EventPhotoCommentDTO {
  return {
    id: comment.id,
    photoId: comment.photoId,
    author: toPublicUser(comment.author),
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    canDelete: ctx.canModerate || comment.authorId === ctx.viewerId,
  }
}
```

- [ ] **Step 4: Create the routes file with the read routes**

Create `apps/api/src/routes/event-albums.ts`:

```ts
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { toEventAlbumDTO, toEventPhotoDTO } from '../lib/serialize'
import { EventAlbumError, getAlbumWithPhotos, listAlbums } from '../services/event-album-service'

const idParams = z.object({ id: z.string().min(1) })

/** Responde o erro tipado do service; o que não for dele sobe. */
function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof EventAlbumError) return reply.code(err.status).send({ message: err.message })
  throw err
}

export async function eventAlbumRoutes(app: FastifyInstance) {
  // Leitura: quem tem a feature de colaborador `galeria`. ADMIN e SUBADMIN passam
  // sempre, como em todo `requireFeature`.
  const readGuard = { onRequest: [app.authenticate, app.requireFeature('galeria')] }

  app.get('/event-albums', readGuard, async (request, reply) => {
    const albums = await listAlbums(request.user.companyId)
    return reply.send({ albums: albums.map(toEventAlbumDTO) })
  })

  app.get('/event-albums/:id', readGuard, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      const found = await getAlbumWithPhotos(parsed.data.id, request.user.companyId)
      return reply.send({
        album: toEventAlbumDTO(found),
        photos: found.photos.map((photo) => toEventPhotoDTO(photo, request.user.sub)),
      })
    } catch (err) {
      return fail(reply, err)
    }
  })
}
```

- [ ] **Step 5: Register the routes**

In `apps/api/src/app.ts`, add the import next to `cultureRoutes`:

```ts
import { eventAlbumRoutes } from './routes/event-albums'
```

and the registration next to `app.register(cultureRoutes)`:

```ts
  app.register(eventAlbumRoutes)
```

- [ ] **Step 6: Run test to verify the read tests pass**

Run: `LEGENDS_DB_PORT=5492 pnpm --filter @legends/api exec vitest run src/routes/event-albums.test.ts`
Expected: os testes de leitura ainda falham nas chamadas a `/admin/event-albums` (Task 6). Confirme que a falha é 404 **nas rotas de admin** e não nas de leitura.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/routes/event-albums.ts apps/api/src/routes/event-albums.test.ts apps/api/src/app.ts
git commit -m "feat(api): serializacao e leitura da galeria de eventos"
```

---

### Task 6: Rotas de escrita sob a guarda de G&G

**Files:**
- Modify: `apps/api/src/routes/event-albums.ts`
- Modify: `apps/api/src/routes/event-albums.test.ts`

**Interfaces:**
- Consumes: service da Task 4, serializers da Task 5, `EVENT_PHOTO_MAX_BATCH`, `EVENT_ALBUM_TITLE_MAX_LENGTH`, `EVENT_ALBUM_DESCRIPTION_MAX_LENGTH`.
- Produces: `POST /admin/event-albums` → `{ album }`; `PATCH /admin/event-albums/:id` → `{ album }`; `DELETE /admin/event-albums/:id` → `204`; `POST /admin/event-albums/:id/photos` → `{ photos: { id, storageKey }[] }`; `DELETE /admin/event-albums/:albumId/photos/:photoId` → `204`; `PATCH /admin/event-albums/:id/cover` → `{ album }`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/routes/event-albums.test.ts` (o helper `makeUser` e o `auth` já estão no arquivo):

```ts
describe('galeria — escrita', () => {
  it('subadmin de G&G cria álbum e sobe um lote de fotos', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'SUBADMIN', ['gente-gestao'])

    const criado = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(gg.token),
      payload: { title: 'Hackathon 2026', description: 'Dois dias', eventDate: '2026-04-01T00:00:00.000Z' },
    })
    expect(criado.statusCode).toBe(201)

    const res = await app.inject({
      method: 'POST',
      url: `/admin/event-albums/${criado.json().album.id}/photos`,
      headers: auth(gg.token),
      payload: { photos: [{ storageKey: 'k1.jpg' }, { storageKey: 'k2.jpg' }] },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().photos).toHaveLength(2)
    await app.close()
  })

  it('nega escrita a subadmin de setor sem a feature gente-gestao', async () => {
    const app = buildApp()
    await app.ready()
    const outroSetor = await makeUser(app, 'SUBADMIN', ['galeria'])

    const res = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(outroSetor.token),
      payload: { title: 'Não deveria entrar' },
    })

    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('nega escrita a colaborador', async () => {
    const app = buildApp()
    await app.ready()
    const colaborador = await makeUser(app, 'LEGEND', ['galeria'])

    const res = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(colaborador.token),
      payload: { title: 'Nem esse' },
    })

    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('recusa título vazio com issues', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'ADMIN')

    const res = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(gg.token),
      payload: { title: '' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Requisição inválida.')
    expect(res.json().issues).toBeDefined()
    await app.close()
  })

  it('recusa lote acima de 20 fotos', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'ADMIN')
    const criado = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(gg.token),
      payload: { title: 'Grande' },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/admin/event-albums/${criado.json().album.id}/photos`,
      headers: auth(gg.token),
      payload: { photos: Array.from({ length: 21 }, (_, i) => ({ storageKey: `k${i}.jpg` })) },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('excluir álbum some com ele da listagem', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'ADMIN')
    const criado = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(gg.token),
      payload: { title: 'Some' },
    })

    const del = await app.inject({
      method: 'DELETE',
      url: `/admin/event-albums/${criado.json().album.id}`,
      headers: auth(gg.token),
    })

    expect(del.statusCode).toBe(204)
    const lista = await app.inject({ method: 'GET', url: '/event-albums', headers: auth(gg.token) })
    expect(lista.json().albums).toEqual([])
    await app.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `LEGENDS_DB_PORT=5492 pnpm --filter @legends/api exec vitest run src/routes/event-albums.test.ts`
Expected: FAIL — 404 nas rotas `/admin/event-albums`.

- [ ] **Step 3: Implement the write routes**

In `apps/api/src/routes/event-albums.ts`, extend the imports:

```ts
import {
  EVENT_ALBUM_DESCRIPTION_MAX_LENGTH,
  EVENT_ALBUM_TITLE_MAX_LENGTH,
  EVENT_PHOTO_MAX_BATCH,
} from '@legends/shared'
import {
  addPhotos,
  createAlbum,
  deleteAlbum,
  deletePhoto,
  EventAlbumError,
  getAlbumWithPhotos,
  listAlbums,
  setCover,
  updateAlbum,
} from '../services/event-album-service'
```

Add the schemas next to `idParams`:

```ts
const albumBody = z.object({
  title: z.string().trim().min(1).max(EVENT_ALBUM_TITLE_MAX_LENGTH),
  description: z.string().trim().max(EVENT_ALBUM_DESCRIPTION_MAX_LENGTH).nullish(),
  eventDate: z.string().datetime().nullish(),
})
const albumPatchBody = albumBody.partial()
const photosBody = z.object({
  photos: z
    .array(
      z.object({
        storageKey: z.string().min(1),
        width: z.number().int().positive().nullish(),
        height: z.number().int().positive().nullish(),
      }),
    )
    .min(1)
    .max(EVENT_PHOTO_MAX_BATCH),
})
const coverBody = z.object({ photoId: z.string().min(1) })
const photoParams = z.object({ albumId: z.string().min(1), photoId: z.string().min(1) })
```

And append inside `eventAlbumRoutes`:

```ts
  // Escrita: bloco de Gente e Gestão. `requireSectorFeature` (e não
  // `requireAdminOrSubadmin`) porque este último libera TODO subadmin, de
  // qualquer setor — ver AGENTS.md.
  const adminGuard = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  app.post('/admin/event-albums', adminGuard, async (request, reply) => {
    const parsed = albumBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const album = await createAlbum(parsed.data, request.user.companyId, request.user.sub)
    return reply.code(201).send({ album: toEventAlbumDTO({ album, photoCount: 0, coverKey: null }) })
  })

  app.patch('/admin/event-albums/:id', adminGuard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const parsed = albumPatchBody.safeParse(request.body)
    if (!params.success || !parsed.success) {
      const issues = (params.success ? parsed : params).error.flatten()
      return reply.code(400).send({ message: 'Requisição inválida.', issues })
    }
    try {
      await updateAlbum(params.data.id, parsed.data, request.user.companyId, request.user.sub)
      const found = await getAlbumWithPhotos(params.data.id, request.user.companyId)
      return reply.send({ album: toEventAlbumDTO(found) })
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.delete('/admin/event-albums/:id', adminGuard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: params.error.flatten() })
    }
    try {
      await deleteAlbum(params.data.id, request.user.companyId, request.user.sub)
      return reply.code(204).send()
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/admin/event-albums/:id/photos', adminGuard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const parsed = photosBody.safeParse(request.body)
    if (!params.success || !parsed.success) {
      const issues = (params.success ? parsed : params).error.flatten()
      return reply.code(400).send({ message: 'Requisição inválida.', issues })
    }
    try {
      const photos = await addPhotos(params.data.id, parsed.data, request.user.companyId, request.user.sub)
      return reply.code(201).send({ photos: photos.map((p) => ({ id: p.id, storageKey: p.storageKey })) })
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.delete('/admin/event-albums/:albumId/photos/:photoId', adminGuard, async (request, reply) => {
    const params = photoParams.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: params.error.flatten() })
    }
    try {
      await deletePhoto(params.data.albumId, params.data.photoId, request.user.companyId, request.user.sub)
      return reply.code(204).send()
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.patch('/admin/event-albums/:id/cover', adminGuard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const parsed = coverBody.safeParse(request.body)
    if (!params.success || !parsed.success) {
      const issues = (params.success ? parsed : params).error.flatten()
      return reply.code(400).send({ message: 'Requisição inválida.', issues })
    }
    try {
      await setCover(params.data.id, parsed.data.photoId, request.user.companyId, request.user.sub)
      const found = await getAlbumWithPhotos(params.data.id, request.user.companyId)
      return reply.send({ album: toEventAlbumDTO(found) })
    } catch (err) {
      return fail(reply, err)
    }
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `LEGENDS_DB_PORT=5492 pnpm --filter @legends/api exec vitest run src/routes/event-albums.test.ts`
Expected: PASS — leitura (Task 5) e escrita, 10 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/event-albums.ts apps/api/src/routes/event-albums.test.ts
git commit -m "feat(api): escrita da galeria sob a guarda de gente e gestao"
```

---

### Task 7: Reações e comentários por foto

**Files:**
- Create: `apps/api/src/services/event-photo-interaction-service.ts`
- Create: `apps/api/src/services/event-photo-interaction-service.test.ts`
- Modify: `apps/api/src/routes/event-albums.ts`

**Interfaces:**
- Consumes: `scopedPrisma`, `EVENT_PHOTO_REACTIONS`, `EVENT_PHOTO_COMMENT_MAX_LENGTH`, `toEventPhotoCommentDTO` (Task 5), `EventAlbumError` (Task 4).
- Produces:
  - `addReaction(photoId: string, emoji: string, companyId: string, userId: string): Promise<void>`
  - `removeReaction(photoId: string, emoji: string, companyId: string, userId: string): Promise<void>`
  - `listComments(photoId: string, companyId: string)`
  - `addComment(photoId: string, body: string, companyId: string, authorId: string)`
  - `deleteComment(commentId: string, companyId: string, ctx: { userId: string; canModerate: boolean }): Promise<void>`
  - Rotas: `POST`/`DELETE /event-albums/photos/:photoId/reactions`, `GET`/`POST /event-albums/photos/:photoId/comments`, `DELETE /event-albums/comments/:id`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/event-photo-interaction-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import { addComment, addReaction, deleteComment, removeReaction } from './event-photo-interaction-service'

const COMPANY = 'company-emr'

async function makePhoto() {
  const user = await prisma.user.create({
    data: { name: 'Pessoa', email: `p-${Math.random()}@empresa.com`, passwordHash: 'x', sectorId: 'sector-dev-produto' },
  })
  const album = await prisma.eventAlbum.create({
    data: { title: 'Confra', createdById: user.id, companyId: COMPANY },
  })
  const photo = await prisma.eventPhoto.create({
    data: { albumId: album.id, storageKey: 'k.jpg', uploadedById: user.id, companyId: COMPANY },
  })
  return { user, album, photo }
}

describe('interação com foto de evento', () => {
  it('reagir duas vezes com o mesmo emoji não duplica', async () => {
    const { user, photo } = await makePhoto()

    await addReaction(photo.id, '🎉', COMPANY, user.id)
    await addReaction(photo.id, '🎉', COMPANY, user.id)

    expect(await prisma.eventPhotoReaction.count({ where: { photoId: photo.id } })).toBe(1)
  })

  it('remove a reação e permite reagir de novo', async () => {
    const { user, photo } = await makePhoto()
    await addReaction(photo.id, '🔥', COMPANY, user.id)

    await removeReaction(photo.id, '🔥', COMPANY, user.id)
    expect(await prisma.eventPhotoReaction.count()).toBe(0)

    await addReaction(photo.id, '🔥', COMPANY, user.id)
    expect(await prisma.eventPhotoReaction.count()).toBe(1)
  })

  it('recusa emoji fora do conjunto padronizado', async () => {
    const { user, photo } = await makePhoto()

    await expect(addReaction(photo.id, '🥔', COMPANY, user.id)).rejects.toMatchObject({ status: 400 })
  })

  it('404 ao reagir em foto de outra empresa', async () => {
    const { user, photo } = await makePhoto()
    await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'outra' } })

    await expect(addReaction(photo.id, '🎉', 'company-outra', user.id)).rejects.toMatchObject({ status: 404 })
  })

  it('autor apaga o próprio comentário; terceiro sem moderação não', async () => {
    const { user, photo } = await makePhoto()
    const outro = await prisma.user.create({
      data: { name: 'Outro', email: `o-${Math.random()}@empresa.com`, passwordHash: 'x', sectorId: 'sector-dev-produto' },
    })
    const comentario = await addComment(photo.id, 'que dia bom', COMPANY, user.id)

    await expect(
      deleteComment(comentario.id, COMPANY, { userId: outro.id, canModerate: false }),
    ).rejects.toMatchObject({ status: 403 })

    await deleteComment(comentario.id, COMPANY, { userId: user.id, canModerate: false })
    expect(await prisma.eventPhotoComment.count()).toBe(0)
  })

  it('quem modera apaga comentário alheio', async () => {
    const { user, photo } = await makePhoto()
    const moderador = await prisma.user.create({
      data: { name: 'GG', email: `gg-${Math.random()}@empresa.com`, passwordHash: 'x', sectorId: 'sector-dev-produto' },
    })
    const comentario = await addComment(photo.id, 'texto', COMPANY, user.id)

    await deleteComment(comentario.id, COMPANY, { userId: moderador.id, canModerate: true })

    expect(await prisma.eventPhotoComment.count()).toBe(0)
  })

  it('recusa comentário vazio', async () => {
    const { user, photo } = await makePhoto()

    await expect(addComment(photo.id, '   ', COMPANY, user.id)).rejects.toMatchObject({ status: 400 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `LEGENDS_DB_PORT=5492 pnpm --filter @legends/api exec vitest run src/services/event-photo-interaction-service.test.ts`
Expected: FAIL — `Failed to resolve import "./event-photo-interaction-service"`.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/services/event-photo-interaction-service.ts`:

```ts
import { EVENT_PHOTO_COMMENT_MAX_LENGTH, EVENT_PHOTO_REACTIONS } from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { EventAlbumError } from './event-album-service'

async function findPhotoOrThrow(photoId: string, companyId: string) {
  const photo = await scopedPrisma(companyId).eventPhoto.findFirst({ where: { id: photoId } })
  if (!photo) throw new EventAlbumError('Foto não encontrada.', 404)
  return photo
}

function assertEmoji(emoji: string) {
  if (!(EVENT_PHOTO_REACTIONS as readonly string[]).includes(emoji)) {
    throw new EventAlbumError('Reação não suportada.', 400)
  }
}

/**
 * Idempotente por (foto, pessoa, emoji): o `@@unique` garante a linha única e a
 * violação (P2002) é tratada como no-op. Duas requisições em corrida — clique
 * duplo, retry do cliente — não duplicam nem se auto-desfazem.
 */
export async function addReaction(photoId: string, emoji: string, companyId: string, userId: string): Promise<void> {
  assertEmoji(emoji)
  await findPhotoOrThrow(photoId, companyId)
  try {
    await scopedPrisma(companyId).eventPhotoReaction.create({ data: { photoId, userId, emoji } })
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return
    throw err
  }
}

export async function removeReaction(
  photoId: string,
  emoji: string,
  companyId: string,
  userId: string,
): Promise<void> {
  assertEmoji(emoji)
  await findPhotoOrThrow(photoId, companyId)
  await scopedPrisma(companyId).eventPhotoReaction.deleteMany({ where: { photoId, userId, emoji } })
}

export async function listComments(photoId: string, companyId: string) {
  await findPhotoOrThrow(photoId, companyId)
  return scopedPrisma(companyId).eventPhotoComment.findMany({
    where: { photoId },
    orderBy: { createdAt: 'asc' },
    include: { author: true },
  })
}

export async function addComment(photoId: string, body: string, companyId: string, authorId: string) {
  await findPhotoOrThrow(photoId, companyId)
  const trimmed = body.trim()
  if (trimmed.length === 0) throw new EventAlbumError('Escreva um comentário.', 400)
  if (trimmed.length > EVENT_PHOTO_COMMENT_MAX_LENGTH) {
    throw new EventAlbumError(`Comentário muito longo (máx. ${EVENT_PHOTO_COMMENT_MAX_LENGTH} caracteres).`, 400)
  }
  return scopedPrisma(companyId).eventPhotoComment.create({
    data: { photoId, body: trimmed, authorId },
    include: { author: true },
  })
}

/** Autor apaga o próprio; quem administra G&G apaga qualquer um. */
export async function deleteComment(
  commentId: string,
  companyId: string,
  ctx: { userId: string; canModerate: boolean },
): Promise<void> {
  const db = scopedPrisma(companyId)
  const comment = await db.eventPhotoComment.findFirst({ where: { id: commentId } })
  if (!comment) throw new EventAlbumError('Comentário não encontrado.', 404)
  if (!ctx.canModerate && comment.authorId !== ctx.userId) {
    throw new EventAlbumError('Você não pode apagar este comentário.', 403)
  }
  await db.eventPhotoComment.delete({ where: { id: commentId } })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `LEGENDS_DB_PORT=5492 pnpm --filter @legends/api exec vitest run src/services/event-photo-interaction-service.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Add the interaction routes**

In `apps/api/src/routes/event-albums.ts`, add the imports:

```ts
import { EVENT_PHOTO_COMMENT_MAX_LENGTH } from '@legends/shared'
import { toEventPhotoCommentDTO } from '../lib/serialize'
import {
  addComment,
  addReaction,
  deleteComment,
  listComments,
  removeReaction,
} from '../services/event-photo-interaction-service'
```

the schemas:

```ts
const photoIdParams = z.object({ photoId: z.string().min(1) })
const reactionBody = z.object({ emoji: z.string().min(1) })
const commentBody = z.object({ body: z.string().trim().min(1).max(EVENT_PHOTO_COMMENT_MAX_LENGTH) })
```

and, inside `eventAlbumRoutes` after the read routes:

```ts
  /** Quem administra G&G modera comentário alheio; o resto só apaga o próprio. */
  function canModerate(request: { user: { role: string; features?: string[] } }): boolean {
    if (request.user.role === 'ADMIN') return true
    return request.user.role === 'SUBADMIN' && (request.user.features ?? []).includes('gente-gestao')
  }

  app.post('/event-albums/photos/:photoId/reactions', readGuard, async (request, reply) => {
    const params = photoIdParams.safeParse(request.params)
    const parsed = reactionBody.safeParse(request.body)
    if (!params.success || !parsed.success) {
      const issues = (params.success ? parsed : params).error.flatten()
      return reply.code(400).send({ message: 'Requisição inválida.', issues })
    }
    try {
      await addReaction(params.data.photoId, parsed.data.emoji, request.user.companyId, request.user.sub)
      return reply.code(204).send()
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.delete('/event-albums/photos/:photoId/reactions', readGuard, async (request, reply) => {
    const params = photoIdParams.safeParse(request.params)
    const parsed = reactionBody.safeParse(request.body)
    if (!params.success || !parsed.success) {
      const issues = (params.success ? parsed : params).error.flatten()
      return reply.code(400).send({ message: 'Requisição inválida.', issues })
    }
    try {
      await removeReaction(params.data.photoId, parsed.data.emoji, request.user.companyId, request.user.sub)
      return reply.code(204).send()
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.get('/event-albums/photos/:photoId/comments', readGuard, async (request, reply) => {
    const params = photoIdParams.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: params.error.flatten() })
    }
    try {
      const comments = await listComments(params.data.photoId, request.user.companyId)
      const ctx = { viewerId: request.user.sub, canModerate: canModerate(request) }
      return reply.send({ comments: comments.map((c) => toEventPhotoCommentDTO(c, ctx)) })
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/event-albums/photos/:photoId/comments', readGuard, async (request, reply) => {
    const params = photoIdParams.safeParse(request.params)
    const parsed = commentBody.safeParse(request.body)
    if (!params.success || !parsed.success) {
      const issues = (params.success ? parsed : params).error.flatten()
      return reply.code(400).send({ message: 'Requisição inválida.', issues })
    }
    try {
      const comment = await addComment(
        params.data.photoId,
        parsed.data.body,
        request.user.companyId,
        request.user.sub,
      )
      const ctx = { viewerId: request.user.sub, canModerate: canModerate(request) }
      return reply.code(201).send({ comment: toEventPhotoCommentDTO(comment, ctx) })
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.delete('/event-albums/comments/:id', readGuard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: params.error.flatten() })
    }
    try {
      await deleteComment(params.data.id, request.user.companyId, {
        userId: request.user.sub,
        canModerate: canModerate(request),
      })
      return reply.code(204).send()
    } catch (err) {
      return fail(reply, err)
    }
  })
```

- [ ] **Step 6: Add a route-level test for the reaction round-trip**

Append to `apps/api/src/routes/event-albums.test.ts`:

```ts
describe('galeria — interação pela rota', () => {
  it('reage, aparece no detalhe do álbum e não duplica no segundo POST', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'ADMIN')
    const criado = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(gg.token),
      payload: { title: 'Confra' },
    })
    const albumId = criado.json().album.id
    const fotos = await app.inject({
      method: 'POST',
      url: `/admin/event-albums/${albumId}/photos`,
      headers: auth(gg.token),
      payload: { photos: [{ storageKey: 'k1.jpg' }] },
    })
    const photoId = fotos.json().photos[0].id

    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/event-albums/photos/${photoId}/reactions`,
        headers: auth(gg.token),
        payload: { emoji: '🎉' },
      })
      expect(res.statusCode).toBe(204)
    }

    const detalhe = await app.inject({ method: 'GET', url: `/event-albums/${albumId}`, headers: auth(gg.token) })
    const reacoes = detalhe.json().photos[0].reactions
    expect(reacoes).toHaveLength(1)
    expect(reacoes[0]).toMatchObject({ emoji: '🎉', count: 1, reactedByMe: true })
    await app.close()
  })
})
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `LEGENDS_DB_PORT=5492 pnpm --filter @legends/api exec vitest run src/routes/event-albums.test.ts src/services/event-photo-interaction-service.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/event-photo-interaction-service.ts apps/api/src/services/event-photo-interaction-service.test.ts apps/api/src/routes/event-albums.ts apps/api/src/routes/event-albums.test.ts
git commit -m "feat(api): reacoes e comentarios em foto de evento"
```

---

### Task 8: Tela de administração da galeria

**Files:**
- Create: `apps/web/src/pages/admin/EventAlbumsSection.tsx`
- Create: `apps/web/src/pages/admin/EventAlbumsSection.test.tsx`
- Modify: `apps/web/src/App.tsx` (rota `/admin/galeria`)
- Modify: `apps/web/src/pages/admin/AdminSidebar.tsx` (item no grupo Cultura)

**Interfaces:**
- Consumes: `uploadEventPhoto` (Task 3), DTOs da Task 1, rotas das Tasks 5–6, `apiFetch` (`../../lib/api`), `Panel` (`./shared`).
- Produces: `export function EventAlbumsSection()`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/admin/EventAlbumsSection.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { EventAlbumsSection } from './EventAlbumsSection'
import { apiFetch } from '../../lib/api'
import { uploadEventPhoto } from '../../lib/upload'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
vi.mock('../../lib/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/upload')>()
  return { ...actual, uploadEventPhoto: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock
const mockUpload = uploadEventPhoto as unknown as Mock

const ALBUM = {
  id: 'a1',
  title: 'Confra 2026',
  description: 'Dois dias',
  eventDate: '2026-05-10T00:00:00.000Z',
  coverUrl: null,
  photoCount: 1,
  createdAt: '2026-05-11T00:00:00.000Z',
}
const PHOTO = {
  id: 'f1',
  albumId: 'a1',
  url: 'https://cdn.exemplo.com/k1.jpg',
  width: 800,
  height: 600,
  createdAt: '2026-05-11T00:00:00.000Z',
  reactions: [],
  commentCount: 0,
}

function setupFetch() {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/event-albums' && !method) return Promise.resolve({ albums: [ALBUM] })
    if (path === '/event-albums/a1' && !method) return Promise.resolve({ album: ALBUM, photos: [PHOTO] })
    if (path === '/admin/event-albums' && method === 'POST') return Promise.resolve({ album: ALBUM })
    if (path === '/admin/event-albums/a1/photos' && method === 'POST') {
      return Promise.resolve({ photos: [{ id: 'f2', storageKey: 'k2.jpg' }] })
    }
    if (path === '/admin/event-albums/a1/cover' && method === 'PATCH') return Promise.resolve({ album: ALBUM })
    if (path === '/admin/event-albums/a1' && method === 'DELETE') return Promise.resolve({})
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
  mockUpload.mockResolvedValue({ storageKey: 'k2.jpg', width: 400, height: 300 })
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EventAlbumsSection />
    </QueryClientProvider>,
  )
}

describe('EventAlbumsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
  })

  it('lista os álbuns existentes', async () => {
    renderSection()
    expect(await screen.findByText('Confra 2026')).toBeInTheDocument()
  })

  it('cria um álbum novo', async () => {
    renderSection()
    await screen.findByText('Confra 2026')
    fireEvent.change(screen.getByLabelText(/título/i), { target: { value: 'Hackathon' } })
    fireEvent.click(screen.getByRole('button', { name: /criar álbum/i }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/event-albums', expect.objectContaining({ method: 'POST' })),
    )
  })

  it('sobe um lote de fotos e confirma as chaves na API', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /gerenciar fotos de confra 2026/i }))
    const input = await screen.findByLabelText(/adicionar fotos/i)
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/event-albums/a1/photos',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('define uma foto como capa', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /gerenciar fotos de confra 2026/i }))
    fireEvent.click(await screen.findByRole('button', { name: /definir como capa/i }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/event-albums/a1/cover',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    )
  })

  it('mostra o erro de um arquivo recusado sem derrubar o lote', async () => {
    mockUpload.mockRejectedValueOnce(new Error('Formato não suportado. Use JPEG, PNG, WebP ou GIF.'))
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /gerenciar fotos de confra 2026/i }))
    const input = await screen.findByLabelText(/adicionar fotos/i)
    fireEvent.change(input, { target: { files: [new File(['x'], 'doc.pdf', { type: 'application/pdf' })] } })

    expect(await screen.findByText(/formato não suportado/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/EventAlbumsSection.test.tsx`
Expected: FAIL — `Failed to resolve import "./EventAlbumsSection"`.

- [ ] **Step 3: Implement the section**

Create `apps/web/src/pages/admin/EventAlbumsSection.tsx`:

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { EventAlbumDetailResponse, EventAlbumListResponse, EventPhotoInput } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { uploadEventPhoto } from '../../lib/upload'
import { Panel } from './shared'

/** Progresso de um arquivo do lote: um erro não derruba os vizinhos. */
interface UploadState {
  fileName: string
  status: 'enviando' | 'pronto' | 'erro'
  message?: string
}

function AlbumPhotos({ albumId }: { albumId: string }) {
  const queryClient = useQueryClient()
  const [uploads, setUploads] = useState<UploadState[]>([])

  const detail = useQuery({
    queryKey: ['admin', 'event-albums', albumId],
    queryFn: () => apiFetch<EventAlbumDetailResponse>(`/event-albums/${albumId}`),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'event-albums'] })
  }

  const setCover = useMutation({
    mutationFn: (photoId: string) =>
      apiFetch<unknown>(`/admin/event-albums/${albumId}/cover`, {
        method: 'PATCH',
        body: JSON.stringify({ photoId }),
      }),
    onSuccess: invalidate,
  })

  const removePhoto = useMutation({
    mutationFn: (photoId: string) =>
      apiFetch<unknown>(`/admin/event-albums/${albumId}/photos/${photoId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    setUploads(list.map((f) => ({ fileName: f.name, status: 'enviando' as const })))

    const confirmados: EventPhotoInput[] = []
    for (const [index, file] of list.entries()) {
      try {
        confirmados.push(await uploadEventPhoto(file))
        setUploads((prev) => prev.map((u, i) => (i === index ? { ...u, status: 'pronto' } : u)))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Falha ao enviar a foto.'
        setUploads((prev) => prev.map((u, i) => (i === index ? { ...u, status: 'erro', message } : u)))
      }
    }

    if (confirmados.length > 0) {
      await apiFetch<unknown>(`/admin/event-albums/${albumId}/photos`, {
        method: 'POST',
        body: JSON.stringify({ photos: confirmados }),
      })
      invalidate()
      await detail.refetch()
    }
  }

  return (
    <div className="mt-md flex flex-col gap-md">
      <label className="font-label text-label-md text-on-surface" htmlFor={`fotos-${albumId}`}>
        Adicionar fotos
      </label>
      <input
        id={`fotos-${albumId}`}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        onChange={(e) => void handleFiles(e.target.files)}
        className="text-body-sm text-on-surface-variant"
      />

      {uploads.length > 0 && (
        <ul className="flex flex-col gap-1">
          {uploads.map((u) => (
            <li key={u.fileName} className="text-body-sm text-on-surface-variant">
              {u.fileName} —{' '}
              {u.status === 'erro' ? (
                <span className="text-error">{u.message}</span>
              ) : (
                <span>{u.status === 'pronto' ? 'enviada' : 'enviando…'}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <ul className="grid grid-cols-2 gap-md sm:grid-cols-4">
        {detail.data?.photos.map((photo) => (
          <li key={photo.id} className="flex flex-col gap-1">
            <img src={photo.url} alt="" className="aspect-square w-full rounded-lg object-cover" />
            <button
              type="button"
              onClick={() => setCover.mutate(photo.id)}
              className="rounded-md border border-outline-variant/40 px-2 py-1 font-label text-label-sm text-on-surface"
            >
              Definir como capa
            </button>
            <button
              type="button"
              onClick={() => removePhoto.mutate(photo.id)}
              className="rounded-md border border-error/40 px-2 py-1 font-label text-label-sm text-error"
            >
              Remover foto
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function EventAlbumsSection() {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [openAlbumId, setOpenAlbumId] = useState<string | null>(null)

  const albums = useQuery({
    queryKey: ['admin', 'event-albums'],
    queryFn: () => apiFetch<EventAlbumListResponse>('/event-albums'),
  })

  const createAlbum = useMutation({
    mutationFn: () =>
      apiFetch<unknown>('/admin/event-albums', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description: description || null,
          // O input date dá 'AAAA-MM-DD'; a API espera ISO-8601 completo.
          eventDate: eventDate ? new Date(`${eventDate}T00:00:00.000Z`).toISOString() : null,
        }),
      }),
    onSuccess: () => {
      setTitle('')
      setDescription('')
      setEventDate('')
      queryClient.invalidateQueries({ queryKey: ['admin', 'event-albums'] })
    },
  })

  const removeAlbum = useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`/admin/event-albums/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'event-albums'] }),
  })

  return (
    <Panel title="Galeria de eventos">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          createAlbum.mutate()
        }}
        className="mb-lg flex flex-col gap-sm"
      >
        <label className="font-label text-label-md text-on-surface" htmlFor="album-titulo">
          Título
        </label>
        <input
          id="album-titulo"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-md border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-body-md text-on-surface"
        />

        <label className="font-label text-label-md text-on-surface" htmlFor="album-descricao">
          Descrição
        </label>
        <textarea
          id="album-descricao"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-md border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-body-md text-on-surface"
        />

        <label className="font-label text-label-md text-on-surface" htmlFor="album-data">
          Data do evento
        </label>
        <input
          id="album-data"
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          className="rounded-md border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-body-md text-on-surface"
        />

        <button
          type="submit"
          disabled={title.trim().length === 0 || createAlbum.isPending}
          className="self-start rounded-md bg-primary px-4 py-2 font-label text-label-md text-on-primary disabled:opacity-50"
        >
          Criar álbum
        </button>
      </form>

      {albums.data?.albums.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhum álbum publicado ainda.</p>
      )}

      <ul className="flex flex-col gap-md">
        {albums.data?.albums.map((album) => (
          <li key={album.id} className="rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
            <div className="flex items-start justify-between gap-md">
              <div className="min-w-0">
                <p className="font-label text-label-md text-on-surface">{album.title}</p>
                <p className="text-body-sm text-on-surface-variant">
                  {album.photoCount} {album.photoCount === 1 ? 'foto' : 'fotos'}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setOpenAlbumId(openAlbumId === album.id ? null : album.id)}
                  aria-label={`Gerenciar fotos de ${album.title}`}
                  className="rounded-md border border-outline-variant/40 px-3 py-1 font-label text-label-sm text-on-surface"
                >
                  Gerenciar fotos
                </button>
                <button
                  type="button"
                  onClick={() => removeAlbum.mutate(album.id)}
                  className="rounded-md border border-error/40 px-3 py-1 font-label text-label-sm text-error"
                >
                  Excluir álbum
                </button>
              </div>
            </div>
            {openAlbumId === album.id && <AlbumPhotos albumId={album.id} />}
          </li>
        ))}
      </ul>
    </Panel>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/EventAlbumsSection.test.tsx`
Expected: PASS (5 testes).

- [ ] **Step 5: Wire the admin route and the sidebar**

In `apps/web/src/App.tsx`, add the import next to the other admin sections:

```ts
import { EventAlbumsSection } from './pages/admin/EventAlbumsSection'
```

and the route right after `cultura/beneficios`:

```tsx
                    <Route path="galeria" element={<AdminSectorFeatureOnly feature="gente-gestao"><EventAlbumsSection /></AdminSectorFeatureOnly>} />
```

In `apps/web/src/pages/admin/AdminSidebar.tsx`, add to the `Cultura` group, after `beneficios`:

```ts
      // Gestão da galeria é de G&G; o consumo pelo colaborador é `galeria`.
      { to: '/admin/galeria', label: 'Galeria de eventos', featureKey: 'gente-gestao' },
```

- [ ] **Step 6: Run the sidebar test to confirm nothing broke**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/AdminSidebar.test.tsx`
Expected: PASS. Se o teste afirmar a lista completa de itens, adicione `'Galeria de eventos'` na expectativa.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/admin/EventAlbumsSection.tsx apps/web/src/pages/admin/EventAlbumsSection.test.tsx apps/web/src/App.tsx apps/web/src/pages/admin/AdminSidebar.tsx
git commit -m "feat(web): tela de administracao da galeria de eventos"
```

---

### Task 9: Tela da galeria para o colaborador

**Files:**
- Create: `apps/web/src/pages/GalleryPage.tsx`
- Create: `apps/web/src/pages/GalleryPage.test.tsx`
- Modify: `apps/web/src/App.tsx` (rota `/galeria`)
- Modify: `apps/web/src/components/nav-items.ts` (item no grupo Cultura)

**Interfaces:**
- Consumes: DTOs da Task 1, rotas das Tasks 5 e 7, `apiFetch`, `EVENT_PHOTO_REACTIONS`.
- Produces: `export function GalleryPage()`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/GalleryPage.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { GalleryPage } from './GalleryPage'
import { apiFetch } from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

const ALBUM = {
  id: 'a1',
  title: 'Confra 2026',
  description: 'Dois dias de festa',
  eventDate: '2026-05-10T00:00:00.000Z',
  coverUrl: 'https://cdn.exemplo.com/capa.jpg',
  photoCount: 1,
  createdAt: '2026-05-11T00:00:00.000Z',
}
const PHOTO = {
  id: 'f1',
  albumId: 'a1',
  url: 'https://cdn.exemplo.com/k1.jpg',
  width: 800,
  height: 600,
  createdAt: '2026-05-11T00:00:00.000Z',
  reactions: [{ emoji: '🎉', count: 1, reactedByMe: false, users: [{ id: 'u2', name: 'Carla' }] }],
  commentCount: 1,
}
const COMMENT = {
  id: 'c1',
  photoId: 'f1',
  author: { id: 'u2', name: 'Carla', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null },
  body: 'que dia bom',
  createdAt: '2026-05-11T10:00:00.000Z',
  canDelete: false,
}

function setupFetch() {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/event-albums' && !method) return Promise.resolve({ albums: [ALBUM] })
    if (path === '/event-albums/a1' && !method) return Promise.resolve({ album: ALBUM, photos: [PHOTO] })
    if (path === '/event-albums/photos/f1/comments' && !method) return Promise.resolve({ comments: [COMMENT] })
    if (path === '/event-albums/photos/f1/reactions') return Promise.resolve({})
    if (path === '/event-albums/photos/f1/comments' && method === 'POST') {
      return Promise.resolve({ comment: { ...COMMENT, id: 'c2', body: 'saudade' } })
    }
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <GalleryPage />
    </QueryClientProvider>,
  )
}

describe('GalleryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
  })

  it('mostra a grade de álbuns com capa e contagem', async () => {
    renderPage()
    expect(await screen.findByText('Confra 2026')).toBeInTheDocument()
    expect(screen.getByText(/1 foto/)).toBeInTheDocument()
  })

  it('abre o álbum e mostra as fotos', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /abrir álbum confra 2026/i }))
    expect(await screen.findByRole('button', { name: /ampliar foto 1/i })).toBeInTheDocument()
  })

  it('abre o lightbox e fecha com Esc', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /abrir álbum confra 2026/i }))
    fireEvent.click(await screen.findByRole('button', { name: /ampliar foto 1/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('reage a uma foto no lightbox', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /abrir álbum confra 2026/i }))
    fireEvent.click(await screen.findByRole('button', { name: /ampliar foto 1/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reagir com 🎉' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/event-albums/photos/f1/reactions',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('comenta na foto', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /abrir álbum confra 2026/i }))
    fireEvent.click(await screen.findByRole('button', { name: /ampliar foto 1/i }))
    expect(await screen.findByText('que dia bom')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/escreva um comentário/i), { target: { value: 'saudade' } })
    fireEvent.click(screen.getByRole('button', { name: /comentar/i }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/event-albums/photos/f1/comments',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/GalleryPage.test.tsx`
Expected: FAIL — `Failed to resolve import "./GalleryPage"`.

- [ ] **Step 3: Implement the page**

Create `apps/web/src/pages/GalleryPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  EVENT_PHOTO_REACTIONS,
  type EventAlbumDetailResponse,
  type EventAlbumListResponse,
  type EventPhotoCommentListResponse,
  type EventPhotoDTO,
} from '@legends/shared'
import { apiFetch } from '../lib/api'

function formatEventDate(iso: string | null): string {
  if (!iso) return 'Sem data'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function PhotoDetail({ photo, onClose }: { photo: EventPhotoDTO; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const comments = useQuery({
    queryKey: ['event-photo-comments', photo.id],
    queryFn: () => apiFetch<EventPhotoCommentListResponse>(`/event-albums/photos/${photo.id}/comments`),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['event-album', photo.albumId] })
    queryClient.invalidateQueries({ queryKey: ['event-photo-comments', photo.id] })
  }

  // POST adiciona (idempotente na API), DELETE remove: o toggle é a escolha do verbo.
  const react = useMutation({
    mutationFn: ({ emoji, reacted }: { emoji: string; reacted: boolean }) =>
      apiFetch<unknown>(`/event-albums/photos/${photo.id}/reactions`, {
        method: reacted ? 'DELETE' : 'POST',
        body: JSON.stringify({ emoji }),
      }),
    onSuccess: invalidate,
  })

  const comment = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(`/event-albums/photos/${photo.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      setBody('')
      invalidate()
    },
  })

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Foto do álbum"
      className="fixed inset-0 z-50 flex flex-col gap-md overflow-y-auto bg-scrim/90 p-lg"
    >
      <button
        type="button"
        onClick={onClose}
        className="self-end rounded-md border border-outline-variant/40 px-3 py-1 font-label text-label-sm text-on-surface"
      >
        Fechar
      </button>

      <img src={photo.url} alt="" className="mx-auto max-h-[60vh] rounded-lg object-contain" />

      <div className="mx-auto flex w-full max-w-2xl flex-wrap gap-2">
        {EVENT_PHOTO_REACTIONS.map((emoji) => {
          const summary = photo.reactions.find((r) => r.emoji === emoji)
          return (
            <button
              key={emoji}
              type="button"
              aria-label={`Reagir com ${emoji}`}
              onClick={() => react.mutate({ emoji, reacted: summary?.reactedByMe ?? false })}
              className={`rounded-full border px-3 py-1 text-body-sm ${
                summary?.reactedByMe ? 'border-primary text-primary' : 'border-outline-variant/40 text-on-surface'
              }`}
            >
              {emoji} {summary?.count ?? 0}
            </button>
          )
        })}
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-sm">
        <ul className="flex flex-col gap-2">
          {comments.data?.comments.map((c) => (
            <li key={c.id} className="rounded-lg bg-surface-container-low p-sm">
              <p className="font-label text-label-sm text-on-surface">{c.author.name}</p>
              <p className="text-body-sm text-on-surface-variant">{c.body}</p>
            </li>
          ))}
        </ul>

        <label className="font-label text-label-md text-on-surface" htmlFor={`comentario-${photo.id}`}>
          Escreva um comentário
        </label>
        <textarea
          id={`comentario-${photo.id}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="rounded-md border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-body-md text-on-surface"
        />
        <button
          type="button"
          disabled={body.trim().length === 0 || comment.isPending}
          onClick={() => comment.mutate()}
          className="self-start rounded-md bg-primary px-4 py-2 font-label text-label-md text-on-primary disabled:opacity-50"
        >
          Comentar
        </button>
      </div>
    </div>
  )
}

function AlbumDetail({ albumId, onBack }: { albumId: string; onBack: () => void }) {
  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null)
  const detail = useQuery({
    queryKey: ['event-album', albumId],
    queryFn: () => apiFetch<EventAlbumDetailResponse>(`/event-albums/${albumId}`),
  })

  const openPhoto = detail.data?.photos.find((p) => p.id === openPhotoId) ?? null

  return (
    <section className="flex flex-col gap-md">
      <button
        type="button"
        onClick={onBack}
        className="self-start rounded-md border border-outline-variant/40 px-3 py-1 font-label text-label-sm text-on-surface"
      >
        Voltar para a galeria
      </button>

      <h2 className="font-display text-headline-sm text-on-surface">{detail.data?.album.title}</h2>
      {detail.data?.album.description && (
        <p className="text-body-md text-on-surface-variant">{detail.data.album.description}</p>
      )}

      <ul className="grid grid-cols-2 gap-md sm:grid-cols-4">
        {detail.data?.photos.map((photo, index) => (
          <li key={photo.id}>
            <button
              type="button"
              aria-label={`Ampliar foto ${index + 1}`}
              onClick={() => setOpenPhotoId(photo.id)}
              className="w-full"
            >
              <img src={photo.url} alt="" className="aspect-square w-full rounded-lg object-cover" />
            </button>
          </li>
        ))}
      </ul>

      {openPhoto && <PhotoDetail photo={openPhoto} onClose={() => setOpenPhotoId(null)} />}
    </section>
  )
}

export function GalleryPage() {
  const [openAlbumId, setOpenAlbumId] = useState<string | null>(null)
  const albums = useQuery({
    queryKey: ['event-albums'],
    queryFn: () => apiFetch<EventAlbumListResponse>('/event-albums'),
  })

  if (openAlbumId) {
    return <AlbumDetail albumId={openAlbumId} onBack={() => setOpenAlbumId(null)} />
  }

  return (
    <section className="flex flex-col gap-lg">
      <header>
        <h1 className="font-display text-headline-md text-on-surface">Galeria de eventos</h1>
        <p className="text-body-md text-on-surface-variant">A memória visual da empresa, evento a evento.</p>
      </header>

      {albums.data?.albums.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhum álbum publicado ainda.</p>
      )}

      <ul className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
        {albums.data?.albums.map((album) => (
          <li key={album.id}>
            <button
              type="button"
              aria-label={`Abrir álbum ${album.title}`}
              onClick={() => setOpenAlbumId(album.id)}
              className="flex w-full flex-col overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container-low text-left"
            >
              {album.coverUrl ? (
                <img src={album.coverUrl} alt="" className="aspect-video w-full object-cover" />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center bg-surface-container">
                  <span className="text-body-sm text-on-surface-variant">Sem capa</span>
                </div>
              )}
              <div className="p-md">
                <p className="font-label text-label-md text-on-surface">{album.title}</p>
                <p className="text-body-sm text-on-surface-variant">
                  {formatEventDate(album.eventDate)} · {album.photoCount}{' '}
                  {album.photoCount === 1 ? 'foto' : 'fotos'}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/pages/GalleryPage.test.tsx`
Expected: PASS (5 testes).

- [ ] **Step 5: Wire the collaborator route and nav**

In `apps/web/src/App.tsx`, add the import:

```ts
import { GalleryPage } from './pages/GalleryPage'
```

and the route next to `/cultura`:

```tsx
                  <Route path="/galeria" element={<FeatureGate feature="galeria"><GalleryPage /></FeatureGate>} />
```

In `apps/web/src/components/nav-items.ts`, add to the `Cultura` group of **both** branches of the ternary. In the admin branch (no `feature`):

```ts
            { to: '/galeria', label: 'Galeria', icon: 'photo_library' },
```

In the collaborator branch:

```ts
            { to: '/galeria', label: 'Galeria', icon: 'photo_library', feature: 'galeria' },
```

- [ ] **Step 6: Run the nav test to confirm nothing broke**

Run: `pnpm --filter @legends/web exec vitest run src/components/nav-items.test.ts`
Expected: PASS. Se o teste afirmar a lista completa de itens do grupo Cultura, adicione `'Galeria'` à expectativa.

- [ ] **Step 7: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json` e o equivalente para `apps/api`.
Expected: sem erros. (Use o binário direto — `npx tsc` é interceptado pelo rtk e mente.)

**Não rode `pnpm test` completo.** Cada task já rodou o próprio arquivo de teste; a suíte inteira só entra quando o Waghner pedir. Se ele pedir: `pnpm db:up && LEGENDS_DB_PORT=5492 pnpm test` — e, se outro worktree estiver rodando a suíte da API ao mesmo tempo, as duas disputam o mesmo `legends_test` e aparecem centenas de falhas fantasma; confira `docker ps` antes de concluir que algo quebrou.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/GalleryPage.tsx apps/web/src/pages/GalleryPage.test.tsx apps/web/src/App.tsx apps/web/src/components/nav-items.ts
git commit -m "feat(web): galeria de eventos para o colaborador"
```

---

## Verificação final contra os critérios de aceite

| Critério | Onde é verificado |
| --- | --- |
| G&G cria álbum, sobe fotos em lote e define capa | Task 6 (rotas), Task 8 (tela + testes de upload e capa) |
| Excluir álbum remove fotos e objetos do storage | Task 4, teste "apaga o álbum, as fotos e os objetos do storage" |
| Arquivo fora do permitido recusado em português | Task 3, testes de content-type e tamanho |
| Feature `galeria` vê; só ADMIN/SUBADMIN de G&G escreve | Task 5 (403 sem feature), Task 6 (403 de subadmin de outro setor e de colaborador) |
| Reagir duas vezes com o mesmo emoji não duplica | Task 7, teste de serviço e teste de rota |
| Álbum de outra empresa nunca aparece | Task 2 (tenant-scope), Task 5 (rota) |
| Listar 20 álbuns sem N+1 | Task 5, teste de contagem de queries |
