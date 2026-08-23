import { describe, it, expect } from 'vitest'
import { derivePeriodState, isPeriodEditable } from './period-state'

const window = { startsAt: new Date('2026-07-10T00:00:00Z'), endsAt: new Date('2026-07-17T23:59:59Z') }

describe('derivePeriodState', () => {
  it('is SCHEDULED before the window starts', () => {
    expect(derivePeriodState({ ...window, status: 'OPEN' }, new Date('2026-07-01T00:00:00Z'))).toBe('SCHEDULED')
  })

  it('is ACTIVE inside the window', () => {
    expect(derivePeriodState({ ...window, status: 'OPEN' }, new Date('2026-07-12T00:00:00Z'))).toBe('ACTIVE')
  })

  it('is ACTIVE on the window boundaries', () => {
    expect(derivePeriodState({ ...window, status: 'OPEN' }, window.startsAt)).toBe('ACTIVE')
    expect(derivePeriodState({ ...window, status: 'OPEN' }, window.endsAt)).toBe('ACTIVE')
  })

  it('is ENDED after the window ends', () => {
    expect(derivePeriodState({ ...window, status: 'OPEN' }, new Date('2026-07-20T00:00:00Z'))).toBe('ENDED')
  })

  it('is ENDED when manually closed, even inside the window', () => {
    expect(derivePeriodState({ ...window, status: 'CLOSED' }, new Date('2026-07-12T00:00:00Z'))).toBe('ENDED')
  })
})

describe('isPeriodEditable', () => {
  const now = new Date('2026-06-09T12:00:00Z')

  it('is editable for the current month', () => {
    expect(isPeriodEditable('2026-06', now)).toBe(true)
  })

  it('is editable for future months', () => {
    expect(isPeriodEditable('2026-07', now)).toBe(true)
    expect(isPeriodEditable('2027-01', now)).toBe(true)
  })

  it('is not editable for past months', () => {
    expect(isPeriodEditable('2026-05', now)).toBe(false)
    expect(isPeriodEditable('2025-12', now)).toBe(false)
  })
})
