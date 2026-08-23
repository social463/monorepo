# Ausente Automático na Sala de Silêncio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entrar numa sala de silêncio ("private-zone") muda o status de presença automaticamente para "Ausente" (revertendo ao sair); status "Ausente"/"Volto logo" bloqueia chamada direta e chat de proximidade nos dois sentidos; e as cores de "Ausente" (amarelo) e "Volto logo" (azul) são trocadas.

**Architecture:** Toda a lógica de status/zona/chamada é server-authoritative em `OfficeHub` (`apps/api/src/lib/office-hub.ts`), reaproveitando o helper `mapZoneAt` já usado por `roomForPosition`/`raiseHandZoneId`. O bloqueio de chat de proximidade é client-side em `useOfficeMedia.ts`, porque a assinatura de áudio por proximidade já é decidida no cliente (ganho por distância) — cada cliente roda o mesmo cálculo simétrico, então checar o status de "quem fala" e "quem ouve" localmente já cobre os dois sentidos sem round-trip extra ao servidor.

**Tech Stack:** TypeScript, Fastify (WebSocket hub), React, Vitest.

## Global Constraints

- Status de presença continua só em memória, por sessão — nenhuma mudança de persistência (schema.prisma inalterado).
- Bloqueio de áudio por status vale só no chat de proximidade do espaço aberto — dentro de salas de reunião (`meeting-room`) o áudio continua "todo mundo ouve todo mundo", sem checagem de status.
- Trocar status manualmente enquanto fisicamente dentro de uma `private-zone` sempre resulta em `'away'`, não importa o que foi pedido.

---

### Task 1: Contrato compartilhado — motivo `'away'` em `call-failed`

**Files:**
- Modify: `packages/shared/src/office.ts:288`
- Test: `packages/shared/src/office.test.ts`

**Interfaces:**
- Produz: `OfficeServerMessage` com `{ type: "call-failed"; targetUserId: string; reason: "offline" | "rate-limited" | "away" }` — usado pelas Tasks 3 e 4.

- [ ] **Step 1: Escrever o teste (tipo aceita o novo motivo)**

Em `packages/shared/src/office.test.ts`, adicionar ao final do arquivo:

```ts
describe('call-failed', () => {
  it('aceita o motivo "away" na união do servidor', () => {
    const message: OfficeServerMessage = { type: 'call-failed', targetUserId: 'ana', reason: 'away' }
    expect(message.reason).toBe('away')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha (erro de tipo)**

Run: `pnpm --filter @legends/shared exec vitest run src/office.test.ts`
Expected: FAIL — erro de compilação TypeScript, `reason: 'away'` não é atribuível a `"offline" | "rate-limited"`.

- [ ] **Step 3: Ampliar a união de motivos**

Em `packages/shared/src/office.ts:288`, mudar:

```ts
  | { type: "call-failed"; targetUserId: string; reason: "offline" | "rate-limited" }
