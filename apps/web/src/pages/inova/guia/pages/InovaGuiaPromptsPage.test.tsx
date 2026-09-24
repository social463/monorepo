import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { InovaGuiaPromptsPage } from './InovaGuiaPromptsPage'
import { prompts } from '../content/prompts'

function renderPage(initialEntry = '/comunidade-inova/guia/prompts') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <InovaGuiaPromptsPage />
    </MemoryRouter>,
  )
}

describe('InovaGuiaPromptsPage', () => {
  beforeEach(() => window.localStorage.clear())

  it('lista os prompts e filtra por busca', async () => {
    renderPage()
    const primeiro = prompts[0]!
    expect(screen.getByText(primeiro.title)).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/buscar prompts/i), 'termo-inexistente-em-qualquer-prompt')
    expect(screen.queryByText(primeiro.title)).not.toBeInTheDocument()
  })

  it('favorita um prompt', async () => {
    renderPage()
    await userEvent.click(screen.getAllByRole('button', { name: `Salvar prompt` })[0]!)
    expect(screen.getByRole('button', { name: 'Remover dos salvos' })).toBeInTheDocument()
  })

  it('leva ao Prompt Cowboy em nova aba', () => {
    renderPage()
    const link = screen.getByRole('link', { name: /acessar prompt cowboy/i })
    expect(link).toHaveAttribute('href', 'https://promptcowboy.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('o prompt do ?p= (busca global) sobe para o topo da lista', () => {
    const alvo = prompts[prompts.length - 1]!
    renderPage(`/comunidade-inova/guia/prompts?p=${alvo.id}`)
    const [lista] = screen.getAllByRole('list').filter((ul) => within(ul).queryAllByRole('heading', { level: 3 }).length > 1)
    const primeiroTitulo = within(lista!).getAllByRole('heading', { level: 3 })[0]
    expect(primeiroTitulo).toHaveTextContent(alvo.title)
  })
})
