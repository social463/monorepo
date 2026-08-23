import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * Fake mínimo de AudioContext: só precisa saber se algum tom foi agendado.
 * `beep.ts` guarda o contexto num singleton de módulo, então cada teste
 * reimporta (`resetModules`) para não herdar o contexto do teste anterior.
 */
function installFakeAudioContext() {
  const start = vi.fn()
  class FakeAudioContext {
    state = 'running'
    currentTime = 0
    destination = {}
    createOscillator = vi.fn(() => ({
      frequency: { value: 0 },
      connect: vi.fn(),
      start,
      stop: vi.fn(),
    }))
    createGain = vi.fn(() => ({
      connect: vi.fn(),
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    }))
    resume = vi.fn()
  }
  vi.stubGlobal('AudioContext', FakeAudioContext)
  return { start }
}

/** Reimporta os dois módulos juntos: o portão precisa ser o mesmo que o beep lê. */
async function loadSound() {
  const beep = await import('./beep')
  const silence = await import('./office-silence')
  return { ...beep, ...silence }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

const BIPES = ['playCallBeep', 'playEnterBeep', 'playLeaveBeep', 'playKnockBeep', 'playRaiseHandBeep'] as const

describe('portão de silêncio do escritório', () => {
  it.each(BIPES)('%s não toca na sala de silêncio', async (nome) => {
    const fake = installFakeAudioContext()
    const sound = await loadSound()

    sound[nome]()
    expect(fake.start).toHaveBeenCalled() // fora da sala, toca

    fake.start.mockClear()
    sound.setOfficeSilenced(true)
    sound[nome]()
    expect(fake.start).not.toHaveBeenCalled()
  })

  it('sair da sala devolve o som', async () => {
    const fake = installFakeAudioContext()
    const sound = await loadSound()

    sound.setOfficeSilenced(true)
    sound.playEnterBeep()
    expect(fake.start).not.toHaveBeenCalled()

    sound.setOfficeSilenced(false)
    sound.playEnterBeep()
    expect(fake.start).toHaveBeenCalled()
  })

  it('cala o aplauso da comemoração e a palma do high-five', async () => {
    const play = vi.fn(() => Promise.resolve())
    class FakeAudio {
      volume = 1
      currentTime = 0
      play = play
      constructor(public src = '') {}
    }
    vi.stubGlobal('Audio', FakeAudio)

    const { setOfficeSilenced } = await import('./office-silence')
    const { playApplauseSound } = await import('../office/media/applause-sound')
    const { playHighFiveSound } = await import('../office/media/high-five-sound')

    playApplauseSound()
    playHighFiveSound({ perfect: true })
    expect(play).toHaveBeenCalledTimes(2)

    play.mockClear()
    setOfficeSilenced(true)
    playApplauseSound()
    playHighFiveSound({ perfect: true })
    expect(play).not.toHaveBeenCalled()
  })
})
