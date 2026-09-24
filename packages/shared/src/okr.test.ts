import { describe, expect, it } from 'vitest'
import {
  canViewOkrObjective,
  formatOkrAttainment,
  OKR_DEFAULT_PROGRESS_RANGES,
  okrAverageAttainment,
  okrProgressRangesError,
  okrResultRatio,
  formatOkrValue,
  evaluateOkrCycle,
  okrAccumulatedRatio,
  okrAttainment,
  okrCheckInPermissions,
  okrCurrentValue,
  okrDependencyCreatesCycle,
  okrKeyResultPermissions,
  okrObjectivePermissions,
  okrProgressLinear,
  okrRangeColor,
  okrResolveWeights,
  okrWeightsError,
  type OkrDirection,
  type OkrKeyResultInput,
  type OkrPermissionContext,
  type OkrRole,
} from './okr'

// Dados reais do tenant da ImpulseUp em 2026-09-17, todos com base 0.
const FIXTURES: [number, OkrDirection, number, number, number, number, boolean][] = [
  [1, 'LOWER_IS_BETTER', 10, 8.3, 83, 1, true],
  [2, 'LOWER_IS_BETTER', 3, 1.5, 50, 1, true],
  [3, 'LOWER_IS_BETTER', 10, 15.03, 150.3, 0.6653, false],
  [4, 'LOWER_IS_BETTER', 10, 24.5, 245, 0.4082, false],
  [5, 'LOWER_IS_BETTER', 5, 16.7, 334, 0.2994, false],
  [6, 'LOWER_IS_BETTER', 20, 26.2, 131, 0.7634, false],
  [7, 'LOWER_IS_BETTER', 10, 0, 0, 1, true],
  [8, 'HIGHER_IS_BETTER', 80, 45.7, 57.125, 0.5713, false],
  [9, 'HIGHER_IS_BETTER', 95, 75, 78.947, 0.7895, false],
  [10, 'HIGHER_IS_BETTER', 4.8, 4.9, 102.083, 1, true],
  [11, 'HIGHER_IS_BETTER', 70, 75.21, 107.443, 1, true],
]

// Faixas do "Ciclo EMR - 2027".
const RANGES = [
  { color: '#eb5656', min: null, max: 30 },
  { color: '#fcb813', min: 30, max: 60 },
  { color: '#86bd49', min: 60, max: 100 },
  { color: '#64b2cb', min: 100, max: null },
]
const BLUE = '#64b2cb'

describe('progresso linear × atingimento (fixtures da ImpulseUp)', () => {
  it.each(FIXTURES)('#%i %s meta %d valor %d', (_n, direction, target, value, linear, attainment, goalMet) => {
    const metric = { baseline: 0, target, direction }
    expect(okrProgressLinear(metric, value)).toBeCloseTo(linear, 3)
    const result = okrAttainment(metric, value)
    expect(result?.attainment).toBeCloseTo(attainment, 4)
    expect(result?.goalMet).toBe(goalMet)
  })

  it('não pinta de sucesso o teto estourado, que a ImpulseUp pinta de azul', () => {
    for (const [n, direction, target, value] of FIXTURES.filter(([n]) => [3, 4, 5, 6].includes(n))) {
      const metric = { baseline: 0, target, direction }
      // Na régua da ImpulseUp (progresso linear) passaria de 100 — azul.
      expect(okrProgressLinear(metric, value), `#${n}`).toBeGreaterThan(100)
      expect(okrRangeColor(RANGES, okrAttainment(metric, value)), `#${n}`).not.toBe(BLUE)
    }
  })

  it('e pinta de sucesso o teto respeitado, que a ImpulseUp mostra como mediano', () => {
    const metric = { baseline: 0, target: 3, direction: 'LOWER_IS_BETTER' as const }
    expect(okrProgressLinear(metric, 1.5)).toBe(50)
    expect(okrRangeColor(RANGES, okrAttainment(metric, 1.5))).toBe(BLUE)
  })

  it('respeita a base na direção "maior é melhor"', () => {
    const metric = { baseline: 21.4, target: 70, direction: 'HIGHER_IS_BETTER' as const }
    expect(okrAttainment(metric, 45.7)?.attainment).toBeCloseTo(0.5, 2)
    expect(okrAttainment(metric, 84.98)).toMatchObject({ attainment: 1, goalMet: true })
    expect(okrAttainment(metric, 84.98)?.overshoot).toBeCloseTo(0.3082, 3)
  })

  it('sem valor não há resultado', () => {
    expect(okrAttainment({ baseline: 0, target: 1, direction: 'HIGHER_IS_BETTER' }, null)).toBeNull()
    expect(okrProgressLinear({ baseline: 0, target: 1 }, null)).toBeNull()
  })
})

