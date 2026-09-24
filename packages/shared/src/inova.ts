import type { AskAgentRequest } from './agent'
import type { PublicUser } from './auth'
import { canAdminister, type AdminSubject } from './permissions'

export type InovaProjectPhase =
  | 'IDEA'
  | 'EXPLORING_SOLUTION'
  | 'TESTING_SOLUTION'
  | 'ROUTINE_USE'
  | 'EXPANDING'
  | 'COMPLETED'

/** Ordem do kanban de projetos do INOVA — a mesma progressão do projeto original. */
export const INOVA_PROJECT_PHASES: { value: InovaProjectPhase; label: string }[] = [
  { value: 'IDEA', label: 'Ideia do Projeto' },
  { value: 'EXPLORING_SOLUTION', label: 'Explorando a Solução' },
  { value: 'TESTING_SOLUTION', label: 'Testando a Solução' },
  { value: 'ROUTINE_USE', label: 'Usando na Rotina' },
  { value: 'EXPANDING', label: 'Expandindo para Mais Pessoas' },
  { value: 'COMPLETED', label: 'Concluído' },
]

/**
 * Peso de cada fase para o painel "Evolução das Áreas" — soma dos pontos de
 * todos os projetos não arquivados de um setor. Mesma escala do projeto
 * original: quanto mais avançada a fase, mais pontos.
 */
export const INOVA_PHASE_POINTS: Record<InovaProjectPhase, number> = {
  IDEA: 1,
  EXPLORING_SOLUTION: 2,
  TESTING_SOLUTION: 3,
  ROUTINE_USE: 4,
  EXPANDING: 5,
  COMPLETED: 6,
}

/** Descrição de cada fase — usada na página que explica o ranking. */
export const INOVA_PHASE_DESCRIPTIONS: Record<InovaProjectPhase, string> = {
  IDEA: 'Uma ideia inicial de como a IA pode resolver um problema do setor.',
  EXPLORING_SOLUTION: 'Estamos estudando se a ideia é possível e quais ferramentas ou dados serão necessários.',
  TESTING_SOLUTION: 'Já existe um primeiro teste ou protótipo para validar se a solução funciona.',
  ROUTINE_USE: 'A solução já está sendo utilizada no dia a dia do setor.',
  EXPANDING: 'A solução está sendo ampliada para outras equipes ou processos.',
  COMPLETED: 'O projeto foi finalizado e entregou os resultados esperados.',
}

export type InovaDiaryEntryType = 'MANUAL' | 'AUTOMATIC'

export type InovaTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE'

export const INOVA_TASK_STATUSES: { value: InovaTaskStatus; label: string }[] = [
  { value: 'PENDING', label: 'Pendente' },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'DONE', label: 'Concluída' },
]

/** Sugestão de setor no formulário de projeto — texto livre, não é FK de `Sector`. */
export const INOVA_SUGGESTED_SECTORS = [
  'Desenvolvimento de Produto',
  'Estratégia e Finanças',
  'Marketing',
  'Ensino',
  'Comercial',
  'B2B',
  'CX',
  'Gente & Gestão',
]

/**
 * Chave de comparação de setor do INOVA.
 *
 * `InovaProject.sector` é texto livre — os projetos importados do INOVA
 * original gravaram "Gente & Gestão" —, enquanto o cadastro de setores da
 * empresa escreve "Gente e Gestão". Comparar o texto cru dava G&G como "sem
 * projetos" no painel mesmo com cinco projetos dele. A chave ignora caixa,
 * acento, pontuação e trata "&" como "e"; a sigla "G&G" cai no mesmo lugar.
 */
export function inovaSectorKey(name: string): string {
  const key = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return INOVA_SECTOR_ALIASES[key] ?? key
}

const INOVA_SECTOR_ALIASES: Record<string, string> = {
  'g e g': 'gente e gestao',
  gg: 'gente e gestao',
  'gente gestao': 'gente e gestao',
}

/**
 * Sugestão de categoria no formulário de projeto — texto livre, não é enum
 * fechado no backend (mesmo critério de `INOVA_SUGGESTED_SECTORS`). O emoji
 * é só apresentação (badge do card), não é usado como identificador.
 */
