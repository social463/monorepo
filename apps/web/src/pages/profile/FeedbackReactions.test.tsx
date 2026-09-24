import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactionSummary } from '@legends/shared'
import { FeedbackReactions } from './FeedbackReactions'

const OPTIONS = ['❤️', '👏', '🎉'] as const

function reacao(overrides: Partial<ReactionSummary> = {}): ReactionSummary {
  return {
    emoji: '❤️',
    count: 4,
    reactedByMe: false,
    users: [
      { id: 'u1', name: 'Karina Akina Miyakazi' },
      { id: 'u2', name: 'Gabriel William Serrano' },
      { id: 'u3', name: 'Isabel Queiroz Silva' },
      { id: 'u4', name: 'Lucca Guedes Secco' },
    ],
    ...overrides,
  } as ReactionSummary
}

/**
 * O jsdom devolve zero em toda medida, então o teste precisa dizer onde a
 * pílula está. `left` é o que decide o lado do tooltip.
 */
function posicionarPilulaEm(left: number, width = 56) {
  vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left,
    width,
    right: left + width,
    top: 0,
    bottom: 0,
    height: 24,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
}

beforeEach(() => {
  // 1024px de largura, como uma janela estreita de verdade.
  vi.stubGlobal('innerWidth', 1024)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('FeedbackReactions — tooltip de quem reagiu', () => {
  it('lista os nomes de quem reagiu', () => {
    render(<FeedbackReactions reactions={[reacao()]} options={OPTIONS} onToggle={() => {}} />)

    expect(screen.getByRole('tooltip')).toHaveTextContent('Karina Akina Miyakazi')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Lucca Guedes Secco')
    expect(screen.getByRole('tooltip')).toHaveTextContent(/reagiram/)
  })

  it('diz "reagiu" no singular', () => {
    render(
      <FeedbackReactions
        reactions={[reacao({ count: 1, users: [{ id: 'u1', name: 'Ana' }] as ReactionSummary['users'] })]}
        options={OPTIONS}
        onToggle={() => {}}
      />,
    )
    expect(screen.getByRole('tooltip')).toHaveTextContent(/reagiu/)
  })

  // O bug: o tooltip nascia centrado na pílula e, numa reação encostada na
  // borda, metade dele saía da tela — os nomes apareciam cortados ao meio.
  it('encosta à esquerda quando não cabe centrado na borda esquerda', async () => {
    const user = userEvent.setup()
    posicionarPilulaEm(12)
    render(<FeedbackReactions reactions={[reacao()]} options={OPTIONS} onToggle={() => {}} />)

    await user.hover(screen.getByRole('button', { name: /4/ }))

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveClass('left-0')
    expect(tooltip).not.toHaveClass('-translate-x-1/2')
  })

  it('encosta à direita quando não cabe centrado na borda direita', async () => {
    const user = userEvent.setup()
    posicionarPilulaEm(1000)
    render(<FeedbackReactions reactions={[reacao()]} options={OPTIONS} onToggle={() => {}} />)

    await user.hover(screen.getByRole('button', { name: /4/ }))

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveClass('right-0')
    expect(tooltip).not.toHaveClass('-translate-x-1/2')
  })

  it('fica centrado quando há espaço dos dois lados', async () => {
    const user = userEvent.setup()
    posicionarPilulaEm(480)
    render(<FeedbackReactions reactions={[reacao()]} options={OPTIONS} onToggle={() => {}} />)

    await user.hover(screen.getByRole('button', { name: /4/ }))

    expect(screen.getByRole('tooltip')).toHaveClass('-translate-x-1/2')
  })

  // Quem navega por teclado tem o mesmo problema, e nunca dispara `mouseenter`.
  it('mede também no foco, não só no hover', async () => {
    const user = userEvent.setup()
    posicionarPilulaEm(12)
    render(<FeedbackReactions reactions={[reacao()]} options={OPTIONS} onToggle={() => {}} />)

    await user.tab()

    expect(screen.getByRole('button', { name: /4/ })).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveClass('left-0')
  })

  it('clicar na pílula alterna a reação', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<FeedbackReactions reactions={[reacao()]} options={OPTIONS} onToggle={onToggle} />)

    await user.click(screen.getByRole('button', { name: /4/ }))
    expect(onToggle).toHaveBeenCalledWith('❤️')
  })
})
