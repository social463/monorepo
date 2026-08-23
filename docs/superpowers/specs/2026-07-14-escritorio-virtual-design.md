# Escritório Virtual — presença e movimento em tempo real

**Data:** 2026-07-14
**Status:** design aprovado (aguardando review do spec)

## Problema

O time é remoto e o Legends hoje só reconhece o que já aconteceu (votos, selos,
feedbacks, retros). Falta um lugar com **sensação de presença** — ver quem está
por perto agora, do jeito que um Gather/SoWork resolve: um mapa 2D, cada pessoa
é um personagem, todo mundo se vê andando.

Esta é a **primeira fatia**: um escritório onde N pessoas se movimentam em tempo
real. É a fundação (mapa, protocolo, render, colisão) sobre a qual vêm as coisas
que dão valor de verdade depois — proximidade, chat, salas, "me chama na copa".

## Escopo do v1

**Dentro:** rota `/escritorio` protegida; mapa único de tiles; personagem por
pessoa com 4 direções e walk cycle; movimento sincronizado via WebSocket;
colisão com paredes/mobília; lista de quem está online.

**Fora (deliberadamente):** chat, áudio/vídeo, proximidade, zonas/salas
privadas, múltiplos mapas, editor de mapa, persistência de posição,
customização de avatar do escritório, mobile/touch (só teclado no v1).

## Decisões de design

- **Efêmero, zero migration.** Presença e posição vivem **só em memória** no hub
  do servidor. Abriu a página → aparece; fechou a aba → some. Nenhuma tabela
  nova, nenhum write no Postgres no caminho quente do movimento. Voltar pro
  mesmo lugar onde parou não vale uma migration nem writes por passo.
- **Grid de tiles, não movimento livre.** Posição é `{x, y}` **inteiro** em
  células. Cada tecla = um passo de uma célula. Isso elimina física,
  interpolação e reconciliação contínua: a rede só carrega inteiros, e a
  suavidade é um tween puramente visual no cliente.
- **Servidor autoritativo.** O cliente envia **intenção** (`move: 'up'`), nunca
  posição. O servidor valida o tile de destino contra o mapa, atualiza e faz
  broadcast. Um cliente adulterado não teleporta ninguém nem atravessa parede.
- **Sem client-side prediction no v1.** O passo só anda quando o servidor
  confirma. O tween entre tiles leva ~150 ms, o que já esconde a maior parte do
  RTT; prediction exigiria buffer de input + rollback, e não se paga agora. Se
  ficar perceptivelmente lerdo em produção, é a primeira otimização.
- **Colisão só com o cenário.** Pessoas se atravessam. Bloquear pessoa contra
  pessoa convida a travar porta de propósito e cria deadlock em corredor de 1
  tile — sem valor pra pagar esse preço no v1.
- **Assets são placeholder programático.** Nenhum PNG entra no repo agora: as
  texturas são geradas em runtime (`Graphics.generateTexture`). Isso tira a
  escolha de licença/pack do caminho crítico e mantém toda a arquitetura pronta
  pro spritesheet real — que troca **só o `preload`** da cena.
- **Phaser 3 isolado atrás de `React.lazy`.** ~350 kB gzip não podem entrar no
  bundle de quem só vai votar.

## Arquitetura

### 1. Contrato (`packages/shared/src/office.ts`)

Fonte única do **mapa** e do **protocolo** — servidor e cliente leem o mesmo
módulo, então colisão e desenho não têm como divergir.

```ts
export const TILE_SIZE = 32

/** Linhas do mapa. '.' chão · '#' parede · 'D' mesa · 'P' planta · 'S' spawn */
export const OFFICE_MAP: readonly string[] = [ /* 25 col × 18 lin */ ]

export const WALKABLE_TILES = new Set(['.', 'S'])

export type Direction = 'up' | 'down' | 'left' | 'right'

export interface OfficeOccupant {
  userId: string
  name: string
  x: number
  y: number
  dir: Direction
  /** Cores derivadas do avatar open-peeps, pro personagem não ser genérico. */
  skinColor: string
  clothingColor: string
}

export type OfficeClientMessage = { type: 'move'; dir: Direction }

export type OfficeServerMessage =
  | { type: 'welcome'; youId: string; occupants: OfficeOccupant[] }
  | { type: 'joined'; occupant: OfficeOccupant }
  | { type: 'left'; userId: string }
  | { type: 'moved'; userId: string; x: number; y: number; dir: Direction }
  /** Resposta a um move inválido/barrado: posição autoritativa pra reconciliar. */
  | { type: 'sync'; x: number; y: number; dir: Direction }
```

O mapa do v1: sala aberta ~25×18 tiles, paredes na borda, dois blocos de mesas,
uma copa no canto e uma área de spawn perto da entrada.

### 2. Backend (`apps/api`)

Espelha o padrão que já existe em `lib/review-hub.ts` + `routes/review-ws.ts`.

**`src/lib/office-hub.ts`** — estado in-memory e toda a regra:

- `Map<userId, { occupant, sockets: Set<WebSocket> }>`. Várias abas do mesmo
  usuário = **um** personagem; o usuário só sai do mapa quando o **último**
  socket fecha.
- `join(user)` → escolhe spawn livre (determinístico por `userId`, cai pro
  próximo tile se ocupado), devolve o estado atual e faz broadcast de `joined`.
- `move(userId, dir)` → calcula o tile alvo; se estiver fora do mapa ou não for
  `WALKABLE`, responde `sync` **só pra aquele socket** (sem broadcast); se for
  válido, atualiza e faz broadcast de `moved`.
