# Arena de jogos com movimento livre

**Data:** 2026-08-24
**Status:** proposto — marco 1 (esqueleto) ainda não implementado

## Problema

O escritório anda em **grade**: `OfficeOccupant.x/y` são inteiros de tile, o
cliente manda `move: dir` e o servidor decide o passo (`canStepTo`). Isso é
acerto, não limitação — para caminhar até uma mesa e conversar, grade é melhor:
previsível, sem esbarrão, sem "encostei sem querer". O Gather é grid pelo mesmo
motivo.

O que a grade não serve é **jogo**. O paintball já mostra a costura: o tiro sai
preso ao facing de quatro poses, mira por mouse não faria sentido, e cobertura
tem resolução de um tile. "Pegue a bandeira" e "mata-mata" pioram isso — perseguir
alguém em passos de 32px é mecânica de jogo de tabuleiro, não de arena.

Ou seja: a decisão não é "grade ou movimento livre", é **onde cada um vale**.

## Decisão

### O passo é uma função pura, compartilhada, e é ela que roda dos dois lados

A peça central, e a que decide se isto dá certo:

```ts
stepArena(state, input, dtMs, collision) → state   // @legends/shared
```

Cliente e servidor chamam **exatamente esta função**. Não é reuso por economia:
é o que faz predição e autoridade não divergirem *por construção*. Duas
implementações do mesmo movimento divergem sempre — a pergunta é só em quantas
semanas de caça a drift.

O repo já tem esse instinto em dois lugares, e a arena só o leva adiante:
`canStepTo` é descrito como "a regra ÚNICA do movimento, chamada pelo servidor
e pela predição do cliente", e `kickBall` mora no shared para ser testável fora
do servidor. `stepArena` é a mesma ideia com estado contínuo.

Consequência prática boa: o miolo do movimento vira **teste puro**, sem
navegador e sem socket. O que sobra para testar no olho é sensação, não
correção.

### A arena é instância separada; o mapa é o mesmo formato

Entra-se por um **portal no escritório**: você anda até ele e é entregue a uma
instância de arena — hub próprio, tick próprio, cena em modo livre. O gesto de
"vamos jogar" continua nascendo do convívio, que é o que uma rota isolada
perderia.

O mapa da arena é um `MapDocumentV1` como qualquer outro. Isso traz de graça o
editor do admin, os tilesets, o catálogo de mobília, a composição de sprite LPC
e a voz do LiveKit. O que muda é só o **runtime** que joga aquele documento.

### O escritório continua em inteiros

`OfficeOccupant.x/y` **não** viram float. A arena tem tipo próprio.

É a decisão que mantém o custo contido: colisão e zona somam ~90 pontos que
medem em tile, e sala, mesa, kart, bola, high-five e o próprio paintball medem
adjacência em tile. Alargar o contrato do escritório para "já que estamos aqui"
transforma um marco de netcode num refactor de mês, com regressão espalhada por
tudo que hoje funciona.

### Netcode: o modelo padrão, sem invenção

- cliente amostra input a ~30Hz e manda `{ seq, dx, dy }` — **intenção**, nunca
  posição (cliente que manda posição é cliente que teleporta);
- servidor simula em **passo fixo** e emite **snapshot** a ~20Hz, com o último
  `seq` processado de cada jogador;
- cliente **prevê** o próprio movimento na hora e, ao receber o snapshot,
  reancora e **reaplica os inputs ainda não confirmados**;
- os outros entram por **buffer de interpolação** (~100ms de atraso), que é o
  que os faz andar liso apesar do jitter.

Nada disso é novidade nossa (é o modelo Valve/Gaffer). A escolha de design é
justamente **não inventar** aqui.

**Snapshot também conserta escala.** Hoje cada passo aceito é um broadcast: com
M pessoas andando e N conectadas, são `M × 20 × N` mensagens por segundo. O
snapshot é `N × 20`, independente de quantos se mexem. O loop de tick, que
parecia o custo da feature, é o que **melhora** esse número.

