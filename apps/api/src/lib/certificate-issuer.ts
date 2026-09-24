import { randomUUID } from 'node:crypto'
import type { Certificate, Course, Prisma } from '@prisma/client'
import { CERTIFICATE_CODE_PREFIX, certificateHoursFor } from '@legends/shared'
import { renderCertificate, type CertificateTemplateVisual } from './certificate-renderer'
import { certificateStorageEnabled, saveCertificatePng } from './certificate-storage'
import { toStringArray } from './serialize-learning'
import { scopedPrisma } from './tenant-scope'

/**
 * Núcleo de emissão de certificado — extraído de `learning-service.ts` (emissão
 * automática) para ser reusado, sem duplicar, pela aprovação da fila
 * (`certificate-request-service.ts`, Task 9). Nenhuma regra muda aqui: é o
 * mesmo código de sempre, só compartilhável entre os dois caminhos que agora
 * criam `Certificate`.
 */

export type CertificateWithUser = Certificate & { user: { name: string } }

/** Client Prisma aceito: o `scopedPrisma` de fora de uma transação, ou o `tx`
 *  de dentro de uma — mesmo padrão de `office-map-service.ts` (`validateDocument`). */
export type CertificateDb = ReturnType<typeof scopedPrisma> | Prisma.TransactionClient

export function buildCertificateCode(): string {
  return `${CERTIFICATE_CODE_PREFIX}${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

/**
 * Curso com quiz final: o certificado só sai depois de uma tentativa aprovada
 * nele. Sem quiz final (a maioria dos cursos), nada bloqueia aqui — quiz de
 * AULA é formativo, não condiciona certificado (ver design spec, "Decisões").
 *
 * Exportada daqui (não fica só em `learning-service.ts`) porque
 * `approveCertificateRequest` (`certificate-request-service.ts`) precisa
 * reexecutar a MESMA checagem dentro da transação de aprovação — o pedido
 * pode ter ficado PENDING numa fila por dias antes de alguém adicionar um
 * quiz final ao curso.
 */
export async function hasUnpassedFinalQuiz(db: CertificateDb, courseId: string, userId: string): Promise<boolean> {
  const finalQuiz = await db.courseQuiz.findFirst({ where: { courseId, lessonId: null } })
  if (!finalQuiz) return false
  // Quiz final SEM questões é uma casca — o admin criou o quiz e ainda não
  // escreveu as questões. Não bloqueia: ninguém consegue ser aprovado nele
  // (`submitQuizAttempt` recusa responder quiz sem questão), então tratá-lo
  // como reprovado seguraria o certificado de todo mundo do curso por tempo
  // indeterminado, sem nenhum caminho de saída para quem está estudando.
  const questionCount = await db.courseQuestion.count({ where: { quizId: finalQuiz.id } })
  if (questionCount === 0) return false
  const passedAttempt = await db.quizAttempt.findFirst({ where: { quizId: finalQuiz.id, userId, passed: true } })
  return !passedAttempt
}

/**
 * Cria o registro `Certificate` de uma inscrição concluída — idempotente pelo
 * par (userId, courseId): se já existe (corrida entre duas chamadas, ou
 * chamada repetida), devolve o existente com `created: false`, sem duplicar
 * nem lançar. `created` diz a quem chama se deve (ou não) renderizar/guardar
 * o PNG — só a criação de verdade precisa disso; devolver um já existente não
 * deve re-renderizar por cima da imagem que a criação original já salvou.
 */
export async function createCertificateRecord(
  db: CertificateDb,
  input: { userId: string; courseId: string; courseTitle: string },
): Promise<{ certificate: CertificateWithUser; created: boolean }> {
  const existing = await db.certificate.findUnique({
    where: { userId_courseId: { userId: input.userId, courseId: input.courseId } },
    include: { user: { select: { name: true } } },
  })
  if (existing) return { certificate: existing, created: false }

  const duration = await db.courseLesson.aggregate({
    where: { courseId: input.courseId },
    _sum: { durationMinutes: true },
  })

  try {
    const certificate = await db.certificate.create({
      data: {
        code: buildCertificateCode(),
        userId: input.userId,
        courseId: input.courseId,
        title: input.courseTitle,
        hours: certificateHoursFor(duration._sum.durationMinutes ?? 0),
      },
      include: { user: { select: { name: true } } },
    })
    return { certificate, created: true }
  } catch (err) {
    if ((err as { code?: string }).code !== 'P2002') throw err
    // Corrida: outra chamada criou entre o `findUnique` e o `create` — devolve
    // o certificado que ganhou a corrida, sem re-renderizar por cima do dele.
    const certificate = await db.certificate.findUniqueOrThrow({
      where: { userId_courseId: { userId: input.userId, courseId: input.courseId } },
      include: { user: { select: { name: true } } },
    })
    return { certificate, created: false }
  }
}

/**
 * Gera o PNG do certificado e guarda. Best-effort: sem storage (ou com falha),
 * o certificado vale igual, só sem imagem. `template` é opcional — omitido,
 * sai o visual embutido de sempre (ver `certificate-renderer.ts`).
 */
export async function renderAndStoreCertificate(
  companyId: string,
  certificate: CertificateWithUser,
  course: Course,
  template?: CertificateTemplateVisual | null,
): Promise<CertificateWithUser> {
  if (!certificateStorageEnabled()) return certificate
  try {
    // Competência virou relação (Documento 4, seção 9.6): antes vinha na coluna
    // Json do próprio curso. Consulta rasa e só aqui — o certificado é emitido
    // uma vez por pessoa, não é caminho de listagem.
    const competencias = await scopedPrisma(companyId).courseCompetency.findMany({
      where: { courseId: course.id },
      select: { competency: { select: { name: true } } },
      orderBy: { competency: { name: 'asc' } },
    })
    const png = await renderCertificate(
      {
        userName: certificate.user.name,
        courseTitle: course.title,
        hours: certificate.hours,
        code: certificate.code,
        issuedAtLabel: new Intl.DateTimeFormat('pt-BR', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
          timeZone: 'America/Sao_Paulo',
        }).format(certificate.issuedAt),
        competencies: competencias.map((c) => c.competency.name),
      },
      template,
    )
    const imageUrl = await saveCertificatePng(companyId, certificate.code, png)
    // Sempre chamado depois que o `create`/`update` que originou `certificate`
    // já commitou (nunca de dentro da transação que o criou) — por isso um
    // `scopedPrisma` novo aqui é seguro, igual ao código original.
    const updated = await scopedPrisma(companyId).certificate.update({
      where: { id: certificate.id },
      data: { imageUrl },
      include: { user: { select: { name: true } } },
    })
    return updated
  } catch {
    return certificate
  }
}
