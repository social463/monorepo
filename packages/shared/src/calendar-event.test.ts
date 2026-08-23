import { describe, expect, it } from 'vitest'
import {
  CALENDAR_CATEGORY_FALLBACK_COLOR,
  CALENDAR_EVENT_CATEGORIES,
  audienceReaches,
  calendarCategoryColor,
  calendarDurationLabel,
  canSeeInternalCalendarEvents,
  normalizeAudienceTag,
  viewerAudienceTags,
  addedByLabel,
  canEditCalendarEvent,
  canManageCalendarEvents,
  expandOccurrences,
  reminderDateFor,
  reminderOffsetLabel,
} from './calendar-event'

describe('expandOccurrences', () => {
  it('evento único dentro da janela devolve a própria data', () => {
    expect(expandOccurrences({ date: '2026-08-14', recurrence: 'NONE' }, '2026-08-01', '2026-08-31')).toEqual([
      '2026-08-14',
    ])
  })

  it('evento único fora da janela não devolve nada', () => {
    expect(expandOccurrences({ date: '2026-07-14', recurrence: 'NONE' }, '2026-08-01', '2026-08-31')).toEqual([])
  })

  it('semanal devolve uma ocorrência a cada sete dias', () => {
    expect(expandOccurrences({ date: '2026-08-03', recurrence: 'WEEKLY' }, '2026-08-01', '2026-08-31')).toEqual([
      '2026-08-03',
      '2026-08-10',
      '2026-08-17',
      '2026-08-24',
      '2026-08-31',
    ])
  })

  it('semanal recorta pela janela sem reiniciar a contagem', () => {
    expect(expandOccurrences({ date: '2026-08-03', recurrence: 'WEEKLY' }, '2026-08-15', '2026-08-31')).toEqual([
      '2026-08-17',
      '2026-08-24',
      '2026-08-31',
    ])
  })

  it('mensal mantém o dia da regra nos meses que o têm', () => {
    expect(expandOccurrences({ date: '2026-01-15', recurrence: 'MONTHLY' }, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
    ])
  })

  it('mensal em dia 31 cai no último dia dos meses curtos, sem pular nem vazar para o mês seguinte', () => {
    expect(expandOccurrences({ date: '2026-01-31', recurrence: 'MONTHLY' }, '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ])
  })

  it('mensal vira o ano corretamente', () => {
    expect(expandOccurrences({ date: '2026-11-10', recurrence: 'MONTHLY' }, '2026-11-01', '2027-02-28')).toEqual([
      '2026-11-10',
      '2026-12-10',
      '2027-01-10',
      '2027-02-10',
    ])
  })

  it('anual em 29/02 cai em 28/02 nos anos comuns', () => {
    expect(expandOccurrences({ date: '2024-02-29', recurrence: 'YEARLY' }, '2024-01-01', '2028-12-31')).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ])
  })

  it('recurrenceUntil corta a série mesmo com janela maior', () => {
    expect(
      expandOccurrences(
        { date: '2026-08-03', recurrence: 'WEEKLY', recurrenceUntil: '2026-08-18' },
        '2026-08-01',
        '2026-09-30',
      ),
    ).toEqual(['2026-08-03', '2026-08-10', '2026-08-17'])
  })

  it('recurrenceCount conta da primeira ocorrência, não do início da janela', () => {
    const rule = { date: '2026-08-03', recurrence: 'WEEKLY', recurrenceCount: 3 } as const
    expect(expandOccurrences(rule, '2026-08-01', '2026-09-30')).toEqual(['2026-08-03', '2026-08-10', '2026-08-17'])
    // A janela começa depois da segunda: sobra só a terceira, e não nascem novas.
    expect(expandOccurrences(rule, '2026-08-15', '2026-09-30')).toEqual(['2026-08-17'])
  })

  it('janela invertida devolve vazio', () => {
    expect(expandOccurrences({ date: '2026-08-03', recurrence: 'WEEKLY' }, '2026-08-31', '2026-08-01')).toEqual([])
  })
})

describe('reminderDateFor', () => {
  it('antecedência 0 é o próprio dia', () => {
    expect(reminderDateFor('2026-08-14', 0)).toBe('2026-08-14')
  })

  it('atravessa a virada de mês', () => {
    expect(reminderDateFor('2026-08-03', 7)).toBe('2026-07-27')
  })

  it('atravessa a virada de ano', () => {
    expect(reminderDateFor('2027-01-02', 3)).toBe('2026-12-30')
  })
})

