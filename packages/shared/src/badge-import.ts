/**
 * Importação e exportação do catálogo de selos por planilha (Documento 4,
 * seção 11.5).
 *
 * A G&G já mantém todos os selos numa planilha — o que faltava nela era a
 * coluna de ícone. Este formato é o dessa planilha mais o que o portal precisa
 * saber, e o **export traz exatamente as mesmas colunas do template**: é o que
 * fecha o ciclo exportar → editar → importar sem reescrever nada à mão.
 *
 * Como em `calendar-event-import`, o corpo das rotas **não** é JSON: `preview`
 * e `commit` recebem `multipart/form-data` com um único campo `file`, e o
 * `commit` leva o `fileHash` na query. Aqui moram só as constantes do formato e
 * os DTOs de resposta.
 */

/** Colunas do template, nesta ordem. */
export const BADGE_IMPORT_COLUMNS = [
  'Nome',
  'Descrição',
  'Tipo',
  'Tema',
  'Ícone',
  'Limiar',
  'Categoria de reconhecimento',
  'Pontos',
  'EMR Coins',
] as const
export type BadgeImportColumn = (typeof BADGE_IMPORT_COLUMNS)[number]

/** Sem estas três não existe selo. O resto é opcional. */
export const BADGE_IMPORT_REQUIRED_COLUMNS = ['Nome', 'Descrição', 'Tipo'] as const

/**
 * Sinônimos aceitos no cabeçalho. O casamento é feito sem acento, sem caixa e
 * com espaços colapsados, então aqui basta a forma "achatada".
 */
export const BADGE_IMPORT_COLUMN_ALIASES: Record<BadgeImportColumn, readonly string[]> = {
  Nome: ['selo', 'nome do selo', 'emblema', 'nome do emblema'],
  'Descrição': ['descricao', 'detalhe', 'detalhes'],
  Tipo: ['tipo do selo', 'regra', 'kind'],
  Tema: ['categoria', 'categoria do selo', 'grupo', 'tema do selo'],
  'Ícone': ['icone', 'arte', 'ilustracao', 'imagem'],
  Limiar: ['limite', 'meta', 'quantidade', 'threshold'],
  'Categoria de reconhecimento': [
    'categoria de feedback',
    'categoria do feedback',
    'slug da categoria',
    'categoria reconhecimento',
  ],
  Pontos: ['pontuacao', 'xp', 'recompensa em pontos'],
  'EMR Coins': ['coins', 'moedas', 'emr coin', 'recompensa em coins'],
}

/** Linha de exemplo do template, na ordem de `BADGE_IMPORT_COLUMNS`. */
export const BADGE_IMPORT_TEMPLATE_EXAMPLE = [
  'Voz que constrói',
  'Deu dez feedbacks de Colaboração para colegas.',
  'Por categoria',
  'Feedback',
  'chat',
  '10',
  'colaboracao',
  '50',
  '20',
] as const

export const BADGE_IMPORT_TEMPLATE_FILENAME = 'modelo-importacao-selos.csv'
export const BADGE_EXPORT_FILENAME = 'selos.csv'

/**
 * Teto de linhas por arquivo. O catálogo da EMR tem algumas dezenas de selos; o
 * limite existe para um arquivo errado não virar transação de minutos.
 */
export const BADGE_IMPORT_MAX_ROWS = 500

/** 1 MiB. Uma planilha de 500 selos não chega perto disso. */
export const BADGE_IMPORT_MAX_FILE_BYTES = 1_048_576

/**
 * O que vai acontecer com cada linha.
 * - `CREATE`    selo novo
 * - `UPDATE`    selo que já existe e tem algo a mudar
 * - `UNCHANGED` selo que já existe e está igual (é o que prova que reimportar não duplica)
 * - `ERROR`     linha inválida; qualquer uma delas trava o arquivo inteiro
 */
export const BADGE_IMPORT_ROW_ACTIONS = ['CREATE', 'UPDATE', 'UNCHANGED', 'ERROR'] as const
export type BadgeImportRowAction = (typeof BADGE_IMPORT_ROW_ACTIONS)[number]

export const BADGE_IMPORT_ROW_ACTION_LABELS: Record<BadgeImportRowAction, string> = {
  CREATE: 'Criar',
  UPDATE: 'Atualizar',
  UNCHANGED: 'Sem mudança',
  ERROR: 'Erro',
}

export interface BadgeImportIssueDTO {
  /** Número da linha **física** no arquivo — o mesmo que a pessoa vê no Excel. */
  line: number
  /** `null` quando o problema é da linha inteira, não de uma coluna. */
  column: BadgeImportColumn | null
  message: string
}

export interface BadgeImportRowPreviewDTO {
  line: number
  name: string
  /** Rótulo do tipo, como está na planilha. */
  kindLabel: string
  /** Nome do tema; vazio quando a linha não classificou. */
  categoryName: string
  threshold: number
  rewardPoints: number | null
  rewardCoins: number | null
  action: BadgeImportRowAction
  /** Descrição legível do que muda, para linhas `UPDATE`. */
  changes: string[]
  issues: BadgeImportIssueDTO[]
}

export interface BadgeImportPreviewDTO {
  /** sha256 do arquivo; o commit precisa mandar o mesmo. */
  fileHash: string
  totalRows: number
  counts: Record<BadgeImportRowAction, number>
  rows: BadgeImportRowPreviewDTO[]
  /** `true` quando há qualquer linha com erro — o commit vai recusar. */
  blocked: boolean
  /** Avisos de arquivo (coluna desconhecida, por exemplo). */
  warnings: string[]
}

export interface BadgeImportResultDTO {
  created: number
  updated: number
  unchanged: number
}
