import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { OfficeBridge } from '../OfficeBridge'
import { useRoomAudio } from './useRoomAudio'

const VIDEO = 'dQw4w9WgXcQ'

interface Props {
  roomId: string | null
  youId: string | null
  connected: boolean
  isGuest?: boolean
}

function renderRoomAudio(overrides: Partial<Props> = {}) {
  const props: Props = { roomId: 'room-1', youId: 'ana', connected: true, isGuest: false, ...overrides }
  const bridge = new OfficeBridge()
  const hook = renderHook((p: Props) => useRoomAudio(bridge, p.roomId, p.youId, p.connected, p.isGuest), {
    initialProps: props,
  })
  return { bridge, ...hook }
}

function trackOf(startedByUserId = 'bruno', positionSeconds = 0, paused = false, playlist?: { id: string; index: number }) {
  return {
    videoId: VIDEO,
    startedByUserId,
    startedByName: 'Bruno',
    positionSeconds,
    paused,
    playlistId: playlist?.id ?? null,
    playlistIndex: playlist?.index ?? 0,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useRoomAudio', () => {
  it('start() manda o id extraído do link colado', () => {
    const { bridge, result } = renderRoomAudio()
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    act(() => result.current.start(`https://www.youtube.com/watch?v=${VIDEO}&list=PL1`))

    // `PL1` é curto demais para ser playlist: vai só o vídeo.
    expect(sent).toEqual([{ type: 'start-room-audio', videoId: VIDEO, playlistId: null }])
  })

  it('link de playlist manda vídeo e lista; mix vai só como vídeo', () => {
    const { bridge, result } = renderRoomAudio()
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    act(() => result.current.start(`https://www.youtube.com/watch?v=${VIDEO}&list=PLabcdefghijkl`))
    expect(sent).toEqual([{ type: 'start-room-audio', videoId: VIDEO, playlistId: 'PLabcdefghijkl' }])

    sent.length = 0
    act(() => result.current.start(`https://www.youtube.com/watch?v=${VIDEO}&list=RD${VIDEO}&start_radio=1`))
    expect(sent).toEqual([{ type: 'start-room-audio', videoId: VIDEO, playlistId: null }])
  })

  it('avançar item é de quem iniciou, e a playlist não recria a faixa', () => {
    const { bridge, result } = renderRoomAudio()
    act(() => {
      bridge.emitServerMessage({
        type: 'room-audio-changed',
        roomId: 'room-1',
        track: trackOf('ana', 0, false, { id: 'PLabcdefghijkl', index: 0 }),
      })
    })
    const firstKey = result.current.track!.key
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    act(() => result.current.advanceItem(1, 'aBcDeFgHiJk'))
    expect(sent).toEqual([{ type: 'set-room-audio-item', playlistIndex: 1, videoId: 'aBcDeFgHiJk' }])

    // Virar de faixa dentro da MESMA playlist não é faixa nova: o player não
    // pode ser recriado, senão a lista recarrega do zero.
    act(() => {
      bridge.emitServerMessage({
        type: 'room-audio-changed',
        roomId: 'room-1',
        track: { ...trackOf('ana', 0, false, { id: 'PLabcdefghijkl', index: 1 }), videoId: 'aBcDeFgHiJk' },
      })
    })
    expect(result.current.track!.key).toBe(firstKey)
    expect(result.current.track!.playlistIndex).toBe(1)
  })

  it('link que não é do YouTube nem sai do cliente', () => {
    const { bridge, result } = renderRoomAudio()
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    act(() => result.current.start('https://vimeo.com/12345'))

    expect(sent).toEqual([])
    expect(result.current.error).toBe('Cole um link de vídeo do YouTube.')
  })

  it('mostra a faixa da sala em que você está e ignora a das outras', () => {
    const { bridge, result } = renderRoomAudio()

    act(() => {
      bridge.emitServerMessage({ type: 'room-audio-changed', roomId: 'room-2', track: trackOf() })
    })
    expect(result.current.track).toBeNull()

    act(() => {
      bridge.emitServerMessage({ type: 'room-audio-changed', roomId: 'room-1', track: trackOf() })
    })
    expect(result.current.track).toMatchObject({ videoId: VIDEO, startedByName: 'Bruno' })
    expect(result.current.isMine).toBe(false)
  })

  it('quem anda até a sala depois pega a posição já avançada', () => {
    vi.useFakeTimers()
    const bridge = new OfficeBridge()
    const props: Props = { roomId: null, youId: 'ana', connected: true }
    const { result, rerender } = renderHook(
      (p: Props) => useRoomAudio(bridge, p.roomId, p.youId, p.connected, p.isGuest),
      { initialProps: props },
    )

    act(() => {
      bridge.emitServerMessage({ type: 'room-audio-changed', roomId: 'room-1', track: trackOf('bruno', 30) })
    })
    act(() => {
      vi.advanceTimersByTime(12_000)
    })
    rerender({ ...props, roomId: 'room-1' })

    // originMs = instante local do segundo zero: 30s já tocados na recepção.
    expect(Math.round((Date.now() - result.current.track!.originMs) / 1000)).toBe(42)
  })

  it('welcome traz o que já estava tocando', () => {
    const { bridge, result } = renderRoomAudio()

    act(() => {
      bridge.emitServerMessage({
        type: 'welcome',
        youId: 'ana',
        occupants: [],
        roomAudio: [{ roomId: 'room-1', ...trackOf('bruno', 10) }],
      })
    })

    expect(result.current.track).toMatchObject({ videoId: VIDEO, positionSeconds: 10 })
    expect(Math.round((Date.now() - result.current.track!.originMs) / 1000)).toBe(10)
  })

  it('faixa encerrada some da sala', () => {
    const { bridge, result } = renderRoomAudio()
    act(() => {
      bridge.emitServerMessage({ type: 'room-audio-changed', roomId: 'room-1', track: trackOf() })
    })

    act(() => {
      bridge.emitServerMessage({ type: 'room-audio-changed', roomId: 'room-1', track: null })
    })

    expect(result.current.track).toBeNull()
  })

  it('reconhece a faixa como sua e libera o parar', () => {
    const { bridge, result } = renderRoomAudio()
    act(() => {
      bridge.emitServerMessage({ type: 'room-audio-changed', roomId: 'room-1', track: trackOf('ana') })
    })
    expect(result.current.isMine).toBe(true)

    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))
    act(() => result.current.stop())

    expect(sent).toEqual([{ type: 'stop-room-audio' }])
  })

  it('recusa do servidor vira mensagem em português e some ao trocar de sala', () => {
    const { bridge, result, rerender } = renderRoomAudio()

    act(() => {
      bridge.emitServerMessage({ type: 'room-audio-denied', reason: 'busy' })
    })
    expect(result.current.error).toBe('Esta sala já tem um áudio tocando.')

    rerender({ roomId: 'room-2', youId: 'ana', connected: true })
    expect(result.current.error).toBeNull()
  })

  it('pausar é de quem iniciou; ouvinte nem manda a mensagem', () => {
    const { bridge, result } = renderRoomAudio()
    act(() => {
      bridge.emitServerMessage({ type: 'room-audio-changed', roomId: 'room-1', track: trackOf('bruno') })
    })
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    act(() => result.current.setPaused(true))
    expect(sent).toEqual([])

    act(() => {
      bridge.emitServerMessage({ type: 'room-audio-changed', roomId: 'room-1', track: trackOf('ana') })
    })
    act(() => result.current.setPaused(true))
    expect(sent).toEqual([{ type: 'set-room-audio-paused', paused: true }])
  })

  it('pausar e retomar continuam a MESMA faixa, mas nova faixa muda a identidade', () => {
    const { bridge, result } = renderRoomAudio()
    act(() => {
      bridge.emitServerMessage({ type: 'room-audio-changed', roomId: 'room-1', track: trackOf('bruno', 5) })
    })
    const firstKey = result.current.track!.key

    act(() => {
      bridge.emitServerMessage({ type: 'room-audio-changed', roomId: 'room-1', track: trackOf('bruno', 12, true) })
    })
    expect(result.current.track!.key).toBe(firstKey)
    expect(result.current.track!.paused).toBe(true)

    // Outra pessoa reiniciando o mesmo vídeo é outra faixa.
    act(() => {
      bridge.emitServerMessage({ type: 'room-audio-changed', roomId: 'room-1', track: trackOf('carla', 0) })
    })
    expect(result.current.track!.key).not.toBe(firstKey)
  })

  it('faixa pausada congela a posição — originMs não anda', () => {
    vi.useFakeTimers()
    const { bridge, result } = renderRoomAudio()
    act(() => {
      bridge.emitServerMessage({ type: 'room-audio-changed', roomId: 'room-1', track: trackOf('bruno', 40, true) })
    })

    act(() => {
      vi.advanceTimersByTime(15_000)
    })

    expect(result.current.track!.paused).toBe(true)
    expect(result.current.track!.positionSeconds).toBe(40)
  })

  it('não deixa iniciar fora de sala, desconectado, como convidado ou com faixa no ar', () => {
    expect(renderRoomAudio({ roomId: null }).result.current.canStart).toBe(false)
    expect(renderRoomAudio({ connected: false }).result.current.canStart).toBe(false)
    expect(renderRoomAudio({ isGuest: true }).result.current.canStart).toBe(false)

    const { bridge, result } = renderRoomAudio()
    expect(result.current.canStart).toBe(true)
    act(() => {
      bridge.emitServerMessage({ type: 'room-audio-changed', roomId: 'room-1', track: trackOf() })
    })
    expect(result.current.canStart).toBe(false)
  })
})
