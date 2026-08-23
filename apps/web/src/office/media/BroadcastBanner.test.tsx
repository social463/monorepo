import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BroadcastBanner } from './BroadcastBanner'

describe('BroadcastBanner', () => {
  it('usa top-4', () => {
    render(<BroadcastBanner speakers={['Ana']} />)
    expect(screen.getByRole('status')).toHaveClass('top-4')
  })

  it('sem speakers, não renderiza nada visível', () => {
    const { container } = render(<BroadcastBanner speakers={[]} />)
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
})
