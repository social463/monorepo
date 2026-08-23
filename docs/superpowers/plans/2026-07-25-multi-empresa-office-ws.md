# Multi-tenancy no Escritório — sub-fatia 3: officeHub/office-ws.ts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Particionar o `officeHub` (presença/broadcast do escritório, 100% em memória) por
empresa — 1 instância de `OfficeHub` por `companyId` em vez de um singleton único de processo —
e repassar `companyId` em `office-ws.ts` e nos 4 consumidores externos que hoje chamam o
singleton diretamente. Última sub-fatia do domínio Escritório na linha de multi-tenancy.

**Architecture:** Um novo `getOfficeHub(companyId: string): OfficeHub`, apoiado num
`Map<string, OfficeHub>` em memória em `apps/api/src/lib/office-hub.ts`, substitui o `export
const officeHub = new OfficeHub()` de hoje — cria a instância sob demanda na primeira chamada
pra aquela empresa e reusa depois, sem limpeza/GC (YAGNI). A classe `OfficeHub` não muda
internamente: todos os métodos já só tocam campos privados da própria instância. `office-ws.ts`
resolve `companyId` na `preValidation` (JWT real ou payload de convidado, ambos já carregam
`companyId: string` desde as sub-fatias 1/2) e usa `getOfficeHub(companyId)` uma vez por conexão
para despachar as ~17 chamadas do bloco de mensagens. Os 4 consumidores externos
(`office-maps.ts`, `office-media.ts`, `auth.ts`, `office-map-service.ts`) — e os testes de rota
que importam `officeHub` diretamente como fixture (`office-maps.test.ts`, `office-media.test.ts`,
`auth.test.ts`) — trocam a chamada direta pela resolvida via `companyId` já disponível em cada
call-site.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Vitest, `ws` (testes de WebSocket real).

## Global Constraints

