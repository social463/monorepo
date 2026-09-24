import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  ALLOWED_DOCUMENT_CONTENT_TYPES,
  ALLOWED_IMAGE_CONTENT_TYPES,
  ALLOWED_MEDIA_CONTENT_TYPES,
  DOCUMENT_MAX_BYTES,
  IMAGE_MAX_BYTES,
  MEDIA_DOCUMENT_MAX_BYTES,
  VIDEO_MAX_BYTES,
  isAllowedDocumentContentType,
  isAllowedImageContentType,
  mediaKindFor,
  mediaMaxBytesFor,
  mediaTooLargeMessage,
  type AllowedImageContentType,
  type DocumentUploadConfig,
  type ImageUploadConfig,
  type MediaUploadConfig,
} from '@legends/shared'
import {
  buildBadgeClaimKey,
  buildApprenticeMaterialKey,
  buildCertificateAttachmentKey,
  buildChallengeEvidenceKey,
  buildDocumentKey,
  buildEventPhotoKey,
  buildFeedMediaKey,
  buildImageKey,
  buildInovaDiaryKey,
  buildInovaGuiaVideoKey,
  buildPersonalAssetKey,
  buildVisualAssetKey,
  imageUploadsEnabled,
  presignDocumentUpload,
  presignImageUpload,
  publicUrlFor,
  s3Config,
} from '../lib/s3-client'
import { scopedPrisma } from '../lib/tenant-scope'

const presignSchema = z.object({
  contentType: z.string(),
  size: z.number().int().positive(),
})
const personalPresignSchema = presignSchema.extend({ recipientId: z.string().min(1) })