- **Rate limit** por socket: máximo ~10 moves/s (token bucket). Acima disso, o
  move é descartado silenciosamente — um cliente em loop não vira flood de
  broadcast pra sala inteira.
- Mensagem malformada (JSON inválido, `dir` fora do enum, tipo desconhecido) é
  ignorada; o socket **não** cai por isso.

**`src/routes/office-ws.ts`** — rota fina, sem regra:

- `GET /office/ws`, `websocket: true`, `preValidation` verificando o JWT da query
  (igual `review-ws.ts`), mas aqui lendo o payload pra extrair `sub` (id) — o hub
  precisa saber quem é. Token inválido → 401.
- Busca o usuário (nome + avatar, pro personagem), chama `hub.join`, encaminha as
  mensagens do socket pro hub e desregistra no `close`.

Registrada em `src/app.ts` (`buildApp`), como as demais.

### 3. Frontend (`apps/web`)

Módulo novo `src/office/`, e `OfficePage.tsx` em `src/pages/`.

- **`useOfficeSocket.ts`** — abre o WS com o access token, trata reconexão com
  backoff e traduz as mensagens do servidor em eventos no bridge. Expõe também a
  lista de ocupantes como estado React (pro HUD "quem está online"). Segue o
  padrão do socket da Resenha/Retro já existente.
- **`OfficeBridge`** — EventEmitter minúsculo. É a **única** ponte React ⇄
  Phaser: o hook empurra `welcome/joined/left/moved/sync` pra dentro, a cena
  emite `move` pra fora. Sem isso, cada render do React tentaria reconstruir o
  jogo.
- **`OfficeCanvas.tsx`** — cria o `Phaser.Game` **uma vez** num `ref` (mount) e
  destrói no unmount. Não recebe props que mudam.
- **`scenes/OfficeScene.ts`** —
  - `preload`: gera as texturas placeholder (tiles e personagem) via
    `Graphics.generateTexture`. **É o único ponto que muda** quando entrar
    spritesheet real.
  - `create`: desenha o tilemap a partir de `OFFICE_MAP`; escuta o bridge.
  - Personagem: cápsula com as cores do avatar da pessoa, nome embaixo, e um
    walk cycle (4 direções) — no placeholder, um bob vertical durante o tween.
  - `moved` → tween do sprite entre os dois tiles (~150 ms) + anima o walk;
    `left` → destrói o sprite; `sync` → reposiciona sem tween.
  - Input: setas/WASD → emite `move` no bridge (com a mesma cadência do rate
    limit do servidor, pra não gerar tráfego descartado).
- **HUD** em React/Tailwind por cima do canvas: lista de quem está online
  (avatar real + nome), fora do Phaser.
- **Rota** `/escritorio` em `App.tsx` sob `ProtectedRoute`, com `React.lazy` +
  `Suspense`, e link no menu.

## Fluxo de uma jogada

1. Usuário aperta `→`. A cena emite `move: 'right'` no bridge; o hook envia pelo WS.
2. `office-hub` valida o tile `(x+1, y)`. Parede → `sync` só pra ele. Livre →
   atualiza e faz broadcast de `moved` pra todos os sockets.
3. Todo cliente (inclusive o que se moveu) recebe `moved` e faz o tween do sprite.

## Erros e bordas

- **WS cai** → reconexão com backoff; ao voltar, o `welcome` traz o estado
  completo e a cena re-sincroniza (recria sprites a partir do zero). **A posição
  não sobrevive à queda**: reconectar é um `join` novo, então você renasce num
  tile de spawn. Por isso o socket tem heartbeat (ping a cada 30s) e o nginx usa
  `proxy_read_timeout` longo — sem isso, um escritório ocioso por 60s seria
  desconectado inteiro e todo mundo seria teleportado pro spawn.
- **Servidor reinicia** → todo mundo some do mapa e volta no reconnect (spawn).
  Aceitável: o estado é explicitamente efêmero.
- **Duas abas** → um personagem só; o move de qualquer aba move o mesmo boneco.
  O rate limit é por **usuário**, não por socket — abrir N abas não multiplica o
  orçamento de movimento (seria um vetor de amplificação de broadcast).
- **Usuário sem avatar** (foto M365 ou nada) → cores default determinísticas
  derivadas do `userId`, personagem não fica igual ao do vizinho.

## Testes

**API** (`office-hub.test.ts`, `office-ws.test.ts`):
- join/leave; multi-aba (2 sockets = 1 ocupante; sai só no último close).
- move válido faz broadcast; move contra parede/borda não move e responde `sync`.
- rate limit descarta o excesso.
- mensagem malformada não derruba o socket.
- integração com cliente `ws` real, espelhando `retro-ws.test.ts`.

**Shared** (`office.test.ts`): mapa é retangular, tem ao menos um spawn, e todo
spawn é andável.

**Web**: teste do `useOfficeSocket` (traduz mensagens → eventos/estado) e smoke
da `OfficePage` com `phaser` mockado — jsdom não tem canvas/WebGL.

## Riscos

- **Phaser dentro do React** é a parte que mais convida a bug (double-mount do
  StrictMode, game órfão). Mitigado pelo bridge + criação única no ref.
- **Latência sem prediction** pode ficar desconfortável na EC2. É medível
  assim que subir; se doer, prediction é aditiva e não muda o protocolo.
- **Bundle**: se o `React.lazy` for esquecido, todo mundo paga Phaser. Vale
  conferir o build.