```

para:

```ts
  | { type: "call-failed"; targetUserId: string; reason: "offline" | "rate-limited" | "away" }
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/shared exec vitest run src/office.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/office.ts packages/shared/src/office.test.ts
git commit -m "feat: adiciona motivo 'away' ao call-failed do escritório"
```

---

### Task 2: Auto status ao entrar/sair da sala de silêncio

**Files:**
- Modify: `apps/api/src/lib/office-hub.ts`
- Test: `apps/api/src/lib/office-hub.test.ts`

**Interfaces:**
- Consome: `mapZoneAt` (já importado no topo do arquivo), `entry.occupant.status: OfficeUserStatus`.
- Produz: broadcast `{ type: 'status-changed', userId, status: 'away' | 'online' }` ao cruzar a fronteira de uma `private-zone` andando. Consumido pela Task 3 (mesmo padrão de checagem de zona) e por qualquer cliente já escutando `status-changed`.

- [ ] **Step 1: Escrever o teste (entrar e sair da zona muda o status)**

Em `apps/api/src/lib/office-hub.test.ts`, adicionar um novo `describe`, próximo ao `describe('raiseHand', ...)` (por volta da linha 909), usando o mesmo padrão de fixture com `private-zone` já usado no teste "levantar dentro de uma zona privada" (linha 948):

```ts
describe('status automático na sala de silêncio', () => {
  const ZONE_TILE = { x: 5, y: 1 } // corredor aberto, longe das salas de reunião
  const OUTSIDE_TILE = { x: 6, y: 1 }

  function configureWithPrivateZone(): void {
    const runtime = legacyOfficeRuntimeFixture()
    runtime.document.objects.push({
      id: 'private-zona-1',
      layerKey: 'private-zones',
      type: 'private-zone',
      geometry: { kind: 'rectangle', x: ZONE_TILE.x * 32, y: ZONE_TILE.y * 32, width: 32, height: 32 },
      properties: { name: 'Zona privada de teste', externalKey: 'zona-1', accessPolicy: 'OPEN' },
    })
    hub.configure(runtime)
  }

  it('entrar na zona privada muda o status para away e avisa todo mundo', () => {
    configureWithPrivateZone()
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    walkTo(hub, a.socket, 'ana', ZONE_TILE)

    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('away')
    const expected = { type: 'status-changed', userId: 'ana', status: 'away' }
    expect(a.sent).toContainEqual(expected)
    expect(b.sent).toContainEqual(expected)
  })

  it('sair da zona privada reverte o status para online', () => {
    configureWithPrivateZone()
    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ZONE_TILE)
    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('away')

    walkTo(hub, a.socket, 'ana', OUTSIDE_TILE)

    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('online')
    expect(a.sent).toContainEqual({ type: 'status-changed', userId: 'ana', status: 'online' })
  })

  it('andar fora de qualquer zona privada não mexe no status', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ROOM1_OUTSIDE)

    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('online')
    expect(a.sent.some((m) => m.type === 'status-changed')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/api exec vitest run src/lib/office-hub.test.ts -t "status automático na sala de silêncio"`
Expected: FAIL — os dois primeiros testes falham porque o status nunca sai de `'online'` (nenhum `status-changed` é emitido); o terceiro já passa hoje (garante que a mudança não vai quebrá-lo).

- [ ] **Step 3: Implementar a detecção de transição em `move()`**

Em `apps/api/src/lib/office-hub.ts`, dentro de `move()`, seguindo o mesmo
padrão de `previousRoom`/`previousZoneId` (capturados **antes** da
reposição, com as coordenadas antigas): logo abaixo da linha
`const previousZoneId = this.raiseHandZoneId(entry.occupant.x, entry.occupant.y)`
(linha 259, coordenadas ainda antigas), adicionar:

```ts
    const wasInPrivateZone = this.runtime
      ? mapZoneAt(this.runtime.document, entry.occupant.x, entry.occupant.y)?.type === 'private-zone'
      : false
```

E depois de `this.broadcast({ type: 'moved', userId, x: targetX, y: targetY, dir, sprint })`
(linha 264), adicionar:

```ts

    // Ausente automático ao entrar numa sala de silêncio (private-zone);
    // reverte pra online ao sair. Trocas manuais enquanto dentro são
    // forçadas pra 'away' em setStatus().
    const nowInPrivateZone = this.runtime
      ? mapZoneAt(this.runtime.document, targetX, targetY)?.type === 'private-zone'
      : false
    if (nowInPrivateZone && !wasInPrivateZone) {
      entry.occupant.status = 'away'
      this.broadcast({ type: 'status-changed', userId, status: 'away' })
    } else if (!nowInPrivateZone && wasInPrivateZone) {
      entry.occupant.status = 'online'
      this.broadcast({ type: 'status-changed', userId, status: 'online' })
    }
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api exec vitest run src/lib/office-hub.test.ts -t "status automático na sala de silêncio"`
Expected: PASS (3 testes)

- [ ] **Step 5: Rodar a suíte completa do arquivo pra garantir que nada quebrou**

Run: `pnpm --filter @legends/api exec vitest run src/lib/office-hub.test.ts`
Expected: PASS (todos os testes, incluindo os de `move`, `raiseHand`, `room-presence` já existentes)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub.test.ts
git commit -m "feat: status vira ausente automaticamente na sala de silêncio"
```

---

### Task 3: Travar status manual dentro da sala de silêncio

**Files:**
- Modify: `apps/api/src/lib/office-hub.ts:487-497` (`setStatus`)
- Test: `apps/api/src/lib/office-hub.test.ts`

**Interfaces:**
- Consome: `mapZoneAt`, mesmo padrão de checagem de zona da Task 2.
- Produz: nenhuma interface nova — só altera o comportamento de `setStatus` já usado pelo client (`set-status` em `office-ws.ts`).

- [ ] **Step 1: Escrever o teste (setStatus dentro da zona força away)**

No `describe('setStatus', ...)` existente (`apps/api/src/lib/office-hub.test.ts:518`), adicionar:

```ts
  it('dentro da zona privada, pedir "brb" é ignorado e força "away"', () => {
    const runtime = legacyOfficeRuntimeFixture()
    runtime.document.objects.push({
      id: 'private-zona-1',
      layerKey: 'private-zones',
      type: 'private-zone',
      geometry: { kind: 'rectangle', x: 5 * 32, y: 1 * 32, width: 32, height: 32 },
      properties: { name: 'Zona privada de teste', externalKey: 'zona-1', accessPolicy: 'OPEN' },
    })
    hub.configure(runtime)

    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', { x: 5, y: 1 })

    hub.setStatus(a.socket, 'ana', 'brb')

    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('away')
    expect(a.sent).toContainEqual({ type: 'status-changed', userId: 'ana', status: 'away' })
  })
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/lib/office-hub.test.ts -t 'pedir "brb" é ignorado'`
Expected: FAIL — hoje `setStatus` grava `'brb'` sem checar a zona.

- [ ] **Step 3: Implementar a checagem em `setStatus`**

Em `apps/api/src/lib/office-hub.ts:487-497`, trocar:

```ts
  setStatus(socket: OfficeSocket, userId: string, status: OfficeUserStatus): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    entry.occupant.status = status
    this.broadcast({ type: 'status-changed', userId, status })
  }
```

por:

```ts
  setStatus(socket: OfficeSocket, userId: string, status: OfficeUserStatus): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    // Dentro da sala de silêncio o status fica travado em 'away' — ignora
    // qualquer troca manual (mesmo pra 'brb') enquanto a pessoa estiver lá.
    const inPrivateZone = this.runtime
      ? mapZoneAt(this.runtime.document, entry.occupant.x, entry.occupant.y)?.type === 'private-zone'
      : false
    const effectiveStatus = inPrivateZone ? 'away' : status
    entry.occupant.status = effectiveStatus
    this.broadcast({ type: 'status-changed', userId, status: effectiveStatus })
  }
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/lib/office-hub.test.ts -t 'setStatus'`
Expected: PASS (todos os testes de `setStatus`, incluindo os pré-existentes e o novo)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub.test.ts
git commit -m "feat: trava status manual em ausente dentro da sala de silêncio"
```

---

### Task 4: Bloquear chamada direta para quem está ausente/volto logo

**Files:**
- Modify: `apps/api/src/lib/office-hub.ts:518-540` (`call`)
- Test: `apps/api/src/lib/office-hub.test.ts`

**Interfaces:**
- Consome: `OfficeServerMessage` com `reason: 'away'` (Task 1).
- Produz: `call-failed` com `reason: 'away'`, consumido pela Task 5.

- [ ] **Step 1: Escrever o teste (chamar alguém ausente falha com reason 'away')**

No `describe('call', ...)` existente (`apps/api/src/lib/office-hub.test.ts:385`), adicionar:

```ts
  it('alvo ausente/volto logo → call-failed away para o chamador, sem entregar incoming-call', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    hub.setStatus(b.socket, 'bruno', 'away')

    hub.call(a.socket, 'ana', 'bruno')

    expect(a.sent).toContainEqual({ type: 'call-failed', targetUserId: 'bruno', reason: 'away' })
    expect(b.sent.some((m) => m.type === 'incoming-call')).toBe(false)
  })
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/lib/office-hub.test.ts -t 'alvo ausente/volto logo'`
Expected: FAIL — hoje a chamada é entregue normalmente, ignorando o status.

- [ ] **Step 3: Implementar a checagem em `call`**

Em `apps/api/src/lib/office-hub.ts:518-540`, trocar:

```ts
    if (!this.entries.has(targetUserId)) {
      this.sendToUser(callerId, { type: 'call-failed', targetUserId, reason: 'offline' })
      return
    }

    this.lastCallAt.set(callerId, now)
```

por:

```ts
    const target = this.entries.get(targetUserId)
    if (!target) {
      this.sendToUser(callerId, { type: 'call-failed', targetUserId, reason: 'offline' })
      return
    }
    if (target.occupant.status !== 'online') {
      this.sendToUser(callerId, { type: 'call-failed', targetUserId, reason: 'away' })
      return
    }

    this.lastCallAt.set(callerId, now)
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api exec vitest run src/lib/office-hub.test.ts -t 'call'`
Expected: PASS (todos os testes de `call`, incluindo os pré-existentes e o novo)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub.test.ts
git commit -m "feat: bloqueia chamada direta para quem está ausente/volto logo"
```

---

### Task 5: Toast no cliente quando a chamada falha por ausência

**Files:**
- Modify: `apps/web/src/office/useOfficeInteractions.ts:300-306`
- Test: `apps/web/src/office/useOfficeInteractions.test.tsx`

**Interfaces:**
- Consome: `OfficeServerMessage` com `{ type: 'call-failed', reason: 'away' }` (Task 1/4).

- [ ] **Step 1: Escrever o teste**

Em `apps/web/src/office/useOfficeInteractions.test.tsx`, logo depois do teste `'call-failed offline vira toast'` (linha 131-136), adicionar:

```ts
  it('call-failed away vira toast avisando que a pessoa está ausente', async () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'), { wrapper })
    act(() => bridge.emitServerMessage({ type: 'call-failed', targetUserId: 'x', reason: 'away' }))
    await waitFor(() => expect(result.current.toast).toMatch(/ausente/i))
  })
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/useOfficeInteractions.test.tsx -t 'call-failed away'`
Expected: FAIL — hoje qualquer `reason` diferente de `'offline'` cai no ramo de "Aguarde um momento antes de chamar de novo.", que não bate com `/ausente/i`.

- [ ] **Step 3: Implementar o novo ramo do toast**

Em `apps/web/src/office/useOfficeInteractions.ts:300-306`, trocar:

```ts
        case 'call-failed':
          showToast(
            msg.reason === 'offline'
              ? 'A pessoa não está mais no escritório.'
              : 'Aguarde um momento antes de chamar de novo.',
          )
          break
```

por:

```ts
        case 'call-failed':
          showToast(
            msg.reason === 'offline'
              ? 'A pessoa não está mais no escritório.'
              : msg.reason === 'away'
                ? 'A pessoa está ausente no momento.'
                : 'Aguarde um momento antes de chamar de novo.',
          )
          break
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/useOfficeInteractions.test.tsx`
Expected: PASS (todos os testes do arquivo, incluindo os pré-existentes de `call-failed`)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/useOfficeInteractions.ts apps/web/src/office/useOfficeInteractions.test.tsx
git commit -m "feat: toast avisa quando a chamada falha por ausência"
```

---

### Task 6: Bloquear chat de proximidade nos dois sentidos

**Files:**
- Modify: `apps/web/src/office/media/useOfficeMedia.ts:224-236` (`applyProximity`)
- Test: `apps/web/src/office/media/useOfficeMedia.test.ts`

**Interfaces:**
- Consome: `OfficeOccupant.status?: OfficeUserStatus` (já existe no tipo, default `online` quando ausente do payload).

- [ ] **Step 1: Ajustar o helper `occupant()` do teste pra aceitar status**

Em `apps/web/src/office/media/useOfficeMedia.test.ts:127-137`, trocar:

```ts
function occupant(userId: string, x: number, y: number): OfficeOccupant {
  return {
    userId,
    name: userId,
    x,
    y,
    dir: 'down',
    avatarSeed: null,
    avatarOptions: null,
  }
}
```

por:

```ts
function occupant(userId: string, x: number, y: number, status?: OfficeOccupant['status']): OfficeOccupant {
  return {
    userId,
    name: userId,
    x,
    y,
    dir: 'down',
    avatarSeed: null,
    avatarOptions: null,
    status,
  }
}
```

(As chamadas existentes com 3 argumentos continuam funcionando — `status` fica `undefined`, tratado como `online` pelo fallback já usado na Task seguinte.)

- [ ] **Step 2: Escrever o teste (status ausente bloqueia assinatura nos dois sentidos)**

Logo depois do teste `'no office-open assina quem está perto e desassina quem se afasta'`
(`apps/web/src/office/media/useOfficeMedia.test.ts:308-325`), adicionar dois testes seguindo o mesmo padrão de mock (`FakeParticipant`/`FakePub`):

```ts
  it('não assina áudio de quem está perto mas está ausente/volto logo', async () => {
    const near = new FakeParticipant('bob', 'bob')
    const nearPub: FakePub = { isSubscribed: false, source: 'microphone', track: null, setSubscribed: vi.fn() }
    near.trackPublications.set('a', nearPub)

    const { rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 10, 5), occupant('bob', 12, 5, 'away')] }, // dist 2 ≤ 3, mas bob está away
    })
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    room.remoteParticipants.set('bob', near)
    act(() => room.emit('trackPublished'))
    expect(nearPub.setSubscribed).not.toHaveBeenCalledWith(true)

    rerender({ occ: [occupant('you', 10, 5), occupant('bob', 12, 5, 'brb')] })
    expect(nearPub.setSubscribed).not.toHaveBeenCalledWith(true)
  })

  it('quem está ausente/volto logo não assina áudio de ninguém, mesmo perto', async () => {
    const near = new FakeParticipant('bob', 'bob')
    const nearPub: FakePub = { isSubscribed: false, source: 'microphone', track: null, setSubscribed: vi.fn() }
    near.trackPublications.set('a', nearPub)

    const { rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 10, 5, 'away'), occupant('bob', 12, 5)] }, // dist 2 ≤ 3, mas "you" está away
    })
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    room.remoteParticipants.set('bob', near)
    act(() => room.emit('trackPublished'))
    expect(nearPub.setSubscribed).not.toHaveBeenCalledWith(true)

    rerender({ occ: [occupant('you', 10, 5), occupant('bob', 12, 5)] }) // "you" volta a online
    expect(nearPub.setSubscribed).toHaveBeenLastCalledWith(true)
  })
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useOfficeMedia.test.ts -t "ausente"`
Expected: FAIL — hoje `applyProximity` só olha distância, então `setSubscribed(true)` é chamado independente do status.

- [ ] **Step 4: Implementar a checagem de status em `applyProximity`**

Em `apps/web/src/office/media/useOfficeMedia.ts:224-236`, trocar:

```ts
  /** No espaço aberto, assinatura segue a distância; nas zonas é autoSubscribe. */
  const applyProximity = useCallback(() => {
    const room = roomRef.current
    if (!room || targetRoomRef.current !== openRoom) return
    const me = occupantsRef.current.find((o) => o.userId === youIdRef.current)
    if (!me) return
    for (const participant of room.remoteParticipants.values()) {
      const occupant = occupantsRef.current.find((o) => o.userId === participant.identity)
      const within = !!occupant && isWithinProximity(me.x, me.y, occupant.x, occupant.y)
      for (const pub of participant.trackPublications.values()) {
        if (pub.isSubscribed !== within) pub.setSubscribed(within)
      }
    }
  }, [openRoom])
