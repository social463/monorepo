# Escritório — Alto-falante Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Liderança fala para o escritório inteiro (atravessando salas) por uma sala LiveKit de broadcast; interruptor global no painel do admin controla se a feature (e seu custo — uma conexão extra por cliente) existe.

**Architecture:** Sala `office-broadcast` permanente: todo cliente conecta como ouvinte, só liderança recebe `canPublish` no token (imposição no servidor LiveKit). O flag `broadcastEnabled` persiste numa tabela nova (`OfficeSetting`, linha única, default OFF): desligado ⇒ API recusa o token (403) e o front nem abre a conexão. No front, um hook novo (`useOfficeBroadcast`) com ciclo de vida próprio; o `useOfficeMedia` existente só ganha `applyMicEnabled` para o "voz sai SÓ pelo alto-falante".

**Tech Stack:** Prisma (migration nova), Fastify, LiveKit (`livekit-server-sdk` grants), React 18 + React Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-escritorio-alto-falante-design.md`

## Global Constraints

- TypeScript **strict**, ESM. Mensagens ao usuário em **português**. Rotas finas, regra em service.
- Alto-falante é de **liderança** (`isLeaderRole`: LEAD/MANAGER/HEAD) — role vem do **JWT**, nunca do body. Esconder botão é cosmético; a fronteira é o grant `canPublish` do token.
- Flag do admin: default **OFF**; desligado ⇒ 403 no token de broadcast **e** nenhuma conexão aberta pelo front (fail-closed se `GET /office/config` falhar).
- Enquanto o alto-falante está ligado, o mic local fica silenciado (e o botão de mic desabilitado); ao desligar, restaura o estado anterior.
- Broadcast tem ciclo de vida independente: sobrevive à troca de sala por posição; falha nele não afeta a mídia de localização.
- Migration nova via prisma (nunca editar aplicada). Testes da API exigem Postgres (`pnpm db:up`).
- Falha PRÉ-EXISTENTE conhecida, fora de escopo: `apps/web/src/pages/ProfilePage.test.tsx` (2 testes).
- Branch: `feat/escritorio-alto-falante` (criada, spec commitado).

---

### Task 1: Dado & contrato — `OfficeSetting`, service e constantes

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model novo ao final)
- Create: migration via prisma (gerada, não escrita à mão)
- Create: `apps/api/src/services/office-setting-service.ts`
- Create: `apps/api/src/services/office-setting-service.test.ts`
- Modify: `packages/shared/src/office-media.ts` (constante + DTO)

**Interfaces:**
- Produces: model `OfficeSetting { id Int @id @default(1), broadcastEnabled Boolean @default(false), updatedAt DateTime @updatedAt }`; `getOfficeSettings(): Promise<OfficeConfigDTO>`; `setBroadcastEnabled(value: boolean): Promise<OfficeConfigDTO>`; `OFFICE_BROADCAST_ROOM = 'office-broadcast'`; `interface OfficeConfigDTO { broadcastEnabled: boolean }`.

- [ ] **Step 1: Schema + migration**

Ao final de `apps/api/prisma/schema.prisma`:

```prisma
// Configurações globais do escritório virtual (linha única, id = 1).
// broadcastEnabled é o interruptor de CUSTO do alto-falante: desligado,
// nenhum cliente abre a conexão LiveKit extra de broadcast.
model OfficeSetting {
  id               Int      @id @default(1)
  broadcastEnabled Boolean  @default(false)
  updatedAt        DateTime @updatedAt
}
```

```bash
pnpm --filter @legends/api exec prisma migrate dev --name office-setting-broadcast
pnpm db:generate
```

- [ ] **Step 2: Contrato no shared**

Ao final de `packages/shared/src/office-media.ts`:

```ts
/** Sala LiveKit do alto-falante — todos ouvem, só liderança publica. */
export const OFFICE_BROADCAST_ROOM = "office-broadcast";

/** Config do escritório lida pelo front ao montar a página. */
export interface OfficeConfigDTO {
  broadcastEnabled: boolean;
}
```

- [ ] **Step 3: Teste falhando do service**

`apps/api/src/services/office-setting-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getOfficeSettings, setBroadcastEnabled } from './office-setting-service'

describe('office-setting-service', () => {
  it('sem linha no banco, o default é desligado', async () => {
    expect(await getOfficeSettings()).toEqual({ broadcastEnabled: false })
  })

  it('liga, persiste e lê de volta', async () => {
    expect(await setBroadcastEnabled(true)).toEqual({ broadcastEnabled: true })
    expect(await getOfficeSettings()).toEqual({ broadcastEnabled: true })
  })

  it('desligar de novo é idempotente (upsert da linha única)', async () => {
    await setBroadcastEnabled(true)
    await setBroadcastEnabled(false)
    await setBroadcastEnabled(false)
    expect(await getOfficeSettings()).toEqual({ broadcastEnabled: false })
  })
})
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test src/services/office-setting-service.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 5: Implementar o service**

`apps/api/src/services/office-setting-service.ts`:

```ts
import type { OfficeConfigDTO } from '@legends/shared'
import { prisma } from '../lib/prisma'

/**
 * Config global do escritório — linha única (id = 1), criada on-demand.
 * `broadcastEnabled` é o interruptor de custo do alto-falante.
 */
export async function getOfficeSettings(): Promise<OfficeConfigDTO> {
  const row = await prisma.officeSetting.findUnique({ where: { id: 1 } })
  return { broadcastEnabled: row?.broadcastEnabled ?? false }
}

export async function setBroadcastEnabled(broadcastEnabled: boolean): Promise<OfficeConfigDTO> {
  const row = await prisma.officeSetting.upsert({
    where: { id: 1 },
    create: { id: 1, broadcastEnabled },
    update: { broadcastEnabled },
  })
  return { broadcastEnabled: row.broadcastEnabled }
}
```

- [ ] **Step 6: Rodar e ver passar (service + shared + hub, pois o schema mudou)**

```bash
pnpm --filter @legends/api test src/services/office-setting-service.test.ts
pnpm --filter @legends/shared test
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma packages/shared/src/office-media.ts apps/api/src/services/office-setting-service.ts apps/api/src/services/office-setting-service.test.ts
git commit -m "feat(api,shared): OfficeSetting com flag do alto-falante (default off)"
```

