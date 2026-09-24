import { describe, it, expect } from 'vitest'
import {
  calculateBonusByTier,
  calculateQuotas,
  DEFAULT_BONUS_PROGRAM,
  effectiveSalary,
  formatBRL,
  yearsOfService,
} from './bonus-calculator'

describe('tempo de casa', () => {
  it('conta da admissão até a data-limite do ciclo, em anos de 365,25 dias', () => {
    // 31/12/2026 → 31/12/2028 são 731 dias (2028 é bissexto).
    expect(yearsOfService('2026-12-31', '2028-12-31')).toBeCloseTo(731 / 365.25, 5)
  })

  it('é a mesma régua para todo mundo: não depende de "hoje"', () => {
    const a = yearsOfService('2020-01-01', '2028-12-31')
    const b = yearsOfService('2020-01-01', '2028-12-31')
    expect(a).toBe(b)
    expect(a).toBeGreaterThan(8)
  })

  it('admissão depois do fim do ciclo dá zero, não negativo', () => {
    expect(yearsOfService('2029-06-01', '2028-12-31')).toBe(0)
  })

  it('data inválida não vira NaN', () => {
    expect(yearsOfService('nao-e-data', '2028-12-31')).toBe(0)
  })
})

describe('salário efetivo', () => {
  // O CLT recebe 14,33 meses por ano (12 + 13º + 14º + 1/3 de férias); a conta
  // usa a média mensal disso, senão ele entraria menor que o PJ de mesmo custo.
  it('CLT vira a média mensal dos 14,33 meses', () => {
    expect(effectiveSalary(5000, 'CLT')).toBeCloseTo((5000 * 14.33) / 12, 6)
    expect(effectiveSalary(5000, 'CLT')).toBeGreaterThan(5000)
  })

  it('PJ entra como está', () => {
    expect(effectiveSalary(5000, 'PJ')).toBe(5000)
  })

  it('salário ausente ou negativo é zero', () => {
    expect(effectiveSalary(0, 'CLT')).toBe(0)
    expect(effectiveSalary(-100, 'PJ')).toBe(0)
    expect(effectiveSalary(Number.NaN, 'CLT')).toBe(0)
  })
})

describe('cotas', () => {
  // S/5 × (C + (TC + AD)/2) — o mesmo cálculo do app original da G&G.
  it('aplica a fórmula S/5 × (C + (TC + AD)/2)', () => {
    const quotas = calculateQuotas({
      salary: 5000,
      positionValue: 3,
      yearsOfService: 2,
      performanceScore: 4,
    })
    // 5000/5 = 1000; 3 + (2+4)/2 = 6; 1000 × 6 = 6000
    expect(quotas).toBe(6000)
  })

  it('o cargo pesa o dobro de cada um dos outros dois', () => {
    const base = { salary: 5000, yearsOfService: 2, performanceScore: 2 }
    const maisCargo = calculateQuotas({ ...base, positionValue: 3 })
    const menosCargo = calculateQuotas({ ...base, positionValue: 2 })
    const maisDesempenho = calculateQuotas({ ...base, positionValue: 2, performanceScore: 3 })

    // +1 no cargo soma 1000; +1 no desempenho soma 500 (entra pela média).
    expect(maisCargo - menosCargo).toBe(1000)
    expect(maisDesempenho - menosCargo).toBe(500)
  })

  it('sem salário não há cotas', () => {
    expect(calculateQuotas({ salary: 0, positionValue: 3, yearsOfService: 2, performanceScore: 4 })).toBe(0)
  })
})

describe('rateio por meta', () => {
  it('a fatia é proporcional às cotas sobre o total da empresa', () => {
    const faixas = calculateBonusByTier(1_467, DEFAULT_BONUS_PROGRAM)

    expect(faixas).toHaveLength(5)
    // 1.467 de 1.467.033 cotas ≈ 0,1% do bolo.
    const cem = faixas.find((f) => f.percent === 100)!
    expect(cem.pool).toBe(9_000_000)
    expect(cem.amount).toBeCloseTo((1_467 / 1_467_033) * 9_000_000, 4)
  })

  it('meta maior paga mais para as mesmas cotas', () => {
    const faixas = calculateBonusByTier(10_000, DEFAULT_BONUS_PROGRAM)
    const valores = faixas.map((f) => f.amount)

    expect([...valores].sort((a, b) => a - b)).toEqual(valores)
  })

  it('empresa sem cotas configuradas devolve zero, e não Infinity', () => {
    const faixas = calculateBonusByTier(5_000, { ...DEFAULT_BONUS_PROGRAM, totalQuotas: 0 })

    expect(faixas.every((f) => f.amount === 0)).toBe(true)
  })
})

describe('padrão do programa', () => {
  // Os números que a G&G usa hoje. O teste existe para uma troca acidental
  // aparecer como falha, e não como bônus errado na tela de todo mundo.
  it('traz os valores do programa da EMR', () => {
    expect(DEFAULT_BONUS_PROGRAM.totalQuotas).toBe(1_467_033)
    expect(DEFAULT_BONUS_PROGRAM.deadline).toBe('2028-12-31')
    expect(DEFAULT_BONUS_PROGRAM.tiers.map((t) => t.percent)).toEqual([64.3, 70, 80, 90, 100])
    expect(DEFAULT_BONUS_PROGRAM.tiers.map((t) => t.pool)).toEqual([
      5_000_000, 6_000_000, 7_000_000, 8_000_000, 9_000_000,
    ])
  })
})

describe('formatBRL', () => {
  it('formata em real', () => {
    //   é o espaço não-quebrável que o Intl usa depois do "R$".
    expect(formatBRL(1234.56).replace(/ /g, ' ')).toBe('R$ 1.234,56')
  })
})
