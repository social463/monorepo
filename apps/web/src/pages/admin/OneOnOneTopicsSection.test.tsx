import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OneOnOneTopicsSection } from './OneOnOneTopicsSection'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }))

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <OneOnOneTopicsSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('OneOnOneTopicsSection', () => {
  it('lista os tópicos agrupados por tema', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      templates: [
        { id: 't1', theme: 'Carreira', text: 'Onde você quer chegar?', active: true, sortOrder: 0 },
        { id: 't2', theme: 'Feedback', text: 'Que feedback você tem para mim?', active: true, sortOrder: 0 },
      ],
    })

    renderSection()

    expect(await screen.findByText('Carreira')).toBeInTheDocument()
    expect(screen.getByText('Que feedback você tem para mim?')).toBeInTheDocument()
  })

  it('cria um tópico novo', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ templates: [] })

    renderSection()
    await userEvent.type(await screen.findByLabelText(/tema/i), 'Carreira')
    await userEvent.type(screen.getByLabelText(/pergunta/i), 'Onde você quer chegar?')
    await userEvent.click(screen.getByRole('button', { name: /adicionar/i }))

    expect(apiFetch).toHaveBeenCalledWith(
      '/admin/one-on-one-topics',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('pede confirmação antes de excluir e não chama a API se o usuário cancelar', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.mocked(apiFetch).mockResolvedValue({
      templates: [{ id: 't1', theme: 'Carreira', text: 'Onde você quer chegar?', active: true, sortOrder: 0 }],
    })

    renderSection()
    await userEvent.click(await screen.findByLabelText('Excluir Onde você quer chegar?'))

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Onde você quer chegar?'))
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/admin/one-on-one-topics/'),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('exclui o tópico quando o usuário confirma', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(apiFetch).mockResolvedValue({
      templates: [{ id: 't1', theme: 'Carreira', text: 'Onde você quer chegar?', active: true, sortOrder: 0 }],
    })

    renderSection()
    await userEvent.click(await screen.findByLabelText('Excluir Onde você quer chegar?'))

    expect(apiFetch).toHaveBeenCalledWith('/admin/one-on-one-topics/t1', { method: 'DELETE' })
  })
})