---

### Task 2: API de mídia — token de broadcast + `GET /office/config`

**Files:**
- Modify: `apps/api/src/routes/office-media.ts`
- Modify: `apps/api/src/routes/office-media.test.ts` (casos novos; os existentes não mudam)

**Interfaces:**
- Consumes: `getOfficeSettings` (task 1); `OFFICE_BROADCAST_ROOM`, `OfficeConfigDTO`, `isLeaderRole` de `@legends/shared`; `officeHub`, `AccessToken` (já usados no arquivo).
- Produces: `POST /office/media-token` aceita `room: 'office-broadcast'` (403 flag off / 409 fora do escritório / 200 com `canPublish` por role); `GET /office/config` → `OfficeConfigDTO` (autenticada).

- [ ] **Step 1: Testes falhando (adicionar ao arquivo existente)**

Acrescentar a `apps/api/src/routes/office-media.test.ts` (o helper `createUserAndToken`, `decodeJwtPayload`, `sink` e o `beforeEach` com `officeHub.reset()` já existem; adicionar um parâmetro de role ao helper se ainda não houver — `role: 'LEGEND' | 'LEAD' = 'LEGEND'` aplicado no `prisma.user.create` e no `app.jwt.sign`):

```ts
import { setBroadcastEnabled } from '../services/office-setting-service'
import { OFFICE_BROADCAST_ROOM } from '@legends/shared'

describe('POST /office/media-token — office-broadcast', () => {
  it('403 quando o alto-falante está desligado (default), mesmo para líder no escritório', async () => {
    const app = buildApp()
    await app.ready()
    const { user, token } = await createUserAndToken(app, 'LEAD')
    officeHub.join(sink, { id: user.id, name: user.name, avatarOptions: null })
    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { room: OFFICE_BROADCAST_ROOM },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('ligado: líder recebe canPublish true; lenda recebe canPublish false', async () => {
    await setBroadcastEnabled(true)
    const app = buildApp()
    await app.ready()

    const lead = await createUserAndToken(app, 'LEAD')
    officeHub.join(sink, { id: lead.user.id, name: lead.user.name, avatarOptions: null })
    const leadRes = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${lead.token}` },
      payload: { room: OFFICE_BROADCAST_ROOM },
    })
    expect(leadRes.statusCode).toBe(200)
    const leadGrant = decodeJwtPayload((leadRes.json() as { token: string }).token)
    expect(leadGrant.video).toMatchObject({
      roomJoin: true,
      room: OFFICE_BROADCAST_ROOM,
      canPublish: true,
      canSubscribe: true,
    })

    const legend = await createUserAndToken(app, 'LEGEND')
    officeHub.join(sink, { id: legend.user.id, name: legend.user.name, avatarOptions: null })
    const legendRes = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${legend.token}` },
      payload: { room: OFFICE_BROADCAST_ROOM },
    })
    expect(legendRes.statusCode).toBe(200)
    const legendGrant = decodeJwtPayload((legendRes.json() as { token: string }).token)
    expect(legendGrant.video).toMatchObject({ canPublish: false, canSubscribe: true })
    await app.close()
  })

  it('ligado mas fora do escritório: 409', async () => {
    await setBroadcastEnabled(true)
    const app = buildApp()
    await app.ready()
    const { token } = await createUserAndToken(app, 'LEAD')
    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { room: OFFICE_BROADCAST_ROOM },
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })
})

describe('GET /office/config', () => {
  it('exige autenticação', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/office/config' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('reflete o flag', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await createUserAndToken(app)
    const off = await app.inject({
      method: 'GET',
      url: '/office/config',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(off.json()).toEqual({ broadcastEnabled: false })

    await setBroadcastEnabled(true)
    const on = await app.inject({
      method: 'GET',
      url: '/office/config',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(on.json()).toEqual({ broadcastEnabled: true })
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api test src/routes/office-media.test.ts`
Expected: FAIL — broadcast cai na checagem de zona (403 com flag ligado seria o certo p/ zona, mas `canPublish` e `GET /office/config` não existem).

- [ ] **Step 3: Implementar**

Em `apps/api/src/routes/office-media.ts`:

1. imports: adicionar `OFFICE_BROADCAST_ROOM`, `isLeaderRole`, `type OfficeConfigDTO` ao import de `@legends/shared` e `import { getOfficeSettings } from '../services/office-setting-service'`.
2. dentro do handler do token, logo APÓS o `safeParse` e ANTES do `occupantOf` atual, inserir o caso especial:

```ts
    // Alto-falante: sala global, sem checagem de zona. O interruptor do admin
    // é a primeira barreira (custo); o grant canPublish é a segunda (só
    // liderança fala — imposto pelo próprio servidor LiveKit).
    if (parsed.data.room === OFFICE_BROADCAST_ROOM) {
      const { broadcastEnabled } = await getOfficeSettings()
      if (!broadcastEnabled) {
        return reply.code(403).send({ message: 'O alto-falante está desativado' })
      }
      const occupant = officeHub.occupantOf(request.user.sub)
      if (!occupant) {
        return reply.code(409).send({ message: 'Entre no escritório antes de conectar a mídia' })
      }
      const accessToken = new AccessToken(livekit.apiKey, livekit.apiSecret, {
        identity: occupant.userId,
        name: occupant.name,
        ttl: '5m',
      })
      accessToken.addGrant({
        roomJoin: true,
        room: OFFICE_BROADCAST_ROOM,
        canSubscribe: true,
        canPublish: isLeaderRole(request.user.role),
      })
      const response: OfficeMediaTokenResponse = {
        token: await accessToken.toJwt(),
        url: livekit.url,
      }
      return reply.send(response)
    }
```

3. no mesmo `officeMediaRoutes`, registrar a rota de config:

```ts
  app.get('/office/config', { onRequest: [app.authenticate] }, async (): Promise<OfficeConfigDTO> => {
    return getOfficeSettings()
  })
```

- [ ] **Step 4: Rodar e ver passar (arquivo inteiro — os testes antigos de zona não mudam)**

