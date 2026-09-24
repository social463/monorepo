import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyPromptButton } from './CopyPromptButton'
import * as analytics from '../../../../lib/analytics'

describe('CopyPromptButton', () => {
  beforeEach(() => {
    vi.spyOn(analytics, 'trackEvent').mockImplementation(() => {})
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  it('copia o texto e avisa que copiou', async () => {
    render(<CopyPromptButton text="conteúdo do prompt" promptId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: /copiar prompt/i }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('conteúdo do prompt')
    expect(analytics.trackEvent).toHaveBeenCalledWith('inova_guia_prompt_copiado', { promptId: 'p1' })
    expect(await screen.findByText(/prompt copiado/i)).toBeInTheDocument()
  })
})
