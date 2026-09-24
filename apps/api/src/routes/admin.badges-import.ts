import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { BADGE_IMPORT_MAX_FILE_BYTES, BADGE_IMPORT_TEMPLATE_FILENAME } from '@legends/shared'
import { CsvParseError } from '../lib/csv-parse'
import {
  BadgeImportError,
  buildBadgeImportTemplate,
  commitBadgeImport,
  exportBadgesCsv,
  previewBadgeImport,
  type BadgeImportActor,
} from '../services/badge-import-service'

/**
 * Catálogo de selos por planilha (Documento 4, seção 11.5).
 *
 * Mesma forma da importação de eventos do calendário, e pelos mesmos motivos:
 * `preview` não grava nada, `commit` reenvia o arquivo inteiro, e o `fileHash`
 * vai na **query** porque `request.file()` só expõe em `part.fields` os campos
 * que precedem a parte do arquivo — depender dessa ordem seria frágil.
 *
 * Gate: `requireAdminOrSubadmin`, o mesmo do CRUD de selo em `admin.ts`. O
 * catálogo de selos não pertence a um bloco de setor.
 */
const commitQuery = z.object({ fileHash: z.string().regex(/^[0-9a-f]{64}$/) })

function actorFrom(request: FastifyRequest): BadgeImportActor {
  return { id: request.user.sub, companyId: request.user.companyId }
}

/** Devolve `null` quando já respondeu com erro. */
async function readSpreadsheet(request: FastifyRequest, reply: FastifyReply): Promise<Buffer | null> {
  const part = await request.file({ limits: { fileSize: BADGE_IMPORT_MAX_FILE_BYTES, files: 1 } })
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
  if (err instanceof BadgeImportError) {
    return reply.code(err.status).send({ message: err.message, issues: err.issues })
  }
  if (err instanceof CsvParseError) {
    return reply.code(err.status).send({ message: err.message })
  }
  throw err
}

export async function adminBadgeImportRoutes(app: FastifyInstance): Promise<void> {
  const gate = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }

  app.get('/admin/badges/import/template', gate, async (_request, reply) => {
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${BADGE_IMPORT_TEMPLATE_FILENAME}"`)
      .send(buildBadgeImportTemplate())
  })

  /** Export com as MESMAS colunas do template — é o que fecha o ciclo. */
  app.get('/admin/badges/export', gate, async (request, reply) => {
    const { fileName, csv } = await exportBadgesCsv(request.user.companyId)
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${fileName}"`)
      .send(csv)
  })

  app.post('/admin/badges/import/preview', gate, async (request, reply) => {
    const buffer = await readSpreadsheet(request, reply)
    if (!buffer) return reply
    try {
      // Não grava nada: só diz o que aconteceria.
      return await reply.send(await previewBadgeImport(actorFrom(request), buffer))
    } catch (err) {
      return respondImportError(reply, err)
    }
  })

  app.post('/admin/badges/import/commit', gate, async (request, reply) => {
    const parsed = commitQuery.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const buffer = await readSpreadsheet(request, reply)
    if (!buffer) return reply
    try {
      return await reply.send(await commitBadgeImport(actorFrom(request), buffer, parsed.data.fileHash))
    } catch (err) {
      return respondImportError(reply, err)
    }
  })
}
