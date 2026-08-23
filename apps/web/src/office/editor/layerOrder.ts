import type { MapLayerV1 } from '@legends/shared'

/**
 * Ordem em que a lista de layers do editor é exibida: topo da pilha primeiro.
 * "Subir" (-1) anda para o começo desta lista — ou seja, para o MAIOR zIndex.
 */
export function layersTopFirst(layers: readonly MapLayerV1[]): MapLayerV1[] {
  return [...layers].sort((left, right) => right.zIndex - left.zIndex)
}

/**
 * Move uma layer um degrau na pilha visual TROCANDO o zIndex com a vizinha.
 *
 * Trocar, e não renumerar: a versão antiga reescrevia `zIndex: order * 10` na
 * lista inteira, o que esmagava a faixa reservada (collision 100, desks 135,
 * interactive-objects 140) para dentro da faixa visual e mudava o zIndex de
 * `objects` de 20 para 30 — o depth em que TODA a mobília do escritório é
 * desenhada. Foi o que aconteceu com o mapa da EMR.
 *
 * Devolve `null` quando não há o que fazer (layer inexistente ou já no extremo),
 * para o chamador não abrir um passo de desfazer à toa.
 */
export function moveLayerOneStep(
  layers: readonly MapLayerV1[],
  layerKey: string,
  direction: -1 | 1,
): MapLayerV1[] | null {
  const ordered = layersTopFirst(layers)
  const index = ordered.findIndex((item) => item.key === layerKey)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ordered.length) return null
  const current = ordered[index]
  const neighbour = ordered[target]
  if (!current || !neighbour || current.zIndex === neighbour.zIndex) return null
  return layers.map((item) => {
    if (item.key === current.key) return { ...item, zIndex: neighbour.zIndex }
    if (item.key === neighbour.key) return { ...item, zIndex: current.zIndex }
    return item
  })
}

/**
 * zIndex de uma layer visual nova: um degrau acima da visual mais alta, e não
 * acima de TUDO. O `Math.max` sobre todas as layers levava em conta as de
 * objeto (collision, desks, interactive-objects…), que vivem numa faixa bem
 * mais alta — a layer nova nascia acima de toda a mobília, e nada colocado
 * pela paleta conseguia ficar na frente do que fosse pintado nela.
 */
export function nextVisualLayerZIndex(layers: readonly MapLayerV1[]): number {
  const visuais = layers.filter((item) => item.type === 'tile').map((item) => item.zIndex)
  return Math.max(...visuais, 0) + 1
}
