# Bola chutável no escritório

**Data:** 2026-08-21
**Status:** implementado

## Problema

O escritório tem kart, confete, high-five e reações — coisas que existem só
para as pessoas brincarem juntas no mapa. Faltava a mais óbvia delas: uma bola
para chutar. As bolas do catálogo (`Esporte`: basquete, vôlei, praia…) são
mobília parada, e mobília da paleta ainda **bloqueia passagem** — ou seja, a
bola de hoje é um obstáculo, não um brinquedo.

O pedido tinha uma exigência a mais: o chute não podia ser um botão de força
fixa. Deveria variar **conforme o pé pega na bola**, e ter dois gestos —
um toque leve e um chute de verdade.

## Decisão

### Toda bola de um tile é chutável

O kart já resolveu a parte do "objeto que vira entidade" (`OfficeKart`): um
sheet builtin dedicado marca o `tile-object`, `mapKarts(document)` materializa
o estado inicial, o hub guarda a posição em memória e faz broadcast. A bola
repete a anatomia (`mapBalls`, `OfficeHub.ballStates`, `balls` no `welcome`,
`balls-updated` na publicação) — mas **não** o critério de identidade.

Bola não se reconhece por sheet, e sim por TILE: `officeBallCell(assetId,
tileIndex)` casa qualquer entrada do catálogo cujo id comece com `bola-` —
basquete, vôlei, praia, as coloridas da escola, a de futebol nova e as de
pilates. É o único critério que o `tile-object` publicado permite (`tilesetId`
+ `tileIndex` é tudo o que ele guarda) e, por isso mesmo, é o que faz as bolas
**já colocadas** nos mapas existentes ficarem chutáveis sem que ninguém
precise recolocá-las.

### Bola tem tamanho

A de pilates ocupa **2×2**, e chega ao runtime como quatro `tile-object`. Vira
UMA peça por vizinhança: slices da mesma entrada do catálogo que se encostam
formam um componente conexo (`mapBalls`). Agrupar assim — e não pelo id de
grupo do editor (`grp-x__0-1`) — cobre também o que o editor do admin publicou
slice a slice, e tolera peça girada ou com um pedaço apagado. Bola de um tile
nunca se funde com a vizinha: ali cada objeto é sua própria bola.

O tamanho (`w`/`h`, ausente = 1×1) atravessa o contrato porque muda três
coisas:

- **alcance** é medido até a pegada (`isBallInReach`), então a de pilates é
  alcançável pelos quatro lados dela, não só pelo canto que a ancora;
- **contato** é comparado com a FAIXA que a peça ocupa em cada eixo, não com um
  ponto: quem está ao lado de uma peça de lado par fica alinhado com ela e o
  chute sai reto — comparar com o centro faria toda batida sair na diagonal;
- **passagem**: a pegada inteira precisa caber no tile de destino, então a bola
  de pilates não passa por vão de um tile — bate e volta.

No cliente, a peça anda como **deslocamento sobre a posição publicada**
(`ballLayout`), o que move os quatro slices juntos sem desmontar a bola. O giro
da rolagem só se aplica à bola de um tile: numa peça fatiada, cada slice giraria
em torno do próprio centro.

O sheet dedicado `builtin:office/ball-{16,32,48}` continua existindo por outro
motivo: ele acrescenta à paleta uma bola de futebol de verdade, que nenhum
sheet do catálogo tinha nomeada.

**Colisão pareada some da grade.** A paleta dá colisão a toda peça de
`Esporte`, então bola colocada antes desta feature carrega um retângulo sólido
— que, depois do primeiro chute, seria uma parede invisível parada onde a bola
estava. `officeWalkGrid` ignora a colisão pareada (`<grupo>__collision`) de
qualquer grupo que contenha uma bola, e peça nova nem chega a ganhar uma
(`isCollidableAssetCategory`).

### A bola não bloqueia passagem

Diferente do kart. Bola sólida obrigaria a mexer em `isMapTileWalkable` e, com
ela, na predição do cliente e no pathfinding — custo alto para o que a peça é.
Como efeito colateral, dá para ficar **em cima** da bola: aí o chute sai na
direção encarada.

### O servidor calcula a trajetória inteira, de uma vez

O hub é orientado a evento — não existe loop de tick, e criar um só para a bola
seria a mudança mais cara desta feature. Em vez de simular quadro a quadro,
`kickBall` (em `@legends/shared`, testável fora do servidor) resolve **todo** o
caminho no instante do chute: lista de tiles, rebatidas e duração. O hub grava o
tile final e faz broadcast; cada cliente **anima** a rolagem por aquele caminho.
É a mesma divisão que já vale para o passo de quem anda: o servidor manda, o
cliente interpola.

Consequência deliberada: durante a rolagem a bola já "está" no tile final para
quem chegar no meio do caminho (`OfficeBridge` guarda o pouso, não o meio) —
replay sintético não tem como animar o passado.

### A força vem da geometria, não de sorteio

O cliente manda só o **gesto**; direção, força e trajetória saem de onde a
pessoa está e do que ela encara. Cliente adulterado não escolhe para onde a
bola vai.

| Contato | Efeito |
|---|---|
| Bola à frente, na direção encarada | chute limpo: 5 tiles, reto |
| Bola na diagonal, ou de costas para ela | raspão: ×0,55 e sai torto |
| Shift segurado (chute com corrida) | ×1,5 |
| Toque (Q) | 1 tile, sempre, mesmo correndo |
| Parede ou pessoa no caminho | rebate perdendo metade da força (máx. 2 vezes) |

### Conduzir nasce do passo, não de um gesto

