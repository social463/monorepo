# Atalhos de caminhada no movimento livre

**Data:** 2026-08-26
**Status:** implementado

## Problema

O movimento livre (`2026-08-25-movimento-livre-no-escritorio-design.md`) trocou
o passo discreto por posição contínua, e trocou o contrato: `move`/`moved`/`sync`
viraram `input`/`snapshot`, e `OfficeOccupant.x/y` viraram **pixel**.

A caminhada automática — **Seguir**, **aceitar chamada**, **clique direito** e
**Ctrl/Cmd+D** — foi ligada ao novo mundo pelo caminho mais curto: o
`FollowController` continuou sendo o de grade (emite UM passo, espera o `moved`
daquele tile, `sync` desfaz), e o hook passou a traduzir o snapshot para tile na
entrada e a mandar a direção por `emitAutoWalk` na saída.

Isso deixou quatro coisas quebradas, e a primeira sozinha já mata os quatro
atalhos:

1. **A partida ia em pixel e era lida como tile.** `follow()`, `walkToMyDesk()`,
   `walkToTile()` e o aceitar-chamada passam o ocupante direto para `start()`.
   O ocupante fala pixel; o Dijkstra recebia `(112, 144)` como coordenada de
   grade, caía fora do mapa e devolvia "sem caminho" — antes de o personagem dar
   um passo. Todo atalho respondia com o toast de falha.
2. **A tecla nunca era solta.** `emitAutoWalk(null)` não existia em lugar nenhum
   do código. Chegar, falhar ou cancelar encerrava o controlador e deixava a
   direção valendo na cena: o personagem seguia andando sozinho até bater em
   alguma coisa — inclusive depois de o humano assumir no teclado e soltar.
3. **A recusa do servidor deixou de ser aprendida.** `onSync` era o que tirava do
   grafo a porta que o servidor recusou, e `sync` não existe mais. Sem isso a
   rota devolve a mesma porta e o personagem empurra até desistir.
4. **O passo virou esterço só de nome.** A direção saía por tile cardeal, paced
   a 160ms (a cadência do passo de grade), a partir de uma posição que chegava
   pelo snapshot. Andar assim é andar pela borda do corredor, virando a esquina
   tarde e com um round-trip de atraso.

Nada disso apareceu em teste porque as fixtures posicionavam ocupante em
**tile** — a mesma mentira que o compilador não pega, já que pixel e tile são
`number`.

## Decisão

O caminho continua sendo Dijkstra sobre a grade (`officeWalkGrid`): o mapa é de
tiles e a grade é boa. O que muda é o que se faz com o resultado.

### O caminho vira waypoint, e o controlador vira esterço

`FollowController` passa a falar **pixel** e a perseguir os tiles do caminho como
waypoints, esterçando para o **centro** do próximo. É o que o spec do movimento
livre já dizia que ele seria; agora ele é.

Esterçar para o centro (e não "andar na direção do tile") é o que faz o
personagem andar pelo **meio** do corredor. Quem vira a esquina pela borda raspa
a quina, e o corpo contínuo tem largura: com o esterço diagonal saindo da borda,
ele encostaria na parede em vez de dobrar.

A direção é entregue como INTENÇÃO (`steer`), sem cadência nenhuma no meio. O
que precisava ser espaçado era o passo — um `move` por tile, senão o personagem
pulava de tile em tile. Intenção repetida é idempotente, e atrasar uma troca de
direção faria o corpo passar da esquina antes de virar.

### O esterço lê a posição PREVISTA, não o snapshot

O controlador ganha um heartbeat novo, `bridge.onSelfBody`: a cena publica a
posição do preditor a cada amostra de input (`BODY_INPUT_HZ`).

Poderia ler o snapshot, que já chega e já é autoritativo. Não serve por dois
motivos. Ele chega um round-trip atrasado, e a decisão "virar agora" é a única do
sistema que não tolera atraso — virar 90ms depois é virar 19px depois, dois
terços de tile. E o snapshot é **suprimido quando nada muda**: um corpo travado
contra uma porta recusada não gera snapshot nenhum, e o controlador ficaria cego
exatamente no caso em que precisa enxergar.

A posição dos OUTROS continua vindo do snapshot — é a única que existe para eles.

### A recusa é descoberta por dois caminhos

