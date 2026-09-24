import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import type { UpsertCalendarEventRequest } from '@legends/shared'
import { CalendarEventForm, EMPTY_CALENDAR_EVENT } from './CalendarEventForm'
import { apiFetch } from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

const TIPO = { id: 't1', name: 'Provas B2B', slug: 'provas', icon: 'quiz', color: '#6366f1' }

function pessoa(id: string, name: string) {
  return {
    id,
    name,
    email: `${id}@x.com`,
    position: 'Analista',
    squad: null,
    sectorName: 'Ensino',
    photoUrl: null,
    avatarStyle: null,
    avatarSeed: null,
    avatarOptions: null,
  }
}

/** O formulário é controlado; o harness segura o estado, como as telas reais. */
function Harness({ inicial, onSubmit }: { inicial?: Partial<UpsertCalendarEventRequest>; onSubmit: Mock }) {
  const [value, setValue] = useState<UpsertCalendarEventRequest>({
    ...EMPTY_CALENDAR_EVENT,
    typeId: TIPO.id,
    title: 'Prova Inspirali',
    date: '2026-09-10',
    ...inicial,
  })
  return (
    <CalendarEventForm
      value={value}
      types={[TIPO]}
      sectors={[]}
      pending={false}
      onChange={setValue}
      onCancel={() => {}}
      onSubmit={onSubmit}
    />
  )
}

function renderForm(inicial?: Partial<UpsertCalendarEventRequest>) {
  const onSubmit = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <Harness inicial={inicial} onSubmit={onSubmit} />
    </QueryClientProvider>,
  )
  return onSubmit
}

describe('CalendarEventForm — convidados (Documento 3, seção 11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiFetch.mockResolvedValue({ users: [pessoa('u1', 'Ana Souza'), pessoa('u2', 'Bruno Lima')] })
  })

  it('escolher uma pessoa manda o id no payload', async () => {
    const onSubmit = renderForm()

    await userEvent.click(screen.getByPlaceholderText('Procurar pessoa na empresa…'))
    await userEvent.click(await screen.findByText('Ana Souza'))

    // O chip aparece com o nome — resolvido da lista da empresa, não de estado
    // duplicado no formulário.
    expect(await screen.findByRole('button', { name: /Remover Ana Souza/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /salvar|cadastrar|criar/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].guestIds).toEqual(['u1'])
  })

  it('remover o chip tira o id do payload', async () => {
    const onSubmit = renderForm({ guestIds: ['u1', 'u2'] })

    await userEvent.click(await screen.findByRole('button', { name: /Remover Ana Souza/i }))

    await userEvent.click(screen.getByRole('button', { name: /salvar|cadastrar|criar/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].guestIds).toEqual(['u2'])
  })

  it('convive com o público-alvo por tag — os dois no mesmo evento', async () => {
    const onSubmit = renderForm({ guestIds: ['u1'], audienceTags: ['Líder'] })

    await userEvent.click(screen.getByRole('button', { name: /salvar|cadastrar|criar/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const enviado = onSubmit.mock.calls[0][0]
    expect(enviado.guestIds).toEqual(['u1'])
    expect(enviado.audienceTags).toEqual(['Líder'])
  })
})
