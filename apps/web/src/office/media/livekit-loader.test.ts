import { describe, expect, it, vi } from 'vitest'
import { getLiveKit, loadLiveKit } from './livekit-loader'

vi.mock('livekit-client', () => ({ __marker: 'livekit-mock' }))

describe('livekit-loader', () => {
  it('é null antes do primeiro load e cacheia o módulo depois', async () => {
    expect(getLiveKit()).toBeNull()
    const mod = await loadLiveKit()
    expect(getLiveKit()).toBe(mod)
    await expect(loadLiveKit()).resolves.toBe(mod)
  })
})
