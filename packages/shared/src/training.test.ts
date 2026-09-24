import { describe, expect, it } from 'vitest'
import {
  computeTrainingCoverage,
  computeTrainingKpis,
  groupTrainingBy,
  isDemandDrivenTraining,
  trainingMonthlySeries,
  trainingQuarter,
  trainingSemester,
  trainingSlaDays,
  trainingSlaStatus,
  trainingYear,
  type TrainingFact,
} from './training'

function fato(overrides: Partial<TrainingFact> = {}): TrainingFact {
  return {
    userId: 'u1',
    eventId: null,
    courseTitle: 'Curso de Gestão',
    sectorName: 'Operações',
    squad: 'Alfa',
    leaderName: 'Líder Lima',
    positionCategory: 'Analista',
    learningType: 'Curso',
    institution: 'PM3',
    source: 'Autoatendimento do colaborador',
    hours: 10,
    investmentCents: 10_000,
    reasons: ['PDI'],
    participationStatus: 'Participou',
    requestDate: '2026-01-10',
    completionDate: '2026-03-20',
    ...overrides,
  }
}

describe('derivados de data', () => {
  it('ano, trimestre e semestre saem da conclusão', () => {
    expect(trainingYear('2026-03-20')).toBe(2026)
    expect(trainingQuarter('2026-03-20')).toBe('T1')
    expect(trainingQuarter('2026-12-31')).toBe('T4')
    expect(trainingSemester('2026-06-30')).toBe('1º semestre')
    expect(trainingSemester('2026-07-01')).toBe('2º semestre')
  })

  it('sem conclusão não há derivado nenhum', () => {
    expect(trainingYear(null)).toBeNull()
    expect(trainingQuarter(null)).toBeNull()
    expect(trainingSemester(null)).toBeNull()
    expect(trainingSlaDays('2026-01-10', null)).toBeNull()
  })

  it('conta os dias sem tropeçar na virada de fuso', () => {
    // Datas lidas ao meio-dia UTC: o intervalo é exato mesmo com o processo em
    // qualquer fuso, que é o erro clássico de contar dia com `new Date(ymd)`.
    expect(trainingSlaDays('2026-01-10', '2026-03-20')).toBe(69)
    expect(trainingSlaDays('2026-02-28', '2026-03-01')).toBe(1)
    expect(trainingSlaDays('2024-02-28', '2024-03-01')).toBe(2) // ano bissexto
  })

  it('sem conclusão, o SLA fica Pendente — nunca "fora"', () => {
    expect(trainingSlaStatus({ requestDate: '2020-01-01', completionDate: null }, 90)).toBe('Pendente')
    expect(trainingSlaStatus({ requestDate: '2026-01-10', completionDate: '2026-03-20' }, 90)).toBe('Dentro do SLA')
    expect(trainingSlaStatus({ requestDate: '2026-01-10', completionDate: '2026-03-20' }, 30)).toBe('Fora do SLA')
  })
})

describe('origem da demanda', () => {
  it('só LNT, PDI e pedido do líder criam prazo a cumprir', () => {
    expect(isDemandDrivenTraining(['PDI'])).toBe(true)
    expect(isDemandDrivenTraining(['LNT'])).toBe(true)
    expect(isDemandDrivenTraining(['SOLICITACAO_GESTOR'])).toBe(true)
    expect(isDemandDrivenTraining(['INICIATIVA_PROPRIA'])).toBe(false)
    // Obrigatório é regra da empresa, não pedido com prazo de atendimento.
    expect(isDemandDrivenTraining(['OBRIGATORIO'])).toBe(false)
  })
})

describe('indicadores', () => {
  it('horas contam só quem participou; investimento conta tudo', () => {
    const kpis = computeTrainingKpis(
      [
        fato({ userId: 'u1', hours: 10, investmentCents: 10_000 }),
        fato({ userId: 'u2', hours: 8, investmentCents: 5_000, participationStatus: 'Inscrito' }),
      ],
      90,
      4,
    )
    expect(kpis.hours).toBe(10)
    expect(kpis.people).toBe(1)
    expect(kpis.participations).toBe(2)
    expect(kpis.investmentCents).toBe(15_000)
    expect(kpis.coverage).toBe(25)
  })

  it('duas pessoas no mesmo curso e no mesmo dia são UM treinamento', () => {
    const kpis = computeTrainingKpis(
      [fato({ userId: 'u1' }), fato({ userId: 'u2' })],
      90,
      2,
    )
    expect(kpis.trainings).toBe(1)
    expect(kpis.participations).toBe(2)
  })

  it('o SLA médio ignora quem fez por conta própria', () => {
    const kpis = computeTrainingKpis(
      [
        fato({ reasons: ['PDI'], requestDate: '2026-01-10', completionDate: '2026-03-20' }), // 69 dias
        fato({ userId: 'u2', reasons: ['INICIATIVA_PROPRIA'], requestDate: '2020-01-01', completionDate: '2026-03-20' }),
      ],
      90,
      2,
    )
    expect(kpis.avgSla).toBe(69)
    expect(kpis.pctInSla).toBe(100)
  })

  it('divisão por zero devolve zero, nunca NaN', () => {
    const kpis = computeTrainingKpis([], 90, 0)
    expect(kpis.avgHours).toBe(0)
    expect(kpis.pctInSla).toBe(0)
    expect(kpis.coverage).toBe(0)
    expect(Number.isNaN(kpis.avgSla)).toBe(false)
  })
})

describe('agrupamentos', () => {
  it('campo vazio vira "Não informado" em vez de sumir', () => {
    const slices = groupTrainingBy([fato({ institution: null }), fato({ institution: '  ' })], (f) => f.institution)
    expect(slices).toEqual([{ name: 'Não informado', value: 2 }])
  })

  it('ordena do maior para o menor', () => {
    const slices = groupTrainingBy(
      [fato({ sectorName: 'A' }), fato({ sectorName: 'B' }), fato({ sectorName: 'B' })],
      (f) => f.sectorName,
    )
    expect(slices.map((s) => s.name)).toEqual(['B', 'A'])
  })

  it('a série mensal usa a conclusão, e a solicitação quando não há conclusão', () => {
    const serie = trainingMonthlySeries([
      fato({ completionDate: '2026-03-20' }),
      fato({ completionDate: null, requestDate: '2026-01-10', participationStatus: 'Inscrito' }),
    ])
    expect(serie.map((p) => p.month)).toEqual(['2026-01', '2026-03'])
    expect(serie[0].hours).toBe(0) // inscrito não gera hora
    expect(serie[1].hours).toBe(10)
  })
})

describe('cobertura', () => {
  it('o denominador é a população do setor, não quem aparece nos registros', () => {
    const cobertura = computeTrainingCoverage(
      [fato({ userId: 'u1', sectorName: 'Operações' })],
      [
        { userId: 'u1', sectorName: 'Operações' },
        { userId: 'u2', sectorName: 'Operações' },
        { userId: 'u3', sectorName: 'Produto' },
      ],
    )
    expect(cobertura).toEqual([
      { name: 'Operações', value: 50 },
      { name: 'Produto', value: 0 },
    ])
  })
})
