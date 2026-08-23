import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRef } from 'react'
import { render, fireEvent, act } from '@testing-library/react'
import { OFFICE_ANNOTATION_STROKE_TTL_MS } from '@legends/shared'
import { AnnotationCanvas } from './AnnotationCanvas'
import type { AnnotationStroke, ScreenAnnotationsState } from './useScreenAnnotations'

function fakeAnnotations(): ScreenAnnotationsState & {
  beginStroke: ReturnType<typeof vi.fn>
  extendStroke: ReturnType<typeof vi.fn>
  endStroke: ReturnType<typeof vi.fn>
} {
  return {
    strokesFor: () => [],
    beginStroke: vi.fn(),
    extendStroke: vi.fn(),
    endStroke: vi.fn(),
  }
}

/**
 * jsdom não tem canvas 2d nem layout: o componente só precisa não explodir.
 * O mock cobre tudo que o laço de rAF chama — inclusive as atribuições de
 * propriedade (lineCap/lineJoin/lineWidth/strokeStyle/globalAlpha), que
 * acontecem a cada frame mesmo sem nenhum traço para desenhar.
 */
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setTransform: vi.fn(),
    lineCap: 'butt',
    lineJoin: 'miter',
    lineWidth: 1,
    strokeStyle: '#000000',
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 200,
    height: 100,
    right: 200,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

// Cada teste do laço de rAF espiona window.requestAnimationFrame,
// HTMLElement.prototype.clientWidth/clientHeight e HTMLVideoElement.prototype
// videoWidth/videoHeight — sem restaurar, esses spies vazariam pros testes
// seguintes (inclusive os 5 síncronos acima, que nem sabem que isso existe).
afterEach(() => {
  vi.restoreAllMocks()
})

function setup(active: boolean) {
  const annotations = fakeAnnotations()
  const videoRef = createRef<HTMLVideoElement>()
  const { container } = render(
    <>
      <video ref={videoRef} />
      <AnnotationCanvas sharerId="bruno" annotations={annotations} active={active} videoRef={videoRef} />
    </>,
  )
  const canvas = container.querySelector('canvas') as HTMLCanvasElement
  return { annotations, canvas }
}

/**
 * O rAF do jsdom roda em setInterval(…, 1000/60): síncrono, `draw()` nunca
 * dispara. Substituímos requestAnimationFrame por um stub que só REGISTRA a
 * callback — draw() reagenda a si mesma como primeira linha do corpo, então
 * se o stub chamasse a callback na hora, recursaria infinitamente.
 */
function stubAnimationFrame(): FrameRequestCallback[] {
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb)
    return frames.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  return frames
}

/** Dimensiona o palco: vídeo (metadados) e canvas (layout), ambos 0 por padrão no jsdom. */
function stubStage(size: { videoWidth: number; videoHeight: number; clientWidth: number; clientHeight: number }) {
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(size.videoWidth)
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(size.videoHeight)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(size.clientWidth)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(size.clientHeight)
}

/**
 * Mock de contexto 2d que grava o que foi desenhado. `stroke()` tira uma foto
 * de globalAlpha/strokeStyle no instante da chamada — o componente zera
 * globalAlpha de volta pra 1 assim que o laço termina, então ler o valor
 * depois do draw() completo sempre mostraria 1, mascarando o fade do TTL.
 */
function stubDrawableContext() {
  const moveToCalls: Array<[number, number]> = []
  const lineToCalls: Array<[number, number]> = []
  const strokeCalls: Array<{ alpha: number; strokeStyle: string }> = []
  const context = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn((x: number, y: number) => moveToCalls.push([x, y])),
    lineTo: vi.fn((x: number, y: number) => lineToCalls.push([x, y])),
    stroke: vi.fn(() => strokeCalls.push({ alpha: context.globalAlpha, strokeStyle: String(context.strokeStyle) })),
    setTransform: vi.fn(),
    lineCap: 'butt',
    lineJoin: 'miter',
    lineWidth: 1,
    strokeStyle: '#000000',
    globalAlpha: 1,
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  return { context, moveToCalls, lineToCalls, strokeCalls }
}

