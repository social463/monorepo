import { describe, it, expect } from 'vitest'
import {
  COIN_ADJUSTMENT_REASON_MAX_LENGTH,
  COIN_ADJUSTMENT_REASON_MIN_LENGTH,
  COIN_CAP_WINDOWS,
  COIN_CAP_WINDOW_LABELS,
  COIN_EVENTS,
  COIN_EVENT_DESCRIPTIONS,
  COIN_EVENT_LABELS,
  COIN_MAX_AMOUNT,
  COIN_MIN_AMOUNT,
  COIN_RULE_EVENTS,
  COIN_TRANSACTION_KINDS,
  COIN_TRANSACTION_KIND_LABELS,
} from './coin'

describe('catálogo de EMR Coins', () => {
  it('tem rótulo e descrição para todo evento', () => {
    for (const event of COIN_EVENTS) {
      expect(COIN_EVENT_LABELS[event]).toBeTruthy()
      expect(COIN_EVENT_DESCRIPTIONS[event]).toBeTruthy()
    }
  })

  it('tem rótulo para toda janela de teto e todo tipo de lançamento', () => {
    for (const window of COIN_CAP_WINDOWS) {
      expect(COIN_CAP_WINDOW_LABELS[window]).toBeTruthy()
    }
    for (const kind of COIN_TRANSACTION_KINDS) {
      expect(COIN_TRANSACTION_KIND_LABELS[kind]).toBeTruthy()
    }
  })

  it('mantém os limites de valor e de justificativa coerentes', () => {
    expect(COIN_MIN_AMOUNT).toBeGreaterThan(0)
    expect(COIN_MAX_AMOUNT).toBeGreaterThan(COIN_MIN_AMOUNT)
    expect(COIN_ADJUSTMENT_REASON_MAX_LENGTH).toBeGreaterThan(COIN_ADJUSTMENT_REASON_MIN_LENGTH)
  })
})

describe('catálogo de eventos de coins', () => {
  it('rotula todo evento — extrato do colaborador lê direto do mapa', () => {
    for (const event of COIN_EVENTS) {
      expect(COIN_EVENT_LABELS[event]).toBeTruthy()
    }
  })

  it('não oferece CHALLENGE_APPROVED para regra do admin: a recompensa é do desafio', () => {
    expect(COIN_EVENTS).toContain('CHALLENGE_APPROVED')
    expect(COIN_RULE_EVENTS).not.toContain('CHALLENGE_APPROVED')
  })
})