export const INOVA_PROJECT_CATEGORIES: { value: string; icon: string }[] = [
  { value: 'Automação de processos', icon: '⚡' },
  { value: 'Experiência do cliente', icon: '💬' },
  { value: 'Análise de dados', icon: '📊' },
  { value: 'Marketing / conteúdo', icon: '📢' },
  { value: 'Educação / ensino', icon: '🎓' },
  { value: 'Produtividade interna', icon: '🚀' },
  { value: 'Outro', icon: '💡' },
]

/** Emoji de categoria para o card do kanban; categoria sem match usa o de "Outro". */
export function inovaCategoryIcon(category: string): string {
  return INOVA_PROJECT_CATEGORIES.find((c) => c.value === category)?.icon ?? '💡'
}

export interface InovaProjectDTO {
  id: string
  title: string
  category: string
  sector: string
  description: string
  problemDescription: string | null
  results: string | null
  hoursSaved: number | null
  costReduction: number | null
  otherMetrics: string | null
  projectCosts: string | null
  toolsUsed: string | null
  deadline: string | null
  priority: boolean
  leadershipChallenge: boolean
  estimatedDeadline: string | null
  sectorRepresentative: string | null
  responsible1: PublicUser | null
  responsible2: PublicUser | null
  phase: InovaProjectPhase
  archived: boolean
  createdById: string
  createdByName: string
  createdAt: string
  updatedAt: string
  /**
   * Linha do tempo resumida — SÓ a listagem (`GET /inova/projects`) preenche.
   * O painel administrativo conta um projeto no período quando ele foi criado,
   * mudou de fase ou ganhou registro no diário dentro dele, e o gráfico de
   * evolução traça os avanços de fase por mês. Sem isso, cada um pediria o
   * detalhe de todos os projetos. Opcional porque criar/editar/mudar fase
   * devolvem o projeto sem esse histórico — ausente não quer dizer vazio.
   */
  phaseHistory?: { phase: InovaProjectPhase; occurredAt: string }[]
  /** Datas (`occurredAt`, ISO) das entradas do diário de bordo — mesma regra de `phaseHistory`. */
  diaryDates?: string[]
}

/** Teto de projetos que o painel manda para recortar o chat — cobre a empresa inteira com folga. */
export const INOVA_ADMIN_CHAT_MAX_PROJECT_IDS = 500

/**
 * Pergunta ao "IA Analista do Painel". `projectIds` recorta a análise aos
 * projetos que o painel está mostrando (setor e período do filtro global):
 * sem ele a IA respondia sobre a empresa inteira enquanto a tela mostrava só
 * um setor. O servidor ainda cruza os ids com a empresa de quem pergunta.
 */
export interface InovaAdminChatAskRequest extends AskAgentRequest {
  projectIds?: string[]
}

/** Payload de criação/edição de projeto — responsáveis vão por id de usuário cadastrado. */
export interface InovaProjectInput {
  title: string
  category: string
  sector: string
  description: string
  problemDescription?: string | null
  results?: string | null
  hoursSaved?: number | null
  costReduction?: number | null
  otherMetrics?: string | null
  projectCosts?: string | null
  toolsUsed?: string | null
  deadline?: string | null
  priority?: boolean
  leadershipChallenge?: boolean
  estimatedDeadline?: string | null
  sectorRepresentative?: string | null
  responsible1Id?: string | null
  responsible2Id?: string | null
}

export interface InovaPhaseHistoryDTO {
  id: string
  projectId: string
  phase: InovaProjectPhase
  note: string | null
  occurredAt: string
}

export interface InovaDiaryEntryDTO {
  id: string
  projectId: string
  title: string
  description: string | null
  learnings: string | null
  tools: string | null
  entryType: InovaDiaryEntryType
  occurredAt: string
  imageUrls: string[]
  videoLinks: string[]
  externalLinks: string[]
  createdById: string
  createdByName: string
  createdAt: string
}

