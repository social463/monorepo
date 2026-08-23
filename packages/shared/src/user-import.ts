/**
 * Importação de colaboradores por planilha (CSV).
 *
 * O corpo das rotas de importação **não** é JSON: `preview` e `commit` recebem
 * `multipart/form-data` com um único campo `file`, e o `commit` leva o
 * `fileHash` na query string (`?fileHash=…`). Por isso aqui só moram as
 * constantes do formato e os DTOs de resposta — não há `…Request`.
 */

import type { UserRole } from './enums'

/** Colunas do template, nesta ordem. */
export const USER_IMPORT_COLUMNS = [
  'Nome',
  'E-mail',
  'Cargo',
  'Setor',
  'Squad',
  'Papel',
  'Área',
  'Líder (e-mail)',
  'Na equipe desde',
  'Data de nascimento',
] as const
export type UserImportColumn = (typeof USER_IMPORT_COLUMNS)[number]

/** Sem estas três não dá pra criar ninguém. O resto é opcional. */
export const USER_IMPORT_REQUIRED_COLUMNS = ['Nome', 'E-mail', 'Setor'] as const

/**
 * Colunas que o export de Lendas produz e a importação **reconhece para
 * ignorar** — a importação nunca desliga nem reativa ninguém. Ignorar em
 * silêncio seria pior: o admin editaria "Situação" achando que surte efeito.
 */
export const USER_IMPORT_IGNORED_COLUMNS = ['Situação', 'Desligado em'] as const

/**
 * Sinônimos aceitos no cabeçalho. O casamento é feito sem acento, sem caixa e
 * com espaços colapsados, então aqui basta a forma "achatada".
 */
export const USER_IMPORT_COLUMN_ALIASES: Record<UserImportColumn, readonly string[]> = {
  Nome: ['nome completo'],
  'E-mail': ['email', 'e mail'],
  Cargo: ['posicao', 'position'],
  Setor: ['departamento'],
  Squad: ['time', 'equipe'],
  Papel: ['funcao', 'papel na plataforma'],
  Área: ['area de atuacao'],
  'Líder (e-mail)': ['lider', 'lider direto', 'gestor', 'email do lider'],
  'Na equipe desde': ['data de admissao', 'admissao', 'data de entrada'],
  'Data de nascimento': ['nascimento', 'aniversario'],
}

/**
 * Linha de exemplo do template, na ordem de `USER_IMPORT_COLUMNS`. O líder fica
 * em branco de propósito: assim o template baixado e subido sem edição nenhuma
 * gera uma linha válida — dá pra experimentar o fluxo inteiro sem preencher nada.
 */
export const USER_IMPORT_TEMPLATE_EXAMPLE = [
  'Maria Souza',
  'maria.souza@empresa.com.br',
  'Analista de Dados Pleno',
  'Dados',
  'Squad Insights',
  'Lenda',
  'Engenharia',
  '',
  '01/02/2026',
  '15/07/1994',
] as const

export const USER_IMPORT_TEMPLATE_FILENAME = 'modelo-importacao-lendas.csv'

/**
 * Teto de linhas por arquivo. Não é limite de banco: cada pessoa criada custa um
 * hash bcrypt (~80 ms), e o lote inteiro ainda precisa caber numa transação.
 * Subir isso exige medir, não chutar.
 */
export const USER_IMPORT_MAX_ROWS = 200

/** 1 MiB. Uma planilha de 200 linhas não chega perto disso. */
export const USER_IMPORT_MAX_FILE_BYTES = 1_048_576

/**
 * Papéis que a planilha pode atribuir. ADMIN, SUBADMIN, SUPER_ADMIN e
 * THIRD_PARTY ficam de fora de propósito: criar administrador a partir de um
 * upload é escalada de privilégio sem etapa de revisão, e terceirizado tem
 * fluxo próprio (convite + features). É o mesmo conjunto que participa do
 * organograma, então validar o líder fica automático.
 */
export const USER_IMPORT_ROLES = ['LEGEND', 'LEAD', 'MANAGER', 'HEAD'] as const satisfies readonly UserRole[]
export type UserImportRole = (typeof USER_IMPORT_ROLES)[number]

/**
 * O que vai acontecer com cada linha.
 * - `CREATE`    pessoa nova
 * - `UPDATE`    pessoa que já existe e tem algo a mudar
 * - `UNCHANGED` pessoa que já existe e está igual (é o que prova que reimportar não duplica)
 * - `SKIP`      pessoa desligada/inativa: não bloqueia o arquivo, mas nada é alterado
 * - `ERROR`     linha inválida; qualquer uma delas trava o arquivo inteiro
 */
export const USER_IMPORT_ROW_ACTIONS = ['CREATE', 'UPDATE', 'UNCHANGED', 'SKIP', 'ERROR'] as const
export type UserImportRowAction = (typeof USER_IMPORT_ROW_ACTIONS)[number]

export const USER_IMPORT_ROW_ACTION_LABELS: Record<UserImportRowAction, string> = {
  CREATE: 'Criar',
  UPDATE: 'Atualizar',
  UNCHANGED: 'Sem mudança',
  SKIP: 'Ignorada',
  ERROR: 'Erro',
}

export interface UserImportIssueDTO {
  /** Número da linha **física** no arquivo — o mesmo que a pessoa vê no Excel. */
  line: number
  /** `null` quando o problema é da linha inteira, não de uma coluna. */
  column: UserImportColumn | null
  message: string
}

export interface UserImportRowPreviewDTO {
  line: number
  name: string
  email: string
  action: UserImportRowAction
  sectorName: string
  squadName: string | null
  /** Descrição legível do que muda, para linhas `UPDATE`. */
  changes: string[]
  issues: UserImportIssueDTO[]
}

/** O que será criado além das pessoas. */
export interface UserImportPlanDTO {
  sectorsToCreate: { name: string; roles: UserImportRole[] }[]
  squadsToCreate: { name: string; sectorName: string }[]
}

export interface UserImportPreviewDTO {
  /** sha256 do arquivo; o commit precisa mandar o mesmo. */
  fileHash: string
  totalRows: number
  counts: Record<UserImportRowAction, number>
  rows: UserImportRowPreviewDTO[]
  plan: UserImportPlanDTO
  /** `true` quando há qualquer linha com erro — o commit vai recusar. */
  blocked: boolean
  /** Avisos de arquivo (coluna ignorada, coluna desconhecida…). */
  warnings: string[]
}

/** Senha em texto puro. Só existe na resposta do commit; nunca é persistida nem logada. */
export interface UserImportCredentialDTO {
  name: string
  email: string
  password: string
}

export interface UserImportResultDTO {
  created: number
  updated: number
  unchanged: number
  skipped: number
  sectorsCreated: string[]
  squadsCreated: string[]
  credentials: UserImportCredentialDTO[]
}
