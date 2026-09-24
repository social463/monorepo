/**
 * Matrícula automática por público-alvo (Documento 4, seção 9.2).
 *
 * > "Regras de matrícula automática: colaboradores com determinados atributos de
 * > setor e cargo são inscritos automaticamente no curso."
 *
 * **O público-alvo É a regra.** O protótipo guarda um JSON de regras à parte
 * (`[{"setor":"Comercial"},{"cargo":"Líder"}]`), o que cria uma segunda
 * definição de "quem" ao lado do escopo de visibilidade — e duas definições
 * divergem. Aqui existe uma só: quem enxerga o curso é quem é matriculado, e o
 * `autoEnroll` só decide se isso acontece. Um curso não pode matricular quem
 * nem consegue abri-lo.
 *
 * **Em lote e idempotente**, nesta ordem de importância:
 *
 * - *idempotente* porque o tick roda todo dia e o `@@unique([userId, courseId])`
 *   é quem garante: `createMany` com `skipDuplicates` nunca duplica, e quem já
 *   se inscreveu sozinho (ou já concluiu) não é tocado;
 * - *em lote* porque a importação de Lendas em HML já ensinou que transação
 *   longa estoura — e aqui o alcance é a empresa inteira vezes os cursos com
 *   matrícula automática ligada.
 *
 * **Só matricula, nunca desmatricula.** Se a pessoa muda de setor e sai do
 * público, a inscrição fica: ela pode já ter feito metade do curso, e apagar
 * progresso por causa de um remanejamento seria o pior tipo de automação.
 */

import { prisma } from '../lib/prisma'

/** Teto por `createMany`. Nem transação longa, nem uma ida ao banco por pessoa. */
const BATCH_SIZE = 200

export interface AutoEnrollmentResult {
  /** Cursos com matrícula automática ligada e publicados. */
  courses: number
  /** Inscrições criadas nesta passada. */
  created: number
}

/**
 * Roda a matrícula automática de UM curso. Exportado porque o save do curso
 * também chama — ligar a matrícula automática e só ver efeito no dia seguinte
 * seria confuso para quem acabou de configurar.
 */
export async function runAutoEnrollmentForCourse(courseId: string): Promise<number> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      companyId: true,
      status: true,
      autoEnroll: true,
      sectorId: true,
      audiencePositionCategories: true,
      audienceSectors: { select: { sectorId: true } },
    },
  })
  // Curso em rascunho não matricula ninguém: publicar é o ato que o torna real.
  if (!course || !course.autoEnroll || course.status !== 'PUBLISHED') return 0

  const setores = [
    ...new Set([...(course.sectorId ? [course.sectorId] : []), ...course.audienceSectors.map((a) => a.sectorId)]),
  ]
  const cargos = course.audiencePositionCategories

  const elegiveis = await prisma.user.findMany({
    where: {
      companyId: course.companyId,
      active: true,
      // Espelha `visibleCourseWhere`: sem setor no curso e sem público, é a
      // empresa toda; com, é quem está num deles.
      ...(setores.length > 0 ? { sectorId: { in: setores } } : {}),
      ...(cargos.length > 0 ? { positionCategory: { in: cargos } } : {}),
    },
    select: { id: true },
  })
  if (elegiveis.length === 0) return 0

  let criadas = 0
  for (let i = 0; i < elegiveis.length; i += BATCH_SIZE) {
    const lote = elegiveis.slice(i, i + BATCH_SIZE)
    const { count } = await prisma.courseEnrollment.createMany({
      // `skipDuplicates` faz o trabalho da idempotência: quem já está inscrito
      // (por conta própria ou por um tick anterior) é ignorado sem erro, e o
      // progresso de quem já começou não é tocado.
      data: lote.map((user) => ({
        userId: user.id,
        courseId: course.id,
        companyId: course.companyId,
      })),
      skipDuplicates: true,
    })
    criadas += count
  }
  return criadas
}

/** Um tick: todos os cursos com matrícula automática ligada, de todas as empresas. */
export async function runAutoEnrollmentTick(): Promise<AutoEnrollmentResult> {
  const cursos = await prisma.course.findMany({
    where: { autoEnroll: true, status: 'PUBLISHED' },
    select: { id: true },
  })

  let created = 0
  for (const curso of cursos) {
    try {
      created += await runAutoEnrollmentForCourse(curso.id)
    } catch (err) {
      // Best-effort por curso: um curso com problema não pode impedir os outros
      // de matricular — mesmo princípio da avaliação de selo pós-voto.
      console.error('[course-auto-enrollment] Falha ao matricular no curso.', curso.id, err)
    }
  }
  return { courses: cursos.length, created }
}

const TICK_MS = 60 * 60 * 1000

/**
 * De hora em hora, e não a cada minuto: o que muda entre um tick e outro é
 * gente nova entrando na empresa ou mudando de setor, o que não acontece em
 * escala de minutos. Quem acabou de configurar o curso não espera — o save já
 * chama `runAutoEnrollmentForCourse`.
 */
export function startAutoEnrollmentScheduler(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void runAutoEnrollmentTick().catch((err) => {
      console.error('[course-auto-enrollment] Falha no tick.', err)
    })
  }, TICK_MS)
  timer.unref()
  return timer
}
