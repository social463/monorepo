# Resenha — Imagens (upload S3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir anexar uma imagem própria (upload de arquivo) a um post e a um comentário da Resenha, enviada direto ao S3 via URL pré-assinada.

**Architecture:** Fluxo presigned URL — o front pede à API uma URL assinada (`POST /uploads/images/presign`), faz `PUT` do arquivo direto no bucket S3 (bytes não passam pela API), e cria a resenha com `{ image: { url, width, height } }`. O backend valida que a URL pertence ao nosso bucket (espelhando a validação de host dos GIFs) e persiste em colunas `imageUrl/imageWidth/imageHeight`. Imagem e GIF são mutuamente exclusivos. Bucket é público/CDN — guarda-se a URL pública e o front renderiza `<img>`.

**Tech Stack:** Fastify 4, Prisma 5 + PostgreSQL, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (v3), Zod, React 18 + React Query, Vitest, `@legends/shared` (contrato).

## Global Constraints

- **TypeScript strict, ESM puro** (`"type": "module"`, `moduleResolution: bundler`).
- **Mensagens ao usuário em português.**
- **Contrato primeiro:** ao mudar payload, alterar o tipo em `@legends/shared` antes dos dois lados.
- **Camadas finas:** route (Zod + serialize) → service (regra) → Prisma. Erros de domínio = classe tipada com `status` (padrão `ReviewError`), route responde com `err.status`.
- **Prisma:** nunca editar migration aplicada; gerar nova via `pnpm db:migrate`. Postgres precisa estar de pé (`pnpm db:up`) para migrations e testes da API.
- **Testes da API** batem em Postgres real (`legends_test`), truncado em `beforeEach`. `pnpm build`/Vitest **não** fazem typecheck: rodar `tsc --noEmit` por workspace ao mudar DTOs/includes Prisma.
- **Gating por env:** feature desligada se faltar `S3_BUCKET`/`S3_REGION`/`S3_PUBLIC_BASE_URL` (precedente `gifsEnabled`).
- **Restrições de arquivo:** tipos `image/jpeg`, `image/png`, `image/webp`, `image/gif`; máx. **10MB**.
- **Front fala só com `/api`** (proxy nginx); access token em memória; `apiFetch` já injeta auth.

---

### Task 1: Contrato compartilhado (`@legends/shared`)

Define o tipo `AttachedImage`, constantes/validação, tipos de presign/config, e estende os DTOs da resenha. Base de todas as outras tasks.

**Files:**
- Create: `packages/shared/src/image.ts`
- Create: `packages/shared/src/image.test.ts`
- Modify: `packages/shared/src/index.ts` (adicionar `export * from './image'`)
- Modify: `packages/shared/src/review.ts` (adicionar `image` a `ReviewDTO`, `ReviewCommentDTO`, `CreateReviewRequest`, `CreateReviewCommentRequest`)

**Interfaces:**
- Produces:
  - `interface AttachedImage { url: string; width: number; height: number }`
  - `const IMAGE_MAX_BYTES = 10485760`
  - `const ALLOWED_IMAGE_CONTENT_TYPES = ['image/jpeg','image/png','image/webp','image/gif'] as const`
  - `type AllowedImageContentType`
  - `function isAllowedImageContentType(ct: string): ct is AllowedImageContentType`
  - `interface PresignImageUploadRequest { contentType: string; size: number }`
  - `interface PresignImageUploadResponse { uploadUrl: string; publicUrl: string; key: string }`
  - `interface ImageUploadConfig { enabled: boolean; maxBytes: number; allowedContentTypes: string[] }`
  - `ReviewDTO.image: AttachedImage | null`, `ReviewCommentDTO.image: AttachedImage | null`
  - `CreateReviewRequest.image?: AttachedImage`, `CreateReviewCommentRequest.image?: AttachedImage`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/image.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  isAllowedImageContentType,
  ALLOWED_IMAGE_CONTENT_TYPES,
  IMAGE_MAX_BYTES,
} from './image'