Run: `pnpm --filter @legends/api test src/routes/office-media.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/office-media.ts apps/api/src/routes/office-media.test.ts
git commit -m "feat(api): token do alto-falante (canPublish por role) e GET /office/config"
```

---

### Task 3: API admin — `GET`/`PATCH /admin/office-settings`

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (dois endpoints, padrão `adminOnly` existente — espelhar `PATCH /admin/development-thursday/settings`)
- Create: `apps/api/src/routes/admin.office-settings.test.ts`

**Interfaces:**
- Consumes: `getOfficeSettings`/`setBroadcastEnabled` (task 1).
- Produces: `GET /admin/office-settings` → `OfficeConfigDTO`; `PATCH /admin/office-settings` `{ broadcastEnabled: boolean }` → `OfficeConfigDTO`; 401 sem token, 403 não-admin, 400 body inválido.

- [ ] **Step 1: Teste falhando**

`apps/api/src/routes/admin.office-settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function makeUser(app: ReturnType<typeof buildApp>, role: 'ADMIN' | 'LEGEND') {
  const user = await prisma.user.create({
    data: { name: role, email: `${role.toLowerCase()}@x.com`, passwordHash: 'x', role },
  })
  return app.jwt.sign({ sub: user.id, role })
}

describe('/admin/office-settings', () => {
  it('exige admin (401 sem token, 403 para lenda)', async () => {
    const app = buildApp()
    await app.ready()
    expect((await app.inject({ method: 'GET', url: '/admin/office-settings' })).statusCode).toBe(401)
    const legend = await makeUser(app, 'LEGEND')
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/office-settings',
      headers: { authorization: `Bearer ${legend}` },
      payload: { broadcastEnabled: true },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('admin liga, o GET reflete e persiste', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    const before = await app.inject({
      method: 'GET', url: '/admin/office-settings', headers: { authorization: `Bearer ${admin}` },
    })
    expect(before.json()).toEqual({ broadcastEnabled: false })

    const patch = await app.inject({
      method: 'PATCH',
      url: '/admin/office-settings',
      headers: { authorization: `Bearer ${admin}` },
      payload: { broadcastEnabled: true },
    })
    expect(patch.statusCode).toBe(200)
    expect(patch.json()).toEqual({ broadcastEnabled: true })

    const after = await app.inject({
      method: 'GET', url: '/admin/office-settings', headers: { authorization: `Bearer ${admin}` },
    })
    expect(after.json()).toEqual({ broadcastEnabled: true })
    await app.close()
  })

  it('400 com body inválido', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/office-settings',
      headers: { authorization: `Bearer ${admin}` },
      payload: { broadcastEnabled: 'sim' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test src/routes/admin.office-settings.test.ts`
Expected: FAIL — 404 nas rotas.

- [ ] **Step 3: Implementar em `admin.ts`**

Junto dos demais endpoints (usar o `adminOnly` já definido no arquivo); import do service no topo:

```ts
import { getOfficeSettings, setBroadcastEnabled } from '../services/office-setting-service'

const officeSettingsSchema = z.object({ broadcastEnabled: z.boolean() })
```

```ts
  app.get('/admin/office-settings', adminOnly, async () => {
    return getOfficeSettings()
  })

  app.patch('/admin/office-settings', adminOnly, async (request, reply) => {
    const parsed = officeSettingsSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    return setBroadcastEnabled(parsed.data.broadcastEnabled)
  })
```

- [ ] **Step 4: Rodar e ver passar (arquivo novo + suite do admin existente)**

```bash
pnpm --filter @legends/api test src/routes/admin.office-settings.test.ts src/routes/admin.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.office-settings.test.ts
git commit -m "feat(api): interruptor do alto-falante no admin (GET/PATCH office-settings)"
```

---

### Task 4: Web — `applyMicEnabled` no `useOfficeMedia` + hook `useOfficeBroadcast`

**Files:**
- Modify: `apps/web/src/office/media/useOfficeMedia.ts` (só adiciona um método)
- Modify: `apps/web/src/office/media/useOfficeMedia.test.ts` (1 caso novo)
- Create: `apps/web/src/office/media/useOfficeBroadcast.ts`
- Create: `apps/web/src/office/media/useOfficeBroadcast.test.ts`

**Interfaces:**
- Consumes: `OFFICE_BROADCAST_ROOM`, `OfficeMediaTokenResponse` de `@legends/shared`; `apiFetch`; `livekit-client`.
- Produces: `OfficeMediaState` ganha `applyMicEnabled(enabled: boolean): Promise<void>`; `useOfficeBroadcast(opts: { enabled: boolean; micEnabled: boolean; setMicEnabled: (enabled: boolean) => Promise<void>; youName: string | null }): OfficeBroadcastState` com `OfficeBroadcastState = { available: boolean; speakerEnabled: boolean; speakerError: boolean; speakers: string[]; broadcastTracks: RemoteAudioTrack[]; toggleSpeaker(): Promise<void> }`.

- [ ] **Step 1: `applyMicEnabled` no `useOfficeMedia` (teste primeiro)**

Adicionar ao `useOfficeMedia.test.ts` (usa a infra de fakes existente do arquivo):

```ts
  it('applyMicEnabled força mute/unmute do track local e é no-op sem track', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    const track = room.localParticipant.published[0]
    expect(track.isMuted).toBe(true)

    await act(async () => { await result.current.applyMicEnabled(true) })
    expect(track.isMuted).toBe(false)
    expect(result.current.micEnabled).toBe(true)

    await act(async () => { await result.current.applyMicEnabled(false) })
    expect(track.isMuted).toBe(true)
    expect(result.current.micEnabled).toBe(false)

    // idempotente: aplicar o estado atual não lança nem alterna
    await act(async () => { await result.current.applyMicEnabled(false) })
    expect(track.isMuted).toBe(true)
  })
```

Rodar e ver FALHAR (`applyMicEnabled is not a function`). Implementar em `useOfficeMedia.ts`: adicionar à interface `OfficeMediaState` a linha `applyMicEnabled(enabled: boolean): Promise<void>`, e no corpo (junto dos outros callbacks):

