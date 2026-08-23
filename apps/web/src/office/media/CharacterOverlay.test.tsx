import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CharacterOverlay } from './CharacterOverlay'
import type { RemoteVideoTrack } from 'livekit-client'

function fakeVideoTrack(): RemoteVideoTrack {
  return { attach: vi.fn(), detach: vi.fn() } as unknown as RemoteVideoTrack
}

describe('CharacterOverlay', () => {
  it('sem posição (fora do viewport), não renderiza nada', () => {
    const { container } = render(
      <CharacterOverlay name="Ana" cameraTrack={null} screenTrack={null} position={null} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('sem câmera/tela, mostra o badge de nome com a bolinha de status (default online)', () => {
    render(
      <CharacterOverlay name="Ana" cameraTrack={null} screenTrack={null} position={{ x: 0, y: 0, zoom: 1 }} />,
    )
    const figure = screen.getByRole('figure', { name: 'Ana' })
    expect(figure).toHaveTextContent('Ana')
    expect(figure.querySelector('video')).toBeNull()
    expect(figure.querySelector('.bg-green-500')).not.toBeNull()
  })

  it('bolinha de status reflete away/brb', () => {
    const { rerender } = render(
      <CharacterOverlay name="Ana" status="away" cameraTrack={null} screenTrack={null} position={{ x: 0, y: 0, zoom: 1 }} />,
    )
    expect(screen.getByRole('figure', { name: 'Ana' }).querySelector('.bg-yellow-400')).not.toBeNull()

    rerender(
      <CharacterOverlay name="Ana" status="brb" cameraTrack={null} screenTrack={null} position={{ x: 0, y: 0, zoom: 1 }} />,
    )
    expect(screen.getByRole('figure', { name: 'Ana' }).querySelector('.bg-blue-500')).not.toBeNull()
  })

  it('com câmera e sem tela, mostra o vídeo da câmera (sem botão clicável)', () => {
    const track = fakeVideoTrack()
    render(
      <CharacterOverlay name="Ana" cameraTrack={track} screenTrack={null} position={{ x: 100, y: 200, zoom: 1 }} />,
    )
    const figure = screen.getByRole('figure', { name: 'Ana' })
    const video = figure.querySelector('video')
    expect(video).not.toBeNull()
    expect(track.attach).toHaveBeenCalledWith(video)
    expect(figure.querySelector('button')).toBeNull()
  })

  it('com tela E câmera ao mesmo tempo, a tela vence (prioridade) e o quadrado vira clicável', () => {
    const cameraTrack = fakeVideoTrack()
    const screenTrack = fakeVideoTrack()
    const onClickScreen = vi.fn()
    render(
      <CharacterOverlay
        name="Ana"
        cameraTrack={cameraTrack}
        screenTrack={screenTrack}
        position={{ x: 0, y: 0, zoom: 1 }}
        onClickScreen={onClickScreen}
      />,
    )
    const figure = screen.getByRole('figure', { name: 'Tela de Ana — clique para ver' })
    const video = figure.querySelector('video')
    expect(screenTrack.attach).toHaveBeenCalledWith(video)
    expect(cameraTrack.attach).not.toHaveBeenCalled()

    fireEvent.click(figure.querySelector('button')!)
    expect(onClickScreen).toHaveBeenCalledOnce()
  })

  it('mirrored espelha o vídeo da câmera, mas nunca o da tela', () => {
    render(
      <CharacterOverlay
        name="Você"
        cameraTrack={fakeVideoTrack()}
        screenTrack={null}
        mirrored
        position={{ x: 0, y: 0, zoom: 1 }}
      />,
    )
    expect(screen.getByRole('figure', { name: 'Você' }).querySelector('video')?.className).toContain('scale-x-[-1]')
  })

  it('tamanho do quadrado de vídeo escala com o zoom da posição', () => {
    render(
      <CharacterOverlay name="Ana" cameraTrack={fakeVideoTrack()} screenTrack={null} position={{ x: 0, y: 0, zoom: 1 }} />,
    )
    const boxZoom1 = screen.getByRole('figure', { name: 'Ana' }).querySelector('div') as HTMLElement

    render(
      <CharacterOverlay name="Bob" cameraTrack={fakeVideoTrack()} screenTrack={null} position={{ x: 0, y: 0, zoom: 2 }} />,
    )
    const boxZoom2 = screen.getByRole('figure', { name: 'Bob' }).querySelector('div') as HTMLElement

    expect(parseFloat(boxZoom2.style.width)).toBe(parseFloat(boxZoom1.style.width) * 2)
  })

  it('transição de position null pra uma posição real anexa o track (e desanexa ao sumir)', () => {
    const track = fakeVideoTrack()
    const { rerender } = render(
      <CharacterOverlay name="Ana" cameraTrack={track} screenTrack={null} position={null} />,
    )
    expect(track.attach).not.toHaveBeenCalled()

    rerender(
      <CharacterOverlay name="Ana" cameraTrack={track} screenTrack={null} position={{ x: 0, y: 0, zoom: 1 }} />,
    )
    const video = screen.getByRole('figure', { name: 'Ana' }).querySelector('video')
    expect(track.attach).toHaveBeenCalledWith(video)

    rerender(<CharacterOverlay name="Ana" cameraTrack={track} screenTrack={null} position={null} />)
    expect(track.detach).toHaveBeenCalledWith(video)
  })
})
