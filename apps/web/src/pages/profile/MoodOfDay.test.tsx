import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MOOD_REASON_LABELS } from '@legends/shared'
import { MoodOfDay } from './MoodOfDay'
import * as api from '../../lib/api'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

// Os rótulos saem do contrato, e não copiados aqui: se a lista mudar de novo,
// o teste acompanha em vez de virar um segundo lugar para esquecer de atualizar.
const SOBRECARGA = MOOD_REASON_LABELS.WORKLOAD
const PROCESSOS = MOOD_REASON_LABELS.PROCESSES

/** Abre o select de motivo e escolhe uma opção pelo rótulo. */
function chooseReason(label: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Motivo' }))
  fireEvent.click(screen.getByRole('option', { name: label }))
}

describe('MoodOfDay', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('pergunta o humor com as carinhas quando ainda não respondeu', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ day: '2026-06-22', mood: null, note: null } as never)
    wrap(<MoodOfDay />)
    expect(await screen.findByText(/como está seu humor hoje/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Excelente' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Estressado(a)' })).toBeInTheDocument()
  })

  // O documento pede o nome junto do ícone: só a carinha deixa "😟" e "😐"
  // à interpretação de quem olha.
  it('mostra o nome de cada humor, sem depender de hover', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ day: '2026-06-22', mood: null, note: null } as never)
    wrap(<MoodOfDay />)
    await screen.findByText(/como está seu humor hoje/i)
    for (const label of ['Estressado(a)', 'Desanimado(a)', 'Neutro(a)', 'Bem', 'Excelente']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  // Some de vez deixava um buraco na linha do topo da Home, com a faixa de
  // boas-vindas sozinha e desproporcional.
  it('quem já respondeu vê a confirmação, não um espaço vazio', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ day: '2026-06-22', mood: 'GOOD', note: 'dia tranquilo' } as never)
    wrap(<MoodOfDay />)
    expect(await screen.findByText(/humor de hoje registrado/i)).toBeInTheDocument()
    expect(screen.getByText('Bem')).toBeInTheDocument()
    expect(screen.getByText(/dia tranquilo/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excelente' })).not.toBeInTheDocument()
  })

  // Vale a PRIMEIRA resposta do dia: poder trocar depois convida a corrigir o
  // próprio humor para o que parece aceitável.
  it('não oferece alterar o humor já registrado', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ day: '2026-06-22', mood: 'GOOD', note: null } as never)
    wrap(<MoodOfDay />)
    await screen.findByText(/humor de hoje registrado/i)
    expect(screen.queryByRole('button', { name: /alterar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /registrar/i })).not.toBeInTheDocument()
  })

  // Motivo e comentário sem uma escolha de humor são campos sem contexto.
  it('só abre o painel de resposta depois de escolher um humor', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ day: '2026-06-22', mood: null, note: null } as never)
    wrap(<MoodOfDay />)
    await screen.findByText(/como está seu humor hoje/i)
    expect(screen.queryByRole('button', { name: /registrar/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/comentário/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Excelente' }))
    expect(screen.getByRole('button', { name: /registrar/i })).toBeEnabled()
    expect(screen.getByLabelText(/comentário/i)).toBeInTheDocument()
  })

  it('Cancelar fecha o painel e limpa a escolha', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ day: '2026-06-22', mood: null, note: null } as never)
    wrap(<MoodOfDay />)
    fireEvent.click(await screen.findByRole('button', { name: 'Excelente' }))
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(screen.queryByRole('button', { name: /registrar/i })).not.toBeInTheDocument()
  })

  it('escolher humor + comentário dispara o PUT com mood e note, e a seção some', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (opts?.method === 'PUT') return { day: '2026-06-22', mood: 'GREAT', note: 'tudo certo' } as never
      return { day: '2026-06-22', mood: null, note: null } as never
    })
    wrap(<MoodOfDay />)
    fireEvent.click(await screen.findByRole('button', { name: 'Excelente' }))
    fireEvent.change(screen.getByLabelText(/comentário/i), { target: { value: 'tudo certo' } })
    fireEvent.click(screen.getByRole('button', { name: /registrar/i }))
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/me/mood/today', {
        method: 'PUT',
        body: JSON.stringify({ mood: 'GREAT', note: 'tudo certo', reason: null }),
      }),
    )
    await waitFor(() => expect(screen.queryByText(/como está seu humor hoje/i)).not.toBeInTheDocument())
  })

  it('registra sem comentário quando a caixa está vazia (note omitido no corpo)', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (opts?.method === 'PUT') return { day: '2026-06-22', mood: 'GREAT', note: null } as never
      return { day: '2026-06-22', mood: null, note: null } as never
    })
    wrap(<MoodOfDay />)
    fireEvent.click(await screen.findByRole('button', { name: 'Excelente' }))
    fireEvent.click(screen.getByRole('button', { name: /registrar/i }))
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/me/mood/today', {
        method: 'PUT',
        body: JSON.stringify({ mood: 'GREAT', reason: null }),
      }),
    )
  })

  it('o motivo só é pedido nos humores negativos', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ day: '2026-06-22', mood: null, note: null, reason: null } as never)
    wrap(<MoodOfDay />)
    fireEvent.click(await screen.findByRole('button', { name: 'Excelente' }))
    expect(screen.queryByRole('combobox', { name: 'Motivo' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Estressado(a)' }))
    expect(screen.getByRole('combobox', { name: 'Motivo' })).toBeInTheDocument()
  })

  // Os dois motivos que saíram da lista continuam no enum para o painel de
  // clima ler o passado — mas não podem ser oferecidos de novo.
  it('não oferece os motivos legados', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ day: '2026-06-22', mood: null, note: null, reason: null } as never)
    wrap(<MoodOfDay />)
    fireEvent.click(await screen.findByRole('button', { name: 'Estressado(a)' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Motivo' }))

    expect(screen.getByRole('option', { name: SOBRECARGA })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: MOOD_REASON_LABELS.RECOGNITION })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: MOOD_REASON_LABELS.TEAM })).not.toBeInTheDocument()
  })

  it('envia o motivo escolhido junto com o humor negativo', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (opts?.method === 'PUT') return { day: '2026-06-22', mood: 'LOW', note: null, reason: 'WORKLOAD' } as never
      return { day: '2026-06-22', mood: null, note: null, reason: null } as never
    })
    wrap(<MoodOfDay />)
    fireEvent.click(await screen.findByRole('button', { name: 'Desanimado(a)' }))
    chooseReason(SOBRECARGA)
    fireEvent.click(screen.getByRole('button', { name: /registrar/i }))
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/me/mood/today', {
        method: 'PUT',
        body: JSON.stringify({ mood: 'LOW', reason: 'WORKLOAD' }),
      }),
    )
  })

  it('humor negativo não registra enquanto não houver motivo', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockResolvedValue({ day: '2026-06-22', mood: null, note: null, reason: null } as never)
    wrap(<MoodOfDay />)
    fireEvent.click(await screen.findByRole('button', { name: 'Desanimado(a)' }))
    const registrar = screen.getByRole('button', { name: /registrar/i })
    expect(registrar).toBeDisabled()

    fireEvent.click(registrar)
    expect(spy).not.toHaveBeenCalledWith('/me/mood/today', expect.objectContaining({ method: 'PUT' }))

    chooseReason(PROCESSOS)
    expect(screen.getByRole('button', { name: /registrar/i })).toBeEnabled()
  })

  it('trocar de humor negativo para positivo descarta o motivo já escolhido', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (opts?.method === 'PUT') return { day: '2026-06-22', mood: 'GREAT', note: null, reason: null } as never
      return { day: '2026-06-22', mood: null, note: null, reason: null } as never
    })
    wrap(<MoodOfDay />)
    fireEvent.click(await screen.findByRole('button', { name: 'Estressado(a)' }))
    chooseReason(PROCESSOS)
    fireEvent.click(screen.getByRole('button', { name: 'Excelente' }))
    fireEvent.click(screen.getByRole('button', { name: /registrar/i }))
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/me/mood/today', {
        method: 'PUT',
        body: JSON.stringify({ mood: 'GREAT', reason: null }),
      }),
    )
  })
})