describe('série de check-ins', () => {
  const at = (effectiveAt: string, createdAt: string, value: number | null, extra = {}) => ({
    effectiveAt,
    createdAt,
    value,
    ...extra,
  })

  it('valor atual é o da competência mais recente, e não o da última escrita', () => {
    const checkIns = [
      at('2026-09-14', '2026-09-14T12:00:00Z', 8.3),
      // Correção da sprint anterior, escrita depois: não vira o valor atual.
      at('2026-08-31', '2026-09-15T09:00:00Z', 9.1),
      // Só comentário: não conta.
      at('2026-09-16', '2026-09-16T10:00:00Z', null),
      at('2026-09-20', '2026-09-20T10:00:00Z', 1, { deletedAt: '2026-09-21T00:00:00Z' }),
    ]
    expect(okrCurrentValue(checkIns)).toBe(8.3)
  })

  it('empata a competência pela escrita', () => {
    expect(
      okrCurrentValue([at('2026-09-14', '2026-09-14T12:00:00Z', 1), at('2026-09-14', '2026-09-14T13:00:00Z', 2)]),
    ).toBe(2)
  })

  it('acumula razão como Σnum ÷ Σden, e não como média das porcentagens', () => {
    const sprints = [
      at('2026-08-17', '2026-08-17T00:00:00Z', 6.667, { numerator: 3, denominator: 45 }),
      at('2026-08-31', '2026-08-31T00:00:00Z', 2.632, { numerator: 1, denominator: 38 }),
      at('2026-09-14', '2026-09-14T00:00:00Z', 7.692, { numerator: 4, denominator: 52 }),
    ]
    const accumulated = okrAccumulatedRatio(sprints)
    expect(accumulated).toBeCloseTo(5.93, 2)
    const averageOfPercents = sprints.reduce((sum, s) => sum + (s.value ?? 0), 0) / sprints.length
    expect(averageOfPercents).toBeCloseTo(5.66, 2)
  })

  it('sem numerador/denominador, não há acumulado', () => {
    expect(okrAccumulatedRatio([at('2026-09-14', '2026-09-14T00:00:00Z', 5)])).toBeNull()
  })
})