- Branch de trabalho: `feat/multi-empresa-auth-jwt-clean` (mesma onde as sub-fatias 1 e 2 do
  Escritório já foram commitadas e mergeadas — PR #10609). Trabalhar em worktree isolado
  (`superpowers:using-git-worktrees`).
- **Antes de rodar qualquer comando que grave no Postgres, confirme que `apps/api/.env`'s
  `DATABASE_URL` é `postgresql://legends:legends@localhost:5432/legends?schema=public` (Postgres
  local). Se for qualquer outra coisa, pare e reporte BLOCKED sem executar nada.** Esta fatia não
  gera migration nova, mas os testes batem em banco real.
- `pnpm db:up` precisa estar de pé antes de rodar qualquer teste da API.
- A classe `OfficeHub` (`apps/api/src/lib/office-hub.ts`) **não muda internamente** — nenhum
  método, campo privado ou assinatura pública dela é tocado nesta fatia. Só o que hoje é
  exportado como singleton (`export const officeHub = new OfficeHub()`, última linha do arquivo)
  vira o registry `getOfficeHub`.
- `DEFAULT_COMPANY_ID` (`'company-emr'`) vem de `@legends/shared`.
- Todo call-site fora de `office-hub.ts` que hoje importa `{ officeHub }` de `'../lib/office-hub'`
  ou `'./office-hub'` perde essa importação quando o singleton for removido — isso inclui não só
  as rotas/services listados no design, mas também 3 arquivos de teste que usam `officeHub` como
  fixture direta (`office-maps.test.ts`, `office-media.test.ts`, `auth.test.ts` — nenhum deles é
  mencionado no design original, mas todos quebram de compilação assim que a Task 1 remover o
  singleton; corrigidos na Task 3 desta fatia). `office-hub.test.ts`/`office-hub-map.test.ts`
  continuam intocados: importam a classe `OfficeHub` diretamente (`new OfficeHub()`), nunca o
  singleton removido.
- Zero mudança de comportamento observável em produção — só existe uma empresa hoje.

---

### Task 1: Registry `getOfficeHub` em `office-hub.ts`

**Files:**
- Modify: `apps/api/src/lib/office-hub.ts`
- Create: `apps/api/src/lib/office-hub-registry.test.ts`

**Interfaces:**
- Consumes: `class OfficeHub` (já existente, inalterada).
- Produces: `getOfficeHub(companyId: string): OfficeHub` — usado por `office-ws.ts` (Task 2) e
  pelos 4 consumidores externos + 3 arquivos de teste (Task 3).

- [ ] **Step 1: Escrever o teste falhando**

Create `apps/api/src/lib/office-hub-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { getOfficeHub, OfficeHub } from './office-hub'

describe('getOfficeHub', () => {
  it('devolve a mesma instância pra chamadas repetidas com o mesmo companyId', () => {
    const first = getOfficeHub('company-registry-test-a')
    const second = getOfficeHub('company-registry-test-a')
    expect(first).toBe(second)
    expect(first).toBeInstanceOf(OfficeHub)
  })

  it('devolve instâncias diferentes pra companyIds diferentes', () => {
    const a = getOfficeHub('company-registry-test-b')
    const b = getOfficeHub('company-registry-test-c')
    expect(a).not.toBe(b)
  })

  it('estado de uma instância não vaza para outra criada depois', () => {
    const a = getOfficeHub('company-registry-test-d')
    a.reset()
    const b = getOfficeHub('company-registry-test-e')
    expect(a).not.toBe(b)
    expect(a.occupants()).toEqual([])
    expect(b.occupants()).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/lib/office-hub-registry.test.ts`
Expected: FAIL — erro de compilação (`getOfficeHub` não existe em `./office-hub`, só `officeHub`).

- [ ] **Step 3: Implementar**

Modify `apps/api/src/lib/office-hub.ts` — trocar a última linha do arquivo:

```ts
export const officeHub = new OfficeHub()
```

por:

```ts
const officeHubRegistry = new Map<string, OfficeHub>()

/**
 * 1 instância de `OfficeHub` por empresa — presença/broadcast de uma empresa nunca
 * vazam para outra. Cria sob demanda na primeira chamada pra aquele `companyId` e
 * reusa depois. Sem limpeza/GC de propósito: empresas são um conjunto pequeno e
 * controlado por admin, não input de usuário arbitrário — crescer sem limpar é
 * seguro e mais simples que gerenciar ciclo de vida agora (YAGNI).
 *
 * A classe `OfficeHub` em si não muda: todo método já só toca campos privados
 * da própria instância (nunca um estado externo compartilhado), então múltiplas
 * instâncias independentes já funcionavam antes disso — é só isso que resolve de
 * graça a colisão de `roomId` entre empresas (`raisedHandsByRoom`/`lockedRooms`/
 * `roomEntryGrants`/`pendingKnocks`): cada hub só vê `roomId`s do próprio `runtime`.
 */
export function getOfficeHub(companyId: string): OfficeHub {
  let hub = officeHubRegistry.get(companyId)
  if (!hub) {
    hub = new OfficeHub()
    officeHubRegistry.set(companyId, hub)
  }
  return hub
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/lib/office-hub-registry.test.ts`
Expected: PASS nos 3 testes.

Nota: a partir deste ponto, `apps/api/src/lib/office-hub.test.ts` (a classe isolada, não afetada)
continua passando normalmente, mas **todo** arquivo fora de `office-hub.ts` que ainda importa
`{ officeHub }` para de compilar — isso é esperado até as Tasks 2 e 3.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub-registry.test.ts
git commit -m "feat: adiciona registry de OfficeHub por empresa (getOfficeHub)"
```

---

### Task 2: `office-ws.ts` — companyId na preValidation + despacho por hub da empresa

**Files:**
- Modify: `apps/api/src/routes/office-ws.ts`
- Modify: `apps/api/src/routes/office-ws.test.ts`

**Interfaces:**
- Consumes: `getOfficeHub(companyId: string): OfficeHub` (Task 1), `getActiveOfficeMap(companyId:
  string): Promise<ActiveOfficeMapDTO>` (já escopada desde a sub-fatia 1), `isOfficeGuestPayload`
  (já existente, payload carrega `companyId: string` real desde a sub-fatia 2).
- Produces: nenhuma interface nova consumida por outro arquivo — `office-ws.ts` é uma folha
  (rota WS, ninguém importa dele).

- [ ] **Step 1: Corrigir a fixture e escrever o teste adversarial falhando**

Modify `apps/api/src/routes/office-ws.test.ts` — trocar o topo do arquivo (imports + `beforeEach`):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import WebSocket from 'ws'
import { Prisma } from '@prisma/client'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { getOfficeHub } from '../lib/office-hub'
import { OFFICE_HEARTBEAT_INTERVAL_MS } from './office-ws'
import { createEmptyMapDocumentV1, isWalkable, DEFAULT_COMPANY_ID, type OfficeServerMessage } from '@legends/shared'

function waitOpen(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
}
function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// Todos os testes deste arquivo, exceto o describe de isolamento entre
// empresas ao final, operam na empresa default — resolve o hub uma vez para
// manter os `officeHub.*` do arquivo inteiro sem reescrever cada chamada.
const officeHub = getOfficeHub(DEFAULT_COMPANY_ID)

// O hub é um singleton em memória por empresa: o truncate do Postgres não o limpa.
let activeMapId: string

beforeEach(async () => {
  officeHub.reset()
  const document = createEmptyMapDocumentV1({ width: 25, height: 18, tileSize: 32 })
  const map = await prisma.officeMap.create({ data: { name: 'Mapa de teste', companyId: DEFAULT_COMPANY_ID } })
  activeMapId = map.id
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

(o `Prisma` import já existia; passa a ser usado também na nova fixture de `OfficeSetting` e no
novo teste abaixo.)

Adicionar, ao final do `describe('office websocket', () => { ... })` (antes do `})` que o fecha),
o teste adversarial de isolamento entre empresas:

```ts

  it('usuários de empresas diferentes não veem presença nem broadcast um do outro', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa WS', slug: 'outra-empresa-ws-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa WS', slug: 'setor-outra-empresa-ws-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherDocument = createEmptyMapDocumentV1({ width: 25, height: 18, tileSize: 32 })
    const otherMap = await prisma.officeMap.create({ data: { name: 'Mapa Outra Empresa', companyId: otherCompany.id } })
    const otherPublication = await prisma.officeMapPublication.create({
      data: {
        mapId: otherMap.id, version: 1, schemaVersion: otherDocument.schemaVersion,
        mapData: otherDocument as unknown as Prisma.InputJsonValue, companyId: otherCompany.id,
      },
    })
    await prisma.officeSetting.create({ data: { companyId: otherCompany.id, activeMapPublicationId: otherPublication.id } })

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-multi-empresa-ws@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const outraUser = await prisma.user.create({
      data: {
        name: 'Zeca', email: 'zeca-outra-empresa-ws@x.com', passwordHash: 'x', role: 'LEGEND',
        companyId: otherCompany.id, sectorId: otherSector.id,
      },
    })
    const anaTk = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: DEFAULT_COMPANY_ID, features: ['escritorio'] })
    const outraTk = app.jwt.sign({ sub: outraUser.id, role: 'LEGEND', sectorId: otherSector.id, companyId: otherCompany.id, features: ['escritorio'] })

    const anaWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${anaTk}`)
    const anaMsgs: OfficeServerMessage[] = []
    anaWs.on('message', (d) => anaMsgs.push(JSON.parse(d.toString())))
    await waitOpen(anaWs)

    const outraWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${outraTk}`)
    const outraMsgs: OfficeServerMessage[] = []
    outraWs.on('message', (d) => outraMsgs.push(JSON.parse(d.toString())))
    await waitOpen(outraWs)
    await delay(100)

    // 'joined' de uma empresa nunca chega pra quem está na outra
    expect(anaMsgs.some((m) => m.type === 'joined' && m.occupant.userId === outraUser.id)).toBe(false)
    expect(outraMsgs.some((m) => m.type === 'joined' && m.occupant.userId === ana.id)).toBe(false)

    const otherHub = getOfficeHub(otherCompany.id)
    expect(otherHub.occupants().map((o) => o.userId)).toEqual([outraUser.id])
    expect(officeHub.occupants().map((o) => o.userId)).not.toContain(outraUser.id)

    // movimento de uma empresa não propaga pra outra
    const spawn = otherHub.occupantOf(outraUser.id)!
    const dir = isWalkable(spawn.x, spawn.y - 1) ? 'up' : 'down'
    outraWs.send(JSON.stringify({ type: 'move', dir }))
    await delay(150)
    expect(anaMsgs.some((m) => m.type === 'moved' && m.userId === outraUser.id)).toBe(false)

    anaWs.close()
    outraWs.close()
    await app.close()
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/office-ws.test.ts`
Expected: FAIL — erro de compilação (`office-ws.ts` ainda importa `officeHub`, removido na Task 1;
`getActiveOfficeMap` ainda é chamada com a assinatura antiga dentro de `office-ws.ts`).

- [ ] **Step 3: Implementar `office-ws.ts`**

Modify `apps/api/src/routes/office-ws.ts` — arquivo inteiro:

```ts
import type { FastifyInstance } from 'fastify'
import {
  OFFICE_CHARACTER_NAME_MAX_LENGTH,
  OFFICE_GUEST_CHARACTER_PRESETS,
  OFFICE_GUEST_NAME_MAX_LENGTH,
  isDirection,
  isOfficeUserStatus,
  type OfficeClientMessage,
  type ActiveOfficeMapDTO,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { getOfficeHub, type OfficeUser } from '../lib/office-hub'
import { sanitizeAvatarOptions, sanitizeAvatarStyle } from '../lib/serialize'
import { getActiveOfficeMap } from '../services/office-map-service'
import { isOfficeGuestPayload } from '../services/office-guest-service'

/** Anexado ao request no preValidation para o handler do socket ficar síncrono. */
interface OfficeRequest {
  _officeUser?: OfficeUser
  _officeMap?: ActiveOfficeMapDTO
  _officeCompanyId?: string
}

/**
 * Ping periódico por conexão. Sem isso, uma sala parada (ninguém anda por um
 * tempo) fica com tráfego zero no socket — e o nginx derruba conexões ociosas
 * depois de `proxy_read_timeout` (60s por padrão). O intervalo aqui fica bem
 * abaixo disso para o socket nunca ficar realmente ocioso.
 */
export const OFFICE_HEARTBEAT_INTERVAL_MS = 30_000

export async function officeWsRoutes(app: FastifyInstance) {
  app.get(
    '/office/ws',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const token = (request.query as { token?: string }).token ?? ''
        let userId: string
        let companyId: string
        try {
          const payload = app.jwt.verify(token) as {
            sub: string
            role?: string
            guest?: boolean
            features?: string[]
            companyId: string
          }
          userId = payload.sub
          companyId = payload.companyId
          if (isOfficeGuestPayload(payload)) {
            const preset = OFFICE_GUEST_CHARACTER_PRESETS.find((candidate) => candidate.id === payload.presetId)
            if (!preset) return reply.code(401).send({ message: 'Não autorizado' })
            ;(request as OfficeRequest)._officeUser = {
              id: payload.sub,
              name: payload.name.trim().slice(0, OFFICE_GUEST_NAME_MAX_LENGTH),
              isGuest: true,
              officeCharacterName: null,
              avatarSeed: preset.seed,
              avatarOptions: preset.options,
              photoUrl: null,
              avatarStyle: 'lpc',
            }
            const activeMap = await getActiveOfficeMap(companyId)
            const requestedMapId = (request.query as { mapId?: string }).mapId
            if (requestedMapId && requestedMapId !== activeMap.map.id) {
              return reply.code(409).send({ message: 'O mapa ativo mudou; recarregue o escritório' })
            }
            ;(request as OfficeRequest)._officeMap = activeMap
            ;(request as OfficeRequest)._officeCompanyId = companyId
            return
          } else if (payload.role !== 'ADMIN' && !(payload.features ?? []).includes('escritorio')) {
            return reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
          }
        } catch {
          return reply.code(401).send({ message: 'Não autorizado' })
        }

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            name: true,
            active: true,
            photoUrl: true,
            avatarStyle: true,
            avatarSeed: true,
            avatarOptions: true,
            officeCharacterName: true,
          },
        })
        if (!user || !user.active) {
          return reply.code(401).send({ message: 'Não autorizado' })
        }

        ;(request as OfficeRequest)._officeUser = {
          id: user.id,
          officeCharacterName: user.officeCharacterName ?? null,
          avatarSeed: user.avatarSeed ?? null,
          avatarOptions: sanitizeAvatarOptions(user.avatarOptions),
          name: user.name,
          photoUrl: user.photoUrl,
          avatarStyle: sanitizeAvatarStyle(user.avatarStyle),
        }
        const activeMap = await getActiveOfficeMap(companyId)
        const requestedMapId = (request.query as { mapId?: string }).mapId
        if (requestedMapId && requestedMapId !== activeMap.map.id) {
          return reply.code(409).send({ message: 'O mapa ativo mudou; recarregue o escritório' })
        }
        ;(request as OfficeRequest)._officeMap = activeMap
        ;(request as OfficeRequest)._officeCompanyId = companyId
      },
    },
    (connection, request) => {
      const ws = connection.socket
      const user = (request as OfficeRequest)._officeUser as OfficeUser
      const runtime = (request as OfficeRequest)._officeMap as ActiveOfficeMapDTO
      const companyId = (request as OfficeRequest)._officeCompanyId as string
      const hub = getOfficeHub(companyId)

      hub.join(ws, user, runtime)

      // Mantém o socket "vivo" aos olhos de qualquer proxy no meio do caminho
      // (nginx). `.unref()` para o timer não segurar o processo Node aberto
      // (ex.: em testes que fecham o server sem fechar cada conexão).
      const heartbeat = setInterval(() => {
        if (ws.readyState === ws.OPEN) ws.ping()
      }, OFFICE_HEARTBEAT_INTERVAL_MS)
      heartbeat.unref?.()

      ws.on('message', (raw: unknown) => {
        let msg: OfficeClientMessage
        try {
          msg = JSON.parse(String(raw)) as OfficeClientMessage
        } catch {
          return
        }
        if (msg.type === 'move' && isDirection(msg.dir)) {
          hub.move(ws, user.id, msg.dir, msg.sprint === true)
        } else if (msg.type === 'leave-office') {
          hub.leaveNow(ws, user.id)
          ws.close()
        } else if (msg.type === 'face' && isDirection(msg.dir)) {
          hub.face(ws, user.id, msg.dir)
        } else if (msg.type === 'call' && typeof msg.targetUserId === 'string') {
          hub.call(ws, user.id, msg.targetUserId)
        } else if (
          msg.type === 'call-response' &&
          typeof msg.callerId === 'string' &&
          typeof msg.accepted === 'boolean'
        ) {
          hub.callResponse(ws, user.id, msg.callerId, msg.accepted)
        } else if (msg.type === 'nearby-message' && typeof msg.text === 'string') {
          const kind = msg.kind === 'thought' || msg.kind === 'reaction' ? msg.kind : 'speech'
          hub.nearbyMessage(ws, user.id, msg.text, kind)
        } else if (msg.type === 'room-chat-message' && typeof msg.text === 'string') {
          hub.roomChatMessage(ws, user.id, msg.text)
        } else if (msg.type === 'confetti' && typeof msg.active === 'boolean') {
          hub.confetti(ws, user.id, msg.active)
        } else if (msg.type === 'raise-hand' && typeof msg.active === 'boolean') {
          hub.raiseHand(ws, user.id, msg.active)
        } else if (msg.type === 'set-status' && isOfficeUserStatus(msg.status)) {
          hub.setStatus(ws, user.id, msg.status)
        } else if (msg.type === 'set-character-name' && typeof msg.name === 'string') {
          if (user.isGuest) return
          const normalized = msg.name.trim().slice(0, OFFICE_CHARACTER_NAME_MAX_LENGTH) || null
          void prisma.user
            .update({ where: { id: user.id }, data: { officeCharacterName: normalized } })
            .then(() => hub.setCharacterName(ws, user.id, normalized))
            .catch(() => {})
        } else if (msg.type === 'set-editing' && typeof msg.editing === 'boolean') {
          hub.setEditing(ws, user.id, msg.editing)
        } else if (msg.type === 'set-room-lock' && typeof msg.locked === 'boolean') {
          hub.setRoomLock(ws, user.id, msg.locked)
        } else if (
          msg.type === 'knock' &&
          typeof msg.roomId === 'string' &&
          typeof msg.active === 'boolean'
        ) {
          hub.knock(ws, user.id, msg.roomId, msg.active)
        } else if (
          msg.type === 'knock-response' &&
          typeof msg.userId === 'string' &&
          typeof msg.accepted === 'boolean'
        ) {
          hub.knockResponse(ws, user.id, msg.userId, msg.accepted)
        } else if (
          msg.type === 'screen-annotation' &&
          typeof msg.sharerId === 'string' &&
          typeof msg.strokeId === 'string'
        ) {
          // Os pontos são validados no hub (`sanitizeAnnotationPoints`) — aqui
          // só o formato mínimo que decide o roteamento, como nas demais.
          hub.screenAnnotation(ws, user.id, msg)
        }
      })

      ws.on('close', () => {
        clearInterval(heartbeat)
        hub.leave(ws, user.id)
      })
    },
  )
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/routes/office-ws.test.ts`
Expected: PASS em todos os testes do arquivo (22 pré-existentes + o novo adversarial).

- [ ] **Step 5: Rodar tsc**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: erros só nos 4 consumidores externos e nos 3 arquivos de teste que ainda importam
`officeHub` diretamente (Task 3, ainda não despachada). Nenhum erro em `office-ws.ts` ou
`office-ws.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/office-ws.ts apps/api/src/routes/office-ws.test.ts
git commit -m "feat: office-ws.ts resolve o OfficeHub da empresa da conexão"
```

---

### Task 3: Os 4 consumidores externos + os 3 arquivos de teste que usam `officeHub` como fixture

**Files:**
- Modify: `apps/api/src/routes/office-maps.ts`
- Modify: `apps/api/src/routes/office-maps.test.ts`
- Modify: `apps/api/src/routes/office-media.ts`
- Modify: `apps/api/src/routes/office-media.test.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/routes/auth.test.ts`
- Modify: `apps/api/src/services/office-map-service.ts`

**Interfaces:**
- Consumes: `getOfficeHub(companyId: string): OfficeHub` (Task 1). `companyId` já disponível em
  cada call-site: `request.user.companyId` nas rotas, `participant.companyId` em
  `office-media.ts` (Task 2 da sub-fatia 2 já adicionou esse campo), e o parâmetro `companyId` já
  presente em cada função de `office-map-service.ts` que chama o hub (sub-fatia 1).
- Produces: nenhuma interface nova — puramente troca do call-site, sem mudança de assinatura
  pública em nenhum destes arquivos.

- [ ] **Step 1: Confirmar o estado de quebra atual (nenhum teste novo — migração mecânica)**

Esta task não introduz comportamento novo (a cobertura de isolamento por empresa desses fluxos já
existe desde as sub-fatias 1/2 nos services); é só o call-site do hub acompanhando o registry da
Task 1. Confirme a quebra antes de mexer:

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: FAIL — erros de tipo em `apps/api/src/routes/office-maps.ts`,
`apps/api/src/routes/office-maps.test.ts`, `apps/api/src/routes/office-media.ts`,
`apps/api/src/routes/office-media.test.ts`, `apps/api/src/routes/auth.ts`,
`apps/api/src/routes/auth.test.ts` e `apps/api/src/services/office-map-service.ts`, todos por
`Module '"../lib/office-hub"' has no exported member 'officeHub'` (ou equivalente).

- [ ] **Step 2: `office-maps.ts`**

Modify `apps/api/src/routes/office-maps.ts` — trocar o import:

```ts
import { officeHub } from '../lib/office-hub'
```

por:

```ts
import { getOfficeHub } from '../lib/office-hub'
```

E os 3 call-sites de mesa (fim do arquivo):

```ts
  app.delete('/admin/office-desks/:id/claim', admin, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const desk = await adminReleaseOfficeDesk(params.data.id, request.user.sub, request.user.companyId)
    getOfficeHub(request.user.companyId).broadcastDeskReleased(desk.id, desk.externalKey)
    return { desk }
  })

  app.post('/office/desks/:id/claim', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const desk = await claimOfficeDesk(params.data.id, request.user.sub, request.user.companyId)
    if (desk.claimedBy) getOfficeHub(request.user.companyId).broadcastDeskClaimed(desk.id, desk.externalKey, desk.claimedBy)
    return { desk }
  })

  app.post('/office/desks/:id/release', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const desk = await releaseOfficeDesk(params.data.id, request.user.sub, request.user.companyId)
    getOfficeHub(request.user.companyId).broadcastDeskReleased(desk.id, desk.externalKey)
    return { desk }
  })
