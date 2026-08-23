# Multi-tenancy no Escritório — sub-fatia 2: rotas HTTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repassar `companyId` nos call-sites de rota de `office-map-service.ts`,
`office-setting-service.ts` e `office-guest-service.ts` (já escopados por empresa desde a
sub-fatia 1) — `office-maps.ts`, `office-guests.ts`, `office-media.ts` e o trecho
`/admin/office-settings` de `admin.ts`. `office-ws.ts`/`office-hub.ts` continuam fora de escopo
(sub-fatia 3).

**Architecture:** Toda rota repassa `request.user.companyId` (self-service em todos os casos —
nenhuma rota aceita `:id` de terceiro que seja usuário). A sessão de convidado passa a carregar
o `companyId` real da empresa do convite (herdado de `invite.companyId`) no payload do JWT em
vez do valor fixo `''` de hoje, pra que `GET /office/guest-map` e o branch de broadcast de
`POST /office/media-token` resolvam o mapa/config certos sem round-trip extra ao banco.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Vitest.

## Global Constraints

- Branch de trabalho: `feat/multi-empresa-auth-jwt-clean` (mesma onde as fatias anteriores de
  multi-tenancy — incluindo a sub-fatia 1 do Escritório — já foram commitadas e mergeadas).
  Trabalhar em worktree isolado (`superpowers:using-git-worktrees`).
- **Antes de rodar qualquer comando que grave no Postgres, confirme que `apps/api/.env`'s
  `DATABASE_URL` é `postgresql://legends:legends@localhost:5432/legends?schema=public` (Postgres
  local). Se for qualquer outra coisa, pare e reporte BLOCKED sem executar nada.** (Esta fatia
  não gera migration nova, mas os testes batem em banco real.)
- Nenhuma rota muda de assinatura de request/response — só passa a repassar `companyId`.
- Alguns arquivos de teste de rota chamam funções de serviço DIRETAMENTE como fixture/setup (não
  só via `app.inject`) — `office-maps.test.ts` (`seedMemberAndActiveMap`) e
  `office-media.test.ts` (vários helpers). Essas chamadas também precisam do novo `companyId`,
  mesmo não sendo "rota" propriamente dita — documentado task a task.
- Dois arquivos de teste ainda criam `OfficeSetting` com a forma antiga do singleton
  (`{ id: 1, activeMapPublicationId }`), quebrada desde a migration da sub-fatia 1 (PK agora é
  `companyId`): `office-guests.test.ts` e `office-feature-gate.test.ts`. Ambos precisam trocar
  pra `{ companyId: DEFAULT_COMPANY_ID, activeMapPublicationId }`.
- `DEFAULT_COMPANY_ID` vem de `@legends/shared`.
- Zero mudança de comportamento observável em produção — só existe uma empresa hoje.

---

### Task 1: `office-maps.ts` — rotas de mapa, salas e mesas

**Files:**
- Modify: `apps/api/src/routes/office-maps.ts`
- Modify: `apps/api/src/routes/office-maps.test.ts`

**Interfaces:**
- Consumes: as assinaturas de `office-map-service.ts` já escopadas na sub-fatia 1:
  `listOfficeMaps(companyId)`, `createOfficeMap(input, userId, companyId)`,
  `renameOfficeMap(mapId, name, actorId, companyId)`, `deleteOfficeMap(mapId, actorId, companyId)`,
  `getOfficeMapDraft(mapId, companyId)`, `saveOfficeMapDraft(mapId, input, userId, lockToken, companyId)`,
  `acquireOfficeMapLock(mapId, userId, companyId)`, `heartbeatOfficeMapLock(mapId, userId, lockToken, companyId)`,
  `releaseOfficeMapLock(mapId, userId, lockToken, companyId)`, `listOfficeMapAssets(mapId, companyId)`,
  `uploadOfficeMapAsset(mapId, userId, file, companyId)`, `deleteOfficeMapAsset(mapId, assetId, actorId, companyId)`,
  `validateOfficeMapDraft(mapId, revision, companyId)`, `listOfficeMapPublications(mapId, companyId)`,
  `publishOfficeMap(mapId, revision, userId, activate, companyId)`,
  `getOfficeMapPublication(mapId, publicationId, companyId)`,
  `activateOfficeMapPublication(publicationId, actorId, companyId)`,
  `listActiveOfficeRooms(companyId)`, `updateOfficeRoom(roomId, data, actorId, companyId)`,
  `getActiveOfficeMap(companyId)`, `getActiveMapIdForEditing(companyId)`,
  `saveOfficeDecorationDraft(input, actor, lockToken, companyId)`,
  `publishOfficeDecoration(revision, actor, companyId)`,
  `mergeAndPublishDecoration(input, actor, companyId)`, `listActiveOfficeDesks(companyId)`,
  `adminReleaseOfficeDesk(deskId, actorId, companyId)`, `claimOfficeDesk(deskId, userId, companyId)`,
  `releaseOfficeDesk(deskId, userId, companyId)`.

- [ ] **Step 1: Escrever o teste falhando**

Adicionar ao final do describe `'editor administrativo de mapas'` em
`apps/api/src/routes/office-maps.test.ts` (antes do `})` que fecha esse describe):

