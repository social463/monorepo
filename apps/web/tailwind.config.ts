import type { Config } from 'tailwindcss'
// Subcaminho, e não o barril: o `@legends/shared` raiz arrasta `office.ts` e
// `character.ts`, que fazem trabalho em tempo de módulo que o jiti (o carregador
// que o Tailwind usa para ler este arquivo) não executa. Aqui só entram
// `branding.ts` e `color.ts`, que são constantes e funções puras.
import { BRAND_COLOR_TOKENS, LEGENDS_PALETTE, brandCssVar } from '@legends/shared/branding'
import { toRgbChannels } from '@legends/shared/color'

/**
 * Paleta Material 3 — **por empresa**, não por build. Cada token vira
 * `rgb(var(--brand-<token>, <fallback>) / <alpha-value>)`:
 *
 * - o valor real chega em runtime, injetado no `:root` pelo `BrandProvider`
 *   com as cores que a API resolveu para o tenant;
 * - o fallback é a paleta "Technical Precision" do produto, importada do
 *   contrato — sem nenhuma variável injetada, o app renderiza exatamente como
 *   antes deste mecanismo existir, o que mata o flash na primeira pintura;
 * - o formato é canal RGB separado por espaço, e não hex, porque só assim o
 *   `<alpha-value>` do Tailwind interpola. Com hex na variável, toda classe com
 *   opacidade (`bg-primary/30`, usada à larga) sairia sem cor nenhuma.
 */
const brandColors = Object.fromEntries(
  BRAND_COLOR_TOKENS.map((token) => [
    token,
    `rgb(var(${brandCssVar(token)}, ${toRgbChannels(LEGENDS_PALETTE[token])}) / <alpha-value>)`,
  ]),
)

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: brandColors,
      maxWidth: {
        /**
         * Largura máxima do conteúdo de uma página.
         *
         * Existe desde que a navegação saiu da lateral e foi para o topo: sem
         * os 256px da sidebar, o `max-w-7xl` (1280px) de antes deixava uma
         * faixa vazia dos dois lados em monitor grande. Trocar aqui muda todas
         * as telas de uma vez.
         */
        page: '1600px',
      },
      fontFamily: {
        headline: ['Geist', 'system-ui', 'sans-serif'],
        label: ['Geist', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Geist', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'headline-xl': ['40px', { lineHeight: '48px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-lg': ['32px', { lineHeight: '40px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'headline-md': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        // headline-sm e a família title-* fecham a escada entre headline-md (24px)
        // e body-*: são títulos de painel, card e item de lista. Já eram usados em
        // ~55 lugares antes de existirem aqui — sem a definição o Tailwind não
        // gerava regra nenhuma e o texto herdava o tamanho do pai.
        'headline-sm': ['20px', { lineHeight: '28px', fontWeight: '600' }],
        'title-lg': ['18px', { lineHeight: '24px', fontWeight: '600' }],
        'title-md': ['16px', { lineHeight: '22px', fontWeight: '600' }],
        'title-sm': ['14px', { lineHeight: '20px', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '28px' }],
        'body-md': ['16px', { lineHeight: '24px' }],
        'body-sm': ['14px', { lineHeight: '20px' }],
        'label-lg': ['16px', { lineHeight: '20px', letterSpacing: '0.02em', fontWeight: '500' }],
        'label-md': ['14px', { lineHeight: '16px', letterSpacing: '0.02em', fontWeight: '500' }],
        'label-sm': ['12px', { lineHeight: '14px', letterSpacing: '0.03em', fontWeight: '500' }],
      },
      borderRadius: {
        sm: '0.125rem',
        DEFAULT: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px',
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '40px',
        gutter: '16px',
        margin: '24px',
      },
      keyframes: {
        'retro-float': {
          '0%': { transform: 'translateY(0) scale(0.85)', opacity: '0' },
          '12%': { transform: 'translateY(-4vh) scale(1)', opacity: '1' },
          '100%': { transform: 'translateY(-38vh) scale(1)', opacity: '0' },
        },
        'office-float': {
          '0%': { transform: 'translateY(0) scale(0.85)', opacity: '0' },
          '12%': { transform: 'translateY(-4vh) scale(1)', opacity: '1' },
          '100%': { transform: 'translateY(-38vh) scale(1)', opacity: '0' },
        },
        'confetti-fall': {
          '0%': { transform: 'translateY(-10%) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateY(110vh) rotate(360deg)', opacity: '0' },
        },
      },
      animation: {
        'retro-float': 'retro-float 2.5s ease-out forwards',
        'office-float': 'office-float 2.5s ease-out forwards',
        'confetti-fall': 'confetti-fall 3s ease-in forwards',
      },
    },
  },
  plugins: [],
} satisfies Config
