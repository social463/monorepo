import { describe, expect, it } from 'vitest'
import { getOfficeHub, OfficeHub } from './office-hub'

describe('getOfficeHub', () => {
  it('devolve a mesma instância pra chamadas repetidas com o mesmo companyId', () => {
    const first = getOfficeHub('company-registry-test-a')
    const second = getOfficeHub('company-registry-test-a')
    expect(first).toBe(second)
    expect(first).toBeInstanceOf(OfficeHub)
  })

  it('devolve instâncias diferentes pra companyIds diferentes', () => {
    const a = getOfficeHub('company-registry-test-b')
    const b = getOfficeHub('company-registry-test-c')
    expect(a).not.toBe(b)
  })

  it('estado de uma instância não vaza para outra criada depois', () => {
    const a = getOfficeHub('company-registry-test-d')
    a.reset()
    const b = getOfficeHub('company-registry-test-e')
    expect(a).not.toBe(b)
    expect(a.occupants()).toEqual([])
    expect(b.occupants()).toEqual([])
  })
})