```

Modify `apps/api/src/routes/office-maps.test.ts` — trocar o import (`DEFAULT_COMPANY_ID` já é
importado neste arquivo desde a sub-fatia 2):

```ts
import { officeHub } from '../lib/office-hub'
```

por:

```ts
import { getOfficeHub } from '../lib/office-hub'
```

E logo abaixo do bloco de imports, antes do `beforeEach`, adicionar o alias local (o resto do
arquivo usa `officeHub.reset()` sem mudança):

```ts
// Todos os testes deste arquivo operam na empresa default.
const officeHub = getOfficeHub(DEFAULT_COMPANY_ID)
```

- [ ] **Step 3: `office-media.ts`**

Modify `apps/api/src/routes/office-media.ts` — arquivo inteiro:

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { AccessToken } from 'livekit-server-sdk'
import {
  OFFICE_BROADCAST_ROOM,
  isLeaderRole,
  type OfficeMediaTokenResponse,
  type OfficeConfigDTO,
} from '@legends/shared'
import { getOfficeHub } from '../lib/office-hub'
import { resolveLivekitConfig } from '../lib/config'
import { getOfficeSettings } from '../services/office-setting-service'
import { isOfficeGuestPayload } from '../services/office-guest-service'

const bodySchema = z.object({ room: z.string().min(1) })

/**
 * Assina tokens do LiveKit. A autorização é a POSIÇÃO REAL no office-hub:
 * só sai token para a sala que corresponde ao tile onde a pessoa está —
 * é isso que torna o isolamento acústico das zonas estrutural.
 */
export async function officeMediaRoutes(app: FastifyInstance) {
  const livekit = resolveLivekitConfig(process.env)

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

  app.post('/office/media-token', async (request, reply) => {
    const participant = await resolveParticipant(request, reply)
    if (!participant) return
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const hub = getOfficeHub(participant.companyId)

    // Alto-falante: sala global, sem checagem de zona. O interruptor do admin
    // é a primeira barreira (custo); o grant canPublish é a segunda (só
    // liderança fala — imposto pelo próprio servidor LiveKit).
    if (parsed.data.room === OFFICE_BROADCAST_ROOM) {
      const { broadcastEnabled } = await getOfficeSettings(participant.companyId)
      if (!broadcastEnabled) {
        return reply.code(403).send({ message: 'O alto-falante está desativado' })
      }
      const occupant = hub.occupantOf(participant.sub)
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
        canPublish: !participant.guest && isLeaderRole(participant.role),
      })
      const response: OfficeMediaTokenResponse = {
        token: await accessToken.toJwt(),
        url: livekit.url,
      }
      return reply.send(response)
    }

    const occupant = hub.occupantOf(participant.sub)
    if (!occupant) {
      return reply.code(409).send({ message: 'Entre no escritório antes de conectar a mídia' })
    }

    const allowed = hub.mediaRoomForPosition(occupant.x, occupant.y)
    if (parsed.data.room !== allowed) {
      return reply.code(403).send({ message: 'Você não está nessa sala' })
    }
    const room = hub.roomForPosition(occupant.x, occupant.y)
    if (room && !room.voiceEnabled) {
      return reply.code(403).send({ message: 'A voz está desativada nesta sala' })
    }

    const accessToken = new AccessToken(livekit.apiKey, livekit.apiSecret, {
      identity: occupant.userId,
      name: occupant.name,
      // Token é credencial bearer — TTL curto limita a janela de escuta de quem saiu da sala com um cliente adulterado.
      ttl: '5m',
    })
    accessToken.addGrant({ roomJoin: true, room: parsed.data.room })

    const response: OfficeMediaTokenResponse = {
      token: await accessToken.toJwt(),
      url: livekit.url,
    }
    return reply.send(response)
  })

  app.get('/office/config', { onRequest: [app.authenticate, app.requireFeature('escritorio')] }, async (request): Promise<OfficeConfigDTO> => {
    return getOfficeSettings(request.user.companyId)
  })
}
```

