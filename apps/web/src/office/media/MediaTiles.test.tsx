import { useState, type ComponentProps } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { MediaTiles } from './MediaTiles'
import type { RemoteMedia } from './useOfficeMedia'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'

/**
 * O botão de "riscar" não mora mais dentro de `MediaTiles` (foi pra
 * MediaBar) — `MediaTiles` só REPORTA se dá pra riscar via
 * `onAnnotateStateChange`. Este harness reconstrói um botão equivalente a
 * partir desse report, pros testes abaixo continuarem exercitando o
 * clique/tecla e verificando o resultado do jeito que já faziam.
 */
function MediaTilesWithAnnotateButton(props: ComponentProps<typeof MediaTiles>) {
  const [state, setState] = useState<{ canAnnotate: boolean; annotating: boolean; toggle: () => void }>({
    canAnnotate: false,
    annotating: false,
    toggle: () => {},
  })
  return (
    <>
      <MediaTiles {...props} onAnnotateStateChange={setState} />
      {state.canAnnotate && (
        <button type="button" onClick={state.toggle}>
          {state.annotating ? 'Parar de riscar' : 'Riscar na tela'}
        </button>
      )}
    </>
  )
}

/** Track falso: só precisa responder a attach/detach, que os componentes chamam no efeito. */
function fakeVideoTrack(): RemoteVideoTrack {
  return { attach: vi.fn(), detach: vi.fn() } as unknown as RemoteVideoTrack
}

function fakeLocalVideoTrack(): LocalVideoTrack {
  return { attach: vi.fn(), detach: vi.fn() } as unknown as LocalVideoTrack
}

function remote(overrides: Partial<RemoteMedia> = {}): RemoteMedia {
  return {
    userId: 'a',
    name: 'Ana',
    audioTrack: null,
    cameraTrack: null,
    screenTrack: null,
    screenAudioTrack: null,
    micOpen: false,
    speaking: false,
    ...overrides,
  }
}

