# Movimento em oito direções no escritório

**Data:** 2026-08-21
**Status:** implementado

## Problema

O personagem andava só em N/S/L/O. Para cortar o escritório na diagonal era
preciso escadinha — dois passos por tile diagonal, com o dobro de teclas e o
dobro de mensagens no socket. Quem joga qualquer coisa top-down espera segurar
duas teclas e andar torto.

## Decisão

### `Direction` continua sendo o FACING; a diagonal é só o passo

O personagem LPC tem **quatro** poses de caminhada. Então o `Direction` de hoje
(4 valores) fica exatamente como está — é ele que alimenta sprite, kart,
high-five, confete e o contato da bola, e nada disso precisa saber que a
diagonal existe.

O que entra é um tipo novo, `MoveDirection` (as 4 cardeais + 4 diagonais), que
aparece em **dois** lugares: na mensagem `move` do cliente e na tabela de
deltas. O `moved` que o servidor devolve continua carregando `dir: Direction`,
derivado por `facingForMove` — e na diagonal quem ganha é a **horizontal**, que
é a pose que lê melhor de perfil.

Isso é o que faz uma feature de movimento caber sem tocar em meia dúzia de
subsistemas: o único lugar que enxerga oito direções é o passo.

### Não se corta quina

`canStepTo` é a regra única do passo — chamada pelo servidor (`OfficeHub.move`)
e pela predição do cliente (`MovementPredictor`), como `isMapTileWalkable` já
era para o tile. Na diagonal ela exige as **duas** ortogonais livres.

Não é preciosismo: com uma só, o personagem passa raspando pela quina entre
duas peças encostadas — atravessa um vão por onde não caberia andando reto. E
divergir entre cliente e servidor aqui é exatamente o bug que o comentário de
`isMapTileWalkable` descreve: o cliente prevê o passo, o servidor recusa, e a
re-ancoragem vira "teleporte".

### Velocidade normalizada

Um passo diagonal cobre √2 tiles. Sem esticar a duração do tween **e** a
cadência da tecla na mesma proporção (`DIAGONAL_STEP_FACTOR`), andar torto
ficaria 41% mais rápido que andar reto — o bug clássico de quem acrescenta oito
direções a um jogo de grade.

Para saber se um passo é diagonal, a cena compara o TILE de origem com o de
destino (`CharacterView.tile`), e não a posição em pixel do container: no meio
de um tween, ou logo depois de um spawn, o pixel não diz em que tile a pessoa
estava.

### Entrada: composição, com os opostos se anulando

`pressedMove` compõe vertical + horizontal; segurar A e D ao mesmo tempo não
anda de lado nenhum. Isso também evita mandar passo quando o dedo troca de
direção sem soltar a tecla anterior.

## O que ficou de fora

- **Pathfinding em oito direções.** A caminhada automática (Seguir, clique
  direito, Ctrl/Cmd+D) continua ortogonal: `findOfficePath` segue com quatro
  vizinhos. A rota fica com cara de escadinha ao lado do movimento manual, o
  que é a próxima melhoria natural — mas mexe no Dijkstra, no custo (√2) e na
  lista de tiles recusados que o `FollowController` alimenta.
- **Movimento livre por pixel.** Seria outro produto: mudaria posição, colisão,
  salas, mesas, proximidade de áudio e a predição inteira.

## Onde está

- `packages/shared/src/office.ts` — `MoveDirection`, deltas, `facingForMove`.
- `packages/shared/src/office-map-runtime.ts` — `canStepTo`.
- `apps/api/src/lib/office-hub.ts` — `move` em oito direções.
- `apps/web/src/office/MovementPredictor.ts` — predição com a mesma regra.
- `apps/web/src/office/scenes/OfficeScene.ts` — `pressedMove`, cadência e duração.
