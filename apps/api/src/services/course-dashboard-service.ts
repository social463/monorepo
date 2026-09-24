/**
 * Indicadores da Central de Cursos (Documento 4, seção 9.6 — Dashboard).
 *
 * **Por que não é o `training-analytics-service` (Lote C).** O spec do Lote B
 * avisa para reusar em vez de escrever um segundo cálculo, e a regra vale — mas
 * ela é sobre o MESMO número, não sobre a mesma tela. O único que os dois
 * compartilham é "cursos publicados", e ele é um `count` de uma linha: extrair
 * isso para um lugar comum criaria acoplamento entre duas telas que respondem a
 * perguntas diferentes, sem nada em troca.
 *
 * O que o Lote C sabe calcular — conclusões por setor e por cargo, numa janela —
 * este dashboard **não pede**, e o contrário também: nada lá responde "quantos
 * cursos estão em revisão" nem "quanto do que começa termina".
 *
 * Tudo aqui é **estoque, não fluxo**: sem janela e sem recorte de setor.
 * Catálogo não se mede por período.
 */

import {
  COURSE_ABANDON_AFTER_DAYS,
  COURSE_ABANDON_MIN_ENROLLMENTS,
  COURSE_DASHBOARD_ROWS,
  COURSE_STATUSES,
  type CourseDashboardDTO,
  type CourseDashboardRowDTO,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import type { CourseActor } from './course-admin-service'
import { writableCourseWhere } from './course-admin-service'

/** Uma casa decimal: o número é para ler, não para conferir contabilidade. */
function pct(parte: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((parte / total) * 1000) / 10
}

export async function getCourseDashboard(actor: CourseActor): Promise<CourseDashboardDTO> {
  const db = scopedPrisma(actor.companyId)
  // Mesmo recorte da listagem de autoria: o SUBADMIN vê os indicadores dos
  // cursos que ele administra, não os da empresa inteira.
  const alcance = writableCourseWhere(actor)

  const cursos = await db.course.findMany({
    where: alcance,
    select: {
      id: true,
      title: true,
      status: true,
      modules: { select: { lessons: { select: { durationMinutes: true } } } },
    },
  })
  const idsNoAlcance = cursos.map((curso) => curso.id)

  const [inscricoes, avaliacoes] = await Promise.all([
    db.courseEnrollment.findMany({
      where: { courseId: { in: idsNoAlcance } },
      select: { courseId: true, userId: true, status: true, lastAccessedAt: true, startedAt: true },
    }),
    db.courseRating.aggregate({
      where: { courseId: { in: idsNoAlcance } },
      _avg: { rating: true },
      _count: { _all: true },
    }),
  ])

  // --- Distribuição por estado -----------------------------------------------
  // Os cinco valores sempre aparecem, mesmo zerados: um estado que some da
  // lista quando ninguém está nele faz o gráfico mudar de forma a cada leitura.
  const porEstado = new Map(COURSE_STATUSES.map((status) => [status, 0]))
  for (const curso of cursos) porEstado.set(curso.status, (porEstado.get(curso.status) ?? 0) + 1)

  // --- Horas ofertadas: só do que está publicado -----------------------------
  // Curso em rascunho não é oferta — ninguém pode fazê-lo.
  const minutosPublicados = cursos
    .filter((curso) => curso.status === 'PUBLISHED')
    .reduce(
      (soma, curso) =>
        soma +
        curso.modules.reduce(
          (m, mod) => m + mod.lessons.reduce((l, lesson) => l + lesson.durationMinutes, 0),
          0,
        ),
      0,
    )

  // --- Inscrições, conclusão e abandono --------------------------------------
  const limite = new Date(Date.now() - COURSE_ABANDON_AFTER_DAYS * 24 * 60 * 60 * 1000)
  const porCurso = new Map<string, { total: number; concluidas: number; abandonadas: number }>()
  for (const inscricao of inscricoes) {
    const atual = porCurso.get(inscricao.courseId) ?? { total: 0, concluidas: 0, abandonadas: 0 }
    atual.total += 1
    if (inscricao.status === 'COMPLETED') {
      atual.concluidas += 1
    } else {
      // Abandono é "parou", não "não terminou": quem se inscreveu ontem não
      // abandonou nada. Sem `lastAccessedAt`, vale a data de início.
      const ultimaAtividade = inscricao.lastAccessedAt ?? inscricao.startedAt
      if (ultimaAtividade < limite) atual.abandonadas += 1
    }
    porCurso.set(inscricao.courseId, atual)
  }

  const tituloPorId = new Map(cursos.map((curso) => [curso.id, curso.title]))
  const linhas: CourseDashboardRowDTO[] = [...porCurso.entries()].map(([courseId, dados]) => ({
    courseId,
    title: tituloPorId.get(courseId) ?? '',
    enrollments: dados.total,
    abandonedPct: pct(dados.abandonadas, dados.total),
  }))

  const totalInscricoes = inscricoes.length
  const totalConcluidas = inscricoes.filter((inscricao) => inscricao.status === 'COMPLETED').length

  return {
    total: cursos.length,
    byStatus: COURSE_STATUSES.map((status) => ({ status, count: porEstado.get(status) ?? 0 })),
    studentsEnrolled: new Set(inscricoes.map((inscricao) => inscricao.userId)).size,
    completionPct: pct(totalConcluidas, totalInscricoes),
    hoursOffered: Math.round((minutosPublicados / 60) * 10) / 10,
    averageRating: Math.round((avaliacoes._avg.rating ?? 0) * 10) / 10,
    totalRatings: avaliacoes._count._all,
    mostEnrolled: [...linhas]
      .sort((a, b) => b.enrollments - a.enrollments || a.title.localeCompare(b.title, 'pt-BR'))
      .slice(0, COURSE_DASHBOARD_ROWS),
    // O piso de inscrições existe para um curso com uma inscrição parada não
    // aparecer com 100% no topo — número verdadeiro, conclusão errada.
    mostAbandoned: linhas
      .filter((linha) => linha.enrollments >= COURSE_ABANDON_MIN_ENROLLMENTS && linha.abandonedPct > 0)
      .sort((a, b) => b.abandonedPct - a.abandonedPct || b.enrollments - a.enrollments)
      .slice(0, COURSE_DASHBOARD_ROWS),
  }
}