export interface InovaProjectTaskDTO {
  id: string
  projectId: string
  title: string
  description: string | null
  responsible: string | null
  dueDate: string | null
  status: InovaTaskStatus
  createdAt: string
  updatedAt: string
}

export interface InovaActivityDTO {
  id: string
  projectId: string
  action: string
  entity: string
  summary: string
  actorId: string
  actorName: string
  details: Record<string, unknown> | null
  createdAt: string
}

export interface InovaProjectListResponse {
  projects: InovaProjectDTO[]
}

export interface InovaProjectDetailResponse {
  project: InovaProjectDTO
  phaseHistory: InovaPhaseHistoryDTO[]
  diaryEntries: InovaDiaryEntryDTO[]
  tasks: InovaProjectTaskDTO[]
  activity: InovaActivityDTO[]
}

// ---------------------------------------------------------------------------
// Biblioteca de vídeos do Guia AI First
// ---------------------------------------------------------------------------

export const INOVA_GUIA_VIDEO_TITLE_MAX_LENGTH = 200
export const INOVA_GUIA_VIDEO_DESCRIPTION_MAX_LENGTH = 2000
export const INOVA_GUIA_VIDEO_CATEGORY_MAX_LENGTH = 100
export const INOVA_GUIA_VIDEO_DURATION_MAX_LENGTH = 50
export const INOVA_GUIA_VIDEO_BEHAVIOR_MAX_LENGTH = 500

/**
 * Uma linha da biblioteca de vídeos do Guia AI First — SOBRESCRITA de um
 * vídeo do catálogo estático (`content/videos.ts`, em `apps/web`) quando
 * `videoId` bate com um id de lá, ou CARD CUSTOM quando não bate. A API não
 * conhece o catálogo (ele é conteúdo estático do front); o merge acontece no
 * cliente.
 */
export interface InovaGuiaVideoDTO {
  id: string
  videoId: string
  title: string | null
  description: string | null
  category: string | null
  duration: string | null
  behavior: string | null
  /** Link externo, ou a URL pública do arquivo enviado — o que estiver preenchido. Null se não há vídeo. */
  videoUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface InovaGuiaVideoListResponse {
  videos: InovaGuiaVideoDTO[]
}

// ---------------------------------------------------------------------------
// Quem pode mexer num projeto
// ---------------------------------------------------------------------------

/** Os donos de um projeto: quem cadastrou e os dois responsáveis indicados. */
export interface InovaProjectOwnership {
  createdById: string
  responsible1Id?: string | null
  responsible2Id?: string | null
}

/**
 * Pode editar, mudar de fase e excluir ESTE projeto?
 *
 * Cadastrar projeto é de qualquer colaborador — a comunidade é da empresa
 * inteira. O que é restrito é mexer no projeto DOS OUTROS: passa quem
 * administra o INOVA e passam os donos, que o próprio formulário define como
 * "responsáveis por atualizar o andamento". Curadoria do programa — prioridade
 * e arquivamento — continua só de quem administra (`canAdminister`), e quem
 * recusa é o service.
 *
 * Fonte única do front e da API: a tela esconde o que a rota recusaria.
 */
export function canManageInovaProject(
  user: (AdminSubject & { id?: string | null }) | null | undefined,
  project: InovaProjectOwnership | null | undefined,
): boolean {
  if (!user || !project) return false
  if (canAdminister(user)) return true
  if (!user.id) return false
  const donos: (string | null | undefined)[] = [
    project.createdById,
    project.responsible1Id,
    project.responsible2Id,
  ]
  return donos.includes(user.id)
}

/**
 * Ownership a partir do DTO, que traz os responsáveis como usuário inteiro.
 * O front tem o DTO; a API tem a linha do banco, com os `*Id` crus.
 */
export function inovaProjectOwnershipOf(project: {
  createdById: string
  responsible1: { id: string } | null
  responsible2: { id: string } | null
}): InovaProjectOwnership {
  return {
    createdById: project.createdById,
    responsible1Id: project.responsible1?.id ?? null,
    responsible2Id: project.responsible2?.id ?? null,
  }
}
