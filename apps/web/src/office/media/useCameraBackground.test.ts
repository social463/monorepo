import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { LocalVideoTrack } from 'livekit-client'
import { CAMERA_BACKGROUND_STORAGE_KEY } from './camera-backgrounds'
import { loadTrackProcessors } from './track-processors-loader'
import { useCameraBackground } from './useCameraBackground'

vi.mock('./track-processors-loader', () => ({ loadTrackProcessors: vi.fn() }))

const blurInstance = { kind: 'blur' }
const virtualInstance = { kind: 'virtual' }
const processorsMock = {
  BackgroundProcessor: vi.fn((options: { mode: string }) =>
    options.mode === 'background-blur' ? blurInstance : virtualInstance,
  ),
  supportsBackgroundProcessors: vi.fn(() => true),
}

function fakeTrack() {
  return {
    setProcessor: vi.fn(async () => {}),
    stopProcessor: vi.fn(async () => {}),
  } as unknown as LocalVideoTrack
}

// jsdom não tem insertable streams — os testes os declaram para simular suporte.
function enableInsertableStreams() {
  ;(window as unknown as Record<string, unknown>).MediaStreamTrackProcessor = function () {}
  ;(window as unknown as Record<string, unknown>).MediaStreamTrackGenerator = function () {}
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(loadTrackProcessors).mockResolvedValue(processorsMock as never)
  enableInsertableStreams()
})

