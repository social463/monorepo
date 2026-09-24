/**
 * Blocos empilháveis da aula (Documento 4, seção 9.1).
 *
 * Antes disto a aula tinha **um** formato: `CourseLessonType` era `VIDEO` ou
 * `TEXT`, e a tela escolhia qual campo aparecia — a URL do vídeo ou o texto.
 * Não dava para pôr um texto e, abaixo dele, uma imagem, que é literalmente o
 * exemplo do documento.
 *
 * Agora a aula é uma **lista ordenada de blocos**, e o conteúdo mora num único
 * `CourseLesson.contentBlocks` (Json). A escolha por array-em-coluna, e não por
 * tabela de blocos, está justificada no spec: o que a tabela daria a mais é
 * consulta por tipo de bloco, e a única que existe é a do quiz — que continua
 * em `CourseQuiz`, tabela própria, nos dois desenhos.
 *
 * **O bloco de quiz aponta, não duplica.** Ele guarda o `quizId` de um
 * `CourseQuiz` que já existe; o editor de quiz continua sendo o de sempre.
 * Duplicar o modelo aqui faria duas notas para a mesma aula.
 *
 * Este módulo é a fonte única do formato: o schema Zod é o **mesmo** que a rota
 * usa para validar e que o web usa para tipar. Bloco vem do navegador, então
 * validar no servidor não é zelo, é o contrato.
 */

import { z } from 'zod'

/** Tipos de bloco, na ordem em que aparecem no menu "Adicionar bloco". */
export const COURSE_BLOCK_TYPES = [
  'heading',
  'text',
  'checklist',
  'image',
  'video',
  'pdf',
  'callout',
  'quote',
  'code',
  'divider',
  'button',
  'link',
  'attachment',
  'quiz',
] as const
export type CourseBlockType = (typeof COURSE_BLOCK_TYPES)[number]

export const COURSE_BLOCK_LABELS: Record<CourseBlockType, string> = {
  heading: 'Título',
  text: 'Texto',
  checklist: 'Checklist',
  image: 'Imagem',
  video: 'Vídeo',
  pdf: 'PDF',
  callout: 'Destaque',
  quote: 'Citação',
  code: 'Código',
  divider: 'Divisor',
  button: 'Botão',
  link: 'Link externo',
  attachment: 'Anexo',
  quiz: 'Quiz',
}

/** Ícone do Material Symbols de cada bloco — usado no menu e na lista. */
export const COURSE_BLOCK_ICONS: Record<CourseBlockType, string> = {
  heading: 'title',
  text: 'notes',
  checklist: 'checklist',
  image: 'image',
  video: 'play_circle',
  pdf: 'picture_as_pdf',
  callout: 'campaign',
  quote: 'format_quote',
  code: 'code',
  divider: 'horizontal_rule',
  button: 'smart_button',
  link: 'link',
  attachment: 'attach_file',
  quiz: 'quiz',
}

export const CALLOUT_TONES = ['info', 'success', 'warning', 'danger'] as const
export type CalloutTone = (typeof CALLOUT_TONES)[number]

export const CALLOUT_TONE_LABELS: Record<CalloutTone, string> = {
  info: '💡 Info',
  success: '✅ Sucesso',
  warning: '⚠️ Atenção',
  danger: '🔥 Cuidado',
}

export const VIDEO_SOURCES = ['youtube', 'vimeo', 'loom', 'upload'] as const
export type VideoSource = (typeof VIDEO_SOURCES)[number]

export const VIDEO_SOURCE_LABELS: Record<VideoSource, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  loom: 'Loom',
  upload: 'Upload',
}

/**
 * Tetos. Existem para que uma aula não vire payload sem fim — o conteúdo todo
 * viaja numa coluna só, e uma aula com dez mil blocos derruba a tela do aluno
 * antes de derrubar o banco.
 */
