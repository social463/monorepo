import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  BRAND_PRESETS,
  EMPTY_LOGOS,
  brandingFromPreset,
  toRgbChannels,
  type BrandingDTO,
} from '@legends/shared'
import userEvent from '@testing-library/user-event'
import { BrandProvider, useBrand, useBrandContext } from './BrandContext'
import { SchemeToggle } from '../components/SchemeToggle'
import { BrandLogo, BrandName, BrandTagline } from '../components/BrandLogo'
import { applyBranding } from '../lib/branding'

const EMR = brandingFromPreset(BRAND_PRESETS.emr)
const PRODUTO = brandingFromPreset(BRAND_PRESETS.legends)

const marcaEmpresa: BrandingDTO = {
  ...EMR,
  appName: 'EMR Legends',
  tagline: 'Onde as lendas nascem',
  logos: {
    light: { wide: 'https://cdn.exemplo.com/emr-wide-claro.svg', mark: 'https://cdn.exemplo.com/emr-mark-claro.svg' },
    dark: { wide: 'https://cdn.exemplo.com/emr-wide-escuro.svg', mark: 'https://cdn.exemplo.com/emr-mark-escuro.svg' },
  },
}

function mockBranding(branding: BrandingDTO) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(branding), { status: 200 })),
  )
}

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('style')
  document.documentElement.className = ''
  document.head.querySelectorAll('link, meta[name="theme-color"]').forEach((el) => el.remove())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('applyBranding', () => {
  it('injeta as cores como canais RGB — é o que o Tailwind precisa para opacidade', () => {
    applyBranding(PRODUTO)
    const root = document.documentElement
    // `bg-primary/30` vira `rgb(var(--brand-primary) / 0.3)`; com hex aqui, não pintaria.
    expect(root.style.getPropertyValue('--brand-primary')).toBe('82 251 162')
    expect(root.style.getPropertyValue('--brand-surface')).toBe('12 20 27')
  })

  it('injeta os 35 tokens de cor mais as duas famílias de fonte', () => {
    applyBranding(marcaEmpresa)
    const declaradas = Array.from(document.documentElement.style).filter((prop) =>
      prop.startsWith('--brand-'),
    )
    // 35 cores + `--brand-font-headline` e `--brand-font-body`: a tipografia é
    // token de marca desde a identidade EMR 2026 (Documento 3, seção 10).
    expect(declaradas.filter((p) => !p.startsWith('--brand-font-'))).toHaveLength(35)
    expect(declaradas).toContain('--brand-font-headline')
    expect(declaradas).toContain('--brand-font-body')
  })

  it('a fonte da marca NÃO sequestra o stylesheet do Material Symbols', () => {
    // Regressão: `upsertLink('stylesheet', …)` casava com o PRIMEIRO
    // `link[rel="stylesheet"]` do head — o do Material Symbols — e trocava o
    // href dele pelo da fonte da marca. Resultado: todo ícone do app virava o
    // texto da ligadura ("how_to_vote" no lugar do desenho).
    const icones = document.createElement('link')
    icones.rel = 'stylesheet'
    icones.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined'
    document.head.appendChild(icones)

    applyBranding(marcaEmpresa)

    expect(icones.href).toContain('Material+Symbols+Outlined')
    const daMarca = document.head.querySelector<HTMLLinkElement>('link#brand-font')
    expect(daMarca?.href).toContain('family=Outfit')
  })

  it('a fonte do produto não carrega arquivo extra; a da empresa carrega', () => {
    // O produto usa Geist/Inter, que já vêm no `index.html`.
    applyBranding(PRODUTO)
    expect(document.head.querySelector('link#brand-font')).toBeNull()

    // A EMR usa Outfit: aí sim a família é baixada, sob demanda.
    applyBranding(marcaEmpresa)
    const link = document.head.querySelector<HTMLLinkElement>('link#brand-font')
    expect(link?.href).toContain('family=Outfit')
    expect(document.documentElement.style.getPropertyValue('--brand-font-headline')).toContain('Outfit')
  })

  it('tema claro tira a classe dark e ajusta o color-scheme', () => {
    document.documentElement.classList.add('dark')
    applyBranding(marcaEmpresa)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('tema escuro devolve a classe dark', () => {
    applyBranding(marcaEmpresa)
    applyBranding(PRODUTO)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('troca título, theme-color, favicon e manifest', () => {
    applyBranding(marcaEmpresa)
    expect(document.title).toBe('EMR Legends')
    expect(document.head.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      marcaEmpresa.colors.surface,
    )
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(
      marcaEmpresa.logos.light.mark,
    )
    expect(document.head.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe(
      '/api/branding/manifest.webmanifest',
    )
  })

  it('empresa sem logo mantém os favicons do produto', () => {
    applyBranding({ ...marcaEmpresa, logos: { light: { wide: null, mark: null }, dark: { wide: null, mark: null } } })
    expect(document.head.querySelector('link[rel="icon"]')).toBeNull()
  })
})

describe('BrandProvider', () => {
  it('busca a marca e aplica no documento', async () => {
    mockBranding(marcaEmpresa)
    render(
      <BrandProvider>
        <BrandName />
      </BrandProvider>,
    )
    expect(await screen.findByText('EMR Legends')).toBeInTheDocument()
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--brand-primary')).not.toBe('')
    })
  })

  it('guarda em cache para a próxima carga não piscar', async () => {
    mockBranding(marcaEmpresa)
    render(
      <BrandProvider>
        <BrandName />
      </BrandProvider>,
    )
    await screen.findByText('EMR Legends')
    const cache = JSON.parse(window.localStorage.getItem('legends:branding')!)
    expect(cache.branding.appName).toBe('EMR Legends')
    expect(cache.host).toBe(window.location.host)
  })

  it('API fora do ar mantém a marca do produto em vez de quebrar a tela', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    render(
      <BrandProvider>
        <BrandName />
      </BrandProvider>,
    )
    expect(await screen.findByText('Legends')).toBeInTheDocument()
  })

  it('descarta cache de outro host — o subdomínio é quem decide a marca', async () => {
    window.localStorage.setItem(
      'legends:branding',
      JSON.stringify({ host: 'outra-empresa.legends.com.br', branding: marcaEmpresa }),
    )
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    render(
      <BrandProvider>
        <BrandName />
      </BrandProvider>,
    )
    expect(await screen.findByText('Legends')).toBeInTheDocument()
  })
})

describe('BrandLogo', () => {
  it('usa a logo da empresa, com o nome dela no alt', async () => {
    mockBranding(marcaEmpresa)
    render(
      <BrandProvider>
        <BrandLogo />
        <BrandLogo variant="mark" />
      </BrandProvider>,
    )
    const [wide, mark] = await screen.findAllByAltText('EMR Legends')
    // Tema claro em vigor: entra a arte em tinta colorida, não a branca.
    expect(wide).toHaveAttribute('src', marcaEmpresa.logos.light.wide)
    expect(mark).toHaveAttribute('src', marcaEmpresa.logos.light.mark)
  })

  it('empresa sem logo, no ESCURO, cai na arte do produto', async () => {
    mockBranding({ ...marcaEmpresa, logos: EMPTY_LOGOS, defaultScheme: 'dark' })
    render(
      <BrandProvider>
        <BrandLogo />
      </BrandProvider>,
    )
    await waitFor(() => {
      expect(screen.getByAltText('EMR Legends')).toHaveAttribute(
        'src',
        '/illustration/horizontal_logo.png',
      )
    })
  })

  it('empresa sem logo, no CLARO, escreve o nome em vez de sumir', async () => {
    // A arte do produto é clara sobre fundo escuro: num tema claro ela fica
    // ilegível. Melhor o nome escrito do que uma logo invisível.
    mockBranding({ ...marcaEmpresa, logos: EMPTY_LOGOS, defaultScheme: 'light' })
    render(
      <BrandProvider>
        <BrandLogo />
      </BrandProvider>,
    )
    expect(await screen.findByText('EMR Legends')).toBeInTheDocument()
    expect(screen.queryByAltText('EMR Legends')).toBeNull()
  })

  it('a logo cadastrada pela empresa vale nos dois temas', async () => {
    mockBranding({ ...marcaEmpresa, defaultScheme: 'light' })
    render(
      <BrandProvider>
        <BrandLogo />
      </BrandProvider>,
    )
    expect(await screen.findByAltText('EMR Legends')).toHaveAttribute('src', marcaEmpresa.logos.light.wide)
  })

  it('aceita fallback próprio por local (o login usa a versão sem margem)', () => {
    render(<BrandLogo wideFallback="/illustration/horizontal_logo_trim.png" />)
    expect(screen.getByAltText('Legends')).toHaveAttribute(
      'src',
      '/illustration/horizontal_logo_trim.png',
    )
  })

  it('empresa sem tagline não renderiza a linha', async () => {
    mockBranding({ ...marcaEmpresa, tagline: null })
    const { container } = render(
      <BrandProvider>
        <BrandName />
        <BrandTagline className="tagline" />
      </BrandProvider>,
    )
    await screen.findByText('EMR Legends')
    expect(container.querySelector('.tagline')).toBeNull()
  })
})

describe('useBrand', () => {
  it('fora do provider devolve a marca do produto, nunca null', () => {
    function Sonda() {
      const brand = useBrand()
      return <span>{brand.appName}</span>
    }
    render(<Sonda />)
    expect(screen.getByText('Legends')).toBeInTheDocument()
  })
})

describe('alternância claro/escuro', () => {
  it('empresa que libera a troca mostra o botão e repinta na hora', async () => {
    mockBranding(marcaEmpresa) // EMR: allowUserScheme true, padrão claro
    render(
      <BrandProvider>
        <SchemeToggle />
      </BrandProvider>,
    )

    const botao = await screen.findByRole('button', { name: /tema escuro/i })
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false))

    await userEvent.click(botao)

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    // Repinta a partir da paleta escura que já veio na resposta — sem nova ida à API.
    expect(document.documentElement.style.getPropertyValue('--brand-surface')).toBe(
      toRgbChannels(EMR.schemes.dark.surface),
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a escolha sobrevive ao reload', async () => {
    mockBranding(marcaEmpresa)
    const { unmount } = render(
      <BrandProvider>
        <SchemeToggle />
      </BrandProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: /tema escuro/i }))
    unmount()

    render(
      <BrandProvider>
        <SchemeToggle />
      </BrandProvider>,
    )
    expect(await screen.findByRole('button', { name: /tema claro/i })).toBeInTheDocument()
  })

  it('empresa que não libera não mostra botão nenhum', async () => {
    mockBranding({ ...marcaEmpresa, allowUserScheme: false })
    render(
      <BrandProvider>
        <BrandName />
        <SchemeToggle />
      </BrandProvider>,
    )
    await screen.findByText('EMR Legends')
    // Botão sem efeito é pior que botão ausente.
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('ignora escolha guardada quando a empresa deixa de liberar a troca', async () => {
    window.localStorage.setItem('legends:scheme', 'dark')
    mockBranding({ ...marcaEmpresa, allowUserScheme: false, defaultScheme: 'light' })
    render(
      <BrandProvider>
        <BrandName />
      </BrandProvider>,
    )
    await screen.findByText('EMR Legends')
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false))
  })

  it('expõe a paleta do esquema em vigor', async () => {
    mockBranding(marcaEmpresa)
    function Sonda() {
      const { scheme, colors } = useBrandContext()
      return <span>{`${scheme}:${colors.surface}`}</span>
    }
    render(
      <BrandProvider>
        <Sonda />
      </BrandProvider>,
    )
    expect(await screen.findByText(`light:${EMR.schemes.light.surface}`)).toBeInTheDocument()
  })
})

