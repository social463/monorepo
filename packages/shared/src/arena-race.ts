/**
 * Corrida de kart na arena: a geometria da pista e o que conta como volta.
 *
 * As regras moram aqui, puras — o hub cuida do relógio e do broadcast, e o mapa
 * (`arena-race-map.ts`) é DESENHADO a partir desta geometria. É por isso que ela
 * vive neste módulo e não lá, pelo mesmo motivo do futebol: a barreira que o
 * piloto vê e a linha que o servidor mede têm de ser a mesma coisa, e a única
 * forma de garantir isso é uma fonte só.
 */

/** Lado do tile da pista. O mesmo do escritório, para os sprites servirem sem escala. */
export const RACE_TILE = 32

/**
 * Dimensões em tiles. Entre o campo de batalha (121×85) e o de futebol (81×49):
 * a pista precisa de reta longa para ultrapassar, e de curva fechada para errar.
 */
export const RACE_MAP_WIDTH = 121
export const RACE_MAP_HEIGHT = 81

/** Faixa de muro em volta, em tiles. Como nos outros cenários. */
export const RACE_WALL_TILES = 2

/**
 * Meia-largura do asfalto, em pixels.
 *
 * Três tiles e meio: 224px de pista, onde cabem uns quatro karts lado a lado
 * (`BODY_KART_BODY_HALF` é 10). Menos que isso e ultrapassar vira colisão
 * obrigatória; mais e a curva deixa de ter traçado.
 */
export const RACE_TRACK_HALF_WIDTH = 3.5 * RACE_TILE

/** Espessura da barreira de pneu em volta do asfalto, em tiles. */
export const RACE_BARRIER_TILES = 2

/**
 * Quantas amostras a linha de centro tem.
 *
 * Densas o bastante para o asfalto sair sem serrilha entre uma e outra (a
 * distância entre amostras fica bem abaixo de `RACE_TRACK_HALF_WIDTH`), e poucas
 * o bastante para a busca de progresso com janela ser barata.
 */
export const RACE_TRACK_SAMPLES = 600

/**
 * Voltas de uma corrida.
 *
 * Cinco, e não três, porque a volta é curta: o circuito tem ~8.300px, que a
 * `BODY_KART_MAX_SPEED` cobriria em 15s se desse para fazer tudo a fundo. Com
 * curva de verdade dá uns 20s, e cinco voltas põem a corrida em ~1min40 —
 * dentro dos cinco minutos de partida, com folga para o retardatário terminar.
 */
export const ARENA_RACE_LAPS = 5

/**
 * Semáforo antes de a corrida valer.
 *
 * É prazo, não fase da partida: `phase` continua `jogando`, e o que muda é um
 * instante guardado — mesmo desenho da saída de bola do futebol. Ninguém perde o
 * teclado nem a câmera; só o kart não anda.
 */
export const ARENA_RACE_COUNTDOWN_MS = 4_000

/**
 * Quanto tempo os outros têm para terminar depois do primeiro.
 *
 * Encerrar no vencedor apagaria a disputa pelo 3º lugar — que numa corrida de
 * oito é a maior parte do jogo.
 */
export const ARENA_RACE_FINISH_GRACE_MS = 20_000

/** Vagas do grid de largada. Acima disso, quem entra sai da última fila. */
export const ARENA_RACE_GRID_SLOTS = 8

/** Distância entre duas filas do grid, em pixels (ao longo da pista). */
const RACE_GRID_ROW_GAP = 46
/** Deslocamento lateral de cada vaga em relação à linha de centro, em pixels. */
const RACE_GRID_LATERAL = 52

export interface RacePoint {
  x: number
  y: number
}

export interface RaceGridSlot extends RacePoint {
  /** Para onde o kart aponta na largada, em radianos. */
  heading: number
}

