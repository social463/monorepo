import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { MAX_FEATURED_BADGES } from '@legends/shared'
import type { AwardedBadgeDTO } from '@legends/shared'
import { BadgeGallery } from './BadgeGallery'

const badges: AwardedBadgeDTO[] = [
  {
    id: 'ub1',
    awardedAt: '2026-06-01T00:00:00.000Z',
    source: 'AUTO',
    awardedBy: null,
    featured: false,
    badge: { id: 'b1', slug: 'conector', name: 'Conector do Time', description: 'd', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao', global: true, sectorIds: [] },
  },
  {
    id: 'ub2',
    awardedAt: '2026-06-02T00:00:00.000Z',
    source: 'AUTO',
    awardedBy: null,
    featured: false,
    badge: { id: 'b2', slug: 'incansavel', name: 'Incansável', description: 'd', kind: 'IMPACT', iconKey: 'fire', threshold: 0, categorySlug: null, global: true, sectorIds: [] },
  },
]

function makeBadges(count: number): AwardedBadgeDTO[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `u${i}`,
    awardedAt: '2026-06-01T00:00:00.000Z',
    source: 'AUTO',
    awardedBy: null,
    featured: false,
    badge: {
      id: `b${i}`,
      slug: `s${i}`,
      name: `Selo ${i}`,
      description: 'd',
      kind: 'IMPACT',
      iconKey: 'fire',
      threshold: 0,
      categorySlug: null,
      global: true,
      sectorIds: [],
    },
  }))
}

function wrap(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('BadgeGallery', () => {
  it('renderiza os selos', () => {
    wrap(<BadgeGallery badges={badges} emptyLabel="vazio" />)
    expect(screen.getAllByText('Conector do Time').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Incansável').length).toBeGreaterThan(0)
  })

  it('mostra descrição curta do selo no tooltip', () => {
    const streakBadge: AwardedBadgeDTO = {
      id: 'ub-streak',
      awardedAt: '2026-07-10T00:00:00.000Z',
      source: 'AUTO',
      awardedBy: null,
      featured: false,
      badge: {
        id: 'b-streak',
        slug: 'ofensiva-14-dias-uteis',
        name: 'Imparável',
        description: 'Seu recorde de ofensiva atingiu 14 dias úteis consecutivos.',
        kind: 'STREAK',
        iconKey: 'fe-voltage',
        threshold: 14,
        categorySlug: null,
        global: true,
        sectorIds: [],
      },
    }
    wrap(<BadgeGallery badges={[streakBadge]} emptyLabel="vazio" />)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Imparável')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Strike de 14 dias úteis')
  })

  it('mostra o estado vazio', () => {
    wrap(<BadgeGallery badges={[]} emptyLabel="Nenhum selo ainda." />)
    expect(screen.getByText('Nenhum selo ainda.')).toBeInTheDocument()
  })

  it('destaca o selo indicado por highlightId (deep-link do mural)', () => {
    wrap(<BadgeGallery badges={badges} emptyLabel="vazio" highlightId="ub2" />)
    expect(document.getElementById('badge-ub2')).toHaveClass('mural-highlight')
    expect(document.getElementById('badge-ub1')).not.toHaveClass('mural-highlight')
  })

  it('não mostra edição quando não é editável', () => {
    wrap(<BadgeGallery badges={badges} emptyLabel="vazio" />)
    expect(screen.queryByRole('button', { name: /escolher destaques/i })).not.toBeInTheDocument()
  })

  it('não exibe mais o link "Ver todos" (catálogo agora vive na sidebar)', () => {
    wrap(<BadgeGallery badges={badges} emptyLabel="vazio" editable onSaveFeatured={vi.fn()} />)
    expect(screen.queryByRole('link', { name: /ver todos/i })).not.toBeInTheDocument()
  })

  it('mostra só 6 selos inicialmente e expande com Mostrar mais', async () => {
    wrap(<BadgeGallery badges={makeBadges(8)} emptyLabel="vazio" />)

    expect(screen.getAllByText('Selo 5').length).toBeGreaterThan(0)
    expect(screen.queryByText('Selo 6')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /mostrar mais 2/i }))

    expect(screen.getAllByText('Selo 6').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Selo 7').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /mostrar menos/i })).toBeInTheDocument()
  })

  it('não limita a lista enquanto escolhe destaques', async () => {
    wrap(<BadgeGallery badges={makeBadges(8)} emptyLabel="vazio" editable onSaveFeatured={vi.fn()} />)

    expect(screen.queryByText('Selo 6')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /escolher destaques/i }))

    expect(screen.getByRole('button', { name: /Selo 6/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mostrar mais/i })).not.toBeInTheDocument()
  })

  it('salva os ids dos selos selecionados', async () => {
    const onSaveFeatured = vi.fn().mockResolvedValue(undefined)
    wrap(<BadgeGallery badges={badges} emptyLabel="vazio" editable onSaveFeatured={onSaveFeatured} />)

    await userEvent.click(screen.getByRole('button', { name: /escolher destaques/i }))
    await userEvent.click(screen.getByRole('button', { name: /Conector do Time/i }))
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }))

    expect(onSaveFeatured).toHaveBeenCalledWith(['ub1'])
  })

  it('limita a seleção a MAX_FEATURED_BADGES', async () => {
    const many = makeBadges(MAX_FEATURED_BADGES + 1)
    wrap(<BadgeGallery badges={many} emptyLabel="vazio" editable onSaveFeatured={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /escolher destaques/i }))
    for (let i = 0; i < MAX_FEATURED_BADGES; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: new RegExp(`Selo ${i}`, 'i') }))
    }
    // o item no índice MAX_FEATURED_BADGES deve estar desabilitado (limite atingido)
    expect(screen.getByRole('button', { name: new RegExp(`Selo ${MAX_FEATURED_BADGES}`, 'i') })).toBeDisabled()
  })
})
