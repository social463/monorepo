import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { USER_IMPORT_MAX_FILE_BYTES, USER_IMPORT_TEMPLATE_FILENAME } from '@legends/shared'
import { CsvParseError } from '../lib/csv-parse'
import {
  buildImportTemplate,
  commitUserImport,
  previewUserImport,
  UserImportError,
  type UserImportActor,
} from '../services/user-import-service'

/**
 * O `fileHash` vai na query, e não como campo do multipart, porque
 * `request.file()` só expõe em `part.fields` os campos que **precedem** a parte
 * do arquivo — depender dessa ordem seria frágil.
 */
const commitQuery = z.object({ fileHash: z.string().regex(/^[0-9a-f]{64}$/) })

function actorFrom(request: FastifyRequest): UserImportActor {
  return {
    id: request.user.sub,
    role: request.user.role as UserImportActor['role'],
    sectorId: request.user.sectorId,
    companyId: request.user.companyId,
  }
}

/** Devolve `null` quando já respondeu com erro. */
async function readSpreadsheet(request: FastifyRequest, reply: FastifyReply): Promise<Buffer | null> {
  const part = await request.file({ limits: { fileSize: USER_IMPORT_MAX_FILE_BYTES, files: 1 } })
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
  if (err instanceof UserImportError) {
    return reply.code(err.status).send({ message: err.message, issues: err.issues })
  }
  if (err instanceof CsvParseError) {
    return reply.code(err.status).send({ message: err.message })
  }
  throw err
}

export async function adminUserImportRoutes(app: FastifyInstance): Promise<void> {
  const adminOrSubadmin = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }

  app.get('/admin/users/import/template', adminOrSubadmin, async (_request, reply) => {
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${USER_IMPORT_TEMPLATE_FILENAME}"`)
      .send(buildImportTemplate())
  })

  app.post('/admin/users/import/preview', adminOrSubadmin, async (request, reply) => {
    const buffer = await readSpreadsheet(request, reply)
    if (!buffer) return reply
    try {
      // Não grava nada: só diz o que aconteceria.
      return await reply.send(await previewUserImport(actorFrom(request), buffer))
    } catch (err) {
      return respondImportError(reply, err)
    }
  })

  app.post('/admin/users/import/commit', adminOrSubadmin, async (request, reply) => {
    const parsed = commitQuery.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const buffer = await readSpreadsheet(request, reply)
    if (!buffer) return reply
    try {
      return await reply.send(await commitUserImport(actorFrom(request), buffer, parsed.data.fileHash))
    } catch (err) {
      return respondImportError(reply, err)
    }
  })
}
