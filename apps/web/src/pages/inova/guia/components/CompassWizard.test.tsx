import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CompassWizard, decideCompassPath } from './CompassWizard'
import * as analytics from '../../../../lib/analytics'

describe('decideCompassPath', () => {
  it('decide "pessoa" quando a situação decide algo sobre alguém', () => {
    expect(decideCompassPath('decide', 'baixo', 'sim')).toBe('pessoa')
  })

  it('decide "ia" quando o impacto é baixo, não envolve pessoas e passa por revisão', () => {
    expect(decideCompassPath('nao', 'baixo', 'sim')).toBe('ia')
  })

  it('decide "ia-pessoa" quando não há revisão e o impacto não é alto', () => {
    expect(decideCompassPath('nao', 'baixo', 'nao')).toBe('ia-pessoa')
  })
})

describe('CompassWizard', () => {
  it('percorre as três perguntas e mostra o resultado, disparando o evento', async () => {
    vi.spyOn(analytics, 'trackEvent').mockImplementation(() => {})
    render(<CompassWizard />)

    await userEvent.click(screen.getByRole('button', { name: /não, é sobre conteúdo/i }))
    await userEvent.click(screen.getByRole('button', { name: /baixo/i }))
    await userEvent.click(screen.getByRole('button', { name: /sim, eu reviso e assino/i }))

    expect(await screen.findByRole('heading', { level: 3 })).toBeInTheDocument()
    expect(analytics.trackEvent).toHaveBeenCalledWith('inova_guia_bussola_completada', { caminho: 'ia' })
  })
})