describe('pesos e agregação', () => {
  const kr = (id: string, objectiveId: string, currentValue: number | null, extra: Partial<OkrKeyResultInput> = {}): OkrKeyResultInput => ({
    id,
    objectiveId,
    baseline: 0,
    target: 100,
    direction: 'HIGHER_IS_BETTER',
    weight: null,
    currentValue,
    accumulatedValue: null,
    ...extra,
  })

  it('pesos nulos dividem o que sobra; soma acima de 1 é recusada', () => {
    expect(okrResolveWeights([{ weight: 0.5 }, { weight: null }, { weight: null }])).toEqual([0.5, 0.25, 0.25])
    expect(okrWeightsError([{ weight: 0.7 }, { weight: 0.4 }])).toMatch(/passa de 100%/)
    expect(okrWeightsError([{ weight: 0.1 }, { weight: 0.2 }, { weight: 0.7 }])).toBeNull()
  })

  it('KR_ONLY copia o KR; WEIGHTED_KRS pondera atingimento; CHILDREN pondera filhos', () => {
    const { objectives, keyResults } = evaluateOkrCycle({
      objectives: [
        { id: 'root', parentId: null, aggregation: 'CHILDREN', weight: null, manualProgress: null },
        { id: 'a', parentId: 'root', aggregation: 'KR_ONLY', weight: 0.75, manualProgress: null },
        { id: 'b', parentId: 'root', aggregation: 'WEIGHTED_KRS', weight: null, manualProgress: null },
      ],
      keyResults: [
        kr('a1', 'a', 40),
        kr('b1', 'b', 100, { weight: 0.5 }),
        kr('b2', 'b', 50),
        kr('b3', 'b', null),
      ],
      dependencies: [],
    })
    expect(objectives.get('a')?.attainment).toBeCloseTo(0.4)
    // 0,5 × 1 + 0,25 × 0,5 + 0,25 × 0 (sem check-in conta como zero)
    expect(objectives.get('b')?.attainment).toBeCloseTo(0.625)
    expect(objectives.get('root')?.attainment).toBeCloseTo(0.75 * 0.4 + 0.25 * 0.625)
    expect(keyResults.get('b3')?.attainment).toBeNull()
  })

  it('o acumulado da razão tem precedência sobre o último valor', () => {
    const { keyResults } = evaluateOkrCycle({
      objectives: [{ id: 'o', parentId: null, aggregation: 'KR_ONLY', weight: null, manualProgress: null }],
      keyResults: [kr('k', 'o', 7.692, { target: 10, direction: 'LOWER_IS_BETTER', accumulatedValue: 5.93 })],
      dependencies: [],
    })
    expect(keyResults.get('k')).toMatchObject({ currentValue: 7.692, effectiveValue: 5.93, goalMet: true })
  })

  it('KR calculado: média de progresso dos dependentes, marcado como calculado', () => {
    const { keyResults } = evaluateOkrCycle({
      objectives: [{ id: 'o', parentId: null, aggregation: 'WEIGHTED_KRS', weight: null, manualProgress: null }],
      keyResults: [kr('calc', 'o', null), kr('d1', 'o', 20), kr('d2', 'o', 60)],
      dependencies: [
        { keyResultId: 'calc', dependsOnKrId: 'd1', weight: null, strategy: 'AVERAGE', calcType: 'PROGRESS' },
        { keyResultId: 'calc', dependsOnKrId: 'd2', weight: null, strategy: 'AVERAGE', calcType: 'PROGRESS' },
      ],
    })
    expect(keyResults.get('calc')).toMatchObject({ calculated: true, currentValue: 40 })
  })

  it('laço de dependência não trava a avaliação e é detectado na escrita', () => {
    const edges = [
      { keyResultId: 'a', dependsOnKrId: 'b', weight: null, strategy: 'SUM' as const, calcType: 'VALUE' as const },
      { keyResultId: 'b', dependsOnKrId: 'a', weight: null, strategy: 'SUM' as const, calcType: 'VALUE' as const },
    ]
    expect(() =>
      evaluateOkrCycle({
        objectives: [],
        keyResults: [kr('a', 'o', 1), kr('b', 'o', 2)],
        dependencies: edges,
      }),
    ).not.toThrow()
    expect(okrDependencyCreatesCycle([edges[0]], 'b', ['a'])).toBe(true)
    expect(okrDependencyCreatesCycle([edges[0]], 'c', ['a'])).toBe(false)
  })
})

describe('permissões', () => {
  const ctx = (extra: Partial<OkrPermissionContext> = {}): OkrPermissionContext => ({
    isAdmin: false,
    cycleStatus: 'OPEN',
    updateWindowStart: '2026-09-08',
    updateWindowFinish: '2027-12-31',
    today: '2026-09-17',
    ...extra,
  })
  const roles = (...list: OkrRole[]) => new Set(list)

  it('responsável faz check-in; dono edita a definição', () => {
    expect(okrKeyResultPermissions(ctx(), roles('ASSIGNED_TO'), false)).toEqual({
      updateKeyResult: false,
      updateKeyResultStatus: false,
      createCheckIn: true,
    })
    expect(okrKeyResultPermissions(ctx(), roles('OWNER'), false)).toEqual({
      updateKeyResult: true,
      updateKeyResultStatus: true,
      createCheckIn: false,
    })
    expect(okrObjectivePermissions(ctx(), roles('CREATOR')).updateObjective).toBe(false)
  })

  it('fora da janela só o admin faz check-in', () => {
    const late = ctx({ today: '2028-01-05' })
    expect(okrKeyResultPermissions(late, roles('ASSIGNED_TO'), false).createCheckIn).toBe(false)
    expect(okrKeyResultPermissions({ ...late, isAdmin: true }, roles(), false).createCheckIn).toBe(true)
  })

  it('ciclo encerrado bloqueia toda escrita, inclusive do admin', () => {
    const closed = ctx({ cycleStatus: 'CLOSED', isAdmin: true })
    expect(Object.values(okrKeyResultPermissions(closed, roles('OWNER', 'ASSIGNED_TO'), false))).not.toContain(true)
    expect(Object.values(okrObjectivePermissions(closed, roles('OWNER')))).not.toContain(true)
    expect(Object.values(okrCheckInPermissions(closed, true))).not.toContain(true)
  })

  it('KR calculado recusa check-in até para o admin', () => {
    expect(okrKeyResultPermissions(ctx({ isAdmin: true }), roles(), true).createCheckIn).toBe(false)
  })

  it('visibilidade', () => {
    expect(canViewOkrObjective('EVERYONE', roles(), false)).toBe(true)
    expect(canViewOkrObjective('ASSIGNEES', roles(), false)).toBe(false)
    expect(canViewOkrObjective('ASSIGNEES', roles('ASSIGNED_TO'), false)).toBe(true)
    expect(canViewOkrObjective('PRIVATE', roles('ASSIGNED_TO'), false)).toBe(false)
    expect(canViewOkrObjective('PRIVATE', roles('CREATOR'), false)).toBe(true)
    expect(canViewOkrObjective('PRIVATE', roles(), true)).toBe(true)
  })
})

