import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScrollToTopButton } from './ScrollToTopButton'

/** jsdom não rola de verdade: mexemos em scrollY e disparamos o evento. */
function rolarPara(y: number) {
  act(() => {
    Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true })
    window.dispatchEvent(new Event('scroll'))
  })
}

beforeEach(() => {
  Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true })
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ScrollToTopButton', () => {
  it('fica escondido enquanto a rolagem é pequena', () => {
    render(<ScrollToTopButton />)
    expect(screen.queryByRole('button', { name: 'Voltar ao topo' })).not.toBeInTheDocument()

    rolarPara(200)
    expect(screen.queryByRole('button', { name: 'Voltar ao topo' })).not.toBeInTheDocument()
  })

  it('aparece depois de rolar bastante e some ao voltar', () => {
    render(<ScrollToTopButton />)

    rolarPara(900)
    expect(screen.getByRole('button', { name: 'Voltar ao topo' })).toBeInTheDocument()

    rolarPara(0)
    expect(screen.queryByRole('button', { name: 'Voltar ao topo' })).not.toBeInTheDocument()
  })

  it('já nasce visível se a rota abriu com a página rolada', () => {
    Object.defineProperty(window, 'scrollY', { value: 1200, writable: true, configurable: true })
    render(<ScrollToTopButton />)
    expect(screen.getByRole('button', { name: 'Voltar ao topo' })).toBeInTheDocument()
  })

  it('sobe suavemente ao clicar', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
    render(<ScrollToTopButton />)
    rolarPara(900)

    await userEvent.click(screen.getByRole('button', { name: 'Voltar ao topo' }))

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('respeita quem pediu menos animação no sistema', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
    render(<ScrollToTopButton />)
    rolarPara(900)

    await userEvent.click(screen.getByRole('button', { name: 'Voltar ao topo' }))

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
  })

  it('remove o listener ao desmontar', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<ScrollToTopButton />)
    unmount()
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
  })
})
