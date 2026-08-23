import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { MobileNav } from './MobileNav'
import type { NavGroup } from './nav-items'

const groups: NavGroup[] = [
  {
    items: [
      { to: '/time', label: 'Time', icon: 'groups', end: true },
      { to: '/votar', label: 'Votar', icon: 'how_to_vote', showOpenBadge: true },
    ],
  },
]

// Grupo com rótulo: o drawer recolhe tudo que não é da rota atual.
const groupedGroups: NavGroup[] = [
  { items: [{ to: '/', label: 'Home', icon: 'home', end: true }] },
  {
    label: 'Reconhecimento',
    items: [{ to: '/votar', label: 'Votar', icon: 'how_to_vote', showOpenBadge: true }],
  },
]

function renderNav(
  props: Partial<{
    groups: NavGroup[]
    activeTo: string
    votingOpen: boolean
    isAdmin: boolean
    onLogout: () => void
  }> = {},
) {
  return render(
    <MemoryRouter>
      <MobileNav
        groups={props.groups ?? groups}
        activeTo={props.activeTo ?? '/time'}
        votingOpen={props.votingOpen ?? false}
        isAdmin={props.isAdmin ?? false}
        onLogout={props.onLogout ?? vi.fn()}
      />
    </MemoryRouter>,
  )
}

describe('MobileNav', () => {
  it('mantém o drawer fechado até clicar no botão hamburguer', () => {
    renderNav()
    expect(screen.queryByRole('dialog', { name: /menu de navegação/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /abrir menu de navegação/i }))
    expect(screen.getByRole('dialog', { name: /menu de navegação/i })).toBeInTheDocument()
  })

  it('renderiza um link por item dentro do drawer', () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: /abrir menu de navegação/i }))
    const dialog = screen.getByRole('dialog', { name: /menu de navegação/i })
    expect(within(dialog).getByRole('link', { name: /time/i })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: /votar/i })).toBeInTheDocument()
  })

  it('marca o item ativo com aria-current', () => {
    renderNav({ activeTo: '/votar' })
    fireEvent.click(screen.getByRole('button', { name: /abrir menu de navegação/i }))
    const dialog = screen.getByRole('dialog', { name: /menu de navegação/i })
    expect(within(dialog).getByRole('link', { name: /votar/i })).toHaveAttribute('aria-current', 'page')
    expect(within(dialog).getByRole('link', { name: /time/i })).not.toHaveAttribute('aria-current')
  })

  it('mostra o selo "Aberta" no Votar só quando a votação está aberta', () => {
    const { rerender } = renderNav({ votingOpen: false })
    fireEvent.click(screen.getByRole('button', { name: /abrir menu de navegação/i }))
    expect(screen.queryByText(/aberta/i)).not.toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <MobileNav groups={groups} activeTo="/time" votingOpen isAdmin={false} onLogout={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/aberta/i)).toBeInTheDocument()
  })

  it('mostra o CTA da votação só para não-admin com votação aberta', () => {
    renderNav({ votingOpen: true, isAdmin: false })
    fireEvent.click(screen.getByRole('button', { name: /abrir menu de navegação/i }))
    expect(screen.getByRole('button', { name: /votar no destaque/i })).toBeInTheDocument()
  })

  it('aciona onLogout ao clicar em Sair', () => {
    const onLogout = vi.fn()
    renderNav({ onLogout })
    fireEvent.click(screen.getByRole('button', { name: /abrir menu de navegação/i }))
    fireEvent.click(screen.getByRole('button', { name: /sair/i }))
    expect(onLogout).toHaveBeenCalledOnce()
  })

  it('fecha o drawer ao clicar em Fechar menu', () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: /abrir menu de navegação/i }))
    fireEvent.click(screen.getByRole('button', { name: /fechar menu/i }))
    expect(screen.queryByRole('dialog', { name: /menu de navegação/i })).not.toBeInTheDocument()
  })

  it('mantém o grupo recolhido até clicar no cabeçalho', () => {
    renderNav({ groups: groupedGroups, activeTo: '/' })
    fireEvent.click(screen.getByRole('button', { name: /abrir menu de navegação/i }))
    const dialog = screen.getByRole('dialog', { name: /menu de navegação/i })

    expect(within(dialog).queryByRole('link', { name: /votar/i })).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /reconhecimento/i }))
    expect(within(dialog).getByRole('link', { name: /votar/i })).toBeInTheDocument()
  })

  it('abre o grupo da rota atual sem precisar de clique', () => {
    renderNav({ groups: groupedGroups, activeTo: '/votar' })
    fireEvent.click(screen.getByRole('button', { name: /abrir menu de navegação/i }))
    const dialog = screen.getByRole('dialog', { name: /menu de navegação/i })
    expect(within(dialog).getByRole('link', { name: /votar/i })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /reconhecimento/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })
})
