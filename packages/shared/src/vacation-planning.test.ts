import { describe, expect, it } from 'vitest'
import {
  EMR_VACATION_POLICY,
  FULL_VACATION_BALANCE,
  acquisitionEndFor,
  acquisitionStartFor,
  addCivilDays,
  addCivilMonths,
  blockedStartReason,
  civilWeekday,
  dueDateFor,
  earliestStartFor,
  formatCivilDate,
  holidayEveHint,
  matchSplit,
  periodEndDate,
  renderVacationNotice,
  soldDaysPerPeriod,
  splitsForBalance,
  teamMonthOverlaps,
  validateVacationPlan,
  type PlannedPeriod,
} from './vacation-planning'

const SEM_FERIADO = new Map<string, string>()

describe('datas civis', () => {
  it('soma dias atravessando mês, ano e bissexto', () => {
    expect(addCivilDays('2026-12-30', 5)).toBe('2027-01-04')
    expect(addCivilDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addCivilDays('2027-02-28', 1)).toBe('2027-03-01')
    expect(addCivilDays('2026-10-01', -1)).toBe('2026-09-30')
  })

  it('soma meses grampeando o dia no fim do mês', () => {
    expect(addCivilMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addCivilMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addCivilMonths('2026-04-08', 12)).toBe('2027-04-08')
  })

  it('conhece o dia da semana', () => {
    // 25/08/2026 é uma terça.
    expect(civilWeekday('2026-08-25')).toBe(2)
    expect(civilWeekday('2026-08-29')).toBe(6)
    expect(civilWeekday('2026-08-30')).toBe(0)
  })

  it('formata para o padrão brasileiro e tolera vazio', () => {
    expect(formatCivilDate('2027-04-07')).toBe('07/04/2027')
    expect(formatCivilDate(null)).toBe('—')
  })
})

describe('derivação do período aquisitivo', () => {
  // Os números vêm da planilha da G&G: admissão 08/04/2025, 2º ciclo indo de
  // 08/04/2026 a 07/04/2027, com limite de gozo em 07/03/2028.
  it('reproduz a linha real da planilha', () => {
    expect(acquisitionEndFor('2025-04-08', 1)).toBe('2026-04-07')
    expect(acquisitionStartFor('2025-04-08', 2)).toBe('2026-04-08')
    expect(acquisitionEndFor('2025-04-08', 2)).toBe('2027-04-07')
    expect(dueDateFor('2027-04-07', EMR_VACATION_POLICY)).toBe('2028-03-07')
  })

  it('o ciclo 1 começa na própria data-base', () => {
    expect(acquisitionStartFor('2025-04-08', 1)).toBe('2025-04-08')
  })

  it('quem tem data-base em 29/02 cai em 28/02, e não desaparece', () => {
    // Sem grampear o dia, o aniversário não existiria em ano comum — defeito
    // que só apareceria de quatro em quatro anos.
    expect(acquisitionEndFor('2024-02-29', 1)).toBe('2025-02-27')
    expect(acquisitionEndFor('2024-02-29', 4)).toBe('2028-02-28')
  })

  it('recusa ciclo abaixo de 1', () => {
    expect(() => acquisitionEndFor('2025-04-08', 0)).toThrow()
  })
})

