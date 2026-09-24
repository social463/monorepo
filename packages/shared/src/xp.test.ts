import { describe, expect, it } from 'vitest'
import { contrastRatio } from './color'
import { XP_LEVELS, XP_LEVEL_ON_COLOR, XP_RULE_EVENTS, XP_EVENTS, computeLevel, levelColor } from './xp'

describe('XP_LEVELS', () => {
  it('começa em zero e sobe', () => {
    expect(XP_LEVELS[0]!.min).toBe(0)
    const mins = XP_LEVELS.map((level) => level.min)
    expect([...mins].sort((a, b) => a - b)).toEqual(mins)
  })

  it('usa os cortes do protótipo do portal', () => {
    expect(XP_LEVELS.map((level) => [level.name, level.min])).toEqual([
      ['Bronze', 0],
      ['Prata', 500],
      ['Ouro', 1500],
      ['Platina', 3500],
      ['Diamante', 7500],
    ])
  })
})

describe('computeLevel', () => {
  it('zerado é Bronze no início da faixa', () => {
    expect(computeLevel(0)).toMatchObject({ name: 'Bronze', next: 'Prata', progress: 0, remaining: 500 })
  })

  it('o corte é inclusivo: bater o mínimo já promove', () => {
    expect(computeLevel(499).name).toBe('Bronze')
    expect(computeLevel(500).name).toBe('Prata')
  })

  it('progresso é medido dentro da faixa, não sobre o total', () => {
    // 1000 está na metade de Prata (500 → 1500), e não em 1000/1500.
    expect(computeLevel(1000).progress).toBe(50)
  })

  it('o topo não tem próximo e fica em 100%', () => {
    expect(computeLevel(7500)).toMatchObject({ name: 'Diamante', next: null, nextMin: null, progress: 100, remaining: 0 })
    expect(computeLevel(999_999)).toMatchObject({ name: 'Diamante', progress: 100 })
  })

  it('remaining é o que falta para o próximo degrau', () => {
    expect(computeLevel(1200).remaining).toBe(300)
  })

  // O total vem de uma soma do banco; uma tela não pode quebrar por causa dela.
  it('trata entrada suja como zero em vez de quebrar', () => {
    expect(computeLevel(-50).name).toBe('Bronze')
    expect(computeLevel(Number.NaN).name).toBe('Bronze')
    expect(computeLevel(700.9)).toMatchObject({ name: 'Prata', progress: 20 })
  })
})

describe('cores dos níveis', () => {
  it('cada degrau tem a cor do próprio metal, e nenhuma se repete', () => {
    const cores = XP_LEVELS.map((level) => level.color)
    expect(cores).toHaveLength(new Set(cores).size)
    for (const cor of cores) expect(cor).toMatch(/^#[0-9A-F]{6}$/)
  })

  // O rótulo do nível é escrito por cima da cor: se um tom clarear demais, o
  // texto some — e some só no nível de quem já subiu, que é onde ninguém olha.
  it('o texto branco fica legível sobre todas elas', () => {
    for (const level of XP_LEVELS) {
      expect(contrastRatio(level.color, XP_LEVEL_ON_COLOR)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('computeLevel devolve a cor do degrau alcançado', () => {
    expect(computeLevel(0).color).toBe(XP_LEVELS[0]!.color)
    expect(computeLevel(1_600).color).toBe(XP_LEVELS[2]!.color)
    expect(levelColor(999_999)).toBe(XP_LEVELS[4]!.color)
  })
})

describe('XP_RULE_EVENTS', () => {
  // Diferença deliberada em relação aos coins: lá CHALLENGE_APPROVED fica de fora
  // porque a recompensa é do desafio; aqui o XP do desafio é um valor só, da empresa.
  it('inclui desafio aprovado, que do lado dos coins fica de fora', () => {
    expect(XP_RULE_EVENTS).toContain('CHALLENGE_APPROVED')
  })

  // BADGE_EARNED é a exceção dos DOIS lados: o valor é do selo (Documento 4,
  // seção 11.4), e `awardFixedXp` nunca consulta `XpRule` — regra criada para
  // ele não teria efeito nenhum.
  it('deixa de fora o selo conquistado, cujo valor vem do próprio selo', () => {
    expect(XP_RULE_EVENTS).not.toContain('BADGE_EARNED')
    expect(XP_RULE_EVENTS).toEqual(XP_EVENTS.filter((event) => event !== 'BADGE_EARNED'))
  })
})