```ts
  /**
   * Força o estado do mic local — usado pelo alto-falante ("voz sai SÓ pelo
   * alto-falante" ⇒ silencia aqui ao ligar, restaura ao desligar). Sem track
   * (permissão negada), é no-op: não há o que silenciar.
   */
  const applyMicEnabled = useCallback(async (enabled: boolean) => {
    const track = micTrackRef.current
    if (!track) return
    if (enabled && track.isMuted) {
      await track.unmute()
      setMicEnabled(true)
    } else if (!enabled && !track.isMuted) {
      await track.mute()
      setMicEnabled(false)
    }
  }, [])
```

Incluir `applyMicEnabled` no objeto de retorno. Rodar e ver PASSAR (suíte inteira do arquivo).

- [ ] **Step 2: Teste falhando do `useOfficeBroadcast`**

`apps/web/src/office/media/useOfficeBroadcast.test.ts` (mesmo estilo de fakes do teste do `useOfficeMedia` — `vi.hoisted` para a classe do Room; o mock de `livekit-client` precisa de `createLocalAudioTrack`, `Room`, `RoomEvent`, `Track`):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))

const { FakeRoom, FakeParticipant, FakeTrack, createLocalAudioTrackMock } = vi.hoisted(() => {
  class FakeTrack {
    isMuted = false
    stopped = false
    async mute() { this.isMuted = true; return this }
    async unmute() { this.isMuted = false; return this }
    stop() { this.stopped = true }
  }
  class FakeLocalParticipant {
    published: FakeTrack[] = []
    async publishTrack(track: FakeTrack) {
      if (FakeRoom.rejectPublish) throw new Error('not allowed to publish')
      this.published.push(track)
    }
    async unpublishTrack(track: FakeTrack) {
      this.published = this.published.filter((t) => t !== track)
    }
  }
  class FakeParticipant {
    trackPublications = new Map<string, { source: string; isSubscribed: boolean; track: unknown }>()
    constructor(public identity: string, public name: string) {}
  }
  class FakeRoom {
    static instances: FakeRoom[] = []
    static rejectPublish = false
    handlers = new Map<string, Array<() => void>>()
    remoteParticipants = new Map<string, FakeParticipant>()
    localParticipant = new FakeLocalParticipant()
    connectCalls: Array<{ url: string; token: string; opts: { autoSubscribe: boolean } }> = []
    disconnected = false
    constructor() { FakeRoom.instances.push(this) }
    on(event: string, handler: () => void) {
      const list = this.handlers.get(event) ?? []
      list.push(handler)
      this.handlers.set(event, list)
      return this
    }
    emit(event: string) { for (const h of this.handlers.get(event) ?? []) h() }
    async connect(url: string, token: string, opts: { autoSubscribe: boolean }) {
      this.connectCalls.push({ url, token, opts })
    }
    async disconnect() { this.disconnected = true }
  }
  const createLocalAudioTrackMock = vi.fn(async (..._args: unknown[]) => new FakeTrack())
  return { FakeRoom, FakeParticipant, FakeTrack, createLocalAudioTrackMock }
})

vi.mock('livekit-client', () => ({
  Room: FakeRoom,
  RoomEvent: {
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    TrackPublished: 'trackPublished',
    TrackUnpublished: 'trackUnpublished',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
  },
  Track: { Source: { Microphone: 'microphone', Camera: 'camera', ScreenShare: 'screen_share' } },
  createLocalAudioTrack: (...args: unknown[]) => createLocalAudioTrackMock(...args),
}))

import { useOfficeBroadcast } from './useOfficeBroadcast'

function makeOpts(overrides: Partial<Parameters<typeof useOfficeBroadcast>[0]> = {}) {
  return {
    enabled: true,
    micEnabled: false,
    setMicEnabled: vi.fn(async () => {}),
    youName: 'Você',
    ...overrides,
  }
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeRoom.instances = []
  FakeRoom.rejectPublish = false
  apiFetchMock.mockReset()
  createLocalAudioTrackMock.mockClear()
  apiFetchMock.mockResolvedValue({ token: 'tk-broadcast', url: 'ws://livekit.test' })
})
afterEach(() => { vi.useRealTimers() })

