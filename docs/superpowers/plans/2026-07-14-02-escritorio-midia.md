# Escritório — Mídia (áudio/vídeo/tela) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Áudio por proximidade no espaço aberto, salas com isolamento acústico garantido pelo servidor, e vídeo/tela opt-in — via LiveKit self-hosted.

**Architecture:** A sala LiveKit segue a posição server-autoritativa do `office-hub`: zonas do mapa viram salas LiveKit próprias (`office-zone-<id>`); o espaço aberto é uma sala única (`office-open`) com `autoSubscribe: false`, onde cada cliente assina só quem está no raio. A API assina tokens do LiveKit somente para a sala correta da posição real do usuário — a privacidade da zona é estrutural. O front tem um hook orquestrador (`useOfficeMedia`) dono do objeto `Room`, e UI em React fora do canvas.

**Tech Stack:** LiveKit (server container + `livekit-server-sdk` na API + `livekit-client` no web), Fastify 4, React 18, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-escritorio-midia-design.md`

## Global Constraints

- TypeScript **strict**, ESM puro. Monorepo pnpm; contrato compartilhado em `@legends/shared`.
- Mensagens ao usuário em **português**; comentários desta feature em português.
- Rotas finas; regra em lib/service. Nenhuma migration (mídia não persiste nada).
- Proximidade: **Chebyshev ≤ 3** (`PROXIMITY_RADIUS = 3`).
- Mic **mutado por padrão** (track publicado mutado); vídeo e tela **opt-in**.
- Zonas: `reuniao-1`, `reuniao-2`, `copa` — retângulos inclusivos, sem sobreposição, portas andáveis.
- Salas LiveKit: `office-open` e `office-zone-<id>`. Troca de sala com **500 ms** de estabilidade.
- Falha de mídia nunca quebra o escritório (mapa/movimento independem do LiveKit).
- Branch: `feat/escritorio-midia` (já criada, spec commitado). Testes da API exigem Postgres (`pnpm db:up`).
- Falha PRÉ-EXISTENTE conhecida e fora de escopo: `apps/web/src/pages/ProfilePage.test.tsx` (2 testes, badge duplicado).

---

### Task 1: Contrato compartilhado — zonas, salas e proximidade

O mapa ganha duas salas de reunião muradas (com vão de porta); zonas viram dados; funções puras que API e web compartilham.

**Files:**
- Modify: `packages/shared/src/office.ts` (somente as linhas 11–16 do `OFFICE_MAP`)
- Create: `packages/shared/src/office-media.ts`
- Create: `packages/shared/src/office-media.test.ts`
- Modify: `packages/shared/src/index.ts` (adicionar `export * from './office-media'`)

**Interfaces:**
- Consumes: `OFFICE_MAP`, `isWalkable` de `./office`.
- Produces: `PROXIMITY_RADIUS`, `OfficeZone`, `OFFICE_ZONES`, `zoneAt(x,y)`, `OFFICE_OPEN_ROOM`, `officeRoomForZone(zoneId)`, `officeRoomAt(x,y)`, `isWithinProximity(ax,ay,bx,by)`, `OfficeMediaTokenRequest`, `OfficeMediaTokenResponse`.

- [ ] **Step 1: Editar o mapa — duas salas muradas na área inferior direita**

Em `packages/shared/src/office.ts`, substituir as linhas 11–16 do array `OFFICE_MAP` (da linha `"#CCCC..........P........#"` até `"#.......................#"` imediatamente antes da última linha de parede). Ficam assim (cada string tem exatamente 25 caracteres; parede vertical na coluna 16, portas em (16,12) e (16,15)):

```ts
  "#CCCC..........P#..DD...#",
  "#CCCC...................#",
  "#...............#########",
  "#..........SSS..#.......#",
  "#..........SSS.....DD...#",
  "#...............#.......#",
```

As linhas 0–10 e 17 não mudam. Atualizar o comentário da legenda mencionando as salas: acrescentar ao bloco de comentário existente a linha `* A parede na coluna 16 fecha duas salas de reunião; portas em (16,12) e (16,15).`

- [ ] **Step 2: Escrever o teste falhando**

`packages/shared/src/office-media.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  OFFICE_ZONES,
  OFFICE_WIDTH,
  OFFICE_HEIGHT,
  OFFICE_OPEN_ROOM,
  PROXIMITY_RADIUS,
  zoneAt,
  officeRoomAt,
  officeRoomForZone,
  isWithinProximity,
  isWalkable,
} from './index'

describe('zonas', () => {
  it('define exatamente reuniao-1, reuniao-2 e copa', () => {
    expect(OFFICE_ZONES.map((z) => z.id).sort()).toEqual(['copa', 'reuniao-1', 'reuniao-2'])
  })

  it('todas cabem dentro do mapa', () => {
    for (const zone of OFFICE_ZONES) {
      expect(zone.x0).toBeGreaterThanOrEqual(0)
      expect(zone.y0).toBeGreaterThanOrEqual(0)
      expect(zone.x1).toBeLessThan(OFFICE_WIDTH)
      expect(zone.y1).toBeLessThan(OFFICE_HEIGHT)
      expect(zone.x0).toBeLessThanOrEqual(zone.x1)
      expect(zone.y0).toBeLessThanOrEqual(zone.y1)
    }
  })

  it('não se sobrepõem', () => {
    for (const a of OFFICE_ZONES) {
      for (const b of OFFICE_ZONES) {
        if (a.id === b.id) continue
        const overlapX = a.x0 <= b.x1 && b.x0 <= a.x1
        const overlapY = a.y0 <= b.y1 && b.y0 <= a.y1
        expect(overlapX && overlapY).toBe(false)
      }
    }
  })

  it('as portas das salas novas são andáveis e ficam FORA da zona', () => {
    for (const door of [{ x: 16, y: 12 }, { x: 16, y: 15 }]) {
      expect(isWalkable(door.x, door.y)).toBe(true)
      expect(zoneAt(door.x, door.y)).toBeNull()
    }
    // e o interior imediatamente após a porta pertence à sala
    expect(zoneAt(17, 12)?.id).toBe('reuniao-1')
    expect(zoneAt(17, 15)?.id).toBe('reuniao-2')
  })
})

describe('zoneAt / officeRoomAt', () => {
  it('dentro da zona (bordas inclusivas)', () => {
    const sala1 = OFFICE_ZONES.find((z) => z.id === 'reuniao-1')!
    expect(zoneAt(sala1.x0, sala1.y0)?.id).toBe('reuniao-1')
    expect(zoneAt(sala1.x1, sala1.y1)?.id).toBe('reuniao-1')
  })

  it('fora de qualquer zona é espaço aberto', () => {
    expect(zoneAt(12, 14)).toBeNull() // spawn
    expect(officeRoomAt(12, 14)).toBe(OFFICE_OPEN_ROOM)
  })

  it('dentro da zona a sala é office-zone-<id>', () => {
    expect(officeRoomAt(18, 15)).toBe('office-zone-reuniao-2')
    expect(officeRoomForZone('copa')).toBe('office-zone-copa')
  })
})