export interface RaceTrack {
  /** A linha de centro, fechada, em PIXELS. `samples[0]` é a linha de chegada. */
  samples: RacePoint[]
  /** Distância acumulada até cada amostra; `cumulative[i]` ∈ [0, length). */
  cumulative: number[]
  /** Comprimento total da volta, em pixels. */
  length: number
  halfWidth: number
  /** Vagas da largada, da pole para trás. */
  grid: RaceGridSlot[]
}

/**
 * Os pontos de controle do circuito, em TILES.
 *
 * Desenhados à mão, e não gerados por uma oval paramétrica: oval não tem reta
 * longa nem grampo, e sem os dois não há onde ultrapassar nem onde errar. Daqui
 * saem, nesta ordem: a reta dos boxes (embaixo), a curva rápida da direita, o
 * esse do meio, o trecho de cima e a descida da esquerda.
 */
const CONTROL_POINTS: readonly RacePoint[] = [
  { x: 16, y: 62 },
  { x: 50, y: 66 },
  { x: 92, y: 66 },
  { x: 106, y: 56 },
  { x: 102, y: 40 },
  { x: 86, y: 34 },
  { x: 74, y: 42 },
  { x: 60, y: 30 },
  { x: 44, y: 26 },
  { x: 40, y: 14 },
  { x: 24, y: 16 },
  { x: 14, y: 32 },
]

/**
 * Catmull-Rom **centrípeta** (alfa = 0,5), não uniforme.
 *
 * A uniforme é uma linha a menos, e produz laço e bico quando dois pontos de
 * controle estão perto e o seguinte longe — que é exatamente o caso num esse. Um
 * laço na linha de centro não é feio: ele faria a pista cruzar consigo mesma, e
 * com ela o cálculo de volta.
 */
function catmullRom(p0: RacePoint, p1: RacePoint, p2: RacePoint, p3: RacePoint, t: number): RacePoint {
  const dist = (a: RacePoint, b: RacePoint) => Math.hypot(b.x - a.x, b.y - a.y) ** 0.5
  const t0 = 0
  const t1 = t0 + dist(p0, p1)
  const t2 = t1 + dist(p1, p2)
  const t3 = t2 + dist(p2, p3)
  // Pontos coincidentes zerariam um intervalo e dividiriam por zero; o circuito
  // não tem nenhum, mas a guarda evita que um ponto de controle repetido no
  // futuro vire NaN silencioso espalhado pela pista inteira.
  if (t1 === t0 || t2 === t1 || t3 === t2) return p1

  const tt = t1 + (t2 - t1) * t
  const lerp = (a: RacePoint, b: RacePoint, ta: number, tb: number): RacePoint => {
    const k = (tb - tt) / (tb - ta)
    return { x: a.x * k + b.x * (1 - k), y: a.y * k + b.y * (1 - k) }
  }
  const a1 = lerp(p0, p1, t0, t1)
  const a2 = lerp(p1, p2, t1, t2)
  const a3 = lerp(p2, p3, t2, t3)
  const b1 = lerp(a1, a2, t0, t2)
  const b2 = lerp(a2, a3, t1, t3)
  return lerp(b1, b2, t1, t2)
}

function buildTrack(): RaceTrack {
  const n = CONTROL_POINTS.length
  const bruto: RacePoint[] = []
  // Por segmento entre pontos de controle, e não por t global: a spline é
  // definida em pedaços, e amostrar "o circuito" de uma vez não existe.
  const porSegmento = Math.round(RACE_TRACK_SAMPLES / n)
  for (let i = 0; i < n; i += 1) {
    const p0 = CONTROL_POINTS[(i - 1 + n) % n]
    const p1 = CONTROL_POINTS[i]
    const p2 = CONTROL_POINTS[(i + 1) % n]
    const p3 = CONTROL_POINTS[(i + 2) % n]
    for (let k = 0; k < porSegmento; k += 1) {
      const ponto = catmullRom(p0, p1, p2, p3, k / porSegmento)
      bruto.push({ x: ponto.x * RACE_TILE, y: ponto.y * RACE_TILE })
    }
  }

  const cumulative: number[] = []
  let total = 0
  for (let i = 0; i < bruto.length; i += 1) {
    cumulative.push(total)
    const proximo = bruto[(i + 1) % bruto.length]
    total += Math.hypot(proximo.x - bruto[i].x, proximo.y - bruto[i].y)
  }

  const track: RaceTrack = {
    samples: bruto,
    cumulative,
    length: total,
    halfWidth: RACE_TRACK_HALF_WIDTH,
    grid: [],
  }
  track.grid = buildGrid(track)
  return track
}