```

por:

```ts
  /**
   * No espaço aberto, assinatura segue a distância; nas zonas é autoSubscribe.
   * Ausente/Volto logo bloqueia o chat de proximidade nos dois sentidos: se EU
   * estou ausente não assino ninguém (não ouço), e ninguém assina alguém que
   * está ausente (não é ouvido) — cada cliente roda este mesmo cálculo pro seu
   * lado, então checar os dois status aqui já cobre a simetria sem round-trip.
   */
  const applyProximity = useCallback(() => {
    const room = roomRef.current
    if (!room || targetRoomRef.current !== openRoom) return
    const me = occupantsRef.current.find((o) => o.userId === youIdRef.current)
    if (!me) return
    const meOnline = (me.status ?? 'online') === 'online'
    for (const participant of room.remoteParticipants.values()) {
      const occupant = occupantsRef.current.find((o) => o.userId === participant.identity)
      const within =
        meOnline &&
        !!occupant &&
        (occupant.status ?? 'online') === 'online' &&
        isWithinProximity(me.x, me.y, occupant.x, occupant.y)
      for (const pub of participant.trackPublications.values()) {
        if (pub.isSubscribed !== within) pub.setSubscribed(within)
      }
    }
  }, [openRoom])
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useOfficeMedia.test.ts`
Expected: PASS (todos os testes do arquivo, incluindo os pré-existentes de proximidade)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/media/useOfficeMedia.ts apps/web/src/office/media/useOfficeMedia.test.ts
git commit -m "feat: bloqueia chat de proximidade pra quem está ausente/volto logo"
```

