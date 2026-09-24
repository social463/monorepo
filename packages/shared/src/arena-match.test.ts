import { describe, expect, it } from 'vitest'
import {
  ARENA_HIT_RECOVERY_MS,
  ARENA_MAX_HITS,
  ARENA_SCORE_LIMIT,
  ARENA_TEAMS,
  applyArenaHit,
  hitsAfterRecovery,
  arenaHitRefusal,
  balanceTeam,
  emptyScores,
  matchIsOver,
  matchWinner,
  type ArenaCombatant,
} from './index'

const emCampo = (userId: string, team: 'oeste' | 'leste'): ArenaCombatant => ({
  userId,
  team,
  downedUntil: 0,
  protectedUntil: 0,
  hits: 0,
  lastHitAt: 0,
})

describe('balanceTeam', () => {
  it('manda para o time com menos gente', () => {
    expect(balanceTeam({ oeste: 3, leste: 1 })).toBe('leste')
    expect(balanceTeam({ oeste: 0, leste: 2 })).toBe('oeste')
  })

  // Sortear faria duas pessoas que entram juntas caírem no mesmo lado com
  // frequência incômoda, sem ninguém entender por quê.
  it('no empate é determinístico, não sorteado', () => {
    expect(balanceTeam({ oeste: 2, leste: 2 })).toBe(balanceTeam({ oeste: 2, leste: 2 }))
  })

  it('enchendo a arena um a um, os times ficam parelhos', () => {
    const counts = emptyScores()
    for (let i = 0; i < 10; i += 1) counts[balanceTeam(counts)] += 1
    expect(counts.oeste).toBe(counts.leste)
  })
})

describe('arenaHitRefusal', () => {
  const ana = emCampo('ana', 'oeste')
  const bruno = emCampo('bruno', 'leste')

  it('inimigo em campo: o tiro conta', () => {
    expect(arenaHitRefusal(ana, bruno, 1_000, 'jogando')).toBeNull()
  })

  /**
   * Punir quem passou na frente do colega transforma equipe em armadilha. E
   * abater sem pontuar seria pior: castiga o time inteiro por um acidente.
   */
  it('fogo amigo não conta', () => {
    expect(arenaHitRefusal(ana, emCampo('carla', 'oeste'), 1_000, 'jogando')).toBe('mesmo-time')
  })

  it('quem já está abatido não leva de novo', () => {
    expect(arenaHitRefusal(ana, { ...bruno, downedUntil: 2_000 }, 1_000, 'jogando')).toBe('ja-abatido')
  })

  // Sem carência, quem espera na base do adversário abate a pessoa no quadro
  // em que ela volta, e o jogo vira fila de execução.
  it('quem acabou de renascer está protegido', () => {
    expect(arenaHitRefusal(ana, { ...bruno, protectedUntil: 2_000 }, 1_000, 'jogando')).toBe('protegido')
  })

  it('a carência expira', () => {
    expect(arenaHitRefusal(ana, { ...bruno, protectedUntil: 900 }, 1_000, 'jogando')).toBeNull()
  })

  it('fora da fase de jogo, nada conta', () => {
    expect(arenaHitRefusal(ana, bruno, 1_000, 'intervalo')).toBe('fora-de-jogo')
  })

  it('atirador ou alvo que saíram da arena não contam', () => {
    expect(arenaHitRefusal(undefined, bruno, 1_000, 'jogando')).toBe('fora-de-jogo')
    expect(arenaHitRefusal(ana, undefined, 1_000, 'jogando')).toBe('fora-de-jogo')
  })
})

describe('fim de partida', () => {
  it('acaba no tempo', () => {
    expect(matchIsOver({ scores: emptyScores(), remainingMs: 0 })).toBe(true)
    expect(matchIsOver({ scores: emptyScores(), remainingMs: 1 })).toBe(false)
  })

  it('acaba ao bater o limite de pontos, mesmo sobrando tempo', () => {
    expect(
      matchIsOver({ scores: { oeste: ARENA_SCORE_LIMIT, leste: 3 }, remainingMs: 60_000 }),
    ).toBe(true)
  })

  it('o vencedor é quem tem mais pontos; empate é empate', () => {
    expect(matchWinner({ oeste: 5, leste: 2 })).toBe('oeste')
    expect(matchWinner({ oeste: 2, leste: 5 })).toBe('leste')
    expect(matchWinner({ oeste: 4, leste: 4 })).toBeNull()
  })

  it('há exatamente dois times, e o placar começa zerado nos dois', () => {
    expect(ARENA_TEAMS).toHaveLength(2)
    expect(emptyScores()).toEqual({ oeste: 0, leste: 0 })
  })
})

describe('vida em tiros', () => {
  const alvo = emCampo('bruno', 'leste')

  // Com um tiro só, quem atira primeiro ganha sempre e o duelo acaba antes de
  // virar duelo. Três dão espaço para recuar e responder.
  it('aguenta os primeiros tiros e cai no último', () => {
    let atual = { ...alvo }
    for (let i = 1; i < ARENA_MAX_HITS; i += 1) {
      const r = applyArenaHit(atual, 1_000)
      expect(r.downed).toBe(false)
      atual = { ...atual, hits: r.hits, lastHitAt: 1_000 }
    }
    expect(applyArenaHit(atual, 1_000).downed).toBe(true)
  })

  it('o tiro que derruba é o de número ARENA_MAX_HITS', () => {
    const quase = { ...alvo, hits: ARENA_MAX_HITS - 1, lastHitAt: 1_000 }
    expect(applyArenaHit(quase, 1_100)).toEqual({ hits: ARENA_MAX_HITS, downed: true })
  })

  /**
   * Sem recuperação, quem levasse dois tiros ficaria frágil pelo resto da
   * partida — e a única saída seria morrer para zerar, o que premia jogar mal.
   */
  it('recupera um tiro a cada janela sem levar tinta', () => {
    expect(hitsAfterRecovery(2, 0, ARENA_HIT_RECOVERY_MS - 1)).toBe(2)
    expect(hitsAfterRecovery(2, 0, ARENA_HIT_RECOVERY_MS)).toBe(1)
    expect(hitsAfterRecovery(2, 0, ARENA_HIT_RECOVERY_MS * 2)).toBe(0)
    // Não fica negativo por mais que se espere.
    expect(hitsAfterRecovery(2, 0, ARENA_HIT_RECOVERY_MS * 50)).toBe(0)
  })

  it('quem recuou a tempo volta a aguentar tudo de novo', () => {
    const machucado = { ...alvo, hits: ARENA_MAX_HITS - 1, lastHitAt: 0 }
    expect(applyArenaHit(machucado, ARENA_HIT_RECOVERY_MS * 2).downed).toBe(false)
  })

  it('sem tiro nenhum, não há o que recuperar', () => {
    expect(hitsAfterRecovery(0, 0, 999_999)).toBe(0)
  })
})
