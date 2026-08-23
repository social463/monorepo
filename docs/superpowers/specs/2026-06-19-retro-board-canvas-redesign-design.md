# Design — Redesign do Board de Retrospectiva: canvas livre tipo Miro

- **Data:** 2026-06-19
- **Status:** aprovado (aguardando revisão final do spec)
- **Branch:** `feat/retro-board` (evolui a feature ainda não-mergeada)
- **Substitui a UX de:** `docs/superpowers/specs/2026-06-18-retrospectiva-board-design.md`

## Objetivo

Transformar o board de retrospectiva — hoje engessado em 5 colunas com textarea —
num **quadro livre colaborativo estilo [Miro](https://miro.com)**: os integrantes
criam **post-its coloridos** e os **arrastam livremente** por um canvas, vendo o
movimento dos colegas **em tempo real**, com cursores ao vivo. A estrutura de
backend (service, hub, WebSocket, votos, reações, presença) é reaproveitada; muda a
interação, parte do modelo de dados e o tempo real (que passa a ser bidirecional).

## Decisões de produto (brainstorming)

- **Canvas 100% livre:** post-its posicionados em `x/y` arbitrário; arrasto livre.
- **5 categorias viram fundo visual:** regiões rotuladas (Bom/Ruim/Começar/Parar/
  Ações) desenhadas como guia no canvas. **A categoria sai do dado** — o card NÃO
  guarda `column`; sem relatório por categoria.
- **Arrasto ao vivo (durante o movimento):** o post-it dos colegas desliza em tempo
  real enquanto alguém arrasta (não só ao soltar).
- **Cor = paleta livre por post-it** (estética/organização pessoal; não de-anonimiza).
- **Sem fases de revelação:** sala passa a ter só `OPEN` → `CONCLUDED`. Tudo visível
  a todos os membros desde o início; votar/reagir liberado enquanto `OPEN`;
  `CONCLUDED` = somente leitura.
- **v1 inclui:** criar post-it, escolher cor, arrasto ao vivo, editar/excluir o
  próprio, **dot voting**, **reações com emoji**, **pan/zoom** (local), **cursores ao
  vivo**.
- **Anonimato** continua configurável por sala (esconde o autor no post-it).
- **Fora do v1:** redimensionar post-it, pan/zoom sincronizado, comentários/threads,
  templates, exportar.

## Modelo de dados (Prisma)

Migration **nova** (não editar a `retro_board` já aplicada): adiciona campos ao card,
remove `column`, converte o enum de status.

### `RetroCard`

```prisma
model RetroCard {
  id        String   @id @default(cuid())
  roomId    String
  authorId  String
  text      String
  x         Float
  y         Float
  color     String   // chave da paleta: yellow|pink|green|blue|purple|orange
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  room      RetroRoom       @relation(fields: [roomId], references: [id], onDelete: Cascade)
  author    User            @relation("RetroCards", fields: [authorId], references: [id])
  votes     RetroVote[]
  reactions RetroReaction[]

  @@index([roomId])
  @@index([authorId])
}
```

- **Removido:** `column RetroColumn`.
- `votes`/`reactions` permanecem como estão (Tasks de dot voting/reações reaproveitadas).

### `RetroRoom` / status

`RetroRoomStatus` passa de `COLLECTING|REVEALED|CONCLUDED` para **`OPEN|CONCLUDED`**.
Cai `revealedAt`. `concludedAt`, `anonymous`, `votesPerParticipant` permanecem.

Migration converte valores antigos: `COLLECTING`/`REVEALED → OPEN`, `CONCLUDED →
CONCLUDED`. Como remover valor de enum no Postgres exige recriar o tipo, a migration:
cria o novo enum, faz `ALTER COLUMN ... TYPE novo USING (cast)`, remove o antigo, e
faz `DROP TYPE "RetroColumn"` após dropar a coluna do card.

### Enum `RetroColumn`

Removido do banco. As 5 categorias sobrevivem só como **constante de layout no front**
(títulos + retângulos das regiões do canvas).

## Contrato compartilhado (`@legends/shared`)

`packages/shared/src/retro.ts`:

- `RetroRoomStatus`: `['OPEN', 'CONCLUDED']`.
- `RETRO_CARD_COLORS`: `['yellow','pink','green','blue','purple','orange']` (+ tipo
  `RetroCardColor`). Mapa de cor → hex/classe fica no front (layout).
- `RETRO_REGIONS`: constante de layout (id, label, retângulo `{x,y,w,h}` no mundo) das
  5 áreas de fundo — **só visual**, consumida pelo canvas.
- `RetroCardDTO`: ganha `x: number`, `y: number`, `color: RetroCardColor`; **perde**
  `column`. Mantém `id, text, author|null, mine, voteCount, myVotes, reactions,
  createdAt, updatedAt`.
- `RetroRoomDTO`/`RetroRoomSummaryDTO`: `status` agora `OPEN|CONCLUDED`; some
  `columnCounts`; some `revealedAt`. Mantém `myRemainingVotes`, `participants`, etc.
- `RetroEvent` (union) passa a ter:
  - Persistentes/autoritativos (broadcast pós-mutação): `card.created`,
    `card.updated` (texto/cor), `card.moved` (posição final), `card.deleted`,
    `vote.changed`, `reaction.changed`, `phase.changed` (só `OPEN→CONCLUDED`),
    `presence.changed`.
  - Efêmeros (relay sem persistência): `card.moving { cardId, x, y, byUserId }`,
    `cursor.moved { userId, name, x, y }`, `card.locked { cardId, byUserId, byName }`,
    `card.unlocked { cardId }`.
  - **Removidos:** `columnCounts.changed`.
- Mensagens **cliente→servidor** (WS bidirecional), nova união `RetroClientMessage`:
  `{ type: 'card.move'; cardId; x; y }`, `{ type: 'card.grab'; cardId }`,
  `{ type: 'card.drop'; cardId }`, `{ type: 'cursor'; x; y }`.
- Constantes: `CURSOR_THROTTLE_MS`, `MOVE_THROTTLE_MS` (~33ms ≈ 30/s).

## Arquitetura de tempo real

WebSocket vira **bidirecional**. Dois canais:

### Canal efêmero (alta frequência, não persiste)

Cliente envia (com throttle ~30/s) `RetroClientMessage`:
- `cursor {x,y}` → hub repassa aos demais como `cursor.moved {userId,name,x,y}`.
- `card.grab {cardId}` → hub registra soft-lock `cardId→userId` (se livre) e emite
  `card.locked`. Se já travado por outro, ignora (o cliente nem deixa arrastar).
- `card.move {cardId,x,y}` → só aceito do dono do lock; repassa `card.moving`.
- `card.drop {cardId}` → libera o lock, emite `card.unlocked`. (A posição final é
  persistida em paralelo via REST — ver abaixo.)

Coordenadas sempre no **mundo** (independem de pan/zoom de cada cliente).

### Soft-lock (conflito)

Estado em memória no hub: `Map<cardId, { userId, name }>`. Pego no `card.grab`,
liberado no `card.drop` **ou** no disconnect do dono (cleanup varre locks do socket).
Enquanto travado, os outros veem badge "Fulano movendo" e não arrastam. Sem lock no
banco (deploy é instância única; ver gotcha de escala do spec anterior).

### Persistência (REST → broadcast autoritativo)

Mutações continuam route→service→Prisma e o handler faz o broadcast oficial:
- `POST /retro/rooms/:id/cards { text, color, x, y }` → cria → `card.created`.
- `PATCH /retro/rooms/:id/cards/:cardId { text?, color? }` → `card.updated`.
- `PATCH /retro/rooms/:id/cards/:cardId/position { x, y }` → persiste posição final no
  `drop` → `card.moved`.
- `DELETE .../cards/:cardId` → `card.deleted`.
- votos/reações → `vote.changed` / `reaction.changed` (inalterados, mas liberados em
  `OPEN`).
- `POST /retro/rooms/:id/phase { action: 'conclude' }` → `phase.changed` (única
  transição restante).

O hub ganha `relayEphemeral`/lock helpers; o `broadcast(roomId, build)` por-viewer
permanece (anonimato no `card.created`/`card.moved`).

## Frontend (`apps/web`)

- **`RetroRoomPage`** reescrita como canvas pan/zoom: um "mundo" (`div` com
  `transform: translate(pan) scale(zoom)`) contendo post-its como **elementos DOM**.
  Arrasto via pointer events; pan arrastando área vazia; zoom por scroll/ctrl-scroll e
  botões. Estado de view (pan/zoom) é **local**.
- **Fundo:** componente que desenha as `RETRO_REGIONS` (retângulos rotulados
  translúcidos).
- **Post-it:** colorido na posição `x/y`; texto; autor só se não-anônima; votos
  (+/−) e reações quando `OPEN`; editar/excluir no próprio; badge de soft-lock; em
  `CONCLUDED` tudo read-only.
- **Paleta:** barra fixa com as cores; clique numa cor cria post-it no centro da visão
  em modo edição (persiste ao confirmar; descarta se vazio).
- **Cursores ao vivo:** overlay com cursor + nome de cada presente, em coordenadas do
  mundo (convertidas pelo transform atual).
- **`useRetroSocket`** evolui: além de aplicar eventos no cache React Query
  (`['retro-room', id]`), passa a **enviar** `cursor`/`card.move`/`grab`/`drop` (com
  throttle) e a expor handlers + estado de cursores/locks. Reconexão e refresh de
  token mantidos.
- **Barra superior:** título, avatares de presença, botão **Concluir** (facilitador).
- **Removido:** UI de colunas, controles de fase de revelação, contadores.

## Testes

Vitest. API contra Postgres real (`pnpm db:up`); web jsdom + Testing Library.

- **Service:** criar card com `x/y/color`; atualizar posição; gating `OPEN`
  (escreve/move/vota/reage) vs `CONCLUDED` (tudo bloqueado, 409); anonimato no DTO
  (autor null); transição única `OPEN→CONCLUDED`.
- **Hub:** relay efêmero de `card.moving`/`cursor.moved` só para os outros; soft-lock
  — `grab` trava, segundo `grab` é negado, `drop` libera, disconnect libera os locks
  do socket; `card.move` de quem não detém o lock é ignorado.
- **Rotas:** position/cards/votes/reactions; status codes; 403/404 por papel; conclude.
- **Web:** canvas renderiza post-its nas coordenadas (com transform); criar pela
  paleta; arrastar persiste no soltar (chama PATCH position) e emite `card.move`
  durante; read-only em `CONCLUDED`; aplicar `card.moving`/`cursor.moved`/`card.moved`
  vindos do socket (mockado); pan/zoom altera só o transform local.

## Riscos e decisões conscientes

- **WebSocket bidirecional:** novo (antes era push-only). Validar tamanho/rate das
  mensagens efêmieras; throttle no cliente (~30/s) e o servidor só repassa (sem I/O de
  banco) — barato.
- **Soft-lock em memória:** preso à instância única (igual ao hub). Last-write-wins
  foi descartado em favor do soft-lock para evitar "guerra de arrasto".
- **Migração de enum no Postgres:** recriar o tipo `RetroRoomStatus` exige SQL cuidado
  (novo tipo + cast + drop antigo). Banco local já tem `retro_board`; a nova migration
  entra por cima.
- **DOM-canvas (não `<canvas>`):** escolhido por acessibilidade/edição de texto;
  performance é suficiente para a escala de uma retro (dezenas de post-its).

## Fora do escopo do v1 (evoluções futuras)

- Redimensionar post-it / texto rico.
- Pan/zoom sincronizado entre participantes ("seguir apresentador").
- Comentários/threads em post-it; agrupar em clusters.
- Templates de quadro; exportar (imagem/CSV).
- Redis pub/sub para multi-instância (locks e relay distribuídos).