---

### Task 7: Trocar as cores de status (Ausente → amarelo, Volto logo → azul)

**Files:**
- Modify: `apps/web/src/office/media/MediaBar.tsx:56-60`
- Modify: `apps/web/src/office/media/CharacterOverlay.tsx:23-27`
- Test: `apps/web/src/office/media/CharacterOverlay.test.tsx`

**Interfaces:** nenhuma — mudança puramente visual (classes Tailwind).

- [ ] **Step 1: Atualizar o teste de cor existente**

Em `apps/web/src/office/media/CharacterOverlay.test.tsx:28-38`, trocar:

```ts
  it('bolinha de status reflete away/brb', () => {
    const { rerender } = render(
      <CharacterOverlay name="Ana" status="away" cameraTrack={null} screenTrack={null} position={{ x: 0, y: 0, zoom: 1 }} />,
    )
    expect(screen.getByRole('figure', { name: 'Ana' }).querySelector('.bg-error')).not.toBeNull()

    rerender(
      <CharacterOverlay name="Ana" status="brb" cameraTrack={null} screenTrack={null} position={{ x: 0, y: 0, zoom: 1 }} />,
    )
    expect(screen.getByRole('figure', { name: 'Ana' }).querySelector('.bg-yellow-400')).not.toBeNull()
  })
```

