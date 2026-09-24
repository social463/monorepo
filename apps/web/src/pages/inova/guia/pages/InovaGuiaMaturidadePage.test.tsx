import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InovaGuiaMaturidadePage, levelFromScore } from './InovaGuiaMaturidadePage'
import { maturityQuestions } from '../content/library'
import * as analytics from '../../../../lib/analytics'

describe('levelFromScore', () => {
  it('calcula o nível 1 para a pontuação mínima', () => {
    expect(levelFromScore(maturityQuestions.length * 1)).toBe(1)
  })

  it('calcula o nível 5 para a pontuação máxima', () => {
    expect(levelFromScore(maturityQuestions.length * 5)).toBe(5)
  })
})

describe('InovaGuiaMaturidadePage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.spyOn(analytics, 'trackEvent').mockImplementation(() => {})
  })

  it('mostra o nível após responder as dez perguntas com nota máxima', async () => {
    render(
      <MemoryRouter>
        <InovaGuiaMaturidadePage />
      </MemoryRouter>,
    )

    for (let i = 0; i < maturityQuestions.length; i++) {
      const grupo = screen.getAllByRole('button', { name: 'Já faz parte da minha rotina' })
      await userEvent.click(grupo[i]!)
    }

    expect(await screen.findByText(/nível 5/i)).toBeInTheDocument()
    expect(analytics.trackEvent).toHaveBeenCalledWith('inova_guia_maturidade_respondida', { nivel: 5 })
    expect(analytics.trackEvent).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: /praticar agora/i })).toHaveAttribute('href', '/comunidade-inova/guia/na-pratica')

    const grupoFinal = screen.getAllByRole('button', { name: 'Já faz parte da minha rotina' })
    await userEvent.click(grupoFinal[0]!)

    expect(analytics.trackEvent).toHaveBeenCalledTimes(1)
  })
})
