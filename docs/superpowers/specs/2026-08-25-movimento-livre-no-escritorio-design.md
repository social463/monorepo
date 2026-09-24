# Movimento livre no escritório

**Data:** 2026-08-25
**Status:** proposto

## Problema

O escritório anda em **grade**: um tile de cada vez, a `STEP_MS` por passo, com
o cliente prevendo e o servidor confirmando por evento. A arena anda em
**pixel**: `stepArena` integra intenção em posição contínua, o servidor simula a
40Hz e emite snapshot a 20Hz, e o cliente prevê, reconcilia e interpola.

Quem experimenta os dois sente a diferença na hora, e ela não é de tempero — é
de gênero. Na grade, o personagem *teleporta* de célula em célula e a curva não
existe; no contínuo, ele *desliza*, raspa a quina e para onde você soltou a
tecla. O escritório é onde as pessoas passam o dia, e é o lugar que anda pior.

Este documento reverte, deliberadamente, uma decisão que o próprio repo
registrou em `arena.ts`:

> Separado do `office.ts` de propósito. O escritório fala em TILES inteiros e é
> orientado a evento; a arena fala em PIXEL e é orientada a tick. Fundir os dois
> contratos obrigaria a alargar `OfficeOccupant.x/y` para float — e são ~90
> pontos medindo em tile que dependem de eles serem inteiros.

A objeção continua verdadeira; o que mudou é o preço de pagá-la. Quando ela foi
escrita, a arena era um marco novo e o contínuo existia só lá. Hoje `stepArena`,
`ArenaPredictor`, `ArenaInterpolator`, `arenaCollisionGrid` e as versões
contínuas de bola, tiro e kart estão prontas e exercitadas — o que sobra é
**ligar**, não inventar.

## Decisão

O escritório passa a falar **pixel**, reusando a mecânica da arena **literalmente**
— a mesma função, não uma cópia. Nada de modo legado: os dois lados sobem juntos
(o deploy é imagem única).

### O movimento é a MESMA função, e por isso ela troca de nome

`stepArena` deixa de morar na arena. Ela vira `stepBody`, em
`packages/shared/src/body-move.ts`, com `BODY_SPEED`, `BODY_SPRINT_FACTOR` e o
resto do vocabulário junto.

Renomear custa um diff mecânico em ~10 arquivos, e vale: deixar código de
escritório chamando `stepArena` cria, para todo leitor futuro, a impressão de
que ali há algo de arena. Nome errado é dívida que não aparece em teste.

E há um fato que fecha a escolha: **a velocidade da arena já é a do escritório**.
`ARENA_SPEED = 213` foi derivada de `TILE_SIZE / STEP_MS` (32px a cada 150ms), e
a corrida é o passo pela metade. Reusar a função não muda a cadência de
caminhada de ninguém — devolve exatamente a que já existe, sem os degraus.

### Colisão fina, e não `isMapTileWalkable`

A grade do escritório marca o tile pelo **centro**. Para quem anda em grade isso
é exato: a pessoa está sempre no centro. Para um corpo contínuo é falso — uma
mesa que cubra metade do tile deixa o centro livre e o personagem atravessa.

Então a colisão passa a ser `arenaCollisionGrid` (que também troca de nome:
`bodyCollisionGrid`, em `body-collision.ts`), rasterizada a 4 subcélulas por
tile. Ela já lê `MapDocumentV1`, que é o que o escritório publica — não há
conversão.

O que ela **não** cobre é o bloqueio dinâmico: kart estacionado. Isso continua
sendo checado à parte, como `canStepTo` já fazia, só que por caixa em pixel.

### O contrato inverte de evento para snapshot

```
move   { dir: MoveDirection, sprint?, seq? }   →  input    { seq, dx, dy, dtMs, sprint? }
moved  { userId, x, y, dir, sprint }           →  snapshot { players: [...], ... } a 20Hz
sync   { x, y, dir, seq? }                     →  (some: a reconciliação faz o papel)
```

`OfficeOccupant.x/y` passam a ser **pixel, float**.