/**
 * O grid de largada: filas de dois, atrás da linha de chegada.
 *
 * Atrás, e não em cima: largar sobre a linha faria a primeira passagem por ela
 * contar como volta. O `s` negativo é resolvido pelo módulo em `pointAt`.
 */
function buildGrid(track: RaceTrack): RaceGridSlot[] {
  const vagas: RaceGridSlot[] = []
  for (let i = 0; i < ARENA_RACE_GRID_SLOTS; i += 1) {
    const fila = Math.floor(i / 2)
    // A pole é a fila mais adiantada; a vaga 0 fica logo atrás da linha.
    const s = -(RACE_GRID_ROW_GAP * (fila + 1))
    const { point, heading } = pointAt(track, s)
    const lado = i % 2 === 0 ? -1 : 1
    // Perpendicular ao rumo: o grid é escalonado nos dois lados da linha de
    // centro, como num grid de verdade.
    vagas.push({
      x: point.x + Math.cos(heading + Math.PI / 2) * RACE_GRID_LATERAL * lado,
      y: point.y + Math.sin(heading + Math.PI / 2) * RACE_GRID_LATERAL * lado,
      heading,
    })
  }
  return vagas
}

/**
 * Ponto e rumo da linha de centro numa distância `s` (em pixels, dá a volta).
 *
 * Aceita `s` negativo e maior que o comprimento: o circuito é fechado, e o
 * módulo é a única leitura correta de "quarenta pixels antes da linha".
 */
export function pointAt(track: RaceTrack, s: number): { point: RacePoint; heading: number } {
  const total = track.samples.length
  const alvo = ((s % track.length) + track.length) % track.length
  // Busca binária no acumulado: `pointAt` é chamada para montar o grid e para
  // desatolar, nunca no tick, mas linear aqui seria O(600) sem motivo.
  let baixo = 0
  let alto = total - 1
  while (baixo < alto) {
    const meio = (baixo + alto + 1) >> 1
    if (track.cumulative[meio] <= alvo) baixo = meio
    else alto = meio - 1
  }
  const a = track.samples[baixo]
  const b = track.samples[(baixo + 1) % total]
  const span = (track.cumulative[(baixo + 1) % total] || track.length) - track.cumulative[baixo]
  const t = span <= 0 ? 0 : (alvo - track.cumulative[baixo]) / span
  return {
    point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
    heading: Math.atan2(b.y - a.y, b.x - a.x),
  }
}

/**
 * Quantas amostras em volta da última conhecida a busca de progresso varre.
 *
 * A busca ingênua é O(amostras) por jogador por tick — 8 × 600 × 40Hz. Como o
 * kart se move de forma contínua, uma janela em volta da última amostra dá o
 * MESMO resultado por muito menos: a 560 px/s e 25ms de tick, ele anda 14px, e
 * as amostras estão a ~16px uma da outra.
 */
const PROGRESS_WINDOW = 30

export interface RaceProgress {
  /** Distância percorrida ao longo da volta, em pixels: `s` ∈ [0, comprimento). */
  s: number
  /** Amostra mais próxima — serve de `hint` na chamada seguinte. */
  index: number
}

/**
 * Onde na volta está este ponto.
 *
 * Sem `hint`, varre a pista inteira: é o que vale na primeira chamada e para
 * quem foi reposicionado. Com `hint`, varre a janela — e o resultado é o mesmo
 * enquanto o kart tiver se movido de forma contínua, que é a única maneira de
 * ele se mover.
 */