describe('reminderOffsetLabel', () => {
  it('usa singular no dia 1 e plural nos demais', () => {
    expect(reminderOffsetLabel(0)).toBe('No dia')
    expect(reminderOffsetLabel(1)).toBe('1 dia antes')
    expect(reminderOffsetLabel(7)).toBe('7 dias antes')
  })
})

describe('canManageCalendarEvents', () => {
  it('ADMIN global sempre pode', () => {
    expect(canManageCalendarEvents('ADMIN', [])).toBe(true)
  })

  it('SUBADMIN só com a feature do bloco', () => {
    expect(canManageCalendarEvents('SUBADMIN', ['desenvolvimento-produto'])).toBe(true)
    expect(canManageCalendarEvents('SUBADMIN', ['gente-gestao'])).toBe(false)
  })

  it('liderança pode, sem depender de feature de bloco', () => {
    expect(canManageCalendarEvents('LEAD', [])).toBe(true)
    expect(canManageCalendarEvents('MANAGER', [])).toBe(true)
    expect(canManageCalendarEvents('HEAD', [])).toBe(true)
  })

  it('colaborador e terceiro não podem', () => {
    expect(canManageCalendarEvents('LEGEND', [])).toBe(false)
    expect(canManageCalendarEvents('THIRD_PARTY', [])).toBe(false)
    expect(canManageCalendarEvents(null, [])).toBe(false)
  })
})

describe('canEditCalendarEvent', () => {
  const doAdmin = { createdById: 'admin-1' }
  const doLider = { createdById: 'lead-1' }

  it('admin edita evento de qualquer um', () => {
    expect(canEditCalendarEvent({ id: 'x', role: 'ADMIN' }, doLider)).toBe(true)
  })

  it('subadmin do bloco edita evento de qualquer um', () => {
    expect(
      canEditCalendarEvent({ id: 'x', role: 'SUBADMIN', sectorFeatures: ['desenvolvimento-produto'] }, doLider),
    ).toBe(true)
  })

  it('líder edita o que criou', () => {
    expect(canEditCalendarEvent({ id: 'lead-1', role: 'LEAD' }, doLider)).toBe(true)
  })

  it('líder NÃO mexe no evento de outra pessoa', () => {
    expect(canEditCalendarEvent({ id: 'lead-1', role: 'LEAD' }, doAdmin)).toBe(false)
  })

  it('colaborador nunca edita, nem o que criou', () => {
    expect(canEditCalendarEvent({ id: 'lead-1', role: 'LEGEND' }, doLider)).toBe(false)
  })
})

describe('addedByLabel', () => {
  it('monta o rastro com data em pt-BR', () => {
    expect(addedByLabel('Lucca Secco', '2026-08-03T12:00:00.000Z')).toBe('Adicionado por Lucca Secco em 03/08/2026')
  })
})

