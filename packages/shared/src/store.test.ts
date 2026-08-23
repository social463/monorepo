import { describe, it, expect } from 'vitest'
import {
  STORE_ORDER_STATUSES,
  STORE_ORDER_STATUS_LABELS,
  STORE_ORDER_TRANSITIONS,
  canTransitionStoreOrder,
} from './store'
import { COIN_TRANSACTION_KINDS, COIN_TRANSACTION_KIND_LABELS } from './coin'

describe('transições de pedido', () => {
  it('pendente vai para aprovado ou cancelado', () => {
    expect(canTransitionStoreOrder('PENDING', 'APPROVED')).toBe(true)
    expect(canTransitionStoreOrder('PENDING', 'CANCELLED')).toBe(true)
    expect(canTransitionStoreOrder('PENDING', 'DELIVERED')).toBe(false)
  })

  it('aprovado vai para entregue ou cancelado', () => {
    expect(canTransitionStoreOrder('APPROVED', 'DELIVERED')).toBe(true)
    expect(canTransitionStoreOrder('APPROVED', 'CANCELLED')).toBe(true)
    expect(canTransitionStoreOrder('APPROVED', 'PENDING')).toBe(false)
  })

  it('entregue e cancelado são terminais', () => {
    for (const to of STORE_ORDER_STATUSES) {
      expect(canTransitionStoreOrder('DELIVERED', to)).toBe(false)
      expect(canTransitionStoreOrder('CANCELLED', to)).toBe(false)
    }
  })

  it('nenhum status volta para si mesmo', () => {
    for (const status of STORE_ORDER_STATUSES) {
      expect(STORE_ORDER_TRANSITIONS[status]).not.toContain(status)
    }
  })

  it('todo status tem rótulo em português', () => {
    for (const status of STORE_ORDER_STATUSES) {
      expect(STORE_ORDER_STATUS_LABELS[status]).toBeTruthy()
    }
  })
})

describe('kinds do livro-razão', () => {
  it('inclui gasto e estorno da loja, com rótulo', () => {
    expect(COIN_TRANSACTION_KINDS).toContain('SPEND')
    expect(COIN_TRANSACTION_KINDS).toContain('REFUND')
    expect(COIN_TRANSACTION_KIND_LABELS.SPEND).toBe('Resgate na loja')
    expect(COIN_TRANSACTION_KIND_LABELS.REFUND).toBe('Estorno de resgate')
  })
})
