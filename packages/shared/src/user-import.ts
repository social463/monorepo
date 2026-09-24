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
  // Desde o Documento 3 (seção 4.4) a Situação é LIDA, não ignorada: "Desligado"
  // desativa a pessoa. Ver `USER_IMPORT_ROW_ACTIONS`.
  'Situação',
  'Desligado em',
  // CLT ou PJ. Vazio mantém o que já está gravado — nunca devolve alguém para
  // CLT em silêncio, porque regime é fato do contrato e não pode ser apagado
  // por uma coluna esquecida numa carga de 100 linhas.
  'Tipo de contrato',
  // A lista fechada da planilha da G&G — Auxiliar, Assistente, Analista… É ela
  // que segmenta curso (Documento 4, seção 9.2). Nome próprio, e não 'Cargo',
  // porque na planilha da G&G AS DUAS colunas se chamam Cargo, e a importação
  // recusa cabeçalho repetido.
  //
  // No FIM da lista de propósito: o casamento é por nome de cabeçalho, então a
  // posição não muda o comportamento — mas anexar mantém a ordem que quem já
  // baixou o modelo conhece, e inserir no meio a embaralharia.
  'Categoria do cargo',
  // Link da foto do colaborador. A planilha da G&G traz links do Google Drive,
  // que abrem uma PÁGINA, não a imagem — quem converte para a URL de conteúdo é
  // `normalizePhotoSourceUrl` na API. Célula vazia mantém a foto gravada: foto
  // some por ação explícita em Administração › Lendas, nunca por uma coluna que
  // faltou numa carga de 100 linhas (mesma regra do Tipo de contrato).
  'Foto (URL)',
] as const
export type UserImportColumn = (typeof USER_IMPORT_COLUMNS)[number]

/** Sem estas três não dá pra criar ninguém. O resto é opcional. */
export const USER_IMPORT_REQUIRED_COLUMNS = ['Nome', 'E-mail', 'Setor'] as const

/**
 * Colunas reconhecidas só para serem ignoradas. Vazia hoje: `Situação` e
 * `Desligado em` passaram a ter efeito (seção 4.4 do Documento 3).
 *
 * A lista fica de pé porque o mecanismo continua útil — coluna reconhecida e
 * ignorada em silêncio faria o admin editar um campo achando que surte efeito.
 */
export const USER_IMPORT_IGNORED_COLUMNS: readonly string[] = []

/**
 * Sinônimos aceitos no cabeçalho. O casamento é feito sem acento, sem caixa e
 * com espaços colapsados, então aqui basta a forma "achatada".
 */
export const USER_IMPORT_COLUMN_ALIASES: Record<UserImportColumn, readonly string[]> = {
  Nome: ['nome completo'],
  'E-mail': ['email', 'e mail'],
  Cargo: ['posicao', 'position'],
  // 'Senioridade' e 'Nível do cargo' NÃO são sinônimos: a planilha de
  // colaboradores da G&G traz as duas colunas lado a lado com dados
  // diferentes (ex. "Sênior" + "Diretor"), então tratá-las como o mesmo
  // campo colidia como cabeçalho repetido e/ou sobrescrevia um valor pelo
  // outro. Senioridade não tem campo próprio no Legends hoje — fica de fora.
  'Categoria do cargo': ['categoria de cargo'],
  Setor: ['departamento'],
  Squad: ['time', 'equipe'],
  // 'Função' NÃO é alias direto: na planilha da G&G ela só tem dois valores
  // (Colaborador/Líder), que não bastam pra decidir entre Líder/Gerente/Head.
  // A importação deriva o Papel de Função + Categoria do cargo quando a
  // coluna Papel não vem — ver `user-import-service.ts`.
  Papel: ['papel na plataforma'],
  Área: ['area de atuacao'],
  // 'Líder' (sem "(e-mail)") é o nome da coluna na planilha da G&G, mas o
  // valor lá é o NOME curto da pessoa, não o e-mail. A importação aceita os
  // dois: se o valor não parece e-mail, resolve por nome — ver
  // `user-import-service.ts`.
  'Líder (e-mail)': ['lider', 'lider direto', 'gestor', 'email do lider'],
  'Na equipe desde': ['data de admissao', 'admissao', 'data de entrada', 'contratacao'],
  'Data de nascimento': ['nascimento', 'aniversario'],
  Situação: ['status', 'situacao do colaborador'],
  'Desligado em': ['data de desligamento', 'desligamento', 'data de saida'],
  'Tipo de contrato': ['contrato', 'regime', 'regime de contratacao', 'vinculo'],
  'Foto (URL)': ['foto', 'foto do colaborador', 'link da foto', 'url da foto', 'imagem', 'avatar'],
}

/**
 * Valores de `Situação` que **desativam** a pessoa. Qualquer outro valor não
 * mexe no cadastro: a importação desliga, mas **nunca reativa**.
 *
 * Os dois sentidos não têm risco simétrico. Desligar alguém por engano custa um
 * clique para desfazer em Administração › Lendas; reabrir o acesso de quem saiu
 * da empresa por causa de uma célula errada não se desfaz.
 */
export const USER_IMPORT_INACTIVE_STATUSES = ['desligado', 'inativo', 'desligada'] as const

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
  'Ativo',
  '',
  'CLT',
  'Analista',
  '',
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
 * - `DEACTIVATE` pessoa marcada como "Desligado" na planilha: sai do ar, mas o
 *   histórico (pontos, coins, feedbacks, selos) fica intacto — desativar não é apagar
 * - `SKIP`      pessoa já inativa na plataforma: nada é alterado (a importação não reativa)
 * - `ERROR`     linha inválida; qualquer uma delas trava o arquivo inteiro
 */
export const USER_IMPORT_ROW_ACTIONS = [
  'CREATE',
  'UPDATE',
  'UNCHANGED',
  'DEACTIVATE',
  'SKIP',
  'ERROR',
] as const
export type UserImportRowAction = (typeof USER_IMPORT_ROW_ACTIONS)[number]

export const USER_IMPORT_ROW_ACTION_LABELS: Record<UserImportRowAction, string> = {
  CREATE: 'Criar',
  UPDATE: 'Atualizar',
  UNCHANGED: 'Sem mudança',
  DEACTIVATE: 'Desativar',
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
  /**
   * Squads que já existem e mudam de setor porque a planilha levou a gente
   * delas para outro lugar. A squad vai junto ou a importação recusa — ver
   * `2026-09-08-excluir-squad-e-mover-squad-na-importacao-design.md`.
   */
  squadsToMove: { name: string; fromSectorName: string; toSectorName: string }[]
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
  squadsMoved: string[]
  credentials: UserImportCredentialDTO[]
  /** Quantas fotos a importação baixou e re-hospedou nesta carga. */
  photosImported: number
  /**
   * Linhas cuja foto não pôde ser baixada. É **aviso**, não erro: o resto do
   * cadastro entra. Link do Drive que exige login é o caso comum, e travar a
   * carga inteira por causa de uma permissão de arquivo seria desproporcional.
   */
  photoWarnings: string[]
}
