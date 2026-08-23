import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { YouTubeApi, YouTubePlayer } from './youtube-iframe-loader'
import { RoomAudioPlayer } from './RoomAudioPlayer'
import type { RoomAudioTrack } from './useRoomAudio'

/** Última instância criada pelo componente + os callbacks que ele registrou. */
let created: {
  player: YouTubePlayer
  videoId: string
  playerVars: Record<string, unknown>
  events: {
    onReady?: (event: { target: YouTubePlayer }) => void
    onStateChange?: (event: { data: number; target: YouTubePlayer }) => void
    onError?: (event: { data: number }) => void
  }
} | null = null

const PLAYER_STATE = { ENDED: 0, PLAYING: 1, UNSTARTED: -1, PAUSED: 2 }

function fakeApi(): YouTubeApi {
  return {
    PlayerState: PLAYER_STATE,
    Player: function (this: unknown, _element: HTMLElement, options: any) {
      const player: YouTubePlayer = {
        playVideo: vi.fn(),
        pauseVideo: vi.fn(),
        seekTo: vi.fn(),
        setVolume: vi.fn(),
        mute: vi.fn(),
        unMute: vi.fn(),
        getPlayerState: vi.fn(() => PLAYER_STATE.PLAYING),
        getVideoData: vi.fn(() => ({ title: 'Faixa de teste', video_id: 'dQw4w9WgXcQ' })),
        getPlaylistIndex: vi.fn(() => 0),
        getPlaylist: vi.fn(() => null),
        playVideoAt: vi.fn(),
        destroy: vi.fn(),
      }
      created = { player, videoId: options.videoId, playerVars: options.playerVars ?? {}, events: options.events ?? {} }
      return player
    } as unknown as YouTubeApi['Player'],
  }
}

vi.mock('./youtube-iframe-loader', () => ({
  loadYouTubeApi: () => Promise.resolve(fakeApi()),
}))

const track: RoomAudioTrack = {
  videoId: 'dQw4w9WgXcQ',
  startedByUserId: 'bruno',
  startedByName: 'Bruno',
  positionSeconds: 42,
  paused: false,
  playlistId: null,
  playlistIndex: 0,
  isMine: false,
  key: 'dQw4w9WgXcQ:bruno:1000',
  // Segundo zero 42s atrás: a sala está nos 42s.
  originMs: Date.now() - 42_000,
}

/** Espera o efeito assíncrono que cria o player e dispara o `onReady`. */
async function mountAndReady(props: Partial<Parameters<typeof RoomAudioPlayer>[0]> = {}) {
  const onStop = vi.fn()
  const onSetPaused = vi.fn()
  const onAdvanceItem = vi.fn()
  const view = render(
    <RoomAudioPlayer
      track={track}
      onStop={onStop}
      onSetPaused={onSetPaused}
      onAdvanceItem={onAdvanceItem}
      {...props}
    />,
  )
  await act(async () => {})
  act(() => created?.events.onReady?.({ target: created.player }))
  return { onStop, onSetPaused, onAdvanceItem, ...view }
}