Modify `apps/api/src/routes/office-media.test.ts` — trocar o import (`DEFAULT_COMPANY_ID` já é
importado neste arquivo desde a sub-fatia 2):

```ts
import { officeHub, type OfficeSocket } from '../lib/office-hub'
```

por:

```ts
import { getOfficeHub, type OfficeSocket } from '../lib/office-hub'
```

E logo abaixo do bloco de imports, adicionar o alias local:

```ts
// Todos os testes deste arquivo operam na empresa default.
const officeHub = getOfficeHub(DEFAULT_COMPANY_ID)
```

- [ ] **Step 4: `auth.ts`**

Modify `apps/api/src/routes/auth.ts` — trocar o import:

```ts
import { officeHub } from '../lib/office-hub'
```

por:

```ts
import { getOfficeHub } from '../lib/office-hub'
```

E o call-site dentro de `PATCH /me`:

```ts
    if (data.avatarSeed !== undefined || data.avatarOptions !== undefined) {
      getOfficeHub(request.user.companyId).updateAvatar(user.id, user.avatarSeed ?? null, migrateCharacterOptions(user.avatarOptions))
    }
```

Modify `apps/api/src/routes/auth.test.ts` — trocar o import (`DEFAULT_COMPANY_ID` já é importado
neste arquivo):