export function raceProgressAt(track: RaceTrack, x: number, y: number, hint?: number): RaceProgress {
  const total = track.samples.length
  const janela = hint === undefined ? total : PROGRESS_WINDOW * 2 + 1
  const inicio = hint === undefined ? 0 : hint - PROGRESS_WINDOW

  let melhor = hint ?? 0
  let melhorDistancia = Infinity
  for (let k = 0; k < janela; k += 1) {
    const i = ((inicio + k) % total + total) % total
    const amostra = track.samples[i]
    const distancia = (amostra.x - x) ** 2 + (amostra.y - y) ** 2
    if (distancia < melhorDistancia) {
      melhorDistancia = distancia
      melhor = i
    }
  }

  // Projeta no segmento seguinte para ter resolução abaixo da amostra. Sem isto
  // a classificação andaria aos saltos de 16px — visível quando dois karts
  // disputam a mesma posição.
  const a = track.samples[melhor]
  const b = track.samples[(melhor + 1) % total]
  const vx = b.x - a.x
  const vy = b.y - a.y
  const comprimento = vx * vx + vy * vy
  const t = comprimento <= 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / comprimento))
  const span = (track.cumulative[(melhor + 1) % total] || track.length) - track.cumulative[melhor]
  return { s: track.cumulative[melhor] + span * t, index: melhor }
}

/** A pista. Constante: mesmo circuito no servidor e no cliente. */
export const RACE_TRACK: RaceTrack = buildTrack()

/** Quem está correndo, do ponto de vista das regras. */
export interface ArenaRaceRunner {
  /** Voltas COMPLETAS. Começa em 0 e termina em `ARENA_RACE_LAPS`. */
  lap: number
  /** Progresso na volta atual, em pixels. */
  s: number
  /** Amostra mais próxima, para a janela da busca seguinte. */
  index: number
  /**
   * Até que quarto da volta o piloto chegou, EM ORDEM: 0 → 1 → 2 → 3.
   *
   * Não é um checkpoint no mapa — é derivado do mesmo `s`, então continua
   * havendo uma única noção de "onde a pessoa está na pista". O que ele
   * acrescenta é ORDEM, e é ela que fecha o antitrapaça.
   *
   * Um booleano de "passou da metade" não bastava, e a falha é sutil: quem
   * atravessa a linha de ré cai no último quarto, que já é `s > L/2` — o
   * booleano ligava sozinho, e bastava voltar a cruzar para a frente para ganhar
   * a volta. Com o setor, quem nunca passou pelo primeiro e pelo segundo quarto
   * não chega ao terceiro, e vaivém em cima da linha não rende nada.
   */
  sector: 0 | 1 | 2 | 3
  /** Instante em que completou a última volta — base do tempo de volta. */
  lastLapAt: number
  /** Melhor volta, em ms; ausente enquanto não completou nenhuma. */
  bestLapMs?: number
  /** Instante em que terminou a corrida; `0` = ainda correndo. */
  finishedAt: number
}

export function newRaceRunner(s: number, index: number, now: number): ArenaRaceRunner {
  return { lap: 0, s, index, sector: 0, lastLapAt: now, finishedAt: 0 }
}

export interface RaceAdvance {
  runner: ArenaRaceRunner
  /** Completou uma volta agora — evento para som e aviso. */
  lapped: boolean
  /** Cruzou pela última vez: terminou a corrida agora. */
  finished: boolean
}

/**
 * Avança o progresso de um piloto e diz se ele virou a volta.
 *
 * A volta é DISTÂNCIA PERCORRIDA, não checkpoint. A mesma medida serve para três
 * coisas — contar volta, classificar ao vivo e impedir corte de caminho — e ter
 * duas noções de "onde a pessoa está na pista" abriria a porta para elas
 * discordarem.
 */
