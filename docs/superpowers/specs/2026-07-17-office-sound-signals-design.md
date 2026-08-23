# Sinais sonoros do escritório — design

Data: 2026-07-17
Branch: `feat/office-sound-signals`

## Objetivo

Adicionar sinais sonoros ao escritório virtual (Phaser/WebSocket):

1. **Entrar** numa sala de reunião → chime de entrada.
2. **Sair** da sala de reunião (andando pra fora ou desconectando) → chime de saída.
3. **Ser chamado** (`incoming-call`) → som de chamada **mais alto** e tocado **3× seguidas**.

Quem ouve o enter/leave: **o próprio usuário + quem já está na mesma sala** — não vaza
para o escritório inteiro.

## Contexto

Todo o áudio do escritório é sintetizado em runtime via Web Audio API (osciladores) em
`apps/web/src/lib/beep.ts`; não há assets binários e a convenção é manter assim. O som de
chamada (`playCallBeep`, ganho de pico `0.2`) é disparado no `case 'incoming-call'` de
`apps/web/src/office/useOfficeInteractions.ts`.

O servidor (`apps/api/src/lib/office-hub.ts`) já detecta transição de sala no `move()`
(`previousRoom`/`nextRoom` via `roomForPosition`) e já tem `broadcastToRoom(roomId, msg)`,
que entrega uma mensagem só a quem está naquela sala **agora**.

## Abordagem

Evento autoritativo no servidor (reaproveita a detecção de transição e o `broadcastToRoom`).
A alternativa — o cliente inferir a sala de cada `moved` a partir das zonas do mapa —
duplicaria a lógica do servidor e é mais frágil; descartada.

### Contrato — `packages/shared/src/office.ts`

Nova mensagem de servidor:

```ts
| { type: "room-presence"; kind: "enter" | "leave"; userId: string; roomId: string }
```

### Servidor — `apps/api/src/lib/office-hub.ts`

- `move()`, ao **entrar** em `nextRoom` (ramo já existente da transição): emitir
  `broadcastToRoom(nextRoom.id, { type: 'room-presence', kind: 'enter', userId, roomId })`.
  O mover já está reposicionado, então ele + quem já estava na sala recebem.
- `move()`, ao **sair** de `previousRoom`: o mover já saiu da sala, então
  `sendTo(socket, leave)` (para ele) **e** `broadcastToRoom(previousRoom.id, leave)`
  (para quem ficou).
- `leave()` (desconexão dentro de uma sala): `broadcastToRoom(previousRoom.id, leave)`.
  O próprio já saiu/foi removido; só quem continua na sala ouve.

### Cliente — `apps/web`

- `lib/beep.ts`: extrair um helper interno de sequência de tons e:
  - `playCallBeep()` → ganho maior (`0.2` → `~0.32`) e repete o motivo de dois bipes
    **3× em sequência**.
  - `playEnterBeep()` → chime **ascendente** (ex. 660→880 Hz), mais suave (`~0.15`).
  - `playLeaveBeep()` → chime **descendente** (ex. 880→660 Hz), suave.
- `office/useOfficeInteractions.ts`: novo `case 'room-presence'` no switch do
  `onServerMessage`, tocando enter/leave conforme `kind`. Como o servidor já filtra os
  destinatários, o cliente toca sem checar posição.

## Testes

- `apps/web/src/lib/beep.test.ts`: chamada agenda mais osciladores (3×2) e ganho maior;
  novos testes para `playEnterBeep`/`playLeaveBeep`.
- `apps/api/src/lib/office-hub.test.ts`: entrar numa sala emite `room-presence enter` aos
  ocupantes + mover; sair andando e sair por desconexão emitem `leave` a quem ficou (e ao
  próprio, no caso de sair andando).

## Fora de escopo

- Preferência de mute/volume por usuário (não existe hoje; não será adicionada agora).
- Som para transição entre salas que não sejam `meeting-room`.
