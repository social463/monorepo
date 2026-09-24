/**
 * Indicadores da Central de Cursos (Documento 4, seção 9.6 — Dashboard).
 *
 * **Não se confunde com o Analytics de T&D** (Lote C, `training-analytics.ts`),
 * e a diferença não é de tela: são perguntas diferentes.
 *
 * - T&D pergunta **"o time se desenvolveu?"** — conclusões por setor e por
 *   cargo, numa janela. É de Gente e Gestão, e mora em People Analytics.
 * - Este pergunta **"o catálogo está saudável?"** — quantos cursos existem, em
 *   que estado, quanto do que começa termina. É de quem escreve curso, e mora
 *   na Central de Cursos.
 *
 * Por isso ele **não** tem recorte de janela nem de setor: catálogo é estoque.
 */

import type { CourseStatus } from './learning'

export interface CourseStatusSliceDTO {
  status: CourseStatus
  count: number
}

/** Linha das duas tabelas do dashboard. */
export interface CourseDashboardRowDTO {
  courseId: string
  title: string
  enrollments: number
  /** Percentual de inscrições abandonadas (0..100). */
  abandonedPct: number
}

export interface CourseDashboardDTO {
  total: number
  byStatus: CourseStatusSliceDTO[]
  /** Pessoas distintas com ao menos uma inscrição. */
  studentsEnrolled: number
  /** Inscrições concluídas ÷ inscrições (0..100). */
  completionPct: number
  /** Soma da duração das aulas dos cursos publicados, em horas. */
  hoursOffered: number
  /** Média das avaliações (0..5); zero quando ninguém avaliou ainda. */
  averageRating: number
  totalRatings: number
  /**
   * Cursos com mais inscritos.
   *
   * O documento pede "cursos mais acessados", e o portal **não sabe responder
   * isso**: `AccessLog` troca o id por `:id` antes de gravar (senão "telas mais
   * acessadas" viraria milhares de linhas com contagem 1), e não há evento de
   * abertura de curso. Inscrição é o sinal mais próximo que existe, e o título
   * diz o que é medido em vez de prometer o que não é.
   */
  mostEnrolled: CourseDashboardRowDTO[]
  /** Cursos com maior abandono. */
  mostAbandoned: CourseDashboardRowDTO[]
}

export interface CourseDashboardResponse {
  dashboard: CourseDashboardDTO
}

/**
 * Dias sem atividade a partir dos quais uma inscrição em andamento conta como
 * abandonada.
 *
 * Não é "não concluiu": quem se inscreveu ontem não abandonou nada, e contá-lo
 * faria todo curso novo nascer com abandono alto. Trinta dias é o intervalo em
 * que "vou terminar depois" já virou "não vou".
 */
export const COURSE_ABANDON_AFTER_DAYS = 30

/**
 * Mínimo de inscrições para um curso entrar na tabela de abandono. Sem ele, um
 * curso com uma inscrição parada apareceria com 100% e ocuparia o topo — número
 * verdadeiro e conclusão errada.
 */
export const COURSE_ABANDON_MIN_ENROLLMENTS = 5

export const COURSE_DASHBOARD_ROWS = 5
