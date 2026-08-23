import { describe, it, expect, vi, afterEach } from 'vitest'
import { signCalendarState, verifyCalendarState, CalendarStateError } from './state'

const payload = { userId: 'u1', companyId: 'c1', provider: 'google' as const }

afterEach(() => vi.useRealTimers())

describe('calendar state', () => {
  it('faz round-trip do payload', () => {
    expect(verifyCalendarState(signCalendarState(payload))).toMatchObject(payload)
  })

  it('gera state diferente a cada chamada (nonce)', () => {
    expect(signCalendarState(payload)).not.toBe(signCalendarState(payload))
  })

  it('rejeita payload adulterado', () => {
    const [body, sig] = signCalendarState(payload).split('.')
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), userId: 'outro' }),
    ).toString('base64url')
    expect(() => verifyCalendarState(`${forged}.${sig}`)).toThrow(CalendarStateError)
  })

  it('rejeita state expirado (10 min)', () => {
    const token = signCalendarState(payload)
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.now() + 11 * 60 * 1000))
    expect(() => verifyCalendarState(token)).toThrow(CalendarStateError)
  })

  it('rejeita lixo', () => {
    expect(() => verifyCalendarState('nada')).toThrow(CalendarStateError)
  })
})