describe('isWithinProximity', () => {
  it('limiar exato de Chebyshev', () => {
    expect(isWithinProximity(5, 5, 5 + PROXIMITY_RADIUS, 5)).toBe(true)
    expect(isWithinProximity(5, 5, 5 + PROXIMITY_RADIUS + 1, 5)).toBe(false)
    expect(isWithinProximity(5, 5, 5 + PROXIMITY_RADIUS, 5 + PROXIMITY_RADIUS)).toBe(true)
  })

  it('é simétrica', () => {
    expect(isWithinProximity(2, 3, 5, 6)).toBe(isWithinProximity(5, 6, 2, 3))
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @legends/shared test`
Expected: FAIL — `office-media` não existe.

- [ ] **Step 4: Implementar o contrato**

`packages/shared/src/office-media.ts`:

```ts
/**
 * Mídia do escritório: zonas (salas com isolamento acústico) e proximidade.
 * A sala LiveKit de cada pessoa deriva da posição server-autoritativa no
 * office-hub — a API usa `officeRoomAt` para autorizar tokens, o front usa
 * as mesmas funções para saber a que sala se conectar e quem assinar.
 */

/** Raio de proximidade no espaço aberto, em tiles (distância de Chebyshev). */
export const PROXIMITY_RADIUS = 3;

export interface OfficeZone {
  id: string;
  name: string;
  /** Retângulo inclusivo em coordenadas de tile. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Zonas por cima do OFFICE_MAP. Portas (16,12) e (16,15) ficam FORA das zonas. */
export const OFFICE_ZONES: readonly OfficeZone[] = [
  { id: "reuniao-1", name: "Sala de Reunião 1", x0: 17, y0: 11, x1: 23, y1: 12 },
  { id: "reuniao-2", name: "Sala de Reunião 2", x0: 17, y0: 14, x1: 23, y1: 16 },
  { id: "copa", name: "Copa", x0: 1, y0: 11, x1: 8, y1: 13 },
];

export function zoneAt(x: number, y: number): OfficeZone | null {
  for (const zone of OFFICE_ZONES) {
    if (x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1) return zone;
  }
  return null;
}

export const OFFICE_OPEN_ROOM = "office-open";

export function officeRoomForZone(zoneId: string): string {
  return `office-zone-${zoneId}`;
}

/** Sala LiveKit correta para uma posição — a MESMA conta na API e no front. */
export function officeRoomAt(x: number, y: number): string {
  const zone = zoneAt(x, y);
  return zone ? officeRoomForZone(zone.id) : OFFICE_OPEN_ROOM;
}

export function isWithinProximity(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= PROXIMITY_RADIUS;
}

export interface OfficeMediaTokenRequest {
  room: string;
}

export interface OfficeMediaTokenResponse {
  token: string;
  url: string;
}
```

Em `packages/shared/src/index.ts`, adicionar:

```ts
export * from './office-media'
```

- [ ] **Step 5: Rodar TODOS os testes do shared (o mapa mudou — os testes antigos têm que continuar verdes)**

Run: `pnpm --filter @legends/shared test`
Expected: PASS — os novos + todos os antigos de `office.test.ts` (mapa retangular, cercado, spawns andáveis).

- [ ] **Step 6: Rodar os testes da API (o hub depende do mapa)**

Run: `pnpm --filter @legends/api test src/lib/office-hub.test.ts`
Expected: PASS — colisão e spawn continuam válidos com o mapa novo.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/office.ts packages/shared/src/office-media.ts packages/shared/src/office-media.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): zonas, salas de reunião no mapa e proximidade de mídia"
```

---

### Task 2: API — token de mídia autorizado pela posição

**Files:**
- Modify: `apps/api/package.json` (dependência `livekit-server-sdk`)
- Modify: `apps/api/src/lib/config.ts` (config do LiveKit)
- Modify: `apps/api/src/lib/office-hub.ts` (método `occupantOf`)
- Create: `apps/api/src/routes/office-media.ts`
- Create: `apps/api/src/routes/office-media.test.ts`
- Modify: `apps/api/src/app.ts` (registrar a rota)

**Interfaces:**
- Consumes: `officeRoomAt`, `OfficeMediaTokenResponse` de `@legends/shared`; `officeHub` (task 1 do escritório); `AccessToken` de `livekit-server-sdk`.
- Produces: `POST /office/media-token` (`{ room } → { token, url }`, 400/401/403/409); `resolveLivekitConfig(env): { apiKey, apiSecret, url }`; `OfficeHub.occupantOf(userId): OfficeOccupant | null`.

- [ ] **Step 1: Instalar o SDK**

```bash
pnpm --filter @legends/api add livekit-server-sdk@^2
```

- [ ] **Step 2: Escrever o teste falhando**

`apps/api/src/routes/office-media.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { officeHub, type OfficeSocket } from '../lib/office-hub'
import { OFFICE_OPEN_ROOM } from '@legends/shared'

const sink: OfficeSocket = { send: () => {} }

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
}

beforeEach(() => {
  officeHub.reset()
})

async function createUserAndToken(app: ReturnType<typeof buildApp>) {
  const user = await prisma.user.create({
    data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', role: 'LEGEND' },
  })
  const token = app.jwt.sign({ sub: user.id, role: 'LEGEND' })
  return { user, token }
}

describe('POST /office/media-token', () => {
  it('recusa sem autenticação', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      payload: { room: OFFICE_OPEN_ROOM },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('409 se a pessoa não está no escritório', async () => {
    const app = buildApp()
    const { token } = await createUserAndToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { room: OFFICE_OPEN_ROOM },
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('403 se a sala pedida não corresponde à posição real', async () => {
    const app = buildApp()
    const { user, token } = await createUserAndToken(app)
    officeHub.join(sink, { id: user.id, name: user.name, avatarOptions: null })
    // spawn é espaço aberto — pedir sala de reunião é mentira
    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { room: 'office-zone-reuniao-2' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('200 no espaço aberto: token com grant para office-open e identity = userId', async () => {
    const app = buildApp()
    const { user, token } = await createUserAndToken(app)
    officeHub.join(sink, { id: user.id, name: user.name, avatarOptions: null })

    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { room: OFFICE_OPEN_ROOM },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { token: string; url: string }
    expect(body.url).toBeTruthy()
    const payload = decodeJwtPayload(body.token)
    expect(payload.sub).toBe(user.id)
    expect(payload.video).toMatchObject({ roomJoin: true, room: OFFICE_OPEN_ROOM })
    await app.close()
  })

  it('200 dentro da sala: andar até a reunião-2 autoriza a sala dela', async () => {
    const app = buildApp()
    const { user, token } = await createUserAndToken(app)
    officeHub.join(sink, { id: user.id, name: user.name, avatarOptions: null })

    // do spawn (linhas 14-15, colunas 11-13) até dentro da sala 2: desce à
    // linha 15 se preciso e anda pra direita atravessando a porta (16,15).
    // Burst do rate limit é 10 — cabem os ≤ 7 passos sem esperar relógio.
    let occ = officeHub.occupantOf(user.id)!
    if (occ.y === 14) officeHub.move(sink, user.id, 'down')
    for (let i = 0; i < 8 && officeHub.occupantOf(user.id)!.x < 17; i += 1) {
      officeHub.move(sink, user.id, 'right')
    }
    occ = officeHub.occupantOf(user.id)!
    expect(occ.x).toBeGreaterThanOrEqual(17) // realmente entrou na sala

    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { room: 'office-zone-reuniao-2' },
    })
    expect(res.statusCode).toBe(200)
    const payload = decodeJwtPayload((res.json() as { token: string }).token)
    expect(payload.video).toMatchObject({ roomJoin: true, room: 'office-zone-reuniao-2' })

    // e o aberto agora é negado — a pessoa não está mais lá
    const open = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { room: OFFICE_OPEN_ROOM },
    })
    expect(open.statusCode).toBe(403)
    await app.close()
  })

  it('400 com body inválido', async () => {
    const app = buildApp()
    const { token } = await createUserAndToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { sala: 'x' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api test src/routes/office-media.test.ts`
Expected: FAIL — rota não existe (404) e `occupantOf` não existe.

- [ ] **Step 4: Config do LiveKit**

Adicionar ao final de `apps/api/src/lib/config.ts` (mesmo padrão do `resolveJwtSecret`):

```ts
export interface LivekitConfig {
  apiKey: string
  apiSecret: string
  /** URL que os NAVEGADORES usam para conectar (dev: ws://localhost:7880). */
  url: string
}

export function resolveLivekitConfig(env: {
  NODE_ENV?: string
  LIVEKIT_API_KEY?: string
  LIVEKIT_API_SECRET?: string
  LIVEKIT_URL?: string
}): LivekitConfig {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = env
  if (LIVEKIT_API_KEY && LIVEKIT_API_SECRET && LIVEKIT_URL) {
    return { apiKey: LIVEKIT_API_KEY, apiSecret: LIVEKIT_API_SECRET, url: LIVEKIT_URL }
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('LIVEKIT_API_KEY, LIVEKIT_API_SECRET e LIVEKIT_URL são obrigatórios em produção')
  }
  // Defaults do container `livekit-server --dev`
  return {
    apiKey: LIVEKIT_API_KEY ?? 'devkey',
    apiSecret: LIVEKIT_API_SECRET ?? 'secret',
    url: LIVEKIT_URL ?? 'ws://localhost:7880',
  }
}
```

- [ ] **Step 5: `occupantOf` no hub**

Em `apps/api/src/lib/office-hub.ts`, adicionar após o método `occupants()`:

```ts
  /** Posição atual de um usuário no escritório, ou null se não está nele. */
  occupantOf(userId: string): OfficeOccupant | null {
    const entry = this.entries.get(userId)
    return entry ? { ...entry.occupant } : null
  }
```

- [ ] **Step 6: A rota**

`apps/api/src/routes/office-media.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AccessToken } from 'livekit-server-sdk'
import { officeRoomAt, type OfficeMediaTokenResponse } from '@legends/shared'
import { officeHub } from '../lib/office-hub'
import { resolveLivekitConfig } from '../lib/config'

const bodySchema = z.object({ room: z.string().min(1) })

/**
 * Assina tokens do LiveKit. A autorização é a POSIÇÃO REAL no office-hub:
 * só sai token para a sala que corresponde ao tile onde a pessoa está —
 * é isso que torna o isolamento acústico das zonas estrutural.
 */
export async function officeMediaRoutes(app: FastifyInstance) {
  const livekit = resolveLivekitConfig(process.env)

  app.post('/office/media-token', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }

    const occupant = officeHub.occupantOf(request.user.sub)
    if (!occupant) {
      return reply.code(409).send({ message: 'Entre no escritório antes de conectar a mídia' })
    }

    const allowed = officeRoomAt(occupant.x, occupant.y)
    if (parsed.data.room !== allowed) {
      return reply.code(403).send({ message: 'Você não está nessa sala' })
    }

    const accessToken = new AccessToken(livekit.apiKey, livekit.apiSecret, {
      identity: occupant.userId,
      name: occupant.name,
      ttl: '1h',
    })
    accessToken.addGrant({ roomJoin: true, room: parsed.data.room })

    const response: OfficeMediaTokenResponse = {
      token: await accessToken.toJwt(),
      url: livekit.url,
    }
    return reply.send(response)
  })
}
```

Em `apps/api/src/app.ts`: import `officeMediaRoutes` junto aos outros e `app.register(officeMediaRoutes)` logo após `app.register(officeWsRoutes)`.

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @legends/api test src/routes/office-media.test.ts`
Expected: PASS — 6 testes.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/lib/config.ts apps/api/src/lib/office-hub.ts apps/api/src/routes/office-media.ts apps/api/src/routes/office-media.test.ts apps/api/src/app.ts
git commit -m "feat(api): token de mídia do LiveKit autorizado pela posição no escritório"
```

---

### Task 3: Infra — LiveKit em dev e produção

> **SUBSTITUÍDA (14/07, decisão do time): conectamos a um LiveKit JÁ EXISTENTE.**
> Nada desta task deve ser executado — o commit dela (`ad247b4`) foi revertido
> em `dd70712`. O que restou: documentação das envs no `apps/api/.env.example`
> apontando para o servidor existente (feito fora de task). Dev e produção
> configuram `LIVEKIT_API_KEY/SECRET/URL` no `.env`; navegadores conectam
> direto no servidor. Os passos abaixo ficam só como registro histórico.

Sem teste automatizado (são arquivos de config); verificação é subir e bater na porta.

**Files:**
- Modify: `docker-compose.yml` (serviço `livekit`)
- Modify: `apps/api/.env.example` (variáveis LIVEKIT_*)
- Modify: `nginx/default.conf` (proxy `/livekit/`)
- Modify: `start.sh` (container do LiveKit em produção)

**Interfaces:**
- Consumes: nada de código.
- Produces: LiveKit dev em `ws://localhost:7880` (keys `devkey`/`secret`); produção em `wss://<host>/livekit`.

- [ ] **Step 1: docker-compose (dev)**

Adicionar ao `docker-compose.yml`, dentro de `services:` (irmão de `db:`):

```yaml
  livekit:
    image: livekit/livekit-server:v1.8
    container_name: legends-livekit
    restart: unless-stopped
    command: --dev --bind 0.0.0.0
    ports:
      - "7880:7880"
      - "7881:7881"
      - "50000-50100:50000-50100/udp"
```

- [ ] **Step 2: .env.example**

Adicionar ao final de `apps/api/.env.example`:

```
# LiveKit (mídia do escritório). Em dev os defaults do modo --dev funcionam.
# Em produção os três são obrigatórios; LIVEKIT_URL é a URL que os NAVEGADORES
# usam (ex.: wss://legends.exemplo.com/livekit).
#LIVEKIT_API_KEY=devkey
#LIVEKIT_API_SECRET=secret
#LIVEKIT_URL=ws://localhost:7880
```

- [ ] **Step 3: nginx (produção)**

Em `nginx/default.conf`, adicionar após o bloco `location /highlights/`:

```nginx
  # Sinalização WebSocket do LiveKit (mídia do escritório). A mídia em si vai
  # por UDP direto ao host — só o WS de sinal passa pelo nginx.
  location /livekit/ {
    proxy_pass http://127.0.0.1:7880/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
  }
```

- [ ] **Step 4: start.sh (produção)**

Em `start.sh`, logo após a definição de `ENV_FILE` (antes do `docker build`), adicionar:

```bash
# Carrega as variáveis (LIVEKIT_*) para configurar o container de mídia
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# LiveKit (mídia do escritório virtual) — container próprio, rede do host
# (a mídia usa um range UDP; host networking evita mapear porta a porta).
docker stop legends-livekit || true
docker rm legends-livekit || true
docker run -d \
  --name legends-livekit \
  --restart unless-stopped \
  --network host \
  -e LIVEKIT_KEYS="${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}" \
  livekit/livekit-server:v1.8 \
  --bind 0.0.0.0
```

- [ ] **Step 5: Verificar**

```bash
docker compose config -q            # compose válido
pnpm db:up                          # sobe db + livekit
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:7880   # 200 (página do livekit)
bash -n start.sh                    # sintaxe do script
```
Expected: compose válido, `200`, sintaxe ok.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml apps/api/.env.example nginx/default.conf start.sh
git commit -m "chore(infra): LiveKit server em dev (compose) e produção (start.sh + nginx)"
```

---

### Task 4: Web — hook `useOfficeMedia`

O dono do objeto `Room` do LiveKit. Deriva a sala da posição confirmada, troca com estabilidade de 500 ms, publica o mic mutado, e no `office-open` assina/desassina por distância.

> **NOTA (review da execução):** o código abaixo tem duas corridas corrigidas
> no commit `874654b` — `connectTo` ganhou **guarda de geração**
> (`generationRef`: cada invocação captura `++generationRef.current` e aborta
> após cada `await` se foi superada; unmount e troca de sala invalidam as
> gerações antigas). Sem isso, connects sobrepostos se clobberavam e um
> unmount durante connect pendente vazava Room/mic. O arquivo real é a
> referência; este bloco ficou como registro do desenho original.

**Files:**
- Modify: `apps/web/package.json` (dependência `livekit-client`)
- Create: `apps/web/src/office/media/useOfficeMedia.ts`
- Create: `apps/web/src/office/media/useOfficeMedia.test.ts`

**Interfaces:**
- Consumes: `OFFICE_OPEN_ROOM`, `officeRoomAt`, `isWithinProximity`, `OfficeOccupant`, `OfficeMediaTokenResponse` de `@legends/shared`; `apiFetch` de `../../lib/api`; `livekit-client`.
- Produces: `useOfficeMedia(occupants: OfficeOccupant[], youId: string | null, connected: boolean): OfficeMediaState`, com `OfficeMediaState = { status: 'off'|'connecting'|'connected'|'error'; roomName: string | null; micEnabled: boolean; micError: boolean; cameraEnabled: boolean; screenShareEnabled: boolean; remotes: RemoteMedia[]; toggleMic(): Promise<void>; toggleCamera(): Promise<void>; toggleScreenShare(): Promise<void> }` e `RemoteMedia = { userId: string; name: string; audioTrack: RemoteAudioTrack | null; cameraTrack: RemoteVideoTrack | null; screenTrack: RemoteVideoTrack | null }`.

- [ ] **Step 1: Instalar o SDK**

```bash
pnpm --filter @legends/web add livekit-client@^2
```

- [ ] **Step 2: Escrever o teste falhando**

`apps/web/src/office/media/useOfficeMedia.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { OfficeOccupant } from '@legends/shared'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))

// ---- fake do livekit-client -------------------------------------------------
class FakeTrack {
  isMuted = false
  async mute() { this.isMuted = true; return this }
  async unmute() { this.isMuted = false; return this }
}
const createLocalAudioTrackMock = vi.fn(async () => new FakeTrack())

class FakeLocalParticipant {
  published: FakeTrack[] = []
  async publishTrack(track: FakeTrack) { this.published.push(track) }
  async setCameraEnabled(_: boolean) {}
  async setScreenShareEnabled(_: boolean) {}
}

class FakeRoom {
  static instances: FakeRoom[] = []
  handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  remoteParticipants = new Map<string, FakeParticipant>()
  localParticipant = new FakeLocalParticipant()
  connectCalls: Array<{ url: string; token: string; opts: { autoSubscribe: boolean } }> = []
  disconnected = false
  constructor() { FakeRoom.instances.push(this) }
  on(event: string, handler: (...args: unknown[]) => void) {
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

interface FakePub {
  isSubscribed: boolean
  source: string
  track: null
  setSubscribed: ReturnType<typeof vi.fn>
}
class FakeParticipant {
  trackPublications = new Map<string, FakePub>()
  constructor(public identity: string, public name: string) {}
}

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
// -----------------------------------------------------------------------------

import { useOfficeMedia } from './useOfficeMedia'

function occupant(userId: string, x: number, y: number): OfficeOccupant {
  return { userId, name: userId, x, y, dir: 'down', skinColor: 'edb98a', clothingColor: '8fa7df' }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeRoom.instances = []
  apiFetchMock.mockReset()
  createLocalAudioTrackMock.mockClear()
  apiFetchMock.mockImplementation(async (_path: string, opts: { body: string }) => ({
    token: `tk-${(JSON.parse(opts.body) as { room: string }).room}`,
    url: 'ws://livekit.test',
  }))
})
afterEach(() => {
  vi.useRealTimers()
})

async function settle(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useOfficeMedia', () => {
  it('conecta em office-open (autoSubscribe off) e publica o mic MUTADO', async () => {
    const occ = [occupant('you', 12, 14)] // spawn: espaço aberto
    renderHook(() => useOfficeMedia(occ, 'you', true))
    await settle(600)

    expect(apiFetchMock).toHaveBeenCalledWith(
      '/office/media-token',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ room: 'office-open' }) }),
    )
    const room = FakeRoom.instances.at(-1)!
    expect(room.connectCalls[0]).toMatchObject({ url: 'ws://livekit.test', token: 'tk-office-open', opts: { autoSubscribe: false } })
    // mic pediu permissão, foi mutado ANTES de publicar, e está publicado
    expect(createLocalAudioTrackMock).toHaveBeenCalledOnce()
    expect(room.localParticipant.published).toHaveLength(1)
    expect(room.localParticipant.published[0].isMuted).toBe(true)
  })

  it('troca para a sala da zona quando a posição fica estável dentro dela', async () => {
    const { rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 12, 14)] },
    })
    await settle(600)
    const openRoom = FakeRoom.instances.at(-1)!

    rerender({ occ: [occupant('you', 18, 15)] }) // dentro da reuniao-2
    await settle(600)

    expect(openRoom.disconnected).toBe(true)
    const zoneRoom = FakeRoom.instances.at(-1)!
    expect(zoneRoom.connectCalls[0]).toMatchObject({ token: 'tk-office-zone-reuniao-2', opts: { autoSubscribe: true } })
  })

  it('flap mais curto que a estabilidade não troca de sala', async () => {
    const { rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 12, 14)] },
    })
    await settle(600)
    expect(FakeRoom.instances).toHaveLength(1)

    rerender({ occ: [occupant('you', 18, 15)] })  // pisa na sala…
    await settle(200)                              // …menos que 500 ms…
    rerender({ occ: [occupant('you', 12, 14)] })  // …e volta
    await settle(600)

    expect(FakeRoom.instances).toHaveLength(1) // nenhuma reconexão
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
  })

  it('no office-open assina quem está perto e desassina quem se afasta', async () => {
    const near = new FakeParticipant('bob', 'bob')
    const nearPub: FakePub = { isSubscribed: false, source: 'microphone', track: null, setSubscribed: vi.fn() }
    near.trackPublications.set('a', nearPub)

    const { rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 10, 5), occupant('bob', 12, 5)] }, // dist 2 ≤ 3
    })
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    room.remoteParticipants.set('bob', near)
    act(() => room.emit('trackPublished'))
    expect(nearPub.setSubscribed).toHaveBeenLastCalledWith(true)

    nearPub.isSubscribed = true
    rerender({ occ: [occupant('you', 10, 5), occupant('bob', 20, 5)] }) // dist 10 > 3
    expect(nearPub.setSubscribed).toHaveBeenLastCalledWith(false)
  })

  it('permissão de mic negada não derruba a conexão (segue como ouvinte)', async () => {
    createLocalAudioTrackMock.mockRejectedValueOnce(new Error('NotAllowedError'))
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)

    expect(result.current.status).toBe('connected')
    expect(result.current.micError).toBe(true)
    expect(result.current.micEnabled).toBe(false)
  })

  it('falha no token entra em erro e tenta de novo com backoff', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('LiveKit fora'))
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)
    expect(result.current.status).toBe('error')

    await settle(2100) // primeiro backoff (2s)
    expect(result.current.status).toBe('connected')
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test src/office/media/useOfficeMedia.test.ts`
Expected: FAIL — `Cannot find module './useOfficeMedia'`.

- [ ] **Step 4: Implementar o hook**

`apps/web/src/office/media/useOfficeMedia.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type LocalAudioTrack,
  type RemoteAudioTrack,
  type RemoteVideoTrack,
} from 'livekit-client'
import {
  OFFICE_OPEN_ROOM,
  officeRoomAt,
  isWithinProximity,
  type OfficeOccupant,
  type OfficeMediaTokenResponse,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'

/** Estabilidade exigida antes de trocar de sala — parado na porta não flapa. */
const ROOM_STABILITY_MS = 500
const MAX_RETRY_MS = 15000

export type OfficeMediaStatus = 'off' | 'connecting' | 'connected' | 'error'

export interface RemoteMedia {
  userId: string
  name: string
  audioTrack: RemoteAudioTrack | null
  cameraTrack: RemoteVideoTrack | null
  screenTrack: RemoteVideoTrack | null
}

export interface OfficeMediaState {
  status: OfficeMediaStatus
  roomName: string | null
  micEnabled: boolean
  micError: boolean
  cameraEnabled: boolean
  screenShareEnabled: boolean
  remotes: RemoteMedia[]
  toggleMic(): Promise<void>
  toggleCamera(): Promise<void>
  toggleScreenShare(): Promise<void>
}

/**
 * Dono do objeto `Room` do LiveKit. A sala segue a posição CONFIRMADA pelo
 * servidor (occupants vem do WS do escritório): zona → sala da zona; espaço
 * aberto → `office-open` com assinatura manual por proximidade. O servidor
 * continua autoritativo — aqui não se inventa posição nem se conecta a sala
 * que a API não autorizou.
 */
export function useOfficeMedia(
  occupants: OfficeOccupant[],
  youId: string | null,
  connected: boolean,
): OfficeMediaState {
  const [status, setStatus] = useState<OfficeMediaStatus>('off')
  const [roomName, setRoomName] = useState<string | null>(null)
  const [micEnabled, setMicEnabled] = useState(false)
  const [micError, setMicError] = useState(false)
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [screenShareEnabled, setScreenShareEnabled] = useState(false)
  const [remotes, setRemotes] = useState<RemoteMedia[]>([])
  const [stableRoom, setStableRoom] = useState<string | null>(null)

  const roomRef = useRef<Room | null>(null)
  const targetRoomRef = useRef<string | null>(null)
  const micTrackRef = useRef<LocalAudioTrack | null>(null)
  const retryRef = useRef<{ attempts: number; timer: ReturnType<typeof setTimeout> | null }>({
    attempts: 0,
    timer: null,
  })
  const occupantsRef = useRef(occupants)
  occupantsRef.current = occupants
  const youIdRef = useRef(youId)
  youIdRef.current = youId

  const you = occupants.find((o) => o.userId === youId) ?? null
  const desiredRoom = connected && you ? officeRoomAt(you.x, you.y) : null

  // Só aplica a troca depois de ROOM_STABILITY_MS com a mesma sala desejada.
  useEffect(() => {
    if (desiredRoom === stableRoom) return
    const timer = setTimeout(() => setStableRoom(desiredRoom), ROOM_STABILITY_MS)
    return () => clearTimeout(timer)
  }, [desiredRoom, stableRoom])

  /** Reconstrói `remotes` a partir do que está assinado agora. */
  const syncRemotes = useCallback(() => {
    const room = roomRef.current
    if (!room) {
      setRemotes([])
      return
    }
    const next: RemoteMedia[] = []
    for (const participant of room.remoteParticipants.values()) {
      const media: RemoteMedia = {
        userId: participant.identity,
        name: participant.name ?? participant.identity,
        audioTrack: null,
        cameraTrack: null,
        screenTrack: null,
      }
      for (const pub of participant.trackPublications.values()) {
        if (!pub.isSubscribed || !pub.track) continue
        if (pub.source === Track.Source.Microphone) media.audioTrack = pub.track as RemoteAudioTrack
        else if (pub.source === Track.Source.Camera) media.cameraTrack = pub.track as RemoteVideoTrack
        else if (pub.source === Track.Source.ScreenShare) media.screenTrack = pub.track as RemoteVideoTrack
      }
      next.push(media)
    }
    setRemotes(next)
  }, [])

  /** No espaço aberto, assinatura segue a distância; nas zonas é autoSubscribe. */
  const applyProximity = useCallback(() => {
    const room = roomRef.current
    if (!room || targetRoomRef.current !== OFFICE_OPEN_ROOM) return
    const me = occupantsRef.current.find((o) => o.userId === youIdRef.current)
    if (!me) return
    for (const participant of room.remoteParticipants.values()) {
      const occupant = occupantsRef.current.find((o) => o.userId === participant.identity)
      const within = !!occupant && isWithinProximity(me.x, me.y, occupant.x, occupant.y)
      for (const pub of participant.trackPublications.values()) {
        if (pub.isSubscribed !== within) pub.setSubscribed(within)
      }
    }
  }, [])

  const connectTo = useCallback(
    async (target: string) => {
      void roomRef.current?.disconnect()
      roomRef.current = null
      micTrackRef.current = null
      targetRoomRef.current = target
      setRemotes([])
      setStatus('connecting')
      try {
        const { token, url } = await apiFetch<OfficeMediaTokenResponse>('/office/media-token', {
          method: 'POST',
          body: JSON.stringify({ room: target }),
        })
        const room = new Room()
        room
          .on(RoomEvent.ParticipantConnected, () => {
            applyProximity()
            syncRemotes()
          })
          .on(RoomEvent.ParticipantDisconnected, syncRemotes)
          .on(RoomEvent.TrackPublished, () => {
            applyProximity()
            syncRemotes()
          })
          .on(RoomEvent.TrackUnpublished, syncRemotes)
          .on(RoomEvent.TrackSubscribed, syncRemotes)
          .on(RoomEvent.TrackUnsubscribed, syncRemotes)
        await room.connect(url, token, { autoSubscribe: target !== OFFICE_OPEN_ROOM })
        roomRef.current = room
        retryRef.current.attempts = 0
        setRoomName(target)
        setStatus('connected')
        setMicEnabled(false)
        setCameraEnabled(false)
        setScreenShareEnabled(false)

        // Mic publicado MUTADO: pede a permissão uma vez; negar vira aviso,
        // nunca derruba a conexão — a pessoa segue como ouvinte.
        try {
          const track = await createLocalAudioTrack()
          await track.mute()
          await room.localParticipant.publishTrack(track)
          micTrackRef.current = track
          setMicError(false)
        } catch {
          setMicError(true)
        }

        applyProximity()
        syncRemotes()
      } catch {
        setStatus('error')
        const attempts = (retryRef.current.attempts += 1)
        retryRef.current.timer = setTimeout(
          () => void connectTo(target),
          Math.min(1000 * 2 ** attempts, MAX_RETRY_MS),
        )
      }
    },
    [applyProximity, syncRemotes],
  )

  // Conecta/desconecta quando a sala estável muda.
  useEffect(() => {
    if (retryRef.current.timer) {
      clearTimeout(retryRef.current.timer)
      retryRef.current.timer = null
    }
    retryRef.current.attempts = 0
    if (!stableRoom) {
      void roomRef.current?.disconnect()
      roomRef.current = null
      targetRoomRef.current = null
      setStatus('off')
      setRoomName(null)
      setRemotes([])
      return
    }
    void connectTo(stableRoom)
  }, [stableRoom, connectTo])

  // Proximidade re-avaliada a cada atualização de posições.
  useEffect(() => {
    applyProximity()
  }, [occupants, applyProximity])

  // Unmount: derruba tudo.
  useEffect(
    () => () => {
      if (retryRef.current.timer) clearTimeout(retryRef.current.timer)
      void roomRef.current?.disconnect()
      roomRef.current = null
    },
    [],
  )

  const toggleMic = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    const track = micTrackRef.current
    if (!track) {
      // Permissão negada antes — tentar de novo é o "tentar novamente" da barra.
      try {
        const fresh = await createLocalAudioTrack()
        await room.localParticipant.publishTrack(fresh)
        micTrackRef.current = fresh
        setMicError(false)
        setMicEnabled(true)
      } catch {
        setMicError(true)
      }
      return
    }
    if (track.isMuted) {
      await track.unmute()
      setMicEnabled(true)
    } else {
      await track.mute()
      setMicEnabled(false)
    }
  }, [])

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    const next = !cameraEnabled
    try {
      await room.localParticipant.setCameraEnabled(next)
      setCameraEnabled(next)
    } catch {
      setCameraEnabled(false)
    }
  }, [cameraEnabled])

  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    const next = !screenShareEnabled
    try {
      await room.localParticipant.setScreenShareEnabled(next)
      setScreenShareEnabled(next)
    } catch {
      setScreenShareEnabled(false)
    }
  }, [screenShareEnabled])

  return {
    status,
    roomName,
    micEnabled,
    micError,
    cameraEnabled,
    screenShareEnabled,
    remotes,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/web test src/office/media/useOfficeMedia.test.ts`
Expected: PASS — 6 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/office/media/useOfficeMedia.ts apps/web/src/office/media/useOfficeMedia.test.ts
git commit -m "feat(web): hook de mídia do escritório (sala pela posição + proximidade)"
```

---

### Task 5: Web — barra de mídia, tiles, página e zonas no canvas

**Files:**
- Create: `apps/web/src/office/media/MediaBar.tsx`
- Create: `apps/web/src/office/media/MediaBar.test.tsx`
- Create: `apps/web/src/office/media/MediaTiles.tsx`
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Modify: `apps/web/src/pages/OfficePage.test.tsx`
- Modify: `apps/web/src/office/scenes/OfficeScene.ts` (tint + nome das zonas)

**Interfaces:**
- Consumes: `useOfficeMedia`, `OfficeMediaState`, `RemoteMedia` (task 4); `zoneAt`, `OFFICE_ZONES`, `TILE_SIZE` de `@legends/shared`.
- Produces: `MediaBar({ media, zoneName })`, `MediaTiles({ remotes })`.

- [ ] **Step 1: Escrever o teste da barra (falhando)**

`apps/web/src/office/media/MediaBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MediaBar } from './MediaBar'
import type { OfficeMediaState } from './useOfficeMedia'

function mediaState(overrides: Partial<OfficeMediaState> = {}): OfficeMediaState {
  return {
    status: 'connected',
    roomName: 'office-open',
    micEnabled: false,
    micError: false,
    cameraEnabled: false,
    screenShareEnabled: false,
    remotes: [],
    toggleMic: vi.fn(async () => {}),
    toggleCamera: vi.fn(async () => {}),
    toggleScreenShare: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('MediaBar', () => {
  it('nasce mutado e o botão ativa o microfone', () => {
    const media = mediaState()
    render(<MediaBar media={media} zoneName={null} />)
    const mic = screen.getByRole('button', { name: 'Ativar microfone' })
    fireEvent.click(mic)
    expect(media.toggleMic).toHaveBeenCalledOnce()
  })

  it('mostra a zona atual e o estado dos toggles', () => {
    render(
      <MediaBar
        media={mediaState({ micEnabled: true, screenShareEnabled: true })}
        zoneName="Sala de Reunião 1"
      />,
    )
    expect(screen.getByText('Você está em: Sala de Reunião 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Silenciar microfone' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Parar de compartilhar' })).toBeInTheDocument()
  })

  it('avisa quando a permissão do mic foi negada e quando está sem áudio', () => {
    render(<MediaBar media={mediaState({ micError: true, status: 'error' })} zoneName={null} />)
    expect(screen.getByText('Permissão de microfone negada')).toBeInTheDocument()
    expect(screen.getByText('Sem áudio — tentando reconectar')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test src/office/media/MediaBar.test.tsx`
Expected: FAIL — `Cannot find module './MediaBar'`.

- [ ] **Step 3: Implementar a barra**

`apps/web/src/office/media/MediaBar.tsx`:

```tsx
import type { OfficeMediaState } from './useOfficeMedia'

const toggleCls = (active: boolean) =>
  `rounded-md px-md py-sm font-label text-label-md transition-colors ${
    active
      ? 'bg-primary text-on-primary'
      : 'bg-surface-container-highest text-on-surface hover:bg-surface-container-high'
  }`

export function MediaBar({ media, zoneName }: { media: OfficeMediaState; zoneName: string | null }) {
  const statusLabel =
    media.status === 'connected'
      ? zoneName
        ? `Você está em: ${zoneName}`
        : 'Áudio por proximidade'
      : media.status === 'connecting'
        ? 'Conectando áudio…'
        : media.status === 'error'
          ? 'Sem áudio — tentando reconectar'
          : 'Áudio desligado'

  return (
    <div className="flex flex-wrap items-center gap-sm rounded-lg bg-surface-container p-md">
      <button
        type="button"
        className={toggleCls(media.micEnabled)}
        onClick={() => void media.toggleMic()}
      >
        {media.micEnabled ? 'Silenciar microfone' : 'Ativar microfone'}
      </button>
      <button
        type="button"
        className={toggleCls(media.cameraEnabled)}
        onClick={() => void media.toggleCamera()}
      >
        {media.cameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}
      </button>
      <button
        type="button"
        className={toggleCls(media.screenShareEnabled)}
        onClick={() => void media.toggleScreenShare()}
      >
        {media.screenShareEnabled ? 'Parar de compartilhar' : 'Compartilhar tela'}
      </button>
      <span className="ml-auto font-label text-label-sm text-on-surface-variant">{statusLabel}</span>
      {media.micError && (
        <span className="font-label text-label-sm text-error">Permissão de microfone negada</span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web test src/office/media/MediaBar.test.tsx`
Expected: PASS — 3 testes.

- [ ] **Step 5: Tiles de mídia (áudio invisível, vídeos, tela expansível)**

`apps/web/src/office/media/MediaTiles.tsx` (sem teste próprio: attach/detach de track é DOM imperativo do SDK — coberto pela verificação manual; a lógica de estado já está testada no hook):

```tsx
import { useEffect, useRef, useState } from 'react'
import type { RemoteAudioTrack, RemoteVideoTrack } from 'livekit-client'
import type { RemoteMedia } from './useOfficeMedia'

/** Anexa um track de áudio a um <audio> invisível enquanto montado. */
function RemoteAudio({ track }: { track: RemoteAudioTrack }) {
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

function RemoteVideo({ track, label, onClick }: { track: RemoteVideoTrack; label: string; onClick?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])
  return (
    <figure className="w-40 shrink-0 cursor-pointer" onClick={onClick}>
      <video ref={ref} autoPlay playsInline className="w-full rounded-md bg-black" />
      <figcaption className="truncate font-label text-label-sm text-on-surface-variant">{label}</figcaption>
    </figure>
  )
}

/**
 * Faixa com a mídia de quem você assina agora: áudios invisíveis, câmeras e
 * telas compartilhadas. Clicar numa tela expande num overlay.
 */
export function MediaTiles({ remotes }: { remotes: RemoteMedia[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const expanded = remotes.find((r) => r.userId === expandedId)?.screenTrack ?? null

  const hasVisible = remotes.some((r) => r.cameraTrack || r.screenTrack)

  return (
    <div>
      {remotes.map((r) => r.audioTrack && <RemoteAudio key={`a-${r.userId}`} track={r.audioTrack} />)}

      {hasVisible && (
        <div className="flex gap-md overflow-x-auto rounded-lg bg-surface-container p-md">
          {remotes.map((r) => (
            <div key={r.userId} className="flex gap-md">
              {r.cameraTrack && <RemoteVideo track={r.cameraTrack} label={r.name} />}
              {r.screenTrack && (
                <RemoteVideo
                  track={r.screenTrack}
                  label={`Tela de ${r.name}`}
                  onClick={() => setExpandedId(r.userId)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-lg"
          onClick={() => setExpandedId(null)}
          role="dialog"
          aria-label="Tela compartilhada em destaque"
        >
          <RemoteVideo track={expanded} label="Clique para fechar" />
        </div>
      )}
    </div>
  )
}
```

Nota: o `RemoteVideo` do overlay reusa o mesmo track — o LiveKit permite attach em mais de um elemento.

- [ ] **Step 6: Zonas visíveis no canvas**

Em `apps/web/src/office/scenes/OfficeScene.ts`:

1. adicionar `OFFICE_ZONES` ao import de `@legends/shared`;
2. no `create()`, logo após o `forEach` que desenha o tilemap, inserir:

```ts
    // Zonas demarcadas: tint sutil + nome. Só visual — a regra de sala/som
    // vive no shared (zoneAt) e no servidor; a cena não decide nada de mídia.
    for (const zone of OFFICE_ZONES) {
      const zx = zone.x0 * TILE_SIZE
      const zy = zone.y0 * TILE_SIZE
      const zw = (zone.x1 - zone.x0 + 1) * TILE_SIZE
      const zh = (zone.y1 - zone.y0 + 1) * TILE_SIZE
      this.add.rectangle(zx + zw / 2, zy + zh / 2, zw, zh, 0x7de3a0, 0.06)
      this.add.text(zx + 4, zy + 2, zone.name, {
        fontFamily: 'sans-serif',
        fontSize: '9px',
        color: '#9ae6b4',
      })
    }
```

- [ ] **Step 7: Ligar tudo na página**

Em `apps/web/src/pages/OfficePage.tsx`, substituir o arquivo por:

```tsx
import { useRef } from 'react'
import { zoneAt } from '@legends/shared'
import { OfficeBridge } from '../office/OfficeBridge'
import { OfficeCanvas } from '../office/OfficeCanvas'
import { useOfficeSocket } from '../office/useOfficeSocket'
import { useOfficeMedia } from '../office/media/useOfficeMedia'
import { MediaBar } from '../office/media/MediaBar'
import { MediaTiles } from '../office/media/MediaTiles'

export function OfficePage() {
  // O bridge precisa sobreviver aos re-renders: se trocasse de identidade,
  // o efeito do socket e o jogo seriam recriados a cada render.
  const bridgeRef = useRef<OfficeBridge | null>(null)
  if (bridgeRef.current === null) bridgeRef.current = new OfficeBridge()
  const bridge = bridgeRef.current

  const { occupants, youId, connected } = useOfficeSocket(bridge)
  const media = useOfficeMedia(occupants, youId, connected)

  const you = occupants.find((o) => o.userId === youId) ?? null
  const zoneName = you ? (zoneAt(you.x, you.y)?.name ?? null) : null

  const count = occupants.length
  const countLabel =
    count === 1 ? '1 pessoa no escritório' : `${count} pessoas no escritório`

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-wrap items-center justify-between gap-md">
        <div>
          <h1 className="font-display text-headline-md text-on-surface">Escritório</h1>
          <p className="font-body text-body-md text-on-surface-variant">
            Use as setas ou WASD para andar. Aproxime-se de alguém para conversar.
          </p>
        </div>
        <span className="font-label text-label-md text-on-surface-variant">
          {connected ? countLabel : 'Conectando…'}
        </span>
      </header>

      <MediaBar media={media} zoneName={zoneName} />
      <MediaTiles remotes={media.remotes} />

      <div className="grid gap-lg lg:grid-cols-[1fr_240px]">
        <div className="aspect-[25/18] w-full">
          <OfficeCanvas bridge={bridge} />
        </div>

        <aside className="rounded-lg bg-surface-container p-md">
          <h2 className="mb-sm font-label text-label-lg text-on-surface">Por aqui agora</h2>
          <ul className="flex flex-col gap-xs">
            {occupants.map((occupant) => (
              <li
                key={occupant.userId}
                className="flex items-center gap-sm font-body text-body-md text-on-surface"
              >
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: `#${occupant.clothingColor}` }}
                />
                <span className="truncate">{occupant.name}</span>
                {occupant.userId === youId && (
                  <span className="font-label text-label-sm text-on-surface-variant">(você)</span>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Atualizar o teste da página**

Em `apps/web/src/pages/OfficePage.test.tsx`, adicionar junto aos mocks existentes (antes do `import { OfficePage }`):

```tsx
vi.mock('../office/media/useOfficeMedia', () => ({
  useOfficeMedia: () => ({
    status: 'connected',
    roomName: 'office-open',
    micEnabled: false,
    micError: false,
    cameraEnabled: false,
    screenShareEnabled: false,
    remotes: [],
    toggleMic: async () => {},
    toggleCamera: async () => {},
    toggleScreenShare: async () => {},
  }),
}))
```

E ao final do teste existente, acrescentar as asserções:

```tsx
    expect(screen.getByRole('button', { name: 'Ativar microfone' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compartilhar tela' })).toBeInTheDocument()
```

- [ ] **Step 9: Rodar as suítes e o build**

```bash
pnpm --filter @legends/web test
pnpm --filter @legends/api test
pnpm --filter @legends/shared test
pnpm build
```
Expected: tudo verde exceto as 2 falhas PRÉ-EXISTENTES do `ProfilePage.test.tsx`; build limpo com `phaser-*.js` e `livekit-client` fora do chunk principal (o `livekit-client` entra pelo `OfficePage`, que já é lazy).

- [ ] **Step 10: Verificação manual (dois navegadores)**

```bash
pnpm db:up      # sobe Postgres + LiveKit
pnpm dev
```
Com dois usuários do seed em dois navegadores, em `/escritorio`:
1. Ambos entram → barra mostra "Áudio por proximidade", mic mutado.
2. Desmutar os dois, aproximar (≤ 3 tiles) → um ouve o outro; afastar → silêncio.
3. Os dois entram na "Sala de Reunião 1" → conversam de qualquer ponto da sala; um terceiro do lado de fora, colado na parede, não ouve nada.
4. Ligar câmera → tile de vídeo aparece pro outro; compartilhar tela → tile de tela; clicar → expande.
5. Negar permissão de mic num navegador → continua conectado como ouvinte, aviso na barra.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/office/media/MediaBar.tsx apps/web/src/office/media/MediaBar.test.tsx apps/web/src/office/media/MediaTiles.tsx apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx apps/web/src/office/scenes/OfficeScene.ts
git commit -m "feat(web): barra de mídia, tiles e zonas visíveis no escritório"
```

---

## Depois do v1 (fora deste plano)

Fade de volume pela distância; pré-conexão na troca de sala (eliminar o gap ~1 s); trava/convite de sala; indicador de "falando" no canvas; gravação.