```ts
import { officeHub } from '../lib/office-hub'
```

por:

```ts
import { getOfficeHub } from '../lib/office-hub'
```

E logo abaixo do bloco de imports, adicionar o alias local:

```ts
// Todos os testes deste arquivo operam na empresa default.
const officeHub = getOfficeHub(DEFAULT_COMPANY_ID)
```

- [ ] **Step 5: `office-map-service.ts`**

Modify `apps/api/src/services/office-map-service.ts` — trocar o import:

```ts
import { officeHub } from '../lib/office-hub'
```

por:

```ts
import { getOfficeHub } from '../lib/office-hub'
```

Dentro de `mergeAndPublishDecoration` (`companyId` já é o 2º parâmetro do objeto `actor`... na
verdade é o 3º parâmetro posicional da função, já em escopo):

```ts
  officeHub.configure(await getActiveOfficeMap(companyId), false, true)
  officeHub.broadcastMapDecorUpdated(result.publication.id)
```

por:

```ts
  getOfficeHub(companyId).configure(await getActiveOfficeMap(companyId), false, true)
  getOfficeHub(companyId).broadcastMapDecorUpdated(result.publication.id)
```

Dentro de `publishOfficeMap` (`companyId` já é parâmetro da função):

```ts
  if (activate) {
    if (options.soft) {
      // keepPresence: não desconecta ninguém; o broadcast abaixo alcança as
      // entries preservadas para um refresh suave (sem reload).
      officeHub.configure(await getActiveOfficeMap(companyId), false, true)
      officeHub.broadcastMapDecorUpdated(result.publication.id)
    } else {
      officeHub.configure(await getActiveOfficeMap(companyId), true)
    }
  }
```