```ts

  it('GET /admin/office-maps não lista mapa de outra empresa', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await makeUser(app, 'admin-outra-empresa-map', 'ADMIN')
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Office Maps', slug: 'outra-empresa-office-maps-test' } })
    await prisma.officeMap.create({ data: { name: 'Mapa de outra empresa', companyId: otherCompany.id } })

    const res = await app.inject({ method: 'GET', url: '/admin/office-maps', headers: auth(token) })
    expect(res.statusCode).toBe(200)
    expect(res.json().maps.some((m: { name: string }) => m.name === 'Mapa de outra empresa')).toBe(false)
    await app.close()
  })
```

No topo do arquivo, adicionar o import de `prisma` (já importado) e `DEFAULT_COMPANY_ID` — não é
necessário nesta task específica (o teste acima não usa `DEFAULT_COMPANY_ID`), mas o Step 3
(fixture) vai precisar; adicionar desde já:

```ts
import { OFFICE_TILESET_CATALOG, createEmptyMapDocumentV1, DEFAULT_COMPANY_ID } from '@legends/shared'
```

(troca a linha `import { OFFICE_TILESET_CATALOG, createEmptyMapDocumentV1 } from '@legends/shared'`
já existente.)

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/office-maps.test.ts -t "não lista mapa de outra empresa"`
Expected: FAIL — erro de compilação (`office-maps.ts` ainda chama as funções de serviço com a
assinatura antiga).

- [ ] **Step 3: Atualizar `office-maps.ts`**

Modify `apps/api/src/routes/office-maps.ts` — arquivo inteiro:

```ts
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { MAP_DOCUMENT_V1_LIMITS, MapTileSizeSchema, type UserRole } from '@legends/shared'
import {
  OfficeMapError,
  acquireOfficeMapLock,
  activateOfficeMapPublication,
  adminReleaseOfficeDesk,
  claimOfficeDesk,
  createOfficeMap,
  deleteOfficeMap,
  deleteOfficeMapAsset,
  getActiveMapIdForEditing,
  getActiveOfficeMap,
  getOfficeMapDraft,
  getOfficeMapPublication,
  heartbeatOfficeMapLock,
  listActiveOfficeDesks,
  listActiveOfficeRooms,
  listOfficeMapAssets,
  listOfficeMapPublications,
  listOfficeMaps,
  mergeAndPublishDecoration,
  publishOfficeDecoration,
  publishOfficeMap,
  releaseOfficeDesk,
  releaseOfficeMapLock,
  renameOfficeMap,
  saveOfficeDecorationDraft,
  saveOfficeMapDraft,
  updateOfficeRoom,
  uploadOfficeMapAsset,
  validateOfficeMapDraft,
} from '../services/office-map-service'
import { officeHub } from '../lib/office-hub'

const idParams = z.object({ id: z.string().min(1) })
const assetParams = z.object({ id: z.string().min(1), assetId: z.string().min(1) })
const publicationParams = z.object({ id: z.string().min(1), publicationId: z.string().min(1) })
const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  width: z.number().int().min(MAP_DOCUMENT_V1_LIMITS.minMapWidthCells).max(MAP_DOCUMENT_V1_LIMITS.maxMapWidthCells),
  height: z.number().int().min(MAP_DOCUMENT_V1_LIMITS.minMapHeightCells).max(MAP_DOCUMENT_V1_LIMITS.maxMapHeightCells),
  tileSize: MapTileSizeSchema,
})
const renameSchema = z.object({ name: z.string().trim().min(2).max(120) })
const revisionSchema = z.object({ revision: z.number().int().nonnegative() })
const saveSchema = z.object({ revision: z.number().int().nonnegative(), document: z.unknown() })
const publishSchema = z.object({ revision: z.number().int().nonnegative(), activate: z.boolean() })
const activateSchema = z.object({ publicationId: z.string().min(1) })
const roomSchema = z.object({
  status: z.enum(['OPEN', 'LOCKED']).optional(),
  capacity: z.number().int().positive().nullable().optional(),
  voiceEnabled: z.boolean().optional(),
  accessPolicy: z.enum(['OPEN', 'ALLOWLIST']).optional(),
  allowedUserIds: z.array(z.string().min(1)).max(500).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Informe ao menos uma alteração')

function badInput(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ message: 'Dados inválidos', issues: error.issues })
}

function lockToken(headers: Record<string, unknown>) {
  const value = headers['x-map-lock-token']
  return typeof value === 'string' ? value : ''
}

