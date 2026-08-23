import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { RetroActionItemDTO } from '@legends/shared'
import { RetroActionsSection } from './RetroActionsSection'

vi.mock('../../lib/retro-api', () => ({
  toggleRetroAction: vi.fn(),
  updateRetroActionNote: vi.fn(),
  archiveRetroAction: vi.fn(),
  listArchivedRetroActions: vi.fn(),
}))

const { archiveRetroAction, listArchivedRetroActions } = await import('../../lib/retro-api')

function acao(over: Partial<RetroActionItemDTO> = {}): RetroActionItemDTO {
  return {
    id: 'a1',
    plan: 'Documentar deploy',
    problem: 'Daily foi cancelada sem aviso',
    note: null,
    dueDate: '2026-07-01',
    done: false,
    doneAt: null,
    archivedAt: null,
    sprint: 5,
    squad: 'Core',
    roomId: 'r1',
    auditStatus: null,
    ...over,
  }
}

function renderSection(props: Partial<Parameters<typeof RetroActionsSection>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RetroActionsSection actions={[acao()]} archivedCount={0} isOwnProfile profileId="u1" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('RetroActionsSection — arquivar', () => {
  /**
   * A lista não tem paginação e cresce a cada sprint; arquivar é o que segura o
   * tamanho dela. Mas só do que já foi concluído — em ação pendente o botão
   * seria um atalho para esconder a pendência.
   */
  it('oferece arquivar só na ação concluída', () => {
    renderSection({ actions: [acao({ id: 'a1', done: false }), acao({ id: 'a2', done: true })] })

    const botoes = screen.getAllByRole('button', { name: 'Arquivar' })
    expect(botoes).toHaveLength(1)
  })

  it('arquiva a ação concluída pela API', async () => {
    vi.mocked(archiveRetroAction).mockResolvedValue({ action: acao({ done: true, archivedAt: '2026-08-14T09:00:00.000Z' }) })
    renderSection({ actions: [acao({ done: true })] })

    await userEvent.click(screen.getByRole('button', { name: 'Arquivar' }))

    await waitFor(() => expect(archiveRetroAction).toHaveBeenCalledWith('a1', true))
  })

  /**
   * A mutation é uma só para a lista inteira: com `isPending` cru, arquivar uma
   * ação desabilitava e esmaecia o botão de TODAS as outras — que reagiam como
   * se também tivessem sido clicadas.
   */
  it('só o botão clicado reage enquanto a requisição está no ar', async () => {
    let liberar: (v: { action: RetroActionItemDTO }) => void = () => {}
    vi.mocked(archiveRetroAction).mockReturnValue(
      new Promise((resolve) => {
        liberar = resolve
      }),
    )
    renderSection({ actions: [acao({ id: 'a1', done: true }), acao({ id: 'a2', done: true })] })

    const [primeiro, segundo] = screen.getAllByRole('button', { name: 'Arquivar' })
    await userEvent.click(primeiro)

    await waitFor(() => expect(primeiro).toBeDisabled())
    expect(segundo).not.toBeDisabled()

    liberar({ action: acao({ id: 'a1', done: true, archivedAt: '2026-08-14T09:00:00.000Z' }) })
    await waitFor(() => expect(primeiro).not.toBeDisabled())
  })

  it('no perfil de outra pessoa não oferece arquivar', () => {
    renderSection({ actions: [acao({ done: true })], isOwnProfile: false, archivedCount: 3 })

    expect(screen.queryByRole('button', { name: 'Arquivar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /arquivadas/i })).not.toBeInTheDocument()
  })
})

describe('RetroActionsSection — arquivo', () => {
  it('sem nada arquivado, não oferece a gaveta', () => {
    renderSection({ archivedCount: 0 })

    expect(screen.queryByRole('button', { name: /arquivadas/i })).not.toBeInTheDocument()
  })

  it('abre o arquivo, lista o que saiu da tela e permite desarquivar', async () => {
    vi.mocked(listArchivedRetroActions).mockResolvedValue({
      actions: [acao({ id: 'a9', problem: 'Deploy sem checklist', done: true, archivedAt: '2026-08-10T09:00:00.000Z' })],
    })
    vi.mocked(archiveRetroAction).mockResolvedValue({ action: acao({ id: 'a9', done: true }) })
    renderSection({ archivedCount: 1 })

    await userEvent.click(screen.getByRole('button', { name: /Ações arquivadas \(1\)/ }))

    expect(await screen.findByText('Deploy sem checklist')).toBeInTheDocument()
    // A ação ativa sai de vista enquanto o arquivo está aberto.
    expect(screen.queryByText('Daily foi cancelada sem aviso')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Desarquivar' }))
    await waitFor(() => expect(archiveRetroAction).toHaveBeenCalledWith('a9', false))
  })

  it('só busca o arquivo quando a gaveta abre', () => {
    renderSection({ archivedCount: 2 })

    expect(listArchivedRetroActions).not.toHaveBeenCalled()
  })
})
