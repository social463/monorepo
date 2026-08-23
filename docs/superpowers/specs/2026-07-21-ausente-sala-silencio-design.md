# Ausente automático na sala de silêncio + cores de status — design

## Contexto

O Escritório tem hoje um status de presença manual (`OfficeUserStatus`:
`online` | `away` | `brb`, definido em `packages/shared/src/office.ts`), sem
qualquer detecção automática — o comentário do tipo é explícito: "escolhido
manualmente pela pessoa (sem detecção de inatividade)". Ele vive só na sessão
do `OfficeHub` (`apps/api/src/lib/office-hub.ts`), nunca persiste, e reseta
para `online` a cada `join`.

O mapa tem uma zona chamada **`private-zone`** ("sala de silêncio" na UI,
renderizada em vermelho no editor — `OfficeScene.ts:951-970`), hoje só usada
para agrupar a sala de áudio LiveKit isolada (`officeRoomForMapPosition`) e a
fila de mão levantada. Não há nenhuma ligação entre entrar nessa zona e o
status de presença.

Nem a chamada direta (`call` em `office-hub.ts:518-540`) nem o chat de
proximidade no espaço aberto (`applyProximity` em
`apps/web/src/office/media/useOfficeMedia.ts:224-236`) checam o status hoje —
uma pessoa "Ausente" recebe chamada e participa do áudio de proximidade
normalmente.

As cores atuais dos status (`MediaBar.tsx:56-60`, replicadas em
`CharacterOverlay.tsx:23-27`): `online` → verde, `away` (Ausente) → vermelho
(`bg-error`), `brb` (Volto logo) → amarelo.

## Objetivo

1. Entrar numa sala de silêncio muda o status automaticamente para
   "Ausente"; sair reverte para "Online". Enquanto estiver fisicamente
   dentro, trocas manuais de status são ignoradas — o status fica travado em
   "Ausente".
2. Status "Ausente" ou "Volto logo" bloqueia, nos dois sentidos:
   - Receber chamada direta de outra pessoa (quem liga vê um toast avisando
     que a pessoa está ausente).
   - Participar do chat de proximidade no espaço aberto (nem ouve quem está
     por perto, nem é ouvido por quem está por perto).
3. Trocar as cores dos status: "Ausente" passa a amarelo (`yellow-400`),
   "Volto logo" passa a azul (`blue-500`).

Fora de escopo: áudio dentro de salas de reunião (`meeting-room`) continua
"todo mundo ouve todo mundo" independente de status — entrar numa sala de
reunião já é uma ação deliberada de participar. Nenhuma mudança de
persistência (status continua só em memória, por sessão).

## Mudanças

### 1. Auto status ao entrar/sair da sala de silêncio

Em `apps/api/src/lib/office-hub.ts`, no método `move()`: hoje já existe
detecção de transição de zona via `roomForPosition` (antes/depois) para som
de entrada/saída de sala de reunião, e `raiseHandZoneId` (antes/depois) para
a fila de mão levantada. Adicionar uma terceira checagem de transição,
usando `mapZoneAt` (já importado) diretamente sobre a posição antiga e a
nova, comparando `zone?.type === 'private-zone'`:

- Zona anterior não era `private-zone` e a nova é → `entry.occupant.status =
  'away'`, broadcast `status-changed`.
- Zona anterior era `private-zone` e a nova não é → `entry.occupant.status =
  'online'`, broadcast `status-changed`.

A checagem roda depois de `entry.occupant.x/y` já estarem atualizados (mesmo
ponto onde `nextRoom`/`nextZoneId` são calculados), reaproveitando
`entry.occupant.x` e `entry.occupant.y` como coordenadas "depois", e as
coordenadas capturadas em `previousRoom`/`previousZoneId` (antes do reposicionamento) como
"antes".

### 2. Travar status manual dentro da sala de silêncio

Em `setStatus()` (`office-hub.ts:487-497`): antes de gravar o status
pedido, checar se a posição atual do occupant (`entry.occupant.x/y`) está
dentro de uma `private-zone` via `mapZoneAt(this.runtime.document, ...)`. Se
estiver, ignorar o status pedido e gravar `'away'` de qualquer forma
(mesmo que o pedido fosse `'brb'`). Fora da zona, comportamento inalterado
(grava o que foi pedido).

