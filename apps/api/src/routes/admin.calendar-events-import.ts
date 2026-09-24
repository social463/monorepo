import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { CALENDAR_IMPORT_MAX_FILE_BYTES, CALENDAR_IMPORT_TEMPLATE_FILENAME } from '@legends/shared'
import { CsvParseError } from '../lib/csv-parse'
import {
  buildCalendarImportTemplate,
  CalendarImportError,
  commitCalendarImport,
  previewCalendarImport,
  type CalendarImportActor,
} from '../services/calendar-event-import-service'

/**
 * Importação de eventos do calendário por planilha.
 *
 * Fica no bloco de **Desenvolvimento de Produto**, junto do catálogo de tipos
 * (`/admin/calendar-event-types`) e não junto do CRUD de evento: a importação
 * cria categoria, que é taxonomia da empresa e vira chip fixo no filtro do
 * calendário de todo mundo. A liderança cadastra evento avulso, mas quem mexe
 * no catálogo é o bloco.
 *
 * O `fileHash` vai na query, e não como campo do multipart, porque
 * `request.file()` só expõe em `part.fields` os campos que **precedem** a parte
 * do arquivo — depender dessa ordem seria frágil.
 */
const commitQuery = z.object({ fileHash: z.string().regex(/^[0-9a-f]{64}$/) })

function actorFrom(request: FastifyRequest): CalendarImportActor {
  return { id: request.user.sub, companyId: request.user.companyId }
}

/** Devolve `null` quando já respondeu com erro. */
async function readSpreadsheet(request: FastifyRequest, reply: FastifyReply): Promise<Buffer | null> {
  const part = await request.file({ limits: { fileSize: CALENDAR_IMPORT_MAX_FILE_BYTES, files: 1 } })
  if (!part) {
    await reply.code(400).send({ message: 'Envie a planilha no campo "file".' })
    return null
  }
  const buffer = await part.toBuffer()
  // `toBuffer` devolve o que coube no limite; quem denuncia o corte é a flag.
  if (part.file.truncated) {
    await reply.code(413).send({ message: 'A planilha passa de 1 MB. Divida em arquivos menores.' })
    return null
  }
  return buffer
}

function respondImportError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof CalendarImportError) {
    return reply.code(err.status).send({ message: err.message, issues: err.issues })
  }
  if (err instanceof CsvParseError) {
    return reply.code(err.status).send({ message: err.message })
  }
  throw err
}

export async function adminCalendarEventImportRoutes(app: FastifyInstance): Promise<void> {
  const produtoAdmin = { onRequest: [app.authenticate, app.requireSectorFeature('desenvolvimento-produto')] }

  app.get('/admin/calendar-events/import/template', produtoAdmin, async (_request, reply) => {
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${CALENDAR_IMPORT_TEMPLATE_FILENAME}"`)
      .send(buildCalendarImportTemplate())
  })

  app.post('/admin/calendar-events/import/preview', produtoAdmin, async (request, reply) => {
    const buffer = await readSpreadsheet(request, reply)
    if (!buffer) return reply
    try {
      // Não grava nada: só diz o que aconteceria.
      return await reply.send(await previewCalendarImport(actorFrom(request), buffer))
    } catch (err) {
      return respondImportError(reply, err)
    }
  })

  app.post('/admin/calendar-events/import/commit', produtoAdmin, async (request, reply) => {
    const parsed = commitQuery.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const buffer = await readSpreadsheet(request, reply)
    if (!buffer) return reply
    try {
      return await reply.send(await commitCalendarImport(actorFrom(request), buffer, parsed.data.fileHash))
    } catch (err) {
      return respondImportError(reply, err)
    }
  })
}
