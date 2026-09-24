/**
 * Analytics de Treinamento e Desenvolvimento (Documento 4, seção 9.5).
 *
 * A trilha de **Desenvolvimento & IA** da área de analytics. Reusa a janela e o
 * recorte por setor de `people-analytics-service` — os mesmos filtros valem
 * para todas as abas da seção, e ter dois resolvedores de período faria os
 * painéis discordarem sobre o que é "últimos 30 dias".
 *
 * O fato contado é a **conclusão**, datada por `CourseEnrollment.completedAt`:
 * quem se inscreveu em janeiro e concluiu em agosto conta em agosto, que é
 * quando o treinamento aconteceu. Datar por `createdAt` responderia "quando a
 * pessoa se interessou", que é outra pergunta.
 *
 * O recorte por setor e cargo é o da **pessoa que concluiu**, e não o do curso:
 * a pergunta da G&G é qual área se desenvolveu, não qual publicou o material.
 */

import type {
  AnalyticsWindowRequest,
  TrainingOverviewDTO,
  TrainingSectorSliceDTO,
  TrainingTopCourseDTO,
} from '@legends/shared'
import { TRAINING_TOP_COURSES_LIMIT } from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { resolveWindow } from './people-analytics-service'

export interface TrainingOverviewInput {
  companyId: string
  /** Recorte por setor; `null` = empresa toda. */
  sectorId: string | null
  /** Recorte por cargo (`User.position`); `null` = todos. */
  position: string | null
  window: AnalyticsWindowRequest
  now?: Date
}

/** Percentual inteiro, com a divisão por zero devolvendo 0 em vez de `NaN`. */
function pct(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 100)
}

/**
 * Cargos em uso na empresa, para o seletor do filtro.
 *
 * `User.position` é texto livre — não há tabela de cargos —, então a lista sai
 * dos valores DISTINTOS de quem está ativo. É o comportamento certo para um
 * campo assim: cargo que ninguém tem não deveria aparecer como filtro.
 */
export async function listPositions(companyId: string): Promise<string[]> {
  const rows = await scopedPrisma(companyId).user.findMany({
    where: { active: true, position: { not: null } },
    select: { position: true },
    distinct: ['position'],
    orderBy: { position: 'asc' },
  })
  return rows.map((row) => row.position).filter((p): p is string => Boolean(p?.trim()))
}

export async function getTrainingOverview(input: TrainingOverviewInput): Promise<TrainingOverviewDTO> {
  const window = resolveWindow(input.window, input.now ?? new Date())
  const db = scopedPrisma(input.companyId)

  /** O recorte de PESSOA — setor e cargo — que atravessa quase todas as contas. */
  const pessoaWhere = {
    active: true,
    ...(input.sectorId ? { sectorId: input.sectorId } : {}),
    ...(input.position ? { position: input.position } : {}),
  }

  const conclusaoWhere = {
    status: 'COMPLETED' as const,
    completedAt: { gte: window.since, lt: window.until },
    user: pessoaWhere,
  }

  const [coursesPublished, colaboradores, conclusoes, obrigatorias, obrigatoriasConcluidas] =
    await Promise.all([
      // Estoque, não fluxo: o catálogo não é recortado pela janela.
      db.course.count({ where: { status: 'PUBLISHED' } }),
      db.user.count({ where: pessoaWhere }),
      db.courseEnrollment.findMany({
        where: conclusaoWhere,
        select: {
          courseId: true,
          user: { select: { sectorId: true, sector: { select: { name: true } } } },
        },
      }),
      // Estado, não fluxo: o percentual de obrigatórios ignora a janela. Ver o
      // comentário de `mandatoryCompletedPct` no contrato.
      db.courseEnrollment.count({ where: { course: { mandatory: true }, user: pessoaWhere } }),
      db.courseEnrollment.count({
        where: { course: { mandatory: true }, status: 'COMPLETED', user: pessoaWhere },
      }),
    ])

  // Agregação em memória: a janela já limitou o conjunto, e agrupar por setor E
  // por curso no SQL exigiria dois `groupBy` com join — dois roundtrips para o
  // que uma varredura de algumas centenas de linhas resolve.
  const porSetor = new Map<string, TrainingSectorSliceDTO>()
  const porCurso = new Map<string, number>()
  for (const linha of conclusoes) {
    const sectorId = linha.user.sectorId ?? 'sem-setor'
    const atual = porSetor.get(sectorId)
    if (atual) atual.completions += 1
    else {
      porSetor.set(sectorId, {
        sectorId,
        sectorName: linha.user.sector?.name ?? 'Sem setor',
        completions: 1,
      })
    }
    porCurso.set(linha.courseId, (porCurso.get(linha.courseId) ?? 0) + 1)
  }

  const cursos =
    porCurso.size > 0
      ? await db.course.findMany({
          where: { id: { in: [...porCurso.keys()] } },
          select: { id: true, title: true, mandatory: true },
        })
      : []

  const topCourses: TrainingTopCourseDTO[] = cursos
    .map((curso) => ({
      courseId: curso.id,
      title: curso.title,
      mandatory: curso.mandatory,
      completions: porCurso.get(curso.id) ?? 0,
    }))
    .sort((a, b) => b.completions - a.completions || a.title.localeCompare(b.title, 'pt-BR'))
    .slice(0, TRAINING_TOP_COURSES_LIMIT)

  return {
    from: window.days[0],
    to: window.days[window.days.length - 1],
    days: window.days.length,
    sectorId: input.sectorId,
    position: input.position,
    coursesPublished,
    completions: conclusoes.length,
    // Uma casa decimal: "1,4 curso por pessoa" diz algo que "1" esconde.
    completionsPerCollaborator:
      colaboradores > 0 ? Math.round((conclusoes.length / colaboradores) * 10) / 10 : 0,
    mandatoryCompletedPct: pct(obrigatoriasConcluidas, obrigatorias),
    mandatoryEnrollments: obrigatorias,
    completionsBySector: [...porSetor.values()].sort((a, b) => b.completions - a.completions),
    topCourses,
  }
}
