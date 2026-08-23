import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ONE_ON_ONE_TOPICS,
  MAX_ONE_ON_ONE_OCCURRENCES,
  normalizeOneOnOnePair,
  ONE_ON_ONE_RECURRENCE_LABELS,
  ONE_ON_ONE_RECURRENCES,
  type OneOnOnePdiActionDTO,
} from './one-on-one'
import { PDI_ACTION_STATUSES } from './pdi'
import { COLLABORATOR_FEATURE_KEYS, FEATURE_LABELS } from './third-party'

describe('contrato do 1:1', () => {
  it('normaliza o par pela ordem dos ids, venha na ordem que vier', () => {
    expect(normalizeOneOnOnePair('b', 'a')).toEqual({ userAId: 'a', userBId: 'b' })
    expect(normalizeOneOnOnePair('a', 'b')).toEqual({ userAId: 'a', userBId: 'b' })
  })

  it('recusa par da pessoa com ela mesma', () => {
    expect(() => normalizeOneOnOnePair('a', 'a')).toThrow()
  })

  it('todo ritmo tem rótulo em português', () => {
    for (const r of ONE_ON_ONE_RECURRENCES) {
      expect(ONE_ON_ONE_RECURRENCE_LABELS[r]).toBeTruthy()
    }
  })

  it('o catálogo padrão nasce com tema e texto em todos os itens', () => {
    expect(DEFAULT_ONE_ON_ONE_TOPICS.length).toBeGreaterThanOrEqual(12)
    for (const topic of DEFAULT_ONE_ON_ONE_TOPICS) {
      expect(topic.theme).toBeTruthy()
      expect(topic.text).toBeTruthy()
    }
  })

  it('o teto de ocorrências é 52', () => {
    expect(MAX_ONE_ON_ONE_OCCURRENCES).toBe(52)
  })

  // O bloco de PDI do 1:1 é leitura do MESMO plano do `/pdi`: o status precisa
  // ser o enum de lá, não uma string solta que aceita qualquer coisa.
  it('o status da ação de PDI no bloco é o enum do PDI', () => {
    const acao: OneOnOnePdiActionDTO = {
      id: 'a1',
      description: 'Fazer o curso',
      status: 'AWAITING_REVIEW',
      progressPct: 40,
      dueDate: null,
    }
    expect(PDI_ACTION_STATUSES).toContain(acao.status)
    // @ts-expect-error status fora do enum do PDI não compila
    const invalida: OneOnOnePdiActionDTO = { ...acao, status: 'EM_ANDAMENTO' }
    expect(invalida.status).toBe('EM_ANDAMENTO')
  })

  it('a feature um-a-um existe e tem rótulo', () => {
    expect(COLLABORATOR_FEATURE_KEYS).toContain('um-a-um')
    expect(FEATURE_LABELS['um-a-um']).toBe('1:1')
  })
})
