# Corrida de kart na arena

**Data:** 2026-08-25
**Status:** proposto

## Problema

A arena tem três modos — `mata-mata`, `bandeira`, `futebol` — e os três são
**por time**: dois lados nomeados pelas bases do mapa, placar
`Record<ArenaTeam, number>`, e um mapa espelhado no eixo vertical justamente
para que os lados sejam equivalentes. Quem entra é encaixado no time com menos
gente (`balanceTeam`) e joga contra o outro.

O kart, por sua vez, existe no produto e não rende nada. Ele mora no
**escritório** (`2026-07-30-escritorio-karts-posicionaveis-design.md`): um asset
publicado no mapa, montado com `E`, que anda em GRADE — um tile de cada vez, a
`STEP_MS / 3`, girando em passos de 90°. É um brinquedo de corredor, e para de
ser divertido no segundo minuto, porque não há nada para fazer com ele: sem
pista, sem volta, sem ninguém para ultrapassar.

As duas lacunas se resolvem juntas, mas só se as duas premissas caírem. Corrida
não é jogo de time — é classificação individual —, e kart em grade não é
pilotagem: sem inércia e sem esterço, dirigir é idêntico a andar.

## Decisão

Um quarto modo — **`corrida`** — com pista própria, física de kart própria e
classificação individual por voltas.

O que se reaproveita do escritório é o **desenho** (o kart sob o piloto, a
cabeça recortada no cockpit), não o código: o passo do kart da arena é uma
função nova, contínua, no molde de `stepArena`.

### O kart tem rumo e velocidade; o pedestre não tem nem um nem outro

`stepArena` integra intenção direto em posição: `dx`/`dy` viram pixels no mesmo
quadro, e `dir` é só a pose do LPC. Não há estado entre um input e o seguinte —
soltar a tecla para no ato.

Um kart não pode ser assim, e a diferença não é de tempero. Ele carrega dois
estados que sobrevivem ao input:

```ts
interface ArenaKartState extends ArenaPlayerState {
  /** Para onde o kart APONTA, em radianos. Contínuo, ao contrário de `dir`. */
  heading: number
  /** Velocidade ao longo do rumo, em px/s. Negativa = ré. */
  speed: number
}

stepArenaKart(state, input, grid, options?) → ArenaKartState
```

E o input é **relido**, não estendido — `ArenaInput` continua exatamente o mesmo
(`seq`, `dx`, `dy`, `dtMs`, `sprint`). O que muda é o significado:

| Campo | A pé | De kart |
|---|---|---|
| `dy < 0` (W/↑) | anda para cima | acelera |
| `dy > 0` (S/↓) | anda para baixo | freia, e depois engata ré |
| `dx` (A/D, ←/→) | anda para o lado | **esterça** |
| `sprint` (Shift) | corre | **freio de mão** (derrapagem) |

Reler em vez de estender é o que mantém `sanitizeInput`, o teto de pendentes, o
banco de tempo (`ARENA_TIME_BUDGET_CAP_MS`) e a reconciliação inteiros: o
servidor não ganha um segundo formato de pacote para validar, e o cliente não
ganha um segundo caminho de predição.

### Esterço só morde com o kart andando

A regra que sozinha separa "dirigir" de "andar":

```ts
const grip = Math.min(1, Math.abs(speed) / ARENA_KART_TURN_FULL_SPEED)
heading += dx * ARENA_KART_TURN_RATE * grip * Math.sign(speed) * dt
```

Kart parado não gira no lugar, e de ré ele esterça ao contrário — como um carro.
É daí que sai o erro de pilotagem, que é o que faz existir a ultrapassagem: sem
isso, todo mundo faz a curva perfeita e a corrida vira uma fila indiana decidida
no grid.

O freio de mão troca grip por deslizamento: enquanto o Shift está preso o esterço
ganha `ARENA_KART_DRIFT_TURN_BONUS` e a velocidade decai por
`ARENA_KART_DRIFT_DRAG`. É a saída para a curva fechada — e é uma escolha, porque
custa velocidade.

