import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Import dinâmico por teste + resetModules: o módulo reaproveita um único
// HTMLAudioElement em uma variável de escopo de módulo (é o comportamento
// desejado em runtime). Sem resetar o registro de módulos entre casos, esse
// singleton vazaria de um `it` pro outro dentro do mesmo arquivo de teste —
// mesmo padrão já usado em `applause-sound.test.ts`.
class FakeAudio {
  static instances: FakeAudio[] = []
  volume = 1
  currentTime = 99
  src: string
  play = vi.fn(() => Promise.resolve())
  constructor(src: string) {
    this.src = src
    FakeAudio.instances.push(this)
  }
}

beforeEach(() => {
  FakeAudio.instances = []
  vi.stubGlobal('Audio', FakeAudio)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('playHighFiveSound', () => {
  it('toca o sample com volume baixo, rebobinando a cada disparo', async () => {
    const { playHighFiveSound } = await import('./high-five-sound')
    playHighFiveSound()
    const audio = FakeAudio.instances[0]
    expect(audio.src).toBe('/sounds/high-five.mp3')
    expect(audio.volume).toBe(0.25)
    expect(audio.currentTime).toBe(0)
    expect(audio.play).toHaveBeenCalled()
  })

  it('reaproveita o mesmo elemento entre disparos', async () => {
    const { playHighFiveSound } = await import('./high-five-sound')
    playHighFiveSound()
    playHighFiveSound()
    expect(FakeAudio.instances).toHaveLength(1)
    expect(FakeAudio.instances[0].play).toHaveBeenCalledTimes(2)
  })

  it('palma perfeita sai bem mais alta que a comum (#22252)', async () => {
    const { playHighFiveSound } = await import('./high-five-sound')
    playHighFiveSound({ perfect: true })
    const audio = FakeAudio.instances[0]
    expect(audio.volume).toBe(0.8)
    // O volume é atributo do elemento reaproveitado: a palma seguinte não pode
    // herdar o volume da perfeita anterior.
    playHighFiveSound()
    expect(audio.volume).toBe(0.25)
  })

  it('engole falha de play — som é opcional', async () => {
    const { playHighFiveSound } = await import('./high-five-sound')
    playHighFiveSound()
    FakeAudio.instances[0].play.mockReturnValueOnce(Promise.reject(new Error('bloqueado')))
    expect(() => playHighFiveSound()).not.toThrow()
  })
})
