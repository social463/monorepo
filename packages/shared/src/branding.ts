/**
 * Contrato da **marca por empresa** — o Legends é white label: nome, logo e
 * paleta são do tenant, não do deploy.
 *
 * A empresa cadastra **uma** cor de marca (e, opcionalmente, um tom neutro e o
 * esquema claro/escuro). Os 35 tokens Material 3 que o Tailwind consome saem
 * daqui por derivação. Pedir 35 hex a um admin produziria paleta quebrada; pior,
 * produziria paleta ilegível — ver `primary` abaixo.
 *
 * Quem resolve a paleta é a **API**, não o front: o card do Destaque do Mês, o
 * certificado em PDF e a tela precisam enxergar exatamente as mesmas cores, e
 * duas derivações independentes divergem no primeiro arredondamento.
 */

import { contrastRatio, hexToOklch, isValidHex, oklchToHex, type Oklch } from './color'

/**
 * Os 35 tokens da paleta, em nomenclatura Material 3 — a mesma lista que o
 * `apps/web/tailwind.config.ts` expõe como classe utilitária. Mexer aqui exige
 * mexer lá; o teste `brand-tokens.test.ts` do web trava os dois juntos.
 */
export const BRAND_COLOR_TOKENS = [
  'surface',
  'surface-dim',
  'surface-bright',
  'surface-container-lowest',
  'surface-container-low',
  'surface-container',
  'surface-container-high',
  'surface-container-highest',
  'surface-variant',
  'on-surface',
  'on-surface-variant',
  'inverse-surface',
  'inverse-on-surface',
  'outline',
  'outline-variant',
  'surface-tint',
  'primary',
  'on-primary',
  'primary-container',
  'on-primary-container',
  'inverse-primary',
  'secondary',
  'on-secondary',
  'secondary-container',
  'on-secondary-container',
  'tertiary',
  'on-tertiary',
  'tertiary-container',
  'on-tertiary-container',
  'error',
  'on-error',
  'error-container',
  'on-error-container',
  'background',
  'on-background',
] as const

export type BrandColorToken = (typeof BRAND_COLOR_TOKENS)[number]
export type BrandPalette = Record<BrandColorToken, string>

export type BrandScheme = 'light' | 'dark'

export const BRAND_SCHEMES = ['light', 'dark'] as const satisfies readonly BrandScheme[]

/** Prefixo das CSS variables injetadas no `:root` (`--brand-primary`, …). */
export const BRAND_CSS_VAR_PREFIX = '--brand-'

export const brandCssVar = (token: BrandColorToken) => `${BRAND_CSS_VAR_PREFIX}${token}`

/**
 * Normaliza um domínio para comparação: sem protocolo, sem porta, sem caminho,
 * sem ponto final, em minúsculas. O que chega do `Host` e o que o admin digita
 * precisam virar a mesma string — senão `HTTPS://Legends.EMR.com.br/` nunca
 * casa com `legends.emr.com.br`.
 */
export function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split('/')[0]!
    .split(':')[0]!
    .replace(/\.+$/, '')
}

/** Domínio plausível: pelo menos dois rótulos, sem espaços nem caracteres estranhos. */
export function isValidHost(value: string): boolean {
  const host = normalizeHost(value)
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)
}

// ---------------------------------------------------------------------------
// Derivação
// ---------------------------------------------------------------------------

interface ToneSpec {
  /** De onde saem matiz e croma base. */
  from: 'brand' | 'neutral' | 'error'
  /** Claridade perceptual alvo (OKLCH L). */
  l: number
  /** Multiplicador do croma base. 0 = cinza puro. */
  c: number
  /** Deslocamento de matiz em graus — usado só pela família terciária. */
  shift?: number
}

/**
 * `primary` **não** recebe a cor institucional crua, e isso é deliberado.
 *
 * O verde da EMR (`#35bd78`) rende 2.31:1 como texto sobre o fundo claro dela e
 * 2.41:1 com branco por cima: reprova WCAG AA nos dois papéis. Como
 * `text-primary` aparece ~1080 vezes no front, aplicar a cor crua deixaria boa
 * parte da interface ilegível — o problema existe hoje no portal de origem.
 *
 * Então `primary` é o tom **legível** do mesmo matiz (L≈.52 no claro, L≈.82 no
 * escuro) e a cor institucional exata fica em `surface-tint`, onde serve a
 * preenchimento grande, selo e gradiente e nada pequeno é escrito por cima. Aos
 * olhos continua sendo a marca; o que muda é onde cada tom é aplicado.
 */
