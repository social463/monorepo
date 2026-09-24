import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BALL_CHARGE_MS } from './useOfficeBall'
import { BallChargeBar } from './BallChargeBar'

describe('BallChargeBar', () => {
  let rafCallbacks: FrameRequestCallback[]
  let rafId: number

  beforeEach(() => {
    rafCallbacks = []
    rafId = 0
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return ++rafId
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sem carga em andamento, não desenha nada', () => {
    const { container } = render(<BallChargeBar charging={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('a barra enche conforme o tempo segurado avança até o teto', () => {
    const now = 10_000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const { getByRole, rerender } = render(
      <BallChargeBar charging={{ power: 'kick', startedAt: now }} />,
    )

    const barraVazia = getByRole('progressbar')
    expect(barraVazia).toHaveAttribute('aria-valuenow', '0')

    vi.spyOn(Date, 'now').mockReturnValue(now + BALL_CHARGE_MS / 2)
    act(() => rafCallbacks.forEach((cb) => cb(0)))
    rerender(<BallChargeBar charging={{ power: 'kick', startedAt: now }} />)
    expect(Number(getByRole('progressbar').getAttribute('aria-valuenow'))).toBeCloseTo(50, 0)

    vi.spyOn(Date, 'now').mockReturnValue(now + BALL_CHARGE_MS * 2)
    act(() => rafCallbacks.forEach((cb) => cb(0)))
    rerender(<BallChargeBar charging={{ power: 'kick', startedAt: now }} />)
    expect(getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })
})