### Bater custa velocidade, e a parede não gruda

`stepArena` resolve um eixo de cada vez para o personagem **deslizar** na parede
em vez de grudar. O kart herda isso e acrescenta o que faltava: bater tira
velocidade (`ARENA_KART_WALL_KEEP`), e batida de frente para tudo.

Sem o custo, encostar na parede seria a linha mais rápida — é o "wall riding"
clássico, e ele transforma a pista num corredor onde a curva não importa.

### A pista é gerada, como todo cenário da arena

Mesma escolha do campo de batalha e do campo de futebol: `MapDocumentV1` gerado
em código (`arena-race-map.ts`), determinístico, chamado pelos dois lados
(`arenaDocumentFor('corrida')`). Nada de mapa no fio nem no banco.

A **geometria** mora em `arena-race.ts` e o mapa é DESENHADO a partir dela — o
mesmo motivo do futebol: a barreira que o piloto vê e a linha que o servidor mede
têm de ser a mesma coisa, e a única forma de garantir isso é uma fonte só.

A pista é uma **linha de centro fechada**: dez pontos de controle passados por
uma spline Catmull-Rom e amostrados em `RACE_TRACK_SAMPLES` pontos. Daí sai tudo:

- **asfalto** = tiles a menos de `RACE_TRACK_HALF_WIDTH` da linha;
- **barreira de pneu** = a casca de `RACE_BARRIER_TILES` em volta do asfalto;
- **colisão** = tudo que não é asfalto, emitido em retângulos **fundidos por
  corrida horizontal**. Um por tile daria ~7.000 objetos e a grade de colisão
  varre a caixa envolvente de cada um.

Spline, e não oval paramétrica, porque oval não tem reta longa nem grampo — e sem
os dois não há onde ultrapassar nem onde errar.

### Volta é distância percorrida, não checkpoint

A pergunta "esta pessoa completou uma volta?" tem duas respostas conhecidas:
checkpoints em ordem, ou progresso ao longo da linha de centro. A segunda é a
escolhida, e ela dá **três coisas de uma vez**:

```ts
raceProgressAt(track, x, y, hint?) → { s, index }   // s ∈ [0, comprimento)
```

1. **volta**: `s` deu a volta de `~L` para `~0` tendo passado pelos quatro
   quartos do circuito, em ordem;
2. **classificação ao vivo**: ordenar por `voltas × L + s` é a ordem da corrida,
   sem contar checkpoint nem medir distância até ninguém;
3. **antitrapaça**: cortar caminho é impossível porque o miolo da pista é sólido,
   e cruzar a linha de ré **decrementa** a volta — simétrico, saldo zero.

O item 3 tem uma armadilha que custou um teste vermelho para aparecer, e vale
registrar: a primeira versão guardava um booleano "passou da metade". Ele não
serve, porque **quem cruza a linha de ré cai no último quarto**, que já é
`s > L/2` — o booleano ligava sozinho, e bastava voltar a cruzar para a frente
para ganhar uma volta que nunca foi dada. O que fecha o buraco é ORDEM: um setor
`0 → 1 → 2 → 3` que só avança de um em um. Ele continua sendo derivado do mesmo
`s` — não é um segundo lugar onde a pessoa "está" —, e é isso que mantém a fonte
única de pé.

O `hint` existe por custo: a busca ingênua é O(amostras) por jogador por tick
(8 × 600 × 40Hz). Como o kart se move de forma contínua, procurar numa janela em
volta da última amostra conhecida é O(60) e dá o mesmo resultado; a varredura
completa fica para a primeira chamada e para quem foi reposicionado.

### Classificação é individual, e é o que entra no contrato

Corrida por time seria estranha de um jeito que não dá para consertar: 1º e 2º do
mesmo time somem na soma. Então o placar de time **não é usado** — `scores` fica
zerado — e o estado da corrida entra como campo próprio, do mesmo jeito que
`flags` e `ball` já entram:

