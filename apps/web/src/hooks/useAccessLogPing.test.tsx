import { act, render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { useAccessLogPing } from './useAccessLogPing'
import { apiFetch } from '../lib/api'

vi.mock('../lib/api', () => ({ apiFetch: vi.fn() }))
const mockApiFetch = apiFetch as unknown as Mock

function Probe({ enabled = true }: { enabled?: boolean }) {
  useAccessLogPing(enabled)
  // Um setState num efeito força um segundo render da MESMA rota: o ping não
  // pode disparar de novo por causa dele.
  const [, setTick] = useState(0)
  useEffect(() => {
    setTick(1)
  }, [])
  return <p>tela</p>
}

function Navigator() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate('/mural')}>
      ir para o mural
    </button>
  )
}

function loggedPaths(): string[] {
  return mockApiFetch.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string).path)
}

describe('useAccessLogPing', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
    mockApiFetch.mockResolvedValue(undefined)
  })

  it('grava exatamente um acesso por rota, mesmo com re-render da mesma tela', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/time']}>
        <Probe />
      </MemoryRouter>,
    )
    rerender(
      <MemoryRouter initialEntries={['/time']}>
        <Probe />
      </MemoryRouter>,
    )

    expect(loggedPaths()).toEqual(['/time'])
    expect(mockApiFetch).toHaveBeenCalledWith('/access-logs', {
      method: 'POST',
      body: JSON.stringify({ path: '/time' }),
    })
  })

  it('grava de novo ao trocar de rota', () => {
    const { getByText } = render(
      <MemoryRouter initialEntries={['/time']}>
        <Probe />
        <Routes>
          <Route path="*" element={<Navigator />} />
        </Routes>
      </MemoryRouter>,
    )

    act(() => getByText('ir para o mural').click())

    expect(loggedPaths()).toEqual(['/time', '/mural'])
  })

  it('não grava nada quando desabilitado (visitante sem usuário)', () => {
    render(
      <MemoryRouter initialEntries={['/escritorio']}>
        <Probe enabled={false} />
      </MemoryRouter>,
    )
    expect(mockApiFetch).not.toHaveBeenCalled()
  })

  it('falha de rede não estoura para a tela', () => {
    mockApiFetch.mockRejectedValue(new Error('offline'))
    expect(() =>
      render(
        <MemoryRouter initialEntries={['/time']}>
          <Probe />
        </MemoryRouter>,
      ),
    ).not.toThrow()
  })
})
