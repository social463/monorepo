import { Prisma, type CertificateRequest, type CertificateTemplate, type Course } from '@prisma/client'
import {
  CERTIFICATE_REJECTION_REASON_MAX_LENGTH,
  CERTIFICATE_TEMPLATE_NAME_MAX_LENGTH,
  CERTIFICATE_TEMPLATE_TITLE_MAX_LENGTH,
  type CertificateDTO,
  type CertificateRequestDTO,
  type CertificateRequestStatus,
  type CertificateTemplateDTO,
  type CreateCertificateTemplateRequest,
  type UpdateCertificateTemplateRequest,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import {
  createCertificateRecord,
  hasUnpassedFinalQuiz,
  renderAndStoreCertificate,
  type CertificateWithUser,
} from '../lib/certificate-issuer'
import { toCertificateDTO } from '../lib/serialize-learning'
import { CERTIFICATE_ATTACHMENT_PREFIX, presignDocumentDownload, s3Config } from '../lib/s3-client'
import type { CertificateTemplateVisual } from '../lib/certificate-renderer'
import { certificateBrandFor } from './branding-service'
import { recordAuditLog } from './audit-log-service'
import { notifyCertificateApproved } from './notification-service'
import type { CourseActor } from './course-admin-service'

/**
 * Modelos de certificado: CRUD restrito a ADMIN (documento da empresa, não do
 * setor — a rota usa `requireAdmin`, nunca `requireAdminOrSubadmin`). A fila
 * de aprovação (Task 9, abaixo) segue o escopo do CURSO em vez disso —
 * SUBADMIN aprova/recusa só do próprio setor, igual à escrita de curso em
 * `course-admin-service.ts`.
 */

export class CertificateError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
    this.name = 'CertificateError'
  }
}

export interface CertificateActor {
  id: string
  companyId: string
}

function toCertificateTemplateDTO(template: CertificateTemplate): CertificateTemplateDTO {
  return {
    id: template.id,
    name: template.name,
    title: template.title,
    backgroundUrl: template.backgroundUrl,
    accentColor: template.accentColor,
    signatureName: template.signatureName,
    signatureRole: template.signatureRole,
    signatureImageUrl: template.signatureImageUrl,
    logoUrl: template.logoUrl,
    isDefault: template.isDefault,
    updatedAt: template.updatedAt.toISOString(),
  }
}

function requireText(value: string, message: string, maxLength: number): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) throw new CertificateError(message)
  return trimmed
}

async function findTemplateOrThrow(actor: CertificateActor, id: string): Promise<CertificateTemplate> {
  const template = await scopedPrisma(actor.companyId).certificateTemplate.findUnique({ where: { id } })
  if (!template) throw new CertificateError('Modelo de certificado não encontrado.', 404)
  return template
}

/**
 * `P2034`: o Postgres abortou a transação por conflito de serialização (duas
 * transações `Serializable` disputando o mesmo predicado — aqui, "qual
 * modelo é `isDefault`"). Mesmo código que `office-map-service.ts` trata pra
 * decor concorrente; aqui vira erro de domínio em vez de 500 cru.
 */
function isSerializationFailure(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034'
}

const CONCURRENT_DEFAULT_WRITE_MESSAGE =
  'Outro administrador alterou os modelos de certificado ao mesmo tempo. Tente novamente.'

export async function listCertificateTemplates(actor: CertificateActor): Promise<CertificateTemplateDTO[]> {
  const templates = await scopedPrisma(actor.companyId).certificateTemplate.findMany({
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  })
  return templates.map(toCertificateTemplateDTO)
}

