/**
 * Passos de zoom da arena.
 *
 * INTEIROS, e é obrigatório: com `pixelArt`, um zoom fracionário faz cada pixel
 * da arte virar 1,5 (ou 2,3) pixels de tela — uns dobram, outros não —, e ao
 * andar muda quais dobram. É exatamente o "borrado" que a escala inteira do
 * sprite consertou; zoom contínuo o traria de volta.
 *
 * Mora aqui, e não em `ArenaScene`, porque o painel precisa deles: importar da
 * cena arrastaria o Phaser (~1,4 MB) para o pacote inicial e desfaria o
 * carregamento tardio do jogo.
 */
export const ARENA_ZOOM_STEPS = [1, 2, 3, 4] as const

export type ArenaZoom = (typeof ARENA_ZOOM_STEPS)[number]

/** Passo mais próximo do valor pedido. */
export function nearestArenaZoom(zoom: number): ArenaZoom {
  return ARENA_ZOOM_STEPS.reduce((melhor, candidato) =>
    Math.abs(candidato - zoom) < Math.abs(melhor - zoom) ? candidato : melhor,
  )
}

/** Um passo para dentro (+1) ou para fora (−1), sem sair da faixa. */
export function stepArenaZoom(zoom: number, direcao: 1 | -1): ArenaZoom {
  const indice = ARENA_ZOOM_STEPS.indexOf(nearestArenaZoom(zoom))
  return ARENA_ZOOM_STEPS[Math.min(ARENA_ZOOM_STEPS.length - 1, Math.max(0, indice + direcao))]
}
