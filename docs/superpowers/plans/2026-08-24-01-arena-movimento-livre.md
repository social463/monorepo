# Plan — Arena de jogos: marco 1 (esqueleto andando)

Spec: `docs/superpowers/specs/2026-08-24-arena-de-jogos-com-movimento-livre-design.md`

Escopo deste marco: **entrar na arena, andar livre, ver os outros andando liso.**
Sem modo de jogo, sem placar, sem paintball — é onde mora todo o risco, e é o
único pedaço que não se avalia por teste. Mira livre é o marco 2.

Ordem deliberada: os itens 1–3 são puros e testáveis sem navegador nem socket.
Se `stepArena` estiver certo, o resto é encanamento; se estiver errado, nada em
cima salva.

## 1. Colisão subdividida (`packages/shared`)

- `src/arena-collision.ts` novo: `arenaCollisionGrid(document, subdivisions)` →
  `{ width, height, sub, blocked: Uint8Array }`, memoizado pela IDENTIDADE de
  `document.objects` (mesmo padrão de `officeWalkGrid`).
- Amostra `sub × sub` por tile com o mesmo `pointInMapObject`, e **não** só o
  centro: a regra do centro é exata para a grade (onde se está sempre no meio
  do tile) e falsa para corpo contínuo — parede que cobre meia célula deixa o
  centro livre e o personagem atravessa. `sub = 4` para começar.
- `arenaBlockedAt(grid, px, py)` em coordenada de PIXEL, não de tile: quem
  chama é movimento contínuo.
- Teste: parede de meio tile bloqueia (é a regressão que justifica o arquivo);
  fora do mapa é bloqueado; a grade é reusada quando `objects` não muda.

## 2. O passo (`packages/shared`)

- `src/arena-step.ts` novo: `ArenaPlayerState { x, y, vx, vy, dir }`,
  `ArenaInput { seq, dx, dy, dtMs }`, `stepArena(state, input, grid) → state`.
- **É a função que roda dos DOIS lados** — servidor e predição do cliente. Não
  é reuso por economia: é o que impede divergência por construção. Mesmo papel
  de `canStepTo` na grade.
- Determinística e sem relógio: `dtMs` entra por parâmetro. Sem isso não dá
  para reexecutar input na reconciliação nem testar sem timer.
- Colisão por eixo separado (resolve X, depois Y): é o que faz deslizar na
  parede em vez de grudar, e evita o corpo entalar na quina.
- Vetor de input normalizado — sem isso a diagonal anda 41% mais rápido, o
  mesmo bug que `DIAGONAL_STEP_FACTOR` resolve na grade.
- `dtMs` limitado por um teto: aba que volta do background com `dt` gigante
  teleporta através de parede (tunneling).
- Teste puro: andar reto, deslizar na parede, não atravessar em `dt` grande,
  diagonal com o mesmo módulo de velocidade, mesma sequência de inputs → mesmo
  estado final (é a garantia de que a reconciliação converge).

## 3. Contrato de socket (`packages/shared`)

- `src/arena.ts` novo: `ArenaClientMessage` (`input`, `leave-arena`),
  `ArenaServerMessage` (`welcome`, `snapshot`, `joined`, `left`),
  `ArenaSnapshotPlayer { userId, x, y, dir, seq }`.
- Cliente manda **intenção** (`dx`/`dy`), nunca posição — cliente que manda
  posição é cliente que teleporta.
- `ARENA_TICK_HZ = 30`, `ARENA_SNAPSHOT_HZ = 20`, `ARENA_INPUT_HZ = 30`,
  `ARENA_INTERP_MS = 100`, `ARENA_MAX_STEP_MS`.
- Exportar tudo no barril `index.ts`.

## 4. Hub da arena (`apps/api`)

- `src/lib/arena-hub.ts` novo: `ArenaHub` com `join`, `leave`, `applyInput`, e
  o loop de partida.
- Registry `Map` por `${companyId}:${arenaId}`, no molde de `getOfficeHub`.
- **O tick nasce no primeiro join e morre ao esvaziar** — a objeção que
  derrubou o loop na bola era timer ocioso por empresa, não o loop em si.
  Teste: hub sem ninguém não tem timer vivo.
- Input do socket entra numa fila por jogador; o tick consome em ordem de `seq`
  e guarda o último processado, que volta no snapshot.
- Teto de inputs pendentes por jogador: cliente adulterado não compra
  velocidade enfileirando input (é o análogo do token bucket do `move`).
- Snapshot a 20Hz, não a cada tick: `N × 20` mensagens em vez de `M × 20 × N`.

## 5. Rota (`apps/api`)

- `src/routes/arena-ws.ts` novo, no molde de `office-ws.ts`: mesmo `authenticate`
  e o **mesmo gate de feature `escritorio`** (não inventar feature nova neste
  marco).
- Registrar em `app.ts`.

## 6. Cena da arena (`apps/web`)

- `src/arena/` novo, ao lado de `office/` — cena Phaser própria, em modo livre.
  Não estender `OfficeScene`: a costura entre duas físicas é onde moram os bugs.
- Reusa `composeCharacterSheet`/`occupantTextureKey` (sprite LPC) e o render de
  decoração do documento de mapa.
- `ArenaPredictor`: guarda os inputs não confirmados, reancora no `snapshot` e
  **reexecuta** os pendentes com `stepArena` — a mesma função do servidor.
- Remotos por **buffer de interpolação** (`ARENA_INTERP_MS`): é o que os faz
  andar liso apesar do jitter. Sem ele, remoto anda aos solavancos a 20Hz.
- Amostragem de input no `update()` da cena a `ARENA_INPUT_HZ`, com `seq`
  monotônico.
- Teste web: reconciliação converge (snapshot atrasado + inputs pendentes →
  mesma posição do servidor); interpolação não anda para trás com snapshot fora
  de ordem.

## 7. Portal (`apps/web` + mapa) — **feito sem tipo novo**

- O mapa **já tem** objeto `link`, posicionável pelo admin no editor. O que
  faltava era ele abrir dentro do app: `window.open(url, '_blank')` mandava
  qualquer destino para uma aba solta, o que recarregaria a aplicação inteira e
  perderia sessão de áudio e posição.
- `internalPath` passa a distinguir destino interno (relativo ou mesma origem)
  de externo; interno navega pelo router. Um `link` rotulado "Arena" apontando
  para `/arena` **é** o portal, sem tocar no schema do mapa nem no editor.
- Melhoria independente da arena: link interno para perfil, mural ou qualquer
  tela do produto passa a se comportar como navegação, não como pop-up.
- Volta ao escritório: botão na própria arena.

## 8. Verificação

- `pnpm test` nos três workspaces.
- **Duas máquinas, duas pessoas** — o único item deste plano que não tem teste
  automatizado. O que se olha: andar reto não engasga, esbarrar na parede
  desliza, o outro anda liso e não borracha, e virar não escorrega.
- Ajuste de constantes (velocidade, `ARENA_INTERP_MS`, taxas) sai daí, não do
  chute inicial.

## Fora deste marco

Modo de jogo, placar, respawn, times, mira livre, colisão entre jogadores,
partida com início/fim. A colisão entre jogadores continua **ausente** de
propósito: corpo sólido exige resolução de penetração e vira ferramenta de
troll.
