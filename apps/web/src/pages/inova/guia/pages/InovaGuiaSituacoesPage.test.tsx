import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InovaGuiaSituacoesPage } from './InovaGuiaSituacoesPage'
import { situations } from '../content/situations'
import * as analytics from '../../../../lib/analytics'

describe('InovaGuiaSituacoesPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.spyOn(analytics, 'trackEvent').mockImplementation(() => {})
  })

  it('lista as situações e filtra por busca', async () => {
    render(
      <MemoryRouter>
        <InovaGuiaSituacoesPage />
      </MemoryRouter>,
    )
    const primeira = situations[0]!
    expect(screen.getByText(primeira.title)).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/buscar situações/i), 'palavra-que-nao-existe-em-nenhuma-situacao')
    expect(screen.queryByText(primeira.title)).not.toBeInTheDocument()
    expect(screen.getByText(/não achamos essa situação/i)).toBeInTheDocument()
  })

  it('abre o detalhe e dispara o evento de analytics', async () => {
    render(
      <MemoryRouter>
        <InovaGuiaSituacoesPage />
      </MemoryRouter>,
    )
    const primeira = situations[0]!
    await userEvent.click(screen.getAllByRole('button', { name: /ver caminho/i })[0]!)

    expect(analytics.trackEvent).toHaveBeenCalledWith('inova_guia_situacao_aberta', { situacaoId: primeira.id })
    expect(screen.getByRole('heading', { name: primeira.title })).toBeInTheDocument()
  })

  it('abre a situação pelo ?s= da URL (link da busca global) e fecha com Esc', async () => {
    const alvo = situations[1]!
    render(
      <MemoryRouter initialEntries={[`/comunidade-inova/guia/situacoes?s=${alvo.slug}`]}>
        <InovaGuiaSituacoesPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('dialog', { name: alvo.title })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ignora slug desconhecido na URL', () => {
    render(
      <MemoryRouter initialEntries={['/comunidade-inova/guia/situacoes?s=nao-existe']}>
        <InovaGuiaSituacoesPage />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
