import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InovaGuiaLiderancaPage } from './InovaGuiaLiderancaPage'
import * as analytics from '../../../../lib/analytics'

describe('InovaGuiaLiderancaPage', () => {
  it('mostra o título e dispara o evento de seção aberta', () => {
    const spy = vi.spyOn(analytics, 'trackEvent').mockImplementation(() => {})
    render(<InovaGuiaLiderancaPage />)
    expect(screen.getByText('A transformação começa pelo exemplo')).toBeInTheDocument()
    expect(spy).toHaveBeenCalledWith('inova_guia_lideranca_aberta', {})
  })
})