describe('combinações', () => {
  it('saldo cheio oferece as cinco da EMR', () => {
    expect(splitsForBalance(EMR_VACATION_POLICY, FULL_VACATION_BALANCE)).toHaveLength(5)
  })

  it('saldo quebrado vira período único, sem venda', () => {
    const opcoes = splitsForBalance(EMR_VACATION_POLICY, 18)
    expect(opcoes).toHaveLength(1)
    expect(opcoes[0]!.days).toEqual([18])
    expect(opcoes[0]!.soldDays).toEqual([0])
  })

  it('a venda é da combinação, não um terço do saldo', () => {
    // A ferramenta antiga fazia `saldo / 3`, que só dá 10 porque o saldo é 30.
    const dez = [{ startDate: '2026-10-05', days: 10 }, { startDate: '2027-03-01', days: 10 }]
    expect(soldDaysPerPeriod(EMR_VACATION_POLICY, 30, dez)).toEqual([5, 5])
    const quinze = [{ startDate: '2026-10-05', days: 15 }, { startDate: '2027-03-01', days: 15 }]
    expect(soldDaysPerPeriod(EMR_VACATION_POLICY, 30, quinze)).toEqual([0, 0])
  })

  it('não casa combinação fora das cinco', () => {
    const fora = [{ startDate: '2026-10-05', days: 12 }, { startDate: '2027-03-01', days: 18 }]
    expect(matchSplit(EMR_VACATION_POLICY, 30, fora)).toBeNull()
  })
})

describe('regra do dia de início', () => {
  it('aceita de segunda a quinta', () => {
    // 05/10/2026 é segunda; 08/10 é quinta.
    expect(blockedStartReason('2026-10-05', SEM_FERIADO, EMR_VACATION_POLICY)).toBeNull()
    expect(blockedStartReason('2026-10-08', SEM_FERIADO, EMR_VACATION_POLICY)).toBeNull()
  })

  it('recusa sexta, sábado e domingo', () => {
    expect(blockedStartReason('2026-10-09', SEM_FERIADO, EMR_VACATION_POLICY)).toContain('sexta-feira')
    expect(blockedStartReason('2026-10-10', SEM_FERIADO, EMR_VACATION_POLICY)).toContain('sábado')
    expect(blockedStartReason('2026-10-11', SEM_FERIADO, EMR_VACATION_POLICY)).toContain('domingo')
  })

  it('recusa começar no próprio feriado, mesmo sendo dia útil', () => {
    const feriados = new Map([['2026-10-12', 'Nossa Senhora Aparecida']])
    const erro = blockedStartReason('2026-10-12', feriados, EMR_VACATION_POLICY)
    expect(erro).toContain('é feriado')
    expect(erro).toContain('Nossa Senhora Aparecida')
  })

  it('a exceção legal libera a véspera de dois dias, ainda que caia num sábado', () => {
    // 12/10/2026 é segunda; dois dias antes é sábado 10/10.
    const feriados = new Map([['2026-10-12', 'Nossa Senhora Aparecida']])
    expect(blockedStartReason('2026-10-10', feriados, EMR_VACATION_POLICY)).toBeNull()
  })

  it('havendo feriado próximo, sugere a data certa em vez de só recusar', () => {
    const feriados = new Map([['2026-10-12', 'Nossa Senhora Aparecida']])
    const aviso = holidayEveHint('2026-10-09', feriados, EMR_VACATION_POLICY)
    expect(aviso).toContain('10/10/2026')
  })

  it('sem feriado por perto não há sugestão', () => {
    expect(holidayEveHint('2026-11-09', SEM_FERIADO, EMR_VACATION_POLICY)).toBeNull()
  })
})