describe('skeleton enquanto a marca e a arte carregam', () => {
  /** Promessa presa: simula a resposta que ainda não voltou. */
  function fetchPendurado() {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  }

  it('não mostra a marca do produto enquanto a da empresa não chega', async () => {
    // A piscada era esta: "Legends" na primeira pintura, trocando pela do
    // cliente quando o GET /branding responde.
    fetchPendurado()
    const { container } = render(
      <BrandProvider>
        <BrandLogo />
        <BrandName />
      </BrandProvider>,
    )
    expect(screen.queryByAltText('Legends')).toBeNull()
    expect(screen.queryByText('Legends')).toBeNull()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('com cache da visita anterior não espera — o que está na tela já é o certo', async () => {
    window.localStorage.setItem(
      'legends:branding',
      JSON.stringify({ host: window.location.host, branding: marcaEmpresa }),
    )
    fetchPendurado()
    render(
      <BrandProvider>
        <BrandName />
      </BrandProvider>,
    )
    expect(screen.getByText('EMR Legends')).toBeInTheDocument()
  })

  it('a logo fica em skeleton até o arquivo carregar, e some no onLoad', async () => {
    mockBranding(marcaEmpresa)
    render(
      <BrandProvider>
        <BrandLogo />
      </BrandProvider>,
    )
    const img = await screen.findByAltText('EMR Legends')
    // URL em mãos, bytes ainda não: o <img> está no DOM (é ele que baixa) com o pulso.
    expect(img.className).toContain('animate-pulse')
    fireEvent.load(img)
    expect(img.className).not.toContain('animate-pulse')
  })

  it('erro de rede na imagem encerra o pulso em vez de girar para sempre', async () => {
    mockBranding(marcaEmpresa)
    render(
      <BrandProvider>
        <BrandLogo />
      </BrandProvider>,
    )
    const img = await screen.findByAltText('EMR Legends')
    fireEvent.error(img)
    expect(img.className).not.toContain('animate-pulse')
  })

  it('trocar de tema troca a arte e espera de novo — o estado não é um booleano', async () => {
    mockBranding(marcaEmpresa)
    render(
      <BrandProvider>
        <BrandLogo />
        <SchemeToggle />
      </BrandProvider>,
    )
    const img = await screen.findByAltText('EMR Legends')
    fireEvent.load(img)
    expect(img.className).not.toContain('animate-pulse')

    await userEvent.click(screen.getByRole('button', { name: /tema escuro/i }))
    const escura = screen.getByAltText('EMR Legends')
    expect(escura).toHaveAttribute('src', marcaEmpresa.logos.dark.wide)
    // Arte nova, download novo: o pulso volta até esta carregar.
    expect(escura.className).toContain('animate-pulse')
  })

  it('API fora do ar encerra a espera e assume a marca do produto', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    render(
      <BrandProvider>
        <BrandName />
      </BrandProvider>,
    )
    // Desistiu: vira resposta, não espera infinita.
    expect(await screen.findByText('Legends')).toBeInTheDocument()
  })
})