A inversão paga a si mesma em escala. Por evento, com M andando e N conectados,
são `M × 20 × N` mensagens por segundo; por snapshot são `N × 20`, independente
de quantos se mexem — num escritório cheio isso é menos tráfego, não mais.

O que **piora** é o escritório parado, que hoje custa zero e passaria a custar
20 pacotes/s por pessoa. Por isso o snapshot é **suprimido quando nada mudou**:
se nenhuma posição, pose ou estado de corpo mudou desde o último, ele não sai. É
o que devolve o custo zero da sala vazia sem abrir mão do modelo.

### O `sync` morre, e é uma simplificação

Hoje `sync` existe porque a recusa precisa de um jeito de desfazer a predição de
UM passo — daí o `seq` viajar no `move`. No modelo contínuo isso é o caso
normal: o snapshot já traz posição autoritativa e `seq` processado, e
`ArenaPredictor.reconcile` reancora e reexecuta o resto. Recusa vira "o servidor
discordou", que é o mecanismo geral, não um caso especial.

O que **não** morre é o `entry-denied`: parede é auto-explicativa, porta de sala
trancada não. Ele continua sendo o único jeito de o cliente saber POR QUE não
entrou.

### As transições de sala trocam de gatilho, não de regra

É a parte de maior risco, e a que mais precisa ficar escrita.

Hoje cada passo compara sala/zona anterior com a próxima e dispara uma cascata:
som de presença, tranca, dono do áudio compartilhado, knock cumprido, fila de
mão levantada, fila de chegada, manager da sala, status ausente na zona privada
e high-five. Isso funciona porque o passo é **discreto**: existe exatamente um
instante em que se entra.

No contínuo não há esse instante — há um tick em que o tile derivado mudou.
Então a cascata inteira vira **detecção de borda no tick**:

```ts
const tile = { x: Math.floor(x / tileWidth), y: Math.floor(y / tileHeight) }
// se o tile mudou desde o tick anterior, roda a MESMA cascata de hoje
```

A regra não muda; muda quem a chama. E o efeito colateral é bom: hoje a cascata
roda a cada passo (até 20×/s por pessoa) mesmo quando ninguém trocou de sala;
com borda, ela roda quando de fato houve travessia.

**Uma sutileza que precisa de guarda.** Com posição contínua dá para ficar em
cima da linha entre dois tiles e oscilar, disparando entrar/sair muitas vezes por
segundo — som de presença picotado e fila de mão levantada piscando. A defesa é
**histerese**: a saída de uma zona só conta depois que o corpo está inteiro fora
dela (a caixa do corpo, não o centro). Entrar continua valendo pelo centro, que é
o que faz a porta responder na hora.

### Bola, tiro e kart vão junto — não por estética

O drible do escritório é `dribble(occupant, sprint, delta)`, e `delta` é o vetor
do passo **discreto**. Sem passo discreto não há `delta`: a bola de grade não
sobrevive à mudança, ela some. O mesmo vale para o kart, que hoje é colado ao
tile do piloto por `syncRiderKart` e passaria a saltar enquanto a pessoa desliza.

Como a arena já tem os três em versão contínua, a migração é troca:

| Escritório (grade) | Arena (contínuo) | O que muda de verdade |
|---|---|---|
| `office-ball.ts` (322) | `arena-ball.ts` (288) | chute resolvido de uma vez → integrado no tick; drible por contato, não por `delta` |
| `office-paintball.ts` (295) | `arena-paintball.ts` (138) | mira pelo facing de 4 poses → ângulo; alcance em tile → pixel |
| kart de grade (90°) | `arena-kart.ts` | rumo contínuo, inércia, esterço |

O paintball é o único que sobreviveria com `Math.floor`, e ainda assim com mira
grossa: quatro direções num mundo contínuo.

### A caminhada automática vira esterço

Seguir alguém, aceitar chamada, clique direito e Ctrl/Cmd+D hoje produzem uma
lista de tiles e o personagem *teleporta* por ela. Dijkstra continua — a grade de
navegação é boa e o mapa é de tiles —, mas o resultado passa a ser uma lista de
**waypoints** que o controlador persegue emitindo `dx`/`dy`, como se estivesse
segurando a tecla.