### 3. Bloquear chamada direta para quem está ausente/volto logo

Em `call()` (`office-hub.ts:518-540`), depois da checagem de offline
(`!this.entries.has(targetUserId)`): se o alvo existe mas
`target.occupant.status !== 'online'`, enviar `call-failed` com um novo
motivo `'away'` ao invés de completar a chamada, e não repassar
`incoming-call`.

Isso exige adicionar `'away'` à união de motivos em
`packages/shared/src/office.ts:288`:
```ts
| { type: "call-failed"; targetUserId: string; reason: "offline" | "rate-limited" | "away" }
```

No client, `apps/web/src/office/useOfficeInteractions.ts:300-306` (handler
de `call-failed`) ganha um terceiro ramo: `reason === 'away'` → toast "A
pessoa está ausente no momento." (mesma mensagem para `away` e `brb`, já que
o protocolo não distingue os dois — ambos os status bloqueiam chamada do
mesmo jeito).

### 4. Bloquear chat de proximidade nos dois sentidos

Em `applyProximity()` (`apps/web/src/office/media/useOfficeMedia.ts:224-236`),
a variável `within` (que decide se assina o áudio do remoto) passa a
considerar o status de ambos os lados, além da distância:

```ts
const meOnline = (me.status ?? 'online') === 'online'
...
const within =
  meOnline &&
  !!occupant &&
  (occupant.status ?? 'online') === 'online' &&
  isWithinProximity(me.x, me.y, occupant.x, occupant.y)
```

Isso já cobre os dois sentidos sem lógica extra: como `applyProximity` roda
em cada cliente independentemente, quando a pessoa ausente calcula sua
própria assinatura (`meOnline = false`), ela para de ouvir todo mundo; e
quando qualquer outro cliente calcula a assinatura em relação a essa mesma
pessoa (`occupant.status !== 'online'`), ele para de ouvi-la. `me`/`occupant`
já carregam `status` (campo existente em `OfficeOccupant`, default `online`
quando ausente do payload — mesmo fallback já usado em outros pontos do
código).

O efeito que reavalia `applyProximity()` já depende de `occupants`
(`useOfficeMedia.ts:424-428`), e o array de occupants já é substituído
imutavelmente em `status-changed` (`OfficeBridge.ts:146-148`) — nenhuma
mudança adicional de trigger é necessária.

### 5. Cores dos status

Trocar os mapas de cor em dois lugares (mantendo o comentário existente que
liga os dois):
- `apps/web/src/office/media/MediaBar.tsx:56-60` (`presenceStatusDotCls`)
- `apps/web/src/office/media/CharacterOverlay.tsx:23-27` (`statusDotCls`)

De:
```ts
online: 'bg-green-500',
away: 'bg-error',
brb: 'bg-yellow-400',
```
Para:
```ts
online: 'bg-green-500',
away: 'bg-yellow-400',
brb: 'bg-blue-500',
```

## Testes

- `apps/api/src/lib/office-hub.test.ts`:
  - Andar para dentro de uma `private-zone` seta status `away` e faz
    broadcast de `status-changed`; andar para fora reverte para `online`.
  - `setStatus('brb')` enquanto dentro de uma `private-zone` grava `away`
    (ignora o pedido).
  - `call()` para um alvo com status `away`/`brb` retorna `call-failed`
    com `reason: 'away'` e não entrega `incoming-call`.
- `apps/web/src/office/useOfficeInteractions.test.tsx`: `call-failed` com
  `reason: 'away'` vira toast com a mensagem esperada (mesmo padrão do teste
  existente para `reason: 'offline'`).
- `apps/web/src/office/media/useOfficeMedia.test.ts` (se existir cobertura de
  `applyProximity`/assinatura por proximidade — senão, adicionar): dois
  occupants próximos não assinam áudio um do outro quando um dos dois tem
  status diferente de `online`.