describe('useOfficeBroadcast', () => {
  it('desligado (flag/escritório), NÃO abre conexão nenhuma — é o interruptor de custo', async () => {
    renderHook(() => useOfficeBroadcast(makeOpts({ enabled: false })))
    await flush()
    expect(apiFetchMock).not.toHaveBeenCalled()
    expect(FakeRoom.instances).toHaveLength(0)
  })

  it('ligado, conecta na sala de broadcast com autoSubscribe', async () => {
    const { result } = renderHook(() => useOfficeBroadcast(makeOpts()))
    await flush()
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/office/media-token',
      expect.objectContaining({ body: JSON.stringify({ room: 'office-broadcast' }) }),
    )
    const room = FakeRoom.instances.at(-1)!
    expect(room.connectCalls[0].opts.autoSubscribe).toBe(true)
    expect(result.current.available).toBe(true)
  })

  it('toggleSpeaker liga: publica desmutado no broadcast e silencia o mic local; desliga: restaura', async () => {
    const setMicEnabled = vi.fn(async () => {})
    const { result } = renderHook(() => useOfficeBroadcast(makeOpts({ micEnabled: true, setMicEnabled })))
    await flush()
    const room = FakeRoom.instances.at(-1)!

    await act(async () => { await result.current.toggleSpeaker() })
    expect(room.localParticipant.published).toHaveLength(1)
    expect(room.localParticipant.published[0].isMuted).toBe(false)
    expect(setMicEnabled).toHaveBeenLastCalledWith(false)
    expect(result.current.speakerEnabled).toBe(true)
    expect(result.current.speakers).toContain('Você')

    await act(async () => { await result.current.toggleSpeaker() })
    expect(room.localParticipant.published).toHaveLength(0)
    expect(setMicEnabled).toHaveBeenLastCalledWith(true) // estava desmutado antes → restaura desmutado
    expect(result.current.speakerEnabled).toBe(false)
    expect(result.current.speakers).not.toContain('Você')
  })

  it('mic estava mutado antes → ao desligar o alto-falante, restaura MUTADO', async () => {
    const setMicEnabled = vi.fn(async () => {})
    const { result } = renderHook(() => useOfficeBroadcast(makeOpts({ micEnabled: false, setMicEnabled })))
    await flush()
    await act(async () => { await result.current.toggleSpeaker() })
    await act(async () => { await result.current.toggleSpeaker() })
    expect(setMicEnabled).toHaveBeenLastCalledWith(false)
  })

  it('publicação rejeitada pelo servidor (sem canPublish) vira speakerError, sem mexer no mic', async () => {
    FakeRoom.rejectPublish = true
    const setMicEnabled = vi.fn(async () => {})
    const { result } = renderHook(() => useOfficeBroadcast(makeOpts({ setMicEnabled })))
    await flush()
    await act(async () => { await result.current.toggleSpeaker() })
    expect(result.current.speakerError).toBe(true)
    expect(result.current.speakerEnabled).toBe(false)
    expect(setMicEnabled).not.toHaveBeenCalled()
  })

  it('speakers/broadcastTracks refletem participantes remotos com áudio publicado', async () => {
    const { result } = renderHook(() => useOfficeBroadcast(makeOpts()))
    await flush()
    const room = FakeRoom.instances.at(-1)!
    const speaker = new FakeParticipant('lead-1', 'Guilherme')
    speaker.trackPublications.set('a', { source: 'microphone', isSubscribed: true, track: new FakeTrack() })
    room.remoteParticipants.set('lead-1', speaker)
    act(() => room.emit('trackPublished'))
    expect(result.current.speakers).toEqual(['Guilherme'])
    expect(result.current.broadcastTracks).toHaveLength(1)

    room.remoteParticipants.delete('lead-1')
    act(() => room.emit('participantDisconnected'))
    expect(result.current.speakers).toEqual([])
  })

  it('falha no token tenta de novo com backoff, sem afetar nada além do broadcast', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('flag desligado no meio do caminho'))
    const { result } = renderHook(() => useOfficeBroadcast(makeOpts()))
    await flush()
    expect(result.current.available).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(result.current.available).toBe(true)
  })

  it('unmount desconecta e não deixa retry vivo', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('x'))
    const { unmount } = renderHook(() => useOfficeBroadcast(makeOpts()))
    await flush()
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(FakeRoom.instances.every((r) => r.disconnected || r.connectCalls.length === 0)).toBe(true)
    expect(apiFetchMock).toHaveBeenCalledTimes(1) // nenhum retry pós-unmount
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test src/office/media/useOfficeBroadcast.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar o hook**

`apps/web/src/office/media/useOfficeBroadcast.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type LocalAudioTrack,
  type RemoteAudioTrack,
} from 'livekit-client'
import { OFFICE_BROADCAST_ROOM, type OfficeMediaTokenResponse } from '@legends/shared'
import { apiFetch } from '../../lib/api'

const MAX_RETRY_MS = 15000

export interface OfficeBroadcastState {
  /** Conexão de broadcast de pé (flag do admin ligado + escritório conectado). */
  available: boolean
  speakerEnabled: boolean
  speakerError: boolean
  /** Nomes de quem está no alto-falante agora (inclui você quando no ar). */
  speakers: string[]
  /** Tracks remotos de áudio do broadcast, para a UI anexar. */
  broadcastTracks: RemoteAudioTrack[]
  toggleSpeaker(): Promise<void>
}

/**
 * Conexão PERMANENTE à sala de broadcast (`office-broadcast`) — o alto-falante
 * do escritório. Ciclo de vida independente da sala de localização: sobrevive
 * às trocas por posição, e falha aqui nunca derruba a mídia de proximidade.
 * Com `enabled: false` (interruptor de custo do admin, ou escritório fora),
 * NENHUMA conexão é aberta.
 *
 * A permissão de falar é do SERVIDOR: o token de liderança vem com canPublish
 * e o de todo o resto sem — publicar sem grant é rejeitado pelo LiveKit e
 * vira `speakerError` aqui.
 */
export function useOfficeBroadcast(opts: {
  enabled: boolean
  micEnabled: boolean
  setMicEnabled: (enabled: boolean) => Promise<void>
  youName: string | null
}): OfficeBroadcastState {
  const { enabled } = opts
  const [available, setAvailable] = useState(false)
  const [speakerEnabled, setSpeakerEnabled] = useState(false)
  const [speakerError, setSpeakerError] = useState(false)
  const [speakers, setSpeakers] = useState<string[]>([])
  const [broadcastTracks, setBroadcastTracks] = useState<RemoteAudioTrack[]>([])

  const roomRef = useRef<Room | null>(null)
  const trackRef = useRef<LocalAudioTrack | null>(null)
  /** Estado do mic local ANTES de ligar o alto-falante — restaurado ao desligar. */
  const prevMicRef = useRef(false)
  const speakerEnabledRef = useRef(false)
  const generationRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Refs-espelho: toggleSpeaker lê valores atuais sem virar dependência de efeito.
  const micEnabledRef = useRef(opts.micEnabled)
  micEnabledRef.current = opts.micEnabled
  const setMicEnabledRef = useRef(opts.setMicEnabled)
  setMicEnabledRef.current = opts.setMicEnabled
  const youNameRef = useRef(opts.youName)
  youNameRef.current = opts.youName

  /** Reconstrói speakers/tracks do que está publicado na sala agora. */
  const syncBroadcast = useCallback(() => {
    const room = roomRef.current
    if (!room) {
      setSpeakers([])
      setBroadcastTracks([])
      return
    }
    const names: string[] = []
    const tracks: RemoteAudioTrack[] = []
    for (const participant of room.remoteParticipants.values()) {
      for (const pub of participant.trackPublications.values()) {
        if (pub.source !== Track.Source.Microphone) continue
        names.push(participant.name ?? participant.identity)
        if (pub.isSubscribed && pub.track) tracks.push(pub.track as RemoteAudioTrack)
      }
    }
    if (speakerEnabledRef.current && youNameRef.current) names.push(youNameRef.current)
    setSpeakers(names)
    setBroadcastTracks(tracks)
  }, [])

  useEffect(() => {
    if (!enabled) return

    let attempts = 0
    const connect = async () => {
      const gen = ++generationRef.current
      try {
        const { token, url } = await apiFetch<OfficeMediaTokenResponse>('/office/media-token', {
          method: 'POST',
          body: JSON.stringify({ room: OFFICE_BROADCAST_ROOM }),
        })
        if (generationRef.current !== gen) return
        const room = new Room()
        room
          .on(RoomEvent.ParticipantConnected, syncBroadcast)
          .on(RoomEvent.ParticipantDisconnected, syncBroadcast)
          .on(RoomEvent.TrackPublished, syncBroadcast)
          .on(RoomEvent.TrackUnpublished, syncBroadcast)
          .on(RoomEvent.TrackSubscribed, syncBroadcast)
          .on(RoomEvent.TrackUnsubscribed, syncBroadcast)
        await room.connect(url, token, { autoSubscribe: true })
        if (generationRef.current !== gen) {
          void room.disconnect()
          return
        }
        roomRef.current = room
        attempts = 0
        setAvailable(true)
        setSpeakerError(false)
        syncBroadcast()
      } catch {
        if (generationRef.current !== gen) return
        setAvailable(false)
        attempts += 1
        retryTimerRef.current = setTimeout(() => {
          if (generationRef.current !== gen) return
          void connect()
        }, Math.min(1000 * 2 ** attempts, MAX_RETRY_MS))
      }
    }
    void connect()

    return () => {
      // Invalida continuações em voo e retries agendados antes de derrubar.
      generationRef.current += 1
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      void roomRef.current?.disconnect()
      roomRef.current = null
      trackRef.current = null
      speakerEnabledRef.current = false
      setSpeakerEnabled(false)
      setAvailable(false)
      setSpeakers([])
      setBroadcastTracks([])
    }
  }, [enabled, syncBroadcast])

  const toggleSpeaker = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    if (!speakerEnabledRef.current) {
      try {
        const track = await createLocalAudioTrack()
        // Publica DESMUTADO — ligar o alto-falante é o ato de falar. Se o
        // token não tem canPublish (não-liderança adulterada), o servidor
        // rejeita e caímos no catch sem tocar no mic local.
        await room.localParticipant.publishTrack(track)
        trackRef.current = track
        prevMicRef.current = micEnabledRef.current
        await setMicEnabledRef.current(false)
        speakerEnabledRef.current = true
        setSpeakerEnabled(true)
        setSpeakerError(false)
        syncBroadcast()
      } catch {
        setSpeakerError(true)
      }
      return
    }
    const track = trackRef.current
    if (track) {
      await room.localParticipant.unpublishTrack(track)
      track.stop()
      trackRef.current = null
    }
    speakerEnabledRef.current = false
    setSpeakerEnabled(false)
    await setMicEnabledRef.current(prevMicRef.current)
    syncBroadcast()
  }, [syncBroadcast])

  return { available, speakerEnabled, speakerError, speakers, broadcastTracks, toggleSpeaker }
}
```

