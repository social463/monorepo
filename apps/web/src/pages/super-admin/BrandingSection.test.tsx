import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BRAND_PRESETS, brandingFromPreset } from '@legends/shared'
import { BrandingSection } from './BrandingSection'
import * as brandingApi from '../../lib/branding-api'
import * as useImageUpload from '../../lib/use-image-upload'

const EMPRESA = 'company-emr'

const EMR = brandingFromPreset(BRAND_PRESETS.emr)
const PRODUTO = brandingFromPreset(BRAND_PRESETS.legends)
const SEM_PROBLEMA = { light: [], dark: [] }

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.spyOn(useImageUpload, 'useImageUploadsEnabled').mockReturnValue(true)
  vi.spyOn(brandingApi, 'previewBranding').mockResolvedValue({
    schemes: EMR.schemes,
    contrastIssues: SEM_PROBLEMA,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Administração › Marca', () => {
  it('carrega a marca atual nos campos', async () => {
    vi.spyOn(brandingApi, 'getBrandingSettings').mockResolvedValue({
      ...EMR,
      appName: 'EMR Legends',
      overrides: {},
      configured: true,
      contrastIssues: SEM_PROBLEMA,
    })

    wrap(<BrandingSection companyId={EMPRESA} />)

    expect(await screen.findByDisplayValue('EMR Legends')).toBeInTheDocument()
    // Pelo placeholder: o seletor `type=color` carrega o mesmo valor do campo de texto.
    expect(screen.getByPlaceholderText('#35bd78')).toHaveValue('#35bd78')
    // O esquema vem marcado como o que está salvo.
    // Dois grupos usam os mesmos rótulos (esquema padrão e prévia); ambos partem do salvo.
    for (const botao of screen.getAllByRole('button', { name: 'Claro' })) {
      expect(botao).toHaveAttribute('aria-pressed', 'true')
    }
  })

  it('avisa que a empresa ainda está na identidade do produto', async () => {
    vi.spyOn(brandingApi, 'getBrandingSettings').mockResolvedValue({
      ...PRODUTO,
      overrides: {},
      configured: false,
      contrastIssues: SEM_PROBLEMA,
    })

    wrap(<BrandingSection companyId={EMPRESA} />)
    expect(await screen.findByText(/identidade padrão do produto/i)).toBeInTheDocument()
  })

  it('salva e aplica a marca na hora, sem esperar o reload', async () => {
    const salva = { ...EMR, appName: 'EMR Legends', overrides: {}, configured: true, contrastIssues: SEM_PROBLEMA }
    vi.spyOn(brandingApi, 'getBrandingSettings').mockResolvedValue(salva)
    const update = vi.spyOn(brandingApi, 'updateBranding').mockResolvedValue(salva)

    wrap(<BrandingSection companyId={EMPRESA} />)
    await screen.findByDisplayValue('EMR Legends')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar marca' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    // A empresa vai na chamada: o super admin edita a marca de OUTRA empresa.
    expect(update.mock.calls[0][0]).toBe(EMPRESA)
    expect(update.mock.calls[0][1]).toMatchObject({
      appName: 'EMR Legends',
      defaultScheme: 'light',
      allowUserScheme: true,
      brandColor: '#35bd78',
    })
    // E o console interno NÃO se repinta com a marca do cliente.
    expect(document.documentElement.style.getPropertyValue('--brand-primary')).toBe('')
  })

  it('mostra os pares que reprovam em contraste, sem impedir o salvamento', async () => {
    vi.spyOn(brandingApi, 'getBrandingSettings').mockResolvedValue({
      ...EMR,
      overrides: {},
      configured: true,
      contrastIssues: SEM_PROBLEMA,
    })
    vi.spyOn(brandingApi, 'previewBranding').mockResolvedValue({
      schemes: EMR.schemes,
      contrastIssues: {
        light: [
          {
            foreground: 'primary',
            background: 'surface',
            label: 'cor da marca como texto',
            ratio: 2.31,
            min: 4.5,
          },
        ],
        dark: [],
      },
    })

    wrap(<BrandingSection companyId={EMPRESA} />)

    // `findByText` e não `findByRole('alert')`: a prévia nasce no esquema padrão
    // do componente e só depois hidrata com o da empresa — pegar "o primeiro
    // alerta" capturaria o aviso do outro tema, que aparece nesse intervalo.
    expect(await screen.findByText(/cor da marca como texto: 2.31:1/)).toBeInTheDocument()
    // A marca é do cliente: avisa, não bloqueia.
    expect(screen.getByRole('button', { name: 'Salvar marca' })).toBeEnabled()
  })

  it('não consulta a prévia enquanto o hex está incompleto', async () => {
    vi.spyOn(brandingApi, 'getBrandingSettings').mockResolvedValue({
      ...EMR,
      overrides: {},
      configured: true,
      contrastIssues: SEM_PROBLEMA,
    })
    const preview = vi.spyOn(brandingApi, 'previewBranding').mockResolvedValue({
      schemes: EMR.schemes,
      contrastIssues: SEM_PROBLEMA,
    })

    wrap(<BrandingSection companyId={EMPRESA} />)
    const campo = await screen.findByPlaceholderText('#35bd78')
    await waitFor(() => expect(preview).toHaveBeenCalled())
    preview.mockClear()

    await userEvent.clear(campo)
    await userEvent.type(campo, '#35b')

    // "#35b" não é cor: consultar traria 400 a cada tecla.
    await waitFor(() => expect(preview).not.toHaveBeenCalled())
  })

  it('avisa quando o ambiente não tem upload de imagem', async () => {
    vi.spyOn(useImageUpload, 'useImageUploadsEnabled').mockReturnValue(false)
    vi.spyOn(brandingApi, 'getBrandingSettings').mockResolvedValue({
      ...EMR,
      overrides: {},
      configured: true,
      contrastIssues: SEM_PROBLEMA,
    })

    wrap(<BrandingSection companyId={EMPRESA} />)
    expect(await screen.findByText(/sem S3 configurado/i)).toBeInTheDocument()
  })
})

