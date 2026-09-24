import { describe, expect, it } from 'vitest'
import {
  advanceRaceRunner,
  ARENA_RACE_GRID_SLOTS,
  ARENA_RACE_LAPS,
  newRaceRunner,
  pointAt,
  RACE_BARRIER_TILES,
  RACE_MAP_HEIGHT,
  RACE_MAP_WIDTH,
  RACE_TILE,
  RACE_TRACK,
  RACE_TRACK_HALF_WIDTH,
  RACE_WALL_TILES,
  raceProgressAt,
  raceStandings,
  type ArenaRaceRunner,
} from './arena-race'

describe('geometria da pista', () => {
  it('fecha o circuito', () => {
    const primeiro = RACE_TRACK.samples[0]
    const ultimo = RACE_TRACK.samples[RACE_TRACK.samples.length - 1]
    // A última amostra tem de estar a um passo da primeira: a lista é fechada,
    // e um vão aqui viraria um salto no acumulado — e uma volta a menos.
    const passo = RACE_TRACK.length / RACE_TRACK.samples.length
    expect(Math.hypot(ultimo.x - primeiro.x, ultimo.y - primeiro.y)).toBeLessThan(passo * 2.5)
  })

  it('cabe dentro do mapa, com folga para asfalto e barreira', () => {
    const margem = RACE_TRACK_HALF_WIDTH + RACE_BARRIER_TILES * RACE_TILE + RACE_WALL_TILES * RACE_TILE
    for (const amostra of RACE_TRACK.samples) {
      expect(amostra.x).toBeGreaterThan(margem)
      expect(amostra.y).toBeGreaterThan(margem)
      expect(amostra.x).toBeLessThan(RACE_MAP_WIDTH * RACE_TILE - margem)
      expect(amostra.y).toBeLessThan(RACE_MAP_HEIGHT * RACE_TILE - margem)
    }
  })

  it('nunca passa perto de si mesma', () => {
    // O teste que sustenta a contagem de voltas. Dois trechos distantes ao longo
    // da pista, mas próximos no plano, fundiriam o asfalto num só — sem barreira
    // entre eles, dá para pular de um trecho ao outro, e o progresso salta.
    const separacao = (RACE_TRACK_HALF_WIDTH + RACE_BARRIER_TILES * RACE_TILE) * 2
    const total = RACE_TRACK.samples.length
    // "Distantes ao longo da pista" = mais de uma separação de arco entre elas;
    // amostras vizinhas são obviamente próximas no plano, e é isso que se quer.
    // O arco é CIRCULAR: a lista é fechada, então a amostra 0 e a última são
    // vizinhas — compará-las acusaria uma falsa auto-aproximação de um passo.
    const vizinhanca = Math.ceil((separacao * 2) / (RACE_TRACK.length / total))
    let pior = Infinity
    for (let i = 0; i < total; i += 1) {
      for (let j = i + 1; j < total; j += 1) {
        const arco = Math.min(j - i, total - (j - i))
        if (arco <= vizinhanca) continue
        const a = RACE_TRACK.samples[i]
        const b = RACE_TRACK.samples[j]
        pior = Math.min(pior, Math.hypot(b.x - a.x, b.y - a.y))
      }
    }
    expect(pior).toBeGreaterThan(separacao)
  })

  it('tem uma vaga de grid por piloto, todas atrás da linha', () => {
    expect(RACE_TRACK.grid).toHaveLength(ARENA_RACE_GRID_SLOTS)
    for (const vaga of RACE_TRACK.grid) {
      const { s } = raceProgressAt(RACE_TRACK, vaga.x, vaga.y)
      // Atrás da linha = no fim da volta. Largar em cima dela faria a primeira
      // passagem contar como volta completa.
      expect(s).toBeGreaterThan(RACE_TRACK.length * 0.75)
    }
  })

  it('põe as vagas do grid dentro do asfalto', () => {
    for (const vaga of RACE_TRACK.grid) {
      const { s } = raceProgressAt(RACE_TRACK, vaga.x, vaga.y)
      const { point } = pointAt(RACE_TRACK, s)
      expect(Math.hypot(point.x - vaga.x, point.y - vaga.y)).toBeLessThan(RACE_TRACK_HALF_WIDTH)
    }
  })
})

describe('raceProgressAt', () => {
  it('mede zero na linha de chegada', () => {
    const largada = RACE_TRACK.samples[0]
    expect(raceProgressAt(RACE_TRACK, largada.x, largada.y).s).toBeLessThan(2)
  })

  it('cresce ao longo da pista', () => {
    const meio = pointAt(RACE_TRACK, RACE_TRACK.length / 2)
    const { s } = raceProgressAt(RACE_TRACK, meio.point.x, meio.point.y)
    expect(s).toBeCloseTo(RACE_TRACK.length / 2, 0)
  })

  it('com hint dá o mesmo resultado da varredura completa', () => {
    // É a propriedade que autoriza a janela: se ela não valer, o progresso do
    // tick discorda do da primeira chamada e a classificação salta.
    for (let k = 0; k < 40; k += 1) {
      const s = (RACE_TRACK.length * k) / 40
      const { point } = pointAt(RACE_TRACK, s)
      const completo = raceProgressAt(RACE_TRACK, point.x, point.y)
      const comHint = raceProgressAt(RACE_TRACK, point.x, point.y, completo.index)
      expect(comHint.s).toBeCloseTo(completo.s, 6)
    }
  })
})

