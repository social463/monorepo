/**
 * Conversão mundo → tela de uma cena Phaser, sem Phaser junto.
 *
 * Mora aqui (e não dentro da cena) porque duas cenas precisam dela — o
 * escritório e a arena — e importar `OfficeScene` da arena arrastaria o
 * escritório inteiro para o bundle do jogo. É também o que mantém a função
 * testável sem instanciar cena nenhuma.
 */
export interface ScreenPosition {
  x: number
  y: number
  zoom: number
}

/**
 * `null` quando o ponto está fora do viewport — quem ancora UI nele some
 * junto, em vez de ficar grudado na borda.
 */
export function computeScreenPosition(
  containerX: number,
  containerY: number,
  camera: { scrollX: number; scrollY: number; zoom: number },
  viewport: { width: number; height: number },
): ScreenPosition | null {
  const x = (containerX - camera.scrollX) * camera.zoom
  const y = (containerY - camera.scrollY) * camera.zoom
  if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) return null
  return { x, y, zoom: camera.zoom }
}
