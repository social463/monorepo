import { describe, it, expect } from 'vitest'
import {
  CHALLENGE_SUBMISSION_STATUSES,
  CHALLENGE_EXPORT_MAX_ROWS,
  REJECTION_REASON_MIN_LENGTH,
  CHALLENGE_CATEGORIES,
  isChallengeCategory,
} from './challenge'
import { NOTIFICATION_TYPES } from './notification'
import { FEATURE_KEYS, FEATURE_LABELS } from './index'

describe('contrato de desafios', () => {
  it('tem exatamente os três status na ordem do fluxo', () => {
    expect(CHALLENGE_SUBMISSION_STATUSES).toEqual(['PENDING', 'APPROVED', 'REJECTED'])
  })

  it('exige motivo com tamanho mínimo na rejeição', () => {
    expect(REJECTION_REASON_MIN_LENGTH).toBeGreaterThan(0)
  })

  it('limita o export para não derrubar a API', () => {
    expect(CHALLENGE_EXPORT_MAX_ROWS).toBe(5000)
  })

  it('registra os tipos de notificação da decisão', () => {
    expect(NOTIFICATION_TYPES).toContain('CHALLENGE_SUBMISSION_APPROVED')
    expect(NOTIFICATION_TYPES).toContain('CHALLENGE_SUBMISSION_REJECTED')
  })
})

describe('categorias de desafio', () => {
  it('as sete categorias canônicas em pt-BR, na ordem das abas', () => {
    expect(CHALLENGE_CATEGORIES).toEqual([
      'Cultura',
      'Bem-estar',
      'Inovação',
      'Sustentabilidade',
      'Conhecimento',
      'Engajamento',
      'Especial',
    ])
  })

  it('isChallengeCategory aceita canônica e recusa o resto', () => {
    expect(isChallengeCategory('Bem-estar')).toBe(true)
    expect(isChallengeCategory('bem-estar')).toBe(false)
    expect(isChallengeCategory('Qualquer')).toBe(false)
  })

  it('desafios é feature com rótulo', () => {
    expect(FEATURE_KEYS).toContain('desafios')
    expect(FEATURE_LABELS.desafios).toBe('Desafios')
  })
})
