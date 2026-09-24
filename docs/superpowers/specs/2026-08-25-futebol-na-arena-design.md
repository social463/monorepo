# Futebol na arena

**Data:** 2026-08-25
**Status:** proposto

## Problema

A arena tem dois modos, e os dois são o mesmo jogo com regra de ponto diferente:
mata-mata e bandeira nascem do **tiro**. Quem não gosta de atirar não tem o que
fazer lá — e o produto é de escritório, onde metade das pessoas entra para
brincar junto, não para duelar.

Ao mesmo tempo, o repo já tem a peça mais cara de um futebol pronta e num lugar
onde ela não rende: a **bola chutável do escritório**
(`2026-08-21-bola-chutavel-no-escritorio-design.md`). Ela é ótima como brinquedo
de corredor e não vira jogo, porque falta o que faz jogo: campo, gol e placar.

Só que ela também **não serve como está**. A bola do escritório é de GRADE: o
chute é resolvido de uma vez (`kickBall` devolve o caminho inteiro em tiles), a
colisão é `isMapTileWalkable`, e a bola só existe em posições inteiras. A arena
é de PIXEL e de tick. Reaproveitar `kickBall` aqui significaria arrastar a
grade para dentro do único lugar do produto que foi feito para não a ter.

## Decisão

Um terceiro modo — **`futebol`** — com campo próprio, bola própria e nenhum
disparo. O que se reaproveita é o **desenho**, não o código: a bola da arena é
a mesma ideia da do escritório traduzida para o mundo contínuo.

### Futebol não tem marcador

Nada de tiro em campo: sem abate, sem vida, sem carência de renascimento, e o
personagem nasce **sem** o marcador na mão (hoje `ensureCharacterTexture` liga
`paintMarker` para todo mundo, porque toda arena era de tiro).

É decisão de produto, não de custo. Tinta e bola no mesmo campo transformam o
futebol numa segunda forma de mata-mata, onde marcar o adversário é atirar
nele — e o modo deixa de ser o convite para quem não queria atirar, que é
justamente por que ele existe.

O que fica de fora fica de fora no **servidor**: `fire` é ignorado quando o modo
é futebol. Esconder só o botão deixaria um cliente adulterado atirando num modo
que não tem defesa contra isso.

### A bola é simulada no tick, não resolvida no chute

A diferença central em relação ao escritório. Lá, o hub é orientado a evento e
não tem relógio: por isso o chute calcula a trajetória inteira de uma vez e o
cliente só interpola. Aqui **já existe um loop a 40Hz** (`ArenaHub.tick`), e o
que faz um futebol ser futebol é exatamente o que a resolução instantânea
impede: interceptar a bola no meio do caminho, dividir a bola, a bola bater em
alguém e sobrar para outro.

```ts
stepArenaBall(ball, dtMs, grid) → ball        // atrito + parede, pura
kickArenaBall(ball, kicker) → ball | null     // null = fora do alcance
```

Como `stepArena`, ela é **pura, sem relógio e compartilhada**: o servidor
integra a bola autoritativa e o cliente roda a MESMA função entre snapshots,
corrigindo por erro contra o que chega. Duas implementações da mesma física
divergem sempre.

A bola não é carregada (não é a bandeira): quem anda por cima dela **conduz** —
um empurrão por tick na direção do passo, a versão contínua do `dribble` do
escritório. Quem está parado no caminho **rebate**. É essa diferença que faz o
corpo do adversário valer alguma coisa sem precisar de nenhuma regra de
desarme.

### Dois gestos de pé, e o Shift que já existe

O cliente manda `{ type: 'kick', angle, power }` — o ângulo (a mira é dele) e o
GESTO. O que nunca viaja no fio é a **potência**: `arenaKickSpeed` decide
quanto cada gesto vale, com o `sprint` do último input já processado. Escolher
entre passar e chutar é decisão de jogo como outra qualquer; escolher quantos
pixels por segundo, não.

Três forças, que é o mínimo para haver jogo coletivo — com um chute só, a bola
sempre atravessa meio campo e não há como deixá-la para quem está do lado:

| gesto | tecla | mouse | alcance |
|---|---|---|---|
| passe | `E` | botão direito | ~6 tiles |
| chute | `Espaço` | clique | ~15 tiles |
| chutão | `Shift`+`Espaço` | `Shift`+clique | ~25 tiles |

O passe ignora a corrida de propósito: passe curto que vira chutão porque a
pessoa estava com Shift apertado (e ela está quase sempre) não seria mais um
passe.

