/**
 * Catálogo da Central de Cursos: categorias, competências e instrutores
 * (Documento 4, seções 9.6 — abas — e 9.7).
 *
 * As três eram **texto livre na tabela de curso**: `Course.category` era
 * `String`, `Course.competencies` era um `Json` de strings e o instrutor eram
 * dois campos soltos (`instructorName`, `instructorBio`). O efeito era o de
 * sempre: "Liderança" e "liderança " viram duas categorias, ninguém consegue
 * listar os cursos de uma competência, e o mesmo instrutor é redigitado a cada
 * curso.
 *
 * Três regras do repo valem aqui, e não são detalhe:
 *
 * - **Slug único por empresa**, não na instância (`@@unique([companyId, slug])`),
 *   como `Badge.slug`, `Sector.slug` e `BadgeCategory`. É a regra para model
 *   tenant-scoped.
 * - **Desativa-se, não se apaga**: categoria com curso atrás não pode sumir, e
 *   o slug é o que sobrevive a renomeação.
 * - **Instrutor interno não duplica cadastro**: quando ele é colaborador,
 *   `userId` aponta para o `User` e nome, foto e área saem de lá — o cadastro
 *   manual fica para quem é de fora.
 */

/** Categoria de curso. `parentId` preenchido = subcategoria. */
export interface CourseCategoryDTO {
  id: string
  name: string
  slug: string
  /** Emoji, como o documento pede. */
  icon: string | null
  /** A "categoria raiz" da seção 9.6; nulo quando ela mesma é raiz. */
  parentId: string | null
  parentName: string | null
  order: number
  active: boolean
  /** Quantos cursos apontam para ela — é o que impede apagar sem perceber. */
  courseCount: number
}

export interface CompetencyDTO {
  id: string
  name: string
  slug: string
  icon: string | null
  description: string | null
  active: boolean
  courseCount: number
}

/**
 * Instrutor. Quando `userId` está preenchido, `name`, `photoUrl` e `area` são
 * **derivados** do colaborador — a tela os mostra em modo leitura, porque a
 * fonte é o cadastro de pessoas e não este.
 */
export interface InstructorDTO {
  id: string
  userId: string | null
  name: string
  email: string | null
  photoUrl: string | null
  bio: string | null
  /** Área do colaborador quando interno; nulo para externo. */
  area: string | null
  expertise: string[]
  active: boolean
  courseCount: number
}

export const COURSE_CATEGORY_NAME_MAX_LENGTH = 60
export const COMPETENCY_NAME_MAX_LENGTH = 60
export const COMPETENCY_DESCRIPTION_MAX_LENGTH = 240
export const INSTRUCTOR_NAME_MAX_LENGTH = 120
export const INSTRUCTOR_BIO_MAX_LENGTH = 1000
export const MAX_INSTRUCTOR_EXPERTISE = 10
export const MAX_COURSE_INSTRUCTORS = 10
export const MAX_COURSE_COMPETENCIES = 20

export interface CreateCourseCategoryRequest {
  name: string
  icon?: string | null
  parentId?: string | null
  order?: number
}
export type UpdateCourseCategoryRequest = Partial<CreateCourseCategoryRequest> & { active?: boolean }

export interface CreateCompetencyRequest {
  name: string
  icon?: string | null
  description?: string | null
}
export type UpdateCompetencyRequest = Partial<CreateCompetencyRequest> & { active?: boolean }

export interface CreateInstructorRequest {
  /** Preenchido = colaborador da EMR; nome e área vêm da base. */
  userId?: string | null
  /** Obrigatório só para instrutor externo. */
  name?: string | null
  email?: string | null
  photoUrl?: string | null
  bio?: string | null
  expertise?: string[]
}
export type UpdateInstructorRequest = Partial<CreateInstructorRequest> & { active?: boolean }

export interface CourseCategoryListResponse {
  categories: CourseCategoryDTO[]
}
export interface CompetencyListResponse {
  competencies: CompetencyDTO[]
}
export interface InstructorListResponse {
  instructors: InstructorDTO[]
}

