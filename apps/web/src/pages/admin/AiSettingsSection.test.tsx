import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AiSettingsDTO } from '@legends/shared'
import { AiSettingsSection } from './AiSettingsSection'

const getAiSettings = vi.fn()
const updateAiSettings = vi.fn()

vi.mock('../../lib/ai-settings-api', () => ({
  getAiSettings: () => getAiSettings(),
  updateAiSettings: (body: unknown) => updateAiSettings(body),
}))

const settings = (over: Partial<AiSettingsDTO> = {}): AiSettingsDTO => ({
  provider: 'gemini',
  configured: false,
  model: 'gemini-3-flash-preview',
  baseUrl: null,
  ...over,
})

/** Provedor e modelo usam o `Select` do projeto: abre o combobox e clica na opção. */
async function escolher(campo: string, opcao: string | RegExp) {
  await userEvent.click(screen.getByRole('combobox', { name: campo }))
  await userEvent.click(screen.getByRole('option', { name: opcao }))
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AiSettingsSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  updateAiSettings.mockImplementation(async () => settings({ configured: true }))
})

describe('AiSettingsSection', () => {
  it('avisa quando não há chave e os agentes estão indisponíveis', async () => {
    getAiSettings.mockResolvedValue(settings())
    renderSection()
    expect(await screen.findByText(/Nenhuma chave cadastrada/)).toBeInTheDocument()
  })

  it('mostra "configurada" sem nunca exibir a chave', async () => {
    getAiSettings.mockResolvedValue(settings({ configured: true }))
    renderSection()

    expect(await screen.findByText(/Chave configurada/)).toBeInTheDocument()
    const campo = screen.getByLabelText('Chave da API de IA')
    // O campo fica vazio e só sinaliza pelo placeholder: a chave não volta da API.
    expect(campo).toHaveValue('')
    expect(campo).toHaveAttribute('placeholder', 'configurada')
    expect(campo).toHaveAttribute('type', 'password')
  })

  it('só envia a chave quando o admin digita uma nova', async () => {
    getAiSettings.mockResolvedValue(settings({ configured: true, model: 'gemini-3-flash-preview' }))
    renderSection()
    await screen.findByText(/Chave configurada/)

    await userEvent.click(screen.getByLabelText('Salvar configuração de IA'))
    await waitFor(() => expect(updateAiSettings).toHaveBeenCalled())
    // Sem digitar nada, o payload não carrega apiKey — o valor atual fica.
    expect(updateAiSettings).toHaveBeenCalledWith({ provider: 'gemini', model: 'gemini-3-flash-preview' })

    await userEvent.type(screen.getByLabelText('Chave da API de IA'), 'chave-nova')
    await userEvent.click(screen.getByLabelText('Salvar configuração de IA'))
    await waitFor(() => expect(updateAiSettings).toHaveBeenCalledTimes(2))
    expect(updateAiSettings).toHaveBeenLastCalledWith({
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
      apiKey: 'chave-nova',
    })
  })

  it('remover manda string vazia e avisa que os agentes ficam indisponíveis', async () => {
    getAiSettings.mockResolvedValue(settings({ configured: true }))
    updateAiSettings.mockImplementation(async () => settings({ configured: false }))
    renderSection()
    await screen.findByText(/Chave configurada/)

    await userEvent.click(screen.getByLabelText('Remover chave da API'))

    await waitFor(() => expect(updateAiSettings).toHaveBeenCalledWith({ apiKey: '' }))
    expect(await screen.findByText(/Chave removida/)).toBeInTheDocument()
  })

  it('não oferece remoção quando não há chave cadastrada', async () => {
    getAiSettings.mockResolvedValue(settings())
    renderSection()
    await screen.findByText(/Nenhuma chave cadastrada/)
    expect(screen.queryByLabelText('Remover chave da API')).toBeNull()
  })

  it('trocar de provedor sugere o modelo padrão dele e exige a chave nova', async () => {
    getAiSettings.mockResolvedValue(settings({ configured: true }))
    updateAiSettings.mockImplementation(async () =>
      settings({ provider: 'anthropic', configured: true, model: 'claude-opus-5' }),
    )
    renderSection()
    await screen.findByText(/Chave configurada/)

    await escolher('Provedor de IA', 'Anthropic (Claude)')
    expect(screen.getByRole('combobox', { name: 'Modelo de IA' })).toHaveTextContent('claude-opus-5')

    // Salvar sem chave nova não chega a chamar a API: a troca apagaria a chave atual.
    await userEvent.click(screen.getByLabelText('Salvar configuração de IA'))
    expect(await screen.findByRole('status')).toHaveTextContent(/informe a chave do Anthropic/i)
    expect(updateAiSettings).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText('Chave da API de IA'), 'sk-ant-nova')
    await userEvent.click(screen.getByLabelText('Salvar configuração de IA'))
    await waitFor(() =>
      expect(updateAiSettings).toHaveBeenCalledWith({
        provider: 'anthropic',
        model: 'claude-opus-5',
        apiKey: 'sk-ant-nova',
      }),
    )
  })

  it('o modelo sai de um select, com escape para digitar um fora da lista', async () => {
    getAiSettings.mockResolvedValue(settings({ configured: true }))
    renderSection()
    await screen.findByText(/Chave configurada/)

    // Select com os modelos conhecidos do provedor…
    await escolher('Modelo de IA', 'gemini-3.1-pro-preview')
    await userEvent.click(screen.getByLabelText('Salvar configuração de IA'))
    await waitFor(() =>
      expect(updateAiSettings).toHaveBeenCalledWith({ provider: 'gemini', model: 'gemini-3.1-pro-preview' }),
    )

    // …e "Outro modelo…" abre campo livre, sem mandar a sentinela para a API.
    await escolher('Modelo de IA', 'Outro modelo…')
    const campoLivre = screen.getByLabelText('Modelo de IA')
    expect(campoLivre.tagName).toBe('INPUT')
    await userEvent.type(campoLivre, 'gemini-3.0-experimental')
    await userEvent.click(screen.getByLabelText('Salvar configuração de IA'))
    await waitFor(() =>
      expect(updateAiSettings).toHaveBeenLastCalledWith({
        provider: 'gemini',
        model: 'gemini-3.0-experimental',
      }),
    )
  })

  it('provedor compatível com OpenAI exige a URL da API', async () => {
    getAiSettings.mockResolvedValue(settings())
    renderSection()
    await screen.findByText(/Nenhuma chave cadastrada/)

    await escolher('Provedor de IA', /Compatível com OpenAI/)
    const url = screen.getByLabelText('URL da API compatível com OpenAI')

    await userEvent.type(screen.getByLabelText('Chave da API de IA'), 'gsk-teste')
    await userEvent.click(screen.getByLabelText('Salvar configuração de IA'))
    expect(await screen.findByRole('status')).toHaveTextContent(/informe a URL da API/i)
    expect(updateAiSettings).not.toHaveBeenCalled()

    await userEvent.type(url, 'https://api.groq.com/openai/v1')
    // Provedor sem lista de modelos conhecidos: o campo é livre desde o início.
    await userEvent.type(screen.getByLabelText('Modelo de IA'), 'llama-3.3-70b')
    await userEvent.click(screen.getByLabelText('Salvar configuração de IA'))
    await waitFor(() =>
      expect(updateAiSettings).toHaveBeenCalledWith({
        provider: 'openai-compatible',
        model: 'llama-3.3-70b',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: 'gsk-teste',
      }),
    )
  })
})
