/**
 * Paleta saturada e clara: o traço cai sobre conteúdo arbitrário (código,
 * planilha, slide), então precisa contrastar com fundo claro e escuro.
 */
export const ANNOTATION_COLORS = [
  '#ff5252',
  '#ffb300',
  '#00e676',
  '#40c4ff',
  '#e040fb',
  '#ff6e40',
] as const

/**
 * Cor estável por pessoa, derivada do id (djb2). Determinística de propósito:
 * todo mundo vê o traço de fulano na mesma cor, sem o servidor mandar nada.
 */
export function annotationColor(userId: string): string {
  let hash = 5381
  for (let i = 0; i < userId.length; i += 1) {
    hash = ((hash << 5) + hash + userId.charCodeAt(i)) >>> 0
  }
  return ANNOTATION_COLORS[hash % ANNOTATION_COLORS.length]
}
