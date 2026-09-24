import { describe, expect, it } from 'vitest'
import {
  apprenticeNps,
  asApprenticeSchema,
  asApprenticeValues,
  canSubmitApprenticeActivity,
  deliveryStatusOf,
  isApprentice,
  isMeetingUnlocked,
  meetingStatusesOf,
  monthsSince,
  apprenticeStageOf,
  sectorChangeEligibility,
  daysUntil,
  apprenticeTenureLabel,
  isApprenticeTaskOverdue,
  type ApprenticeActivitySchema,
} from './apprentice'

describe('isApprentice', () => {
  it('abre a área pelo cargo, e não por papel nem feature', () => {
    expect(isApprentice({ positionCategory: 'Jovem Aprendiz' })).toBe(true)
    expect(isApprentice({ positionCategory: 'Analista' })).toBe(false)
    expect(isApprentice({ positionCategory: null })).toBe(false)
    expect(isApprentice(null)).toBe(false)
  })
})

describe('meetingStatusesOf', () => {
  const meetings = [
    { id: 'm1', order: 1, scheduledOn: '2026-09-15' },
    { id: 'm2', order: 2, scheduledOn: '2026-10-06' },
    { id: 'm3', order: 3, scheduledOn: '2026-11-03' },
  ]

  it('o que já passou é concluído, o primeiro que não passou é o próximo', () => {
    expect(meetingStatusesOf(meetings, '2026-10-20')).toEqual({
      m1: 'CONCLUIDO',
      m2: 'CONCLUIDO',
      m3: 'PROXIMO',
    })
  })

  it('antes de tudo começar, só o primeiro é o próximo', () => {
    expect(meetingStatusesOf(meetings, '2026-09-01')).toEqual({
      m1: 'PROXIMO',
      m2: 'FUTURO',
      m3: 'FUTURO',
    })
  })

  it('encontro sem data nunca conta como passado', () => {
    const semData = [{ id: 'm1', order: 1, scheduledOn: null }]
    expect(meetingStatusesOf(semData, '2030-01-01')).toEqual({ m1: 'PROXIMO' })
  })
})

describe('isMeetingUnlocked', () => {
  const base = { accessReleased: true, order: 2, isFacilitator: false, previousAttendance: null }

  it('o facilitador entra em tudo, inclusive no que não foi liberado', () => {
    expect(isMeetingUnlocked({ ...base, accessReleased: false, isFacilitator: true })).toBe(true)
  })

  it('sem liberação, ninguém entra', () => {
    expect(isMeetingUnlocked({ ...base, accessReleased: false })).toBe(false)
  })

  it('o primeiro encontro não depende de presença anterior', () => {
    expect(isMeetingUnlocked({ ...base, order: 1 })).toBe(true)
  })

  it('quem faltou ao anterior fica de fora', () => {
    expect(isMeetingUnlocked({ ...base, previousAttendance: false })).toBe(false)
    expect(isMeetingUnlocked({ ...base, previousAttendance: true })).toBe(true)
  })

  it('chamada não lançada NÃO bloqueia — esquecimento do facilitador não para a turma', () => {
    expect(isMeetingUnlocked({ ...base, previousAttendance: null })).toBe(true)
  })
})

describe('canSubmitApprenticeActivity', () => {
  const schema: ApprenticeActivitySchema = {
    blocks: [
      {
        title: 'Bloco',
        fields: [
          { id: 'a', type: 'linha', required: true },
          { id: 'b', type: 'linha' },
        ],
      },
    ],
  }

  it('exige os campos obrigatórios', () => {
    expect(canSubmitApprenticeActivity(schema, { b: 'algo' })).toBe(false)
    expect(canSubmitApprenticeActivity(schema, { a: 'preenchido' })).toBe(true)
  })

  it('espaço em branco não preenche campo obrigatório', () => {
    expect(canSubmitApprenticeActivity(schema, { a: '   ' })).toBe(false)
  })

  it('checkbox obrigatório precisa estar marcado', () => {
    const aceite: ApprenticeActivitySchema = {
      blocks: [{ title: 'Aceite', fields: [{ id: 'ok', type: 'checkbox', required: true }] }],
    }
    expect(canSubmitApprenticeActivity(aceite, { ok: false })).toBe(false)
    expect(canSubmitApprenticeActivity(aceite, { ok: true })).toBe(true)
  })

  it('lista obrigatória aceita um item preenchido entre os vazios', () => {
    const linha: ApprenticeActivitySchema = {
      blocks: [
        {
          title: 'Linha do tempo',
          fields: [
            {
              id: 'eventos',
              type: 'lista',
              required: true,
              fields: [{ id: 'titulo', type: 'linha' }],
            },
          ],
        },
      ],
    }
    expect(canSubmitApprenticeActivity(linha, { eventos: [{}, {}] })).toBe(false)
    expect(canSubmitApprenticeActivity(linha, { eventos: [{}, { titulo: 'Primeiro dia' }] })).toBe(true)
  })

  it('sem campo obrigatório, basta um campo preenchido — enviar em branco não vale', () => {
    const livre: ApprenticeActivitySchema = {
      blocks: [{ title: 'Livre', fields: [{ id: 'x', type: 'linha' }] }],
    }
    expect(canSubmitApprenticeActivity(livre, {})).toBe(false)
    expect(canSubmitApprenticeActivity(livre, { x: 'algo' })).toBe(true)
  })
})

