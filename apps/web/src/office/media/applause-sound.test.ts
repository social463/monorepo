import { describe, it, expect, vi, afterEach } from 'vitest'

/** Fake de HTMLAudioElement: registra instâncias e o que foi tocado. */
function installFakeAudio() {
  const play = vi.fn(() => Promise.resolve())
  const instances: Array<{ src: string; volume: number; currentTime: number }> = []
  class FakeAudio {
    src: string
    volume = 1
    currentTime = 0
    play = play
    constructor(src?: string) {
      this.src = src ?? ''
      instances.push(this)
    }
  }
  vi.stubGlobal('Audio', FakeAudio)
  return { play, instances }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  localStorage.clear()
})

describe('playApplauseSound', () => {
  it('toca o mp3 de aplauso em /sounds/applause.mp3', async () => {
    const fake = installFakeAudio()
    const { playApplauseSound } = await import('./applause-sound')

    playApplauseSound()

    expect(fake.instances).toHaveLength(1)
    expect(fake.instances[0].src).toContain('/sounds/applause.mp3')
    expect(fake.play).toHaveBeenCalled()
  })

  it('reaproveita o mesmo elemento e rebobina (currentTime=0) em chamadas repetidas', async () => {
    const fake = installFakeAudio()
    const { playApplauseSound } = await import('./applause-sound')

    playApplauseSound()
    fake.instances[0].currentTime = 3 // simula áudio no meio
    playApplauseSound()

    expect(fake.instances).toHaveLength(1) // não cria um novo
    expect(fake.instances[0].currentTime).toBe(0) // rebobinou
    expect(fake.play).toHaveBeenCalledTimes(2)
  })

  it('não lança quando o ambiente não tem Audio', async () => {
    vi.stubGlobal('Audio', undefined)
    const { playApplauseSound } = await import('./applause-sound')
    expect(() => playApplauseSound()).not.toThrow()
  })
})

describe('preferência de som da comemoração', () => {
  it('nasce ligado quando não há preferência salva', async () => {
    const fake = installFakeAudio()
    const { isApplauseMuted, playApplauseSound } = await import('./applause-sound')

    expect(isApplauseMuted()).toBe(false)
    playApplauseSound()
    expect(fake.play).toHaveBeenCalled()
  })

  it('não toca nada quando está mutado, e volta a tocar ao religar', async () => {
    const fake = installFakeAudio()
    const { playApplauseSound, setApplauseMuted } = await import('./applause-sound')

    setApplauseMuted(true)
    playApplauseSound()
    expect(fake.play).not.toHaveBeenCalled()
    expect(fake.instances).toHaveLength(0) // nem cria o elemento de áudio
    expect(localStorage.getItem('office:applause-muted')).toBe('1')

    setApplauseMuted(false)
    playApplauseSound()
    expect(fake.play).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('office:applause-muted')).toBe('0')
  })

  // Combinação que só existe depois de juntar as duas frentes: o toggle das
  // configurações e a sala de silêncio calam por motivos independentes.
  it('a sala de silêncio cala mesmo com o som ligado nas preferências', async () => {
    const fake = installFakeAudio()
    const { playApplauseSound, setApplauseMuted } = await import('./applause-sound')
    const { setOfficeSilenced } = await import('../../lib/office-silence')

    setApplauseMuted(false) // pessoa QUER ouvir o aplauso
    setOfficeSilenced(true)
    playApplauseSound()
    expect(fake.play).not.toHaveBeenCalled()

    setOfficeSilenced(false)
    playApplauseSound()
    expect(fake.play).toHaveBeenCalledTimes(1)
  })

  it('o toggle desligado cala mesmo fora da sala de silêncio', async () => {
    const fake = installFakeAudio()
    const { playApplauseSound, setApplauseMuted } = await import('./applause-sound')
    const { setOfficeSilenced } = await import('../../lib/office-silence')

    setOfficeSilenced(false)
    setApplauseMuted(true)
    playApplauseSound()
    expect(fake.play).not.toHaveBeenCalled()
  })

  it('lê a preferência salva numa sessão anterior', async () => {
    localStorage.setItem('office:applause-muted', '1')
    const fake = installFakeAudio()
    const { isApplauseMuted, playApplauseSound } = await import('./applause-sound')

    expect(isApplauseMuted()).toBe(true)
    playApplauseSound()
    expect(fake.play).not.toHaveBeenCalled()
  })

  it('não quebra quando o localStorage está bloqueado', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage bloqueado')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage bloqueado')
    })
    const fake = installFakeAudio()
    const { isApplauseMuted, setApplauseMuted, playApplauseSound } = await import('./applause-sound')

    expect(isApplauseMuted()).toBe(false) // sem preferência legível, o som fica ligado
    expect(() => setApplauseMuted(true)).not.toThrow()
    playApplauseSound()
    expect(fake.play).not.toHaveBeenCalled() // vale para a sessão, mesmo sem persistir

    getItem.mockRestore()
    setItem.mockRestore()
  })
})