const LIGHT_TONES: Record<BrandColorToken, ToneSpec> = {
  primary: { from: 'brand', l: 0.52, c: 1 },
  'on-primary': { from: 'brand', l: 0.99, c: 0.04 },
  'primary-container': { from: 'brand', l: 0.9, c: 0.35 },
  'on-primary-container': { from: 'brand', l: 0.33, c: 0.85 },
  'inverse-primary': { from: 'brand', l: 0.8, c: 0.75 },
  'surface-tint': { from: 'brand', l: 0.62, c: 1 },

  secondary: { from: 'brand', l: 0.5, c: 0.3 },
  'on-secondary': { from: 'brand', l: 0.99, c: 0.03 },
  'secondary-container': { from: 'brand', l: 0.9, c: 0.16 },
  'on-secondary-container': { from: 'brand', l: 0.32, c: 0.28 },

  tertiary: { from: 'brand', l: 0.55, c: 0.55, shift: 60 },
  'on-tertiary': { from: 'brand', l: 0.99, c: 0.04, shift: 60 },
  'tertiary-container': { from: 'brand', l: 0.9, c: 0.3, shift: 60 },
  'on-tertiary-container': { from: 'brand', l: 0.34, c: 0.5, shift: 60 },

  error: { from: 'error', l: 0.53, c: 1 },
  'on-error': { from: 'error', l: 0.99, c: 0.05 },
  'error-container': { from: 'error', l: 0.92, c: 0.28 },
  'on-error-container': { from: 'error', l: 0.36, c: 0.8 },

  surface: { from: 'neutral', l: 0.985, c: 1 },
  background: { from: 'neutral', l: 0.985, c: 1 },
  'surface-dim': { from: 'neutral', l: 0.93, c: 1 },
  'surface-bright': { from: 'neutral', l: 1, c: 0.5 },
  'surface-container-lowest': { from: 'neutral', l: 1, c: 0.3 },
  'surface-container-low': { from: 'neutral', l: 0.975, c: 1 },
  'surface-container': { from: 'neutral', l: 0.96, c: 1 },
  'surface-container-high': { from: 'neutral', l: 0.94, c: 1.2 },
  'surface-container-highest': { from: 'neutral', l: 0.92, c: 1.4 },
  'surface-variant': { from: 'neutral', l: 0.93, c: 2 },
  'on-surface': { from: 'neutral', l: 0.22, c: 2 },
  'on-background': { from: 'neutral', l: 0.22, c: 2 },
  'on-surface-variant': { from: 'neutral', l: 0.45, c: 2 },
  outline: { from: 'neutral', l: 0.58, c: 1.5 },
  'outline-variant': { from: 'neutral', l: 0.87, c: 1.5 },
  'inverse-surface': { from: 'neutral', l: 0.27, c: 1.5 },
  'inverse-on-surface': { from: 'neutral', l: 0.96, c: 1 },
}

