import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SquadMoodPanel } from './SquadMoodPanel'
import * as api from '../../lib/api'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const squadsPayload = {
  squads: [
    {
      squadId: 'manager:u-lider',
      squadName: 'Meu time',
      members: [
        {
          id: 'u-ana', name: 'Ana', photoUrl: null,
          avatarStyle: null, avatarSeed: null, avatarOptions: null,
          currentMood: { day: '2026-06-22', mood: 'GREAT', note: null },
        },
        {
          id: 'u-bob', name: 'Bob', photoUrl: null,
          avatarStyle: null, avatarSeed: null, avatarOptions: null,
          currentMood: null,
        },
      ],
    },
  ],
}

beforeEach(() => vi.restoreAllMocks())

describe('SquadMoodPanel', () => {
  it('mostra os liderados e o humor atual de cada um', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue(squadsPayload as never)
    wrap(<SquadMoodPanel />)
    expect(await screen.findByText('Humor do time')).toBeInTheDocument()
    // Grupo único não ganha subtítulo: "Meu time" repetiria o título do painel.
    expect(screen.queryByText('Meu time')).not.toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText(/Sem registro/i)).toBeInTheDocument()
  })

  it('expandir um membro busca e lista o histórico com a nota', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/me/led-squads/moods')) return squadsPayload as never
      if (path.startsWith('/users/u-ana/mood-history')) {
        return {
          entries: [
            { day: '2026-06-22', mood: 'GREAT', note: 'semana ótima' },
            { day: '2026-06-21', mood: 'GOOD', note: null },
          ],
          nextCursor: null,
        } as never
      }
      throw new Error(`unexpected ${path}`)
    })
    wrap(<SquadMoodPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Ana/ }))
    expect(await screen.findByText('semana ótima')).toBeInTheDocument()
  })

  it('não renderiza nada quando não há squads lideradas', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ squads: [] } as never)
    const { container } = wrap(<SquadMoodPanel />)
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
