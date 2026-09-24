import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  BRAND_COLOR_TOKENS,
  BRAND_SCHEMES,
  isValidBrandFontFamily,
  LEGENDS_PRESET,
  brandingFromPreset,
  checkBrandContrast,
  isValidHex,
  isValidHost,
  normalizeHost,
  resolveBrandSchemes,
  type BrandContrastIssue,
  type BrandOverrides,
  type BrandPalette,
  type BrandScheme,
  type BrandingDTO,
  type BrandingPreset,
  hexToOklch,
  oklchToHex,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { absoluteUrl } from '../lib/app-url'
import { resolveBrandingBaseDomain } from '../lib/config'
import { isRasterizableSvgLogo } from '../lib/logo-raster'
import { isTeamsRenderableLogo } from '../lib/teams-client'
import { recordAuditLog } from './audit-log-service'

/**
 * Marca da empresa — nome, logo e paleta. Segue o padrão de
 * `ai-settings-service`: uma linha em `AppSetting` sob `(key, companyId)`, sem
 * migration por campo.
 *
 * O valor é **um JSON só** em vez de uma chave por campo. São 8 campos mais até
 * 35 overrides de cor; espalhados em linhas, ler a marca custaria 40 consultas
 * e gravar não seria atômico — a interface piscaria meio repintada se um write
 * falhasse no meio.
 *
 * Aqui não há segredo: a marca é pública por definição (aparece na tela de
 * login, antes de qualquer autenticação), então nada é cifrado.
 */
export const BRANDING_SETTING_KEY = 'branding'

const AUDIT_ENTITY = 'Branding'

export class BrandingError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'BrandingError'
  }
}

const hexColor = z
  .string()
  .refine(isValidHex, { message: 'Cor deve ser um hex como #35bd78.' })
  .transform((value) => {
    const v = value.trim().replace(/^#/, '').toLowerCase()
    const full = v.length === 3 ? v.split('').map((ch) => ch + ch).join('') : v
    return `#${full}`
  })

/** Logo é URL do S3 ou caminho da raiz (as do próprio produto vivem em `/illustration`). */
const assetUrl = z
  .string()
  .max(2048)
  .refine((value) => value.startsWith('/') || /^https?:\/\//i.test(value), {
    message: 'A logo deve ser uma URL http(s) ou um caminho começando com /.',
  })

const paletteOverridesSchema = z.record(z.enum(BRAND_COLOR_TOKENS), hexColor)

/** Um conjunto de ajustes por esquema — claro e escuro não compartilham hex. */
export const overridesSchema = z.object({
  light: paletteOverridesSchema.optional(),
  dark: paletteOverridesSchema.optional(),
})

/**
 * Domínios da empresa. Normalizados na entrada para que a comparação com o
 * header `Host` seja string a string, sem esperteza no meio do caminho.
 */
const hostsSchema = z
  .array(
    z
      .string()
      .max(253)
      .refine(isValidHost, { message: 'Domínio inválido. Use algo como legends.suaempresa.com.br.' })
      .transform(normalizeHost),
  )
  .max(10, 'No máximo 10 domínios por empresa.')
  .transform((lista) => [...new Set(lista)])

export const brandingSchema = z.object({
  appName: z.string().trim().min(1, 'Informe o nome exibido.').max(60),
  tagline: z.string().trim().max(120).nullable(),
  hosts: hostsSchema.default([]),
  logos: z.object({
    light: z.object({ wide: assetUrl.nullable(), mark: assetUrl.nullable() }),
    dark: z.object({ wide: assetUrl.nullable(), mark: assetUrl.nullable() }),
  }),
  defaultScheme: z.enum(BRAND_SCHEMES),
  allowUserScheme: z.boolean(),
  brandColor: hexColor,
  neutralColor: hexColor.nullable(),
  /*
   * Tipografia da empresa. Opcional: registro gravado antes desta versão não
   * tem o campo, e a ausência dele significa "a fonte do produto", não erro.
   *
   * O nome da família passa por `isValidBrandFontFamily` porque ele entra numa
   * URL do Google Fonts **e** numa declaração `font-family` — aceitar aspas ou
   * ponto e vírgula seria deixar o cadastro de marca escrever CSS.
   */
  fonts: z
    .object({
      headline: z.string().trim().refine(isValidBrandFontFamily, 'Nome de fonte inválido.'),
      body: z.string().trim().refine(isValidBrandFontFamily, 'Nome de fonte inválido.'),
    })
    .optional(),
  overrides: overridesSchema.optional(),
})

export type StoredBranding = z.infer<typeof brandingSchema>