const DARK_TONES: Record<BrandColorToken, ToneSpec> = {
  primary: { from: 'brand', l: 0.82, c: 1 },
  'on-primary': { from: 'brand', l: 0.28, c: 0.9 },
  'primary-container': { from: 'brand', l: 0.8, c: 1 },
  'on-primary-container': { from: 'brand', l: 0.33, c: 0.95 },
  'inverse-primary': { from: 'brand', l: 0.45, c: 0.9 },
  'surface-tint': { from: 'brand', l: 0.76, c: 1 },

  secondary: { from: 'brand', l: 0.8, c: 0.25 },
  'on-secondary': { from: 'brand', l: 0.26, c: 0.35 },
  'secondary-container': { from: 'brand', l: 0.33, c: 0.35 },
  'on-secondary-container': { from: 'brand', l: 0.8, c: 0.25 },

  tertiary: { from: 'brand', l: 0.87, c: 0.35, shift: 60 },
  'on-tertiary': { from: 'brand', l: 0.28, c: 0.8, shift: 60 },
  'tertiary-container': { from: 'brand', l: 0.82, c: 0.8, shift: 60 },
  'on-tertiary-container': { from: 'brand', l: 0.35, c: 0.9, shift: 60 },

  error: { from: 'error', l: 0.78, c: 0.55 },
  'on-error': { from: 'error', l: 0.25, c: 0.85 },
  'error-container': { from: 'error', l: 0.36, c: 1 },
  'on-error-container': { from: 'error', l: 0.9, c: 0.25 },

  surface: { from: 'neutral', l: 0.16, c: 1 },
  background: { from: 'neutral', l: 0.16, c: 1 },
  'surface-dim': { from: 'neutral', l: 0.16, c: 1 },
  'surface-bright': { from: 'neutral', l: 0.35, c: 1 },
  'surface-container-lowest': { from: 'neutral', l: 0.12, c: 1 },
  'surface-container-low': { from: 'neutral', l: 0.19, c: 1 },
  'surface-container': { from: 'neutral', l: 0.21, c: 1 },
  'surface-container-high': { from: 'neutral', l: 0.26, c: 1 },
  'surface-container-highest': { from: 'neutral', l: 0.31, c: 1 },
  'surface-variant': { from: 'neutral', l: 0.31, c: 1 },
  'on-surface': { from: 'neutral', l: 0.9, c: 1 },
  'on-background': { from: 'neutral', l: 0.9, c: 1 },
  'on-surface-variant': { from: 'neutral', l: 0.79, c: 1.5 },
  outline: { from: 'neutral', l: 0.62, c: 1.5 },
  'outline-variant': { from: 'neutral', l: 0.35, c: 1.5 },
  'inverse-surface': { from: 'neutral', l: 0.9, c: 1 },
  'inverse-on-surface': { from: 'neutral', l: 0.27, c: 1 },
}

/** Croma base das superfícies: alto o bastante para a marca tingir o cinza, baixo o bastante para não virar cor. */
const NEUTRAL_CHROMA: Record<BrandScheme, number> = { light: 0.012, dark: 0.014 }
/** Vermelho de erro é convenção universal — não segue a marca, senão "excluir" fica verde. */
const ERROR_HUE = 27
const ERROR_CHROMA = 0.19
/** Teto de croma da marca: acima disso o tom claro estoura o gamut e a rampa fica irregular. */
const MAX_BRAND_CHROMA = 0.17

export interface BrandPaletteInput {
  /** Cor institucional, em hex. */
  brandColor: string
  /** Matiz das superfícies. Sem isto, as superfícies são tingidas pela própria marca. */
  neutralColor?: string | null
  scheme: BrandScheme
}

export function deriveBrandPalette(input: BrandPaletteInput): BrandPalette {
  const brand = hexToOklch(input.brandColor)
  const brandChroma = Math.min(brand.c, MAX_BRAND_CHROMA)
  const neutralHue = input.neutralColor ? hexToOklch(input.neutralColor).h : brand.h
  const neutralChroma = NEUTRAL_CHROMA[input.scheme]
  const tones = input.scheme === 'light' ? LIGHT_TONES : DARK_TONES

  const palette = {} as BrandPalette
  for (const token of BRAND_COLOR_TOKENS) {
    const spec = tones[token]
    const base: Oklch =
      spec.from === 'brand'
        ? { l: spec.l, c: brandChroma * spec.c, h: brand.h + (spec.shift ?? 0) }
        : spec.from === 'neutral'
          ? { l: spec.l, c: neutralChroma * spec.c, h: neutralHue }
          : { l: spec.l, c: ERROR_CHROMA * spec.c, h: ERROR_HUE }
    palette[token] = oklchToHex({ ...base, h: ((base.h % 360) + 360) % 360 })
  }
  return palette
}

// ---------------------------------------------------------------------------
// Contraste
// ---------------------------------------------------------------------------

/**
 * Pares que precisam passar. Não é a paleta inteira: só as combinações que o
 * front realmente pinta uma sobre a outra. `outline` entra a 3:1 porque é borda
 * (componente de UI), não texto.
 */
