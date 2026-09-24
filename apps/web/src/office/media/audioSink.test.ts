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

  // Antes isto era no-op, e um elemento que já estava num dispositivo
  // específico nunca voltava para o padrão — enquanto um elemento novo nascia
  // nele. Era essa divergência que fazia o som trocar de saída ao ir de uma
  // sala para uma mesa.
  it('deviceId null (padrão do sistema) volta a saída para o padrão', async () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined)
    withFakeSetSinkId(setSinkId)
    const el = document.createElement('audio')

    await applyAudioSink(el, null)

    expect(setSinkId).toHaveBeenCalledWith('')
  })

  it('voltar para o padrão depois de um dispositivo específico reaplica o sink', async () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined)
    withFakeSetSinkId(setSinkId)
    const el = document.createElement('audio')

    await applyAudioSink(el, 'out-1')
    await applyAudioSink(el, null)

    expect(setSinkId).toHaveBeenNthCalledWith(1, 'out-1')
    expect(setSinkId).toHaveBeenNthCalledWith(2, '')
  })

  it('padrão do sistema não lança quando o dispositivo default sumiu', async () => {
    withFakeSetSinkId(() => Promise.reject(new Error('device gone')))
    const el = document.createElement('audio')

    await expect(applyAudioSink(el, null)).resolves.toBeUndefined()
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