/**
 * Cache em memória. `GET /branding` é **público** e roda em toda carga de página
 * anônima; sem cache, a tela de login vira uma consulta ao banco por visita.
 *
 * A marca muda quando um admin salva — evento raro e que passa por aqui — então
 * invalidar no `PUT` basta. Em vários processos, cada um mantém o seu e o pior
 * caso é um deles servir a marca antiga até o próximo deploy; por isso o TTL.
 */
const CACHE_TTL_MS = 5 * 60_000
const brandingCache = new Map<string, { value: BrandingDTO; expiresAt: number }>()
const slugCache = new Map<string, { companyId: string | null; expiresAt: number }>()
let hostIndex: { porHost: Map<string, string>; expiresAt: number } | null = null

export function clearBrandingCache(): void {
  brandingCache.clear()
  slugCache.clear()
  hostIndex = null
}

/**
 * Índice domínio → empresa, montado lendo as marcas cadastradas.
 *
 * É uma varredura, e é intencional: são poucas empresas por instalação, os
 * registros são minúsculos e isto fica atrás do mesmo cache do resto. A
 * alternativa — coluna indexada em `Company` — custaria migration para ganhar
 * milissegundos num endpoint que já responde de memória. Se um dia forem
 * centenas de tenants, aí vale a coluna.
 */
async function hostToCompanyId(host: string): Promise<string | null> {
  if (!hostIndex || hostIndex.expiresAt <= Date.now()) {
    const rows = await prisma.appSetting.findMany({
      where: { key: BRANDING_SETTING_KEY },
      select: { companyId: true, value: true },
    })
    const porHost = new Map<string, string>()
    for (const row of rows) {
      if (!row.value) continue
      try {
        const parsed = brandingSchema.safeParse(JSON.parse(row.value))
        if (!parsed.success) continue
        for (const h of parsed.data.hosts) porHost.set(h, row.companyId)
      } catch {
        // Registro corrompido não pode derrubar a resolução das outras empresas.
      }
    }
    hostIndex = { porHost, expiresAt: Date.now() + CACHE_TTL_MS }
  }
  return hostIndex.porHost.get(host) ?? null
}

/** A marca do produto — empresa sem nada cadastrado, e fallback do endpoint público. */
export function defaultBranding(): BrandingDTO {
  return brandingFromPreset(LEGENDS_PRESET)
}

function presetFromStored(stored: StoredBranding): BrandingPreset {
  return {
    appName: stored.appName,
    tagline: stored.tagline,
    hosts: stored.hosts,
    logos: stored.logos,
    defaultScheme: stored.defaultScheme,
    allowUserScheme: stored.allowUserScheme,
    brandColor: stored.brandColor,
    neutralColor: stored.neutralColor,
    fonts: stored.fonts,
    overrides: stored.overrides ?? {},
  }
}

/**
 * Lê o que está gravado, sem resolver a paleta. `null` = empresa nunca
 * configurou a marca.
 *
 * JSON corrompido ou de uma versão anterior do formato devolve `null` em vez de
 * estourar: a marca não pode ser o motivo de a tela de login não abrir.
 */
