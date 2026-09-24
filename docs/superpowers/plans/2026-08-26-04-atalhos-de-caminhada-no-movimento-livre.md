# Atalhos de caminhada no movimento livre

**Spec:** `docs/superpowers/specs/2026-08-26-atalhos-de-caminhada-no-movimento-livre-design.md`
**Branch:** `fix/atalhos-de-caminhada-no-movimento-livre`

Seguir, aceitar chamada, clique direito e Ctrl/Cmd+D voltam a andar — agora como
esterço, que é o que o movimento livre pedia.

## 1 · Controlador (`apps/web/src/office/FollowController.ts`)

- [x] Fronteira em **pixel** (`start`, `onSelfBody`, `onOccupantMoved`); a
      conversão para tile mora dentro, em `tileOfPixel`.
- [x] Caminho do Dijkstra vira lista de **waypoints**; esterça para o CENTRO do
      próximo (`steer`), com zona morta que acompanha o passo medido.
- [x] `onSelfBody` é o único relógio: mede progresso, avança waypoint, detecta
      travamento. `setTimer`/`clearTimer` e `stepTimeoutMs` saem.
- [x] Recusa por `refuseTile` (`room-entry-denied`) **e** por não sair do lugar;
      teto de insistência conta recusas, não tiles distintos.
- [x] Chegada, falha e `cancel` **soltam a tecla** (`steer(null)`).

## 2 · Canal da posição prevista

- [x] `OfficeBridge.onSelfBody`/`emitSelfBody` — pixel, nunca vai ao servidor.
- [x] `OfficeScene.update` publica `bodyPredictor.current()` depois do `predict`.

## 3 · Hook (`useOfficeInteractions.ts`)

- [x] `start()` recebe pixel nos quatro atalhos (o bug que matava todos eles);
      mesa manda o centro do objeto, clique direito manda o centro do tile.
- [x] Snapshot alimenta só os OUTROS; o próprio vem do heartbeat.
- [x] `room-entry-denied` ensina a recusa ao controlador.
- [x] `FOLLOW_STEP_INTERVAL_MS` e o pacing de passo saem.

## 4 · Procedência do input (achado na verificação no app)

- [x] `OfficeInputSource` (`keyboard` | `auto`) em `emitInput`, carimbada pela
      cena, que é quem lê o teclado.
- [x] O hook só cancela o Seguir com `source === 'keyboard'` — sem isso o
      esterço se autocancelava no primeiro quadro (**um passo e para**).

## 5 · Testes

- [x] `FollowController.test.ts` reescrito sobre um corpo de mentira que obedece
      ao esterço (com colisão), no lugar do par `emitMove`/`onMoved`.
- [x] Fixture `occ()` do hook passa a guardar **pixel** — era a mentira que
      escondia o bug — mais regressão do Seguir e da recusa aprendida.
- [x] Cena: autoMove vira input (marcado `auto`), teclado ganha dele (marcado
      `keyboard`), e a posição prevista é publicada.

## Fora deste marco

- **Suavizar a curva** (esterço com raio, em vez de mirar o centro do tile
  seguinte): hoje o corpo faz a esquina em ângulo, o que é fiel ao teclado mas
  não é o mais bonito possível.
- **Reusar o caminho ao recalcular**: todo recálculo hoje é um Dijkstra inteiro.
  Barato na grade atual; deixaria de ser num mapa muito maior.
