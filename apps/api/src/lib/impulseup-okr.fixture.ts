/**
 * Snapshot da ImpulseUp para teste, no formato real das respostas (verificado no
 * tenant em 2026-09-17). Pessoas e ids são de mentira; valores e horários, não:
 * o comentário de "% de Bugs Squad" foi escrito 0,25 s antes da atualização.
 */
import type { ImpulseUpSnapshot, IuKeyResult, IuObjective } from './impulseup-okr'

export const CYCLE_ID = 'cycle-2027'

const person = (email: string) => ({ userId: `iu-${email}`, email, fullName: email.toUpperCase(), jobTitle: null })

function kr(id: string, objectiveId: string, extra: Omit<Partial<IuKeyResult>, "metric"> & { metric?: Partial<IuKeyResult["metric"]> }): IuKeyResult {
  const { metric, ...rest } = extra
  return {
    id,
    objectiveId,
    spreadsheetId: null,
    name: 'KR',
    description: null,
    status: 'ACTIVE',
    finishDate: '2028-01-31',
    people: { CREATOR: [person('criadora@emr.com')], ASSIGNED_TO: [person('dev@emr.com')] },
    metric: { '@class': 'KeyResultPercentageMetric', start: 0, target: 10, unit: null, inverted: false, ...metric },
    metricValue: null,
    progress: 0,
    calculatedMetricValueConfiguration: null,
    createdAt: '2026-08-24T02:14:22.709558Z',
    lastProgressUpdate: '2026-08-24T02:14:22.709558Z',
    ...rest,
  }
}

function objective(id: string, extra: Partial<IuObjective>): IuObjective {
  return {
    id,
    cycleId: CYCLE_ID,
    spreadsheetId: null,
    name: 'Objetivo',
    description: '',
    status: 'ACTIVE',
    visibility: 'EVERYONE',
    scope: 'TEAM',
    confidenceLevel: null,
    progressConfiguration: { strategy: 'KR_ONLY' },
    finishDate: '2028-01-31',
    people: {
      CREATOR: [person('criadora@emr.com')],
      OWNER: [person('lider@emr.com')],
      ASSIGNED_TO: [person('dev@emr.com')],
      REVIEWING: [],
      ENDORSEMENT: [],
    },
    keyResults: [],
    progress: 0,
    weight: null,
    parentId: null,
    path: [id],
    ...extra,
  }
}

export function fixtureSnapshot(): ImpulseUpSnapshot {
  return {
    fetchedAt: '2026-09-17T13:30:00.000Z',
    cycle: {
      id: CYCLE_ID,
      name: 'Ciclo EMR - 2027',
      description: '',
      status: 'OPEN',
      startDate: '2026-09-01',
      finishDate: '2028-01-31',
      configuration: {
        forceCommentForKeyResultProgressUpdate: true,
        assigneeProgressUpdatesPeriod: { start: '2026-09-08', finish: '2027-12-31' },
        progressRanges: [
          { color: '#eb5656', min: null, max: 30 },
          { color: '#fcb813', min: 30, max: 60 },
          { color: '#86bd49', min: 60, max: 100 },
          { color: '#64b2cb', min: 100, max: null },
        ],
        percentageDecimalPlaces: 2,
        numericDecimalPlaces: 0,
        currencyDecimalPlaces: 2,
      },
    },
    objectives: [
      objective('obj-bugs-setor', {
        spreadsheetId: 'PRD0007',
        name: '% de Bugs setor',
        progress: 245,
        keyResults: [
          kr('kr-bugs-setor', 'obj-bugs-setor', {
            name: '% de Bugs setor',
            metric: { inverted: true },
            metricValue: 24.5,
            progress: 245,
            // Sem comentário casando: vira check-in sintético.
            lastProgressUpdate: '2026-09-08T19:51:15.100000Z',
          }),
        ],
      }),
      objective('obj-bugs-squad', {
        spreadsheetId: 'PRD0027',
        name: '% de Bugs Squad​',
        parentId: 'obj-bugs-setor',
        path: ['obj-bugs-setor', 'obj-bugs-squad'],
        progress: 83,
        keyResults: [
          kr('kr-bugs-squad', 'obj-bugs-squad', {
            name: '% de Bugs Squad',
            metric: { inverted: true },
            metricValue: 8.3,
            progress: 83,
            lastProgressUpdate: '2026-09-14T12:18:36.308058Z',
          }),
        ],
      }),
      objective('obj-receita', {
        spreadsheetId: '1',
        name: 'Receita total B2B+B2C',
        scope: 'ORGANIZATION',
        // Pai fora do snapshot (o rastreio não alcançou).
        parentId: 'obj-fora',
        progress: 9.19,
        keyResults: [
          kr('kr-receita', 'obj-receita', {
            name: 'Receita total B2B+B2C',
            // Meta fracionária de verdade (volta do banco com um dígito a menos).
            metric: { '@class': 'KeyResultCurrencyMetric', start: 1.1764705882352942, target: 5793285.96, unit: 'R$' },
            metricValue: 532705,
            progress: 9.195,
            lastProgressUpdate: '2026-09-14T16:36:18.000000Z',
          }),
        ],
      }),
      objective('obj-iniciativas', {
        spreadsheetId: '34',
        name: 'Iniciativas Estratégicas',
        scope: 'ORGANIZATION',
        progress: 9.15,
        keyResults: [
          kr('kr-iniciativas', 'obj-iniciativas', {
            name: 'Iniciativas Estratégicas',
            metric: { target: 100 },
            metricValue: 9.1475,
            progress: 9.1475,
            calculatedMetricValueConfiguration: {
              dependsOn: ['kr-bugs-squad', 'kr-receita', 'kr-inalcancavel'],
              strategy: 'AVERAGE',
              calcType: 'PROGRESS',
              weights: {},
            },
            lastProgressUpdate: '2026-09-16T12:54:23.000000Z',
          }),
        ],
      }),
    ],
    comments: {
      'kr-bugs-squad': [
        {
          id: 'c-antigo',
          comment: 'Sprint 18 — sem valor na origem.',
          person: person('lucca@emr.com'),
          keyResultId: 'kr-bugs-squad',
          createdAt: '2026-08-31T12:00:00.000000Z',
          deletedAt: null,
        },
        {
          id: 'c-valor',
          comment: '- Bugs resolvidos na sprint divididos por todos os itens resolvidos.',
          person: person('lucca@emr.com'),
          keyResultId: 'kr-bugs-squad',
          createdAt: '2026-09-14T12:18:36.062663Z',
          deletedAt: null,
        },
        {
          id: 'c-apagado',
          comment: 'engano',
          person: person('fantasma@emr.com'),
          keyResultId: 'kr-bugs-squad',
          createdAt: '2026-09-14T12:18:37.000000Z',
          deletedAt: '2026-09-14T12:20:00.000000Z',
        },
      ],
      'kr-iniciativas': [
        {
          id: 'c-calc',
          comment: 'calculado',
          person: person('lucca@emr.com'),
          keyResultId: 'kr-iniciativas',
          createdAt: '2026-09-16T12:54:23.100000Z',
          deletedAt: null,
        },
      ],
    },
    dashboard: {
      total: 319,
      totalRealized: 53,
      percentTotal: 16.61,
      dataTotal: [
        { name: 'Receita total B2B+B2C', value: 9.195, color: 'red' },
        { name: '% de Bugs setor', value: 245, color: 'blue' },
        { name: 'Iniciativas Estratégicas', value: 9.1475, color: 'red' },
      ],
    },
    unreachable: { objectives: ['obj-fora'], keyResults: ['kr-inalcancavel'] },
  }
}
