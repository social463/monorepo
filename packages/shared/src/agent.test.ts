import { describe, expect, it } from 'vitest'
import { AGENT_KEYS, isAgentKey } from './agent'
import { BENCHMARK_PRACTICE_CATEGORIES } from './benchmark'

describe('isAgentKey', () => {
  it('aceita as chaves do contrato', () => {
    for (const key of AGENT_KEYS) {
      expect(isAgentKey(key)).toBe(true)
    }
  })

  it('recusa qualquer outra coisa', () => {
    for (const value of ['Benchmark', 'assistente', '', null, undefined, 1, {}]) {
      expect(isAgentKey(value)).toBe(false)
    }
  })
})

describe('categorias de prática', () => {
  it('não tem duplicata', () => {
    expect(new Set(BENCHMARK_PRACTICE_CATEGORIES).size).toBe(BENCHMARK_PRACTICE_CATEGORIES.length)
  })
})