describe('image contract', () => {
  it('aceita os content-types permitidos', () => {
    for (const ct of ALLOWED_IMAGE_CONTENT_TYPES) {
      expect(isAllowedImageContentType(ct)).toBe(true)
    }
  })

  it('rejeita content-types não suportados', () => {
    expect(isAllowedImageContentType('image/svg+xml')).toBe(false)
    expect(isAllowedImageContentType('application/pdf')).toBe(false)
    expect(isAllowedImageContentType('')).toBe(false)
  })

  it('expõe o limite de 10MB', () => {
    expect(IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/shared exec vitest run src/image.test.ts`
Expected: FAIL — `Failed to resolve import "./image"` (arquivo ainda não existe).

- [ ] **Step 3: Create the contract module**

Create `packages/shared/src/image.ts`:

```ts
/** Imagem anexada, como persistida/serializada. */
export interface AttachedImage {
  url: string
  width: number
  height: number
}

/** Tamanho máximo do arquivo de imagem (10MB). */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024

/** Content-types aceitos no upload de imagem da resenha. */
export const ALLOWED_IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const

export type AllowedImageContentType = (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number]

/** O content-type é um dos formatos de imagem permitidos? */
export function isAllowedImageContentType(ct: string): ct is AllowedImageContentType {
  return (ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(ct)
}

/** Corpo enviado ao pedir uma URL de upload pré-assinada. */
export interface PresignImageUploadRequest {
  contentType: string
  size: number
}

/** Resposta do presign: URL de PUT + URL pública final + chave do objeto. */
export interface PresignImageUploadResponse {
  uploadUrl: string
  publicUrl: string
  key: string
}

/** Config pública do recurso de upload (controla o botão no front). */
export interface ImageUploadConfig {
  enabled: boolean
  maxBytes: number
  allowedContentTypes: string[]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/shared exec vitest run src/image.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Wire the barrel and extend review DTOs**

In `packages/shared/src/index.ts`, add at the end:

```ts
export * from './image'
```

In `packages/shared/src/review.ts`, add the import near the top (após o import de `AttachedGif`):

```ts
import type { AttachedImage } from './image'
```

In the same file, add `image` to the four types. In `ReviewDTO`, right after the `gif` line:

```ts
  /** Imagem anexada, ou null. */
  image: AttachedImage | null
```

In `ReviewCommentDTO`, right after its `gif` line:

```ts
  image: AttachedImage | null
```

In `CreateReviewRequest`, after its `gif?` line:

```ts
  image?: AttachedImage
```

In `CreateReviewCommentRequest`, after its `gif?` line:

```ts
  image?: AttachedImage
```

- [ ] **Step 6: Typecheck the shared package**

Run: `pnpm --filter @legends/shared exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/image.ts packages/shared/src/image.test.ts packages/shared/src/index.ts packages/shared/src/review.ts
git commit -m "feat(shared): contrato de imagem anexada na resenha"
```

---

### Task 2: Colunas de imagem no Prisma + migration

Adiciona `imageUrl/imageWidth/imageHeight` a `Review` e `ReviewComment` (espelham as colunas de GIF) e gera a migration.

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (models `Review` ~469 e `ReviewComment` ~489)
- Create: `apps/api/prisma/migrations/<timestamp>_add_review_image_columns/migration.sql` (gerado)

**Interfaces:**
- Produces: colunas `imageUrl String?`, `imageWidth Int?`, `imageHeight Int?` no client Prisma para `Review` e `ReviewComment`.

- [ ] **Step 1: Garantir Postgres de pé**

Run: `pnpm db:up`
Expected: container do Postgres rodando (idempotente se já estiver).

- [ ] **Step 2: Add columns to the schema**

In `apps/api/prisma/schema.prisma`, in `model Review`, right after the `gifHeight Int?` line:

```prisma
  imageUrl    String?
  imageWidth  Int?
  imageHeight Int?
```

In `model ReviewComment`, right after its `gifHeight Int?` line:

```prisma
  imageUrl    String?
  imageWidth  Int?
  imageHeight Int?
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:migrate --name add_review_image_columns`
Expected: cria `prisma/migrations/<timestamp>_add_review_image_columns/migration.sql` com `ALTER TABLE "Review" ADD COLUMN ...` e idem para `ReviewComment`; aplica no banco de dev; regenera o client.

- [ ] **Step 4: Verify the generated client has the fields**

Run: `pnpm --filter @legends/api exec node -e "const {Prisma}=require('@prisma/client'); const f=Prisma.dmmf.datamodel.models.find(m=>m.name==='Review').fields.map(x=>x.name); console.log(['imageUrl','imageWidth','imageHeight'].every(c=>f.includes(c)) ? 'OK' : 'MISSING')"`
Expected: imprime `OK` (o client Prisma regenerado inclui as colunas em `Review`).

> **Nota (gate transitório):** NÃO rode `tsc --noEmit` da API nesta task. Como a Task 1 tornou `image` obrigatório em `ReviewDTO`/`ReviewCommentDTO`, o `serialize.ts` fica com ~2 erros de tipo até a Task 5 preencher o campo. Isso é esperado; Vitest não faz typecheck, então as suítes rodam normalmente. O gate de `tsc` da API zera na Task 5.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): colunas de imagem em Review e ReviewComment"
```

---

### Task 3: Lib `s3-client` + variáveis de ambiente

Cria a lib de S3 com gating por env, geração de chave, URL pública e presign. Fina o suficiente para testar as partes puras sem AWS.

**Files:**
- Create: `apps/api/src/lib/s3-client.ts`
- Create: `apps/api/src/lib/s3-client.test.ts`
- Modify: `apps/api/.env.example` (documentar as variáveis)
- Modify: `apps/api/package.json` (deps `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`)

**Interfaces:**
- Consumes (Task 1): `ALLOWED_IMAGE_CONTENT_TYPES`, `AllowedImageContentType`.
- Produces:
  - `interface S3Config { bucket: string; region: string; publicBaseUrl: string }`
  - `function s3Config(env?): S3Config | null` — `publicBaseUrl` sem barra final.
  - `function imageUploadsEnabled(env?): boolean`
  - `function buildImageKey(userId: string, contentType: AllowedImageContentType, id?: string): string`
  - `function publicUrlFor(key: string, cfg: S3Config): string`
  - `function presignImageUpload(input: { key: string; contentType: string }): Promise<string>`

- [ ] **Step 1: Install AWS SDK deps**

Run:
```bash
pnpm --filter @legends/api add @aws-sdk/client-s3@^3 @aws-sdk/s3-request-presigner@^3
```
Expected: ambas adicionadas em `apps/api/package.json` → `dependencies`.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/lib/s3-client.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { s3Config, imageUploadsEnabled, buildImageKey, publicUrlFor } from './s3-client'

const fullEnv = {
  S3_BUCKET: 'meu-bucket',
  S3_REGION: 'us-east-1',
  S3_PUBLIC_BASE_URL: 'https://cdn.exemplo.com/',
} as NodeJS.ProcessEnv

describe('s3-client config', () => {
  it('retorna null quando falta qualquer variável', () => {
    expect(s3Config({} as NodeJS.ProcessEnv)).toBeNull()
    expect(s3Config({ S3_BUCKET: 'b', S3_REGION: 'r' } as NodeJS.ProcessEnv)).toBeNull()
    expect(imageUploadsEnabled({} as NodeJS.ProcessEnv)).toBe(false)
  })

  it('monta a config e remove a barra final da base pública', () => {
    const cfg = s3Config(fullEnv)
    expect(cfg).toEqual({ bucket: 'meu-bucket', region: 'us-east-1', publicBaseUrl: 'https://cdn.exemplo.com' })
    expect(imageUploadsEnabled(fullEnv)).toBe(true)
  })
})

describe('s3-client key + url', () => {
  it('gera chave por usuário com extensão pelo content-type', () => {
    expect(buildImageKey('user1', 'image/jpeg', 'fixed-id')).toBe('reviews/user1/fixed-id.jpg')
    expect(buildImageKey('user1', 'image/png', 'fixed-id')).toBe('reviews/user1/fixed-id.png')
    expect(buildImageKey('user1', 'image/webp', 'fixed-id')).toBe('reviews/user1/fixed-id.webp')
    expect(buildImageKey('user1', 'image/gif', 'fixed-id')).toBe('reviews/user1/fixed-id.gif')
  })

  it('monta a URL pública a partir da chave', () => {
    const cfg = s3Config(fullEnv)!
    expect(publicUrlFor('reviews/user1/abc.jpg', cfg)).toBe('https://cdn.exemplo.com/reviews/user1/abc.jpg')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @legends/api exec vitest run src/lib/s3-client.test.ts`
Expected: FAIL — não resolve `./s3-client`.

- [ ] **Step 4: Implement the lib**

Create `apps/api/src/lib/s3-client.ts`:

```ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'
import type { AllowedImageContentType } from '@legends/shared'

export interface S3Config {
  bucket: string
  region: string
  publicBaseUrl: string
}

/** Config do S3 lida do ambiente, ou null se incompleta. */
export function s3Config(env: NodeJS.ProcessEnv = process.env): S3Config | null {
  const bucket = env.S3_BUCKET
  const region = env.S3_REGION
  const publicBaseUrl = env.S3_PUBLIC_BASE_URL
  if (!bucket || !region || !publicBaseUrl) return null
  return { bucket, region, publicBaseUrl: publicBaseUrl.replace(/\/+$/, '') }
}

/** O upload de imagens está habilitado? (controla o recurso no front) */
export function imageUploadsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return s3Config(env) !== null
}

const EXT_BY_TYPE: Record<AllowedImageContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** Chave do objeto: reviews/<userId>/<uuid>.<ext>. */
export function buildImageKey(
  userId: string,
  contentType: AllowedImageContentType,
  id: string = randomUUID(),
): string {
  return `reviews/${userId}/${id}.${EXT_BY_TYPE[contentType]}`
}

/** URL pública final do objeto (bucket público / CDN). */
export function publicUrlFor(key: string, cfg: S3Config): string {
  return `${cfg.publicBaseUrl}/${key}`
}

let client: S3Client | null = null
function getClient(region: string): S3Client {
  if (!client) client = new S3Client({ region })
  return client
}

/** Gera uma URL pré-assinada de PUT (expira em 60s). */
export async function presignImageUpload(input: { key: string; contentType: string }): Promise<string> {
  const cfg = s3Config()
  if (!cfg) throw new Error('S3 não configurado')
  const command = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: input.key,
    ContentType: input.contentType,
  })
  return getSignedUrl(getClient(cfg.region), command, { expiresIn: 60 })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/lib/s3-client.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 6: Document env vars**

Append to `apps/api/.env.example`:

```bash
# Upload de imagens na Resenha (S3). Sem estas variáveis, o recurso fica desabilitado.
S3_BUCKET=
S3_REGION=us-east-1
# Base pública dos objetos (bucket público ou CloudFront), sem barra final.
S3_PUBLIC_BASE_URL=
# Credenciais AWS: em produção prefira IAM role na EC2 (provider chain padrão do SDK).
# Em dev, exporte AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY no ambiente.
# CORS do bucket precisa permitir PUT a partir da origem do app (método PUT, header Content-Type).
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/s3-client.ts apps/api/src/lib/s3-client.test.ts apps/api/.env.example apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): lib s3-client com presign e gating por env"
```

---

### Task 4: Rota de upload (`/uploads/config` + `/uploads/images/presign`)

Expõe a config pública e o endpoint autenticado que valida tipo/tamanho e devolve a URL pré-assinada.

**Files:**
- Create: `apps/api/src/routes/image-uploads.ts`
- Create: `apps/api/src/routes/image-uploads.test.ts`
- Modify: `apps/api/src/app.ts` (import + `app.register(imageUploadRoutes)`)

**Interfaces:**
- Consumes (Task 1): `ALLOWED_IMAGE_CONTENT_TYPES`, `IMAGE_MAX_BYTES`, `isAllowedImageContentType`, `AllowedImageContentType`, `ImageUploadConfig`. (Task 3): `buildImageKey`, `imageUploadsEnabled`, `presignImageUpload`, `publicUrlFor`, `s3Config`.
- Produces: `async function imageUploadRoutes(app: FastifyInstance): Promise<void>`; endpoints `GET /uploads/config` (público) e `POST /uploads/images/presign` (auth).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/image-uploads.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildApp } from '../app'

// getSignedUrl é mockado: exercita rota + s3-client reais sem bater na AWS.
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://s3.amazonaws.com/signed-put-url'),
}))

async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Up', email: 'up@empresa.com', password: 'changeme123' },
  })
  const token = reg.json().accessToken as string
  return { app, token }
}
function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

const S3_KEYS = ['S3_BUCKET', 'S3_REGION', 'S3_PUBLIC_BASE_URL'] as const
const original: Record<string, string | undefined> = {}
function enableS3() {
  process.env.S3_BUCKET = 'bucket'
  process.env.S3_REGION = 'us-east-1'
  process.env.S3_PUBLIC_BASE_URL = 'https://cdn.exemplo.com'
}
function disableS3() {
  for (const k of S3_KEYS) delete process.env[k]
}

describe('rotas de upload de imagem', () => {
  for (const k of S3_KEYS) original[k] = process.env[k]
  afterEach(() => {
    for (const k of S3_KEYS) {
      if (original[k] === undefined) delete process.env[k]
      else process.env[k] = original[k]
    }
    vi.clearAllMocks()
  })

  it('/uploads/config reflete a flag e expõe limites', async () => {
    enableS3()
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/uploads/config' })
    expect(res.statusCode).toBe(200)
    expect(res.json().enabled).toBe(true)
    expect(res.json().maxBytes).toBe(10 * 1024 * 1024)
    expect(res.json().allowedContentTypes).toContain('image/png')
    await app.close()
  })

  it('presign devolve uploadUrl + publicUrl (auth)', async () => {
    enableS3()
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/images/presign',
      headers: auth(token),
      payload: { contentType: 'image/png', size: 1000 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().uploadUrl).toBe('https://s3.amazonaws.com/signed-put-url')
    expect(res.json().publicUrl).toMatch(/^https:\/\/cdn\.exemplo\.com\/reviews\/.+\.png$/)
    await app.close()
  })

  it('presign rejeita content-type inválido (400)', async () => {
    enableS3()
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/images/presign',
      headers: auth(token),
      payload: { contentType: 'application/pdf', size: 1000 },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('presign rejeita tamanho acima do máximo (400)', async () => {
    enableS3()
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/images/presign',
      headers: auth(token),
      payload: { contentType: 'image/png', size: 10 * 1024 * 1024 + 1 },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('presign sem auth responde 401', async () => {
    enableS3()
    const { app } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/images/presign',
      payload: { contentType: 'image/png', size: 1000 },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('presign com S3 desabilitado responde 503', async () => {
    disableS3()
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/images/presign',
      headers: auth(token),
      payload: { contentType: 'image/png', size: 1000 },
    })
    expect(res.statusCode).toBe(503)
    await app.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/api exec vitest run src/routes/image-uploads.test.ts`
Expected: FAIL — `buildApp` não registra a rota (404) e/ou import inexistente.

- [ ] **Step 3: Implement the route**

Create `apps/api/src/routes/image-uploads.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  IMAGE_MAX_BYTES,
  isAllowedImageContentType,
  type AllowedImageContentType,
  type ImageUploadConfig,
} from '@legends/shared'
import {
  buildImageKey,
  imageUploadsEnabled,
  presignImageUpload,
  publicUrlFor,
  s3Config,
} from '../lib/s3-client'

const presignSchema = z.object({
  contentType: z.string(),
  size: z.number().int().positive(),
})

export async function imageUploadRoutes(app: FastifyInstance) {
  app.get('/uploads/config', async (_request, reply) => {
    const config: ImageUploadConfig = {
      enabled: imageUploadsEnabled(),
      maxBytes: IMAGE_MAX_BYTES,
      allowedContentTypes: [...ALLOWED_IMAGE_CONTENT_TYPES],
    }
    return reply.send(config)
  })

  app.post('/uploads/images/presign', { onRequest: [app.authenticate] }, async (request, reply) => {
    const cfg = s3Config()
    if (!cfg) return reply.code(503).send({ message: 'Uploads de imagem desabilitados.' })

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

    const key = buildImageKey(request.user.sub, contentType as AllowedImageContentType)
    const uploadUrl = await presignImageUpload({ key, contentType })
    return reply.send({ uploadUrl, publicUrl: publicUrlFor(key, cfg), key })
  })
}
```

- [ ] **Step 4: Register the route**

In `apps/api/src/app.ts`, add the import next to the other route imports (após `import { gifRoutes } from './routes/gifs'`):

```ts
import { imageUploadRoutes } from './routes/image-uploads'
```

And register it next to `app.register(gifRoutes)`:

```ts
  app.register(imageUploadRoutes)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/routes/image-uploads.test.ts`
Expected: PASS (6 testes). (Postgres precisa estar de pé — `setup()` registra usuário.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/image-uploads.ts apps/api/src/routes/image-uploads.test.ts apps/api/src/app.ts
git commit -m "feat(api): rota de presign de upload de imagem"
```

---

### Task 5: Service + serialize (persistir e expor a imagem)

Estende `createReview`/`createComment` para aceitar imagem, validar exclusão mútua com GIF e host do bucket, persistir; e `serialize` para expor `image` nos DTOs.

**Files:**
- Modify: `apps/api/src/services/review-service.ts`
- Modify: `apps/api/src/services/review-service.test.ts`
- Modify: `apps/api/src/lib/serialize.ts` (`toReviewDTO`, `toReviewCommentDTO`)

**Interfaces:**
- Consumes (Task 1): `AttachedImage`. (Task 3): `s3Config`.
- Produces:
  - `createReview` e `createComment` aceitam campo opcional `image?: AttachedImage`.
  - Persistem `imageUrl/imageWidth/imageHeight`.
  - `toReviewDTO`/`toReviewCommentDTO` emitem `image: AttachedImage | null`.
  - Domínio: imagem + gif juntos → `ReviewError` 400; imagem de host fora do bucket → `ReviewError` 400.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/services/review-service.test.ts` (dentro do arquivo, novo bloco `describe` no final; e adicionar `S3_PUBLIC_BASE_URL` ao topo do arquivo). No topo do arquivo, logo após os imports, adicione:

```ts
process.env.S3_PUBLIC_BASE_URL = process.env.S3_PUBLIC_BASE_URL ?? 'https://cdn.exemplo.com'
const IMG = { url: 'https://cdn.exemplo.com/reviews/u/x.png', width: 100, height: 80 }
```

E no final do arquivo:

```ts
describe('review-service: imagem anexada', () => {
  it('persiste a imagem na resenha', async () => {
    const u = await makeUser('img1@empresa.com')
    const review = await createReview({ authorId: u.id, content: '', image: IMG })
    expect(review.imageUrl).toBe(IMG.url)
    expect(review.imageWidth).toBe(100)
    expect(review.imageHeight).toBe(80)
  })

  it('aceita só imagem, sem texto', async () => {
    const u = await makeUser('img2@empresa.com')
    await expect(createReview({ authorId: u.id, content: '   ', image: IMG })).resolves.toBeTruthy()
  })

  it('rejeita imagem e gif juntos (400)', async () => {
    const u = await makeUser('img3@empresa.com')
    const gif = { url: 'https://media.giphy.com/a.gif', width: 10, height: 10 }
    await expect(
      createReview({ authorId: u.id, content: 'oi', gif, image: IMG }),
    ).rejects.toBeInstanceOf(ReviewError)
  })

  it('rejeita imagem de host fora do bucket (400)', async () => {
    const u = await makeUser('img4@empresa.com')
    const evil = { url: 'https://evil.com/x.png', width: 10, height: 10 }
    await expect(createReview({ authorId: u.id, content: 'oi', image: evil })).rejects.toBeInstanceOf(ReviewError)
  })

  it('persiste imagem no comentário', async () => {
    const author = await makeUser('img5@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'post' })
    const { comment } = await createComment({ reviewId: review.id, authorId: author.id, content: '', image: IMG })
    expect(comment.imageUrl).toBe(IMG.url)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @legends/api exec vitest run src/services/review-service.test.ts -t "imagem anexada"`
Expected: FAIL — `createReview`/`createComment` não aceitam `image` (TS) e/ou não persistem.

- [ ] **Step 3: Extend the service**

In `apps/api/src/services/review-service.ts`, update the import line from `@legends/shared` to include image symbols:

```ts
import {
  REVIEW_MAX_LENGTH,
  REVIEW_REACTIONS,
  MAX_REVIEW_MENTIONS,
  isGiphyHost,
  type AttachedGif,
  type AttachedImage,
} from '@legends/shared'
```

Add the s3Config import near the prisma import:

```ts
import { s3Config } from '../lib/s3-client'
```

Replace the `assertContentOrGif` function with a version that considers any attachment:

```ts
/** Conteúdo da resenha: texto (1..MAX) OU presença de anexo (gif/imagem). Devolve o texto trimado. */
function assertContentOrAttachment(content: string, hasAttachment: boolean): string {
  const trimmed = content.trim()
  if (trimmed.length > REVIEW_MAX_LENGTH) {
    throw new ReviewError(`O texto precisa ter no máximo ${REVIEW_MAX_LENGTH} caracteres.`, 400)
  }
  if (trimmed.length === 0 && !hasAttachment) {
    throw new ReviewError('Escreva algo ou anexe um GIF ou imagem.', 400)
  }
  return trimmed
}
```

Add two new validators right after `assertGifHost`:

```ts
/** Um post/comentário aceita no máximo um anexo: gif OU imagem. */
function assertSingleAttachment(gif?: AttachedGif, image?: AttachedImage): void {
  if (gif && image) {
    throw new ReviewError('Anexe um GIF ou uma imagem, não os dois.', 400)
  }
}

/** Valida que a URL da imagem aponta para o nosso bucket público (S3_PUBLIC_BASE_URL). */
function assertImageHost(image?: AttachedImage): void {
  if (!image) return
  const cfg = s3Config()
  if (!cfg || !image.url.startsWith(`${cfg.publicBaseUrl}/`)) {
    throw new ReviewError('Imagem inválida.', 400)
  }
}
```

In `createReview`, change the signature to add `image?: AttachedImage`:

```ts
export async function createReview(input: {
  authorId: string
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
}): Promise<ReviewWithRelations> {
```

Replace its first two lines (the `assertContentOrGif` + `assertGifHost` calls) with:

```ts
  assertSingleAttachment(input.gif, input.image)
  const content = assertContentOrAttachment(input.content, Boolean(input.gif || input.image))
  assertGifHost(input.gif)
  assertImageHost(input.image)
```

In the `prisma.review.create` `data`, add the image spread right after the gif spread:

```ts
      ...(input.image
        ? { imageUrl: input.image.url, imageWidth: input.image.width, imageHeight: input.image.height }
        : {}),
```

In `createComment`, change the signature to add `image?: AttachedImage`:

```ts
export async function createComment(input: {
  reviewId: string
  authorId: string
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
}): Promise<{ comment: ReviewCommentWithRelations; reviewAuthorId: string; replyRecipientIds: string[] }> {
```

Replace its first two lines (the `assertContentOrGif` + `assertGifHost` calls) with:

```ts
  assertSingleAttachment(input.gif, input.image)
  const content = assertContentOrAttachment(input.content, Boolean(input.gif || input.image))
  assertGifHost(input.gif)
  assertImageHost(input.image)
```

In the `prisma.reviewComment.create` `data`, add the image spread right after the gif spread:

```ts
      ...(input.image
        ? { imageUrl: input.image.url, imageWidth: input.image.width, imageHeight: input.image.height }
        : {}),
```

- [ ] **Step 4: Extend serialize**

In `apps/api/src/lib/serialize.ts`, in `toReviewDTO`, add right after the `gif:` line:

```ts
    image: review.imageUrl
      ? { url: review.imageUrl, width: review.imageWidth ?? 0, height: review.imageHeight ?? 0 }
      : null,
```

In `toReviewCommentDTO`, add right after its `gif:` line:

```ts
    image: comment.imageUrl
      ? { url: comment.imageUrl, width: comment.imageWidth ?? 0, height: comment.imageHeight ?? 0 }
      : null,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @legends/api exec vitest run src/services/review-service.test.ts`
Expected: PASS (todos, incluindo o novo bloco "imagem anexada").

- [ ] **Step 6: Typecheck the API**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/review-service.ts apps/api/src/services/review-service.test.ts apps/api/src/lib/serialize.ts
git commit -m "feat(api): persistir e serializar imagem na resenha e comentário"
```

---

### Task 6: Wiring da rota de resenha (aceitar `image` no payload)

Estende os schemas Zod e handlers de `POST /reviews` e `POST /reviews/:id/comments` para aceitar e repassar `image`.

**Files:**
- Modify: `apps/api/src/routes/review.ts`
- Modify: `apps/api/src/routes/review.test.ts`

**Interfaces:**
- Consumes (Task 5): `createReview({ ..., image? })`, `createComment({ ..., image? })`.
- Produces: `POST /reviews` e `POST /reviews/:id/comments` aceitam `image?: { url, width, height }`; refine passa a permitir conteúdo OU gif OU imagem.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/routes/review.test.ts` (novo `it` dentro do `describe('review routes', ...)`). Assumindo `S3_PUBLIC_BASE_URL`, defina no topo do arquivo, após os imports:

```ts
process.env.S3_PUBLIC_BASE_URL = process.env.S3_PUBLIC_BASE_URL ?? 'https://cdn.exemplo.com'
```

E os testes:

```ts
  it('cria resenha só com imagem (201) e a devolve no DTO', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: auth(token),
      payload: { content: '', image: { url: 'https://cdn.exemplo.com/reviews/u/x.png', width: 100, height: 80 } },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().review.image).toEqual({ url: 'https://cdn.exemplo.com/reviews/u/x.png', width: 100, height: 80 })
    await app.close()
  })

  it('rejeita imagem + gif juntos (400)', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: auth(token),
      payload: {
        content: 'oi',
        gif: { url: 'https://media.giphy.com/a.gif', width: 10, height: 10 },
        image: { url: 'https://cdn.exemplo.com/reviews/u/x.png', width: 10, height: 10 },
      },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @legends/api exec vitest run src/routes/review.test.ts -t "imagem"`
Expected: FAIL — o schema descarta `image` (o DTO retorna `image: null`) e o caso imagem-só sem gif é rejeitado pelo refine atual.

- [ ] **Step 3: Extend the route schemas and handlers**

In `apps/api/src/routes/review.ts`, add an `imageSchema` right after `gifSchema`:

```ts
const imageSchema = z.object({
  url: z.string().url(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
})
```

Update `contentSchema` to include `image` and broaden the refine:

```ts
const contentSchema = z
  .object({
    content: z.string().trim().max(REVIEW_MAX_LENGTH).optional().default(''),
    mentionedUserIds: z.array(z.string()).max(MAX_REVIEW_MENTIONS).optional(),
    gif: gifSchema.optional(),
    image: imageSchema.optional(),
  })
  .refine((v) => v.content.trim().length >= 1 || v.gif || v.image, {
    message: 'Escreva algo ou anexe um GIF ou imagem.',
  })
```

Update `invalidContent`:

```ts
const invalidContent = { message: `Escreva algo (até ${REVIEW_MAX_LENGTH} caracteres) ou anexe um GIF ou imagem.` }
```

In the `POST /reviews` handler, pass `image` to `createReview`:

```ts
      const review = await createReview({
        authorId: request.user.sub,
        content: parsed.data.content,
        mentionedUserIds: parsed.data.mentionedUserIds,
        gif: parsed.data.gif,
        image: parsed.data.image,
      })
```

Find the `POST /reviews/:id/comments` handler (it also uses `contentSchema.safeParse` and calls `createComment`). Add `image` to that `createComment` call:

```ts
        image: parsed.data.image,
```

(Place it alongside the existing `gif: parsed.data.gif` argument in the `createComment(...)` call.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @legends/api exec vitest run src/routes/review.test.ts`
Expected: PASS (todos, incluindo os dois novos).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/review.ts apps/api/src/routes/review.test.ts
git commit -m "feat(api): aceitar imagem no POST de resenha e comentário"
```

---

### Task 7: Front — lib de upload + hook de config

Cria `uploadImage`/`validateImageFile` e o hook `useImageUploadsEnabled`.

**Files:**
- Create: `apps/web/src/lib/upload.ts`
- Create: `apps/web/src/lib/upload.test.ts`
- Create: `apps/web/src/lib/use-image-upload.ts`

**Interfaces:**
- Consumes (Task 1): `ALLOWED_IMAGE_CONTENT_TYPES`, `IMAGE_MAX_BYTES`, `isAllowedImageContentType`, `AttachedImage`, `PresignImageUploadResponse`, `ImageUploadConfig`.
- Produces:
  - `class UploadError extends Error`
  - `function validateImageFile(file: File): void`
  - `function readImageDimensions(file: File): Promise<{ width: number; height: number }>`
  - `function uploadImage(file: File): Promise<AttachedImage>`
  - `function useImageUploadsEnabled(): boolean`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/upload.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateImageFile, UploadError } from './upload'

function fakeFile(type: string, size: number): File {
  const f = new File(['x'], 'x', { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('validateImageFile', () => {
  it('aceita PNG dentro do limite', () => {
    expect(() => validateImageFile(fakeFile('image/png', 1000))).not.toThrow()
  })

  it('rejeita formato não suportado', () => {
    expect(() => validateImageFile(fakeFile('image/svg+xml', 1000))).toThrow(UploadError)
  })

  it('rejeita arquivo acima de 10MB', () => {
    expect(() => validateImageFile(fakeFile('image/png', 10 * 1024 * 1024 + 1))).toThrow(UploadError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/lib/upload.test.ts`
Expected: FAIL — não resolve `./upload`.

- [ ] **Step 3: Implement the upload lib**

Create `apps/web/src/lib/upload.ts`:

```ts
import {
  IMAGE_MAX_BYTES,
  isAllowedImageContentType,
  type AttachedImage,
  type PresignImageUploadResponse,
} from '@legends/shared'
import { apiFetch } from './api'

export class UploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UploadError'
  }
}

/** Valida tipo e tamanho antes de subir. Lança UploadError com mensagem em pt-BR. */
export function validateImageFile(file: File): void {
  if (!isAllowedImageContentType(file.type)) {
    throw new UploadError('Formato não suportado. Use JPEG, PNG, WebP ou GIF.')
  }
  if (file.size > IMAGE_MAX_BYTES) {
    throw new UploadError('Imagem muito grande (máx. 10MB).')
  }
}

/** Lê as dimensões naturais da imagem no browser. */
export function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new UploadError('Não foi possível ler a imagem.'))
    }
    img.src = url
  })
}

/** Fluxo completo: valida → dimensões → presign → PUT no S3 → AttachedImage. */
export async function uploadImage(file: File): Promise<AttachedImage> {
  validateImageFile(file)
  const { width, height } = await readImageDimensions(file)
  const presign = await apiFetch<PresignImageUploadResponse>('/uploads/images/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType: file.type, size: file.size }),
  })
  // PUT direto no S3 (fetch cru, fora do apiFetch): sem Authorization, Content-Type do arquivo.
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!put.ok) throw new UploadError('Falha ao enviar a imagem.')
  return { url: presign.publicUrl, width, height }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/lib/upload.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Implement the config hook**

Create `apps/web/src/lib/use-image-upload.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import type { ImageUploadConfig } from '@legends/shared'
import { apiFetch } from './api'

/** Flag pública: o backend tem S3 configurado? (controla o botão Imagem) */
export function useImageUploadsEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ['uploads', 'config'],
    queryFn: () => apiFetch<ImageUploadConfig>('/uploads/config'),
    staleTime: 5 * 60 * 1000,
  })
  return data?.enabled ?? false
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/upload.ts apps/web/src/lib/upload.test.ts apps/web/src/lib/use-image-upload.ts
git commit -m "feat(web): lib de upload de imagem e hook de config"
```

---

### Task 8: Front — componente `ImagePicker`

Botão que abre o seletor de arquivo, faz o upload e devolve a `AttachedImage`; desabilitável para exclusão mútua com o GIF.

**Files:**
- Create: `apps/web/src/components/ImagePicker.tsx`
- Create: `apps/web/src/components/ImagePicker.test.tsx`

**Interfaces:**
- Consumes (Task 7): `uploadImage`, `UploadError`. (Task 1): `AttachedImage`.
- Produces: `function ImagePicker(props: { onSelect: (image: AttachedImage) => void; disabled?: boolean }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/ImagePicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ImagePicker } from './ImagePicker'

describe('ImagePicker', () => {
  it('renderiza o botão Imagem', () => {
    render(<ImagePicker onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: /imagem/i })).toBeInTheDocument()
  })

  it('desabilita o botão quando disabled', () => {
    render(<ImagePicker onSelect={vi.fn()} disabled />)
    expect(screen.getByRole('button', { name: /imagem/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/components/ImagePicker.test.tsx`
Expected: FAIL — não resolve `./ImagePicker`.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/components/ImagePicker.tsx`:

```tsx
import { useRef, useState, type ChangeEvent } from 'react'
import type { AttachedImage } from '@legends/shared'
import { uploadImage, UploadError } from '../lib/upload'
import { Icon } from './Icon'

export function ImagePicker({
  onSelect,
  disabled,
}: {
  onSelect: (image: AttachedImage) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite re-selecionar o mesmo arquivo
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const image = await uploadImage(file)
      onSelect(image)
    } catch (err) {
      setError(err instanceof UploadError ? err.message : 'Falha ao enviar a imagem.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        aria-label="Adicionar imagem"
        className="flex items-center gap-xs rounded-full border border-outline-variant/60 px-sm py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
      >
        <Icon name="image" className="text-[18px]" /> {busy ? 'Enviando…' : 'Imagem'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFile}
      />
      {error && (
        <span role="alert" className="ml-xs text-label-sm text-error">
          {error}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/components/ImagePicker.test.tsx`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ImagePicker.tsx apps/web/src/components/ImagePicker.test.tsx
git commit -m "feat(web): componente ImagePicker"
```

---

### Task 9: Front — integrar imagem no composer, feed e cards

Liga o `ImagePicker` ao composer de post e de comentário (com exclusão mútua vs GIF), repassa `image` nas mutations e renderiza a imagem nos cards.

**Files:**
- Modify: `apps/web/src/pages/resenha/ReviewComposer.tsx`
- Modify: `apps/web/src/pages/resenha/ResenhaFeed.tsx` (assinatura de `onSubmit`)
- Modify: `apps/web/src/pages/resenha/ReviewCard.tsx` (render da imagem)
- Modify: `apps/web/src/pages/resenha/ReviewComments.tsx` (composer + render da imagem)

**Interfaces:**
- Consumes (Task 8): `ImagePicker`. (Task 7): `useImageUploadsEnabled`. (Task 1): `AttachedImage`.
- Produces: composer de post chama `onSubmit(content, mentionedUserIds, gif, image)`; posts e comentários exibem `<img>` quando há `image`.

- [ ] **Step 1: Update ReviewComposer**

In `apps/web/src/pages/resenha/ReviewComposer.tsx`:

Add imports (junto aos existentes):

```tsx
import type { AttachedImage } from '@legends/shared'
import { ImagePicker } from '../../components/ImagePicker'
import { useImageUploadsEnabled } from '../../lib/use-image-upload'
```

Change the `onSubmit` prop signature to include `image`:

```tsx
  onSubmit: (content: string, mentionedUserIds: string[], gif: AttachedGif | null, image: AttachedImage | null) => void
```

Add state and the enabled flag (após `const gifsEnabled = useGifsEnabled()`):

```tsx
  const imageUploadsEnabled = useImageUploadsEnabled()
  const [image, setImage] = useState<AttachedImage | null>(null)
```

Update `canSubmit` and `handleSubmit` to account for `image`:

```tsx
  const canSubmit = (trimmed.length >= 1 || gif !== null || image !== null) && !tooLong && !pending

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit(trimmed, mentionIds, gif, image)
    setContent('')
    setMentionIds([])
    setGif(null)
    setImage(null)
  }
```

Add an image preview block right after the existing `{gif && ( ... )}` preview block:

```tsx
        {image && (
          <div className="relative mt-sm w-fit">
            <img
              src={image.url}
              alt="Imagem anexada"
              width={image.width || undefined}
              height={image.height || undefined}
              className="max-h-48 rounded-lg border border-outline-variant/40"
            />
            <button
              type="button"
              onClick={() => setImage(null)}
              aria-label="Remover imagem"
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-surface/90 text-on-surface hover:bg-surface"
            >
              <Icon name="close" className="text-[16px]" />
            </button>
          </div>
        )}
```

In the toolbar (`<div className="flex items-center gap-sm">` que contém o botão de GIF), make GIF hide when an image is attached, and add the ImagePicker (hidden when a gif is attached). Wrap the existing GIF block condition to also require no image, and add the picker after it:

Change the GIF condition from `{gifsEnabled && (` to:

```tsx
            {gifsEnabled && !image && (
```

And add, immediately after the closing `)}` of that GIF block:

```tsx
            {imageUploadsEnabled && !gif && (
              <ImagePicker onSelect={setImage} />
            )}
```

- [ ] **Step 2: Update ResenhaFeed onSubmit**

In `apps/web/src/pages/resenha/ResenhaFeed.tsx`, update the `onSubmit` passed to `<ReviewComposer>`:

```tsx
          onSubmit={(content, mentionedUserIds, gif, image) =>
            create.mutate({
              content,
              mentionedUserIds,
              ...(gif ? { gif } : {}),
              ...(image ? { image } : {}),
            })
          }
```

- [ ] **Step 3: Render image in ReviewCard**

In `apps/web/src/pages/resenha/ReviewCard.tsx`, add an image block right after the existing `{review.gif && ( ... )}` block:

```tsx
        {review.image && (
          <img
            src={review.image.url}
            alt="Imagem da resenha"
            width={review.image.width || undefined}
            height={review.image.height || undefined}
            loading="lazy"
            className="mt-sm max-h-80 max-w-full rounded-lg border border-outline-variant/40"
          />
        )}
```

- [ ] **Step 4: Update ReviewComments (composer + render)**

In `apps/web/src/pages/resenha/ReviewComments.tsx`:

Add imports (junto aos existentes):

```tsx
import type { AttachedImage } from '@legends/shared'
import { ImagePicker } from '../../components/ImagePicker'
import { useImageUploadsEnabled } from '../../lib/use-image-upload'
```

Add state and flag next to the existing gif state (`const [gif, setGif] = useState<AttachedGif | null>(null)`):

```tsx
  const imageUploadsEnabled = useImageUploadsEnabled()
  const [image, setImage] = useState<AttachedImage | null>(null)
```

Update `canSubmit` to include image:

```tsx
  const canSubmit =
    (trimmed.length >= 1 || gif !== null || image !== null) && trimmed.length <= REVIEW_MAX_LENGTH && !create.isPending
```

In the submit handler, include `image` in the mutation body and reset it on success. Change the `create.mutate(...)` call (currently `{ content: trimmed, mentionedUserIds: mentionIds, ...(gif ? { gif } : {}) }`) to:

```tsx
      { content: trimmed, mentionedUserIds: mentionIds, ...(gif ? { gif } : {}), ...(image ? { image } : {}) },
      { onSuccess: () => { setText(''); setMentionIds([]); setGif(null); setImage(null) } },
```

Add an image preview block right after the existing `{gif && ( ... )}` preview (near the composer form, around the current gif preview at ~line 161):

```tsx
          {image && (
            <div className="relative mt-sm w-fit">
              <img
                src={image.url}
                alt="Imagem anexada"
                width={image.width || undefined}
                height={image.height || undefined}
                className="max-h-48 rounded-lg border border-outline-variant/40"
              />
              <button
                type="button"
                onClick={() => setImage(null)}
                aria-label="Remover imagem"
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-surface/90 text-on-surface hover:bg-surface"
              >
                <Icon name="close" className="text-[16px]" />
              </button>
            </div>
          )}
```

Make the GIF button require no image (change the composer's `{gifsEnabled && (` guard to `{gifsEnabled && !image && (`) and add the ImagePicker after the GIF block:

```tsx
          {imageUploadsEnabled && !gif && (
            <ImagePicker onSelect={setImage} />
          )}
```

Render the image on each rendered comment, right after the existing `{c.gif && ( ... )}` block (~line 106):

```tsx
                {c.image && (
                  <img
                    src={c.image.url}
                    alt="Imagem do comentário"
                    width={c.image.width || undefined}
                    height={c.image.height || undefined}
                    loading="lazy"
                    className="mt-sm max-h-72 max-w-full rounded-lg border border-outline-variant/40"
                  />
                )}
```

- [ ] **Step 5: Typecheck the web app**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: no errors (as assinaturas de `onSubmit` e os DTOs batem).

- [ ] **Step 6: Run the web test suite**

Run: `pnpm --filter @legends/web test`
Expected: PASS (inclui `upload.test.ts` e `ImagePicker.test.tsx`).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/resenha/ReviewComposer.tsx apps/web/src/pages/resenha/ResenhaFeed.tsx apps/web/src/pages/resenha/ReviewCard.tsx apps/web/src/pages/resenha/ReviewComments.tsx
git commit -m "feat(web): anexar e exibir imagem na resenha e comentários"
```

---

### Task 10: Verificação end-to-end

Roda a suíte completa e o typecheck de todos os workspaces; valida o fluxo manualmente com o app.

**Files:** nenhum (verificação).

- [ ] **Step 1: Garantir Postgres de pé**

Run: `pnpm db:up`
Expected: Postgres rodando.

- [ ] **Step 2: Suíte completa**

Run: `pnpm test`
Expected: PASS em `@legends/shared`, `@legends/api`, `@legends/web`.

- [ ] **Step 3: Typecheck de todos os workspaces**

Run:
```bash
pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: build de todos os workspaces sem erro.

- [ ] **Step 5: Smoke manual (com S3 configurado)**

Com `S3_BUCKET`/`S3_REGION`/`S3_PUBLIC_BASE_URL` no `.env` e credenciais/IAM válidas, e CORS do bucket permitindo `PUT` da origem do app:
- `pnpm dev`, abrir `/resenha`.
- No composer: o botão **Imagem** aparece; anexar uma imagem mostra o preview; o botão **GIF** some enquanto há imagem (e vice-versa).
- Publicar; a imagem aparece no card do feed e persiste após reload (URL pública do S3).
- Repetir num comentário.
- Sem as envs de S3, o botão **Imagem** não aparece (degradação).

Expected: comportamento acima confirmado.

---

## Notas de operação (fora do código)

- **CORS do bucket** deve permitir `PUT` a partir da origem do app. Exemplo de regra:
  ```json
  [{ "AllowedMethods": ["PUT"], "AllowedOrigins": ["https://SEU-DOMINIO"], "AllowedHeaders": ["Content-Type"], "MaxAgeSeconds": 3000 }]
  ```
- Em produção, preferir **IAM role** na EC2 (o SDK usa o provider chain automaticamente) em vez de chaves no `.env`.
- Objetos precisam de **leitura pública** (ou via CloudFront) para o `<img src>` funcionar.

## Decisões de escopo confirmadas

- **Mural:** `MuralReviewItem` (`packages/shared/src/mural.ts`) não expõe `gif` nem mídia — o mural não renderiza mídia de resenha hoje. Para manter paridade com o comportamento do GIF, **imagem também não vai ao mural**. Nenhuma task de mural é necessária.