describe('validação do plano', () => {
  const base = {
    policy: EMR_VACATION_POLICY,
    balanceDays: 30,
    acquisitionEnd: '2026-09-30',
    dueDate: '2027-08-30',
    holidays: SEM_FERIADO,
    today: '2026-08-25',
  }
  const validar = (periods: PlannedPeriod[], extra: Partial<typeof base> = {}) =>
    validateVacationPlan({ ...base, ...extra, periods })

  it('nada preenchido é "vazio", não erro', () => {
    expect(validar([]).status).toBe('vazio')
  })

  it('uma combinação válida e completa fica "ok"', () => {
    const v = validar([{ startDate: '2026-11-09', days: 30 }])
    expect(v.status).toBe('ok')
    expect(v.daysUsed).toBe(30)
    expect(v.daysLeft).toBe(0)
  })

  it('desconta o abono do saldo para descanso', () => {
    const v = validar([{ startDate: '2026-11-09', days: 20 }])
    expect(v.soldDays).toBe(10)
    expect(v.status).toBe('ok')
  })

  it('período que termina depois do limite é erro', () => {
    const v = validar([{ startDate: '2027-08-16', days: 30 }])
    expect(v.errors.join(' ')).toContain('data limite')
  })

  it('começar antes do fim do aquisitivo é erro', () => {
    const v = validar([{ startDate: '2026-09-28', days: 30 }])
    expect(v.errors.join(' ')).toContain('primeiro dia permitido')
  })

  it('períodos sobrepostos são erro', () => {
    const v = validar([
      { startDate: '2026-11-09', days: 15 },
      { startDate: '2026-11-16', days: 15 },
    ])
    expect(v.errors.join(' ')).toContain('sobrepostas')
  })

  it('menos de 30 dias de antecedência é aviso, não erro', () => {
    // 05/10 fica a 15 dias de 20/09 — dentro da janela do aviso.
    const v = validar([{ startDate: '2026-10-05', days: 30 }], { today: '2026-09-20' })
    expect(v.errors).toHaveLength(0)
    expect(v.warnings.join(' ')).toContain('antecedência')
    expect(v.status).toBe('atencao')
  })

  it('saldo quebrado dividido em dois é erro com a explicação certa', () => {
    const v = validar(
      [
        { startDate: '2026-11-09', days: 9 },
        { startDate: '2027-01-11', days: 9 },
      ],
      { balanceDays: 18 },
    )
    expect(v.errors.join(' ')).toContain('um único período')
  })

  it('saldo zerado não pede nada e não fica pendente', () => {
    const v = validar([], { balanceDays: 0 })
    expect(v.status).toBe('ok')
    expect(v.daysLeft).toBe(0)
  })

  it('o primeiro dia permitido respeita a abertura da campanha', () => {
    // Aquisitivo terminou muito antes: vale a data mínima da campanha.
    expect(earliestStartFor('2025-01-31', EMR_VACATION_POLICY)).toBe('2026-10-01')
    // Aquisitivo termina depois: vale o dia seguinte a ele.
    expect(earliestStartFor('2026-12-31', EMR_VACATION_POLICY)).toBe('2027-01-01')
  })
})

describe('coincidência de férias no time', () => {
  it('aponta o mês em que mais de uma pessoa sai', () => {
    const meses = teamMonthOverlaps([
      { userId: 'ana', startDate: '2027-07-05', endDate: '2027-07-24' },
      { userId: 'bruno', startDate: '2027-07-12', endDate: '2027-07-31' },
      { userId: 'caio', startDate: '2027-09-06', endDate: '2027-09-25' },
    ])
    expect(meses).toHaveLength(1)
    expect(meses[0]).toEqual({ month: '2027-07', userIds: ['ana', 'bruno'] })
  })

  it('período que atravessa o mês conta nos dois', () => {
    const meses = teamMonthOverlaps([
      { userId: 'ana', startDate: '2027-07-28', endDate: '2027-08-10' },
      { userId: 'bruno', startDate: '2027-08-16', endDate: '2027-08-30' },
    ])
    expect(meses.map((m) => m.month)).toEqual(['2027-08'])
  })

  it('uma pessoa sozinha no mês não vira informativo', () => {
    expect(
      teamMonthOverlaps([{ userId: 'ana', startDate: '2027-07-05', endDate: '2027-07-24' }]),
    ).toEqual([])
  })
})

describe('aviso ao colaborador', () => {
  it('preenche nome, períodos e ano', () => {
    const texto = renderVacationNotice('Olá, {nome}! Férias de {ano}: {periodos}.', {
      nome: 'Ana',
      periodos: '05/07 a 24/07',
      ano: 2027,
    })
    expect(texto).toBe('Olá, Ana! Férias de 2027: 05/07 a 24/07.')
  })
})