function makeStroke(overrides: Partial<AnnotationStroke> = {}): AnnotationStroke {
  return {
    strokeId: 's1',
    userId: 'user-1',
    sharerId: 'bruno',
    points: [
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.5 },
    ],
    color: '#ff0000',
    doneAt: null,
    lastAt: Date.now(),
    ...overrides,
  }
}

function renderStroke(stroke: AnnotationStroke) {
  const annotations = fakeAnnotations()
  annotations.strokesFor = () => [stroke]
  const videoRef = createRef<HTMLVideoElement>()
  render(
    <>
      <video ref={videoRef} />
      <AnnotationCanvas sharerId="bruno" annotations={annotations} active videoRef={videoRef} />
    </>,
  )
}

describe('AnnotationCanvas', () => {
  it('arrastar com o modo ligado abre, estende e fecha o traço', () => {
    const { annotations, canvas } = setup(true)

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 120, clientY: 60, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 120, clientY: 60, pointerId: 1 })

    expect(annotations.beginStroke).toHaveBeenCalledWith('bruno', expect.objectContaining({ x: expect.any(Number) }))
    expect(annotations.extendStroke).toHaveBeenCalled()
    expect(annotations.endStroke).toHaveBeenCalled()
  })

  it('com o modo desligado, o overlay não captura ponteiro nem desenha', () => {
    const { annotations, canvas } = setup(false)

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 120, clientY: 60, pointerId: 1 })

    expect(annotations.beginStroke).not.toHaveBeenCalled()
    expect(canvas.style.pointerEvents).toBe('none')
  })

  it('mover sem ter começado um traço não estende nada', () => {
    const { annotations, canvas } = setup(true)

    fireEvent.pointerMove(canvas, { clientX: 120, clientY: 60, pointerId: 1 })

    expect(annotations.extendStroke).not.toHaveBeenCalled()
  })

  it('sair da área com o botão pressionado fecha o traço', () => {
    const { annotations, canvas } = setup(true)

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.pointerLeave(canvas, { clientX: 999, clientY: 999, pointerId: 1 })

    expect(annotations.endStroke).toHaveBeenCalled()
  })

  it('desmontar com o traço aberto (destaque saiu da tela) fecha o traço', () => {
    const annotations = fakeAnnotations()
    const videoRef = createRef<HTMLVideoElement>()
    const { container, unmount } = render(
      <>
        <video ref={videoRef} />
        <AnnotationCanvas sharerId="bruno" annotations={annotations} active videoRef={videoRef} />
      </>,
    )
    const canvas = container.querySelector('canvas') as HTMLCanvasElement

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pointerId: 1 })
    unmount()

    expect(annotations.endStroke).toHaveBeenCalled()
  })

  it('desmontar sem traço aberto não chama endStroke à toa', () => {
    const annotations = fakeAnnotations()
    const videoRef = createRef<HTMLVideoElement>()
    const { unmount } = render(
      <>
        <video ref={videoRef} />
        <AnnotationCanvas sharerId="bruno" annotations={annotations} active videoRef={videoRef} />
      </>,
    )

    unmount()

    expect(annotations.endStroke).not.toHaveBeenCalled()
  })

  it('desligar o modo no meio do traço fecha o traço em vez de deixá-lo aberto', () => {
    const annotations = fakeAnnotations()
    const videoRef = createRef<HTMLVideoElement>()
    const { container, rerender } = render(
      <>
        <video ref={videoRef} />
        <AnnotationCanvas sharerId="bruno" annotations={annotations} active videoRef={videoRef} />
      </>,
    )
    const canvas = container.querySelector('canvas') as HTMLCanvasElement

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pointerId: 1 })
    rerender(
      <>
        <video ref={videoRef} />
        <AnnotationCanvas sharerId="bruno" annotations={annotations} active={false} videoRef={videoRef} />
      </>,
    )

    expect(annotations.endStroke).toHaveBeenCalled()
  })
})

