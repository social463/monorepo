import { describe, expect, it } from 'vitest'
import { FEATURE_KEYS, FEATURE_LABELS } from './third-party'
import {
  ASSISTANT_HOURLY_LIMIT,
  ASSISTANT_MAX_SOURCES,
  ASSISTANT_NOT_FOUND_MESSAGE,
  ASSISTANT_QUESTION_MAX_LENGTH,
} from './assistant'

describe('contrato da assistente', () => {
  it('registra a feature assistente com rótulo em português', () => {
    expect(FEATURE_KEYS).toContain('assistente')
    expect(FEATURE_LABELS.assistente).toBe('Assistente de RH')
  })

  it('tem limites coerentes entre si', () => {
    expect(ASSISTANT_HOURLY_LIMIT).toBeGreaterThan(0)
    expect(ASSISTANT_MAX_SOURCES).toBeGreaterThan(0)
    expect(ASSISTANT_QUESTION_MAX_LENGTH).toBeGreaterThan(10)
  })

  it('a mensagem de "não encontrei" avisa que a pergunta foi registrada', () => {
    expect(ASSISTANT_NOT_FOUND_MESSAGE).toContain('não encontrei')
    expect(ASSISTANT_NOT_FOUND_MESSAGE).toContain('registrada')
  })
})
