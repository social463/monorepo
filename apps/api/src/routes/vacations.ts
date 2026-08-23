import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { MAX_VACATION_RANGE_DAYS, VACATION_NOTE_MAX_LENGTH } from '@legends/shared'
import {
  VacationError,
  createVacation,
  deleteVacation,
  listCompanyVacations,
  listSectorVacations,
  listTeamVacations,
  updateVacation,
} from '../services/vacation-service'
import { todayInSaoPaulo } from '../lib/sao-paulo-date'

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD')

const listQuerySchema = z
  .object({ from: ymd, to: ymd })
  .refine(({ from, to }) => from <= to, { message: 'O início do intervalo deve vir antes do fim' })
  .refine(
    ({ from, to }) => (Date.parse(to) - Date.parse(from)) / 86_400_000 <= MAX_VACATION_RANGE_DAYS,
    { message: `O intervalo não pode passar de ${MAX_VACATION_RANGE_DAYS} dias` },
  )

/** Mês de referência `AAAA-MM`; ausente = mês corrente em America/Sao_Paulo. */
const monthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Mês deve estar no formato AAAA-MM').optional(),
})

/** Primeiro e último dia civis do mês de referência (ou do mês corrente). */
function monthBoundsYmd(month: string | undefined): { from: string; to: string } {
  const ref = month ?? todayInSaoPaulo().ymd.slice(0, 7)
  const [year, monthNumber] = ref.split('-').map(Number)
  // Dia 0 do mês seguinte é o último dia deste — sem tabela de dias por mês e
  // sem caso especial de fevereiro bissexto.
  const lastDay = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate()
  return { from: `${ref}-01`, to: `${ref}-${String(lastDay).padStart(2, '0')}` }
}

const createSchema = z.object({
  userId: z.string().min(1),
  startDate: ymd,
  endDate: ymd,
  note: z.string().trim().max(VACATION_NOTE_MAX_LENGTH).optional(),
})

const updateSchema = z
  .object({
    startDate: ymd.optional(),
    endDate: ymd.optional(),
    note: z.string().trim().max(VACATION_NOTE_MAX_LENGTH).nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nada para atualizar' })

const idParamsSchema = z.object({ id: z.string().min(1) })

function badInput(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ message: 'Dados inválidos', issues: error.issues })
}

function sendDomainError(reply: FastifyReply, err: unknown) {
  if (err instanceof VacationError) return reply.code(err.status).send({ message: err.message })
  throw err
}

/** Convidado (JWT de guest) não é usuário real — `sub` não é linha de `User`. */
function isGuest(request: { user: { role: string } }): boolean {
  return request.user.role === 'GUEST'
}

export async function vacationRoutes(app: FastifyInstance) {
  const authed = { onRequest: [app.authenticate] }

  /**
   * Férias da empresa no mês — alimenta o bloco da Home e a página Férias do
   * Mês. Rota própria, e não um parâmetro de `/vacations`: o escopo é outro
   * (empresa inteira, não o setor de quem olha) e a janela é sempre um mês.
   */
  app.get('/vacations/month', authed, async (request, reply) => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não vê férias' })
    const parsed = monthQuerySchema.safeParse(request.query)
    if (!parsed.success) return badInput(reply, parsed.error)
    const { from, to } = monthBoundsYmd(parsed.data.month)
    const vacations = await listCompanyVacations(request.user.companyId, from, to)
    return reply.send({ vacations })
  })

  app.get('/vacations', authed, async (request, reply) => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não vê férias' })
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return badInput(reply, parsed.error)
    const vacations = await listSectorVacations(
      request.user.sub,
      request.user.sectorId,
      parsed.data.from,
      parsed.data.to,
    )
    return reply.send({ vacations })
  })

  app.post('/vacations', authed, async (request, reply) => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não lança férias' })
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      const vacation = await createVacation(request.user.sub, {
        userId: parsed.data.userId,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        note: parsed.data.note ?? null,
      })
      return reply.code(201).send({ vacation })
    } catch (err) {
      return sendDomainError(reply, err)
    }
  })

  app.patch('/vacations/:id', authed, async (request, reply) => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não edita férias' })
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      const vacation = await updateVacation(request.user.sub, params.data.id, parsed.data)
      return reply.send({ vacation })
    } catch (err) {
      return sendDomainError(reply, err)
    }
  })

  app.delete('/vacations/:id', authed, async (request, reply) => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não remove férias' })
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    try {
      await deleteVacation(request.user.sub, params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return sendDomainError(reply, err)
    }
  })

  app.get('/me/team/vacations', authed, async (request, reply) => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não vê férias' })
    return reply.send(await listTeamVacations(request.user.sub))
  })
}