/**
 * Ordena categorias para exibição em árvore: cada raiz seguida das filhas.
 *
 * Pura de propósito — a API devolve a lista plana, e quem monta a hierarquia é
 * quem exibe. Uma resposta aninhada obrigaria a achatar de volta em todo lugar
 * que só precisa de um seletor.
 */
export function sortCategoriesAsTree(categories: readonly CourseCategoryDTO[]): CourseCategoryDTO[] {
  const raizes = categories.filter((c) => !c.parentId)
  const porPai = new Map<string, CourseCategoryDTO[]>()
  for (const categoria of categories) {
    if (!categoria.parentId) continue
    const irmas = porPai.get(categoria.parentId) ?? []
    irmas.push(categoria)
    porPai.set(categoria.parentId, irmas)
  }
  const porOrdem = (a: CourseCategoryDTO, b: CourseCategoryDTO) =>
    a.order - b.order || a.name.localeCompare(b.name, 'pt-BR')

  const saida: CourseCategoryDTO[] = []
  for (const raiz of [...raizes].sort(porOrdem)) {
    saida.push(raiz)
    saida.push(...(porPai.get(raiz.id) ?? []).sort(porOrdem))
  }
  // Subcategoria cujo pai foi desativado (e por isso não veio na lista) não pode
  // sumir da tela: entra no fim, em vez de desaparecer sem explicação.
  const vistos = new Set(saida.map((c) => c.id))
  saida.push(...categories.filter((c) => !vistos.has(c.id)).sort(porOrdem))
  return saida
}

// --- Público-alvo do curso (Documento 4, seção 9.2) --------------------------

/**
 * A **categoria do cargo** — o que a G&G chama de "Cargo" na coluna com
 * validação de dados da planilha de colaboradores, e que é a senioridade.
 *
 * Não confundir com `User.position`, que guarda o TÍTULO completo ("Analista de
 * CRM"): são 80 valores distintos para ~120 pessoas, e segmentar por eles
 * exigiria marcar 22 opções para alcançar os analistas. A categoria é a lista
 * fechada, e é ela que serve para segmentar.
 *
 * **Ela não é derivável do título.** Em 23 dos 80 títulos a primeira palavra não
 * bate com a categoria — `Desenvolvedor(a)` é Analista (14 pessoas), `Tech Lead`
 * é Team Leader, `CAO` é Diretor. Por isso vem importada, e não calculada.
 *
 * **ATENÇÃO — white label.** Esta lista é da EMR, como `EMR Coins` em outros 20
 * lugares do front. Num segundo cliente ela vira cadastro por empresa; não é
 * este lote que faz isso.
 */
export const POSITION_CATEGORIES = [
  'Auxiliar',
  'Assistente',
  'Jovem Aprendiz',
  'Técnico',
  'Analista',
  'Especialista',
  'Supervisor',
  'Coordenador',
  'Team Leader',
  'Gerente',
  'Head',
  'Diretor',
] as const
export type PositionCategory = (typeof POSITION_CATEGORIES)[number]

export function isPositionCategory(value: string): value is PositionCategory {
  return (POSITION_CATEGORIES as readonly string[]).includes(value)
}

/**
 * "Recomendado para" (seção 9.2) — rótulo, **não** regra de acesso. Um curso
 * recomendado para líderes continua visível para todo mundo; é o escopo que
 * restringe, e ele é outro campo.
 */
export const COURSE_RECOMMENDED_FOR = [
  'Todos',
  'Novos colaboradores',
  'Líderes',
  'Lideranças em formação',
] as const
export type CourseRecommendedFor = (typeof COURSE_RECOMMENDED_FOR)[number]

export const MAX_COURSE_AUDIENCE_SECTORS = 30

/** Teto da recompensa por curso — o suficiente para o valor não virar erro de
 *  digitação com três zeros a mais. */
export const MAX_COURSE_REWARD = 10_000

/** Padrões do documento (seção 9.6), usados no formulário de curso novo. */
export const DEFAULT_COURSE_REWARD_POINTS = 25
export const DEFAULT_COURSE_REWARD_COINS = 10