export async function createCertificateTemplate(
  actor: CertificateActor,
  data: CreateCertificateTemplateRequest,
): Promise<CertificateTemplateDTO> {
  const name = requireText(data.name, 'Informe o nome do modelo.', CERTIFICATE_TEMPLATE_NAME_MAX_LENGTH)
  const title = requireText(data.title, 'Informe o título do certificado.', CERTIFICATE_TEMPLATE_TITLE_MAX_LENGTH)
  // Vazia é escolha válida: é ela que faz o certificado herdar a cor da empresa.
  const accentColor = data.accentColor?.trim() || null
  const signatureName = requireText(data.signatureName, 'Informe o nome de quem assina.', 120)
  const signatureRole = requireText(data.signatureRole, 'Informe o cargo de quem assina.', 120)
  const isDefault = data.isDefault ?? false

  const db = scopedPrisma(actor.companyId)
  try {
    const created = await db.$transaction(
      async (tx) => {
        // Só um `isDefault` por empresa: marcar este desmarca qualquer outro, na
        // mesma transação — nunca uma janela em que dois modelos estão `isDefault`.
        if (isDefault) {
          await tx.certificateTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
        }
        const template = await tx.certificateTemplate.create({
          data: {
            name,
            title,
            backgroundUrl: data.backgroundUrl?.trim() || null,
            accentColor,
            signatureName,
            signatureRole,
            signatureImageUrl: data.signatureImageUrl?.trim() || null,
            logoUrl: data.logoUrl?.trim() || null,
            isDefault,
          },
        })
        await recordAuditLog({
          actorId: actor.id,
          entityType: 'CertificateTemplate',
          entityId: template.id,
          action: 'CREATE',
          after: template,
          companyId: actor.companyId,
          tx: tx as unknown as Prisma.TransactionClient,
        })
        return template
      },
      // Serializable: READ COMMITTED deixaria duas criações concorrentes com
      // `isDefault: true` passarem as duas (nenhuma vê a linha da outra antes
      // de commitar) — a mesma garantia de "exatamente um" que
      // `office-map-service.ts` já usa pra decor concorrente.
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    return toCertificateTemplateDTO(created)
  } catch (err) {
    if (isSerializationFailure(err)) throw new CertificateError(CONCURRENT_DEFAULT_WRITE_MESSAGE, 409)
    throw err
  }
}

export async function updateCertificateTemplate(
  actor: CertificateActor,
  id: string,
  data: UpdateCertificateTemplateRequest,
): Promise<CertificateTemplateDTO> {
  const before = await findTemplateOrThrow(actor, id)

  const patch: Prisma.CertificateTemplateUpdateInput = {}
  if (data.name !== undefined) {
    patch.name = requireText(data.name, 'Informe o nome do modelo.', CERTIFICATE_TEMPLATE_NAME_MAX_LENGTH)
  }
  if (data.title !== undefined) {
    patch.title = requireText(data.title, 'Informe o título do certificado.', CERTIFICATE_TEMPLATE_TITLE_MAX_LENGTH)
  }
  if (data.backgroundUrl !== undefined) patch.backgroundUrl = data.backgroundUrl?.trim() || null
  if (data.accentColor !== undefined) patch.accentColor = data.accentColor?.trim() || null
  if (data.signatureName !== undefined) {
    patch.signatureName = requireText(data.signatureName, 'Informe o nome de quem assina.', 120)
  }
  if (data.signatureRole !== undefined) {
    patch.signatureRole = requireText(data.signatureRole, 'Informe o cargo de quem assina.', 120)
  }
  if (data.signatureImageUrl !== undefined) patch.signatureImageUrl = data.signatureImageUrl?.trim() || null
  if (data.logoUrl !== undefined) patch.logoUrl = data.logoUrl?.trim() || null
  if (data.isDefault !== undefined) patch.isDefault = data.isDefault

  const db = scopedPrisma(actor.companyId)
  try {
    const updated = await db.$transaction(
      async (tx) => {
        // Mesma regra do create: marcar `isDefault: true` aqui desmarca qualquer
        // outro modelo da empresa (nunca ele mesmo) na mesma transação.
        if (data.isDefault === true) {
          await tx.certificateTemplate.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } })
        }
        const template = await tx.certificateTemplate.update({ where: { id }, data: patch })
        await recordAuditLog({
          actorId: actor.id,
          entityType: 'CertificateTemplate',
          entityId: id,
          action: 'UPDATE',
          before,
          after: template,
          companyId: actor.companyId,
          tx: tx as unknown as Prisma.TransactionClient,
        })
        return template
      },
      // Mesmo motivo do create: sem Serializable, duas trocas de isDefault
      // concorrentes (ou uma troca concorrente com uma criação) podem deixar
      // dois modelos `isDefault: true` na mesma empresa.
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    return toCertificateTemplateDTO(updated)
  } catch (err) {
    if (isSerializationFailure(err)) throw new CertificateError(CONCURRENT_DEFAULT_WRITE_MESSAGE, 409)
    throw err
  }
}

export async function deleteCertificateTemplate(actor: CertificateActor, id: string): Promise<void> {
  const before = await findTemplateOrThrow(actor, id)
  const db = scopedPrisma(actor.companyId)
  await db.$transaction(async (tx) => {
    // `Course.certificateTemplateId` é `onDelete: SetNull` — cursos que
    // usavam este modelo voltam a cair no fallback (isDefault da empresa, ou
    // o visual embutido), nunca ficam com um id pendurado.
    await tx.certificateTemplate.delete({ where: { id } })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'CertificateTemplate',
      entityId: id,
      action: 'DELETE',
      before,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
  })
}