**Teclado e mouse, não só mouse.** O mouse mira melhor, e é por isso que ele
existe aqui; mas exigir mouse para tocar na bola deixa de fora quem joga de
trackpad. Sem mouse, o pé aponta para a direção do PASSO (oito direções), e
para a pose encarada quando se está parado.

As teclas **não** são o `Z`/`X` do escritório, e a diferença é a mão: lá a
pessoa está parada ao lado de uma bola de corredor; aqui ela está correndo com
WASD e Shift, e descer o anelar até o `Z` no meio da corrida tira a mão do
lugar. `Espaço` é do polegar e `E` fica um dedo acima do `D` — nenhum dos dois
pede que a mão saia de onde está.

### O campo é gerado, e é o mesmo formato

`soccerMapDocument()` fica ao lado de `arenaMapDocument()` e pelo mesmo motivo:
determinístico, gerado nos dois lados, nada de mapa no fio ou no banco. Quem
escolhe qual documento é o **modo** (`arenaDocumentFor(mode)`).

Espelhado no eixo X, como o campo de batalha — num jogo por times, mapa torto é
sorteio. O que muda em relação ao campo de batalha é que aqui a simetria é
trivial de garantir: um campo de futebol é simétrico por definição.

Três decisões de layout, todas para o jogo fluir:

- **Muro fechado, sem lateral.** A bola nunca sai: bate na parede e volta. Não
  há escanteio, lateral, tiro de meta nem juiz — e é de propósito. Regra de
  bola fora exige reposição, e reposição exige alguém para cobrá-la; num jogo
  de dez minutos no meio do expediente, isso é tempo parado.
- **O gol é aberto.** A rede (`school/rede-de-gol-*`, o par espelhado que o
  acervo já tem) é desenho, não colisão: o gol é uma linha, e a bola que cruza
  a boca dentro da altura da trave é gol. Rede sólida daria bola presa na rede
  como estado do jogo.
- **Campo menor que o de batalha** (81×49 tiles contra 121×85). No campo de
  batalha, não se encontrar é mecânica; no futebol, é o fim do jogo.

As **linhas do campo** (meio, círculo central, grandes áreas) e a listra do
gramado são desenhadas pela cena como forma, não como tile. Nenhum tileset do
acervo tem marcação de campo, e pintá-la em tiles quadrados daria borda dura —
o mesmo motivo por que o campo de batalha desistiu das manchas de grama.

### Gol reposiciona; não interrompe

Ao gol: ponto, evento `goal` (é ele que dispara o aviso e o som), todo mundo de
volta à própria base e a bola no centro, **travada** por alguns segundos.

Sem nova fase de partida. `phase` continua `jogando`/`intervalo`, e a saída de
bola é um instante (`ballLockedUntil`), não um estado — o mesmo desenho da
bandeira caída, que também é prazo e não timer. E ninguém fica sem andar
durante a comemoração: congelar o teclado de todo mundo por três segundos é o
tipo de pausa que só um replay justifica, e não há replay.

Vence quem fizer **5 gols** ou estiver na frente aos 5 minutos —
`scoreLimitFor(mode)`, que já existe justamente para isso.

## Alternativas descartadas

**Reaproveitar `kickBall` e rodar o futebol em grade.** Seria o menor diff e o
pior jogo: bola em passos de 32px num campo onde as pessoas andam em pixel, e
a impossibilidade de interceptar um chute já resolvido.

**Bola como um "carregável", igual à bandeira.** Grudar a bola em quem encosta
é mais simples de implementar e mata o jogo: sem disputa de bola não há
futebol, só uma corrida com objeto.

**Futebol com tinta.** Ver acima — vira mata-mata com bola.

**Time por escolha do jogador.** Continua sendo `balanceTeam`, como nos outros
modos: com quatro pessoas online, deixar escolher lado dá 4×0.

## Consequências

- `ARENA_MODES` passa a três, e o modo deixa de escolher só a regra: escolhe
  também o **documento**. `ArenaScene` é remontada ao trocar para futebol (mapa
  diferente); entre mata-mata e bandeira ela continua sobrevivendo.
- O contrato ganha a bola (`ball` no `welcome` e no `snapshot`), `kick` do
  cliente e os eventos `kick`/`goal` do servidor. Bola é estado CONTÍNUO — vai
  no snapshot, como `downMs` e as bandeiras; os eventos existem para o aviso e
  o som.
- O minimapa do futebol mostra **todo mundo** e a bola. A revelação por tiro
  (`REVEAL_MS`) não faz sentido onde ninguém atira, e esconder o adversário num
  campo de 2.600px seria esconder o jogo.