describe('CALENDAR_EVENT_CATEGORIES', () => {
  /** O mesmo `slugify` do service — a semeadura e o cadastro manual têm que dar no mesmo slug. */
  function slugify(name: string): string {
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
  }

  it('tem as dez categorias do Calendário Endomarketing 2026', () => {
    expect(CALENDAR_EVENT_CATEGORIES).toHaveLength(10)
    expect(CALENDAR_EVENT_CATEGORIES.map((c) => c.label)).toEqual([
      'Ação',
      'Data comemorativa',
      'Evento',
      'Feriado',
      'Campanha',
      'Reunião',
      'Avaliação',
      'Cultura',
      'Desenv. Humano',
      'Comunicação',
    ])
  })

  it('o slug é o que `slugify(label)` produziria — senão a semeadura duplicaria a categoria', () => {
    for (const categoria of CALENDAR_EVENT_CATEGORIES) {
      expect(categoria.slug).toBe(slugify(categoria.label))
    }
  })

  it('não repete slug nem deixa cor fora do formato hex', () => {
    expect(new Set(CALENDAR_EVENT_CATEGORIES.map((c) => c.slug)).size).toBe(10)
    for (const categoria of CALENDAR_EVENT_CATEGORIES) {
      expect(categoria.color).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('devolve a cor da categoria, e a de fallback para slug desconhecido', () => {
    expect(calendarCategoryColor('cultura')).toBe('#14b8a6')
    expect(calendarCategoryColor('provas-b2b')).toBe(CALENDAR_CATEGORY_FALLBACK_COLOR)
  })
})

describe('público-alvo', () => {
  it('lista vazia é a empresa inteira — e não "ninguém"', () => {
    expect(audienceReaches([], ['Todos'])).toBe(true)
  })

  it('a tag "Todos" alcança quem não tem tag nenhuma', () => {
    expect(audienceReaches(['Todos'], [])).toBe(true)
  })

  it('só alcança quem tem a tag', () => {
    expect(audienceReaches(['Líder'], ['Todos', 'Líder'])).toBe(true)
    expect(audienceReaches(['Líder'], ['Todos'])).toBe(false)
  })

  it('acento, caixa e pontuação não mudam a tag', () => {
    // A planilha de colaboradores não garante grafia; comparar cru esconderia o
    // evento de quem deveria vê-lo.
    expect(normalizeAudienceTag('G&G')).toBe(normalizeAudienceTag('g & g'))
    expect(audienceReaches(['LIDER'], ['Líder'])).toBe(true)
    expect(audienceReaches(['Gente e Gestão'], ['gente e gestao'])).toBe(true)
  })

  it('deriva as tags da pessoa do que o produto já sabe dela', () => {
    expect(
      viewerAudienceTags({ role: 'LEAD', sectorName: 'Marketing', sectorFeatures: [], position: 'Coordenador' }),
    ).toEqual(['Todos', 'Marketing', 'Líder'])
  })

  it('marca G&G pelo bloco de Gente e Gestão e pelo nome do setor', () => {
    expect(viewerAudienceTags({ role: 'LEGEND', sectorName: 'Pessoas', sectorFeatures: ['gente-gestao'] })).toContain(
      'G&G',
    )
    expect(viewerAudienceTags({ role: 'LEGEND', sectorName: 'Gente e Gestão', sectorFeatures: [] })).toContain('G&G')
  })

  it('CEO sai do cargo, com limite de palavra', () => {
    expect(viewerAudienceTags({ role: 'LEGEND', position: 'CEO' })).toContain('CEO')
    expect(viewerAudienceTags({ role: 'LEGEND', position: 'Assessor do CEO' })).toContain('CEO')
    // "Ceonardo" não é CEO — `includes('ceo')` diria que sim.
    expect(viewerAudienceTags({ role: 'LEGEND', position: 'Ceonardo Silva' })).not.toContain('CEO')
  })
})

describe('canSeeInternalCalendarEvents', () => {
  it('admin pleno e acesso delegado enxergam', () => {
    expect(canSeeInternalCalendarEvents('ADMIN', [])).toBe(true)
    expect(canSeeInternalCalendarEvents('LEGEND', [], true)).toBe(true)
  })

  it('o time de Gente e Gestão enxerga — o setor inteiro, não só o subadmin', () => {
    expect(canSeeInternalCalendarEvents('LEGEND', ['gente-gestao'])).toBe(true)
    expect(canSeeInternalCalendarEvents('SUBADMIN', ['gente-gestao'])).toBe(true)
  })

  it('colaborador e liderança de fora não enxergam', () => {
    expect(canSeeInternalCalendarEvents('LEGEND', ['calendario'])).toBe(false)
    expect(canSeeInternalCalendarEvents('HEAD', ['desenvolvimento-produto'])).toBe(false)
  })
})

describe('calendarDurationLabel', () => {
  const umDia = { iso: '2026-09-10', endIso: '2026-09-10' }

  it('sem horário é dia todo', () => {
    expect(calendarDurationLabel({ ...umDia, startTime: null, endTime: null })).toBe('Dia todo')
  })

  it('com início e fim vira a duração', () => {
    expect(calendarDurationLabel({ ...umDia, startTime: '14:00', endTime: '15:30' })).toBe('1h30')
    expect(calendarDurationLabel({ ...umDia, startTime: '14:00', endTime: '15:00' })).toBe('1h')
    expect(calendarDurationLabel({ ...umDia, startTime: '14:00', endTime: '14:45' })).toBe('45min')
  })

  it('sem fim, mostra a hora de início', () => {
    expect(calendarDurationLabel({ ...umDia, startTime: '14:00', endTime: null })).toBe('14:00')
  })

  it('período de vários dias conta em dias, não em horas', () => {
    expect(
      calendarDurationLabel({ iso: '2026-09-10', endIso: '2026-09-12', startTime: '14:00', endTime: '15:00' }),
    ).toBe('3 dias')
  })
})