/** Roda o piloto pela pista, em passos de `passo` pixels. */
function correr(
  runner: ArenaRaceRunner,
  de: number,
  ate: number,
  now: number,
  passo = 60,
): { runner: ArenaRaceRunner; voltas: number; terminou: boolean } {
  let atual = runner
  let voltas = 0
  let terminou = false
  const sentido = ate >= de ? 1 : -1
  for (let s = de; sentido > 0 ? s <= ate : s >= ate; s += passo * sentido) {
    const modulo = ((s % RACE_TRACK.length) + RACE_TRACK.length) % RACE_TRACK.length
    const { point } = pointAt(RACE_TRACK, modulo)
    const progresso = raceProgressAt(RACE_TRACK, point.x, point.y, atual.index)
    const avanco = advanceRaceRunner(atual, progresso, RACE_TRACK, now)
    atual = avanco.runner
    if (avanco.lapped) voltas += 1
    if (avanco.finished) terminou = true
  }
  return { runner: atual, voltas, terminou }
}

describe('contagem de voltas', () => {
  it('conta uma volta ao cruzar a linha depois de dar a volta inteira', () => {
    const inicio = newRaceRunner(0, 0, 0)
    const { runner, voltas } = correr(inicio, 0, RACE_TRACK.length + 200, 1_000)
    expect(voltas).toBe(1)
    expect(runner.lap).toBe(1)
  })

  it('não conta volta de quem vai e volta em cima da linha', () => {
    // O antitrapaça: sem o `halfway`, ir 200px à frente e 400px atrás repetidas
    // vezes cruzaria a linha para sempre e daria voltas de graça.
    let runner = newRaceRunner(0, 0, 0)
    for (let k = 0; k < 5; k += 1) {
      runner = correr(runner, 0, -400, 1_000, 50).runner
      runner = correr(runner, RACE_TRACK.length - 400, RACE_TRACK.length + 200, 1_000, 50).runner
    }
    expect(runner.lap).toBe(0)
  })

  it('desconta a volta de quem cruza a linha de ré', () => {
    const primeira = correr(newRaceRunner(0, 0, 0), 0, RACE_TRACK.length + 200, 1_000)
    expect(primeira.runner.lap).toBe(1)
    const voltando = correr(primeira.runner, 200, -300, 2_000, 50)
    expect(voltando.runner.lap).toBe(0)
  })

  it('termina a corrida na última volta', () => {
    let runner = newRaceRunner(0, 0, 0)
    let terminou = false
    for (let volta = 0; volta < ARENA_RACE_LAPS; volta += 1) {
      const trecho = correr(runner, volta * RACE_TRACK.length, (volta + 1) * RACE_TRACK.length + 200, 1_000 * (volta + 1))
      runner = trecho.runner
      terminou = terminou || trecho.terminou
    }
    expect(runner.lap).toBe(ARENA_RACE_LAPS)
    expect(terminou).toBe(true)
    expect(runner.finishedAt).toBeGreaterThan(0)
  })

  it('congela quem já terminou', () => {
    const terminado: ArenaRaceRunner = { ...newRaceRunner(0, 0, 0), finishedAt: 5_000, lap: ARENA_RACE_LAPS }
    const { point } = pointAt(RACE_TRACK, RACE_TRACK.length / 2)
    const avanco = advanceRaceRunner(terminado, raceProgressAt(RACE_TRACK, point.x, point.y), RACE_TRACK, 9_000)
    expect(avanco.runner).toBe(terminado)
    expect(avanco.lapped).toBe(false)
  })

  it('guarda a melhor volta', () => {
    let runner = newRaceRunner(0, 0, 0)
    runner = correr(runner, 0, RACE_TRACK.length + 200, 30_000).runner
    expect(runner.bestLapMs).toBe(30_000)
    runner = correr(runner, RACE_TRACK.length + 200, 2 * RACE_TRACK.length + 200, 45_000).runner
    // A segunda volta levou 15s — melhor que a primeira, então substitui.
    expect(runner.bestLapMs).toBe(15_000)
  })
})

describe('raceStandings', () => {
  const runner = (over: Partial<ArenaRaceRunner>): ArenaRaceRunner => ({
    ...newRaceRunner(0, 0, 0),
    ...over,
  })

  it('ordena por distância percorrida', () => {
    const standings = raceStandings(
      new Map([
        ['atras', runner({ lap: 0, s: 900 })],
        ['lider', runner({ lap: 2, s: 100 })],
        ['meio', runner({ lap: 1, s: 500 })],
      ]),
      RACE_TRACK,
    )
    expect(standings.map((linha) => linha.userId)).toEqual(['lider', 'meio', 'atras'])
    expect(standings[0].position).toBe(1)
  })

  it('põe quem terminou na frente, na ordem de chegada', () => {
    const standings = raceStandings(
      new Map([
        ['correndo', runner({ lap: 2, s: RACE_TRACK.length - 1 })],
        ['segundo', runner({ finishedAt: 2_000, lap: 3 })],
        ['primeiro', runner({ finishedAt: 1_000, lap: 3 })],
      ]),
      RACE_TRACK,
    )
    expect(standings.map((linha) => linha.userId)).toEqual(['primeiro', 'segundo', 'correndo'])
    expect(standings[2].finished).toBe(false)
  })

  it('desempata de forma estável', () => {
    // Na largada todo mundo tem progresso idêntico. Sem desempate determinístico
    // a lista trocaria de ordem a cada snapshot, e a tela piscaria sozinha.
    const empatados = new Map([
      ['bravo', runner({})],
      ['alfa', runner({})],
      ['charlie', runner({})],
    ])
    expect(raceStandings(empatados, RACE_TRACK).map((l) => l.userId)).toEqual(
      raceStandings(empatados, RACE_TRACK).map((l) => l.userId),
    )
    expect(raceStandings(empatados, RACE_TRACK)[0].userId).toBe('alfa')
  })
})
