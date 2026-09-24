import type { CSSProperties } from 'react'
import {
  brandCssVar,
  brandFontHref,
  brandFontStack,
  type BrandColorToken,
  type BrandPalette,
  type BrandScheme,
} from '@legends/shared'
import { toRgbChannels } from '@legends/shared/color'

/**
 * Identidade visual do programa Eu Aprendiz, pelo Manual de Marca da G&G
 * (versão 2.0, 2026): verde vivo `#6CE190`, verde profundo `#264641`, verde
 * mata `#16603C`, menta `#E4F9EB` e o branco `#F8F8F8`. É a revisão que veio
 * com o pacote de arte de setembro/2026 — o verde EMR `#35BD78` e o quase
 * preto `#001D19` da versão 1.0 saíram de cena, e com eles a névoa azulada
 * `#F2FAFF`: o claro do programa agora é menta, do mesmo matiz do verde.
 *
 * É exceção deliberada ao white label, como o `SuperAdminLayout`: o programa
 * tem cara própria, e ela vale dentro da área qualquer que seja a marca da
 * empresa. O que continua sendo da PESSOA é o esquema: claro ou escuro segue a
 * escolha dela (`useBrandContext().scheme`).
 *
 * O mecanismo é o mesmo da marca: as variáveis `--brand-*` são redefinidas no
 * contêiner da área, e todo token do Tailwind lá dentro (inclusive o modal, que
 * não usa portal) herda daqui.
 *
 * O verde vivo continua NÃO servindo como texto: são 1.8:1 sobre branco, menos
 * ainda que o verde EMR de antes. Ele é preenchimento, com o verde profundo por
 * cima (6.3:1). O texto verde da área é `on-primary-container` — o mata no
 * claro (7.6:1 sobre branco), a menta no escuro.
 */
const LIGHT: BrandPalette = {
  // Superfícies: branco para a página, menta para o card, e a escada sobe em
  // menta até o broto diluído.
  surface: '#ffffff',
  background: '#ffffff',
  'surface-bright': '#ffffff',
  'surface-dim': '#e4f9eb',
  'surface-container-lowest': '#ffffff',
  'surface-container-low': '#f3fcf6',
  'surface-container': '#e4f9eb',
  'surface-container-high': '#d8f5e3',
  'surface-container-highest': '#c8f0d6',
  'surface-variant': '#e4f9eb',
  // Verde profundo é o texto; o cinza esverdeado, o secundário (5:1 no degrau
  // mais escuro da escada).
  'on-surface': '#264641',
  'on-background': '#264641',
  'on-surface-variant': '#4c665f',
  outline: '#4c665f',
  // Borda: a menta que fecha o selo do 1º encontro.
  'outline-variant': '#b9e9cb',
  'inverse-surface': '#264641',
  'inverse-on-surface': '#e4f9eb',

  'surface-tint': '#6ce190',
  primary: '#6ce190',
  'on-primary': '#264641',
  'primary-container': '#c8f0d6',
  // O verde de texto: o mata, 7.6:1 sobre branco e 6.1:1 sobre o broto.
  'on-primary-container': '#16603c',
  'inverse-primary': '#6ce190',

  secondary: '#16603c',
  'on-secondary': '#f8f8f8',
  'secondary-container': '#c8f0d6',
  'on-secondary-container': '#264641',

  tertiary: '#14618c',
  'on-tertiary': '#ffffff',
  'tertiary-container': '#d6efff',
  'on-tertiary-container': '#0a4a6b',

  error: '#c4381b',
  'on-error': '#ffffff',
  'error-container': '#fde6e0',
  'on-error-container': '#8f2712',
}

/**
 * O manual não define tema escuro de interface — só a peça em "fundo verde
 * profundo". A escada nasce do verde profundo `#264641`, o verde vivo continua
 * sendo o preenchimento, e o texto verde é a menta.
 */
