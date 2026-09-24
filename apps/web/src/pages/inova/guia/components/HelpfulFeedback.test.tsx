import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { HelpfulFeedback } from './HelpfulFeedback'

describe('HelpfulFeedback', () => {
  it('pergunta se ajudou e mostra agradecimento após responder', async () => {
    render(<HelpfulFeedback contentId="c1" contentType="situacao" />)
    expect(screen.getByText('Isso ajudou?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /sim/i }))
    expect(screen.getByText(/obrigado/i)).toBeInTheDocument()
  })
})
