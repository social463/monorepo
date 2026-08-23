import { describe, it, expect } from 'vitest'
import { RETRO_ROOM_STATUS, RETRO_CARD_COLORS, RETRO_REGIONS, retroRoomTitle, RETRO_FLOAT_REACTIONS, currentRetroTimerSeconds, formatRetroTimerSeconds } from './retro'

describe('retroRoomTitle', () => {
  it('1 squad usa rótulo singular', () => {
    expect(retroRoomTitle(23, ['Inovação'])).toBe('Retrospectiva Sprint 23 - Squad Inovação')
  })
  it('2+ squads usam rótulo plural com nomes separados por vírgula', () => {
    expect(retroRoomTitle(23, ['B2B', 'Inovação'])).toBe('Retrospectiva Sprint 23 - Squads B2B, Inovação')
  })
  it('lista vazia degrada para singular sem nome', () => {
    expect(retroRoomTitle(5, [])).toBe('Retrospectiva Sprint 5 - Squad ')
  })
})

describe('retro shared contract (canvas)', () => {
  it('sala tem só OPEN e CONCLUDED', () => {
    expect(RETRO_ROOM_STATUS).toEqual(['OPEN', 'CONCLUDED'])
  })
  it('paleta tem 6 cores', () => {
    expect(RETRO_CARD_COLORS).toEqual(['yellow', 'pink', 'green', 'blue', 'purple', 'orange'])
  })
  it('tem as 5 regiões de fundo rotuladas', () => {
    expect(RETRO_REGIONS).toHaveLength(5)
    for (const r of RETRO_REGIONS) {
      expect(r.label).toBeTruthy()
      expect(typeof r.x).toBe('number')
      expect(typeof r.w).toBe('number')
    }
  })
  it('dispõe 4 quadrantes em 2x2 e Ações deslocada à direita', () => {
    const byId = Object.fromEntries(RETRO_REGIONS.map((r) => [r.id, r]))
    // mesma linha de cima
    expect(byId.went_well.y).toBe(byId.went_bad.y)
    // mesma coluna da esquerda
    expect(byId.went_well.x).toBe(byId.start.x)
    // ruim à direita do bom; começar abaixo do bom
    expect(byId.went_bad.x).toBeGreaterThan(byId.went_well.x)
    expect(byId.start.y).toBeGreaterThan(byId.went_well.y)
    // Ações fica à direita de todos os quadrantes
    expect(byId.actions.x).toBeGreaterThan(byId.went_bad.x + byId.went_bad.w)
  })
})

describe('RETRO_FLOAT_REACTIONS', () => {
  it('tem os 7 emojis flutuantes na ordem definida', () => {
    expect(RETRO_FLOAT_REACTIONS).toEqual(['👍', '❤️', '😂', '😮', '😢', '👏', '🎉'])
  })
})

describe('retro timer helpers', () => {
  it('formata mm:ss e h:mm:ss', () => {
    expect(formatRetroTimerSeconds(0)).toBe('00:00')
    expect(formatRetroTimerSeconds(65)).toBe('01:05')
    expect(formatRetroTimerSeconds(3661)).toBe('1:01:01')
  })

  it('calcula crescente rodando', () => {
    expect(currentRetroTimerSeconds({
      mode: 'elapsed',
      status: 'running',
      durationSeconds: null,
      startedAt: '2026-08-04T10:00:00.000Z',
      accumulatedSeconds: 30,
    }, Date.parse('2026-08-04T10:00:10.000Z'))).toBe(40)
  })

  it('calcula regressivo sem ficar negativo', () => {
    expect(currentRetroTimerSeconds({
      mode: 'countdown',
      status: 'running',
      durationSeconds: 60,
      startedAt: '2026-08-04T10:00:00.000Z',
      accumulatedSeconds: 30,
    }, Date.parse('2026-08-04T10:02:00.000Z'))).toBe(0)
  })
})