por:

```ts
  if (activate) {
    if (options.soft) {
      // keepPresence: não desconecta ninguém; o broadcast abaixo alcança as
      // entries preservadas para um refresh suave (sem reload).
      getOfficeHub(companyId).configure(await getActiveOfficeMap(companyId), false, true)
      getOfficeHub(companyId).broadcastMapDecorUpdated(result.publication.id)
    } else {
      getOfficeHub(companyId).configure(await getActiveOfficeMap(companyId), true)
    }
  }
```

Dentro de `activateOfficeMapPublication` (`companyId` já é parâmetro da função):

```ts
  officeHub.configure(await getActiveOfficeMap(companyId), true)
```

por:

```ts
  getOfficeHub(companyId).configure(await getActiveOfficeMap(companyId), true)
```

Dentro de `updateOfficeRoom` (`companyId` já é parâmetro da função):

```ts
  // Atualiza as regras autoritativas sem desconectar quem já está na mesma publicação.
  officeHub.configure(await getActiveOfficeMap(companyId), false)
```

por:

```ts
  // Atualiza as regras autoritativas sem desconectar quem já está na mesma publicação.
  getOfficeHub(companyId).configure(await getActiveOfficeMap(companyId), false)
```

(nenhum arquivo de teste de service importa `officeHub` diretamente — `office-map-service.test.ts`
exercita esses fluxos só por efeito colateral no banco, sem espionar o hub.)