export const BRAND_CONTRAST_PAIRS: ReadonlyArray<{
  foreground: BrandColorToken
  background: BrandColorToken
  min: number
  label: string
}> = [
  { foreground: 'on-surface', background: 'surface', min: 4.5, label: 'texto sobre o fundo' },
  { foreground: 'on-background', background: 'background', min: 4.5, label: 'texto sobre o plano de fundo' },
  { foreground: 'on-surface-variant', background: 'surface', min: 4.5, label: 'texto secundário sobre o fundo' },
  {
    foreground: 'on-surface',
    background: 'surface-container-highest',
    min: 4.5,
    label: 'texto sobre o card mais claro',
  },
  { foreground: 'primary', background: 'surface', min: 4.5, label: 'cor da marca como texto' },
  { foreground: 'on-primary', background: 'primary', min: 4.5, label: 'rótulo sobre o botão principal' },
  {
    foreground: 'on-primary-container',
    background: 'primary-container',
    min: 4.5,
    label: 'texto sobre o realce da marca',
  },
  {
    foreground: 'on-secondary-container',
    background: 'secondary-container',
    min: 4.5,
    label: 'texto sobre o realce secundário',
  },
  {
    foreground: 'on-tertiary-container',
    background: 'tertiary-container',
    min: 4.5,
    label: 'texto sobre o realce terciário',
  },
  { foreground: 'on-error', background: 'error', min: 4.5, label: 'rótulo sobre o botão de erro' },
  { foreground: 'on-error-container', background: 'error-container', min: 4.5, label: 'texto sobre o alerta de erro' },
  { foreground: 'outline', background: 'surface', min: 3, label: 'borda sobre o fundo' },
  { foreground: 'inverse-on-surface', background: 'inverse-surface', min: 4.5, label: 'texto sobre a superfície invertida' },
]

export interface BrandContrastIssue {
  foreground: BrandColorToken
  background: BrandColorToken
  label: string
  ratio: number
  min: number
}

