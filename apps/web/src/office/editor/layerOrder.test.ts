import { describe, expect, it } from 'vitest'
import { createEmptyMapDocumentV1 } from '@legends/shared'
import { layersTopFirst, moveLayerOneStep, nextVisualLayerZIndex } from './layerOrder'

const doc = () => createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
const zPorKey = (layers: ReturnType<typeof doc>['layers']) =>
  Object.fromEntries(layers.map((layer) => [layer.key, layer.zIndex]))

describe('moveLayerOneStep', () => {
  it('"Subir" aumenta o zIndex — a lista é exibida do topo para o fundo', () => {
    const { layers } = doc()
    const movido = moveLayerOneStep(layers, 'floor', -1)

    // Piso (0) troca com Paredes (10), a vizinha logo acima.
    expect(zPorKey(movido!)).toMatchObject({ floor: 10, walls: 0 })
  })

  it('"Descer" diminui', () => {
    const { layers } = doc()
    const movido = moveLayerOneStep(layers, 'walls', 1)

    expect(zPorKey(movido!)).toMatchObject({ walls: 0, floor: 10 })
  })

  /**
   * O regressor: renumerar a lista inteira (`order * 10`) esmagava a faixa
   * reservada e movia `objects` — o depth de TODA a mobília — de 20 para 30.
   */
  it('não mexe no zIndex de quem não está na troca', () => {
    const { layers } = doc()
    const antes = zPorKey(layers)
    const movido = moveLayerOneStep(layers, 'floor', -1)!

    for (const layer of movido) {
      if (layer.key === 'floor' || layer.key === 'walls') continue
      expect(layer.zIndex).toBe(antes[layer.key])
    }
    expect(zPorKey(movido).objects).toBe(20)
  })

  it('devolve null nos extremos e para layer inexistente', () => {
    const { layers } = doc()
    const topo = layersTopFirst(layers)[0]!

    expect(moveLayerOneStep(layers, topo.key, -1)).toBeNull()
    expect(moveLayerOneStep(layers, 'floor', 1)).toBeNull()
    expect(moveLayerOneStep(layers, 'nao-existe', -1)).toBeNull()
  })
})

describe('nextVisualLayerZIndex', () => {
  /**
   * Considerar as layers de objeto (collision 100 … interactive-objects 140)
   * fazia a layer visual nova nascer em 141, acima de toda a mobília.
   */
  it('fica um degrau acima da layer visual mais alta, ignorando as de objeto', () => {
    const { layers } = doc()

    expect(nextVisualLayerZIndex(layers)).toBe(21)
  })
})
