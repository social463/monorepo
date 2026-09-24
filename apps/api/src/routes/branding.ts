import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  LOGO_MAX_BYTES,
  isAllowedLogoContentType,
  isValidHex,
  type BrandingDTO,
} from '@legends/shared'
import { absoluteUrl } from '../lib/app-url'
import { rasterizeSvgLogo } from '../lib/logo-raster'
import { prisma } from '../lib/prisma'
import { buildBrandingLogoKey, presignImageUpload, publicUrlFor, s3Config } from '../lib/s3-client'
import {
  BrandingError,
  brandingSchema,
  overridesSchema,
  getBranding,
  getBrandingSettings,
  getPublicBranding,
  previewBranding,
  teamsLogoSource,
  updateBranding,
} from '../services/branding-service'

const logoPresignSchema = z.object({
  contentType: z.string(),
  size: z.number().int().positive(),
})

/**
 * A prévia devolve os dois esquemas de uma vez — não recebe `scheme`.
 *
 * Recebe os `overrides` porque a paleta final é derivação **mais** ajustes: sem
 * eles, quem colasse os tokens de um design system veria na prévia uma paleta
 * que não é a que vai ser gravada.
 */
const previewSchema = z.object({
  brandColor: z.string().refine(isValidHex, { message: 'Cor deve ser um hex como #35bd78.' }),
  neutralColor: z
    .string()
    .refine(isValidHex, { message: 'Cor deve ser um hex como #f7fafc.' })
    .nullable()
    .default(null),
  overrides: overridesSchema.optional(),
})

/** Manifest PWA da empresa — mesma forma do `public/site.webmanifest`, com a marca do tenant. */
function manifestFor(branding: BrandingDTO) {
  const mark = branding.logos[branding.defaultScheme].mark
  const icons = mark
    ? [{ src: mark, sizes: '512x512', type: 'image/png', purpose: 'any' }]
    : [
        { src: '/favicon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/favicon-512.png', sizes: '512x512', type: 'image/png' },
      ]
  return {
    id: '/escritorio',
    name: branding.appName,
    short_name: branding.appName,
    start_url: '/escritorio',
    scope: '/',
    icons,
    theme_color: branding.colors.surface,
    background_color: branding.colors.surface,
    display: 'standalone',
  }
}

