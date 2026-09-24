/**
 * Importação de eventos do calendário por planilha (CSV).
 *
 * O formato não é inventado aqui: é o do **Calendário Endomarketing** que a
 * G&G já mantém no Google Sheets, coluna por coluna. Pedir para reescrever a
 * planilha no nosso formato garantiria que ela nunca seria importada — o que a
 * importação precisa aceitar é o arquivo que já existe.
 *
 * Como em `user-import`, o corpo das rotas **não** é JSON: `preview` e `commit`
 * recebem `multipart/form-data` com um único campo `file`, e o `commit` leva o
 * `fileHash` na query (`?fileHash=…`). Por isso aqui só moram as constantes do
 * formato e os DTOs de resposta.
 */

/** Colunas do template, nesta ordem — a mesma da planilha da G&G. */
export const CALENDAR_IMPORT_COLUMNS = [
  'Mês',
  'Tag',
  'Evento / Celebração',
  'Data de Início',
  'Data Final',
  'Duração',
  'Horário',
  'Descrição',
  'Tags (Público-Alvo)',
] as const
export type CalendarImportColumn = (typeof CALENDAR_IMPORT_COLUMNS)[number]

/** Sem estas três não existe evento. O resto é opcional. */
export const CALENDAR_IMPORT_REQUIRED_COLUMNS = ['Tag', 'Evento / Celebração', 'Data de Início'] as const

/**
 * Colunas da planilha que a importação **reconhece para ignorar**. As duas são
 * derivadas do que já vem preenchido — `Mês` sai da data de início e `Duração`
 * sai do horário (`calendarDurationLabel`) — e guardar o texto escrito à mão ao
 * lado do dado estruturado cria duas verdades sobre a mesma coisa. Ignorar em
 * silêncio seria pior: alguém editaria "Duração" achando que surte efeito.
 */
export const CALENDAR_IMPORT_IGNORED_COLUMNS = ['Mês', 'Duração'] as const

/**
 * Sinônimos aceitos no cabeçalho. O casamento é feito sem acento, sem caixa e
 * com espaços colapsados, então aqui basta a forma "achatada".
 */
export const CALENDAR_IMPORT_COLUMN_ALIASES: Record<CalendarImportColumn, readonly string[]> = {
  'Mês': ['mes', 'mes de referencia'],
  Tag: ['tipo', 'categoria', 'tipo de evento'],
  'Evento / Celebração': ['evento', 'titulo', 'celebracao', 'evento celebracao', 'nome do evento'],
  'Data de Início': ['data', 'data inicial', 'inicio', 'data de inicio'],
  'Data Final': ['data fim', 'data de fim', 'fim', 'data de termino', 'termino'],
  'Duração': ['duracao'],
  'Horário': ['horario', 'hora', 'horarios'],
  'Descrição': ['descricao', 'detalhes', 'observacoes'],
  'Tags (Público-Alvo)': ['publico alvo', 'publico', 'tags publico alvo', 'tags', 'audiencia'],
}

/**
 * Linha de exemplo do template, na ordem de `CALENDAR_IMPORT_COLUMNS`. As
 * colunas ignoradas vêm preenchidas de propósito: o template precisa ser
 * reconhecível como a planilha da G&G, e é justamente aí que o aviso de coluna
 * ignorada ganha sentido.
 */
export const CALENDAR_IMPORT_TEMPLATE_EXAMPLE = [
  'Agosto',
  'Data Comemorativa',
  'Dia dos Pais',
  '09/08/2026',
  '09/08/2026',
  'Dia todo',
  'Dia todo',
  'Dia de celebrar quem faz a diferença na nossa história.',
  'Todos',
] as const

export const CALENDAR_IMPORT_TEMPLATE_FILENAME = 'modelo-importacao-calendario.csv'

/**
 * Teto de linhas por arquivo. Um calendário anual inteiro da EMR tem ~140
 * linhas; o limite existe para um arquivo errado não virar transação de
 * minutos, não porque o banco não aguente.
 */
export const CALENDAR_IMPORT_MAX_ROWS = 500

/** 1 MiB. Uma planilha de 500 linhas não chega perto disso. */
export const CALENDAR_IMPORT_MAX_FILE_BYTES = 1_048_576

/**
 * O que vai acontecer com cada linha.
 * - `CREATE`    evento novo
 * - `UPDATE`    evento que já existe e tem algo a mudar
 * - `UNCHANGED` evento que já existe e está igual (é o que prova que reimportar não duplica)
 * - `ERROR`     linha inválida; qualquer uma delas trava o arquivo inteiro
 */
export const CALENDAR_IMPORT_ROW_ACTIONS = ['CREATE', 'UPDATE', 'UNCHANGED', 'ERROR'] as const
export type CalendarImportRowAction = (typeof CALENDAR_IMPORT_ROW_ACTIONS)[number]

export const CALENDAR_IMPORT_ROW_ACTION_LABELS: Record<CalendarImportRowAction, string> = {
  CREATE: 'Criar',
  UPDATE: 'Atualizar',
  UNCHANGED: 'Sem mudança',
  ERROR: 'Erro',
}