### O tick vive só enquanto há gente na arena

Começa quando o primeiro entra, para quando esvazia. O hub do escritório não
tem nenhum `setInterval` hoje, e a spec da bola tratou criar um como a mudança
mais cara que ela poderia fazer — a objeção real era **timer ocioso por
empresa**, não o loop em si. Amarrado ao ciclo da partida, o custo existe só
enquanto alguém está jogando.

### A colisão precisa de grade mais fina que a do escritório

`officeWalkGrid` marca um tile como bloqueado quando **o centro dele** cai
dentro de um objeto de colisão. Para a grade isso é exato — quem anda está
sempre no centro de um tile. Para movimento contínuo, **está errado**: uma
parede que cubra só metade do tile deixa o centro livre, o tile sai
desbloqueado, e o corpo contínuo atravessa a parede.

Então a arena não reusa a grade como está. Reusa o *mecanismo*
(rasterizar uma vez, consultar O(1)) com **subdivisão** — amostrar N×N por
tile com o mesmo teste de ponto-dentro-do-objeto. Mantém a consulta barata,
corta o bug de meia-parede, e não mexe na grade do escritório.

É o tipo de detalhe que só aparece lendo o código, e que custaria caro
descobrir depois: o sintoma seria "às vezes atravessa a parede", intermitente e
dependente de como o admin desenhou o mapa.

### Sem colisão entre jogadores

No escritório as pessoas se atravessam. Na arena, manter isso: corpo sólido
exige resolução de penetração (dois empurrando o mesmo ponto), e vira
ferramenta de troll — prender alguém num canto sem poder fazer nada.

Se algum modo precisar de bloqueio depois, que seja decisão daquele modo.

### Marco 1 é só o esqueleto andando

Uma arena, movimento livre, várias pessoas. **Sem modo de jogo, sem placar, sem
paintball.**

Todo o risco do projeto mora nesse pedaço: se andar não ficar gostoso, nada
construído em cima salva. E ele é o único que não dá para avaliar por teste —
precisa de duas pessoas, duas máquinas e olho. Misturar regra de jogo aqui
significaria descobrir tarde que o problema era o netcode.

O paintball com **mira livre** é o marco 2 óbvio, e é na arena que ele passa a
fazer sentido: no grid, mirar por mouse brigaria com o facing de quatro poses.

## Alternativas descartadas

- **Zona de movimento livre dentro do mapa do escritório.** Parece o mais
  integrado e é o mais arriscado: duas físicas na mesma cena e no mesmo hub,
  com a costura exatamente no meio — atravessar a fronteira andando obrigaria a
  converter estado, predição e colisão no ar.
- **Rota própria `/arena`, fora do mapa.** Mais fácil de isolar, mas mata o
  gesto de chamar quem está do lado. O portal custa pouco e preserva isso.
- **Tornar o escritório inteiro contínuo.** Ver "O escritório continua em
  inteiros". Além do custo, seria uma piora para o uso principal do escritório,
  que é conversa e não jogo.
- **Cliente autoritativo, servidor só rebroadcast.** Mesma razão que derrubou
  física de bola no cliente: duas pessoas divergem, e a posição vira alvo fácil
  de cliente adulterado.
- **Reusar `officeWalkGrid` como está.** Ver a seção de colisão: a regra do
  centro do tile não sobrevive a corpo contínuo.

## Onde vai ficar

- `packages/shared/src/arena-step.ts` — `stepArena`, o estado e o input.
- `packages/shared/src/arena-collision.ts` — grade subdividida a partir do `MapDocumentV1`.
- `packages/shared/src/arena.ts` — contrato de socket (input, snapshot).
- `apps/api/src/lib/arena-hub.ts` — instância, tick de partida, snapshot.
- `apps/api/src/routes/arena-ws.ts` — conexão (mesmo gate de feature do escritório).
- `apps/web/src/arena/` — cena em modo livre, predição/reconciliação, buffer de interpolação.