export function advanceRaceRunner(
  runner: ArenaRaceRunner,
  progress: RaceProgress,
  track: RaceTrack,
  now: number,
  laps: number = ARENA_RACE_LAPS,
): RaceAdvance {
  if (runner.finishedAt > 0) return { runner, lapped: false, finished: false }

  const anterior = runner.s
  const s = progress.s
  const quarto = track.length / 4
  const proximo: ArenaRaceRunner = { ...runner, s, index: progress.index }

  // O setor só avança de um em um, e só para a frente. Pular (ou voltar) não
  // desfaz o que já foi conquistado nesta volta: quem recua um pouco depois da
  // metade não perde o direito de fechá-la.
  // O `min` segura o caso de borda: com `s` exatamente igual ao comprimento
  // (arredondamento na projeção), a divisão daria 4 — um setor que não existe.
  const atual = Math.min(3, Math.floor(s / quarto))
  if (atual === runner.sector + 1) proximo.sector = atual as ArenaRaceRunner['sector']

  let lapped = false
  let finished = false
  // Cruzou para a frente: veio do último quarto e caiu no primeiro.
  if (anterior > track.length - quarto && s < quarto) {
    if (runner.sector === 3) {
      proximo.lap = runner.lap + 1
      proximo.sector = 0
      const tempo = now - runner.lastLapAt
      proximo.lastLapAt = now
      if (proximo.bestLapMs === undefined || tempo < proximo.bestLapMs) proximo.bestLapMs = tempo
      lapped = true
      if (proximo.lap >= laps) {
        proximo.finishedAt = now
        finished = true
      }
    } else {
      // Chegou na linha sem ter feito a volta (só pode ser dando ré antes dela
      // e voltando). Não conta, e o setor continua onde estava.
      proximo.sector = runner.sector
    }
  } else if (anterior < quarto && s > track.length - quarto) {
    // Cruzou de ré. Se havia volta, desconta e devolve o setor: é simétrico, e
    // o saldo de ir-e-voltar é zero.
    //
    // Sem volta para descontar, o setor volta a ZERO em vez de 3. É o que fecha
    // o vaivém na largada: dar ré antes da linha não pode entregar de graça o
    // setor que só se conquista dando a volta inteira.
    if (runner.lap > 0) {
      proximo.lap = runner.lap - 1
      proximo.sector = 3
    } else {
      proximo.sector = 0
    }
  }

  return { runner: proximo, lapped, finished }
}

/** Uma linha da classificação, como o cliente a recebe. */
export interface ArenaRaceStanding {
  userId: string
  /** 1 = líder. */
  position: number
  /** Voltas completas. */
  lap: number
  /** Terminou a corrida. */
  finished: boolean
  bestLapMs?: number
}

/**
 * A ordem da corrida.
 *
 * Quem terminou vem primeiro, na ordem em que terminou; depois, quem está
 * correndo, por distância total percorrida (`voltas × comprimento + s`) — que é
 * literalmente a ordem em que estão na pista.
 *
 * O desempate final é o `userId`, e não a ordem de chegada dos dados: duas
 * pessoas com progresso idêntico (a largada, antes de o semáforo abrir) trocariam
 * de posição a cada snapshot, e a tela piscaria sem que nada tivesse acontecido.
 */
export function raceStandings(
  runners: ReadonlyMap<string, ArenaRaceRunner>,
  track: RaceTrack,
): ArenaRaceStanding[] {
  return [...runners.entries()]
    .sort(([idA, a], [idB, b]) => {
      if (a.finishedAt > 0 || b.finishedAt > 0) {
        if (a.finishedAt === 0) return 1
        if (b.finishedAt === 0) return -1
        if (a.finishedAt !== b.finishedAt) return a.finishedAt - b.finishedAt
        return idA.localeCompare(idB)
      }
      const percorridoA = a.lap * track.length + a.s
      const percorridoB = b.lap * track.length + b.s
      if (percorridoA !== percorridoB) return percorridoB - percorridoA
      return idA.localeCompare(idB)
    })
    .map(([userId, runner], indice) => ({
      userId,
      position: indice + 1,
      lap: runner.lap,
      finished: runner.finishedAt > 0,
      ...(runner.bestLapMs !== undefined ? { bestLapMs: runner.bestLapMs } : {}),
    }))
}