/**
 * Cadeia de fallback de qual modelo um curso usa: o modelo escolhido nele →
 * o `isDefault` da empresa → nenhum (o `certificate-renderer` cai no visual
 * embutido quando recebe `null`/`undefined`). Só consulta — quem chama decide
 * o que fazer com o resultado. Ligada ao fluxo de emissão em `issueCertificate`
 * (`learning-service.ts`) e à aprovação da fila (`approveCertificateRequest`,
 * abaixo) — nos dois casos, só numa emissão de verdade (nunca ao devolver um
 * certificado já existente, para não mudar o visual de um já emitido).
 */
export async function resolveCertificateTemplateForCourse(
  companyId: string,
  course: { certificateTemplateId: string | null },
): Promise<CertificateTemplate | null> {
  const db = scopedPrisma(companyId)
  if (course.certificateTemplateId) {
    const template = await db.certificateTemplate.findUnique({ where: { id: course.certificateTemplateId } })
    if (template) return template
  }
  return db.certificateTemplate.findFirst({ where: { isDefault: true } })
}

/**
 * Modelo do banco → o recorte que o renderer usa, **com a marca da empresa
 * preenchendo o que o modelo deixou em branco**.
 *
 * A identidade do certificado era mantida à parte da marca — e manter a mesma
 * coisa em dois lugares é o que faz um envelhecer enquanto o outro muda. Agora
 * a marca é o padrão e o modelo é a exceção: cor e logo preenchidos continuam
 * mandando, o que é branco herda.
 *
 * **Não vale para o certificado SEM modelo.** Aquele caminho sai com o visual
 * embutido de sempre, de propósito: é o que garante que um certificado emitido
 * antes de os modelos existirem, re-renderizado, não mude de cara.
 */
export async function toCertificateTemplateVisual(
  companyId: string,
  template: CertificateTemplate | null,
): Promise<CertificateTemplateVisual | null> {
  if (!template) return null
  const { signatureName, signatureRole, signatureImageUrl, backgroundUrl } = template
  const daPessoa = { signatureName, signatureRole, signatureImageUrl, backgroundUrl }

  // Modelo com cor e logo próprios não paga uma leitura a mais por render: não
  // há nada para herdar.
  if (template.accentColor && template.logoUrl) {
    return { ...daPessoa, accentColor: template.accentColor, logoUrl: template.logoUrl }
  }
  const marca = await certificateBrandFor(companyId)
  return {
    ...daPessoa,
    accentColor: template.accentColor ?? marca.accentColor,
    logoUrl: template.logoUrl ?? marca.logoUrl,
  }
}

/**
 * ---------------------------------------------------------------------------
 * Fila de aprovação (Task 9)
 * ---------------------------------------------------------------------------
 * Curso com `requiresCertificateApproval` não emite na hora: `issueCertificate`
 * chama `ensureCertificateRequestForEnrollment` em vez de criar o `Certificate`.
 * G&G (ADMIN/SUBADMIN do setor do curso) vê a fila, aprova (emite pelo mesmo
 * `createCertificateRecord` que a emissão automática usa, e notifica) ou
 * recusa com motivo obrigatório.
 */

type CertificateRequestRow = CertificateRequest & {
  user: { name: string }
  course: { title: string } | null
  reviewedBy: { id: string; name: string } | null
}

/**
 * `async` por causa do anexo: o certificado externo é documento pessoal, então
 * o que fica gravado é a CHAVE no S3, e a leitura sai como URL assinada e
 * temporária — nunca um link permanente no DTO.
 *
 * Sem S3 configurado (dev, teste) o anexo vem `null` em vez de derrubar a fila:
 * quem administra ainda precisa ver o resto do pedido.
 */