describe('useCameraBackground', () => {
  it('começa em none sem storage e não mexe no track', () => {
    const track = fakeTrack()
    const { result } = renderHook(() => useCameraBackground(track))
    expect(result.current.background).toBe('none')
    expect(result.current.supported).toBe(true)
    // none em track recém-criado: stopProcessor é inofensivo (pode ou não ser chamado);
    // o que NÃO pode acontecer é setProcessor.
    expect(track.setProcessor).not.toHaveBeenCalled()
  })

  it('blur-leve aplica BackgroundProcessor com raio 5 e assetPaths self-host, persiste', async () => {
    const track = fakeTrack()
    const { result } = renderHook(() => useCameraBackground(track))
    act(() => result.current.setBackground('blur-leve'))
    await waitFor(() => expect(track.setProcessor).toHaveBeenCalledWith(blurInstance))
    expect(processorsMock.BackgroundProcessor).toHaveBeenCalledWith({
      mode: 'background-blur',
      blurRadius: 5,
      assetPaths: { tasksVisionFileSet: '/mediapipe-vision' },
    })
    expect(localStorage.getItem(CAMERA_BACKGROUND_STORAGE_KEY)).toBe('blur-leve')
  })

  it('blur-forte usa raio 15', async () => {
    const track = fakeTrack()
    const { result } = renderHook(() => useCameraBackground(track))
    act(() => result.current.setBackground('blur-forte'))
    await waitFor(() => expect(track.setProcessor).toHaveBeenCalled())
    expect(processorsMock.BackgroundProcessor).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'background-blur', blurRadius: 15 }),
    )
  })

  it('img:emr usa BackgroundProcessor em modo virtual-background com o src do catálogo', async () => {
    const track = fakeTrack()
    const { result } = renderHook(() => useCameraBackground(track))
    act(() => result.current.setBackground('img:emr'))
    await waitFor(() => expect(track.setProcessor).toHaveBeenCalledWith(virtualInstance))
    expect(processorsMock.BackgroundProcessor).toHaveBeenCalledWith({
      mode: 'virtual-background',
      imagePath: '/office/camera-backgrounds/emr.jpg',
      assetPaths: { tasksVisionFileSet: '/mediapipe-vision' },
    })
  })

  it('aceita background controlado para aplicar o efeito em uma track auxiliar', async () => {
    const track = fakeTrack()
    const { result, rerender } = renderHook(
      ({ background }: { background: 'none' | 'blur-leve' }) => useCameraBackground(track, background),
      { initialProps: { background: 'none' } },
    )
    expect(result.current.background).toBe('none')

    rerender({ background: 'blur-leve' })

    await waitFor(() => expect(track.setProcessor).toHaveBeenCalledWith(blurInstance))
    expect(result.current.background).toBe('blur-leve')
    expect(localStorage.getItem(CAMERA_BACKGROUND_STORAGE_KEY)).toBeNull()
  })

  it('voltar para none remove o processor', async () => {
    const track = fakeTrack()
    const { result } = renderHook(() => useCameraBackground(track))
    act(() => result.current.setBackground('blur-leve'))
    await waitFor(() => expect(track.setProcessor).toHaveBeenCalled())
    act(() => result.current.setBackground('none'))
    await waitFor(() => expect(track.stopProcessor).toHaveBeenCalled())
    expect(localStorage.getItem(CAMERA_BACKGROUND_STORAGE_KEY)).toBe('none')
  })

  it('reaplica quando o track muda (câmera religada)', async () => {
    const trackA = fakeTrack()
    const { result, rerender } = renderHook(
      ({ track }: { track: LocalVideoTrack | null }) => useCameraBackground(track),
      { initialProps: { track: trackA as LocalVideoTrack | null } },
    )
    act(() => result.current.setBackground('blur-leve'))
    await waitFor(() => expect(trackA.setProcessor).toHaveBeenCalled())

    const trackB = fakeTrack()
    rerender({ track: trackB })
    await waitFor(() => expect(trackB.setProcessor).toHaveBeenCalledWith(blurInstance))
  })

  it('track some (câmera desligada) com aplicação em voo: continuação pendente ignora o track antigo', async () => {
    // loadTrackProcessors fica pendente até o teste resolver manualmente —
    // simula o track sumir no meio do await.
    let resolveProcessors!: (value: typeof processorsMock) => void
    vi.mocked(loadTrackProcessors).mockImplementation(
      () => new Promise((resolve) => { resolveProcessors = resolve }) as never,
    )

    const trackA = fakeTrack()
    const { result, rerender } = renderHook(
      ({ track }: { track: LocalVideoTrack | null }) => useCameraBackground(track),
      { initialProps: { track: trackA as LocalVideoTrack | null } },
    )
    act(() => result.current.setBackground('blur-leve'))

    // Câmera desligada: o track vira null enquanto loadTrackProcessors ainda está em voo.
    act(() => rerender({ track: null }))

    // Resolve a promise pendente — a continuação antiga não pode aplicar nada no track descartado.
    await act(async () => {
      resolveProcessors(processorsMock)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(trackA.setProcessor).not.toHaveBeenCalled()
    expect(result.current.error).toBe(false)
  })

  it('restaura do storage e aplica quando o track chega', async () => {
    localStorage.setItem(CAMERA_BACKGROUND_STORAGE_KEY, 'img:emr')
    const { result, rerender } = renderHook(
      ({ track }: { track: LocalVideoTrack | null }) => useCameraBackground(track),
      { initialProps: { track: null as LocalVideoTrack | null } },
    )
    expect(result.current.background).toBe('img:emr')

    const track = fakeTrack()
    rerender({ track })
    await waitFor(() => expect(track.setProcessor).toHaveBeenCalledWith(virtualInstance))
  })

  it('storage inválido vira none', () => {
    localStorage.setItem(CAMERA_BACKGROUND_STORAGE_KEY, 'img:nao-existe')
    const { result } = renderHook(() => useCameraBackground(null))
    expect(result.current.background).toBe('none')
  })

  it('falha no setProcessor: error=true e volta para none (estado e storage)', async () => {
    const track = fakeTrack()
    vi.mocked(track.setProcessor).mockRejectedValue(new Error('gpu'))
    const { result } = renderHook(() => useCameraBackground(track))
    act(() => result.current.setBackground('blur-leve'))
    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.background).toBe('none')
    expect(localStorage.getItem(CAMERA_BACKGROUND_STORAGE_KEY)).toBe('none')
  })

  it('pacote reporta não suportado: supported vira false e nada é aplicado', async () => {
    processorsMock.supportsBackgroundProcessors.mockReturnValue(false)
    const track = fakeTrack()
    const { result } = renderHook(() => useCameraBackground(track))
    act(() => result.current.setBackground('blur-leve'))
    await waitFor(() => expect(result.current.supported).toBe(false))
    expect(track.setProcessor).not.toHaveBeenCalled()
  })

  it('sem insertable streams no browser: supported=false e setBackground de efeito é ignorado', () => {
    delete (window as unknown as Record<string, unknown>).MediaStreamTrackProcessor
    delete (window as unknown as Record<string, unknown>).MediaStreamTrackGenerator
    const track = fakeTrack()
    const { result } = renderHook(() => useCameraBackground(track))
    expect(result.current.supported).toBe(false)
    act(() => result.current.setBackground('blur-leve'))
    expect(result.current.background).toBe('none')
    expect(track.setProcessor).not.toHaveBeenCalled()
  })
})
