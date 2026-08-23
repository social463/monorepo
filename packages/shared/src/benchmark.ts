/**
 * Contrato do inventário de práticas internas de cultura — a base de comparação
 * que o agente de Benchmarking usa como contexto.
 *
 * A prática é **da empresa**, não de um setor: uma ação de endomarketing não
 * pertence a um setor, e a comparação é sempre empresa × mercado.
 */

export const BENCHMARK_PRACTICE_TITLE_MAX_LENGTH = 120
export const BENCHMARK_PRACTICE_DESCRIPTION_MAX_LENGTH = 2000
export const BENCHMARK_PRACTICE_CHANNEL_MAX_LENGTH = 80
export const BENCHMARK_PRACTICE_CATEGORY_MAX_LENGTH = 60
export const BENCHMARK_PRACTICE_MAX_TAGS = 10
export const BENCHMARK_PRACTICE_TAG_MAX_LENGTH = 40

/**
 * Categorias sugeridas no formulário. É lista aberta de propósito — a categoria
 * vai para o prompt como texto, e travar o vocabulário só empobreceria a
 * comparação para uma empresa de outro segmento.
 */
export const BENCHMARK_PRACTICE_CATEGORIES: readonly string[] = [
  'Cultura organizacional',
  'Endomarketing',
  'Benefícios corporativos',
  'Comunicação interna',
  'Employer Branding',
  'Experiência do colaborador',
  'Diversidade e inclusão',
  'Desenvolvimento humano',
  'Engajamento',
  'Saúde mental',
  'Reconhecimento',
  'Liderança',
  'ESG humano',
  'Jornada do colaborador',
]

export interface BenchmarkPracticeDTO {
  id: string
  category: string
  title: string
  description: string | null
  /** Canal de divulgação: LinkedIn, Teams, Notion… */
  channel: string | null
  tags: string[]
  createdById: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateBenchmarkPracticeRequest {
  category: string
  title: string
  description?: string | null
  channel?: string | null
  tags?: string[]
}

export type UpdateBenchmarkPracticeRequest = Partial<CreateBenchmarkPracticeRequest>

export interface BenchmarkPracticeListResponse {
  practices: BenchmarkPracticeDTO[]
}