describe('MediaTiles', () => {
  it('não expandido, nada é renderizado (áudio agora vive no OfficeSessionProvider)', () => {
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    const { container } = render(<MediaTiles remotes={remotes} expanded={false} onToggleExpanded={vi.fn()} />)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(screen.queryByRole('figure')).not.toBeInTheDocument()
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('audio')).toBeNull()
  })

  it('expanded=true renderiza a grade em tela cheia com botão de recolher', () => {
    const onToggleExpanded = vi.fn()
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} />)

    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recolher câmeras' }))
    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })

  it('a grade expandida é renderizada via portal direto no document.body (evita ficar presa num ancestral com transform)', () => {
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    const { container } = render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    const region = screen.getByRole('region', { name: 'Câmeras em tela cheia' })
    expect(container.contains(region)).toBe(false)
    expect(document.body.contains(region)).toBe(true)
  })

  it('Escape recolhe quando expandido; não faz nada quando já recolhido', () => {
    const onToggleExpanded = vi.fn()
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    const { rerender } = render(<MediaTiles remotes={remotes} expanded={false} onToggleExpanded={onToggleExpanded} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onToggleExpanded).not.toHaveBeenCalled()

    rerender(<MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })

  it('auto-recolhe quando ninguém mais tem câmera/tela visível enquanto expandido', () => {
    const onToggleExpanded = vi.fn()
    const { rerender } = render(
      <MediaTiles remotes={[remote({ cameraTrack: fakeVideoTrack() })]} expanded onToggleExpanded={onToggleExpanded} />,
    )
    expect(onToggleExpanded).not.toHaveBeenCalled()

    rerender(<MediaTiles remotes={[remote()]} expanded onToggleExpanded={onToggleExpanded} />)
    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })

  it('na grade expandida, com `local` presente o próprio tile aparece primeiro e espelhado', () => {
    const localTrack = fakeLocalVideoTrack()
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    render(
      <MediaTiles
        remotes={remotes}
        local={{ track: localTrack, name: 'Você' }}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )

    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(2)
    expect(figures[0]).toHaveTextContent('Você')

    const localVideo = figures[0].querySelector('video')
    expect(localTrack.attach).toHaveBeenCalledWith(localVideo)
    expect(localVideo?.className).toContain('scale-x-[-1]')

    const remoteVideo = figures[1].querySelector('video')
    expect(remoteVideo?.className).not.toContain('scale-x-[-1]')
  })

  it('clicar num tile de câmera na grade expandida o destaca (layout de duas colunas)', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob', cameraTrack: fakeVideoTrack() }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    // Sem tela compartilhada: nasce em grid uniforme (nenhum destaque).
    expect(screen.queryByTestId('featured-tile')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Bob'))
    const featured = screen.getByTestId('featured-tile')
    expect(featured).toHaveTextContent('Bob')
  })

  it('clicar numa tela compartilhada na grade expandida a destaca', () => {
    const remotes = [remote({ screenTrack: fakeVideoTrack() })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    fireEvent.click(screen.getByText('Tela de Ana'))
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Ana')
  })

  it('grade expandida nasce com a tela compartilhada em destaque, se houver uma', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob', screenTrack: fakeVideoTrack() }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Bob')
  })

  it('quando o destaque perde toda mídia, troca pra outro tile com mídia; sem nenhum, volta pro grid uniforme', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob', cameraTrack: fakeVideoTrack() }),
    ]
    const { rerender } = render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    fireEvent.click(screen.getByText('Bob'))
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Bob')

    rerender(
      <MediaTiles
        remotes={[remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }), remote({ userId: 'b', name: 'Bob' })]}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Ana')

    rerender(
      <MediaTiles
        remotes={[remote({ userId: 'a', name: 'Ana' }), remote({ userId: 'b', name: 'Bob' })]}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('featured-tile')).not.toBeInTheDocument()
  })

  it('pin manual num avatar é permitido, e clicar num avatar sem mídia também destaca', () => {
    const remotes = [remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }), remote({ userId: 'b', name: 'Bob' })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    fireEvent.click(screen.getByText('Bob'))
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Bob')
  })

  it('o pin de destaque reseta toda vez que a grade expande de novo', () => {
    const remotes = [remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }), remote({ userId: 'b', name: 'Bob', screenTrack: fakeVideoTrack() })]
    const onToggleExpanded = vi.fn()
    const { rerender } = render(<MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} />)

    fireEvent.click(screen.getByText('Ana'))
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Ana')

    rerender(<MediaTiles remotes={remotes} expanded={false} onToggleExpanded={onToggleExpanded} />)
    rerender(<MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} />)

    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Bob')
  })

  it('destaque automático de tela compartilhada (sem clique) também recupera pra câmera quando a tela some', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob', screenTrack: fakeVideoTrack() }),
    ]
    const { rerender } = render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Bob')

    rerender(
      <MediaTiles
        remotes={[remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }), remote({ userId: 'b', name: 'Bob' })]}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Ana')
  })

  it('na grade expandida, quem não tem câmera/tela vira quadrado de avatar (iniciais)', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana Silva', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob' }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(2)
    const bobFigure = figures.find((f) => f.textContent?.includes('Bob'))!
    expect(bobFigure.querySelector('video')).toBeNull()
    expect(bobFigure.textContent).toContain('B')
  })

  it('na grade expandida, o próprio usuário sem câmera também vira quadrado de avatar', () => {
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    render(
      <MediaTiles
        remotes={remotes}
        local={{ track: null, name: 'Você' }}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )

    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(2)
    const selfFigure = figures.find((f) => f.textContent?.includes('Você'))!
    expect(selfFigure.querySelector('video')).toBeNull()
  })

  it('showAllPresent=true: grade expandida abre mesmo sem ninguém ter câmera/tela ativa (mostra avatares)', () => {
    const remotes = [remote({ userId: 'b', name: 'Bob' })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} showAllPresent />)

    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()
    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(1)
    expect(figures[0]).toHaveTextContent('Bob')
    expect(figures[0].querySelector('video')).toBeNull()
  })

  it('showAllPresent=false (default): grade expandida auto-recolhe se ninguém tem câmera/tela ativa, mesmo com gente presente', () => {
    const onToggleExpanded = vi.fn()
    const remotes = [remote({ userId: 'b', name: 'Bob' })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} />)

    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })

  it('showAllPresent=true: sem ninguém presente (nem local, nem remotos), a grade não abre', () => {
    const onToggleExpanded = vi.fn()
    render(<MediaTiles remotes={[]} expanded onToggleExpanded={onToggleExpanded} showAllPresent />)

    expect(onToggleExpanded).toHaveBeenCalledOnce()
    expect(screen.queryByRole('region', { name: 'Câmeras em tela cheia' })).not.toBeInTheDocument()
  })

  it('sem roomPanel, nenhum painel lateral aparece', () => {
    render(<MediaTiles remotes={[remote({ cameraTrack: fakeVideoTrack() })]} expanded onToggleExpanded={vi.fn()} />)
    expect(screen.queryByText('Chat da sala')).not.toBeInTheDocument()
    expect(screen.queryByText(/Pessoas na sala/)).not.toBeInTheDocument()
  })

  it('roomPanel="chat" renderiza o RoomChatPanel ao lado da área central', () => {
    render(
      <MediaTiles
        remotes={[remote({ cameraTrack: fakeVideoTrack() })]}
        expanded
        onToggleExpanded={vi.fn()}
        roomPanel="chat"
        roomChatMessages={[{ userId: 'ana', name: 'Ana', text: 'oi', sentAt: '2026-01-01T00:00:00.000Z' }]}
        canSendRoomChatMessage
        onSendRoomChatMessage={vi.fn(() => true)}
      />,
    )
    expect(screen.getByText('Chat da sala')).toBeInTheDocument()
    expect(screen.getByText('oi')).toBeInTheDocument()
    expect(screen.queryByText(/Pessoas na sala/)).not.toBeInTheDocument()
  })

  it('roomPanel="people" renderiza o RoomPeoplePanel ao lado da área central', () => {
    render(
      <MediaTiles
        remotes={[remote({ cameraTrack: fakeVideoTrack() })]}
        expanded
        onToggleExpanded={vi.fn()}
        roomPanel="people"
        roomOccupants={[
          { userId: 'ana', name: 'Ana Silva', x: 1, y: 1, dir: 'down', avatarSeed: null, avatarOptions: null },
        ]}
      />,
    )
    expect(screen.getByText('Pessoas na sala (1)')).toBeInTheDocument()
    expect(screen.getByText('Ana Silva')).toBeInTheDocument()
    expect(screen.queryByText('Chat da sala')).not.toBeInTheDocument()
  })

  it('clicar em fechar no painel lateral chama onCloseRoomPanel', () => {
    const onCloseRoomPanel = vi.fn()
    render(
      <MediaTiles
        remotes={[remote({ cameraTrack: fakeVideoTrack() })]}
        expanded
        onToggleExpanded={vi.fn()}
        roomPanel="chat"
        onCloseRoomPanel={onCloseRoomPanel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Fechar painel de chat da sala' }))
    expect(onCloseRoomPanel).toHaveBeenCalledOnce()
  })

  it('grid uniforme com 1 tile usa 1 coluna e 1 linha (ocupa o espaço todo)', () => {
    render(<MediaTiles remotes={[remote({ cameraTrack: fakeVideoTrack() })]} expanded onToggleExpanded={vi.fn()} />)
    const grid = screen.getByTestId('uniform-grid')
    expect(grid).toHaveStyle({
      gridTemplateColumns: 'repeat(1, minmax(0, 1fr))',
      gridTemplateRows: 'repeat(1, minmax(0, 1fr))',
    })
  })

  it('grid uniforme com 2 tiles divide em 2 colunas, 1 linha', () => {
    const remotes = [
      remote({ userId: 'a', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', cameraTrack: fakeVideoTrack() }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)
    const grid = screen.getByTestId('uniform-grid')
    expect(grid).toHaveStyle({
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gridTemplateRows: 'repeat(1, minmax(0, 1fr))',
    })
  })

  it('grid uniforme com 3 tiles usa 2 colunas, 2 linhas', () => {
    const remotes = [
      remote({ userId: 'a', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'c', cameraTrack: fakeVideoTrack() }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)
    const grid = screen.getByTestId('uniform-grid')
    expect(grid).toHaveStyle({
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
    })
  })

  it('grid uniforme com 4 tiles usa 2 colunas, 2 linhas', () => {
    const remotes = ['a', 'b', 'c', 'd'].map((id) => remote({ userId: id, cameraTrack: fakeVideoTrack() }))
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)
    const grid = screen.getByTestId('uniform-grid')
    expect(grid).toHaveStyle({
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
    })
  })

  it('grid uniforme não usa mais auto-fit/minmax fixo nem overflow-y-auto (nunca deve rolar)', () => {
    render(<MediaTiles remotes={[remote({ cameraTrack: fakeVideoTrack() })]} expanded onToggleExpanded={vi.fn()} />)
    const grid = screen.getByTestId('uniform-grid')
    expect(grid.className).not.toContain('overflow-y-auto')
    expect(grid.className).not.toContain('auto-fit')
  })

  it('grid uniforme pagina a partir de 10 participantes', () => {
    const remotes = Array.from({ length: 10 }, (_, index) =>
      remote({ userId: `u${index}`, name: `Pessoa ${index + 1}`, cameraTrack: fakeVideoTrack() }),
    )
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    const grid = screen.getByTestId('uniform-grid')
    expect(within(grid).getAllByRole('figure')).toHaveLength(9)
    expect(screen.getByText('1-9 de 10')).toBeInTheDocument()
    expect(screen.queryByText('Pessoa 10')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Próxima página de câmeras' }))

    expect(within(grid).getAllByRole('figure')).toHaveLength(1)
    expect(screen.getByText('10-10 de 10')).toBeInTheDocument()
    expect(screen.getByText('Pessoa 10')).toBeInTheDocument()
  })

  it('modo de destaque: participantes têm rolagem própria em vez de dividir altura infinitamente', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', screenTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob', cameraTrack: fakeVideoTrack() }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)
    const sidebar = screen.getByTestId('featured-sidebar')
    expect(sidebar.className).toContain('overflow-x-auto')
    expect(sidebar.className).toContain('lg:overflow-y-auto')
  })

  it('com local.screenTrack, aparece um tile extra "Tela de <nome>" além do tile de câmera/avatar do próprio usuário', () => {
    const localCam = fakeLocalVideoTrack()
    const localScreen = fakeLocalVideoTrack()
    render(
      <MediaTiles
        remotes={[]}
        local={{ track: localCam, screenTrack: localScreen, name: 'Você' }}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )

    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(2)
    expect(figures.some((f) => f.textContent === 'Tela de Você')).toBe(true)
  })

  it('sem câmera local mas com tela local, mantém o tile de identidade além do tile de tela', () => {
    const localScreen = fakeLocalVideoTrack()
    render(
      <MediaTiles
        remotes={[]}
        local={{ track: null, screenTrack: localScreen, name: 'Você' }}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )
    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(2)
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Você')
    const identityFigure = figures.find((f) => !f.textContent?.includes('Tela de'))
    expect(identityFigure).not.toBeUndefined()
    expect(identityFigure!).toHaveTextContent('Você')
    expect(identityFigure!.querySelector('.rounded-full')).not.toBeNull()
  })

  it('destaque com múltiplas telas ativas segue screenShareOrder (quem começou primeiro), não a ordem do array', () => {
    const remotes = [
      remote({ userId: 'ana', name: 'Ana', screenTrack: fakeVideoTrack() }),
      remote({ userId: 'bruno', name: 'Bruno', screenTrack: fakeVideoTrack() }),
    ]
    // Bruno aparece primeiro no array, mas Ana começou a compartilhar antes.
    const screenShareOrder = new Map([
      ['bruno', 1],
      ['ana', 0],
    ])
    render(
      <MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} screenShareOrder={screenShareOrder} />,
    )
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Ana')
  })

  it('grid uniforme: avatar circular, badge de mic e ondas só aparecem quem está falando', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', micOpen: true, speaking: true }),
      remote({ userId: 'b', name: 'Bob', micOpen: false, speaking: false }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} showAllPresent />)

    const grid = screen.getByTestId('uniform-grid')
    const figures = within(grid).getAllByRole('figure')
    const anaFigure = figures.find((f) => f.textContent?.includes('Ana'))!
    const bobFigure = figures.find((f) => f.textContent?.includes('Bob'))!

    // Círculo (não o quadrado esticado antigo) em ambos os tiles do grid uniforme.
    expect(anaFigure.querySelector('.rounded-full')).not.toBeNull()
    expect(bobFigure.querySelector('.rounded-full')).not.toBeNull()

    // Badge de mic reflete o estado persistente, independente de falar.
    expect(anaFigure).toHaveTextContent('mic')
    expect(bobFigure).toHaveTextContent('mic_off')

    // Ondas só na Ana (speaking=true).
    expect(anaFigure.querySelectorAll('.speaking-wave')).toHaveLength(3)
    expect(bobFigure.querySelectorAll('.speaking-wave')).toHaveLength(0)
  })

  it('spotlight/sidebar usam o mesmo formato circular com feedback de voz do grid uniforme', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', screenTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob', micOpen: true, speaking: true }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    const figures = screen.getAllByRole('figure')
    const bobFigure = figures.find((f) => f.textContent?.includes('Bob'))!
    expect(bobFigure.querySelector('.rounded-full')).not.toBeNull()
    expect(bobFigure.querySelectorAll('.speaking-wave')).toHaveLength(3)
  })

  it('quem compartilha a tela continua com o próprio tile de identidade visível (não é substituído pela tela)', () => {
    const remotes = [remote({ userId: 'a', name: 'Ana', screenTrack: fakeVideoTrack() })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    const featured = screen.getByTestId('featured-tile')
    expect(featured).toHaveTextContent('Tela de Ana')

    const figures = screen.getAllByRole('figure')
    const anaIdentityFigure = figures.find((f) => !f.textContent?.includes('Tela de'))
    expect(anaIdentityFigure).not.toBeUndefined()
    expect(anaIdentityFigure!).toHaveTextContent('Ana')
    expect(anaIdentityFigure!.querySelector('.rounded-full')).not.toBeNull()
  })

  it('com tela em destaque, participantes ficam em faixa/coluna rolável com tiles estáveis', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', screenTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bruno', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'c', name: 'Carla', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'd', name: 'Diego', cameraTrack: fakeVideoTrack() }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    const sidebar = screen.getByTestId('featured-sidebar')
    expect(sidebar.className).toContain('overflow-x-auto')
    expect(sidebar.className).toContain('lg:overflow-y-auto')

    const brunoTile = within(sidebar).getByText('Bruno').closest('figure')
    expect(brunoTile?.className).toContain('h-32')
    expect(brunoTile?.className).toContain('shrink-0')
    expect(brunoTile?.className).not.toContain('flex-1')
  })

  it('com tela em destaque, pagina participantes laterais a partir de 7 tiles', () => {
    const remotes = [
      remote({ userId: 'screen', name: 'Apresentadora', screenTrack: fakeVideoTrack() }),
      ...Array.from({ length: 7 }, (_, index) =>
        remote({ userId: `u${index}`, name: `Pessoa ${index + 1}`, cameraTrack: fakeVideoTrack() }),
      ),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    const sidebar = screen.getByTestId('featured-sidebar')
    expect(within(sidebar).getAllByRole('figure')).toHaveLength(6)
    expect(screen.getByText('1-6 de 8')).toBeInTheDocument()
    expect(screen.queryByText('Pessoa 7')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Próxima página de participantes' }))

    expect(within(sidebar).getAllByRole('figure')).toHaveLength(2)
    expect(screen.getByText('7-8 de 8')).toBeInTheDocument()
    expect(screen.getByText('Pessoa 7')).toBeInTheDocument()
  })

  it('destaque local compartilhando tela sem câmera não some da grade', () => {
    render(
      <MediaTiles
        remotes={[]}
        local={{ track: null, screenTrack: fakeLocalVideoTrack(), name: 'Você' }}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )

    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Você')
    const figures = screen.getAllByRole('figure')
    const identityFigure = figures.find((f) => !f.textContent?.includes('Tela de'))
    expect(identityFigure).not.toBeUndefined()
    expect(identityFigure!).toHaveTextContent('Você')
  })

  it('tile de câmera mostra o selo de microfone aberto/mudo, igual ao tile de avatar', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack(), micOpen: true }),
      remote({ userId: 'b', name: 'Bob', cameraTrack: fakeVideoTrack(), micOpen: false }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    expect(screen.getByLabelText('Microfone aberto')).toBeInTheDocument()
    expect(screen.getByLabelText('Microfone mudo')).toBeInTheDocument()
  })

  it('tile de câmera e de avatar reservam espaço pra legenda do mesmo jeito (mesmo tamanho de caixa na grade)', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob' }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    const grid = screen.getByTestId('uniform-grid')
    const wrappers = within(grid)
      .getAllByRole('figure')
      .map((figure) => figure.firstElementChild as HTMLElement)

    expect(wrappers).toHaveLength(2)
    for (const wrapper of wrappers) {
      expect(wrapper).toHaveClass('flex-1', 'min-h-0')
      expect(wrapper).not.toHaveClass('h-full')
    }
  })

  it('tile de câmera de quem está falando pulsa o selo de microfone', () => {
    const remotes = [remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack(), micOpen: true, speaking: true })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    expect(screen.getByLabelText('Microfone aberto')).toHaveClass('mic-speaking')
  })

  it('mostra slider de volume nos tiles remotos da grade e dispara alteração por usuário', () => {
    const setUserVolume = vi.fn()
    render(
      <MediaTiles
        remotes={[remote({ userId: 'ana', name: 'Ana', cameraTrack: fakeVideoTrack() })]}
        expanded
        onToggleExpanded={vi.fn()}
        remoteUserVolumes={{
          getUserVolume: () => 60,
          setUserVolume,
        }}
      />,
    )

    const slider = screen.getByRole('slider', { name: 'Volume de Ana' })
    expect(slider).toHaveValue('60')

    fireEvent.change(slider, { target: { value: '20' } })
    expect(setUserVolume).toHaveBeenCalledWith('ana', 20)
  })

  it('não mostra slider de volume no tile local', () => {
    render(
      <MediaTiles
        remotes={[]}
        local={{ track: fakeLocalVideoTrack(), name: 'Você' }}
        expanded
        onToggleExpanded={vi.fn()}
        showAllPresent
        youId="ana"
        remoteUserVolumes={{
          getUserVolume: () => 60,
          setUserVolume: vi.fn(),
        }}
      />,
    )

    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  function fakeAnnotations() {
    return { strokesFor: () => [], beginStroke: vi.fn(), extendStroke: vi.fn(), endStroke: vi.fn() }
  }

  it('sem tela compartilhada em destaque, não oferece riscar', () => {
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    render(<MediaTilesWithAnnotateButton remotes={remotes} expanded onToggleExpanded={vi.fn()} annotations={fakeAnnotations()} />)

    expect(screen.queryByRole('button', { name: 'Riscar na tela' })).not.toBeInTheDocument()
  })

  it('com tela em destaque, o botão liga o overlay de anotação', () => {
    const remotes = [remote({ screenTrack: fakeVideoTrack() })]
    const { container } = render(
      <MediaTilesWithAnnotateButton remotes={remotes} expanded onToggleExpanded={vi.fn()} annotations={fakeAnnotations()} />,
    )

    expect(container.querySelector('[data-testid="annotation-canvas"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Riscar na tela' }))
    expect(document.querySelector('[data-testid="annotation-canvas"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Parar de riscar' })).toBeInTheDocument()
  })

  it('a tecla P alterna o modo de riscar', () => {
    const remotes = [remote({ screenTrack: fakeVideoTrack() })]
    render(<MediaTilesWithAnnotateButton remotes={remotes} expanded onToggleExpanded={vi.fn()} annotations={fakeAnnotations()} />)

    fireEvent.keyDown(window, { key: 'p' })
    expect(screen.getByRole('button', { name: 'Parar de riscar' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'p' })
    expect(screen.getByRole('button', { name: 'Riscar na tela' })).toBeInTheDocument()
  })

  it('Escape com o modo ligado sai do modo antes de fechar a grade', () => {
    const onToggleExpanded = vi.fn()
    const remotes = [remote({ screenTrack: fakeVideoTrack() })]
    render(
      <MediaTilesWithAnnotateButton remotes={remotes} expanded onToggleExpanded={onToggleExpanded} annotations={fakeAnnotations()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Riscar na tela' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onToggleExpanded).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Riscar na tela' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })

  it('trocar o destaque de uma tela pra outra desliga o modo de riscar', () => {
    const remotes = [
      remote({ userId: 'ana', name: 'Ana', screenTrack: fakeVideoTrack() }),
      remote({ userId: 'bruno', name: 'Bruno', screenTrack: fakeVideoTrack() }),
    ]
    const screenShareOrder = new Map([
      ['ana', 0],
      ['bruno', 1],
    ])
    render(
      <MediaTilesWithAnnotateButton
        remotes={remotes}
        expanded
        onToggleExpanded={vi.fn()}
        screenShareOrder={screenShareOrder}
        annotations={fakeAnnotations()}
      />,
    )

    // Tela da Ana em destaque (começou primeiro); liga o modo de riscar nela.
    fireEvent.click(screen.getByRole('button', { name: 'Riscar na tela' }))
    expect(screen.getByRole('button', { name: 'Parar de riscar' })).toBeInTheDocument()

    // Troca o destaque pra tela do Bruno clicando no tile dela na barra lateral.
    const sidebar = screen.getByTestId('featured-sidebar')
    fireEvent.click(within(sidebar).getByText('Tela de Bruno'))

    expect(screen.getByRole('button', { name: 'Riscar na tela' })).toBeInTheDocument()
  })

  it('sem a prop annotations, nada de riscar aparece (grade usada fora da sessão do escritório)', () => {
    const remotes = [remote({ screenTrack: fakeVideoTrack() })]
    render(<MediaTilesWithAnnotateButton remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Riscar na tela' })).not.toBeInTheDocument()
  })
  /*
   * Tela cheia de verdade (Fullscreen API). O jsdom não implementa nada da API,
   * então o suporte é montado à mão: é justamente o que o componente checa pra
   * decidir se mostra o botão.
   */
  describe('tela cheia (Fullscreen API)', () => {
    function stubFullscreen() {
      // Guarda o `this` de cada chamada: é ele que diz QUAL elemento pediu
      // tela cheia, que é o ponto do teste.
      const alvos: Element[] = []
      const requestFullscreen = vi.fn(function (this: Element) {
        alvos.push(this)
        return Promise.resolve()
      })
      const exitFullscreen = vi.fn(() => Promise.resolve())
      Object.defineProperty(Element.prototype, 'requestFullscreen', {
        value: requestFullscreen,
        configurable: true,
        writable: true,
      })
      Object.defineProperty(document, 'exitFullscreen', {
        value: exitFullscreen,
        configurable: true,
        writable: true,
      })
      setFullscreenElement(null)
      return { requestFullscreen, exitFullscreen, alvos }
    }

    /** Simula o navegador entrando/saindo de tela cheia, evento inclusive. */
    function setFullscreenElement(element: Element | null) {
      Object.defineProperty(document, 'fullscreenElement', {
        value: element,
        configurable: true,
        writable: true,
      })
      // `act` porque quem escuta o evento é um hook: sem isso o React não
      // repinta antes da asserção e o botão ainda estaria no rótulo antigo.
      act(() => {
        document.dispatchEvent(new Event('fullscreenchange'))
      })
    }

    afterEach(() => {
      Reflect.deleteProperty(Element.prototype, 'requestFullscreen')
      Reflect.deleteProperty(document, 'exitFullscreen')
      Reflect.deleteProperty(document, 'fullscreenElement')
    })

    it('a grade inteira vai a tela cheia pelo documento — senão a MediaBar, que é irmã do overlay, sumiria', () => {
      const { requestFullscreen, alvos } = stubFullscreen()
      const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
      render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: 'Ver a grade em tela cheia' }))

      expect(requestFullscreen).toHaveBeenCalledOnce()
      expect(alvos[0]).toBe(document.documentElement)
    })

    it('em tela cheia o mesmo botão vira "sair" e chama exitFullscreen', () => {
      const { exitFullscreen } = stubFullscreen()
      const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
      render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

      setFullscreenElement(document.documentElement)
      fireEvent.click(screen.getByRole('button', { name: 'Sair da tela cheia' }))

      expect(exitFullscreen).toHaveBeenCalledOnce()
    })

    it('o botão de recolher a grade continua separado do de tela cheia', () => {
      stubFullscreen()
      const onToggleExpanded = vi.fn()
      const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
      render(<MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} />)

      fireEvent.click(screen.getByRole('button', { name: 'Recolher câmeras' }))
      expect(onToggleExpanded).toHaveBeenCalledOnce()
    })

    it('Escape em tela cheia só sai da tela cheia — não recolhe a grade junto', () => {
      stubFullscreen()
      const onToggleExpanded = vi.fn()
      const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
      render(<MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} />)

      setFullscreenElement(document.documentElement)
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onToggleExpanded).not.toHaveBeenCalled()

      // Fora da tela cheia, Esc volta a recolher, como sempre fez.
      setFullscreenElement(null)
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onToggleExpanded).toHaveBeenCalledOnce()
    })

    it('navegador sem Fullscreen API (iOS): nenhum botão de tela cheia é oferecido', () => {
      const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
      render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

      expect(screen.queryByRole('button', { name: /tela cheia/i })).not.toBeInTheDocument()
    })
  })
})
