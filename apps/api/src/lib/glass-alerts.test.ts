import { describe, expect, it } from 'vitest'
import { aggregateAlerts, normalizeForMatch, reviewAlerts } from './glass-alerts'

const base = { rating: null, status: null, title: null, positives: null, negatives: null, advice: null }

describe('normalizeForMatch', () => {
  it('tira acento, caixa e espaço repetido', () => {
    expect(normalizeForMatch('  Exaustão   TOTAL ')).toBe('exaustao total')
  })
})

describe('reviewAlerts — nota baixa de pessoa ativa', () => {
  it('dispara com nota 2 de quem está na casa', () => {
    expect(reviewAlerts({ ...base, rating: 2, status: 'ATIVO' })).toContain('NOTA_BAIXA_ATIVO')
  })

  it('dispara com nota 1', () => {
    expect(reviewAlerts({ ...base, rating: 1, status: 'ATIVO' })).toContain('NOTA_BAIXA_ATIVO')
  })

  it('NÃO dispara com nota 3', () => {
    expect(reviewAlerts({ ...base, rating: 3, status: 'ATIVO' })).not.toContain('NOTA_BAIXA_ATIVO')
  })

  it('NÃO dispara para ex-funcionário — diagnóstico do passado não é alerta', () => {
    expect(reviewAlerts({ ...base, rating: 1, status: 'EX_FUNCIONARIO' })).not.toContain('NOTA_BAIXA_ATIVO')
  })

  it('NÃO dispara sem nota', () => {
    expect(reviewAlerts({ ...base, rating: null, status: 'ATIVO' })).not.toContain('NOTA_BAIXA_ATIVO')
  })
})

describe('reviewAlerts — palavras críticas', () => {
  it('casa com acento no texto original', () => {
    expect(reviewAlerts({ ...base, negatives: 'Cheguei ao esgotamento em seis meses' })).toContain(
      'PALAVRA_CRITICA_BURNOUT',
    )
  })

  it('encontra em qualquer um dos campos de texto', () => {
    expect(reviewAlerts({ ...base, advice: 'Parem com a gritaria nas reuniões' })).toContain('PALAVRA_CRITICA_TOXICO')
    expect(reviewAlerts({ ...base, title: 'Fui humilhado na frente do time' })).toContain('PALAVRA_CRITICA_ASSEDIO')
  })

  it('NÃO casa por substring — "intoxicose" não é tóxico', () => {
    expect(reviewAlerts({ ...base, negatives: 'Tive reação de intoxicose na cozinha' })).not.toContain('PALAVRA_CRITICA_TOXICO')
  })

  it('NÃO casa por substring — "burnoutado" não é burnout', () => {
    expect(reviewAlerts({ ...base, negatives: 'Cheguei meio burnoutado mas recuperei' })).not.toContain('PALAVRA_CRITICA_BURNOUT')
  })

  it('NÃO casa por substring — "assessoria" não é assédio', () => {
    expect(reviewAlerts({ ...base, positives: 'Boa assessoria jurídica' })).not.toContain('PALAVRA_CRITICA_ASSEDIO')
  })

  it('NÃO dispara com "demissão" isolada', () => {
    expect(reviewAlerts({ ...base, negatives: 'Pedi demissão depois de um ano' })).not.toContain(
      'PALAVRA_CRITICA_DEMISSAO',
    )
  })

  it('dispara com demissão em massa', () => {
    expect(reviewAlerts({ ...base, negatives: 'Houve demissão em massa em janeiro' })).toContain(
      'PALAVRA_CRITICA_DEMISSAO',
    )
  })

  it('não repete o mesmo alerta quando duas palavras do grupo aparecem', () => {
    const alerts = reviewAlerts({ ...base, negatives: 'burnout e esgotamento', advice: 'exaustao' })
    expect(alerts.filter((a) => a === 'PALAVRA_CRITICA_BURNOUT')).toHaveLength(1)
  })

  it('devolve vazio para avaliação tranquila', () => {
    expect(reviewAlerts({ ...base, rating: 5, status: 'ATIVO', positives: 'Time excelente' })).toEqual([])
  })
})