/** Devolve os pares reprovados. Vazio = paleta legível. */
export function checkBrandContrast(palette: BrandPalette): BrandContrastIssue[] {
  const issues: BrandContrastIssue[] = []
  for (const pair of BRAND_CONTRAST_PAIRS) {
    const ratio = contrastRatio(palette[pair.foreground], palette[pair.background])
    if (ratio + 1e-9 < pair.min) {
      issues.push({
        foreground: pair.foreground,
        background: pair.background,
        label: pair.label,
        ratio: Math.round(ratio * 100) / 100,
        min: pair.min,
      })
    }
  }
  return issues
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Ajustes finos por cima da derivação, **um conjunto por esquema**.
 *
 * Não dá para ter um só: os design systems que trazem claro e escuro não
 * aplicam o mesmo hex nos dois — o fundo do EMR é branco no claro e `#363e46`
 * no escuro, e o verde de texto muda de degrau para continuar legível. Um
 * `overrides` único obrigaria a escolher um dos modos e derivar o outro.
 */
export type BrandOverrides = Partial<Record<BrandScheme, Partial<BrandPalette>>>

/**
 * Logos de um esquema. `wide` é a horizontal (login, sidebar aberta) e `mark` o
 * símbolo quadrado (rail recolhido, favicon, app instalado).
 */
export interface BrandLogos {
  wide: string | null
  mark: string | null
}

/**
 * Logos **por esquema**. Marca séria entrega duas versões da mesma arte — uma
 * em tinta colorida para fundo claro, outra em branco para fundo escuro — e
 * usar a errada some com a logo. Empresa que só tem uma cadastra a mesma nos
 * dois lados.
 */
export type BrandLogoSet = Record<BrandScheme, BrandLogos>

export const EMPTY_LOGOS: BrandLogoSet = {
  light: { wide: null, mark: null },
  dark: { wide: null, mark: null },
}

export interface BrandingPreset {
  appName: string
  tagline: string | null
  /**
   * Domínios que pertencem a esta empresa (`legends.eumedicoresidente.com.br`).
   *
   * É o que permite um cliente ter a marca dele no **próprio domínio**, sem
   * depender de subdomínio, DNS wildcard ou certificado curinga. O subdomínio
   * (`emr.<host do app>`) continua funcionando como segundo caminho, para
   * clientes que não trazem domínio próprio.
   */
  hosts: string[]
  logos: BrandLogoSet
  /** Esquema que a pessoa vê antes de escolher qualquer coisa. */
  defaultScheme: BrandScheme
  /**
   * Se cada pessoa pode alternar claro/escuro. Empresa que só mantém um dos
   * modos revisado deixa `false` e ninguém vê o outro pela metade.
   */
  allowUserScheme: boolean
  brandColor: string
  neutralColor: string | null
  overrides: BrandOverrides
}

/**
 * Paleta "Technical Precision" — exatamente os 35 hex que estavam cravados no
 * `tailwind.config.ts` antes deste trabalho.
 *
 * Vai como `overrides` (não como derivação) de propósito: é a aparência que o
 * produto tem hoje em produção, e um ajuste na fórmula de derivação não pode
 * repintar a interface de ninguém sem alguém ter pedido.
 */
export const LEGENDS_PALETTE: BrandPalette = {
  surface: '#0c141b',
  'surface-dim': '#0c141b',
  'surface-bright': '#323a42',
  'surface-container-lowest': '#070f16',
  'surface-container-low': '#141c24',
  'surface-container': '#182028',
  'surface-container-high': '#232b32',
  'surface-container-highest': '#2e363d',
  'surface-variant': '#2e363d',
  'on-surface': '#dbe3ed',
  'on-surface-variant': '#bacbbc',
  'inverse-surface': '#dbe3ed',
  'inverse-on-surface': '#293139',
  outline: '#859587',
  'outline-variant': '#3c4a3f',
  'surface-tint': '#2ce28b',
  primary: '#52fba2',
  'on-primary': '#00391e',
  'primary-container': '#25de88',
  'on-primary-container': '#005d34',
  'inverse-primary': '#006d3f',
  secondary: '#abcec1',
  'on-secondary': '#16362d',
  'secondary-container': '#2d4d43',
  'on-secondary-container': '#9abcb0',
  tertiary: '#ffd8b8',
  'on-tertiary': '#4b2700',
  'tertiary-container': '#ffb36d',
  'on-tertiary-container': '#794303',
  error: '#ffb4ab',
  'on-error': '#690005',
  'error-container': '#93000a',
  'on-error-container': '#ffdad6',
  background: '#0c141b',
  'on-background': '#dbe3ed',
}

/**
 * Marca do produto — o que uma empresa sem nada cadastrado enxerga, e o
 * fallback do `GET /branding` quando o subdomínio não resolve nenhum tenant.
 */
export const LEGENDS_PRESET: BrandingPreset = {
  appName: 'Legends',
  tagline: 'Onde as lendas nascem',
  // O produto não reivindica domínio nenhum: ele é o que sobra quando nenhuma
  // empresa casa com o `Host`.
  hosts: [],
  // Vazio, e não o caminho da arte: logo é o que a **empresa** cadastrou, e a
  // arte do produto é o fallback de cada componente. Cravar o caminho aqui
  // atropelaria os fallbacks por local — o login usa a versão sem margem, a
  // sidebar usa a com margem, e as duas são a mesma marca.
  logos: EMPTY_LOGOS,
  defaultScheme: 'dark',
  // O produto só tem o escuro desenhado. Um claro derivado passa em contraste,
  // mas ninguém revisou — então não é oferecido.
  allowUserScheme: false,
  brandColor: '#52fba2',
  neutralColor: '#0c141b',
  overrides: { dark: LEGENDS_PALETTE },
}

/**
 * EMR — valores do **"Eu Médico — Design System"**, camada de tokens semânticos
 * (`bgColor`, `textColor`, `borderColor`, `buttonColor`, `statusColor`), nos
 * dois modos. Quando o cliente tem design system, ele é a fonte; a derivação
 * fica só de rede de segurança para o que o DS não cobre.
 *
 * O DS traz três famílias de marca sobre um neutro comum: verde (a do Legends),
 * teal e azul — as duas últimas viram `secondary` e `tertiary`.
 *
 * **Onde este mapeamento se afasta do DS, e por quê.** O design system designa
 * `#35bd78` (Brand/400) para o botão principal (`buttonColor/000`) e para link
 * e texto de marca (`textColor/600`). Medido contra o fundo branco que ele
 * mesmo define, isso dá **2.41:1** nos dois papéis — abaixo do mínimo de 4.5:1.
 * Aqui `primary` usa **Brand/600 `#007344`** (5.94:1), que no DS é o estado
 * "pressionado"; mesma decisão para `error`, que vai de `#e64444` (3.98:1) para
 * `#b23535` (6.08:1). A cor institucional exata não sai da tela: fica em
 * `surface-tint` e nos containers, onde é preenchimento e não texto.
 *
 * `outline` é Neutral/500 e não o Neutral/400 da posição equivalente na escala:
 * o 400 (`#9ba5ab`) dá 2.40:1, abaixo até do mínimo de 3:1 que vale para borda.
 * O `borderColor/000` do DS (`#e1e8ed`, "principal padrão de borda") entra como
 * `outline-variant`, que é o token decorativo.
 */
export const EMR_PRESET: BrandingPreset = {
  appName: 'EMR Legends',
  tagline: 'Onde as lendas nascem',
  // O domínio de produção da EMR. Como ele casa direto, a EMR não precisa de
  // subdomínio nem de wildcard de DNS.
  hosts: ['legends.eumedicoresidente.com.br'],
  /*
   * Vazio de propósito. A EMR tem arte própria — logotipo e símbolo, em tinta
   * verde para fundo claro e branca para fundo escuro — mas ela **não** vive no
   * repositório: entra por **Administração › Marca**, que guarda no S3.
   *
   * Versionar a arte de um cliente dentro do bundle é o oposto do que white
   * label deveria ser: o próximo cliente herdaria o peso do arquivo, e o
   * caminho `/brand/emr/...` viraria um caso especial no código do produto.
   * Enquanto nada estiver cadastrado, o `BrandLogo` escreve o nome da empresa,
   * que é legível nos dois temas.
   */
  logos: EMPTY_LOGOS,
  defaultScheme: 'light',
  allowUserScheme: true,
  brandColor: '#35bd78',
  neutralColor: '#f7fafc',
  overrides: {
    light: {
      // Superfícies = escada de `bgColor`. O 000 é White e leva a nota
      // "Uso padrão do background" no próprio Figma.
      surface: '#ffffff',
      background: '#ffffff',
      'surface-container-lowest': '#ffffff',
      'surface-container-low': '#f7fafc',
      'surface-container': '#edf0f2',
      'surface-container-high': '#e1e8ed',
      'surface-container-highest': '#c2ced6',
      'surface-bright': '#ffffff',
      'surface-dim': '#edf0f2',
      'surface-variant': '#f7fafc',
      // textColor/100 "textos de maior ênfase" e /200 "padrão de parágrafos".
      'on-surface': '#363e46',
      'on-background': '#363e46',
      'on-surface-variant': '#606a71',
      outline: '#606a71',
      'outline-variant': '#e1e8ed',
      'inverse-surface': '#1d2224',
      'inverse-on-surface': '#f7fafc',

      'surface-tint': '#35bd78',
      primary: '#007344',
      'on-primary': '#ffffff',
      'primary-container': '#d3fce9',
      'on-primary-container': '#004d2d',
      'inverse-primary': '#25de88',

      secondary: '#087d75',
      'on-secondary': '#ffffff',
      'secondary-container': '#b1e7e1',
      'on-secondary-container': '#05524c',

      tertiary: '#23509b',
      'on-tertiary': '#ffffff',
      'tertiary-container': '#a7caff',
      'on-tertiary-container': '#1a2430',

      error: '#b23535',
      'on-error': '#ffffff',
      'error-container': '#ffe9e9',
      'on-error-container': '#b23535',
    },
    dark: {
      /*
       * A escada escura é ancorada no **Neutral/800** (`#1d2224`), e não no
       * `bgColor/000` do DS (Neutral/700, `#363e46`). Não é descuido.
       *
       * O Legends eleva card **clareando** a superfície, então a página precisa
       * ser o degrau mais escuro. Ancorando em Neutral/700, os cards eram
       * empurrados para Neutral/600 e /500 — que no DS são cores de borda e de
       * texto, não de superfície. O resultado media 1.48:1 entre a sidebar e o
       * fundo (contra 1.04:1 no tema do produto): a sidebar virava uma lasca
       * preta e os cards, cinza lavado.
       *
       * Os dois degraus do meio não existem no DS: a escala tem 4 tons na faixa
       * escura e a escada precisa de 6. São interpolados em OKLCH entre
       * Neutral/800 e /700, então caem exatamente sobre a linha que o DS já
       * desenha. Espaçamento final L 0.19 → 0.41, contra 0.16 → 0.33 do produto.
       */
      'surface-container-lowest': '#121719',
      surface: '#1d2224',
      background: '#1d2224',
      'surface-dim': '#1d2224',
      'surface-container-low': '#252b2f',
      'surface-container': '#2d343a',
      'surface-container-high': '#363e46',
      'surface-container-highest': '#414b52',
      'surface-bright': '#414b52',
      'surface-variant': '#2d343a',
      'on-surface': '#ffffff',
      'on-background': '#ffffff',
      'on-surface-variant': '#c2ced6',
      // Neutral/400: 6.4:1 sobre a superfície. O /500 daria 2.9:1 e reprovaria
      // o mínimo de 3:1 de borda, então ele fica no token decorativo.
      outline: '#9ba5ab',
      'outline-variant': '#606a71',
      'inverse-surface': '#f7fafc',
      'inverse-on-surface': '#1d2224',

      'surface-tint': '#35bd78',
      // No escuro o degrau legível é o Brand/300 (6.14:1 sobre #363e46);
      // o Brand/400 fica em 4.50:1, na linha exata do mínimo.
      primary: '#25de88',
      'on-primary': '#1d2224',
      'primary-container': '#3d5d53',
      'on-primary-container': '#d3fce9',
      'inverse-primary': '#007344',

      secondary: '#3ec4b5',
      'on-secondary': '#1d2224',
      'secondary-container': '#05524c',
      'on-secondary-container': '#b1e7e1',

      tertiary: '#5899ff',
      'on-tertiary': '#1d2224',
      'tertiary-container': '#224b87',
      'on-tertiary-container': '#b9d4ff',

      error: '#ffb2b2',
      'on-error': '#1d2224',
      'error-container': '#653938',
      'on-error-container': '#ffb2b2',
    },
  },
}

export const BRAND_PRESETS = {
  legends: LEGENDS_PRESET,
  emr: EMR_PRESET,
} as const

export type BrandPresetKey = keyof typeof BRAND_PRESETS

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface BrandingDTO {
  appName: string
  tagline: string | null
  /** Domínios da empresa — o `GET /branding` público casa o `Host` com esta lista. */
  hosts: string[]
  logos: BrandLogoSet
  /** Esquema que vale antes de a pessoa escolher. */
  defaultScheme: BrandScheme
  /** Se a pessoa pode alternar claro/escuro. */
  allowUserScheme: boolean
  /** Cor institucional como cadastrada — a tela de admin mostra esta, não a derivada. */
  brandColor: string
  neutralColor: string | null
  /**
   * As duas paletas resolvidas. Vão juntas de propósito: com `allowUserScheme`,
   * alternar o tema não pode custar uma ida à API — seria um flash de tela
   * inteira a cada clique no botão.
   */
  schemes: Record<BrandScheme, BrandPalette>
  /**
   * Paleta do `defaultScheme`, repetida por conveniência. É o que os renderers
   * de servidor (card do Destaque, Teams) consomem — lá não existe "usuário
   * alternando tema", existe uma imagem só.
   */
  colors: BrandPalette
}

export interface UpdateBrandingRequest {
  appName: string
  tagline: string | null
  hosts: string[]
  logos: BrandLogoSet
  defaultScheme: BrandScheme
  allowUserScheme: boolean
  brandColor: string
  neutralColor: string | null
  overrides?: BrandOverrides
}

export function resolveBrandPalette(input: {
  brandColor: string
  neutralColor: string | null
  scheme: BrandScheme
  overrides?: Partial<BrandPalette>
}): BrandPalette {
  const derived = deriveBrandPalette(input)
  if (!input.overrides) return derived
  const merged = { ...derived }
  for (const token of BRAND_COLOR_TOKENS) {
    const override = input.overrides[token]
    if (override && isValidHex(override)) merged[token] = override
  }
  return merged
}

/** Resolve as duas paletas de uma vez. */
export function resolveBrandSchemes(input: {
  brandColor: string
  neutralColor: string | null
  overrides?: BrandOverrides
}): Record<BrandScheme, BrandPalette> {
  return {
    light: resolveBrandPalette({ ...input, scheme: 'light', overrides: input.overrides?.light }),
    dark: resolveBrandPalette({ ...input, scheme: 'dark', overrides: input.overrides?.dark }),
  }
}

/** O que saiu da leitura de um JSON de tokens colado pelo operador. */
export interface ParsedBrandOverrides {
  overrides: BrandOverrides
  /** Quantos tokens entraram, por esquema. */
  applied: Record<BrandScheme, number>
  /** Chaves que não são token conhecido — provável erro de digitação ou de fonte. */
  unknownTokens: string[]
  /** Tokens com valor que não é hex. */
  invalidColors: string[]
}

export class BrandOverridesParseError extends Error {}

/**
 * Lê um JSON de tokens de design system e devolve os `overrides`.
 *
 * A tela pede **uma** cor e deriva o resto, que é o caso do cliente sem design
 * system — a maioria. Quem tem DS próprio precisa dos valores exatos, e não
 * existe formulário razoável para 70 campos de cor. Colar o JSON é o caminho.
 *
 * Aceita as duas formas que aparecem na prática: o objeto de overrides puro
 * (`{ light: {...}, dark: {...} }`) ou um payload de marca inteiro, do qual se
 * aproveita só a chave `overrides`.
 *
 * Chave desconhecida e cor inválida são **relatadas**, não descartadas em
 * silêncio: quem colou precisa saber que dois tokens não entraram, senão
 * descobre pela tela torta três telas depois.
 */
export function parseBrandOverrides(raw: string): ParsedBrandOverrides {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new BrandOverridesParseError('Isso não é um JSON válido.')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new BrandOverridesParseError('O JSON precisa ser um objeto.')
  }

  const root = data as Record<string, unknown>
  const fonte = (root.overrides ?? root) as Record<string, unknown>
  if (!fonte || typeof fonte !== 'object' || Array.isArray(fonte)) {
    throw new BrandOverridesParseError('O JSON precisa ser um objeto.')
  }

  const conhecidos = new Set<string>(BRAND_COLOR_TOKENS)
  const overrides: BrandOverrides = {}
  const applied: Record<BrandScheme, number> = { light: 0, dark: 0 }
  const unknownTokens: string[] = []
  const invalidColors: string[] = []

  for (const scheme of BRAND_SCHEMES) {
    const bloco = fonte[scheme]
    if (bloco === undefined) continue
    if (!bloco || typeof bloco !== 'object' || Array.isArray(bloco)) {
      throw new BrandOverridesParseError(`A chave "${scheme}" precisa ser um objeto de tokens.`)
    }
    const doEsquema: Partial<BrandPalette> = {}
    for (const [token, valor] of Object.entries(bloco as Record<string, unknown>)) {
      if (!conhecidos.has(token)) {
        unknownTokens.push(`${scheme}.${token}`)
        continue
      }
      if (typeof valor !== 'string' || !isValidHex(valor)) {
        invalidColors.push(`${scheme}.${token}`)
        continue
      }
      doEsquema[token as BrandColorToken] = normalizeHex(valor)
      applied[scheme] += 1
    }
    if (Object.keys(doEsquema).length > 0) overrides[scheme] = doEsquema
  }

  if (applied.light === 0 && applied.dark === 0) {
    throw new BrandOverridesParseError(
      'Nenhum token reconhecido. O JSON deve ter as chaves "light" e/ou "dark" com os tokens dentro.',
    )
  }
  return { overrides, applied, unknownTokens, invalidColors }
}

/** Hex normalizado: minúsculo, com `#`, expandindo a forma de 3 dígitos. */
export function normalizeHex(value: string): string {
  const v = value.trim().replace(/^#/, '').toLowerCase()
  const full = v.length === 3 ? v.split('').map((ch) => ch + ch).join('') : v
  return `#${full}`
}

export function brandingFromPreset(preset: BrandingPreset): BrandingDTO {
  const schemes = resolveBrandSchemes(preset)
  return {
    appName: preset.appName,
    tagline: preset.tagline,
    hosts: preset.hosts,
    logos: preset.logos,
    defaultScheme: preset.defaultScheme,
    allowUserScheme: preset.allowUserScheme,
    brandColor: preset.brandColor,
    neutralColor: preset.neutralColor,
    schemes,
    colors: schemes[preset.defaultScheme],
  }
}