```ts
// no snapshot e no welcome, só no modo corrida
race?: {
  standings: ArenaRaceStanding[]   // posição, volta, melhor volta, terminou
  countdownMs?: number             // largada; ausente = já largou
  laps: number
}
```

O time continua sendo atribuído (`balanceTeam` não muda) porque metade do hub o
usa, mas na corrida ele é **cosmético**: a cor do kart sai de um hash do
`userId`, estável em todos os clientes, e não do lado do mapa.

### A largada é um prazo, não uma fase

`ARENA_RACE_COUNTDOWN_MS` de semáforo antes de a corrida valer, no molde do
`ballLockedUntil` do futebol: `phase` continua `jogando` e o que muda é um
instante guardado. Durante a contagem o kart não anda (a velocidade é forçada a
zero no tick) mas ninguém perde o teclado nem a câmera.

E a corrida acaba quando o **primeiro** completa as voltas, mais
`ARENA_RACE_FINISH_GRACE_MS` para os outros terminarem. Encerrar no primeiro
apagaria a disputa pelo 3º lugar, que numa corrida de oito é a maior parte do
jogo.

### Desatolar é obrigação, não conveniência

Não há abate na corrida, então não há renascimento — e um kart encostado de nariz
numa barreira, sem espaço para manobrar, ficaria preso pelos cinco minutos
inteiros. Uma mensagem nova (`{ type: 'unstuck' }`) devolve o piloto à linha de
centro na altura em que ele está, parado e apontado para a frente.

O custo de trapaça é nenhum: a linha de centro é o caminho mais LONGO entre dois
pontos da pista em termos de tempo (você para), e `s` não muda — não dá para
avançar com ela.

## Alternativas descartadas

**Kart como skin do `stepArena`, só mais rápido.** Sai quase de graça e não muda
contrato nenhum. Descartada porque tira exatamente o que faz corrida ser corrida:
sem inércia e sem esterço não há linha de curva, não há erro e não há
ultrapassagem — seria uma pista onde todo mundo anda igual.

**Corrida por time.** Encaixaria em `scores` sem tocar no contrato. Descartada
pelo motivo acima: a soma apaga a classificação individual, que é o placar que a
modalidade tem.

**Checkpoints como geometria própria no mapa.** É a solução mais comum e teria
funcionado. Descartada porque `s` já é necessário para a classificação ao vivo, e
gates desenhados no mapa seriam uma segunda noção de "onde a pessoa está na
pista", capaz de discordar da primeira. Os quartos do circuito fazem o mesmo
trabalho **derivados de `s`**, sem geometria nova.

**Grama que segura em vez de barreira sólida.** Mais indulgente e mais divertido,
mas exige uma segunda grade (superfície) ao lado da de colisão, compartilhada e
memoizada. Fica para depois: a barreira sólida é o v1 correto e não fecha a porta.

**Karts estacionados na pista, montados com `E`.** Reaproveitaria o gesto do
escritório. Descartada porque cria estado de kart livre/ocupado dentro da arena e
a chance de alguém ficar a pé no meio de uma corrida — que não é uma situação com
resposta boa.

## Consequências

- `ARENA_MODES` passa a ter quatro entradas; `modeHasShooting` exclui `corrida`
  **no servidor**, não só no botão.
- `ArenaSnapshotPlayer` ganha `h` (rumo) e `v` (velocidade), presentes só na
  corrida. São o que a reconciliação do dono precisa: reancorar sem eles
  reexecutaria os pendentes a partir de um rumo errado.
- `ArenaInterpolator` passa a interpolar ângulo pelo arco curto — interpolar
  linear faria o kart girar 350° ao cruzar o zero.
- `ArenaPredictor` fica genérico no passo (`stepArena` ou `stepArenaKart`), em
  vez de ganhar um irmão: duas implementações de reconciliação divergem sempre.
- O `arena-scenario` ganha um terceiro cenário (`pista`), e a cache continua por
  CENÁRIO — trocar de modo entre mata-mata e bandeira segue não remontando o
  Phaser.