export const MAX_BLOCKS_PER_LESSON = 200
export const MAX_BLOCK_TEXT_LENGTH = 20_000
export const MAX_BLOCK_TITLE_LENGTH = 300
export const MAX_CHECKLIST_ITEMS = 100
export const MAX_BLOCK_URL_LENGTH = 2_000

/**
 * URL de bloco: só `http` e `https`.
 *
 * O renderer é React e não usa `dangerouslySetInnerHTML`, então bloco não
 * injeta marcação — mas `href` e `src` ainda aceitariam `javascript:` e
 * `data:`, que é clique do aluno virando execução. A allowlist de protocolo é
 * o que fecha isso, e fica aqui porque o servidor precisa dela tanto quanto a
 * tela.
 */
export function isSafeBlockUrl(value: string): boolean {
  try {
    const protocolo = new URL(value).protocol
    return protocolo === 'http:' || protocolo === 'https:'
  } catch {
    return false
  }
}

const urlSchema = z
  .string()
  .trim()
  .max(MAX_BLOCK_URL_LENGTH)
  .refine(isSafeBlockUrl, { message: 'O link precisa começar com http:// ou https://.' })

/** URL que ainda está sendo preenchida no editor pode ser vazia. */
const urlOuVazioSchema = z.union([z.literal(''), urlSchema])

const idSchema = z.string().trim().min(1).max(64)
const textoSchema = z.string().max(MAX_BLOCK_TEXT_LENGTH)
const tituloSchema = z.string().max(MAX_BLOCK_TITLE_LENGTH)

export const courseLessonBlockSchema = z.discriminatedUnion('type', [
  z.object({
    id: idSchema,
    type: z.literal('heading'),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text: tituloSchema,
  }),
  z.object({ id: idSchema, type: z.literal('text'), text: textoSchema }),
  z.object({
    id: idSchema,
    type: z.literal('checklist'),
    items: z
      .array(z.object({ text: tituloSchema, done: z.boolean() }))
      .max(MAX_CHECKLIST_ITEMS),
  }),
  z.object({
    id: idSchema,
    type: z.literal('image'),
    url: urlOuVazioSchema,
    caption: tituloSchema.optional(),
  }),
  z.object({
    id: idSchema,
    type: z.literal('video'),
    url: urlOuVazioSchema,
    source: z.enum(VIDEO_SOURCES),
  }),
  z.object({
    id: idSchema,
    type: z.literal('pdf'),
    url: urlOuVazioSchema,
    title: tituloSchema.optional(),
  }),
  z.object({
    id: idSchema,
    type: z.literal('callout'),
    text: textoSchema,
    tone: z.enum(CALLOUT_TONES),
  }),
  z.object({
    id: idSchema,
    type: z.literal('quote'),
    text: textoSchema,
    author: tituloSchema.optional(),
  }),
  z.object({
    id: idSchema,
    type: z.literal('code'),
    code: textoSchema,
    language: z.string().max(40).optional(),
  }),
  z.object({ id: idSchema, type: z.literal('divider') }),
  z.object({
    id: idSchema,
    type: z.literal('button'),
    label: tituloSchema,
    url: urlOuVazioSchema,
  }),
  z.object({
    id: idSchema,
    type: z.literal('link'),
    url: urlOuVazioSchema,
    title: tituloSchema,
    description: tituloSchema.optional(),
  }),
  z.object({
    id: idSchema,
    type: z.literal('attachment'),
    url: urlOuVazioSchema,
    name: tituloSchema,
  }),
  z.object({ id: idSchema, type: z.literal('quiz'), quizId: z.string().nullable() }),
])

export type CourseLessonBlock = z.infer<typeof courseLessonBlockSchema>
export type CourseBlockOfType<T extends CourseBlockType> = Extract<CourseLessonBlock, { type: T }>

export const courseLessonBlocksSchema = z.array(courseLessonBlockSchema).max(MAX_BLOCKS_PER_LESSON)