export async function imageUploadRoutes(app: FastifyInstance) {
  app.get('/uploads/config', async (_request, reply) => {
    const config: ImageUploadConfig = {
      enabled: imageUploadsEnabled(),
      maxBytes: IMAGE_MAX_BYTES,
      allowedContentTypes: [...ALLOWED_IMAGE_CONTENT_TYPES],
    }
    return reply.send(config)
  })

  app.post('/uploads/images/presign', { onRequest: [app.authenticate] }, async (request, reply) => {
    const cfg = s3Config()
    if (!cfg) return reply.code(503).send({ message: 'Uploads de imagem desabilitados.' })

    const parsed = presignSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const { contentType, size } = parsed.data
    if (!isAllowedImageContentType(contentType)) {
      return reply.code(400).send({ message: 'Formato não suportado. Use JPEG, PNG, WebP ou GIF.' })
    }
    if (size > IMAGE_MAX_BYTES) {
      return reply.code(400).send({ message: 'Imagem muito grande (máx. 10MB).' })
    }

    const key = buildImageKey(request.user.sub, contentType as AllowedImageContentType)
    const uploadUrl = await presignImageUpload({ key, contentType })
    return reply.send({ uploadUrl, publicUrl: publicUrlFor(key, cfg), key })
  })

  app.get('/uploads/documents/config', { onRequest: [app.authenticate] }, async (_request, reply) => {
    const config: DocumentUploadConfig = {
      enabled: imageUploadsEnabled(),
      maxBytes: DOCUMENT_MAX_BYTES,
      allowedContentTypes: [...ALLOWED_DOCUMENT_CONTENT_TYPES],
    }
    return reply.send(config)
  })

  // Documento (PDF de manual interno): só quem administra sobe, e a resposta
  // não devolve URL pública — o download passa por /culture/manuals/:id/download.
  app.post(
    '/uploads/documents/presign',
    { onRequest: [app.authenticate, app.requireAdminOrSubadmin] },
    async (request, reply) => {
      if (!s3Config()) return reply.code(503).send({ message: 'Uploads de documento desabilitados.' })

      const parsed = presignSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
      }
      const { contentType, size } = parsed.data
      if (!isAllowedDocumentContentType(contentType)) {
        return reply.code(400).send({ message: 'Formato não suportado. Envie um PDF.' })
      }
      if (size > DOCUMENT_MAX_BYTES) {
        return reply.code(400).send({ message: 'Arquivo muito grande (máx. 20MB).' })
      }

      const key = buildDocumentKey(request.user.companyId)
      const uploadUrl = await presignDocumentUpload({ key, contentType })
      return reply.send({ uploadUrl, key })
    },
  )

  app.get('/uploads/media/config', { onRequest: [app.authenticate] }, async (_request, reply) => {
    const config: MediaUploadConfig = {
      enabled: imageUploadsEnabled(),
      imageMaxBytes: IMAGE_MAX_BYTES,
      videoMaxBytes: VIDEO_MAX_BYTES,
      documentMaxBytes: MEDIA_DOCUMENT_MAX_BYTES,
      allowedContentTypes: [...ALLOWED_MEDIA_CONTENT_TYPES],
    }
    return reply.send(config)
  })

  /**
   * Anexo do Feed Corporativo: foto, vídeo ou documento, enviado por **qualquer
   * colaborador autenticado**. É a diferença que justifica a rota existir:
   * `/uploads/documents/presign` é `requireAdminOrSubadmin` e só PDF (nasceu
   * para o manual interno), e agora todo mundo escreve no feed.
   *
   * A espécie do anexo é derivada do content-type aqui (`mediaKindFor`), nunca
   * lida do corpo: quem manda o arquivo não decide se ele é imagem ou vídeo, e
   * é isso que amarra o teto de tamanho ao formato de verdade.
   */
  app.post('/uploads/media/presign', { onRequest: [app.authenticate] }, async (request, reply) => {
    const cfg = s3Config()
    if (!cfg) return reply.code(503).send({ message: 'Uploads desabilitados.' })

    const parsed = presignSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const { contentType, size } = parsed.data
    const kind = mediaKindFor(contentType)
    if (!kind) {
      return reply.code(400).send({ message: 'Formato não suportado. Envie imagem, vídeo MP4/WebM, PDF ou Office.' })
    }
    if (size > mediaMaxBytesFor(kind)) {
      return reply.code(400).send({ message: mediaTooLargeMessage(kind) })
    }

    const key = buildFeedMediaKey(request.user.companyId, request.user.sub, contentType)
    // Vídeo e documento usam o mesmo presign de PUT da imagem: o que muda entre
    // eles é allowlist e teto, não o mecanismo.
    const uploadUrl = await presignImageUpload({ key, contentType })
    return reply.send({ uploadUrl, publicUrl: publicUrlFor(key, cfg), key, kind })
  })

  /**
   * Evidência do diário de bordo do INOVA: imagem ou vídeo, enviado por
   * qualquer colaborador autenticado (diário é aberto a todo mundo, só
   * criar/editar projeto e mudar fase é admin/subadmin). Mesmos tipo/tamanho
   * de mídia já usados pelo Feed — sem limite novo.
   */
  app.post('/uploads/inova-diary/presign', { onRequest: [app.authenticate] }, async (request, reply) => {
    const cfg = s3Config()
    if (!cfg) return reply.code(503).send({ message: 'Uploads desabilitados.' })

    const parsed = presignSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const { contentType, size } = parsed.data
    const kind = mediaKindFor(contentType)
    if (!kind || (kind !== 'IMAGE' && kind !== 'VIDEO')) {
      return reply.code(400).send({ message: 'Formato não suportado. Envie imagem ou vídeo MP4/WebM.' })
    }
    if (size > mediaMaxBytesFor(kind)) {
      return reply.code(400).send({ message: mediaTooLargeMessage(kind) })
    }

    const key = buildInovaDiaryKey(request.user.companyId, request.user.sub, contentType)
    const uploadUrl = await presignImageUpload({ key, contentType })
    return reply.send({ uploadUrl, publicUrl: publicUrlFor(key, cfg), key, kind })
  })

  /**
   * Vídeo da biblioteca do Guia AI First (Comunidade INOVA), enviado só por
   * quem administra — a mesma trava de `requireAdminOrSubadmin` das rotas de
   * escrita em `/inova/guia/videos`. Só vídeo (MP4/WebM): a biblioteca não
   * aceita imagem no lugar do vídeo.
   */
  app.post(
    '/uploads/inova-guia-video/presign',
    { onRequest: [app.authenticate, app.requireAdminOrSubadmin] },
    async (request, reply) => {
      const cfg = s3Config()
      if (!cfg) return reply.code(503).send({ message: 'Uploads de vídeo desabilitados.' })

      const parsed = presignSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
      }
      const { contentType, size } = parsed.data
      const kind = mediaKindFor(contentType)
      if (kind !== 'VIDEO') {
        return reply.code(400).send({ message: 'Formato não suportado. Envie um vídeo MP4 ou WebM.' })
      }
      if (size > VIDEO_MAX_BYTES) {
        return reply.code(400).send({ message: mediaTooLargeMessage('VIDEO') })
      }

      const key = buildInovaGuiaVideoKey(request.user.companyId, contentType)
      const uploadUrl = await presignImageUpload({ key, contentType })
      return reply.send({ uploadUrl, publicUrl: publicUrlFor(key, cfg), storagePath: key })
    },
  )

  // Evidência de participação em desafio: qualquer colaborador autenticado sobe
  // (não é admin/subadmin como o presign de manual acima). Mesmos tipo/tamanho
  // permitidos de documento — reaproveita as constantes de @legends/shared, não
  // inventa limite novo. A chave sai SEMPRE montada no servidor, namespaced pelo
  // próprio usuário (challenges/<userId>/<uuid>.pdf): challenges.ts confere esse
  // prefixo no submit, então o cliente nunca escolhe onde a evidência é gravada.
  app.post(
    '/uploads/challenge-evidence/presign',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      if (!s3Config()) return reply.code(503).send({ message: 'Uploads de evidência desabilitados.' })

      const parsed = presignSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
      }
      const { contentType, size } = parsed.data
      if (!isAllowedDocumentContentType(contentType)) {
        return reply.code(400).send({ message: 'Formato não suportado. Envie um PDF.' })
      }
      if (size > DOCUMENT_MAX_BYTES) {
        return reply.code(400).send({ message: 'Arquivo muito grande (máx. 20MB).' })
      }

      const key = buildChallengeEvidenceKey(request.user.sub)
      const uploadUrl = await presignDocumentUpload({ key, contentType })
      return reply.send({ uploadUrl, key })
    },
  )

  /**
   * Comprovação de uma reivindicação de selo (Documento 4, seção 11.2).
   *
   * Imagem **ou** PDF, que é o que o documento pede — daí não reusar o presign
   * de evidência de desafio, que é só PDF. A chave nasce no servidor,
   * namespaced pelo próprio usuário (`badge-claims/<userId>/…`), e o service
   * confere esse prefixo no envio: o cliente nunca escolhe onde grava.
   */
  app.post('/uploads/badge-claim/presign', { onRequest: [app.authenticate] }, async (request, reply) => {
    if (!s3Config()) return reply.code(503).send({ message: 'Uploads de comprovação desabilitados.' })

    const parsed = presignSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const { contentType, size } = parsed.data
    const kind = mediaKindFor(contentType)
    if (kind !== 'IMAGE' && contentType !== 'application/pdf') {
      return reply.code(400).send({ message: 'Formato não suportado. Envie uma imagem ou um PDF.' })
    }
    if (size > mediaMaxBytesFor(kind ?? 'DOCUMENT')) {
      return reply.code(400).send({ message: mediaTooLargeMessage(kind ?? 'DOCUMENT') })
    }

    const key = buildBadgeClaimKey(request.user.sub, contentType)
    const uploadUrl = await presignImageUpload({ key, contentType })
    return reply.send({ uploadUrl, key, kind: kind ?? 'DOCUMENT' })
  })

  /**
   * Certificado de curso EXTERNO anexado pelo colaborador (Documento 4, seção
   * 9.8). Aceita imagem ou PDF — o formulário pede "uma foto visível do seu
   * certificado", e nem todo mundo tem o PDF.
   *
   * Aberta a qualquer colaborador autenticado, como a comprovação de selo: quem
   * faz curso é quem envia. A chave nasce namespaced pelo próprio usuário
   * (`certificate-requests/<userId>/…`), e o service confere esse prefixo antes
   * de gravar — o cliente nunca escolhe onde grava nem anexa o documento alheio.
   */
  app.post('/uploads/certificate-request/presign', { onRequest: [app.authenticate] }, async (request, reply) => {
    if (!s3Config()) return reply.code(503).send({ message: 'Envio de certificado desabilitado.' })

    const parsed = presignSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const { contentType, size } = parsed.data
    const kind = mediaKindFor(contentType)
    if (kind !== 'IMAGE' && contentType !== 'application/pdf') {
      return reply.code(400).send({ message: 'Formato não suportado. Envie uma imagem ou um PDF.' })
    }
    if (size > mediaMaxBytesFor(kind ?? 'DOCUMENT')) {
      return reply.code(400).send({ message: mediaTooLargeMessage(kind ?? 'DOCUMENT') })
    }

    const key = buildCertificateAttachmentKey(request.user.sub, contentType)
    const uploadUrl = await presignImageUpload({ key, contentType })
    return reply.send({ uploadUrl, key, kind: kind ?? 'DOCUMENT' })
  })

  /**
   * Material e apresentação da trilha Eu Aprendiz.
   *
   * Só o facilitador sobe (mesmo guard do painel), e a chave nasce namespaced
   * pela empresa — o material é do encontro, não de uma pessoa. Aceita o mesmo
   * conjunto do anexo de certificado mais os formatos de apresentação, que é o
   * que a G&G leva para o encontro.
   */
  app.post(
    '/uploads/apprentice-material/presign',
    { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] },
    async (request, reply) => {
      if (!s3Config()) return reply.code(503).send({ message: 'Envio de arquivos desabilitado.' })

      const parsed = presignSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
      }
      const { contentType, size } = parsed.data
      const kind = mediaKindFor(contentType)
      if (!kind) {
        return reply.code(400).send({ message: 'Formato não suportado.' })
      }
      if (size > mediaMaxBytesFor(kind)) {
        return reply.code(400).send({ message: mediaTooLargeMessage(kind) })
      }

      const key = buildApprenticeMaterialKey(request.user.companyId, contentType)
      const uploadUrl = await presignImageUpload({ key, contentType })
      return reply.send({ uploadUrl, key, kind })
    },
  )

  // Foto de álbum de evento: só quem administra Gente e Gestão sobe (a galeria é
  // publicada por G&G, não por qualquer colaborador). Mesmos tipo/tamanho de
  // imagem já padronizados em @legends/shared — sem limite novo. A resposta NÃO
  // devolve URL: quem resolve a pública é o serialize, a partir da chave salva.
  app.post(
    '/uploads/event-photos/presign',
    { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] },
    async (request, reply) => {
      if (!s3Config()) return reply.code(503).send({ message: 'Uploads de imagem desabilitados.' })

      const parsed = presignSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
      }
      const { contentType, size } = parsed.data
      if (!isAllowedImageContentType(contentType)) {
        return reply.code(400).send({ message: 'Formato não suportado. Use JPEG, PNG, WebP ou GIF.' })
      }
      if (size > IMAGE_MAX_BYTES) {
        return reply.code(400).send({ message: 'Imagem muito grande (máx. 10MB).' })
      }

      const key = buildEventPhotoKey(request.user.companyId, contentType as AllowedImageContentType)
      const uploadUrl = await presignImageUpload({ key, contentType })
      return reply.send({ uploadUrl, key })
    },
  )

  // Peça do kit visual: mesmo guard da foto de evento (o kit é publicado por
  // Gente e Gestão) e mesmos limites de imagem de @legends/shared. A resposta
  // devolve só a chave — quem resolve a URL pública é o serialize, para a base
  // pública poder mudar sem reescrever linha de banco.
  app.post(
    '/uploads/visual-assets/presign',
    { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] },
    async (request, reply) => {
      if (!s3Config()) return reply.code(503).send({ message: 'Uploads de imagem desabilitados.' })

      const parsed = presignSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
      }
      const { contentType, size } = parsed.data
      if (!isAllowedImageContentType(contentType)) {
        return reply.code(400).send({ message: 'Formato não suportado. Use JPEG, PNG, WebP ou GIF.' })
      }
      if (size > IMAGE_MAX_BYTES) {
        return reply.code(400).send({ message: 'Imagem muito grande (máx. 10MB).' })
      }

      const key = buildVisualAssetKey(request.user.companyId, contentType as AllowedImageContentType)
      const uploadUrl = await presignImageUpload({ key, contentType })
      return reply.send({ uploadUrl, key })
    },
  )

  /**
   * Material pessoal do kit. Aceita imagem OU PDF (foto do ensaio e certificado
   * são a mesma entrega, do ponto de vista de quem publica), e a chave carrega o
   * destinatário — por isso ele viaja no corpo e é conferido aqui: sem essa
   * checagem, daria para gerar chave na pasta de uma pessoa de outra empresa.
   */
  app.post(
    '/uploads/personal-assets/presign',
    { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] },
    async (request, reply) => {
      if (!s3Config()) return reply.code(503).send({ message: 'Uploads desabilitados.' })

      const parsed = personalPresignSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
      }
      const { contentType, size, recipientId } = parsed.data
      const imagem = isAllowedImageContentType(contentType)
      const documento = isAllowedDocumentContentType(contentType)
      if (!imagem && !documento) {
        return reply.code(400).send({ message: 'Formato não suportado. Envie uma imagem ou um PDF.' })
      }
      const teto = imagem ? IMAGE_MAX_BYTES : DOCUMENT_MAX_BYTES
      if (size > teto) {
        return reply
          .code(400)
          .send({ message: imagem ? 'Imagem muito grande (máx. 10MB).' : 'Arquivo muito grande (máx. 20MB).' })
      }
      // `scopedPrisma` recorta por empresa: pessoa de outro tenant não existe daqui.
      const destinatario = await scopedPrisma(request.user.companyId).user.findUnique({
        where: { id: recipientId },
        select: { id: true },
      })
      if (!destinatario) return reply.code(404).send({ message: 'Pessoa não encontrada.' })

      const key = buildPersonalAssetKey(request.user.companyId, recipientId, contentType)
      const uploadUrl = imagem
        ? await presignImageUpload({ key, contentType })
        : await presignDocumentUpload({ key, contentType })
      return reply.send({ uploadUrl, key, kind: imagem ? 'IMAGE' : 'DOCUMENT' })
    },
  )
}
