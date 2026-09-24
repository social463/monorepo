# Movimento livre no escritório

**Spec:** `docs/superpowers/specs/2026-08-25-movimento-livre-no-escritorio-design.md`
**Branch:** `feat/arena-corrida-de-kart` (segue a corrida de kart)

O escritório passa a falar **pixel**, reusando a mecânica contínua da arena
literalmente — a mesma função, não uma cópia.

## 1 · A mecânica deixa de ser "da arena" (refactor puro)

- [x] `arena-step` → `body-move`, `arena-collision` → `body-collision`,
      `arena-kart` → `body-kart`, `arena-ball` → `body-ball`,
      `arena-paintball` → `body-paintball`, e os parâmetros de rede para
      `body-net`. Zero mudança de comportamento, verificado antes de seguir.
- [x] `stepBodyAmongBlockers`: o passo respeitando bloqueio DINÂMICO (kart
      estacionado), que a grade rasterizada não conhece. Roda nos dois lados.

## 2 · Contrato (`@legends/shared`)

- [x] `OfficeOccupant.x/y` em **pixel float**; `tileOfPixel` como o único lugar
      evidente de converter.
- [x] `move` (direção) → `input` (`BodyInput`); `moved`/`sync` → `snapshot`.
- [x] `OfficeKart` e `OfficeBall` em pixel; a bola ganha **raio** (`r`) derivado
      do tamanho publicado e **`airborneMs`** para o chute alto.
- [x] `officeKickBall` põe o chute do escritório sobre a física contínua, com a
      direção saindo do facing autoritativo — o escritório nunca teve mira.

## 3 · Servidor (`apps/api`)

- [x] `OfficeHub` ganha tick a 40Hz que nasce no primeiro e morre quando esvazia.
- [x] `applyInput` enfileira; quem simula é o tick (banco de tempo + teto de fila).
- [x] A cascata de travessia vira **detecção de borda de tile**, com histerese
      (`TILE_COMMIT_MARGIN`) contra o picote na divisa.
- [x] Recusa de sala tratada como colisão: o corpo para na porta.
- [x] Snapshot **suprimido quando nada mudou** — é o que devolve o custo zero da
      sala parada.
- [x] Bola e paintball integrados no tick; drible por CONTATO, não pelo passo.

## 4 · Cliente (`apps/web`)

- [x] `ArenaPredictor` + `ArenaInterpolator` no lugar do `MovementPredictor`
      (aposentado); sem tween — posição escrita a cada quadro.
- [x] Caminhada automática vira **esterço**: o Seguir "segura a tecla"
      (`onAutoWalk`) e a amostragem de input faz o resto — um caminho só até o
      servidor, e ele passa pela predição.
- [x] Câmera **colada** (sem lerp): com lerp o scroll fracionário arredondava em
      ritmo diferente da posição e o personagem tremia.
- [x] Profundidade reordenada ao mover, pelo tile.

## 5 · Bugs que os testes pegaram

- [x] A tranca de sala parou de trancar (checagem via posição já aplicada).
- [x] Capacidade passou a valer N−1 (quem entrava ocupava a própria vaga).
- [x] `room-entry-denied` nunca saía (duplo throttle).
- [x] `office-media.ts` e `ProximityRadar` liam pixel como tile.

## 6 · Ferramenta

- [x] `LEGENDS_TEST_DB_SUFFIX` no `vitest.config.ts`: worktrees paralelos param
      de se envenenar no mesmo `legends_test`. O nome continua **construído**,
      nunca lido cru do env — a garantia contra truncar banco de verdade fica.

## Fora deste marco

- **Histerese por caixa de corpo** em vez de margem no centro: a margem resolve o
  picote, e a caixa seria mais fiel ao "saiu quando o corpo inteiro saiu".
- **Grama que segura** (superfície que muda a velocidade) — exige uma segunda
  grade ao lado da de colisão.
- **Arco visual do chute alto**: hoje a bola voa reto por cima; falta a sombra e
  a escala que davam a sensação de altura.
