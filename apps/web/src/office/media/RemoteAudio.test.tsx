import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { RemoteAudioTrack } from 'livekit-client'
import { RemoteAudio } from './RemoteAudio'

function fakeTrack(): RemoteAudioTrack {
  return { attach: vi.fn(), detach: vi.fn() } as unknown as RemoteAudioTrack
}

function withFakeSetSinkId(impl: (id: string) => Promise<void>) {
  ;(HTMLMediaElement.prototype as unknown as { setSinkId: typeof impl }).setSinkId = impl
}

afterEach(() => {
  delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId
})

describe('RemoteAudio', () => {
  it('anexa a track ao elemento de áudio', () => {
    const track = fakeTrack()
    render(<RemoteAudio track={track} />)
    expect(track.attach).toHaveBeenCalledOnce()
  })

  it('chama setSinkId com o outputDeviceId quando a API existe', async () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined)
    withFakeSetSinkId(setSinkId)

    render(<RemoteAudio track={fakeTrack()} outputDeviceId="out-1" />)

    await waitFor(() => expect(setSinkId).toHaveBeenCalledWith('out-1'))
  })

  it('sem outputDeviceId, fixa a saída no padrão do sistema', async () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined)
    withFakeSetSinkId(setSinkId)

    render(<RemoteAudio track={fakeTrack()} />)

    await waitFor(() => expect(setSinkId).toHaveBeenCalledWith(''))
  })

  it('trocar de um dispositivo para o padrão do sistema reaplica o sink', async () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined)
    withFakeSetSinkId(setSinkId)

    const track = fakeTrack()
    const { rerender } = render(<RemoteAudio track={track} outputDeviceId="out-1" />)
    await waitFor(() => expect(setSinkId).toHaveBeenCalledWith('out-1'))

    rerender(<RemoteAudio track={track} outputDeviceId={null} />)

    await waitFor(() => expect(setSinkId).toHaveBeenCalledWith(''))
  })

  it('não quebra quando o navegador não suporta setSinkId', () => {
    expect(() => render(<RemoteAudio track={fakeTrack()} outputDeviceId="out-1" />)).not.toThrow()
  })

  it('aplica o volume local no elemento de áudio', () => {
    const { container, rerender } = render(<RemoteAudio track={fakeTrack()} volume={0.35} />)
    const audio = container.querySelector('audio')!
    expect(audio.volume).toBe(0.35)

    rerender(<RemoteAudio track={fakeTrack()} volume={0} />)
    expect(audio.volume).toBe(0)
  })
})
