/**
 * Analytics de Treinamento e Desenvolvimento (Documento 4, seção 9.5).
 *
 * A trilha de **Desenvolvimento & IA** da área administrativa de analytics,
 * ao lado de People Analytics e Comunicação Interna — que são abas da mesma
 * seção, e é por isso que esta também é.
 *
 * O fato contado é a **conclusão**, datada por `CourseEnrollment.completedAt`:
 * quem se inscreveu em janeiro e concluiu em agosto conta em agosto, que é
 * quando o treinamento aconteceu.
 */

/** Uma área na distribuição de conclusões. */
export interface TrainingSectorSliceDTO {
  sectorId: string
  sectorName: string
  completions: number
}

/** Linha da tabela "Cursos com mais conclusões". */
export interface TrainingTopCourseDTO {
  courseId: string
  title: string
  mandatory: boolean
  completions: number
}

export interface TrainingOverviewDTO {
  from: string
  to: string
  days: number
  sectorId: string | null
  /** Cargo do recorte (`User.position`); null = todos. */
  position: string | null

  /**
   * Cursos publicados da empresa.
   *
   * **Não é recortado pela janela**: o catálogo é um estoque, não um fluxo —
   * "quantos treinamentos existem" não muda porque alguém filtrou julho.
   */
  coursesPublished: number

  /** Conclusões na janela, já recortadas por setor e cargo. */
  completions: number

  /**
   * Conclusões ÷ colaboradores ativos do recorte. Zero colaboradores devolve
   * `0`, e não `NaN` — a tela mostra número, não "não é um número".
   */
  completionsPerCollaborator: number

  /**
   * Das inscrições em curso obrigatório, quantas estão concluídas (0..100).
   *
   * **É sobre inscrição, não sobre pessoa**, e **ignora a janela**. A conta
   * "quantas pessoas concluíram todos os obrigatórios" é mais bonita e mais
   * cara: exigiria cruzar cada colaborador com o catálogo obrigatório que o
   * alcança (curso tem `sectorId`), e um obrigatório publicado ontem derrubaria
   * o indicador da empresa para perto de zero. A razão sobre inscrições
   * responde "o que foi começado está sendo terminado?", que é a pergunta
   * operacional da G&G. É estado, não fluxo — daí a janela não valer aqui.
   */
  mandatoryCompletedPct: number
  /** Denominador do indicador acima, para a tela poder dizer "de N". */
  mandatoryEnrollments: number

  /**
   * Distribuição das conclusões por setor **da pessoa que concluiu**, e não do
   * curso: a pergunta é qual área se desenvolveu, não qual publicou o curso.
   */
  completionsBySector: TrainingSectorSliceDTO[]
  topCourses: TrainingTopCourseDTO[]
}

export interface TrainingOverviewResponse {
  training: TrainingOverviewDTO
  /**
   * Cargos em uso na empresa, para o seletor.
   *
   * Sai dos valores DISTINTOS de `User.position`, que é texto livre — não há
   * tabela de cargos. É o comportamento certo para um campo assim: cargo que
   * ninguém tem não deveria aparecer como filtro.
   */
  positions: string[]
}

/** Quantas linhas a tabela "Cursos com mais conclusões" mostra. */
export const TRAINING_TOP_COURSES_LIMIT = 10
