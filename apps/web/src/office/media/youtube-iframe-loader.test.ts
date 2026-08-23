import { describe, expect, it, beforeEach } from 'vitest'
import { loadYouTubeApi, resetYouTubeApiLoaderForTests, type YouTubeApi } from './youtube-iframe-loader'

const fakeApi = { Player: function () {}, PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, UNSTARTED: -1 } } as unknown as YouTubeApi

beforeEach(() => {
  resetYouTubeApiLoaderForTests()
  delete window.YT
  delete window.onYouTubeIframeAPIReady
  document.head.querySelectorAll('script').forEach((script) => script.remove())
})

describe('youtube-iframe-loader', () => {
  it('injeta o script uma vez só e resolve quando a API avisa que está pronta', async () => {
    const pending = loadYouTubeApi()
    const same = loadYouTubeApi()

    expect(document.head.querySelectorAll('script[src*="iframe_api"]')).toHaveLength(1)

    window.YT = fakeApi
    window.onYouTubeIframeAPIReady?.()

    await expect(pending).resolves.toBe(fakeApi)
    await expect(same).resolves.toBe(fakeApi)
  })

  it('com a API já carregada, resolve sem injetar script nenhum', async () => {
    window.YT = fakeApi

    await expect(loadYouTubeApi()).resolves.toBe(fakeApi)
    expect(document.head.querySelectorAll('script[src*="iframe_api"]')).toHaveLength(0)
  })

  it('falha de rede vira erro e permite tentar de novo', async () => {
    const pending = loadYouTubeApi()
    const script = document.head.querySelector('script[src*="iframe_api"]') as HTMLScriptElement
    script.onerror?.(new Event('error'))

    await expect(pending).rejects.toThrow('Não foi possível carregar o player do YouTube')

    // A carga falha não fica cacheada: a próxima tentativa injeta de novo.
    void loadYouTubeApi()
    expect(document.head.querySelectorAll('script[src*="iframe_api"]')).toHaveLength(2)
  })
})