- [ ] **Step 6: Rodar tsc**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: **limpo, zero erros** — esta é a última sub-fatia do domínio Escritório; nenhum arquivo
deveria mais referenciar o singleton `officeHub` removido.

- [ ] **Step 7: Rodar os testes dos arquivos tocados**

Run: `pnpm --filter @legends/api exec vitest run src/routes/office-maps.test.ts src/routes/office-media.test.ts src/routes/auth.test.ts src/services/office-map-service.test.ts`
Expected: PASS em todos (as flakes pré-existentes documentadas nas sub-fatias anteriores — colisão
de `Date.now()` em `office-map-service.test.ts` — continuam aceitáveis se já eram conhecidas antes
desta fatia).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/office-maps.ts apps/api/src/routes/office-maps.test.ts apps/api/src/routes/office-media.ts apps/api/src/routes/office-media.test.ts apps/api/src/routes/auth.ts apps/api/src/routes/auth.test.ts apps/api/src/services/office-map-service.ts
git commit -m "feat: os 4 consumidores externos do OfficeHub resolvem o hub por empresa"
```

---

### Task 4: Verificação final

**Files:** nenhum (só execução de comandos)

- [ ] **Step 1: Typecheck por workspace**

Run:
```bash
pnpm --filter @legends/api exec tsc --noEmit
pnpm --filter @legends/web exec tsc --noEmit
pnpm --filter @legends/shared exec tsc --noEmit
```
Expected: **zero erros nos 3 workspaces**. Esta é a última sub-fatia do domínio Escritório da
linha de multi-tenancy — não deveria sobrar nenhum erro de tipo pendente relacionado a
`officeHub`/`office-ws.ts`/`companyId` no domínio Escritório.

- [ ] **Step 2: Suíte completa de todos os workspaces**

Run: `pnpm test`
Expected: PASS em `@legends/shared`, `@legends/api`, `@legends/web`. Falhas aceitáveis: as flakes
pré-existentes já documentadas nas fatias anteriores (`apps/web/src/App.third-party-route.test.tsx`,
`apps/api/src/services/office-map-service.test.ts` por colisão de `Date.now()`). Qualquer outra
falha precisa ser investigada antes de prosseguir.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: sucesso em todos os workspaces.

- [ ] **Step 4: Confirmar que não sobrou nenhuma referência ao singleton removido**

Run: `git grep -n "officeHub" apps/api/src -- ':!apps/api/src/lib/office-hub.ts'`
Expected: toda ocorrência restante é `getOfficeHub(...)` (a chamada da função) ou o alias local
`const officeHub = getOfficeHub(DEFAULT_COMPANY_ID)` nos 4 arquivos de teste que o declaram
(`office-ws.test.ts`, `office-maps.test.ts`, `office-media.test.ts`, `auth.test.ts`) — nenhuma
linha deveria mais importar `{ officeHub }` de `'../lib/office-hub'`.
