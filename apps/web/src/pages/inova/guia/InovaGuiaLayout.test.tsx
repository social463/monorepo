import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { InovaGuiaLayout } from './InovaGuiaLayout'
import { situations } from './content/situations'

/** Mostra a URL atual, para conferir para onde a busca navegou. */
function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function renderLayout(initialEntry = '/comunidade-inova/guia') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/comunidade-inova/guia" element={<InovaGuiaLayout />}>
          <Route index element={<p>início do guia</p>} />
          <Route path="prompts" element={<p>prompts do guia</p>} />
          <Route path="situacoes" element={<Where />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('InovaGuiaLayout', () => {
  it('mostra a sub-navegação com as 11 seções', () => {
    renderLayout()
    const menu = screen.getByRole('navigation', { name: 'Seções do Guia AI First' })
    for (const label of [
      'Início',
      'Bússola',
      'Situações',
      'Na prática',
      'Vídeos',
      'Prompts',
      'Maturidade',
      'Liderança',
      'Segurança',
      'Casos',
      'Guia completo',
    ]) {
      expect(within(menu).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('agrupa as seções em Fundamentos, Mão na massa e Governança', () => {
    renderLayout()
    const menu = screen.getByRole('navigation', { name: 'Seções do Guia AI First' })
    for (const title of ['Fundamentos', 'Mão na massa', 'Governança']) {
      expect(within(menu).getByText(title)).toBeInTheDocument()
    }
  })

  it('o botão do menu mobile nomeia a seção aberta e alterna o menu', async () => {
    const user = userEvent.setup()
    renderLayout('/comunidade-inova/guia/prompts')

    const toggle = screen.getByRole('button', { name: /Seções do guia · Prompts/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('o CTA "Registrar um case" leva ao formulário de projeto da comunidade', () => {
    renderLayout()
    expect(screen.getByRole('link', { name: 'Registrar um case' })).toHaveAttribute('href', '/comunidade-inova/novo')
  })

  it('mostra o rodapé com as colunas de links e os avisos', () => {
    renderLayout()
    const footer = screen.getByRole('contentinfo')
    for (const title of ['Decidir', 'Praticar', 'Compartilhar']) expect(within(footer).getByText(title)).toBeInTheDocument()
    expect(within(footer).getByRole('link', { name: 'Prompt Lab' })).toHaveAttribute('href', '/comunidade-inova/guia/prompts')
    expect(within(footer).getByText(/Dúvidas sobre a rotina/)).toBeInTheDocument()
    expect(within(footer).getByText('Suas preferências ficam apenas neste navegador.')).toBeInTheDocument()
  })

  it('Ctrl+K abre a busca com o foco no campo e exemplos; Esc fecha', () => {
    renderLayout()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const dialog = screen.getByRole('dialog', { name: 'Busca global do guia' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('combobox')).toHaveFocus()
    expect(within(dialog).getByText('Exemplos')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Cmd+K também abre, e o botão do cabeçalho abre a busca', async () => {
    const user = userEvent.setup()
    renderLayout()
    fireEvent.keyDown(window, { key: 'K', metaKey: true })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Fechar busca' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /buscar no guia/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('busca, rotula o tipo de cada resultado, navega com as setas e abre com Enter', async () => {
    const user = userEvent.setup()
    renderLayout()
    await user.click(screen.getByRole('button', { name: /buscar no guia/i }))
    const alvo = situations.find((s) => s.slug === 'conflito')!
    await user.type(screen.getByRole('combobox'), 'conflito')

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[0]).toHaveTextContent('Situação')
    expect(options[0]).toHaveTextContent(alvo.title)

    if (options.length > 1) {
      await user.keyboard('{ArrowDown}')
      expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
      await user.keyboard('{ArrowUp}')
    }
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent(`/comunidade-inova/guia/situacoes?s=${alvo.slug}`)
  })

  it('clicar num exemplo preenche a busca', async () => {
    const user = userEvent.setup()
    renderLayout()
    await user.click(screen.getByRole('button', { name: /buscar no guia/i }))
    await user.click(screen.getByRole('button', { name: 'Tenho uma planilha' }))
    expect(screen.getByRole('combobox')).toHaveValue('Tenho uma planilha')
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0)
  })
})