describe('tokens do design system', () => {
  const base = { ...EMR, overrides: {}, configured: true, contrastIssues: SEM_PROBLEMA }

  it('cola o JSON, fixa os tokens e repinta a prévia com eles', async () => {
    vi.spyOn(brandingApi, 'getBrandingSettings').mockResolvedValue(base)
    const preview = vi.spyOn(brandingApi, 'previewBranding').mockResolvedValue({
      schemes: EMR.schemes,
      contrastIssues: SEM_PROBLEMA,
    })

    wrap(<BrandingSection companyId={EMPRESA} />)
    await screen.findByDisplayValue('EMR Legends')

    const campo = screen.getByPlaceholderText(/"light"/)
    await userEvent.click(campo)
    await userEvent.paste('{"light":{"primary":"#007344"},"dark":{"primary":"#25de88"}}')
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar tokens' }))

    expect(await screen.findByText(/1 tokens no claro, 1 no escuro/)).toBeInTheDocument()
    expect(screen.getByText('2 tokens fixados')).toBeInTheDocument()
    // A prévia precisa refletir o que foi colado — senão a tela mente.
    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith(
        expect.objectContaining({ overrides: { light: { primary: '#007344' }, dark: { primary: '#25de88' } } }),
      ),
    )
  })

  it('avisa o que ficou de fora em vez de engolir', async () => {
    vi.spyOn(brandingApi, 'getBrandingSettings').mockResolvedValue(base)
    wrap(<BrandingSection companyId={EMPRESA} />)
    await screen.findByDisplayValue('EMR Legends')

    await userEvent.click(screen.getByPlaceholderText(/"light"/))
    await userEvent.paste('{"light":{"primary":"#007344","inventado":"#fff","surface":"verde"}}')
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar tokens' }))

    expect(await screen.findByText(/token desconhecido.*light\.inventado/)).toBeInTheDocument()
    expect(screen.getByText(/cor inválida.*light\.surface/)).toBeInTheDocument()
  })

  it('JSON quebrado mostra o erro e não fixa nada', async () => {
    vi.spyOn(brandingApi, 'getBrandingSettings').mockResolvedValue(base)
    wrap(<BrandingSection companyId={EMPRESA} />)
    await screen.findByDisplayValue('EMR Legends')

    await userEvent.click(screen.getByPlaceholderText(/"light"/))
    await userEvent.paste('{isso não é json')
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar tokens' }))

    expect(await screen.findByText(/não é um JSON válido/)).toBeInTheDocument()
    expect(screen.queryByText(/tokens fixados/)).toBeNull()
  })

  it('salva os tokens colados junto com o resto do formulário', async () => {
    vi.spyOn(brandingApi, 'getBrandingSettings').mockResolvedValue(base)
    const update = vi.spyOn(brandingApi, 'updateBranding').mockResolvedValue(base)

    wrap(<BrandingSection companyId={EMPRESA} />)
    await screen.findByDisplayValue('EMR Legends')

    await userEvent.click(screen.getByPlaceholderText(/"light"/))
    await userEvent.paste('{"light":{"primary":"#007344"}}')
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar tokens' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar marca' }))

    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0][1].overrides).toEqual({ light: { primary: '#007344' } })
  })

  it('desfaz e volta para a paleta derivada', async () => {
    vi.spyOn(brandingApi, 'getBrandingSettings').mockResolvedValue({
      ...EMR,
      overrides: { light: { primary: '#007344' } },
      configured: true,
      contrastIssues: SEM_PROBLEMA,
    })
    wrap(<BrandingSection companyId={EMPRESA} />)

    expect(await screen.findByText('1 token fixado')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /paleta derivada/ }))
    expect(screen.queryByText(/token fixado/)).toBeNull()
  })
})