Andar POR CIMA da bola a empurra um tile na direção do passo, e o passo
seguinte empurra de novo — é o que faz a bola andar no pé de quem conduz em vez
de ficar para trás. Encostar de lado não conduz: só quem pisa nela leva.

Duas decisões que sustentam isso:

- **é `OfficeHub.move` que dispara**, não uma mensagem do cliente.
  `isOfficeBallPower` recusa `dribble` vindo do socket de propósito — aceitá-lo
  deixaria qualquer um empurrar a bola parado, sem andar;
- **a duração do empurrão é a do passo** (`BALL_DRIBBLE_TILE_MS`, e metade
  correndo, casados com `STEP_MS` da cena). Bola mais lenta que o passo ficaria
  para trás e o efeito se perderia.

Sem para onde ir (parede, gente), a bola simplesmente fica e quem conduzia
passa por cima dela — como quem leva a bola até a parede. E a condução **não
toca som**: um "poc" por passo viraria metralhadora.

### O chute alto sobrevoa, mas precisa de onde pousar

O terceiro gesto (`lob`, Ctrl/Cmd + Espaço) manda a bola pelo AR: os tiles do
meio são sobrevoados — mesa, planta e gente no caminho não param nada. O que
precisa estar livre é o **pouso**; se não estiver, a bola cai antes, no último
tile livre da linha, e se não houver nenhum ela não sai do lugar.

Essa é a diferença entre o chute alto e "um chute com a colisão desligada":
bola que pousa em cima da mesa é bola que alguém precisa ir buscar lá. E o
alcance dele é menor que o do rasteiro (4 contra 5) de propósito — passar por
cima já é a vantagem; ir mais longe também seria vantagem demais. Não há
rebatida no ar: ele pousa e para.

No cliente, o arco não é uma propriedade tweenada à parte (brigaria com o `y`
do trajeto): o `onUpdate` **subtrai** a elevação depois de o tween escrever o
`y` do chão, numa meia senóide, com um tico de escala no ápice. Enquanto voa, a
bola sobe de `depth` — no ar ela passa por cima de tudo, inclusive de quem
está no caminho.

Nada de aleatório: o mesmo gesto, do mesmo lugar, dá sempre o mesmo chute — é o
que deixa a pessoa **aprender** a pegada em vez de sentir que o jogo sorteia.

### Teclas: a bola tem fileira própria (Z, X, C)

`Z` toca, `X` chuta, `C` chuta alto — vizinhas, em ordem de força, todas
alcançáveis pela mão que já está no WASD. Shift junto de qualquer uma é a
corrida. Uma tecla por gesto: nenhum depende de tempo, e o aviso na tela traz
os três como botões clicáveis (o que também resolve quem está no celular).

A barra de espaço foi tentada primeiro — e o que a derrubou foi a **condução**.
Espaço já era push-to-talk, então enquanto o chute morava lá o gesto dependia
de qual das duas coisas estava armada naquele instante. E `canKick` é medido
contra a posição AUTORITATIVA, enquanto quem anda vê a posição PREVISTA
(`MovementPredictor`): parado as duas coincidem, mas conduzindo a bola elas
divergem por um tile — e a barra desarmava exatamente quando se estava
correndo com a bola. Sem áudio conectado, o push-to-talk também não fazia nada,
então a tecla ficava morta e a bola "fugia" sem que o chute saísse.

Duas coisas ficaram dessa investigação, além das teclas novas:

- o cliente arma as teclas com **um tile de folga** (`BALL_INPUT_REACH`), para
  a diferença entre posição prevista e autoritativa não desarmar o gesto no
  meio da corrida. Quem decide continua sendo o servidor: fora do alcance de
  lá, a mensagem não faz nada;
- o push-to-talk voltou a ser **só da barra**, sem exceção perto da bola.

## Alternativas descartadas

- **Loop de tick no servidor** para simular a bola. Daria bola contínua (parar
  no meio, colidir com quem passa durante a rolagem), ao custo de um timer
  permanente por empresa e de todo o estado de reconciliação que vem junto.
  A trajetória fechada entrega o mesmo *comportamento visível* por muito menos.
- **Física no cliente**, com o servidor só rebroadcastando. Duas pessoas
  chutando ao mesmo tempo divergiriam, e a bola viraria alvo fácil de cliente
  adulterado.
- **Chute na barra de espaço** (em três formas: modificador, barra duas vezes,
  barra segurada). Todas morreram pelo mesmo motivo — a barra já tem dono, e
  disputá-la quebrava o chute justamente durante a condução. Ver "Teclas".
- **Só o sheet funcional chutar.** Foi a primeira versão: mais conservadora,
  porque não mexia em mapa publicado. Caiu no teste de uso — quem vê uma bola
  de basquete no mapa tenta chutar, e explicar que "só aquela outra bola vale"
  é pior do que a mudança de comportamento.

## Onde está

- `packages/shared/src/office-ball-assets.ts` — quem é bola e de que tamanho.
- `packages/shared/src/office-ball.ts` — tipos, constantes e `kickBall`.
- `packages/shared/src/office-map-runtime.ts` — `mapBalls` (agrupa os slices).
- `packages/shared/src/office-pathfinding.ts` — colisão de bola fora da grade.
- `apps/api/src/lib/office-hub.ts` — `ballStates`, `kickBall`, `balls()`.
- `apps/web/src/office/useOfficeBall.ts` — alcance e teclas.
- `apps/web/src/office/scenes/OfficeScene.ts` — `ballLayout`, `refreshBallVisuals`, `playBallKick`.
- `apps/web/src/office/media/kick-sound.ts` — a batida (síntese, não sample).