- [ ] **Step 5: Rodar e ver passar**

```bash
pnpm --filter @legends/web test src/office/media/
npx tsc -p apps/web/tsconfig.json --noEmit
```
Expected: PASS (arquivos novos + antigos), tsc limpo.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/media/useOfficeMedia.ts apps/web/src/office/media/useOfficeMedia.test.ts apps/web/src/office/media/useOfficeBroadcast.ts apps/web/src/office/media/useOfficeBroadcast.test.ts
git commit -m "feat(web): hook do alto-falante (broadcast) e applyMicEnabled"
```

---

### Task 5: Web — botão, banner, página e painel do admin

**Files:**
- Create: `apps/web/src/office/media/RemoteAudio.tsx` (extraído do MediaTiles)
- Modify: `apps/web/src/office/media/MediaTiles.tsx` (importa `RemoteAudio` em vez da definição local)
- Modify: `apps/web/src/office/media/MediaBar.tsx` + `MediaBar.test.tsx`
- Create: `apps/web/src/office/media/BroadcastBanner.tsx`
- Modify: `apps/web/src/pages/OfficePage.tsx` + `OfficePage.test.tsx`
- Create: `apps/web/src/pages/admin/OfficeSection.tsx` + `OfficeSection.test.tsx`
- Modify: `apps/web/src/pages/admin/TabBar.tsx` (aba nova) e `apps/web/src/pages/AdminPage.tsx` (renderiza a seção)

**Interfaces:**
- Consumes: `useOfficeBroadcast`/`OfficeBroadcastState` (task 4); `OfficeConfigDTO`, `isLeaderRole` de `@legends/shared`; `useAuth`; React Query (padrão das sections do admin).
- Produces: `MediaBar({ media, zoneName, broadcast, canBroadcast })`; `BroadcastBanner({ speakers, tracks })`; aba "Escritório" no admin.

- [ ] **Step 1: Extrair `RemoteAudio`**

`apps/web/src/office/media/RemoteAudio.tsx` — mover (idêntico) o componente que hoje vive dentro de `MediaTiles.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import type { RemoteAudioTrack } from 'livekit-client'

/** Anexa um track de áudio a um <audio> invisível enquanto montado. */
export function RemoteAudio({ track }: { track: RemoteAudioTrack }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])
  return <audio ref={ref} autoPlay className="hidden" />
}
```

Em `MediaTiles.tsx`: remover a definição local e importar `{ RemoteAudio } from './RemoteAudio'`. Rodar `pnpm --filter @legends/web test src/office/media/MediaTiles.test.tsx` — segue verde.

- [ ] **Step 2: Testes da barra (falhando)**

Em `MediaBar.test.tsx`, atualizar o helper e adicionar casos. O helper `mediaState` ganha `applyMicEnabled: vi.fn(async () => {})`; criar helper do broadcast:

```tsx
import type { OfficeBroadcastState } from './useOfficeBroadcast'

