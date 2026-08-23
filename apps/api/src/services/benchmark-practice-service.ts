import { Prisma, type BenchmarkPractice } from '@prisma/client'
import {
  BENCHMARK_PRACTICE_MAX_TAGS,
  type CreateBenchmarkPracticeRequest,
  type UpdateBenchmarkPracticeRequest,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { AgentError } from '../lib/agent-error'
import { recordAuditLog } from './audit-log-service'

export interface BenchmarkActor {
  id: string
  companyId: string
}

const creatorInclude = { createdBy: { select: { id: true, name: true } } } as const

export type BenchmarkPracticeWithCreator = BenchmarkPractice & {
  createdBy: { id: string; name: string } | null
}

/**
 * Tags viram lista limpa e sem repetição. O teto já foi validado por Zod na
 * rota; aqui o corte é defensivo, porque a deduplicação pode não mudar o
 * tamanho da lista que o usuário mandou.
 */
function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return []
  const unique = new Set(tags.map((tag) => tag.trim()).filter(Boolean))
  return [...unique].slice(0, BENCHMARK_PRACTICE_MAX_TAGS)
}

/**
 * O inventário é da empresa inteira, sem recorte por setor: ação de
 * endomarketing não pertence a um setor, e a comparação é empresa × mercado.
 * O isolamento que importa aqui é o de tenant, que vem de `scopedPrisma`.
 */
export function listBenchmarkPractices(actor: BenchmarkActor): Promise<BenchmarkPracticeWithCreator[]> {
  return scopedPrisma(actor.companyId).benchmarkPractice.findMany({
    include: creatorInclude,
    orderBy: { createdAt: 'desc' },
  })
}

export async function createBenchmarkPractice(
  actor: BenchmarkActor,
  input: CreateBenchmarkPracticeRequest,
): Promise<BenchmarkPracticeWithCreator> {
  const db = scopedPrisma(actor.companyId)

  return db.$transaction(async (tx) => {
    const created = await tx.benchmarkPractice.create({
      data: {
        // Explícito de propósito: o model novo não tem `@default("company-emr")`
        // (esse default é herança do retrofit multi-empresa). A extensão de
        // isolamento valida que o valor bate com o escopo — passar aqui é
        // redundância defensiva, não bypass.
        companyId: actor.companyId,
        category: input.category,
        title: input.title,
        description: input.description ?? null,
        channel: input.channel ?? null,
        tags: normalizeTags(input.tags),
        createdById: actor.id,
      },
      include: creatorInclude,
    })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'BenchmarkPractice',
      entityId: created.id,
      action: 'CREATE',
      after: created,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return created
  })
}

export async function updateBenchmarkPractice(
  actor: BenchmarkActor,
  id: string,
  input: UpdateBenchmarkPracticeRequest,
): Promise<BenchmarkPracticeWithCreator> {
  const db = scopedPrisma(actor.companyId)
  const before = await db.benchmarkPractice.findFirst({ where: { id }, include: creatorInclude })
  if (!before) throw new AgentError('Prática não encontrada.', 404)

  const data: Prisma.BenchmarkPracticeUncheckedUpdateInput = {}
  if (input.category !== undefined) data.category = input.category
  if (input.title !== undefined) data.title = input.title
  if (input.description !== undefined) data.description = input.description ?? null
  if (input.channel !== undefined) data.channel = input.channel ?? null
  if (input.tags !== undefined) data.tags = normalizeTags(input.tags)

  return db.$transaction(async (tx) => {
    await tx.benchmarkPractice.update({ where: { id }, data })
    const after = await tx.benchmarkPractice.findUniqueOrThrow({ where: { id }, include: creatorInclude })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'BenchmarkPractice',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return after
  })
}

export async function deleteBenchmarkPractice(actor: BenchmarkActor, id: string): Promise<void> {
  const db = scopedPrisma(actor.companyId)
  const before = await db.benchmarkPractice.findFirst({ where: { id }, include: creatorInclude })
  if (!before) throw new AgentError('Prática não encontrada.', 404)

  await db.$transaction(async (tx) => {
    await tx.benchmarkPractice.delete({ where: { id } })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'BenchmarkPractice',
      entityId: id,
      action: 'DELETE',
      before,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
  })
}