export async function brandingRoutes(app: FastifyInstance) {
  /**
   * **Público, sem autenticação** — de propósito: alimenta a primeira pintura da
   * tela de login, quando ainda não existe token nenhum. Não expõe nada sensível
   * (nome, logo e cores são o que qualquer visitante já vê na tela).
   */
  app.get('/branding', async (request, reply) => {
    const { slug } = request.query as { slug?: string }
    const branding = await getPublicBranding({ host: request.headers.host, slug })
    // Cache curto no browser: a marca muda raramente e isto é servido a cada visita.
    return reply.header('cache-control', 'public, max-age=300').send(branding)
  })

  /**
   * Logo da empresa em PNG, para quem não rasteriza SVG.
   *
   * Existe pelo card do Teams: quem busca esta imagem é o servidor da Microsoft,
   * que não desenha SVG e não tem token nenhum — daí ser **público**, como o
   * `GET /branding`. Não expõe nada novo: é a mesma logo que a tela de login já
   * mostra a qualquer visitante.
   *
   * A empresa vem no `company` porque a URL é montada pela API a partir do
   * `APP_BASE_URL`, e não pelo navegador do tenant — sem ele, o `Host` seria o
   * do host do app e toda empresa receberia a mesma logo. `slug`/`Host`
   * continuam valendo como caminho normal para quem chama do browser.
   *
   * Sem SVG para converter (empresa sem logo, ou logo que o Teams já busca
   * direto), redireciona para a arte do produto: melhor a marca errada do que o
   * ícone de imagem quebrada, que ainda por cima rouba a linha do rodapé.
   */
  app.get('/branding/logo.png', async (request, reply) => {
    const { company, slug } = request.query as { company?: string; slug?: string }
    const branding = company
      ? await getBranding(company)
      : await getPublicBranding({ host: request.headers.host, slug })

    const png = await rasterizeSvgLogo(teamsLogoSource(branding))
    if (!png) return reply.redirect(absoluteUrl('/illustration/logo-mark.png'), 302)

    // Cache longo: a URL carrega um `v` derivado da logo de origem, então logo
    // nova é URL nova e nunca colide com a resposta guardada da anterior.
    return reply
      .header('content-type', 'image/png')
      .header('cache-control', 'public, max-age=604800')
      .send(png)
  })

  app.get('/branding/manifest.webmanifest', async (request, reply) => {
    const { slug } = request.query as { slug?: string }
    const branding = await getPublicBranding({ host: request.headers.host, slug })
    return reply
      .header('content-type', 'application/manifest+json; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .send(JSON.stringify(manifestFor(branding)))
  })

  /**
   * A marca é do **fornecedor**, não do cliente: quem edita é o SUPER_ADMIN, no
   * console interno, escolhendo a empresa. É o contrato comercial de um produto
   * white label — o ADMIN da empresa administra a operação dela (pessoas,
   * períodos, selos), mas não redesenha o produto que contratou.
   *
   * Por isso a rota é `/super-admin/companies/:id/branding` e não
   * `/admin/branding`: o companyId vem da URL, e não do token de quem chama.
   */
  const superAdminOnly = { onRequest: [app.authenticate, app.requireSuperAdmin] }

  app.get('/super-admin/companies/:id/branding', superAdminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getBrandingSettings(id))
  })

  app.put('/super-admin/companies/:id/branding', superAdminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = brandingSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const settings = await updateBranding({ companyId: id, actorId: request.user.sub, body: parsed.data })
      return reply.send(settings)
    } catch (err) {
      if (err instanceof BrandingError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  /**
   * Prévia sem gravar: a tela mexe no seletor de cor e precisa ver a paleta
   * derivada e os avisos de contraste antes de salvar. Fica na API, e não no
   * front, para que a prévia seja a mesma paleta que o servidor vai resolver —
   * duas derivações independentes divergem no primeiro arredondamento.
   */
  /**
   * URL pré-assinada para subir a logo de uma empresa.
   *
   * Rota própria em vez de `/uploads/images/presign` por dois motivos: a chave
   * precisa ser da EMPRESA (`branding/<companyId>/…`), e não de quem sobe — que
   * aqui é o super admin, de outra empresa —, e a logo aceita **SVG**, que os
   * demais uploads não aceitam.
   */
  app.post('/super-admin/companies/:id/branding/logo-presign', superAdminOnly, async (request, reply) => {
    const cfg = s3Config()
    if (!cfg) return reply.code(503).send({ message: 'Uploads de imagem desabilitados.' })

    const { id } = request.params as { id: string }
    const parsed = logoPresignSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.issues })
    }
    const { contentType, size } = parsed.data
    if (!isAllowedLogoContentType(contentType)) {
      return reply.code(400).send({ message: 'Formato não suportado. Use SVG, PNG, WebP, JPEG ou GIF.' })
    }
    if (size > LOGO_MAX_BYTES) {
      return reply.code(400).send({ message: 'Logo muito grande (máx. 2MB).' })
    }

    const company = await prisma.company.findUnique({ where: { id }, select: { id: true } })
    if (!company) return reply.code(404).send({ message: 'Empresa não encontrada.' })

    const key = buildBrandingLogoKey(id, contentType)
    const uploadUrl = await presignImageUpload({ key, contentType })
    return reply.send({ uploadUrl, publicUrl: publicUrlFor(key, cfg), key })
  })

  app.post('/super-admin/branding/preview', superAdminOnly, async (request, reply) => {
    const parsed = previewSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    return reply.send(previewBranding(parsed.data))
  })
}
