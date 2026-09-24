import { faqs } from './faqs'
import { prompts } from './prompts'
import { situations } from './situations'
import { videos } from './videos'

/** Raiz do guia dentro da Comunidade INOVA — os `href` da busca são absolutos. */
export const GUIA_BASE = '/comunidade-inova/guia'

export type GuiaSearchKind = 'situation' | 'prompt' | 'video' | 'faq' | 'page'

export interface GuiaSearchDoc {
  id: string
  kind: GuiaSearchKind
  title: string
  subtitle: string
  href: string
  /** Texto extra onde o termo também é procurado, além de título e subtítulo. */
  haystack: string
}

export const GUIA_SEARCH_KIND_LABEL: Record<GuiaSearchKind, string> = {
  situation: 'Situação',
  prompt: 'Prompt',
  video: 'Vídeo',
  faq: 'FAQ',
  page: 'Seção',
}

// As seções entram no índice para quem busca pelo nome da tela ("segurança",
// "maturidade") e não por um conteúdo dela.
const PAGES: GuiaSearchDoc[] = [
  { id: 'pg-bussola', kind: 'page', title: 'Bússola de Decisão', subtitle: 'Quem deve ajudar primeiro?', href: `${GUIA_BASE}/bussola`, haystack: 'bússola decisão caminho impacto risco' },
  { id: 'pg-seguranca', kind: 'page', title: 'Segurança e limites de uso', subtitle: 'Antes de compartilhar, confira.', href: `${GUIA_BASE}/seguranca`, haystack: 'segurança dados sigilo credenciais lgpd homologada' },
  { id: 'pg-lideranca', kind: 'page', title: 'Liderança AI First', subtitle: 'A transformação começa pelo exemplo.', href: `${GUIA_BASE}/lideranca`, haystack: 'liderança time autonomia headcount checklist' },
  { id: 'pg-maturidade', kind: 'page', title: 'Autodiagnóstico de maturidade', subtitle: 'Qual é o seu momento AI First?', href: `${GUIA_BASE}/maturidade`, haystack: 'maturidade nível autodiagnóstico evolução' },
  { id: 'pg-cases', kind: 'page', title: 'AI First acontecendo na INOVA', subtitle: 'Cases, vitórias rápidas e INOVA.', href: `${GUIA_BASE}/cases`, haystack: 'cases casos inova comunidade vitória rápida registrar' },
  { id: 'pg-guia', kind: 'page', title: 'Guia AI First completo', subtitle: 'Princípios e orientações completas.', href: `${GUIA_BASE}/completo`, haystack: 'guia completo glossário faq princípios ciclo' },
]

/**
 * Índice estático da busca global. Cada `href` leva ao item, e não só à tela:
 * `?s=` abre a situação, `?p=` destaca o prompt, `?v=` o vídeo e `?faq=` abre
 * a pergunta — as páginas leem esses parâmetros.
 *
 * Os vídeos vêm do catálogo estático: título reescrito pelo admin (sobrescrita
 * no banco) não entra aqui, e card de vídeo criado do zero também não.
 */
export const guiaSearchIndex: GuiaSearchDoc[] = [
  ...situations.map((s) => ({
    id: s.id,
    kind: 'situation' as const,
    title: s.title,
    subtitle: s.summary,
    href: `${GUIA_BASE}/situacoes?s=${s.slug}`,
    haystack: [s.category, s.aiRole, s.humanRole, s.risk, ...s.tags].join(' '),
  })),
  ...prompts.map((p) => ({
    id: p.id,
    kind: 'prompt' as const,
    title: p.title,
    subtitle: p.description,
    href: `${GUIA_BASE}/prompts?p=${p.id}`,
    haystack: [p.whenToUse, p.text, p.category, ...p.tags].join(' '),
  })),
  ...videos.map((v) => ({
    id: v.id,
    kind: 'video' as const,
    title: v.title,
    subtitle: v.description,
    href: `${GUIA_BASE}/videos?v=${v.id}`,
    haystack: [v.category, v.behavior].join(' '),
  })),
  ...faqs.map((f) => ({
    id: f.id,
    kind: 'faq' as const,
    title: f.question,
    subtitle: f.category,
    href: `${GUIA_BASE}/completo?faq=${f.id}`,
    haystack: [...f.answer, ...f.tags].join(' '),
  })),
  ...PAGES,
]

/** Sem acento e em minúsculas: "reuniao" tem de achar "reunião". */
const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

// Palavras de enchimento de quem descreve a situação ("tenho uma planilha",
// "vou negociar"). No modo tolerante elas casariam com metade do índice.
const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'de', 'da', 'do', 'das', 'dos', 'na', 'no', 'em', 'e', 'com', 'para', 'por',
  'que', 'eu', 'meu', 'minha', 'esse', 'essa', 'isso', 'tenho', 'preciso', 'quero', 'vou', 'posso', 'fazer',
])

function scoreDoc(doc: GuiaSearchDoc, terms: string[], strict: boolean): number {
  const hay = normalize(`${doc.title} ${doc.subtitle} ${doc.haystack}`)
  const title = normalize(doc.title)
  let score = 0
  for (const term of terms) {
    if (!hay.includes(term)) {
      if (strict) return -1
      continue
    }
    score += title.includes(term) ? 3 : 1
    if (title.startsWith(term)) score += 2
  }
  return score
}

/**
 * Primeiro todo termo precisa aparecer (E, não OU) — "dar feedback" não traz
 * tudo que tem "dar". Se nada casar assim, cai para o modo tolerante, que
 * ordena por quantos termos casaram: a pessoa descreve a situação com as
 * palavras dela ("conflito entre áreas"), e o índice nem sempre tem todas.
 * Termo no título pesa mais, e no começo do título mais ainda.
 */
export function searchGuia(query: string, limit = 10, index: GuiaSearchDoc[] = guiaSearchIndex): GuiaSearchDoc[] {
  const q = normalize(query.trim())
  if (q.length < 2) return []
  const all = q.split(/\s+/)
  const meaningful = all.filter((t) => !STOPWORDS.has(t))
  const terms = meaningful.length > 0 ? meaningful : all

  const rank = (strict: boolean) =>
    index
      .map((doc) => ({ doc, score: scoreDoc(doc, terms, strict) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.doc)

  const strict = rank(true)
  return strict.length > 0 ? strict : rank(false)
}

export const GUIA_SEARCH_EXAMPLES = [
  'Preciso dar feedback',
  'Tenho uma planilha',
  'Quero pedir headcount',
  'Preciso escrever um e-mail',
  'Tenho conflito entre áreas',
  'Vou fazer uma apresentação',
  'Quero aprender um assunto',
  'Preciso analisar dados',
  'Vou negociar',
  'Preciso avaliar promoção',
  'Posso colocar esse dado na IA?',
]
