# Corrida de kart na arena

**Spec:** `docs/superpowers/specs/2026-08-25-corrida-de-kart-na-arena-design.md`
**Branch:** `feat/arena-corrida-de-kart`

Um quarto modo de arena — `corrida` —, com física de kart, pista gerada e
classificação individual por voltas.

## 1 · Contrato e regras (`packages/shared`)

- [x] **`arena-kart.ts`** — `stepArenaKart`, puro e sem relógio, no molde de
      `stepArena`: rumo e velocidade sobrevivem ao input, o esterço só morde com
      o kart andando, o Shift vira freio de mão e bater custa velocidade.
      `ArenaInput` **não muda de formato** — só de significado.
- [x] **`arena-race.ts`** — a geometria (spline Catmull-Rom centrípeta por doze
      pontos de controle), `raceProgressAt` com janela, a máquina de voltas por
      setores e `raceStandings`.
- [x] **`arena-race-map.ts`** — o `MapDocumentV1` derivado da linha de centro:
      asfalto por distância, barreira de pneu como casca, colisão fundida em
      corridas horizontais.
- [x] **`arena-match.ts`** — `corrida` em `ARENA_MODES`, `modeIsRace`,
      `modeHasShooting` recusando, `scoreLimitFor` devolvendo `Infinity` e
      `podium` no estado da partida.
- [x] **`arena-scenario.ts`** — terceiro cenário (`pista`), cache por cenário.
- [x] **`arena.ts`** — `heading` no occupant, `h`/`v` no snapshot,
      `ArenaRaceSnapshot`, a mensagem `unstuck` e os eventos `lap`,
      `race-finished` e `race-started`.

## 2 · Servidor (`apps/api`)

- [x] `ArenaHub`: vaga de grid por piloto, `stepArenaKart` no tick, `updateRace`
      (semáforo, volta, bandeirada), `unstuck` e o pódio no fim.
- [x] `arena-ws.ts` aceita `unstuck` — sem payload, para não virar teleporte.

## 3 · Cliente (`apps/web`)

- [x] `ArenaPredictor` genérico no passo — um preditor só, dois passos.
- [x] `ArenaInterpolator` interpola o rumo pelo **arco curto**.
- [x] `ArenaScene`: kart sob o piloto (cabeça recortada no cockpit, cor por hash
      do `userId`), tecla **R** para desatolar, HUD de posição/volta.
- [x] `ArenaPlayground`: cartão do modo, semáforo, avisos de volta e chegada,
      classificação ao vivo na lateral.

## 4 · Testes

- [x] `arena-kart.test.ts` (21) — aceleração, inércia, ré, esterço por
      velocidade, freio de mão, batida, largada travada, determinismo.
- [x] `arena-race.test.ts` (17) — a pista não passa perto de si mesma, o grid
      cabe no asfalto, volta conta, vaivém não conta, ré desconta.
- [x] `arena-race-map.test.ts` (12) — linha de centro inteira livre, largura útil
      livre, miolo fechado, colisão fundida.
- [x] `arena-hub.test.ts` (+14) — semáforo, volta, classificação, bandeirada,
      pódio, recusa de tiro, desatolar sem vantagem, vaga reaproveitada.
- [x] `ArenaPredictor` / `ArenaInterpolator` / `ArenaPlayground` no front.

## Fora deste marco

- **Grama que segura** em vez de barreira sólida — exige uma segunda grade
  (superfície) ao lado da de colisão. A barreira sólida é o v1 correto e não
  fecha a porta.
- **Som** de motor, batida e bandeirada. A arena já tem o padrão (evento →
  áudio), mas o marco 1 é a pilotagem.
- **Melhor volta da sessão** guardada entre partidas: hoje `bestLapMs` morre com
  a corrida, como todo estado destes hubs.
