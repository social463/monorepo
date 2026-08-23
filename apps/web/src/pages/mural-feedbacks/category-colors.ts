import { RECOGNITION_CATEGORY_SEED } from '@legends/shared'

/**
 * Marcador colorido de cada competência na lista de seleção.
 *
 * A ordem reproduz a referência da G&G: a i-ésima competência do catálogo
 * padrão pega a i-ésima cor daqui (Liderança roxo, Foco no Cliente verde…).
 * Empresa que cadastrou o próprio catálogo cai no hash do nome — cor estável
 * entre sessões, que é o que importa para reconhecer a linha de relance.
 *
 * São cores da paleta do Tailwind, e não tokens de marca, de propósito: isto é
 * **codificação categórica**, não identidade visual. Pintar 13 competências com
 * a cor da empresa devolveria 13 pontos iguais. Ficam no tom 500, que se
 * enxerga nos dois esquemas — assim o arquivo não precisa de `dark:`, que o app
 * evita porque o tema é troca de valor de variável.
 */
const DOTS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-emerald-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-lime-500',
  'bg-cyan-500',
] as const

function hash(name: string): number {
  let acc = 0
  for (let i = 0; i < name.length; i += 1) acc = (acc * 31 + name.charCodeAt(i)) % 1_000_003
  return acc
}

export function categoryDotClass(name: string): string {
  const seeded = (RECOGNITION_CATEGORY_SEED as readonly string[]).indexOf(name)
  return DOTS[seeded >= 0 ? seeded : hash(name) % DOTS.length]
}