describe('fim do período', () => {
  it('é inclusivo nas duas pontas', () => {
    // 30 dias a partir de 09/11 terminam em 08/12, não em 09/12.
    expect(periodEndDate('2026-11-09', 30)).toBe('2026-12-08')
    expect(periodEndDate('2026-11-09', 1)).toBe('2026-11-09')
    expect(periodEndDate('', 30)).toBeNull()
  })
})

describe('PJ segue outro padrão', () => {
  const base = {
    policy: EMR_VACATION_POLICY,
    balanceDays: EMR_VACATION_POLICY.pj.balanceDays,
    acquisitionEnd: '2026-09-30',
    dueDate: '2027-08-30',
    holidays: SEM_FERIADO,
    today: '2026-08-25',
    employmentType: 'PJ' as const,
  }
  const validarPJ = (periods: PlannedPeriod[], extra: Partial<typeof base> = {}) =>
    validateVacationPlan({ ...base, ...extra, periods })

  it('são 20 dias, não 30', () => {
    expect(EMR_VACATION_POLICY.pj.balanceDays).toBe(20)
  })

  it('divide como quiser — não há combinação a escolher', () => {
    expect(splitsForBalance(EMR_VACATION_POLICY, 20, 'PJ')).toEqual([])
    // O CLT continua com as cinco.
    expect(splitsForBalance(EMR_VACATION_POLICY, 30, 'CLT')).toHaveLength(5)
  })

  it('aceita uma divisão que nenhuma combinação da CLT permitiria', () => {
    // 7 + 13 não é nenhuma das cinco, e para o PJ está certo: o combinado é
    // entre a pessoa e o líder direto.
    const v = validarPJ([
      { startDate: '2026-11-09', days: 7 },
      { startDate: '2027-01-11', days: 13 },
    ])
    expect(v.errors).toEqual([])
    expect(v.status).toBe('ok')
  })

  it('não vende dias — abono é da CLT', () => {
    const v = validarPJ([{ startDate: '2026-11-09', days: 20 }])
    expect(v.soldDays).toBe(0)
    expect(soldDaysPerPeriod(EMR_VACATION_POLICY, 20, [{ startDate: '2026-11-09', days: 20 }], 'PJ')).toEqual([0])
  })

  it('pode começar numa sexta-feira', () => {
    // A regra de segunda a quinta é da CLT; impô-la ao PJ seria transformar um
    // combinado entre duas pessoas em exigência da empresa.
    const v = validarPJ([{ startDate: '2026-11-13', days: 20 }])
    expect(v.errors).toEqual([])
  })

  it('pode começar em feriado', () => {
    const feriados = new Map([['2026-11-09', 'Feriado de teste']])
    const v = validarPJ([{ startDate: '2026-11-09', days: 20 }], { holidays: feriados })
    expect(v.errors).toEqual([])
  })

  it('mas o prazo continua valendo', () => {
    // Os dias pertencem a um ciclo; sem prazo, o saldo acumularia sem fim.
    const v = validarPJ([{ startDate: '2027-08-16', days: 20 }])
    expect(v.errors.join(' ')).toContain('data limite')
  })

  it('e passar do saldo continua sendo erro', () => {
    const v = validarPJ([{ startDate: '2026-11-09', days: 25 }])
    expect(v.errors.join(' ')).toContain('passou do saldo')
  })

  it('sobreposição continua sendo erro', () => {
    const v = validarPJ([
      { startDate: '2026-11-09', days: 10 },
      { startDate: '2026-11-16', days: 10 },
    ])
    expect(v.errors.join(' ')).toContain('sobrepostas')
  })

  it('o CLT não é afetado: sexta-feira segue recusada', () => {
    const v = validateVacationPlan({
      ...base,
      employmentType: 'CLT',
      balanceDays: 30,
      periods: [{ startDate: '2026-11-13', days: 30 }],
    })
    expect(v.errors.join(' ')).toContain('sexta-feira')
  })
})