/**
 * O evento existente que uma linha atualiza é o de **mesmo título na mesma data
 * de início**. Não há id na planilha, e é esse par que a G&G trata como "o
 * mesmo evento" ao revisar o arquivo — reimportar a planilha corrigida precisa
 * corrigir o que está no ar, não duplicar tudo.
 */
export function calendarImportRowKey(title: string, date: string): string {
  return `${title.trim().toLowerCase().replace(/\s+/g, ' ')}|${date}`
}

/**
 * A coluna `Tag` da planilha não é a categoria: ela é o vocabulário do
 * negócio ("Simulado", "Circuito", "Porta de Prova"), 25 valores só no
 * calendário de 2026/27. Criar uma categoria por tag foi o que deixou o
 * calendário todo da mesma cor — categoria fora do catálogo padrão nasce com a
 * cor de fallback — e a barra de filtro com 31 chips.
 *
 * Aqui a tag **cai numa das 10 categorias do catálogo**, que é de onde vêm cor,
 * ícone e filtro; a grafia original vira `CalendarEvent.tag`, a etiqueta do
 * evento. É o desenho do Portal EMR, onde `category` (10, colorida) e `tag`
 * (texto livre da planilha) sempre foram campos separados.
 *
 * Tag cujo slug já É um slug do catálogo não precisa entrar aqui: ela casa
 * sozinha ("Reunião" → `reuniao`, "Cultura" → `cultura`).
 */
export const CALENDAR_IMPORT_TAG_CATEGORIES: Record<string, string> = {
  // Negócio: prova, circuito, evento externo — a "ação com data" da EMR.
  simulado: 'evento',
  circuito: 'evento',
  enamed: 'evento',
  profecia: 'evento',
  'porta-de-prova': 'evento',
  'start-na-aprovacao': 'evento',
  palestra: 'evento',
  b2b: 'evento',
  b2c: 'evento',
  autoral: 'evento',
  // Calendário oficial: dia sem expediente, seja qual for o motivo.
  'feriado-nacional': 'feriado',
  'feriado-municipal': 'feriado',
  'ponto-facultativo': 'feriado',
  // Rito interno com hora marcada e convocação.
  comite: 'reuniao',
  'ritual-de-comites': 'reuniao',
  // Vida interna do time.
  festa: 'cultura',
  games: 'cultura',
  'cafe-tematico': 'cultura',
  // Homenagem de data: o dia da profissão é uma data comemorativa.
  profissao: 'data-comemorativa',
  // Campanha do mês (Setembro Amarelo, Outubro Rosa…).
  'campanha-mensal': 'campanha',
  // O guarda-chuva de G&G da planilha.
  'desenvolvimento-humano-organizacional': 'desenv-humano',
}

/**
 * Tag que não casa com nenhuma categoria vira **Evento**, e o preview avisa. A
 * alternativa — recusar a linha — travaria a planilha inteira por um vocabulário
 * novo, e a grafia original não se perde: ela fica na etiqueta do evento.
 */
export const CALENDAR_IMPORT_FALLBACK_CATEGORY = 'evento'

export interface CalendarImportIssueDTO {
  /** Número da linha **física** no arquivo — o mesmo que a pessoa vê no Excel. */
  line: number
  /** `null` quando o problema é da linha inteira, não de uma coluna. */
  column: CalendarImportColumn | null
  message: string
}

export interface CalendarImportRowPreviewDTO {
  line: number
  title: string
  /** A coluna `Tag` como está na planilha — vira a etiqueta do evento. */
  tag: string
  /** Data civil YYYY-MM-DD, ou string vazia quando a linha nem chegou a parsear. */
  date: string
  /** Último dia, quando o evento ocupa mais de um. */
  endDate: string | null
  /** "Dia todo", "15:00–22:00" — já resolvido, para a tabela de conferência. */
  timeLabel: string
  /** Nome da CATEGORIA em que a tag caiu — é dela que saem cor, ícone e filtro. */
  typeName: string
  /** `true` quando o tipo ainda não existe e nascerá com a importação. */
  typeIsNew: boolean
  audienceTags: string[]
  action: CalendarImportRowAction
  /** Descrição legível do que muda, para linhas `UPDATE`. */
  changes: string[]
  issues: CalendarImportIssueDTO[]
}

/** O que será criado além dos eventos. */
export interface CalendarImportPlanDTO {
  typesToCreate: { name: string; color: string }[]
}

export interface CalendarImportPreviewDTO {
  /** sha256 do arquivo; o commit precisa mandar o mesmo. */
  fileHash: string
  totalRows: number
  counts: Record<CalendarImportRowAction, number>
  rows: CalendarImportRowPreviewDTO[]
  plan: CalendarImportPlanDTO
  /** `true` quando há qualquer linha com erro — o commit vai recusar. */
  blocked: boolean
  /** Avisos de arquivo (coluna ignorada, coluna desconhecida…). */
  warnings: string[]
}

export interface CalendarImportResultDTO {
  created: number
  updated: number
  unchanged: number
  typesCreated: string[]
}