export async function readStoredBranding(companyId: string): Promise<StoredBranding | null> {
  const row = await prisma.appSetting.findUnique({
    where: { key_companyId: { key: BRANDING_SETTING_KEY, companyId } },
  })
  if (!row?.value) return null
  try {
    const parsed = brandingSchema.safeParse(JSON.parse(row.value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Marca resolvida (paleta já derivada e com overrides aplicados) de uma empresa. */
export async function getBranding(companyId: string): Promise<BrandingDTO> {
  const cached = brandingCache.get(companyId)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const stored = await readStoredBranding(companyId)
  const value = stored ? brandingFromPreset(presetFromStored(stored)) : defaultBranding()
  brandingCache.set(companyId, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  return value
}

/**
 * Primeiro rótulo do host, quando ele está sob o domínio-base configurado.
 * `emr.legends.com.br` + base `legends.com.br` → `emr`. Qualquer outra coisa
 * (o próprio domínio-base, um host desconhecido, IP, localhost) → `null`.
 */
export function slugFromHost(host: string | undefined | null, baseDomain: string | null): string | null {
  if (!host || !baseDomain) return null
  const hostname = host.split(':')[0]?.trim().toLowerCase()
  if (!hostname) return null
  const suffix = `.${baseDomain}`
  if (!hostname.endsWith(suffix)) return null
  const sub = hostname.slice(0, -suffix.length)
  // Só o primeiro nível conta: `a.b.legends.com.br` não é tenant `a`.
  if (!sub || sub.includes('.')) return null
  return sub
}

async function companyIdBySlug(slug: string): Promise<string | null> {
  const cached = slugCache.get(slug)
  if (cached && cached.expiresAt > Date.now()) return cached.companyId
  const company = await prisma.company.findUnique({ where: { slug }, select: { id: true, active: true } })
  const companyId = company?.active ? company.id : null
  slugCache.set(slug, { companyId, expiresAt: Date.now() + CACHE_TTL_MS })
  return companyId
}

/**
 * Marca para o endpoint **público**: resolve pelo subdomínio, com `slug`
 * explícito como escape para desenvolvimento local (onde não há wildcard de
 * DNS). Sem empresa resolvida, devolve a marca do produto — nunca um erro, já
 * que isto alimenta a primeira pintura da tela de login.
 */
export async function getPublicBranding(input: {
  host?: string | null
  slug?: string | null
}): Promise<BrandingDTO> {
  // 1) `?slug=` — escape explícito de desenvolvimento, vence tudo.
  const slugExplicito = input.slug?.trim().toLowerCase()
  if (slugExplicito) {
    const companyId = await companyIdBySlug(slugExplicito)
    return companyId ? getBranding(companyId) : defaultBranding()
  }

  if (input.host) {
    // 2) Domínio próprio da empresa. Vem antes do subdomínio porque é mais
    //    específico: quem cadastrou o domínio quis exatamente aquilo.
    const porDominio = await hostToCompanyId(normalizeHost(input.host))
    if (porDominio) return getBranding(porDominio)

    // 3) Subdomínio sob o host do app (`emr.<host do app>`), para cliente sem
    //    domínio próprio.
    const slug = slugFromHost(input.host, resolveBrandingBaseDomain(process.env))
    if (slug) {
      const companyId = await companyIdBySlug(slug)
      if (companyId) return getBranding(companyId)
    }
  }

  return defaultBranding()
}

export interface BrandingSettingsDTO extends BrandingDTO {
  /** Ajustes finos por cima da derivação — a tela de admin precisa saber quais são manuais. */
  overrides: BrandOverrides
  /** Se a empresa já salvou marca alguma vez. */
  configured: boolean
  /** Pares reprovados, **por esquema**: uma paleta pode passar no claro e falhar no escuro. */
  contrastIssues: Record<BrandScheme, BrandContrastIssue[]>
}

export async function getBrandingSettings(companyId: string): Promise<BrandingSettingsDTO> {
  const stored = await readStoredBranding(companyId)
  const branding = stored ? brandingFromPreset(presetFromStored(stored)) : defaultBranding()
  return {
    ...branding,
    overrides: stored?.overrides ?? {},
    configured: stored !== null,
    contrastIssues: {
      light: checkBrandContrast(branding.schemes.light),
      dark: checkBrandContrast(branding.schemes.dark),
    },
  }
}

export async function updateBranding(input: {
  companyId: string
  actorId: string
  body: StoredBranding
}): Promise<BrandingSettingsDTO> {
  const { companyId, actorId, body } = input

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } })
  if (!company) throw new BrandingError('Empresa não encontrada.', 404)

  const before = await getBrandingSettings(companyId)

  await prisma.appSetting.upsert({
    where: { key_companyId: { key: BRANDING_SETTING_KEY, companyId } },
    create: { key: BRANDING_SETTING_KEY, companyId, value: JSON.stringify(body) },
    update: { value: JSON.stringify(body) },
  })
  brandingCache.delete(companyId)
  // Os domínios podem ter mudado neste mesmo salvamento.
  hostIndex = null

  const after = await getBrandingSettings(companyId)
  await recordAuditLog({
    actorId,
    entityType: AUDIT_ENTITY,
    entityId: companyId,
    action: 'UPDATE',
    companyId,
    before,
    after,
  })
  return after
}

/**
 * Marca no formato que o card do Teams precisa: nome e uma URL de logo que os
 * servidores da Microsoft consigam buscar pela internet pública.
 *
 * O card é renderizado do lado da Microsoft, então caminho relativo
 * (`/illustration/...`) viraria imagem quebrada — e **SVG também**, mesmo sendo
 * URL pública que responde 200 (ver `isTeamsRenderableLogo`).
 *
 * Logo em SVG não vira `null` por causa disso: as marcas cadastradas SÃO SVG (as
 * quatro da EMR são), e descartá-las deixava a empresa com a logo cadastrada e o
 * card assinado com a arte do produto — o punho do Legends embaixo de "Portal
 * EMR". O que entra no lugar é a URL pública do MESMO desenho já rasterizado
 * (`GET /branding/logo.png`, ver `teamsLogoSource`). `null` fica para quem
 * realmente não tem logo aproveitável, e aí sim o rodapé cai na arte do produto.
 *
 * Vale o `mark` do esquema padrão, mas o `wide` entra na frente quando o `mark`
 * existe e não é renderizável: preferir o quadrado só faz sentido se ele for
 * aparecer. Logo que o Teams busca direto continua vencendo a rasterizada — é um
 * round-trip a menos, e o que já funcionava não muda de endereço.
 */
export async function teamsBrandFor(companyId: string): Promise<{ appName: string; logoUrl: string | null }> {
  const branding = await getBranding(companyId)
  // O card do Teams tem fundo próprio (claro ou escuro, conforme o cliente da
  // pessoa) — então vale a arte do esquema padrão da empresa, sem tentar adivinhar.
  const doEsquema = branding.logos[branding.defaultScheme]
  const direta = [doEsquema.mark, doEsquema.wide].find(isTeamsRenderableLogo)
  if (direta) return { appName: branding.appName, logoUrl: direta }

  const svg = teamsLogoSource(branding)
  return { appName: branding.appName, logoUrl: svg ? brandLogoPngUrl(companyId, svg) : null }
}

/**
 * A logo que `GET /branding/logo.png` deve devolver rasterizada — a MESMA
 * escolha do rodapé, e por isso uma função só: a rota não recebe qual arte
 * servir, senão a URL do card e o que a rota entrega poderiam divergir.
 */
export function teamsLogoSource(branding: BrandingDTO): string | null {
  const doEsquema = branding.logos[branding.defaultScheme]
  return [doEsquema.mark, doEsquema.wide].find(isRasterizableSvgLogo) ?? null
}

/**
 * URL pública do PNG derivado da logo da empresa.
 *
 * Leva o `companyId` porque `absoluteUrl` monta sempre em cima do `APP_BASE_URL`
 * — o Host do tenant não chega até aqui, e sem o parâmetro toda empresa receberia
 * a logo de quem responde por aquele host. O `/api` é o prefixo que o nginx faz
 * proxy, mesmo motivo do callback do calendário.
 *
 * O `v` sai da logo de origem: trocar a logo troca a URL, então a cache de
 * imagem da Microsoft não devolve a marca velha para o card novo.
 */
function brandLogoPngUrl(companyId: string, sourceUrl: string): string {
  const v = createHash('sha1').update(sourceUrl).digest('hex').slice(0, 8)
  return absoluteUrl(`/api/branding/logo.png?company=${encodeURIComponent(companyId)}&v=${v}`)
}

/**
 * Marca para o **certificado**: cor de destaque e logo, para o modelo que
 * deixou esses campos em branco.
 *
 * A cor não é a institucional crua. O papel do certificado é claro, e a mesma
 * armadilha do `primary` vale aqui: o verde da EMR (`#35bd78`) rende 2.3:1
 * sobre branco. O que entra é o tom legível do MESMO matiz — a cor continua
 * sendo reconhecidamente a da empresa, e o título do certificado continua
 * legível impresso.
 *
 * A logo é a do esquema **claro**, porque é sobre papel branco que ela vai
 * aparecer — não a do esquema padrão da empresa, que é a regra do Teams (lá o
 * fundo é o do cliente de quem lê, e não dá para saber).
 *
 * **SVG entra**, ao contrário do Teams. Lá quem desenha é a Microsoft e não há
 * como interferir; aqui quem desenha é o resvg, que rasteriza SVG dentro de
 * `<image>` sem reclamar (provado em `certificate-renderer.test.ts`) — e a logo
 * embutida do próprio certificado sempre foi um SVG. O que fica de fora é
 * caminho relativo, que não resolve fora do navegador: `fetch('/logo.png')` não
 * tem host para onde ir do lado do servidor.
 */
export async function certificateBrandFor(
  companyId: string,
): Promise<{ accentColor: string; logoUrl: string | null }> {
  const branding = await getBranding(companyId)
  const brand = hexToOklch(branding.brandColor)
  const noPapel = branding.logos.light
  return {
    accentColor: oklchToHex({ l: 0.52, c: Math.min(brand.c, 0.16), h: brand.h }),
    logoUrl: [noPapel.wide, noPapel.mark].find(isAbsoluteHttpLogo) ?? null,
  }
}

/** Logo que o servidor consegue buscar: URL absoluta em http(s). */
function isAbsoluteHttpLogo(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    return /^https?:$/i.test(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * Prévia sem gravar — a tela de admin mexe num seletor de cor e precisa mostrar
 * a paleta e os avisos de contraste antes de salvar. Puro, sem tocar no banco.
 */
export function previewBranding(input: {
  brandColor: string
  neutralColor: string | null
  overrides?: BrandOverrides
}): {
  schemes: Record<BrandScheme, BrandPalette>
  contrastIssues: Record<BrandScheme, BrandContrastIssue[]>
} {
  const schemes = resolveBrandSchemes(input)
  return {
    schemes,
    contrastIssues: {
      light: checkBrandContrast(schemes.light),
      dark: checkBrandContrast(schemes.dark),
    },
  }
}