async function toCertificateRequestDTO(row: CertificateRequestRow): Promise<CertificateRequestDTO> {
  return {
    id: row.id,
    origin: row.origin,
    enrollmentId: row.enrollmentId,
    courseId: row.courseId,
    courseTitle: row.course?.title ?? null,
    userId: row.userId,
    userName: row.user.name,
    status: row.status,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Guarda 4 de `issueCertificate`: curso com aprovação obrigatória cria (ou
 * reabre) uma `CertificateRequest` PENDING em vez de emitir. Idempotente pelo
 * `@@unique([enrollmentId])` — chamar de novo (ex.: a pessoa reabre uma aula e
 * marca de novo) nunca duplica nem quebra:
 *
 * - sem solicitação ainda → cria PENDING;
 * - já PENDING ou APROVADA → não mexe (aprovada nem chega aqui de novo, na
 *   prática: `issueCertificate` já devolveu o certificado existente antes de
 *   chegar a esta guarda);
 * - RECUSADA → reabre para PENDING — é o que permite "nova solicitação
 *   depois" da recusa, sem violar o unique.
 *
 * Reabrir NÃO apaga `reviewedById`/`reviewedAt`/`rejectionReason` da recusa
 * anterior de propósito: o gatilho daqui não é um "pedir revisão de novo"
 * deliberado — é `setLessonCompletion` reentrando em `issueCertificate`
 * sempre que a última aula de um curso já concluído é marcada de novo (ex.:
 * a pessoa desmarca e remarca uma aula qualquer). Sem preservar o motivo,
 * uma recusa vira PENDING "imaculada" e outro revisor aprova sem saber que
 * já tinha sido recusada. O motivo some só quando a linha muda de status de
 * novo — `approveCertificateRequest` limpa explicitamente ao aprovar,
 * `rejectCertificateRequest` sobrescreve com o motivo novo ao recusar de novo.
 */
export async function ensureCertificateRequestForEnrollment(
  db: ReturnType<typeof scopedPrisma>,
  input: { enrollmentId: string; userId: string; courseId: string },
): Promise<void> {
  const existing = await db.certificateRequest.findUnique({ where: { enrollmentId: input.enrollmentId } })
  if (!existing) {
    try {
      await db.certificateRequest.create({ data: input })
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err
      // Corrida: outra chamada criou entre o `findUnique` e o `create` — idempotente.
    }
    return
  }
  if (existing.status === 'REJECTED') {
    await db.certificateRequest.update({ where: { id: existing.id }, data: { status: 'PENDING' } })
  }
}

const REQUEST_DTO_INCLUDE = {
  user: { select: { id: true, name: true } },
  course: { select: { title: true } },
  reviewedBy: { select: { id: true, name: true } },
} satisfies Prisma.CertificateRequestInclude

/**
 * Client Prisma aceito pelas funções abaixo: `scopedPrisma` de fora de uma
 * transação, ou o `tx` de dentro de uma (mesmo padrão de `certificate-issuer.ts`).
 */
type RequestDb = ReturnType<typeof scopedPrisma> | Prisma.TransactionClient

/**
 * Busca a solicitação e o curso dela, aplicando o escopo de setor de quem
 * aprova/recusa: SUBADMIN só alcança curso do próprio setor — igual a
 * `writableCourseWhere` em `course-admin-service.ts`, mas aqui como guarda
 * direta (a solicitação não é um `Course`, não dá pra montar um `where`
 * composto do mesmo jeito). Fora do alcance é 404, nunca 403.
 */
async function loadRequestScoped(
  db: RequestDb,
  actor: CourseActor,
  id: string,
): Promise<{ request: CertificateRequest; course: Course | null }> {
  const request = await db.certificateRequest.findUnique({ where: { id } })
  if (!request) throw new CertificateError('Solicitação não encontrada.', 404)

  const course = request.courseId ? await db.course.findUnique({ where: { id: request.courseId } }) : null
  if (!course) throw new CertificateError('Solicitação não encontrada.', 404)
  if (actor.role === 'SUBADMIN' && course.sectorId !== actor.sectorId) {
    throw new CertificateError('Solicitação não encontrada.', 404)
  }
  return { request, course }
}

/** Lista a fila, opcionalmente filtrada por status — recortada pelo setor de quem lê. */
export async function listCertificateRequests(
  actor: CourseActor,
  status?: CertificateRequestStatus,
): Promise<CertificateRequestDTO[]> {
  const db = scopedPrisma(actor.companyId)
  const where: Prisma.CertificateRequestWhereInput = {
    ...(status ? { status } : {}),
    // O SUBADMIN vê o próprio setor, e o setor sai do CURSO — a fila é de
    // emissão de certificado interno, então todo pedido tem curso.
    ...(actor.role === 'SUBADMIN' ? { course: { sectorId: actor.sectorId } } : {}),
  }
  const requests = await db.certificateRequest.findMany({
    where,
    include: REQUEST_DTO_INCLUDE,
    orderBy: { createdAt: 'asc' },
  })
  return Promise.all(requests.map(toCertificateRequestDTO))
}

const CONCURRENT_APPROVAL_MESSAGE = 'Outro administrador já avaliou esta solicitação. Atualize a fila e tente de novo.'

/**
 * Aprova: emite pelo mesmo `createCertificateRecord` que `issueCertificate`
 * usa (nunca uma segunda regra de código/carga horária) e notifica.
 *
 * Uma solicitação PENDING pode ter ficado dias na fila — o mundo ao redor
 * dela pode ter mudado (curso desligou certificado, a pessoa desmarcou uma
 * aula e a inscrição não está mais concluída, um quiz final foi adicionado
 * depois do pedido e ainda não foi aprovado). Por isso as MESMAS guardas de
 * `issueCertificate` (`learning-service.ts`) são reexecutadas aqui, dentro da
 * transação, antes de emitir — nunca confia que "PENDING" ainda implica
 * "elegível".
 *
 * Atômico de propósito: a releitura das guardas + a emissão do certificado +
 * a transição para APROVADA vivem na mesma transação `Serializable` — sem
 * isso, duas aprovações concorrentes na mesma solicitação leriam PENDENTE
 * antes de qualquer uma escrever, e as duas prosseguiriam (a aprovação de uma
 * pisando silenciosamente na da outra: dois audit logs, duas notificações,
 * `reviewedBy` de quem commitou por último). Sob `Serializable`, o Postgres
 * detecta o conflito entre as duas transações e aborta uma com `P2034` — a
 * mesma técnica que os modelos de certificado (Task 8) já usam para "só um
 * `isDefault`" — que esta função mapeia para um 409 de domínio.
 *
 * A notificação de aprovado é best-effort, DEPOIS da transação: falhar em
 * notificar não desfaz uma aprovação já commitada (mesmo padrão da avaliação
 * de selo pós-voto).
 */
export async function approveCertificateRequest(
  actor: CourseActor,
  id: string,
): Promise<{ request: CertificateRequestDTO; certificate: CertificateDTO | null }> {
  const db = scopedPrisma(actor.companyId)

  let result: {
    // `null` no externo: nada é emitido, só validado.
    certificate: CertificateWithUser | null
    created: boolean
    course: Course | null
    requestRow: Parameters<typeof toCertificateRequestDTO>[0]
  }
  try {
    result = await db.$transaction(
      async (tx) => {
        const scopedTx = tx as unknown as Prisma.TransactionClient
        const { request, course } = await loadRequestScoped(scopedTx, actor, id)
        if (request.status !== 'PENDING') {
          throw new CertificateError('Esta solicitação já foi avaliada.', 409)
        }

        // Sem curso não há o que emitir (o curso foi apagado depois do
        // pedido): aprovar aqui é só encerrar a linha da fila.
        if (!course) {
          const requestRow = await tx.certificateRequest.update({
            where: { id },
            data: { status: 'APPROVED', reviewedById: actor.id, reviewedAt: new Date(), rejectionReason: null },
            include: REQUEST_DTO_INCLUDE,
          })
          await recordAuditLog({
            actorId: actor.id,
            entityType: 'CertificateRequest',
            entityId: id,
            action: 'UPDATE',
            before: { status: request.status },
            after: { status: 'APPROVED' },
            companyId: actor.companyId,
            tx: scopedTx,
          })
          return { certificate: null, created: false, course: null, requestRow }
        }

        // Releitura das guardas de `issueCertificate`: o pedido pode ter ficado
        // PENDING tempo suficiente para o curso ou a inscrição mudarem por baixo.
        if (!course.certificateEnabled) {
          throw new CertificateError('Este curso não emite mais certificado.', 409)
        }
        const enrollment = request.enrollmentId
          ? await tx.courseEnrollment.findUnique({ where: { id: request.enrollmentId } })
          : null
        if (!enrollment || enrollment.status !== 'COMPLETED') {
          throw new CertificateError(
            'A inscrição não está mais concluída — a pessoa desmarcou uma aula depois do pedido.',
            409,
          )
        }
        if (await hasUnpassedFinalQuiz(scopedTx, course.id, request.userId)) {
          throw new CertificateError('O quiz final deste curso ainda não foi aprovado.', 409)
        }

        const { certificate, created } = await createCertificateRecord(scopedTx, {
          userId: request.userId,
          courseId: course.id,
          courseTitle: course.title,
        })

        const requestRow = await tx.certificateRequest.update({
          where: { id },
          // `rejectionReason: null` de propósito: se esta linha foi reaberta de
          // uma recusa anterior (`ensureCertificateRequestForEnrollment`
          // preserva o motivo enquanto PENDING, como histórico visível na
          // fila), aprovar precisa limpar esse resquício — senão a linha fica
          // com `status: 'APPROVED'` e um `rejectionReason` de uma recusa
          // antiga, contraditório.
          data: { status: 'APPROVED', reviewedById: actor.id, reviewedAt: new Date(), rejectionReason: null },
          include: REQUEST_DTO_INCLUDE,
        })

        await recordAuditLog({
          actorId: actor.id,
          entityType: 'CertificateRequest',
          entityId: id,
          action: 'UPDATE',
          before: { status: request.status },
          after: { status: 'APPROVED' },
          companyId: actor.companyId,
          tx: scopedTx,
        })

        return { certificate, created, course, requestRow }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  } catch (err) {
    if (isSerializationFailure(err)) throw new CertificateError(CONCURRENT_APPROVAL_MESSAGE, 409)
    throw err
  }

  const { certificate, created, course, requestRow } = result

  if (!certificate || !course) {
    // Curso apagado depois do pedido: só avisa que foi aceito. Best-effort pelo
    // motivo de sempre — falhar em notificar não desfaz uma aprovação commitada.
    try {
      await notifyCertificateApproved({
        userId: requestRow.userId,
        courseId: null,
        courseTitle: requestRow.course?.title ?? 'curso',
        companyId: actor.companyId,
      })
    } catch (err) {
      console.error('[certificate-request-service] Falha ao notificar aprovação de certificado.', err)
    }
    return { request: await toCertificateRequestDTO(requestRow), certificate: null }
  }

  const withImage = created
    ? await renderAndStoreCertificate(
        actor.companyId,
        certificate,
        course,
        await toCertificateTemplateVisual(
          actor.companyId,
          await resolveCertificateTemplateForCourse(actor.companyId, course),
        ),
      )
    : certificate

  try {
    await notifyCertificateApproved({
      userId: requestRow.userId,
      courseId: course.id,
      courseTitle: course.title,
      companyId: actor.companyId,
    })
  } catch (err) {
    // Best-effort de propósito: a aprovação (já commitada acima) não pode ser
    // desfeita por uma falha de notificação — mesmo padrão de `syncLearningBadges`
    // em `learning-service.ts`.
    console.error('[certificate-request-service] Falha ao notificar aprovação de certificado.', err)
  }

  return { request: await toCertificateRequestDTO(requestRow), certificate: toCertificateDTO(withImage) }
}

/** Recusa com motivo obrigatório. Guarda "só se ainda PENDENTE" por contagem de
 *  `updateMany` (sem precisar de `Serializable`: não há uma segunda escrita
 *  condicional acoplada, ao contrário da aprovação). Recusar guarda o motivo e
 *  permite nova solicitação depois: a pessoa concluir de novo (ou reabrir e
 *  marcar a última aula outra vez) chama `issueCertificate`, que reabre esta
 *  mesma linha via `ensureCertificateRequestForEnrollment`. */
export async function rejectCertificateRequest(
  actor: CourseActor,
  id: string,
  rejectionReason: string,
): Promise<CertificateRequestDTO> {
  const reason = rejectionReason.trim()
  if (!reason) throw new CertificateError('Informe o motivo da recusa.')
  if (reason.length > CERTIFICATE_REJECTION_REASON_MAX_LENGTH) {
    throw new CertificateError(`O motivo pode ter no máximo ${CERTIFICATE_REJECTION_REASON_MAX_LENGTH} caracteres.`)
  }

  const db = scopedPrisma(actor.companyId)
  const { request } = await loadRequestScoped(db, actor, id)
  if (request.status !== 'PENDING') throw new CertificateError('Esta solicitação já foi avaliada.', 409)

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.certificateRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedById: actor.id, reviewedAt: new Date(), rejectionReason: reason },
    })
    if (result.count === 0) throw new CertificateError('Esta solicitação já foi avaliada.', 409)

    const fresh = await tx.certificateRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_DTO_INCLUDE })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'CertificateRequest',
      entityId: id,
      action: 'UPDATE',
      before: { status: request.status },
      after: { status: 'REJECTED', rejectionReason: reason },
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return fresh
  })

  return toCertificateRequestDTO(updated)
}