describe('deliveryStatusOf', () => {
  it('tudo enviado é entregue', () => {
    expect(
      deliveryStatusOf({ submittedCount: 3, activityCount: 3, nextMeetingReleased: false }),
    ).toBe('ENTREGUE')
  })

  it('faltando entrega, pendente enquanto o próximo encontro não abriu', () => {
    expect(
      deliveryStatusOf({ submittedCount: 1, activityCount: 3, nextMeetingReleased: false }),
    ).toBe('PENDENTE')
  })

  it('com o próximo encontro aberto, o que não veio não vem mais', () => {
    expect(
      deliveryStatusOf({ submittedCount: 1, activityCount: 3, nextMeetingReleased: true }),
    ).toBe('NAO_ENTREGUE')
  })

  it('encontro sem ficha nenhuma nunca conta como entregue', () => {
    expect(
      deliveryStatusOf({ submittedCount: 0, activityCount: 0, nextMeetingReleased: false }),
    ).toBe('PENDENTE')
  })
})

describe('apprenticeNps', () => {
  it('é promotores menos detratores, em pontos percentuais', () => {
    expect(apprenticeNps([10, 10, 9, 8, 6])).toBe(40)
    expect(apprenticeNps([5, 5])).toBe(-100)
  })

  it('sem resposta não há índice', () => {
    expect(apprenticeNps([])).toBeNull()
  })
})

describe('leitura defensiva do banco', () => {
  it('schema corrompido vira ficha vazia, não derruba a tela', () => {
    expect(asApprenticeSchema(null)).toEqual({ blocks: [] })
    expect(asApprenticeSchema({ blocks: 'nope' })).toEqual({ blocks: [] })
    expect(asApprenticeSchema({ blocks: [{ semTitulo: true }] })).toEqual({ blocks: [] })
  })

  it('valores mantêm texto, booleano e lista, e descartam o resto', () => {
    expect(
      asApprenticeValues({
        texto: 'ok',
        marcado: true,
        eventos: [{ titulo: 'a', ruido: 3 }],
        numero: 7,
      }),
    ).toEqual({ texto: 'ok', marcado: true, eventos: [{ titulo: 'a' }] })
  })
})

describe('jornada do aprendiz', () => {
  it('meses completos ignoram o dia que ainda não chegou', () => {
    expect(monthsSince('2026-01-15', '2026-07-14')).toBe(5)
    expect(monthsSince('2026-01-15', '2026-07-15')).toBe(6)
    expect(monthsSince(null, '2026-07-15')).toBeNull()
  })

  it('a etapa sai da admissão, em blocos de seis meses', () => {
    expect(apprenticeStageOf('2026-07-01', '2026-09-01')).toBe('1º Ciclo — Onboarding e Integração')
    expect(apprenticeStageOf('2026-01-01', '2026-09-01')).toBe('2º Ciclo — Consolidação I')
    expect(apprenticeStageOf('2025-06-01', '2026-09-01')).toBe('3º Ciclo — Consolidação II')
    expect(apprenticeStageOf('2024-01-01', '2026-09-01')).toBe('4º Ciclo — Transição e Encerramento')
    expect(apprenticeStageOf(null, '2026-09-01')).toBeNull()
  })

  it('a elegibilidade conta da ÚLTIMA MUDANÇA, não da admissão', () => {
    // Um ano de casa, mas trocou de setor mês passado: não é elegível.
    const recemMovido = sectorChangeEligibility({
      joinedOn: '2025-09-01',
      lastMoveOn: '2026-08-01',
      today: '2026-09-14',
    })
    expect(recemMovido).toMatchObject({ eligible: false, months: 1, since: '2026-08-01' })

    // Sem mudança registrada, conta da admissão.
    const semMudanca = sectorChangeEligibility({
      joinedOn: '2025-09-01',
      lastMoveOn: null,
      today: '2026-09-14',
    })
    expect(semMudanca.eligible).toBe(true)
    expect(semMudanca.since).toBe('2025-09-01')
  })

  it('sem admissão não há elegibilidade a calcular', () => {
    expect(sectorChangeEligibility({ joinedOn: null, lastMoveOn: null, today: '2026-09-14' })).toEqual({
      eligible: false,
      months: null,
      since: null,
    })
  })

  it('dias até o fim do contrato ficam negativos depois que ele encerra', () => {
    expect(daysUntil('2026-09-20', '2026-09-14')).toBe(6)
    expect(daysUntil('2026-09-01', '2026-09-14')).toBe(-13)
    expect(daysUntil(null, '2026-09-14')).toBeNull()
  })

  it('tempo de casa em português, com singular e plural', () => {
    expect(apprenticeTenureLabel('2026-08-14', '2026-09-14')).toBe('1 mês')
    expect(apprenticeTenureLabel('2026-03-14', '2026-09-14')).toBe('6 meses')
    expect(apprenticeTenureLabel('2025-09-14', '2026-09-14')).toBe('1 ano')
    expect(apprenticeTenureLabel('2024-07-14', '2026-09-14')).toBe('2 anos e 2 meses')
    expect(apprenticeTenureLabel(null, '2026-09-14')).toBe('—')
  })
})

describe('quadro de gestão', () => {
  it('atrasada é a pendente com prazo vencido', () => {
    expect(isApprenticeTaskOverdue({ dueOn: '2026-09-01', boardColumn: 'AFAZER' }, '2026-09-14')).toBe(true)
    expect(isApprenticeTaskOverdue({ dueOn: '2026-09-20', boardColumn: 'AFAZER' }, '2026-09-14')).toBe(false)
  })

  it('concluída nunca está atrasada, e sem prazo também não', () => {
    expect(isApprenticeTaskOverdue({ dueOn: '2026-09-01', boardColumn: 'CONCLUIDO' }, '2026-09-14')).toBe(false)
    expect(isApprenticeTaskOverdue({ dueOn: null, boardColumn: 'AFAZER' }, '2026-09-14')).toBe(false)
  })
})
