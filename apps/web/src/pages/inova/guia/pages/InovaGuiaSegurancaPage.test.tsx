import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InovaGuiaSegurancaPage } from './InovaGuiaSegurancaPage'
import * as analytics from '../../../../lib/analytics'

describe('InovaGuiaSegurancaPage', () => {
  it('mostra o título e dispara o evento de seção aberta', () => {
    const spy = vi.spyOn(analytics, 'trackEvent').mockImplementation(() => {})
    render(<InovaGuiaSegurancaPage />)
    expect(screen.getByText('Antes de compartilhar, confira')).toBeInTheDocument()
    expect(spy).toHaveBeenCalledWith('inova_guia_seguranca_aberta', {})
  })
})
