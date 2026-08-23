import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAudioSink } from './audioSink'

function withFakeSetSinkId(impl: (id: string) => Promise<void>) {
  ;(HTMLMediaElement.prototype as unknown as { setSinkId: typeof impl }).setSinkId = impl
}

afterEach(() => {
  delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId
})

describe('applyAudioSink', () => {
  it('chama setSinkId com o deviceId quando a API existe', async () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined)
    withFakeSetSinkId(setSinkId)
    const el = document.createElement('audio')

    await applyAudioSink(el, 'out-1')

    expect(setSinkId).toHaveBeenCalledWith('out-1')
  })

  it('deviceId null (padrão do sistema) não chama setSinkId', async () => {
    const setSinkId = vi.fn()
    withFakeSetSinkId(setSinkId)
    const el = document.createElement('audio')

    await applyAudioSink(el, null)

    expect(setSinkId).not.toHaveBeenCalled()
  })

  it('sem a API no navegador, não lança', async () => {
    const el = document.createElement('audio')
    await expect(applyAudioSink(el, 'out-1')).resolves.toBeUndefined()
  })

  it('setSinkId rejeitando (dispositivo sumiu) não lança', async () => {
    withFakeSetSinkId(() => Promise.reject(new Error('device gone')))
    const el = document.createElement('audio')

    await expect(applyAudioSink(el, 'out-1')).resolves.toBeUndefined()
  })
})