beforeEach(() => {
  created = null
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RoomAudioPlayer', () => {
  it('entra no ponto em que a sala está e começa a tocar', async () => {
    await mountAndReady()

    expect(created?.videoId).toBe('dQw4w9WgXcQ')
    expect(vi.mocked(created!.player.seekTo).mock.calls[0]![0]).toBeCloseTo(42, 0)
    expect(created?.player.playVideo).toHaveBeenCalled()
  })

  it('aplica o volume guardado e o mudo do ouvinte', async () => {
    localStorage.setItem('office:room-audio-volume', JSON.stringify({ volume: 30, muted: false }))
    await mountAndReady()

    expect(created?.player.setVolume).toHaveBeenCalledWith(30)

    await userEvent.click(screen.getByRole('button', { name: 'Silenciar áudio da sala' }))
    expect(created?.player.setVolume).toHaveBeenLastCalledWith(0)
  })

  it('mostra quem está tocando e o título do vídeo', async () => {
    await mountAndReady()

    expect(screen.getByText(/Bruno/)).toBeInTheDocument()
    expect(await screen.findByText('Faixa de teste')).toBeInTheDocument()
  })

  it('só quem iniciou vê o botão de parar', async () => {
    await mountAndReady()
    expect(screen.queryByRole('button', { name: 'Parar áudio' })).not.toBeInTheDocument()

    const { onStop } = await mountAndReady({ track: { ...track, isMine: true, startedByUserId: 'ana' } })
    await userEvent.click(screen.getByRole('button', { name: 'Parar áudio' }))
    expect(onStop).toHaveBeenCalled()
  })

  it('o fim do vídeo encerra a faixa, mas só pelo lado de quem iniciou', async () => {
    const alheia = await mountAndReady()
    act(() => created?.events.onStateChange?.({ data: PLAYER_STATE.ENDED, target: created.player }))
    expect(alheia.onStop).not.toHaveBeenCalled()

    const minha = await mountAndReady({ track: { ...track, isMine: true } })
    act(() => created?.events.onStateChange?.({ data: PLAYER_STATE.ENDED, target: created.player }))
    expect(minha.onStop).toHaveBeenCalled()
  })

  it('explica o vídeo que não pode ser tocado fora do YouTube', async () => {
    const { onStop } = await mountAndReady()

    act(() => created?.events.onError?.({ data: 150 }))

    expect(screen.getByText('Este vídeo não permite reprodução fora do YouTube.')).toBeInTheDocument()
    // Quem só ouve não encerra a faixa da sala — o erro pode ser só dele.
    expect(onStop).not.toHaveBeenCalled()
  })

  it('vídeo que não abre encerra a faixa pelo lado de quem iniciou', async () => {
    const { onStop } = await mountAndReady({ track: { ...track, isMine: true } })

    act(() => created?.events.onError?.({ data: 101 }))

    // Sem isso a sala fica com um player mudo e ninguém mais toca nada (`busy`).
    expect(onStop).toHaveBeenCalled()
  })

  it('erro num item de playlist não encerra a lista inteira', async () => {
    const { onStop } = await mountAndReady({
      track: { ...track, isMine: true, playlistId: 'PLabc123456789', playlistIndex: 2 },
    })

    act(() => created?.events.onError?.({ data: 101 }))

    expect(onStop).not.toHaveBeenCalled()
  })

  it('fora do escritório sobe acima da janelinha do escritório em miniatura', async () => {
    const { container, rerender } = await mountAndReady()
    const panel = () => container.firstElementChild as HTMLElement

    // Na página do escritório, a altura livra a MediaBar.
    expect(panel().className).toContain('bottom-28')

    rerender(
      <RoomAudioPlayer
        track={track}
        onStop={vi.fn()}
        onSetPaused={vi.fn()}
        onAdvanceItem={vi.fn()}
        outsideOffice
      />,
    )

    expect(panel().className).toContain('bottom-[17.5rem]')
    expect(panel().className).not.toContain('bottom-28')
  })

  it('oferece um clique quando o navegador bloqueia o autoplay', async () => {
    vi.useFakeTimers()
    const onStop = vi.fn()
    render(<RoomAudioPlayer track={track} onStop={onStop} onSetPaused={vi.fn()} onAdvanceItem={vi.fn()} />)
    await act(async () => {})
    act(() => created?.events.onReady?.({ target: created.player }))
    vi.mocked(created!.player.getPlayerState).mockReturnValue(PLAYER_STATE.UNSTARTED)

    act(() => {
      vi.advanceTimersByTime(1500)
    })

    const button = screen.getByRole('button', { name: 'Clique para ouvir' })
    act(() => button.click())
    expect(created?.player.playVideo).toHaveBeenCalledTimes(2)
  })

  it('ouvinte não consegue pausar: o player volta a tocar no ponto da sala', async () => {
    await mountAndReady()
    vi.mocked(created!.player.seekTo).mockClear()
    vi.mocked(created!.player.playVideo).mockClear()

    // Clique no iframe, tecla de mídia do sistema, o que for: o servidor não
    // mandou pausar, então isso é desfeito.
    act(() => created?.events.onStateChange?.({ data: PLAYER_STATE.PAUSED, target: created.player }))

    expect(vi.mocked(created!.player.seekTo).mock.calls[0]![0]).toBeCloseTo(42, 0)
    expect(created?.player.playVideo).toHaveBeenCalledOnce()
  })

  it('o iframe não recebe clique — o controle é de quem iniciou', async () => {
    await mountAndReady()

    const frame = screen.getByTestId('room-audio-frame').firstElementChild
    expect(frame).toHaveClass('pointer-events-none')
  })

  it('pausa vinda do servidor pausa de verdade, e não é desfeita', async () => {
    const paused = { ...track, paused: true, positionSeconds: 42 }
    await mountAndReady({ track: paused })

    expect(created?.player.pauseVideo).toHaveBeenCalled()

    vi.mocked(created!.player.playVideo).mockClear()
    act(() => created?.events.onStateChange?.({ data: PLAYER_STATE.PAUSED, target: created.player }))
    expect(created?.player.playVideo).not.toHaveBeenCalled()
  })

  it('retomar ressincroniza no ponto da sala, sem recriar o player', async () => {
    const paused = { ...track, paused: true, positionSeconds: 42 }
    const { rerender } = await mountAndReady({ track: paused })
    const playerBefore = created!.player
    vi.mocked(created!.player.seekTo).mockClear()

    // Servidor retoma: a faixa volta do MESMO ponto (originMs recalculado).
    rerender(
      <RoomAudioPlayer
        track={{ ...paused, paused: false, originMs: Date.now() - 42_000 }}
        onStop={vi.fn()}
        onSetPaused={vi.fn()}
        onAdvanceItem={vi.fn()}
      />,
    )

    expect(created!.player).toBe(playerBefore) // mesma instância: o vídeo não recarregou
    expect(vi.mocked(created!.player.seekTo).mock.calls[0]![0]).toBeCloseTo(42, 0)
    expect(created?.player.playVideo).toHaveBeenCalled()
  })

  it('só quem iniciou vê o botão de pausar', async () => {
    await mountAndReady()
    expect(screen.queryByRole('button', { name: 'Pausar áudio' })).not.toBeInTheDocument()

    const { onSetPaused } = await mountAndReady({ track: { ...track, isMine: true } })
    await userEvent.click(screen.getByRole('button', { name: 'Pausar áudio' }))
    expect(onSetPaused).toHaveBeenCalledWith(true)
  })

  it('faixa pausada avisa quem está ouvindo e oferece retomar ao dono', async () => {
    await mountAndReady({ track: { ...track, paused: true, isMine: true } })

    expect(screen.getByText(/pausou o áudio/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retomar áudio' })).toBeInTheDocument()
  })

  describe('playlist', () => {
    const playlistTrack: RoomAudioTrack = { ...track, playlistId: 'PLabcdefghijkl', playlistIndex: 2 }

    it('carrega a lista inteira e entra no item em que a sala está', async () => {
      await mountAndReady({ track: playlistTrack })

      expect(created?.playerVars).toMatchObject({ list: 'PLabcdefghijkl', listType: 'playlist', index: 2 })
    })

    it('quem iniciou avisa a virada de faixa; ouvinte não avisa nada', async () => {
      const minha = await mountAndReady({ track: { ...playlistTrack, isMine: true } })
      vi.mocked(created!.player.getPlaylistIndex!).mockReturnValue(3)
      vi.mocked(created!.player.getVideoData!).mockReturnValue({ title: 'Próxima', video_id: 'aBcDeFgHiJk' })

      act(() => created?.events.onStateChange?.({ data: PLAYER_STATE.PLAYING, target: created.player }))
      expect(minha.onAdvanceItem).toHaveBeenCalledWith(3, 'aBcDeFgHiJk')

      const alheia = await mountAndReady({ track: playlistTrack })
      vi.mocked(created!.player.getPlaylistIndex!).mockReturnValue(3)
      act(() => created?.events.onStateChange?.({ data: PLAYER_STATE.PLAYING, target: created.player }))
      expect(alheia.onAdvanceItem).not.toHaveBeenCalled()
    })

    it('ouvinte segue o item que o servidor mandou', async () => {
      const { rerender } = await mountAndReady({ track: playlistTrack })
      vi.mocked(created!.player.getPlaylistIndex!).mockReturnValue(2)

      rerender(
        <RoomAudioPlayer
          track={{ ...playlistTrack, playlistIndex: 3, videoId: 'aBcDeFgHiJk' }}
          onStop={vi.fn()}
          onSetPaused={vi.fn()}
          onAdvanceItem={vi.fn()}
        />,
      )

      expect(created?.player.playVideoAt).toHaveBeenCalledWith(3)
    })

    it('fim de item no meio da lista não encerra a faixa; fim do último encerra', async () => {
      const meio = await mountAndReady({ track: { ...playlistTrack, isMine: true } })
      vi.mocked(created!.player.getPlaylist!).mockReturnValue(['a', 'b', 'c', 'd'])
      vi.mocked(created!.player.getPlaylistIndex!).mockReturnValue(2)

      act(() => created?.events.onStateChange?.({ data: PLAYER_STATE.ENDED, target: created.player }))
      expect(meio.onStop).not.toHaveBeenCalled()

      const fim = await mountAndReady({ track: { ...playlistTrack, isMine: true } })
      vi.mocked(created!.player.getPlaylist!).mockReturnValue(['a', 'b', 'c', 'd'])
      vi.mocked(created!.player.getPlaylistIndex!).mockReturnValue(3)

      act(() => created?.events.onStateChange?.({ data: PLAYER_STATE.ENDED, target: created.player }))
      expect(fim.onStop).toHaveBeenCalled()
    })
  })

  it('recolhe e expande, lembrando da escolha', async () => {
    await mountAndReady()

    await userEvent.click(screen.getByRole('button', { name: 'Recolher player' }))
    expect(screen.getByTestId('room-audio-frame')).toHaveAttribute('data-collapsed', 'true')
    expect(screen.getByRole('button', { name: 'Expandir player' })).toBeInTheDocument()

    // Remonta: a preferência sobrevive.
    await mountAndReady()
    expect(screen.getAllByRole('button', { name: 'Expandir player' }).length).toBeGreaterThan(0)
  })
})