describe('aggregateAlerts — queda consecutiva', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

  it('dispara quando as 3 mais recentes estão abaixo da média', () => {
    const alerts = aggregateAlerts([
      { rating: 5, sector: 'A', reviewDate: d('2026-01-10') },
      { rating: 5, sector: 'A', reviewDate: d('2026-02-10') },
      { rating: 2, sector: 'A', reviewDate: d('2026-03-10') },
      { rating: 2, sector: 'A', reviewDate: d('2026-04-10') },
      { rating: 1, sector: 'A', reviewDate: d('2026-05-10') },
    ])
    expect(alerts).toContainEqual({ key: 'QUEDA_CONSECUTIVA', count: 3 })
  })

  it('NÃO dispara quando só as 2 mais recentes estão abaixo', () => {
    const alerts = aggregateAlerts([
      { rating: 5, sector: 'A', reviewDate: d('2026-01-10') },
      { rating: 5, sector: 'A', reviewDate: d('2026-02-10') },
      { rating: 5, sector: 'A', reviewDate: d('2026-03-10') },
      { rating: 2, sector: 'A', reviewDate: d('2026-04-10') },
      { rating: 1, sector: 'A', reviewDate: d('2026-05-10') },
    ])
    expect(alerts.map((a) => a.key)).not.toContain('QUEDA_CONSECUTIVA')
  })

  it('NÃO dispara com menos de 3 avaliações', () => {
    const alerts = aggregateAlerts([
      { rating: 1, sector: 'A', reviewDate: d('2026-04-10') },
      { rating: 1, sector: 'A', reviewDate: d('2026-05-10') },
    ])
    expect(alerts.map((a) => a.key)).not.toContain('QUEDA_CONSECUTIVA')
  })

  it('ignora avaliação sem data ao ordenar — não há onde encaixá-la na série', () => {
    const alerts = aggregateAlerts([
      { rating: 5, sector: 'A', reviewDate: d('2026-01-10') },
      { rating: 5, sector: 'A', reviewDate: d('2026-02-10') },
      { rating: 1, sector: 'A', reviewDate: null },
      { rating: 2, sector: 'A', reviewDate: d('2026-03-10') },
      { rating: 2, sector: 'A', reviewDate: d('2026-04-10') },
      { rating: 1, sector: 'A', reviewDate: d('2026-05-10') },
    ])
    expect(alerts).toContainEqual({ key: 'QUEDA_CONSECUTIVA', count: 3 })
  })
})

describe('aggregateAlerts — setor crítico', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

  it('dispara com 3 avaliações abaixo do corte no mesmo setor', () => {
    const alerts = aggregateAlerts([
      { rating: 2, sector: 'Suporte', reviewDate: d('2026-01-10') },
      { rating: 2.5, sector: 'Suporte', reviewDate: d('2026-02-10') },
      { rating: 1, sector: 'Suporte', reviewDate: d('2026-03-10') },
    ])
    expect(alerts).toContainEqual({ key: 'SETOR_CRITICO', scope: 'Suporte', count: 3 })
  })

  it('NÃO dispara com 2', () => {
    const alerts = aggregateAlerts([
      { rating: 2, sector: 'Suporte', reviewDate: d('2026-01-10') },
      { rating: 1, sector: 'Suporte', reviewDate: d('2026-02-10') },
    ])
    expect(alerts.map((a) => a.key)).not.toContain('SETOR_CRITICO')
  })

  it('nota exatamente no corte não conta', () => {
    const alerts = aggregateAlerts([
      { rating: 3, sector: 'Suporte', reviewDate: d('2026-01-10') },
      { rating: 3, sector: 'Suporte', reviewDate: d('2026-02-10') },
      { rating: 3, sector: 'Suporte', reviewDate: d('2026-03-10') },
    ])
    expect(alerts.map((a) => a.key)).not.toContain('SETOR_CRITICO')
  })

  it('não mistura setores', () => {
    const alerts = aggregateAlerts([
      { rating: 1, sector: 'Suporte', reviewDate: d('2026-01-10') },
      { rating: 1, sector: 'Vendas', reviewDate: d('2026-02-10') },
      { rating: 1, sector: 'Produto', reviewDate: d('2026-03-10') },
    ])
    expect(alerts.map((a) => a.key)).not.toContain('SETOR_CRITICO')
  })

  it('ignora avaliação sem setor', () => {
    const alerts = aggregateAlerts([
      { rating: 1, sector: null, reviewDate: d('2026-01-10') },
      { rating: 1, sector: null, reviewDate: d('2026-02-10') },
      { rating: 1, sector: null, reviewDate: d('2026-03-10') },
    ])
    expect(alerts.map((a) => a.key)).not.toContain('SETOR_CRITICO')
  })
})
