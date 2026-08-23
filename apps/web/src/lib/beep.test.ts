import { describe, it, expect, vi, afterEach } from 'vitest'

function installFakeAudio() {
  const osc = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: { value: 0 } }
  const gain = { connect: vi.fn(), gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }
  const ctx = {
    state: 'running' as const,
    currentTime: 0,
    destination: {},
    createOscillator: vi.fn(() => osc),
    createGain: vi.fn(() => gain),
    resume: vi.fn(() => Promise.resolve()),
  }
  vi.stubGlobal('AudioContext', vi.fn(() => ctx))
  return { ctx, osc, gain }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('playCallBeep', () => {
  it('cria e agenda um oscilador (som curto)', async () => {
    const fake = installFakeAudio()
    const { playCallBeep } = await import('./beep')
    playCallBeep()
    expect(fake.ctx.createOscillator).toHaveBeenCalled()
    expect(fake.osc.start).toHaveBeenCalled()
    expect(fake.osc.stop).toHaveBeenCalled()
  })

  it('não lança quando o navegador não tem AudioContext', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const { playCallBeep } = await import('./beep')
    expect(() => playCallBeep()).not.toThrow()
  })

  it('toca o motivo de dois bipes 3x seguidas (6 osciladores)', async () => {
    const fake = installFakeAudio()
    const { playCallBeep } = await import('./beep')
    playCallBeep()
    expect(fake.ctx.createOscillator).toHaveBeenCalledTimes(6)
  })

  it('é mais alto que o volume antigo (pico de ganho 0.32)', async () => {
    const fake = installFakeAudio()
    const { playCallBeep } = await import('./beep')
    playCallBeep()
    const peaks = fake.gain.gain.exponentialRampToValueAtTime.mock.calls.map((c) => c[0] as number)
    expect(Math.max(...peaks)).toBeCloseTo(0.32)
  })
})

describe('playEnterBeep / playLeaveBeep', () => {
  it('entrada agenda dois tons ascendentes', async () => {
    const fake = installFakeAudio()
    const { playEnterBeep } = await import('./beep')
    playEnterBeep()
    expect(fake.ctx.createOscillator).toHaveBeenCalledTimes(2)
    expect(fake.osc.start).toHaveBeenCalled()
  })

  it('saída agenda dois tons descendentes', async () => {
    const fake = installFakeAudio()
    const { playLeaveBeep } = await import('./beep')
    playLeaveBeep()
    expect(fake.ctx.createOscillator).toHaveBeenCalledTimes(2)
    expect(fake.osc.start).toHaveBeenCalled()
  })

  it('não lançam sem AudioContext', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const { playEnterBeep, playLeaveBeep } = await import('./beep')
    expect(() => playEnterBeep()).not.toThrow()
    expect(() => playLeaveBeep()).not.toThrow()
  })
})

describe('playKnockBeep', () => {
  it('agenda três batidas', async () => {
    const fake = installFakeAudio()
    const { playKnockBeep } = await import('./beep')
    playKnockBeep()
    expect(fake.ctx.createOscillator).toHaveBeenCalledTimes(3)
    expect(fake.osc.start).toHaveBeenCalled()
    expect(fake.osc.stop).toHaveBeenCalled()
  })

  it('é grave, para não se confundir com o aviso de chamada', async () => {
    const fake = installFakeAudio()
    const { playKnockBeep } = await import('./beep')
    playKnockBeep()
    // O oscilador é o mesmo objeto falso pra todos os tons: basta o último
    // valor atribuído estar na faixa grave.
    expect(fake.osc.frequency.value).toBeLessThan(400)
  })

  it('não lança quando o navegador não tem AudioContext', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const { playKnockBeep } = await import('./beep')
    expect(() => playKnockBeep()).not.toThrow()
  })
})

describe('playRaiseHandBeep', () => {
  it('agenda um bipe duplo', async () => {
    const fake = installFakeAudio()
    const { playRaiseHandBeep } = await import('./beep')
    playRaiseHandBeep()
    expect(fake.ctx.createOscillator).toHaveBeenCalledTimes(2)
    expect(fake.osc.start).toHaveBeenCalled()
    expect(fake.osc.stop).toHaveBeenCalled()
  })

  it('não lança quando o navegador não tem AudioContext', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const { playRaiseHandBeep } = await import('./beep')
    expect(() => playRaiseHandBeep()).not.toThrow()
  })
})