export async function officeMapRoutes(app: FastifyInstance) {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof OfficeMapError) {
      return reply.code(error.status).send({ message: error.message, code: error.code, ...error.details })
    }
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({
        message: 'O asset excede o limite de 10 MB',
        code: 'ASSET_TOO_LARGE',
      })
    }
    throw error
  })

  const admin = { onRequest: [app.authenticate, app.requireAdmin] }

  app.get('/admin/office-maps', admin, async (request) => ({ maps: await listOfficeMaps(request.user.companyId) }))

  app.post('/admin/office-maps', admin, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    return reply.code(201).send({ map: await createOfficeMap(parsed.data, request.user.sub, request.user.companyId) })
  })

  app.patch('/admin/office-maps/:id', admin, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = renameSchema.safeParse(request.body)
    if (!params.success) return badInput(reply, params.error)
    if (!body.success) return badInput(reply, body.error)
    return { map: await renameOfficeMap(params.data.id, body.data.name, request.user.sub, request.user.companyId) }
  })

  app.delete('/admin/office-maps/:id', admin, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    await deleteOfficeMap(parsed.data.id, request.user.sub, request.user.companyId)
    return reply.code(204).send()
  })

  app.get('/admin/office-maps/:id/draft', admin, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    return getOfficeMapDraft(parsed.data.id, request.user.companyId)
  })

  app.put('/admin/office-maps/:id/draft', admin, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = saveSchema.safeParse(request.body)
    if (!params.success) return badInput(reply, params.error)
    if (!body.success) return badInput(reply, body.error)
    return saveOfficeMapDraft(
      params.data.id,
      { revision: body.data.revision, document: (request.body as { document: unknown }).document },
      request.user.sub,
      lockToken(request.headers),
      request.user.companyId,
    )
  })

  app.post('/admin/office-maps/:id/lock', admin, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    return acquireOfficeMapLock(parsed.data.id, request.user.sub, request.user.companyId)
  })

  app.post('/admin/office-maps/:id/lock/heartbeat', admin, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    return heartbeatOfficeMapLock(parsed.data.id, request.user.sub, lockToken(request.headers), request.user.companyId)
  })

  app.delete('/admin/office-maps/:id/lock', admin, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    await releaseOfficeMapLock(parsed.data.id, request.user.sub, lockToken(request.headers), request.user.companyId)
    return reply.code(204).send()
  })

  app.get('/admin/office-maps/:id/assets', admin, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    return listOfficeMapAssets(parsed.data.id, request.user.companyId)
  })

  app.post('/admin/office-maps/:id/assets', admin, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    const part = await request.file({ limits: { fileSize: MAP_DOCUMENT_V1_LIMITS.maxAssetBytes, files: 1 } })
    if (!part) return reply.code(400).send({ message: 'Envie uma imagem no campo file' })
    const buffer = await part.toBuffer()
    return reply.code(201).send(
      await uploadOfficeMapAsset(parsed.data.id, request.user.sub, {
        buffer,
        filename: part.filename,
        mimetype: part.mimetype,
      }, request.user.companyId),
    )
  })

  app.delete('/admin/office-maps/:id/assets/:assetId', admin, async (request, reply) => {
    const parsed = assetParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    await deleteOfficeMapAsset(parsed.data.id, parsed.data.assetId, request.user.sub, request.user.companyId)
    return reply.code(204).send()
  })

  app.post('/admin/office-maps/:id/validate', admin, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = revisionSchema.safeParse(request.body)
    if (!params.success) return badInput(reply, params.error)
    if (!body.success) return badInput(reply, body.error)
    return validateOfficeMapDraft(params.data.id, body.data.revision, request.user.companyId)
  })

  app.get('/admin/office-maps/:id/publications', admin, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    return listOfficeMapPublications(parsed.data.id, request.user.companyId)
  })

  app.post('/admin/office-maps/:id/publications', admin, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = publishSchema.safeParse(request.body)
    if (!params.success) return badInput(reply, params.error)
    if (!body.success) return badInput(reply, body.error)
    return reply.code(201).send(
      await publishOfficeMap(params.data.id, body.data.revision, request.user.sub, body.data.activate, request.user.companyId),
    )
  })

  app.get('/admin/office-maps/:id/publications/:publicationId', admin, async (request, reply) => {
    const parsed = publicationParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    return getOfficeMapPublication(parsed.data.id, parsed.data.publicationId, request.user.companyId)
  })

  app.patch('/admin/office-map-active', admin, async (request, reply) => {
    const parsed = activateSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    return activateOfficeMapPublication(parsed.data.publicationId, request.user.sub, request.user.companyId)
  })

  app.get('/admin/office-rooms', admin, async (request) => ({ rooms: await listActiveOfficeRooms(request.user.companyId) }))

  app.patch('/admin/office-rooms/:id', admin, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = roomSchema.safeParse(request.body)
    if (!params.success) return badInput(reply, params.error)
    if (!body.success) return badInput(reply, body.error)
    return { room: await updateOfficeRoom(params.data.id, body.data, request.user.sub, request.user.companyId) }
  })

  app.get('/office/map', { onRequest: [app.authenticate, app.requireFeature('escritorio')] }, async (request) => getActiveOfficeMap(request.user.companyId))

  const member = { onRequest: [app.authenticate, app.requireFeature('escritorio')] }
  const decorSaveSchema = z.object({ revision: z.number().int().nonnegative(), document: z.unknown() })
  const decorPublishSchema = z.object({ revision: z.number().int().nonnegative() })
  const decorMergeSchema = z.object({ baseVersion: z.number().int().nonnegative(), document: z.unknown() })

  app.get('/office/map/edit/draft', member, async (request) =>
    getOfficeMapDraft(await getActiveMapIdForEditing(request.user.companyId), request.user.companyId))

  app.post('/office/map/edit/lock', member, async (request) =>
    acquireOfficeMapLock(await getActiveMapIdForEditing(request.user.companyId), request.user.sub, request.user.companyId))

  app.post('/office/map/edit/lock/heartbeat', member, async (request) =>
    heartbeatOfficeMapLock(await getActiveMapIdForEditing(request.user.companyId), request.user.sub, lockToken(request.headers), request.user.companyId))

  app.delete('/office/map/edit/lock', member, async (request, reply) => {
    await releaseOfficeMapLock(await getActiveMapIdForEditing(request.user.companyId), request.user.sub, lockToken(request.headers), request.user.companyId)
    return reply.code(204).send()
  })

  app.put('/office/map/edit/draft', member, async (request, reply) => {
    const body = decorSaveSchema.safeParse(request.body)
    if (!body.success) return badInput(reply, body.error)
    return saveOfficeDecorationDraft(
      { revision: body.data.revision, document: (request.body as { document: unknown }).document },
      { id: request.user.sub, role: request.user.role as UserRole },
      lockToken(request.headers),
      request.user.companyId,
    )
  })

  app.post('/office/map/edit/publish', member, async (request, reply) => {
    const body = decorPublishSchema.safeParse(request.body)
    if (!body.success) return badInput(reply, body.error)
    return publishOfficeDecoration(body.data.revision, { id: request.user.sub, role: request.user.role as UserRole }, request.user.companyId)
  })

  app.post('/office/map/edit/merge-publish', member, async (request, reply) => {
    const body = decorMergeSchema.safeParse(request.body)
    if (!body.success) return badInput(reply, body.error)
    return mergeAndPublishDecoration(
      { baseVersion: body.data.baseVersion, document: (request.body as { document: unknown }).document },
      { id: request.user.sub, role: request.user.role as UserRole },
      request.user.companyId,
    )
  })

  app.get('/admin/office-desks', admin, async (request) => ({ desks: await listActiveOfficeDesks(request.user.companyId) }))

  app.delete('/admin/office-desks/:id/claim', admin, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const desk = await adminReleaseOfficeDesk(params.data.id, request.user.sub, request.user.companyId)
    officeHub.broadcastDeskReleased(desk.id, desk.externalKey)
    return { desk }
  })

  app.post('/office/desks/:id/claim', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const desk = await claimOfficeDesk(params.data.id, request.user.sub, request.user.companyId)
    if (desk.claimedBy) officeHub.broadcastDeskClaimed(desk.id, desk.externalKey, desk.claimedBy)
    return { desk }
  })

  app.post('/office/desks/:id/release', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const desk = await releaseOfficeDesk(params.data.id, request.user.sub, request.user.companyId)
    officeHub.broadcastDeskReleased(desk.id, desk.externalKey)
    return { desk }
  })
}
```

- [ ] **Step 4: Corrigir a fixture `seedMemberAndActiveMap` (chama services direto, não só via HTTP)**

Modify `apps/api/src/routes/office-maps.test.ts` — a função `seedMemberAndActiveMap` chama 6
funções de serviço diretamente (setup de fixture, não passa pela rota) e precisa do novo
`companyId` em cada uma. Substituir:

```ts
async function seedMemberAndActiveMap(app: ReturnType<typeof buildApp>) {
  const admin = await prisma.user.create({
    data: { name: 'admin-decor', email: `admin-decor-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  const { id: mapId } = await createOfficeMap({ name: 'Mapa Ativo', width: 20, height: 20, tileSize: 48 }, admin.id, DEFAULT_COMPANY_ID)
  const builtin = builtinTileset48()
  const doc = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 48 })
  const tileWidth = MapTileSizeSchema.parse(builtin.tileWidth)
  const tileHeight = MapTileSizeSchema.parse(builtin.tileHeight)
  doc.tilesets.push({
    id: 'ts1', assetId: builtin.assetId, name: builtin.name,
    tileWidth, tileHeight,
    columns: builtin.columns, tileCount: builtin.tileCount,
  })
  const objectsLayer = doc.layers.find((l) => l.key === 'objects')
  if (objectsLayer?.type === 'tile') objectsLayer.data[0] = 'ts1:0'
  const adminLock = await acquireOfficeMapLockService(mapId, admin.id, DEFAULT_COMPANY_ID)
  const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId } })
  const saved = await saveOfficeMapDraft(mapId, { revision: draft.revision, document: doc }, admin.id, adminLock.lockToken, DEFAULT_COMPANY_ID)
  await publishOfficeMap(mapId, saved.revision, admin.id, true, DEFAULT_COMPANY_ID)
  await releaseOfficeMapLockService(mapId, admin.id, adminLock.lockToken, DEFAULT_COMPANY_ID)
  const active = await getActiveOfficeMap(DEFAULT_COMPANY_ID)

  const legend = await makeUser(app, `legend-decor-${Date.now()}`, 'LEGEND')
  return { token: legend.token, mapId, activeDoc: active.document, revision: saved.revision }
}
```

(a única mudança real é o `companyId` extra em cada chamada — `getActiveOfficeMap(admin.id)`
também estava usando o parâmetro errado desde antes desta task, agora fica
`getActiveOfficeMap(DEFAULT_COMPANY_ID)`, correto.)

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/routes/office-maps.test.ts`
Expected: PASS (todos os testes do arquivo, incluindo o novo)

- [ ] **Step 6: Rodar tsc**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: erros só em `office-guests.ts`/`office-media.ts`/`admin.ts`/`office-ws.ts` e seus
testes (Tasks 2-3 ainda não despachadas / sub-fatia 3). Nenhum erro em `office-maps.ts` ou
`office-maps.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/office-maps.ts apps/api/src/routes/office-maps.test.ts
git commit -m "feat: repassa companyId nos call-sites de rota de office-maps.ts"
```

---

### Task 2: `office-guest-service.ts` + `office-guests.ts` — sessão de convidado com companyId real

**Files:**
- Modify: `apps/api/src/services/office-guest-service.ts`
- Modify: `apps/api/src/routes/office-guests.ts`
- Modify: `apps/api/src/routes/office-guests.test.ts`
- Modify: `apps/api/src/routes/office-feature-gate.test.ts`

**Interfaces:**
- Consumes: `createOfficeGuestInvite(createdById, expiresInMinutes, companyId)` (já existe desde
  a sub-fatia 1), `getActiveOfficeMap(companyId)` (Task 1).
- Produces: `OfficeGuestJwtPayload.companyId: string` (era `''` fixo), `issueOfficeGuestSession`
  grava o `companyId` real no payload.

- [ ] **Step 1: Escrever os testes falhando**

Modify `apps/api/src/routes/office-guests.test.ts` — trocar o `beforeEach` (cria `OfficeSetting`
com a forma antiga do singleton, quebrada desde a migration da sub-fatia 1) e adicionar o import
de `DEFAULT_COMPANY_ID`:

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { OFFICE_GUEST_CHARACTER_PRESETS, DEFAULT_COMPANY_ID, createEmptyMapDocumentV1 } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

beforeEach(async () => {
  const document = createEmptyMapDocumentV1({ width: 25, height: 18, tileSize: 32 })
  const map = await prisma.officeMap.create({ data: { name: 'Mapa de teste', companyId: DEFAULT_COMPANY_ID } })
  const publication = await prisma.officeMapPublication.create({
    data: {
      mapId: map.id,
      version: 1,
      schemaVersion: document.schemaVersion,
      mapData: document as unknown as Prisma.InputJsonValue,
      companyId: DEFAULT_COMPANY_ID,
    },
  })
  await prisma.officeSetting.create({ data: { companyId: DEFAULT_COMPANY_ID, activeMapPublicationId: publication.id } })
})
```

Adicionar ao final do describe `'office guest invites'` (antes do `})` que fecha o describe) o
teste adversarial de isolamento entre empresas:

```ts

  it('convite de uma empresa dá acesso ao mapa daquela empresa, não à de outra', async () => {
    const app = buildApp()
    await app.ready()

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Guest', slug: 'outra-empresa-guest-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Guest', slug: 'setor-outra-empresa-guest-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherAdmin = await prisma.user.create({
      data: { name: 'AdminOutraEmpresaGuest', email: 'admin-outra-empresa-guest@x.com', passwordHash: 'x', role: 'ADMIN', companyId: otherCompany.id, sectorId: otherSector.id },
    })
    const otherDocument = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
    const otherMap = await prisma.officeMap.create({ data: { name: 'Mapa de outra empresa', companyId: otherCompany.id } })
    const otherPublication = await prisma.officeMapPublication.create({
      data: {
        mapId: otherMap.id, version: 1, schemaVersion: otherDocument.schemaVersion,
        mapData: otherDocument as unknown as Prisma.InputJsonValue, companyId: otherCompany.id,
      },
    })
    await prisma.officeSetting.create({ data: { companyId: otherCompany.id, activeMapPublicationId: otherPublication.id } })

    const otherAdminToken = app.jwt.sign({ sub: otherAdmin.id, role: 'ADMIN', sectorId: otherSector.id, companyId: otherCompany.id, features: [] })
    const created = await app.inject({
      method: 'POST',
      url: '/admin/office-guest-invites',
      headers: { authorization: `Bearer ${otherAdminToken}` },
      payload: { expiresInMinutes: 60 },
    })
    expect(created.statusCode).toBe(201)
    const url = new URL(created.json().invite.url)
    const rawInviteToken = url.pathname.split('/').at(-1)!

    const session = await app.inject({
      method: 'POST',
      url: '/office/guest-session',
      payload: { token: rawInviteToken, name: 'Visitante', presetId: OFFICE_GUEST_CHARACTER_PRESETS[0].id },
    })
    expect(session.statusCode).toBe(200)

    const map = await app.inject({
      method: 'GET',
      url: '/office/guest-map',
      headers: { authorization: `Bearer ${session.json().token}` },
    })
    expect(map.statusCode).toBe(200)
    expect(map.json().map.name).toBe('Mapa de outra empresa')
    expect(map.json().map.name).not.toBe('Mapa de teste')

    await app.close()
  })
```

Modify `apps/api/src/routes/office-feature-gate.test.ts` — mesmo ajuste de `OfficeSetting`:

```ts
import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { createEmptyMapDocumentV1, DEFAULT_COMPANY_ID } from '@legends/shared'
import { Prisma } from '@prisma/client'

async function seedActiveMap() {
  const document = createEmptyMapDocumentV1({ width: 25, height: 18, tileSize: 32 })
  const map = await prisma.officeMap.create({ data: { name: 'Mapa de teste', companyId: DEFAULT_COMPANY_ID } })
  const publication = await prisma.officeMapPublication.create({
    data: { mapId: map.id, version: 1, schemaVersion: document.schemaVersion, mapData: document as unknown as Prisma.InputJsonValue, companyId: DEFAULT_COMPANY_ID },
  })
  await prisma.officeSetting.create({ data: { companyId: DEFAULT_COMPANY_ID, activeMapPublicationId: publication.id } })
}
```

(resto do arquivo inalterado.)

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/office-guests.test.ts src/routes/office-feature-gate.test.ts`
Expected: FAIL — o convite/sessão de convidado ainda não carrega `companyId` real; o novo teste
adversarial mostra `GET /office/guest-map` retornando o mapa errado (ou dando erro, já que
`getActiveOfficeMap` exige `companyId` desde a sub-fatia 1 e a rota ainda não repassa nada).

- [ ] **Step 3: Atualizar `office-guest-service.ts`**

Modify `apps/api/src/services/office-guest-service.ts` — trocar o tipo do payload:

```ts
export interface OfficeGuestJwtPayload {
  sub: string
  role: 'GUEST'
  // Convidado é sector-agnostic (não é um User real) — sectorId é fixo só para
  // satisfazer a forma do payload do JWT, não é lido em lugar nenhum. companyId
  // JÁ É lido: é a empresa dona do convite (invite.companyId), usada pra resolver
  // o mapa/config certos sem round-trip extra ao banco (GET /office/guest-map,
  // branch de broadcast de POST /office/media-token).
  sectorId: ''
  companyId: string
  features: []
  guest: true
  name: string
  presetId: string
  inviteId: string
}
```

Trocar `issueOfficeGuestSession`:

```ts
export async function issueOfficeGuestSession(
  app: FastifyInstance,
  input: { token: string; name: string; presetId: string },
): Promise<OfficeGuestSessionDTO> {
  const invite = await getValidOfficeGuestInvite(input.token)
  const name = input.name.trim().slice(0, OFFICE_GUEST_NAME_MAX_LENGTH)
  if (!name) throw new OfficeGuestInviteError('Informe o nome do convidado')
  const preset = OFFICE_GUEST_CHARACTER_PRESETS.find((candidate) => candidate.id === input.presetId)
  if (!preset) throw new OfficeGuestInviteError('Personagem inválido')

  const expiresInSeconds = Math.max(1, Math.floor((invite.expiresAt.getTime() - Date.now()) / 1000))
  const guest = {
    id: `guest:${randomUUID()}`,
    name,
    presetId: preset.id,
    avatarSeed: preset.seed,
    avatarOptions: preset.options,
  }
  const payload: OfficeGuestJwtPayload = {
    sub: guest.id,
    role: 'GUEST',
    sectorId: '',
    companyId: invite.companyId,
    features: [],
    guest: true,
    name,
    presetId: preset.id,
    inviteId: invite.id,
  }

  return {
    token: app.jwt.sign(payload, { expiresIn: expiresInSeconds }),
    expiresAt: invite.expiresAt.toISOString(),
    guest,
  }
}
```

(`isOfficeGuestPayload` fica igual — não checa `companyId`, só `guest`/`role`/`sub`/`name`/
`presetId`.)

- [ ] **Step 4: Atualizar `office-guests.ts`**

Modify `apps/api/src/routes/office-guests.ts` — trocar o import (adicionar `isOfficeGuestPayload`)
e os 2 handlers que precisam de `companyId`:

```ts
import {
  OfficeGuestInviteError,
  createOfficeGuestInvite,
  getValidOfficeGuestInvite,
  isOfficeGuestPayload,
  issueOfficeGuestSession,
} from '../services/office-guest-service'
import { getActiveOfficeMap } from '../services/office-map-service'
```

```ts
  app.post('/admin/office-guest-invites', adminOnly, async (request, reply): Promise<CreateOfficeGuestInviteResponse | FastifyReply> => {
    const parsed = createInviteSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    const { invite, rawToken } = await createOfficeGuestInvite(request.user.sub, parsed.data.expiresInMinutes, request.user.companyId)
    return reply.code(201).send({
      invite: {
        id: invite.id,
        url: inviteUrl(request, rawToken),
        expiresAt: invite.expiresAt.toISOString(),
        createdAt: invite.createdAt.toISOString(),
      },
    })
  })
```

```ts
  app.get('/office/guest-map', async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? ''
    try {
      const payload = app.jwt.verify(token)
      if (!isOfficeGuestPayload(payload)) {
        return reply.code(401).send({ message: 'Não autorizado' })
      }
      return getActiveOfficeMap(payload.companyId)
    } catch {
      return reply.code(401).send({ message: 'Não autorizado' })
    }
  })
```

(as demais rotas do arquivo — `GET /office/guest-invites/:token`, `POST /office/guest-session`
— ficam inalteradas: `getValidOfficeGuestInvite`/`issueOfficeGuestSession` já foram atualizadas
no service, e a rota só repassa os mesmos argumentos de sempre.)

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/routes/office-guests.test.ts src/routes/office-feature-gate.test.ts`
Expected: PASS (todos os testes, incluindo o novo)

- [ ] **Step 6: Rodar tsc**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: erros só em `office-media.ts`/`admin.ts`/`office-ws.ts` e seus testes (Task 3 ainda
não despachada / sub-fatia 3). Nenhum erro em `office-guest-service.ts`, `office-guests.ts`,
`office-guests.test.ts` ou `office-feature-gate.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/office-guest-service.ts apps/api/src/routes/office-guests.ts apps/api/src/routes/office-guests.test.ts apps/api/src/routes/office-feature-gate.test.ts
git commit -m "feat: sessão de convidado carrega o companyId real do convite"
```

---

### Task 3: `office-media.ts` + `admin.ts` — media token, config e broadcast settings

**Files:**
- Modify: `apps/api/src/routes/office-media.ts`
- Modify: `apps/api/src/routes/office-media.test.ts`
- Modify: `apps/api/src/routes/admin.ts`

**Interfaces:**
- Consumes: `getOfficeSettings(companyId)`/`setBroadcastEnabled(broadcastEnabled, actorId, companyId)`
  (já existem desde a sub-fatia 1), `isOfficeGuestPayload`/`OfficeGuestJwtPayload.companyId` (Task 2),
  as funções de `office-map-service.ts` já escopadas (Task 1/sub-fatia 1).

- [ ] **Step 1: Escrever os testes falhando**

Modify `apps/api/src/routes/office-media.test.ts` — adicionar `companyId` nas 3 chamadas de
`setBroadcastEnabled(...)` (linhas do describe `'POST /office/media-token'` e
`'GET /office/config'`) e no bloco de fixture do describe de estabilidade de sala. Adicionar o
import de `DEFAULT_COMPANY_ID`:

```ts
import { OFFICE_BROADCAST_ROOM, createEmptyMapDocumentV1, officeRoomForMapPosition, DEFAULT_COMPANY_ID } from '@legends/shared'
```

Trocar as 3 ocorrências de `await setBroadcastEnabled(true, await createActorId())` por
`await setBroadcastEnabled(true, await createActorId(), DEFAULT_COMPANY_ID)` (uma no describe
`'ligado: líder recebe canPublish true; lenda recebe canPublish false'`, uma em `'ligado mas
fora do escritório: 409'`, uma em `'reflete o flag'`).

No describe `'POST /office/media-token — estabilidade da sala após publicar decoração'`,
substituir o bloco:

```ts
    const { id: mapId } = await createOfficeMap({ name: 'Mapa', width: 20, height: 20, tileSize: 48 }, admin.id, DEFAULT_COMPANY_ID)
    const doc = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 48 })
    const lock = await acquireOfficeMapLock(mapId, admin.id, DEFAULT_COMPANY_ID)
    const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId } })
    const saved = await saveOfficeMapDraft(mapId, { revision: draft.revision, document: doc }, admin.id, lock.lockToken, DEFAULT_COMPANY_ID)
    await publishOfficeMap(mapId, saved.revision, admin.id, true, DEFAULT_COMPANY_ID)

    const { user, token } = await createUserAndToken(app)
    officeHub.join(sink, { id: user.id, name: user.name, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null })
    const occ = officeHub.occupantOf(user.id)!

    const before = await getActiveOfficeMap(DEFAULT_COMPANY_ID)
    const roomBefore = officeRoomForMapPosition(before.map.id, before.document, occ.x, occ.y)

    // publica decoração inócua: mesmo map.id, novo publication.id
    const lock2 = await acquireOfficeMapLock(mapId, admin.id, DEFAULT_COMPANY_ID)
    const decorDoc = JSON.parse(JSON.stringify(before.document))
    const objects = decorDoc.layers.find((l: { key: string }) => l.key === 'objects')
    if (objects) objects.data[0] = null
    const savedDecor = await saveOfficeDecorationDraft(
      { revision: saved.revision, document: decorDoc },
      { id: admin.id, role: 'ADMIN' },
      lock2.lockToken,
      DEFAULT_COMPANY_ID,
    )
    await publishOfficeDecoration(savedDecor.revision, { id: admin.id, role: 'ADMIN' }, DEFAULT_COMPANY_ID)

    const after = await getActiveOfficeMap(DEFAULT_COMPANY_ID)
```

(o restante do teste, a partir de `expect(after.publication.id)...`, fica igual.)

Adicionar ao final do describe `'POST /office/media-token'` (antes do `})` que o fecha) o teste
adversarial de isolamento pro branch de broadcast:

```ts

  it('alto-falante ligado em uma empresa não libera em outra', async () => {
    await setBroadcastEnabled(true, await createActorId(), DEFAULT_COMPANY_ID)
    const app = buildApp()
    await app.ready()

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Media', slug: 'outra-empresa-media-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Media', slug: 'setor-outra-empresa-media-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherUser = await prisma.user.create({
      data: { name: 'OutraEmpresaMedia', email: 'outra-empresa-media@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id, sectorId: otherSector.id },
    })
    const otherToken = app.jwt.sign({ sub: otherUser.id, role: 'LEAD', sectorId: otherSector.id, companyId: otherCompany.id, features: ['escritorio'] })
    officeHub.join(sink, { id: otherUser.id, name: otherUser.name, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null })

    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { room: OFFICE_BROADCAST_ROOM },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/office-media.test.ts`
Expected: FAIL — erro de compilação (`office-media.ts` ainda chama `getOfficeSettings()` sem
`companyId`).

- [ ] **Step 3: Atualizar `office-media.ts`**

Modify `apps/api/src/routes/office-media.ts` — `resolveParticipant` passa a devolver
`companyId` (do usuário real via `request.user.companyId`, ou do convidado via
`payload.companyId`), e o branch de broadcast usa esse valor pra chamar `getOfficeSettings`:

```ts
  async function resolveParticipant(request: FastifyRequest, reply: FastifyReply) {
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? ''
    try {
      const payload = app.jwt.verify(bearer)
      if (isOfficeGuestPayload(payload)) return { sub: payload.sub, role: 'GUEST' as const, guest: true, companyId: payload.companyId }
    } catch {
      // cai para o fluxo normal de access token abaixo
    }
    try {
      await request.jwtVerify()
      if (request.user.role === 'THIRD_PARTY' && !(request.user.features ?? []).includes('escritorio')) {
        reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
        return null
      }
      return { sub: request.user.sub, role: request.user.role, guest: false, companyId: request.user.companyId }
    } catch {
      reply.code(401).send({ message: 'Não autorizado' })
      return null
    }
  }
```

Trocar a chamada de `getOfficeSettings` dentro de `POST /office/media-token`:

```ts
    if (parsed.data.room === OFFICE_BROADCAST_ROOM) {
      const { broadcastEnabled } = await getOfficeSettings(participant.companyId)
```

Trocar `GET /office/config`:

```ts
  app.get('/office/config', { onRequest: [app.authenticate, app.requireFeature('escritorio')] }, async (request): Promise<OfficeConfigDTO> => {
    return getOfficeSettings(request.user.companyId)
  })
```

- [ ] **Step 4: Atualizar `admin.ts`**

Modify `apps/api/src/routes/admin.ts` — os 2 call-sites de `/admin/office-settings`:

```ts
  app.get('/admin/office-settings', adminOnly, async (request) => {
    return getOfficeSettings(request.user.companyId)
  })

  app.patch('/admin/office-settings', adminOnly, async (request, reply) => {
    const parsed = officeSettingsSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    return setBroadcastEnabled(parsed.data.broadcastEnabled, request.user.sub, request.user.companyId)
  })
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/routes/office-media.test.ts src/routes/admin.office-settings.test.ts`
Expected: PASS (todos os testes, incluindo o novo teste adversarial)

- [ ] **Step 6: Rodar tsc**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: erros só em `office-ws.ts`/`office-ws.test.ts` (sub-fatia 3, fora de escopo desta
fatia inteira). Nenhum erro em `office-media.ts`, `admin.ts`, ou qualquer teste tocado até aqui.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/office-media.ts apps/api/src/routes/office-media.test.ts apps/api/src/routes/admin.ts
git commit -m "feat: repassa companyId em office-media.ts e /admin/office-settings"
```

---

### Task 4: Verificação final

**Files:** nenhum (só execução de comandos)

- [ ] **Step 1: Suíte completa de todos os workspaces**

Run: `pnpm test`
Expected: PASS em `@legends/shared`, `@legends/api`, `@legends/web`. Falhas aceitáveis: as
flakes pré-existentes já documentadas nas fatias anteriores
(`apps/web/src/App.third-party-route.test.tsx`, `apps/api/src/services/office-map-service.test.ts`
por colisão de `Date.now()`), e qualquer falha em `office-ws.test.ts` (sub-fatia 3, ainda
esperando o particionamento do `officeHub` — fora de escopo desta fatia inteira). Qualquer outra
falha precisa ser investigada antes de prosseguir.

- [ ] **Step 2: Typecheck por workspace**

Run:
```bash
pnpm --filter @legends/api exec tsc --noEmit
pnpm --filter @legends/web exec tsc --noEmit
pnpm --filter @legends/shared exec tsc --noEmit
```
Expected: erros só em `office-ws.ts`/`office-ws.test.ts` no workspace `@legends/api` (sub-fatia
3). Sem erros nos outros 2 workspaces.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: sucesso em todos os workspaces (build não faz typecheck do `office-ws.ts`
isoladamente do jeito que `tsc --noEmit` faz — se falhar por causa dele, é sinal de que o gap é
maior do que o esperado; documentar e escalar antes de finalizar a fatia).