O `sync` morreu com o passo. No lugar dele:

- **`room-entry-denied`**, que sobreviveu de propósito ("parede é
  auto-explicativa, porta de sala trancada não") e carrega o TILE recusado. É o
  caminho preciso e imediato;
- **não sair do lugar** com a tecla segurada (`STUCK_MS`). É o caminho geral, e
  cobre o que nenhuma mensagem cobre: kart que acabou de estacionar e, sobretudo,
  tile cujo **centro** o Dijkstra deu por livre mas em que o corpo, que tem
  largura, não cabe — a grade de navegação marca por centro, a de colisão do
  corpo é de 4 subcélulas.

Os dois desembocam no mesmo lugar de sempre: o tile sai do grafo e a rota se
refaz. O teto de insistência conta **recusas**, não tiles distintos — quando o
mapa não tem como saber que aquele tile é proibido, o recálculo devolve a mesma
rota, e contar tiles distintos nunca chegaria ao teto.

### Sem timer

O controlador deixa de ter relógio e timer injetados. O "tempo" é a cadência do
próprio heartbeat, que só corre enquanto a cena corre. Caminhada que fica sem
heartbeat (aba escondida, entrada travada, cena desmontada) simplesmente para —
em vez de um timer que se reagenda sozinho, que era o vazamento que o teste de
desmontar existia para pegar.

## Alternativas descartadas

**Esterçar no snapshot e manter o controlador sem heartbeat.** Diff bem menor.
Descartada pelos dois motivos acima — atraso na decisão de virar, e cegueira
justamente quando o corpo está travado.

**Mover o esterço para a cena, que já tem a posição a 60Hz.** É onde o dado mora,
e tem apelo. Descartada porque levaria junto o Dijkstra, o aprendizado de recusa
e as mensagens de falha (que são de produto, e vivem no React) para dentro do
Phaser — um controlador testável viraria estado de cena.

**Zona morta do esterço cravada em pixel.** Foi o que se tentou primeiro (2px), e
o teste do corredor pegou: o corpo anda ~7px por amostra, então um alvo com
tolerância menor que o passo é sempre ultrapassado, e o personagem treme em volta
do centro a 30Hz corrigindo para os dois lados. A zona morta acompanha o passo
medido — o que também resolve a corrida (`sprint`), que anda mais por amostra.

## O que a verificação no app revelou

Um quinto defeito, que nenhum teste pegou porque nasce da costura entre as duas
pontas: **a caminhada automática cancelava a si mesma**.

O hook cancela o Seguir quando vê um `input` com direção — é assim que "quem
toca uma tecla assume o controle". Só que, desde o movimento livre, o esterço
viaja por esse MESMO `input`: o controlador segura a direção e a amostragem do
quadro a transforma em deslocamento. O primeiro quadro de esterço, então, era
lido como "o humano assumiu". No app isso aparecia como **um passo para a frente
e para** — em todos os quatro atalhos.

A correção é dar procedência ao input (`OfficeInputSource`: `keyboard` | `auto`),
carimbada no único lugar que sabe a resposta: a cena, que é quem lê o teclado. O
`emitInput` já passava pelo bridge, então a informação viaja com ele — nada de
um segundo canal para dizer o que o primeiro já poderia ter dito.

Vale registrar que o defeito é anterior a este trabalho: ele veio junto com o
movimento livre, e estava escondido atrás do defeito nº 1 — como nenhuma
caminhada chegava a começar, nenhuma chegava a se autocancelar.

## Consequências

- `FollowController` fala pixel na fronteira inteira (`start`, `onSelfBody`,
  `onOccupantMoved`). Quem tem tile na mão — clique direito, mesa, deep-link do
  knock — manda o CENTRO dele.
- Toda saída do controlador **solta a tecla**: chegada, falha e `cancel`.
- Fixture de teste que posiciona ocupante passa a converter tile → pixel no
  helper (`occ`). Foi a mentira que escondeu o bug.
- `FOLLOW_STEP_INTERVAL_MS` e o par `setTimer`/`clearTimer` deixam de existir.
- `bridge.emitInput` passa a levar a procedência. Quem só repassa ao servidor
  (`useOfficeSocket`) ignora o segundo argumento; quem decide sobre controle
  (o hook) passa a olhá-lo.