/**
 * Lê o que veio do banco. Diferente do schema da rota, aqui **não se lança**:
 * `contentBlocks` é `Json`, e uma linha estranha — escrita por migration antiga
 * ou por uma versão futura do formato — não pode derrubar a aula inteira do
 * aluno. Bloco que não casa é descartado; o resto da aula continua de pé.
 */
export function parseCourseLessonBlocks(value: unknown): CourseLessonBlock[] {
  if (!Array.isArray(value)) return []
  const blocos: CourseLessonBlock[] = []
  for (const item of value) {
    const parsed = courseLessonBlockSchema.safeParse(item)
    if (parsed.success) blocos.push(parsed.data)
    if (blocos.length >= MAX_BLOCKS_PER_LESSON) break
  }
  return blocos
}

/**
 * O bloco tem conteúdo de verdade? Bloco recém-criado nasce vazio, e uma aula
 * só de blocos vazios não é conteúdo publicado — é o que a tela do aluno usa
 * para decidir entre renderizar e dizer "ainda não tem conteúdo".
 */
export function isBlockEmpty(block: CourseLessonBlock): boolean {
  switch (block.type) {
    case 'divider':
      return false
    case 'heading':
    case 'text':
    case 'callout':
    case 'quote':
      return block.text.trim().length === 0
    case 'checklist':
      return block.items.every((item) => item.text.trim().length === 0)
    case 'code':
      return block.code.trim().length === 0
    case 'image':
    case 'video':
    case 'pdf':
    case 'attachment':
    case 'button':
    case 'link':
      return block.url.trim().length === 0
    case 'quiz':
      return block.quizId === null
  }
}

export function hasLessonContent(blocks: readonly CourseLessonBlock[]): boolean {
  return blocks.some((block) => !isBlockEmpty(block))
}

/**
 * Como a aula se anuncia na lista e no cabeçalho do player.
 *
 * Antes isto era `CourseLesson.type`, uma coluna. Com blocos, uma aula pode ter
 * vídeo E texto, e uma coluna teria de escolher uma mentira — então o formato
 * passou a ser **derivado**: manda o vídeo, se houver, porque é o que muda como
 * a pessoa vai consumir a aula (assistir x ler).
 */
export function lessonKindOf(blocks: readonly CourseLessonBlock[]): 'VIDEO' | 'QUIZ' | 'TEXT' {
  const preenchidos = blocks.filter((block) => !isBlockEmpty(block))
  if (preenchidos.some((block) => block.type === 'video')) return 'VIDEO'
  if (preenchidos.length > 0 && preenchidos.every((block) => block.type === 'quiz')) return 'QUIZ'
  return 'TEXT'
}

export const LESSON_KIND_LABELS: Record<ReturnType<typeof lessonKindOf>, string> = {
  VIDEO: 'Vídeo',
  QUIZ: 'Avaliação',
  TEXT: 'Leitura',
}

export const LESSON_KIND_ICONS: Record<ReturnType<typeof lessonKindOf>, string> = {
  VIDEO: 'play_circle',
  QUIZ: 'quiz',
  TEXT: 'article',
}

/** Bloco novo, já com os campos que o tipo exige. */
export function createEmptyBlock(type: CourseBlockType, id: string): CourseLessonBlock {
  switch (type) {
    case 'heading':
      return { id, type, level: 2, text: '' }
    case 'text':
      return { id, type, text: '' }
    case 'checklist':
      return { id, type, items: [{ text: '', done: false }] }
    case 'image':
      return { id, type, url: '' }
    case 'video':
      return { id, type, url: '', source: 'youtube' }
    case 'pdf':
      return { id, type, url: '' }
    case 'callout':
      return { id, type, text: '', tone: 'info' }
    case 'quote':
      return { id, type, text: '' }
    case 'code':
      return { id, type, code: '' }
    case 'divider':
      return { id, type }
    case 'button':
      return { id, type, label: 'Saiba mais', url: '' }
    case 'link':
      return { id, type, url: '', title: '' }
    case 'attachment':
      return { id, type, url: '', name: '' }
    case 'quiz':
      return { id, type, quizId: null }
  }
}
