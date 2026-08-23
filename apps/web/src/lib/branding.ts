import {
  brandCssVar,
  toRgbChannels,
  type BrandColorToken,
  type BrandScheme,
  type BrandingDTO,
} from '@legends/shared'

/**
 * Aplicação da marca da empresa no documento. Tudo que é "cara do produto" —
 * paleta, título, favicon, manifest, esquema claro/escuro — passa por aqui.
 *
 * O Tailwind foi convertido para ler `rgb(var(--brand-<token>) / <alpha>)` com
 * a paleta do produto como fallback, então injetar as variáveis no `:root`
 * repinta as ~4600 classes semânticas do app de uma vez, sem que nenhum
 * componente saiba que existe white label.
 */

const CACHE_KEY = 'legends:branding'
const SCHEME_KEY = 'legends:scheme'

/**
 * Esquema escolhido pela pessoa, por navegador.
 *
 * Fica em `localStorage` e não no `User` de propósito: alternar tema precisa ser
 * instantâneo e valer já na tela de login, onde ainda não há sessão. Persistir
 * no servidor exigiria migration, uma rota e um round-trip a cada clique — e
 * ainda assim a primeira pintura viria do cache local. O custo é que a escolha
 * não viaja entre dispositivos.
 */
export function readUserScheme(): BrandScheme | null {
  try {
    const value = window.localStorage.getItem(SCHEME_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export function writeUserScheme(scheme: BrandScheme | null): void {
  try {
    if (scheme) window.localStorage.setItem(SCHEME_KEY, scheme)
    else window.localStorage.removeItem(SCHEME_KEY)
  } catch {
    // Modo anônimo: a escolha vale só nesta aba.
  }
}

/** O esquema que vale agora: escolha da pessoa, se a empresa permitir; senão o padrão dela. */
export function effectiveScheme(branding: BrandingDTO): BrandScheme {
  if (!branding.allowUserScheme) return branding.defaultScheme
  return readUserScheme() ?? branding.defaultScheme
}

/** Em dev não há wildcard de DNS: `?empresa=emr` faz o papel do subdomínio. */
function slugOverride(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('empresa')
}

export function brandingEndpoint(): string {
  const slug = slugOverride()
  return slug ? `/api/branding?slug=${encodeURIComponent(slug)}` : '/api/branding'
}

function manifestEndpoint(): string {
  const slug = slugOverride()
  return slug
    ? `/api/branding/manifest.webmanifest?slug=${encodeURIComponent(slug)}`
    : '/api/branding/manifest.webmanifest'
}

function upsertLink(rel: string, href: string, extra?: Record<string, string>): void {
  const selector = extra?.sizes ? `link[rel="${rel}"][sizes="${extra.sizes}"]` : `link[rel="${rel}"]`
  let link = document.head.querySelector<HTMLLinkElement>(selector)
  if (!link) {
    link = document.createElement('link')
    link.rel = rel
    if (extra) for (const [key, value] of Object.entries(extra)) link.setAttribute(key, value)
    document.head.appendChild(link)
  }
  link.href = href
}

function upsertMeta(name: string, content: string): void {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = name
    document.head.appendChild(meta)
  }
  meta.content = content
}

export function applyBranding(branding: BrandingDTO, scheme?: BrandScheme): void {
  const root = document.documentElement
  const active = scheme ?? effectiveScheme(branding)
  const colors = branding.schemes[active]

  for (const [token, hex] of Object.entries(colors)) {
    // Canais RGB, e não hex: é o que permite `bg-primary/30` continuar funcionando.
    root.style.setProperty(brandCssVar(token as BrandColorToken), toRgbChannels(hex))
  }

  /**
   * O app nasceu dark-only (`<html class="dark">`, `color-scheme: dark` no
   * `index.css`). O estilo inline vence a folha, então basta escrever aqui — não
   * há segunda folha de estilo para tema claro, porque só 6 lugares no repo
   * usam a variante `dark:` e a paleta inteira já vem por variável.
   */
  const dark = active === 'dark'
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'

  document.title = branding.appName
  upsertMeta('theme-color', colors.surface)

  // Favicon segue o esquema: aba clara com símbolo branco fica em branco.
  const mark = branding.logos[active].mark ?? branding.logos[active === 'dark' ? 'light' : 'dark'].mark
  if (mark) {
    upsertLink('icon', mark, { sizes: '32x32' })
    upsertLink('icon', mark, { sizes: '16x16' })
    upsertLink('apple-touch-icon', mark, { sizes: '180x180' })
  }
  upsertLink('manifest', manifestEndpoint())
}

/**
 * A marca da última visita, aplicada **antes** do primeiro render.
 *
 * Sem isto, um tenant de tema claro veria o app pintado no escuro do produto
 * até a resposta do `GET /branding` chegar — um flash de tela inteira em toda
 * carga. A chave inclui o host porque o subdomínio é justamente o que decide de
 * quem é a marca.
 */
export function readCachedBranding(): BrandingDTO | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { host: string; branding: BrandingDTO }
    if (parsed.host !== window.location.host) return null
    if (!parsed.branding?.schemes?.light || !parsed.branding.appName) return null
    return parsed.branding
  } catch {
    return null
  }
}

export function cacheBranding(branding: BrandingDTO): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ host: window.location.host, branding }))
  } catch {
    // Modo anônimo / storage cheio: o cache é otimização, não requisito.
  }
}

/** Aplica a marca em cache, se houver. Chamado antes do React montar. */
export function applyCachedBranding(): void {
  const cached = readCachedBranding()
  if (cached) applyBranding(cached)
}

export async function fetchBranding(): Promise<BrandingDTO> {
  const res = await fetch(brandingEndpoint(), { credentials: 'same-origin' })
  if (!res.ok) throw new Error('Falha ao carregar a marca')
  return (await res.json()) as BrandingDTO
}