por:

```ts
  it('bolinha de status reflete away/brb', () => {
    const { rerender } = render(
      <CharacterOverlay name="Ana" status="away" cameraTrack={null} screenTrack={null} position={{ x: 0, y: 0, zoom: 1 }} />,
    )
    expect(screen.getByRole('figure', { name: 'Ana' }).querySelector('.bg-yellow-400')).not.toBeNull()

    rerender(
      <CharacterOverlay name="Ana" status="brb" cameraTrack={null} screenTrack={null} position={{ x: 0, y: 0, zoom: 1 }} />,
    )
    expect(screen.getByRole('figure', { name: 'Ana' }).querySelector('.bg-blue-500')).not.toBeNull()
  })
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/CharacterOverlay.test.tsx -t 'reflete away/brb'`
Expected: FAIL — hoje `away` renderiza `.bg-error` e `brb` renderiza `.bg-yellow-400`, nenhum dos dois bate com as novas asserções.

- [ ] **Step 3: Trocar as cores em `MediaBar.tsx`**

Em `apps/web/src/office/media/MediaBar.tsx:56-60`, trocar:

```ts
/** Mesmas cores da bolinha de presença no badge de nome sobre o personagem. */
const presenceStatusDotCls: Record<OfficeUserStatus, string> = {
  online: 'bg-green-500',
  away: 'bg-error',
  brb: 'bg-yellow-400',
}
```

