import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { MeetingForm, EMPTY_MEETING_FORM } from './MeetingForm'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('MeetingForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/office/rooms')) {
        return Promise.resolve({
          rooms: [
            { externalKey: 'sala-1', name: 'Sala 1', capacity: 6, status: 'OPEN', voiceEnabled: true },
            { externalKey: 'sala-2', name: 'Sala 2', capacity: null, status: 'OPEN', voiceEnabled: false },
          ],
        })
      }
      return Promise.resolve({ users: [] })
    })
  })

  it('não mostra o campo de sala quando a sala é fixa', async () => {
    wrap(
      <MeetingForm
        initialValues={{ ...EMPTY_MEETING_FORM, roomExternalKey: 'sala-1' }}
        roomFixed
        submitLabel="Marcar"
        pending={false}
        youId="u1"
        onDirty={() => {}}
        onSubmit={() => {}}
      />,
    )
    expect(screen.queryByLabelText(/sala/i)).not.toBeInTheDocument()
  })

  it('mostra o seletor de sala quando a sala é escolhida no formulário', async () => {
    wrap(
      <MeetingForm
        initialValues={EMPTY_MEETING_FORM}
        submitLabel="Marcar"
        pending={false}
        youId="u1"
        onDirty={() => {}}
        onSubmit={() => {}}
      />,
    )
    expect(await screen.findByLabelText(/sala/i)).toBeInTheDocument()
  })

  it('envia a sala escolhida junto com os demais campos', async () => {
    const onSubmit = vi.fn()
    wrap(
      <MeetingForm
        initialValues={EMPTY_MEETING_FORM}
        submitLabel="Marcar"
        pending={false}
        youId="u1"
        onDirty={() => {}}
        onSubmit={onSubmit}
      />,
    )
    await userEvent.click(await screen.findByLabelText(/sala/i))
    await userEvent.click(await screen.findByRole('option', { name: /sala 2/i }))
    await userEvent.type(screen.getByLabelText(/título/i), 'Planning')
    await userEvent.type(screen.getByLabelText(/data e hora/i), '2026-08-11T14:00')
    await userEvent.click(screen.getByRole('button', { name: 'Marcar' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ roomExternalKey: 'sala-2', title: 'Planning' }))
  })

  it('não deixa enviar sem sala escolhida', async () => {
    const onSubmit = vi.fn()
    wrap(
      <MeetingForm
        initialValues={EMPTY_MEETING_FORM}
        submitLabel="Marcar"
        pending={false}
        youId="u1"
        onDirty={() => {}}
        onSubmit={onSubmit}
      />,
    )
    await userEvent.type(await screen.findByLabelText(/título/i), 'Planning')
    await userEvent.type(screen.getByLabelText(/data e hora/i), '2026-08-11T14:00')
    await userEvent.click(screen.getByRole('button', { name: 'Marcar' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
