import { describe, it, expect } from 'vitest'
import { CALENDAR_PROVIDERS, isCalendarProviderKey } from './calendar'

describe('calendar', () => {
  it('lista os dois provedores suportados, nessa ordem', () => {
    expect(CALENDAR_PROVIDERS).toEqual(['google', 'microsoft'])
  })

  it('isCalendarProviderKey aceita só as chaves conhecidas', () => {
    expect(isCalendarProviderKey('google')).toBe(true)
    expect(isCalendarProviderKey('microsoft')).toBe(true)
    expect(isCalendarProviderKey('GOOGLE')).toBe(false)
    expect(isCalendarProviderKey('apple')).toBe(false)
    expect(isCalendarProviderKey(undefined)).toBe(false)
  })
})