por:

```ts
/** Mesmas cores da bolinha de presença no badge de nome sobre o personagem. */
const presenceStatusDotCls: Record<OfficeUserStatus, string> = {
  online: 'bg-green-500',
  away: 'bg-yellow-400',
  brb: 'bg-blue-500',
}
```

- [ ] **Step 4: Trocar as cores em `CharacterOverlay.tsx`**

Em `apps/web/src/office/media/CharacterOverlay.tsx:23-27`, aplicar a mesma troca (`away: 'bg-error' → 'bg-yellow-400'`, `brb: 'bg-yellow-400' → 'bg-blue-500'`) no `statusDotCls`.

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/CharacterOverlay.test.tsx src/office/media/MediaBar.test.tsx`
Expected: PASS (todos os testes de ambos os arquivos)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/media/MediaBar.tsx apps/web/src/office/media/CharacterOverlay.tsx apps/web/src/office/media/CharacterOverlay.test.tsx
git commit -m "feat: troca cores dos status ausente (amarelo) e volto logo (azul)"
```

---

### Task 8: Verificação final

**Files:** nenhum (só validação).

- [ ] **Step 1: Rodar a suíte completa**

Run: `pnpm db:up && pnpm test`
Expected: todos os testes passando (API precisa do Postgres de pé, ver `AGENTS.md`).

- [ ] **Step 2: Rodar o typecheck do web (o `pnpm build` da API já roda `tsc` embutido, mas o web precisa ser conferido à parte se não rodar `pnpm build`)**

Run: `pnpm --filter @legends/web exec tsc -p tsconfig.json --noEmit`
Expected: sem erros.

- [ ] **Step 3: Validação manual no navegador**

Com `pnpm dev` rodando, abrir o Escritório em duas abas/usuários: andar até uma sala de silêncio numa aba e confirmar que o status muda pra "Ausente" (bolinha amarela) automaticamente; tentar mudar pra "Volto logo" pelo menu enquanto ainda dentro e confirmar que continua "Ausente"; sair da sala e confirmar que volta pra "Online"; com a outra aba, tentar ligar pra quem está ausente e confirmar o toast; andar perto de alguém ausente no espaço aberto e confirmar que não há áudio em nenhum dos sentidos.
