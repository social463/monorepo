import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_BONUS_PROGRAM } from '@legends/shared'
import { BonusCalculatorPage } from './BonusCalculatorPage'
import * as api from '../../lib/api'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BonusCalculatorPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Preenche os quatro campos com um caso de conta redonda. */
function preencher() {
  fireEvent.change(screen.getByLabelText('Data de admissão'), { target: { value: '2026-12-31' } })
  fireEvent.change(screen.getByLabelText(/salário mensal bruto/i), { target: { value: '5000' } })
  fireEvent.change(screen.getByLabelText('Valor do cargo'), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText(/avaliação de desempenho/i), { target: { value: '4' } })
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'apiFetch').mockResolvedValue({ settings: DEFAULT_BONUS_PROGRAM } as never)
})

describe('BonusCalculatorPage', () => {
  it('só mostra o resultado depois dos quatro campos', async () => {
    renderPage()

    expect(screen.getByText(/preencha os quatro campos/i)).toBeInTheDocument()
    preencher()

    await waitFor(() => expect(screen.queryByText(/preencha os quatro campos/i)).not.toBeInTheDocument())
    expect(screen.getByText('Suas cotas')).toBeInTheDocument()
  })

  it('mostra uma linha por meta do programa, da menor para a maior', async () => {
    renderPage()
    preencher()

    await waitFor(() => expect(screen.getByText('Suas cotas')).toBeInTheDocument())
    for (const meta of ['64,3%', '70%', '80%', '90%', '100%']) {
      expect(screen.getByText(meta)).toBeInTheDocument()
    }
  })

  // O CLT recebe 14,33 meses por ano; a conta usa a média mensal disso. Trocar
  // o tipo de contratação tem de mudar o salário que entra na fórmula.
  it('CLT entra com o salário maior que PJ para o mesmo valor digitado', async () => {
    renderPage()
    preencher()
    await waitFor(() => expect(screen.getByText('Salário na conta')).toBeInTheDocument())
    const comCLT = screen.getByText('Salário na conta').nextElementSibling?.textContent

    fireEvent.click(screen.getByLabelText('PJ'))

    await waitFor(() => {
      const comPJ = screen.getByText('Salário na conta').nextElementSibling?.textContent
      expect(comPJ).not.toBe(comCLT)
    })
    // PJ é o bruto da nota, sem os 14,33 meses.
    expect(screen.getByText('Salário na conta').nextElementSibling?.textContent).toContain('5.000,00')
  })

  it('avaliação fora de 1 a 5 não produz resultado', async () => {
    renderPage()
    preencher()
    await waitFor(() => expect(screen.getByText('Suas cotas')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/avaliação de desempenho/i), { target: { value: '9' } })

    await waitFor(() => expect(screen.getByText(/preencha os quatro campos/i)).toBeInTheDocument())
  })

  // A página é de todo colaborador e pede o salário. Dizer que a conta é local
  // é parte do produto, não enfeite: sem isso, digitar o salário é um ato de fé.
  it('avisa que o salário não sai do navegador', () => {
    renderPage()

    expect(screen.getByText(/no seu navegador/i)).toBeInTheDocument()
  })

  it('não envia nada ao servidor além da leitura dos números do programa', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockResolvedValue({ settings: DEFAULT_BONUS_PROGRAM } as never)
    renderPage()
    preencher()

    await waitFor(() => expect(screen.getByText('Suas cotas')).toBeInTheDocument())
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/bonus-program')
  })

  // Sem a legenda, "Valor do cargo" é um número que ninguém sabe preencher.
  it('explica o valor de cada cargo, amarrado ao campo', () => {
    renderPage()

    const campo = screen.getByLabelText('Valor do cargo')
    expect(campo).toHaveAccessibleDescription(/4 Coordenadores, Gerentes e Heads participantes do comitê/)
    expect(campo).toHaveAccessibleDescription(/1 Analistas, Assistentes, Estagiários/)
  })

  it('usa a data-limite do programa no rótulo do tempo de casa', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      settings: { ...DEFAULT_BONUS_PROGRAM, deadline: '2030-06-30' },
    } as never)
    renderPage()

    expect(await screen.findByText(/conta até 30\/06\/2030/i)).toBeInTheDocument()
  })
})