const DARK: BrandPalette = {
  surface: '#10201c',
  background: '#10201c',
  'surface-bright': '#2a4f46',
  'surface-dim': '#10201c',
  'surface-container-lowest': '#0b1815',
  'surface-container-low': '#152a25',
  'surface-container': '#1b322c',
  'surface-container-high': '#22413a',
  'surface-container-highest': '#2a4f46',
  'surface-variant': '#1b322c',
  'on-surface': '#e4f9eb',
  'on-background': '#e4f9eb',
  'on-surface-variant': '#a6c5b8',
  outline: '#7e9d92',
  'outline-variant': '#2f5249',
  'inverse-surface': '#e4f9eb',
  'inverse-on-surface': '#10201c',

  'surface-tint': '#6ce190',
  primary: '#6ce190',
  'on-primary': '#264641',
  'primary-container': '#1f4a38',
  'on-primary-container': '#a9ecc0',
  'inverse-primary': '#16603c',

  secondary: '#a9ecc0',
  'on-secondary': '#264641',
  'secondary-container': '#1f4a38',
  'on-secondary-container': '#c8f0d6',

  tertiary: '#50bcff',
  'on-tertiary': '#264641',
  'tertiary-container': '#124a6b',
  'on-tertiary-container': '#c4e7ff',

  error: '#ff9e85',
  'on-error': '#264641',
  'error-container': '#6b2415',
  'on-error-container': '#ffd3c6',
}

export const APPRENTICE_PROGRAM_PALETTES: Record<BrandScheme, BrandPalette> = { light: LIGHT, dark: DARK }

/** Poppins, a família única do manual (seção 09). */
export const APPRENTICE_PROGRAM_FONTS = { headline: 'Poppins', body: 'Poppins' }

/** Folha do Google Fonts da Poppins — quem já tem a Poppins como marca não baixa de novo. */
export const APPRENTICE_PROGRAM_FONT_HREF = brandFontHref(APPRENTICE_PROGRAM_FONTS)

/**
 * Assinatura horizontal, uso preferencial do manual. A versão principal é para
 * fundo claro; no escuro entra a negativa — nunca a principal sobre fundo
 * escuro, onde o texto some.
 */
export const APPRENTICE_PROGRAM_LOGOS: Record<BrandScheme, string> = {
  light: '/eu-aprendiz/logo-horizontal.png',
  dark: '/eu-aprendiz/logo-horizontal-negativo.png',
}

/**
 * A trilha (grafismo, seção 10). O pacote de setembro/2026 trouxe a versão
 * negativa, que faltava: o escuro deixou de ficar sem trilha. Cada uma tem os
 * pontos na sua ordem de cor — a clara termina no verde profundo, que sumiria
 * no fundo escuro —, e por isso são duas artes, e não uma com filtro: o manual
 * proíbe trocar as cores do grafismo.
 */
export const APPRENTICE_PROGRAM_TRAIL: Record<BrandScheme, string> = {
  light: '/eu-aprendiz/trilha-clara.png',
  dark: '/eu-aprendiz/trilha-negativa.png',
}

/**
 * Os selos dos encontros (seção 11), um por encontro, na arte oficial. Até o
 * pacote de setembro/2026 eles não existiam em PNG e eram desenhados em
 * `MeetingSeal`; agora o selo conquistado é a arte, e o desenho ficou só para
 * os estados que a arte não tem (bloqueado e em andamento).
 *
 * A cor é fixa por encontro e não segue o tema: o manual proíbe alterar
 * número, cor ou ordem.
 */
export const APPRENTICE_PROGRAM_SEALS = [1, 2, 3, 4, 5, 6].map(
  (order) => `/eu-aprendiz/selo-encontro-${order}.png`,
)

/** O selo do encontro `order`, ciclando o catálogo se a trilha crescer. */
export function apprenticeSealFor(order: number): string {
  const size = APPRENTICE_PROGRAM_SEALS.length
  return APPRENTICE_PROGRAM_SEALS[(((order - 1) % size) + size) % size]!
}

function styleFor(scheme: BrandScheme): CSSProperties {
  return {
    ...Object.fromEntries(
      Object.entries(APPRENTICE_PROGRAM_PALETTES[scheme]).map(([token, hex]) => [
        brandCssVar(token as BrandColorToken),
        toRgbChannels(hex),
      ]),
    ),
    '--brand-font-headline': brandFontStack(APPRENTICE_PROGRAM_FONTS.headline, 'headline'),
    '--brand-font-body': brandFontStack(APPRENTICE_PROGRAM_FONTS.body, 'body'),
    colorScheme: scheme,
  } as CSSProperties
}

/** Variáveis para o `style` do contêiner da área, por esquema. Montadas uma vez, no módulo. */
export const APPRENTICE_PROGRAM_STYLES: Record<BrandScheme, CSSProperties> = {
  light: styleFor('light'),
  dark: styleFor('dark'),
}
