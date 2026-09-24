import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { BrandScheme } from '@legends/shared'
import { toRgbChannels } from '@legends/shared/color'
import { EuAprendizLayout } from './EuAprendizLayout'
import { APPRENTICE_PROGRAM_PALETTES } from './program-theme'

const brand = vi.hoisted(() => ({ scheme: 'light' as BrandScheme }))

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('./use-apprentice-facilitator', () => ({ useApprenticeFacilitator: () => false }))
vi.mock('../../brand/BrandContext', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../brand/BrandContext')>()
  // O contexto de verdade (sem provider, é a marca do produto), só com o
  // esquema trocado: o `BrandName` do cabeçalho lê a marca pelo mesmo hook.
  return { ...original, useBrandContext: () => ({ ...original.useBrandContext(), scheme: brand.scheme }) }
})

function programContainer(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Navegação do Eu Aprendiz' }).parentElement!
}

describe('EuAprendizLayout', () => {
  it.each(['light', 'dark'] as const)('veste as cores do programa no esquema %s escolhido pela pessoa', (scheme) => {
    brand.scheme = scheme
    render(
      <MemoryRouter>
        <EuAprendizLayout />
      </MemoryRouter>,
    )

    const style = programContainer().style
    const palette = APPRENTICE_PROGRAM_PALETTES[scheme]
    expect(style.getPropertyValue('--brand-surface')).toBe(toRgbChannels(palette.surface))
    expect(style.getPropertyValue('--brand-on-surface')).toBe(toRgbChannels(palette['on-surface']))
    expect(style.colorScheme).toBe(scheme)
  })
})