function broadcastState(overrides: Partial<OfficeBroadcastState> = {}): OfficeBroadcastState {
  return {
    available: true,
    speakerEnabled: false,
    speakerError: false,
    speakers: [],
    broadcastTracks: [],
    toggleSpeaker: vi.fn(async () => {}),
    ...overrides,
  }
}
```

Todos os `render(<MediaBar ... />)` existentes ganham `broadcast={broadcastState({ available: false })} canBroadcast={false}` (comportamento igual ao de hoje). Casos novos:

```tsx
  it('mostra o alto-falante só para liderança com broadcast disponível', () => {
    const broadcast = broadcastState()
    const { rerender } = render(
      <MediaBar media={mediaState()} zoneName={null} broadcast={broadcast} canBroadcast={false} />,
    )
    expect(screen.queryByRole('button', { name: /alto-falante/i })).not.toBeInTheDocument()

    rerender(<MediaBar media={mediaState()} zoneName={null} broadcast={broadcast} canBroadcast />)
    const button = screen.getByRole('button', { name: 'Ligar alto-falante' })
    fireEvent.click(button)
    expect(broadcast.toggleSpeaker).toHaveBeenCalledOnce()
  })

  it('com o alto-falante ligado, o botão inverte e o mic local fica desabilitado', () => {
    render(
      <MediaBar
        media={mediaState({ micEnabled: false })}
        zoneName={null}
        broadcast={broadcastState({ speakerEnabled: true })}
        canBroadcast
      />,
    )
    expect(screen.getByRole('button', { name: 'Desligar alto-falante' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ativar microfone' })).toBeDisabled()
  })

  it('erro ao ligar o alto-falante vira aviso', () => {
    render(
      <MediaBar
        media={mediaState()}
        zoneName={null}
        broadcast={broadcastState({ speakerError: true })}
        canBroadcast
      />,
    )
    expect(screen.getByText('Não foi possível ligar o alto-falante')).toBeInTheDocument()
  })
```

Rodar e ver FALHAR.

- [ ] **Step 3: Implementar a barra**

`MediaBar.tsx` — assinatura nova e acréscimos (o resto do arquivo não muda):

```tsx
import type { OfficeMediaState } from './useOfficeMedia'
import type { OfficeBroadcastState } from './useOfficeBroadcast'

export function MediaBar({
  media,
  zoneName,
  broadcast,
  canBroadcast,
}: {
  media: OfficeMediaState
  zoneName: string | null
  broadcast: OfficeBroadcastState
  canBroadcast: boolean
}) {
```

1. o botão de mic ganha `disabled={broadcast.speakerEnabled}` e
   `title={broadcast.speakerEnabled ? 'Silenciado enquanto o alto-falante está ligado' : undefined}`
   (+ classe `disabled:opacity-40`);
2. após o botão de compartilhar tela:

```tsx
      {canBroadcast && broadcast.available && (
        <button
          type="button"
          className={toggleCls(broadcast.speakerEnabled)}
          onClick={() => void broadcast.toggleSpeaker()}
        >
          {broadcast.speakerEnabled ? 'Desligar alto-falante' : 'Ligar alto-falante'}
        </button>
      )}
```

3. junto do aviso de mic:

```tsx
      {broadcast.speakerError && (
        <span className="font-label text-label-sm text-error">Não foi possível ligar o alto-falante</span>
      )}
```

Rodar `pnpm --filter @legends/web test src/office/media/MediaBar.test.tsx` — PASS.

- [ ] **Step 4: Banner**

`apps/web/src/office/media/BroadcastBanner.tsx` (sem teste próprio — é render condicional trivial coberto pelo teste da página; o áudio usa o `RemoteAudio` já testado por uso no MediaTiles):

```tsx
import type { RemoteAudioTrack } from 'livekit-client'
import { RemoteAudio } from './RemoteAudio'

/** Aviso global de "alguém no alto-falante" + os áudios do broadcast. */
export function BroadcastBanner({
  speakers,
  tracks,
}: {
  speakers: string[]
  tracks: RemoteAudioTrack[]
}) {
  return (
    <>
      {tracks.map((track, index) => (
        <RemoteAudio key={track.sid ?? index} track={track} />
      ))}
      {speakers.length > 0 && (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-primary/40 bg-surface-container/95 px-lg py-sm font-label text-label-md text-on-surface shadow-lg backdrop-blur"
        >
          📢 {speakers.join(', ')} no alto-falante
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 5: Página**

Em `apps/web/src/pages/OfficePage.tsx`:

1. imports novos:

```tsx
import { useQuery } from '@tanstack/react-query'
import { zoneAt, isLeaderRole, type OfficeConfigDTO } from '@legends/shared'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import { useOfficeBroadcast } from '../office/media/useOfficeBroadcast'
import { BroadcastBanner } from '../office/media/BroadcastBanner'
```

2. dentro do componente, após `const media = ...`:

```tsx
  const { user } = useAuth()
  const canBroadcast = isLeaderRole(user?.role)
  // Interruptor de custo do admin: fail-closed — sem config, sem broadcast.
  const { data: officeConfig } = useQuery({
    queryKey: ['office', 'config'],
    queryFn: () => apiFetch<OfficeConfigDTO>('/office/config'),
    staleTime: Infinity,
  })
  const broadcast = useOfficeBroadcast({
    enabled: (officeConfig?.broadcastEnabled ?? false) && connected && you !== null,
    micEnabled: media.micEnabled,
    setMicEnabled: media.applyMicEnabled,
    youName: user?.name ?? null,
  })
```

(`you` já existe no arquivo — hoje é declarado depois do `media`; mover a
declaração de `you`/`zoneName` para antes do bloco acima.)

3. no JSX: `<BroadcastBanner speakers={broadcast.speakers} tracks={broadcast.broadcastTracks} />` logo após `<OfficeCanvas ... />`, e a `MediaBar` passa a receber `broadcast={broadcast} canBroadcast={canBroadcast}`.

4. `OfficePage.test.tsx`: adicionar mock do hook novo e da api, e envolver com QueryClientProvider:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../lib/api', () => ({ apiFetch: vi.fn(async () => ({ broadcastEnabled: false })) }))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'ana', name: 'Ana Silva', role: 'LEGEND' } }),
}))
vi.mock('../office/media/useOfficeBroadcast', () => ({
  useOfficeBroadcast: () => ({
    available: false,
    speakerEnabled: false,
    speakerError: false,
    speakers: [],
    broadcastTracks: [],
    toggleSpeaker: async () => {},
  }),
}))
```

e o `render` vira:

```tsx
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <OfficePage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
```

O mock existente de `useOfficeMedia` ganha `applyMicEnabled: async () => {}`.
Asserção nova no teste existente: `expect(screen.queryByRole('button', { name: /alto-falante/i })).not.toBeInTheDocument()` (LEGEND não vê).

Teste novo no mesmo arquivo — o banner lista os nomes (o mock do
`useOfficeBroadcast` precisa ser mutável; usar o padrão de variável +
`vi.mock` com factory que a lê):

```tsx
  it('mostra o banner quando alguém está no alto-falante', () => {
    broadcastMockValue = {
      available: true,
      speakerEnabled: false,
      speakerError: false,
      speakers: ['Guilherme', 'Isabel'],
      broadcastTracks: [],
      toggleSpeaker: async () => {},
    }
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Guilherme, Isabel no alto-falante')
  })
```

(onde `broadcastMockValue` é uma `let` no topo do arquivo, o factory do
`vi.mock('../office/media/useOfficeBroadcast')` devolve `() => broadcastMockValue`,
e `renderPage()` é o render com providers extraído para um helper; resetar
`broadcastMockValue` para o estado vazio num `beforeEach`.)

- [ ] **Step 6: Painel do admin**

`apps/web/src/pages/admin/OfficeSection.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { OfficeConfigDTO } from '@legends/shared'
import { apiFetch } from '../../lib/api'

const KEY = ['admin', 'office-settings'] as const

/** Configurações do escritório virtual — hoje, só o interruptor do alto-falante. */
export function OfficeSection() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: KEY,
    queryFn: () => apiFetch<OfficeConfigDTO>('/admin/office-settings'),
  })
  const mutation = useMutation({
    mutationFn: (broadcastEnabled: boolean) =>
      apiFetch<OfficeConfigDTO>('/admin/office-settings', {
        method: 'PATCH',
        body: JSON.stringify({ broadcastEnabled }),
      }),
    onSuccess: (updated) => queryClient.setQueryData(KEY, updated),
  })

  const enabled = data?.broadcastEnabled ?? false

  return (
    <section className="rounded-lg bg-surface-container p-lg">
      <h3 className="font-headline text-headline-sm text-on-surface">Escritório virtual</h3>
      <div className="mt-md flex items-center justify-between gap-md">
        <div>
          <p className="font-label text-label-lg text-on-surface">Alto-falante</p>
          <p className="font-body text-body-sm text-on-surface-variant">
            Permite que a liderança fale para o escritório inteiro. Custo: mantém uma
            conexão de mídia extra por pessoa no escritório enquanto estiver ativo.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Alto-falante do escritório"
          disabled={isLoading || mutation.isPending}
          onClick={() => mutation.mutate(!enabled)}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
            enabled ? 'bg-primary' : 'bg-surface-container-highest'
          } disabled:opacity-40`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-surface transition-all ${
              enabled ? 'left-6' : 'left-1'
            }`}
          />
        </button>
      </div>
    </section>
  )
}
```

`OfficeSection.test.tsx` (mesmo padrão dos testes de section existentes — mock de `apiFetch`):

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))

import { OfficeSection } from './OfficeSection'

function renderSection() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OfficeSection />
    </QueryClientProvider>,
  )
}

describe('OfficeSection', () => {
  it('mostra o estado atual e liga pelo switch', async () => {
    apiFetchMock.mockResolvedValueOnce({ broadcastEnabled: false }) // GET
    apiFetchMock.mockResolvedValueOnce({ broadcastEnabled: true })  // PATCH
    renderSection()

    const toggle = await screen.findByRole('switch', { name: 'Alto-falante do escritório' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
    expect(apiFetchMock).toHaveBeenLastCalledWith(
      '/admin/office-settings',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ broadcastEnabled: true }) }),
    )
  })
})
```