describe('formatação', () => {
  const decimals = { percentage: 2, numeric: 0, currency: 2 }

  it('usa as casas do ciclo e o símbolo do tipo', () => {
    expect(formatOkrValue(8.3, { metricType: 'PERCENTAGE', unit: null }, decimals)).toBe('8,3%')
    expect(formatOkrValue(5793285.96, { metricType: 'CURRENCY', unit: 'R$' }, decimals)).toBe('R$ 5.793.285,96')
    expect(formatOkrValue(4.9, { metricType: 'NUMBER', unit: null }, decimals)).toBe('5')
    expect(formatOkrValue(12, { metricType: 'NUMBER', unit: 'dias' }, decimals)).toBe('12 dias')
    expect(formatOkrValue(null, { metricType: 'NUMBER', unit: null }, decimals)).toBe('—')
  })

  it('atingimento vira porcentagem inteira', () => {
    expect(formatOkrAttainment(0.6653)).toBe('67%')
    expect(formatOkrAttainment(null)).toBe('—')
  })
})

describe('okrAverageAttainment', () => {
  it('ignora quem não tem valor, em vez de contar como zero', () => {
    expect(okrAverageAttainment([{ attainment: 0.5 }, { attainment: 1 }, { attainment: null }])).toBe(0.75)
  })

  it('sem nenhum valor é nulo', () => {
    expect(okrAverageAttainment([{ attainment: null }])).toBeNull()
    expect(okrAverageAttainment([])).toBeNull()
  })
})

describe('okrResultRatio', () => {
  it('meta superada soma o overshoot; teto estourado não passa de 100%', () => {
    expect(okrResultRatio({ attainment: 1, overshoot: 0.31 })).toBeCloseTo(1.31)
    expect(okrResultRatio({ attainment: 0.408, overshoot: 0 })).toBe(0.408)
    expect(okrResultRatio({ attainment: null, overshoot: null })).toBeNull()
  })
})

describe('okrProgressRangesError', () => {
  it('o semáforo padrão é válido', () => {
    expect(okrProgressRangesError(OKR_DEFAULT_PROGRESS_RANGES)).toBeNull()
  })

  it('recusa buraco e sobreposição entre faixas', () => {
    const comBuraco = [
      { min: null, max: 30, color: '#eb5656' },
      { min: 40, max: null, color: '#86bd49' },
    ]
    expect(okrProgressRangesError(comBuraco)).toMatch(/contínuas/)
    const sobrepostas = [
      { min: null, max: 60, color: '#eb5656' },
      { min: 30, max: null, color: '#86bd49' },
    ]
    expect(okrProgressRangesError(sobrepostas)).toMatch(/contínuas/)
  })

  it('exige começo e fim abertos, cor hex e faixa vazia', () => {
    expect(okrProgressRangesError([])).toMatch(/ao menos uma faixa/)
    expect(okrProgressRangesError([{ min: 0, max: null, color: '#eb5656' }])).toMatch(/sem limite inferior/)
    expect(okrProgressRangesError([{ min: null, max: 100, color: '#eb5656' }])).toMatch(/sem limite superior/)
    expect(okrProgressRangesError([{ min: null, max: null, color: 'vermelho' }])).toMatch(/Cor inválida/)
  })
})