describe('laço de desenho (draw)', () => {
  it('traço em andamento desenha opaco, na cor certa, com as coordenadas em pixel corretas', () => {
    const frames = stubAnimationFrame()
    stubStage({ videoWidth: 1920, videoHeight: 1080, clientWidth: 800, clientHeight: 600 })
    const { moveToCalls, lineToCalls, strokeCalls } = stubDrawableContext()

    renderStroke(makeStroke())

    act(() => {
      frames[0](0)
    })

    // videoContentRect(1920x1080 dentro de 800x600): escala = min(800/1920, 600/1080) = 800/1920,
    // então largura útil = 1920*(800/1920) = 800 (cabe toda a largura) e altura útil = 1080*(800/1920) = 450,
    // sobrando (600-450)/2 = 75px de barra em cima/embaixo → rect = { left: 0, top: 75, width: 800, height: 450 }.
    // toLocal({x:0.25,y:0.5}, rect) = { x: 0 + 0.25*800 = 200, y: 75 + 0.5*450 = 300 }
    // toLocal({x:0.75,y:0.5}, rect) = { x: 0 + 0.75*800 = 600, y: 75 + 0.5*450 = 300 }
    expect(moveToCalls).toEqual([[200, 300]])
    expect(lineToCalls).toEqual([[600, 300]])
    expect(strokeCalls).toEqual([{ alpha: 1, strokeStyle: '#ff0000' }])
  })

  it('traço terminado há metade do TTL desenha com metade da opacidade', () => {
    const frames = stubAnimationFrame()
    stubStage({ videoWidth: 1920, videoHeight: 1080, clientWidth: 800, clientHeight: 600 })
    const { strokeCalls } = stubDrawableContext()

    renderStroke(makeStroke({ doneAt: Date.now() - OFFICE_ANNOTATION_STROKE_TTL_MS / 2 }))

    act(() => {
      frames[0](0)
    })

    expect(strokeCalls).toHaveLength(1)
    // alpha = 1 - age/TTL; com age ≈ TTL/2, alpha ≈ 0.5 (toBeCloseTo absorve o
    // punhado de ms reais gastos entre o setup do doneAt e a execução do frame).
    expect(strokeCalls[0].alpha).toBeCloseTo(0.5, 1)
  })

  it('só redimensiona o canvas quando o tamanho realmente muda', () => {
    const frames = stubAnimationFrame()
    stubStage({ videoWidth: 1920, videoHeight: 1080, clientWidth: 800, clientHeight: 600 })
    stubDrawableContext()
    // Espiona o setter no protótipo (não na instância: width/height são
    // acessores herdados de HTMLCanvasElement.prototype) mantendo o
    // comportamento real, só contando as chamadas.
    const widthSetter = vi.spyOn(HTMLCanvasElement.prototype, 'width', 'set')
    const heightSetter = vi.spyOn(HTMLCanvasElement.prototype, 'height', 'set')

    renderStroke(makeStroke())

    act(() => {
      frames[0](0)
    })
    expect(widthSetter).toHaveBeenCalledTimes(1)
    expect(heightSetter).toHaveBeenCalledTimes(1)

    // Mesmo clientWidth/clientHeight do frame anterior: draw() reagendou a si
    // mesma (frames ganhou uma nova entrada) e o segundo quadro não deve
    // reatribuir width/height de novo.
    act(() => {
      frames[frames.length - 1](16)
    })
    expect(widthSetter).toHaveBeenCalledTimes(1)
    expect(heightSetter).toHaveBeenCalledTimes(1)
  })

  it('traço de um ponto só (toque sem arrastar) desenha um ponto visível', () => {
    const frames = stubAnimationFrame()
    stubStage({ videoWidth: 1920, videoHeight: 1080, clientWidth: 800, clientHeight: 600 })
    const { moveToCalls, lineToCalls } = stubDrawableContext()

    renderStroke(makeStroke({ points: [{ x: 0.5, y: 0.5 }] }))

    act(() => {
      frames[0](0)
    })

    // toLocal({x:0.5,y:0.5}, rect) = { x: 0 + 0.5*800 = 400, y: 75 + 0.5*450 = 300 }
    // Sem o lineTo pro mesmo ponto, moveTo sozinho não pinta nada com stroke() —
    // é o círculo do lineCap 'round' que torna o toque visível.
    expect(moveToCalls).toEqual([[400, 300]])
    expect(lineToCalls).toEqual([[400, 300]])
  })
})