Em `apps/web/src/pages/admin/TabBar.tsx`: adicionar `'escritorio'` ao tipo
`AdminTabId` e um item `{ id: 'escritorio', label: 'Escritório', ... }` à lista
de abas, seguindo exatamente o formato dos itens existentes (ler o arquivo e
copiar o shape — ícone `chair`). Em `AdminPage.tsx`: importar `OfficeSection` e
adicionar `{activeTab === "escritorio" && <OfficeSection />}`.

- [ ] **Step 7: Rodar tudo**

```bash
pnpm --filter @legends/web test
pnpm --filter @legends/api test
pnpm --filter @legends/shared test
pnpm build
```
Expected: verde (exceto as 2 falhas PRÉ-EXISTENTES do `ProfilePage.test.tsx`); build limpo.

- [ ] **Step 8: Verificação manual**

```bash
pnpm db:up && pnpm db:migrate   # aplica a migration local
# lembrar: exportar LIVEKIT_* no shell antes (a API não lê .env)
env -u PORT pnpm dev
```
1. Uma conta ADMIN do seed liga o switch em Admin → Escritório (conferir o
   e-mail de role ADMIN em `apps/api/prisma/seed.ts`; senha `emr2026@`).
2. Líder (conta LEAD do seed) entra no escritório → vê "Ligar alto-falante"; lenda não vê.
3. Líder liga → banner "📢 … no alto-falante" aparece para todos (inclusive
   dentro da sala de reunião) e o áudio atravessa; botão de mic do líder fica
   desabilitado.
4. Desliga → banner some, mic volta ao estado anterior.
5. Admin desliga o switch → recarregar a página do escritório → botão some e
   nenhuma conexão de broadcast é aberta (conferir na aba Network).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/office/media/ apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx apps/web/src/pages/admin/ apps/web/src/pages/AdminPage.tsx
git commit -m "feat(web): alto-falante na barra, banner global e interruptor no admin"
```

---

## Depois do v1 (fora deste plano)

Ducking (abaixar conversas durante anúncio); push-to-talk; trava de um locutor
por vez; derrubar conexões de broadcast ao vivo quando o admin desligar
(config push via WS).
