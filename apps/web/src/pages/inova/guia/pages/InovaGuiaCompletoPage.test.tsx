import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { InovaGuiaCompletoPage } from './InovaGuiaCompletoPage'
import { faqs } from '../content/faqs'

describe('InovaGuiaCompletoPage', () => {
  it('mostra a primeira pergunta fechada e abre ao clicar', async () => {
    render(
      <MemoryRouter>
        <InovaGuiaCompletoPage />
      </MemoryRouter>,
    )
    const primeira = faqs[0]!
    expect(screen.getByText(primeira.question)).toBeInTheDocument()
    expect(screen.queryByText(primeira.answer[0]!)).not.toBeInTheDocument()

    await userEvent.click(screen.getByText(primeira.question))
    expect(screen.getByText(primeira.answer[0]!)).toBeInTheDocument()
  })

  it('abre a pergunta do ?faq= (busca global)', () => {
    const alvo = faqs[faqs.length - 1]!
    render(
      <MemoryRouter initialEntries={[`/comunidade-inova/guia/completo?faq=${alvo.id}`]}>
        <InovaGuiaCompletoPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(alvo.answer[0]!)).toBeInTheDocument()
    expect(screen.getByText(alvo.question).closest('button')).toHaveAttribute('aria-expanded', 'true')
  })
})