O `FollowController` já aprende com o servidor quais tiles foram recusados
(sala trancada, lotada, allowlist) e devolve em `blocked`; isso continua igual,
porque a recusa continua sendo do servidor.

## Alternativas descartadas

**Manter `move` de grade em paralelo.** Rollback mais seguro. Descartada porque a
complexidade do hub não está no movimento — está na cascata de transição, e ela
teria de funcionar nos dois caminhos. Seria dobrar exatamente a parte difícil.

**Movimento contínuo só no cliente, com o servidor ainda em tile.** Sai barato e
é mentira: o servidor recusaria posições que o cliente considera válidas, e a
reconciliação puxaria o personagem para trás o tempo todo. É o bug que a arena
documenta como "anda e volta".

**Copiar `stepArena` para o escritório em vez de compartilhar.** Duas
implementações do mesmo movimento divergem sempre — é o argumento que a própria
arena usa para compartilhar a função entre cliente e servidor, e ele não fica
menos verdadeiro entre dois produtos do mesmo repo.

**Tick global em vez de por empresa.** Um loop só, varrendo todos os escritórios.
Descartado porque a instância é por empresa (`getOfficeHub`) e o estado vive
nela; um loop global precisaria de um registro paralelo e derrubaria o
isolamento que hoje é natural.

## O que a implementação revelou

Três bugs que **só apareceram porque os testes existiam**, e que compartilham a
mesma causa: `occupant.x` continua sendo `number`, então o compilador não
distingue pixel de tile. A defesa que funcionou foi renomear os helpers para o
nome dizer a unidade (`roomForTile`, `isInPrivateTile`, `tileOfPixel`) — o que
força revisitar cada chamada.

**A tranca de sala parou de trancar.** A posição é aplicada antes de a recusa ser
checada, então o "já estou nesta sala?" enxergava o DESTINO e liberava todo
mundo. A origem virou parâmetro explícito (`roomEntryDenialAtTile(..., fromTile)`).

**A capacidade passou a valer N−1.** Pelo mesmo motivo: quem estava entrando já
aparecia dentro da sala e ocupava a própria vaga. A contagem agora o exclui.

**O aviso de recusa nunca saía.** `sendEntryDenied` já tinha cadência própria, e
a que pus em volta gravava o registro antes — a checagem de dentro desistia
sempre. Duplo throttle é sempre throttle infinito.

E dois lugares liam pixel como tile em produção: `office-media.ts` (sala de
áudio) e `ProximityRadar` (raio da voz e posição dos pontos).

## Mudanças deliberadas de comportamento

- **Diagonal contra uma quina agora DESLIZA** pelo eixo livre, em vez de recusar
  o passo inteiro. Parar de vez ao raspar é o "grudar na parede" que o movimento
  livre existe para não fazer. O "não corta quina" continua valendo, mas por
  GEOMETRIA (o corpo não cabe no vão), não por um caso especial.
- **O chute alto virou prazo, não trajetória.** Sem eixo Z, o que preserva a
  feature é `BodyBallState.airborneMs`: enquanto durar, a bola ignora parede e
  mobília.
- **A bola carrega o próprio raio** (`BodyBallState.r`), derivado do tamanho
  publicado. Sem isso, a bola de pilates bateria na parede a um tile dela.

## Consequências

- **O escritório ganha um tick a 40Hz por empresa**, nascendo com o primeiro que
  entra e morrendo quando esvazia — o padrão que a arena já usa. A diferença é
  que escritório raramente esvazia, e é por isso que a supressão de snapshot sem
  mudança deixa de ser otimização e vira parte do desenho.
- `OfficeOccupant.x/y` em pixel quebram **tudo** que os lia como tile. O que
  continua em tile deriva por `Math.floor(x / tileWidth)`.
- Os testes do hub (3.916 linhas) e da cena (2.564) mexem muito: quase todo
  cenário posiciona alguém por tile e conta passos.
- `office-ball.ts` e `office-paintball.ts` são **aposentados**; a bola do
  escritório passa a ser a da arena.
- O `MovementPredictor` do escritório é aposentado em favor do `ArenaPredictor`,
  que já é genérico no passo.
