import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  createEmptyMapDocumentV1,
  type OfficeDeskDTO,
  type OfficeDeskReminderSummaryDTO,
  type OfficeOccupant,
} from '@legends/shared'
import { OfficeBridge } from './OfficeBridge'

const beepMock = vi.fn()
vi.mock('../lib/beep', () => ({ playCallBeep: () => beepMock() }))

const apiFetchMock = vi.fn()
vi.mock('../lib/api', () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }))

import { useOfficeInteractions as useOfficeInteractionsRuntime } from './useOfficeInteractions'

const testDocument = createEmptyMapDocumentV1({ width: 25, height: 18, tileSize: 32 })
/** Literais estáveis: array novo a cada render dispara o efeito de espelho (ver `sameDesks`). */
const noDesks: OfficeDeskDTO[] = []
const noDeskReminders: OfficeDeskReminderSummaryDTO[] = []

function useOfficeInteractions(
  bridge: OfficeBridge,
  occupants: OfficeOccupant[],
  youId: string | null,
) {
  return useOfficeInteractionsRuntime(bridge, occupants, youId, testDocument)
}

function occ(userId: string, x = 5, y = 5): OfficeOccupant {
  return {
    userId,
    name: userId,
    x,
    y,
    dir: 'down',
    avatarSeed: null,
    avatarOptions: null,
  }
}

// useOfficeInteractions usa useQuery internamente (showcase) — precisa de um
// QueryClientProvider no ar, no mesmo padrão de `use-gifs.test.tsx`.
function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const showcase = {
  entries: [
    { user: { id: 'bruno', name: 'Bruno', position: 'Dev', leftAt: null }, feedbacksReceived: 3, badges: [] },
  ],
}

beforeEach(() => {
  // shouldAdvanceTime: sem isso, o `waitFor` do testing-library (que faz polling
  // via setInterval real) nunca observa o relógio falso avançar e trava até o
  // timeout.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  beepMock.mockClear()
  apiFetchMock.mockReset().mockResolvedValue(showcase)
})
afterEach(() => vi.useRealTimers())

describe('useOfficeInteractions', () => {
  it('expõe a lista viva de mesas: desk-claimed marca o dono', async () => {
    const bridge = new OfficeBridge()
    const desks = [{ id: 'd1', name: 'Nova mesa', externalKey: 'mesa-1', claimedBy: null }]
    const { result } = renderHook(
      () => useOfficeInteractionsRuntime(bridge, [occ('you')], 'you', testDocument, desks),
      { wrapper },
    )

    act(() =>
      bridge.emitServerMessage({
        type: 'desk-claimed',
        deskId: 'd1',
        externalKey: 'mesa-1',
        user: { id: 'ana', name: 'Ana' },
      }),
    )
    await waitFor(() => expect(result.current.desks[0]?.claimedBy?.name).toBe('Ana'))

    act(() => bridge.emitServerMessage({ type: 'desk-released', deskId: 'd1', externalKey: 'mesa-1' }))
    await waitFor(() => expect(result.current.desks[0]?.claimedBy).toBeNull())
  })

  it('mantém presentes de lembrete pendentes por websocket e clique', async () => {
    const bridge = new OfficeBridge()
    const reminder = {
      id: 'r1',
      deskId: 'd1',
      deskExternalKey: 'mesa-1',
      giftPosition: { x: 0.5, y: 0.25 },
      sender: { id: 'ana', name: 'Ana' },
      recipientId: 'you',
      createdAt: new Date(0).toISOString(),
    }
    const { result } = renderHook(
      () => useOfficeInteractionsRuntime(bridge, [occ('you')], 'you', testDocument, noDesks, noDeskReminders),
      { wrapper },
    )

    act(() => bridge.emitServerMessage({ type: 'desk-reminder-created', reminder }))
    await waitFor(() => expect(result.current.deskReminders).toEqual([reminder]))

    act(() => bridge.emitDeskReminderClick('r1'))
    await waitFor(() => expect(result.current.selectedDeskReminder?.id).toBe('r1'))

    act(() => bridge.emitServerMessage({
      type: 'desk-reminder-read',
      reminderId: 'r1',
      deskId: 'd1',
      deskExternalKey: 'mesa-1',
      senderId: 'ana',
      recipientId: 'you',
    }))
    await waitFor(() => expect(result.current.deskReminders).toEqual([]))
  })

  it('clique no personagem abre o card com a entry do showcase', async () => {
    const bridge = new OfficeBridge()
    const occupants = [occ('you', 3, 4), occ('bruno', 8, 4)]
    const { result } = renderHook(() => useOfficeInteractions(bridge, occupants, 'you'), { wrapper })

    act(() => bridge.emitCharacterClick('bruno'))
    await waitFor(() => expect(result.current.selected?.userId).toBe('bruno'))
    await waitFor(() => expect(result.current.selectedEntry?.user.name).toBe('Bruno'))
  })

  it('card do próprio usuário: sem entry problem, isSelf detectável por youId', async () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'), { wrapper })
    act(() => bridge.emitCharacterClick('you'))
    await waitFor(() => expect(result.current.selected?.userId).toBe('you'))
  })

  it('chamar envia a mensagem de call pelo canal do bridge', async () => {
    const bridge = new OfficeBridge()
    const sent: unknown[] = []
    bridge.onClientMessage((m) => sent.push(m))
    const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you'), occ('bruno')], 'you'), { wrapper })
    act(() => result.current.call('bruno'))
    expect(sent).toContainEqual({ type: 'call', targetUserId: 'bruno' })
  })

  it('incoming-call abre o popup e toca o beep; aceitar responde accepted=true', async () => {
    const bridge = new OfficeBridge()
    const sent: unknown[] = []
    bridge.onClientMessage((m) => sent.push(m))
    const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'), { wrapper })

    act(() => bridge.emitServerMessage({ type: 'incoming-call', from: { userId: 'ana', name: 'Ana' } }))
    await waitFor(() => expect(result.current.incomingCall?.name).toBe('Ana'))
    expect(beepMock).toHaveBeenCalled()

    act(() => result.current.acceptCall())
    expect(sent).toContainEqual({ type: 'call-response', callerId: 'ana', accepted: true })
    expect(result.current.incomingCall).toBeNull()
  })

  it('recusar responde accepted=false', async () => {
    const bridge = new OfficeBridge()
    const sent: unknown[] = []
    bridge.onClientMessage((m) => sent.push(m))
    const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'), { wrapper })
    act(() => bridge.emitServerMessage({ type: 'incoming-call', from: { userId: 'ana', name: 'Ana' } }))
    await waitFor(() => expect(result.current.incomingCall).not.toBeNull())
    act(() => result.current.refuseCall())
    expect(sent).toContainEqual({ type: 'call-response', callerId: 'ana', accepted: false })
  })

  it('sem resposta em 30s → auto-recusa', async () => {
    const bridge = new OfficeBridge()
    const sent: unknown[] = []
    bridge.onClientMessage((m) => sent.push(m))
    renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'), { wrapper })
    act(() => bridge.emitServerMessage({ type: 'incoming-call', from: { userId: 'ana', name: 'Ana' } }))
    act(() => vi.advanceTimersByTime(30_100))
    expect(sent).toContainEqual({ type: 'call-response', callerId: 'ana', accepted: false })
  })

  it('call-result vira toast no chamador', async () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you'), occ('bruno')], 'you'), { wrapper })
    act(() => bridge.emitServerMessage({ type: 'call-result', targetUserId: 'bruno', accepted: true }))
    await waitFor(() => expect(result.current.toast).toMatch(/aceitou/i))
  })

  it('call-failed offline vira toast', async () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'), { wrapper })
    act(() => bridge.emitServerMessage({ type: 'call-failed', targetUserId: 'x', reason: 'offline' }))
    await waitFor(() => expect(result.current.toast).toBeTruthy())
  })

  it('call-failed away vira toast avisando que a pessoa está ausente', async () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'), { wrapper })
    act(() => bridge.emitServerMessage({ type: 'call-failed', targetUserId: 'x', reason: 'away' }))
    await waitFor(() => expect(result.current.toast).toMatch(/ausente/i))
  })

  it('ver perfil abre nova aba com a URL do perfil', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you'), occ('bruno')], 'you'), { wrapper })
    act(() => result.current.viewProfile('bruno'))
    expect(openSpy).toHaveBeenCalledWith('/perfil/bruno', '_blank', 'noopener')
    openSpy.mockRestore()
  })

  it('tecla de movimento (onMoveIntent) cancela um follow em andamento', async () => {
    const bridge = new OfficeBridge()
    const sent: unknown[] = []
    bridge.onClientMessage((m) => sent.push(m))
    const { result } = renderHook(
      () => useOfficeInteractions(bridge, [occ('you', 3, 4), occ('bruno', 8, 4)], 'you'),
      { wrapper },
    )
    act(() => result.current.follow('bruno'))
    const before = sent.length
    act(() => bridge.emitMoveIntent({ dir: 'up', sprint: false })) // humano assumiu
    // moved do follow depois do cancel não deve gerar novos passos
    act(() => bridge.emitServerMessage({ type: 'moved', userId: 'you', x: 4, y: 4, dir: 'right' }))
    expect(sent.length).toBe(before) // nenhum passo novo após o cancelamento
  })

  it('clique direito no mapa (bridge.emitMapRightClick) anda até o próprio tile clicado', async () => {
    const bridge = new OfficeBridge()
    const sent: unknown[] = []
    bridge.onClientMessage((m) => sent.push(m))
    renderHook(() => useOfficeInteractions(bridge, [occ('you', 3, 4)], 'you'), { wrapper })

    act(() => bridge.emitMapRightClick({ x: 5, y: 4 }))
    expect(sent).toEqual([{ type: 'move', dir: 'right' }])
  })

  it('caminhada automática contorna kart estacionado (tile bloqueado no servidor)', async () => {
    // Sem isso o caminho passa por cima do kart, o servidor recusa cada passo
    // e o Seguir fica retentando o mesmo tile até desistir.
    const bridge = new OfficeBridge()
    const sent: unknown[] = []
    bridge.onClientMessage((m) => sent.push(m))
    renderHook(
      () =>
        useOfficeInteractionsRuntime(bridge, [occ('you', 3, 4)], 'you', testDocument, noDesks, noDeskReminders, [
          { id: 'kart-1', x: 4, y: 4, dir: 'up' },
        ]),
      { wrapper },
    )

    // `await act`: deixa o useQuery interno (showcase) assentar dentro do act.
    await act(async () => bridge.emitMapRightClick({ x: 5, y: 4 }))

    expect(sent).toEqual([{ type: 'move', dir: expect.stringMatching(/^(up|down)$/) }])
  })

  it('movimento manual fecha o card aberto para devolver o foco ao próprio usuário', async () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(
      () => useOfficeInteractions(bridge, [occ('you', 3, 4), occ('bruno', 8, 4)], 'you'),
      { wrapper },
    )

    act(() => bridge.emitCharacterClick('bruno'))
    await waitFor(() => expect(result.current.selected?.userId).toBe('bruno'))

    act(() => bridge.emitMoveIntent({ dir: 'up', sprint: false }))

    expect(result.current.selected).toBeNull()
  })

  describe('sala trancada (lado de fora)', () => {
    const denied = {
      type: 'room-entry-denied',
      roomId: 'room-1',
      roomName: 'Aurora',
      reason: 'locked',
      x: 6,
      y: 5,
    } as const

    it('ser barrado por tranca de sessão abre o popup com o nome da sala', () => {
      const bridge = new OfficeBridge()
      const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'), { wrapper })

      act(() => bridge.emitServerMessage(denied))

      expect(result.current.entryDenied).toMatchObject({ roomName: 'Aurora', waiting: false })
    })

    it('recusa sem a quem pedir vira só um toast, sem popup', async () => {
      const bridge = new OfficeBridge()
      const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'), { wrapper })

      act(() => bridge.emitServerMessage({ ...denied, reason: 'capacity' }))

      expect(result.current.entryDenied).toBeNull()
      await waitFor(() => expect(result.current.toast).toMatch(/lotada/i))
    })

    it('pedir para entrar manda o knock e marca a espera', () => {
      const bridge = new OfficeBridge()
      const sent: unknown[] = []
      bridge.onClientMessage((m) => sent.push(m))
      const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'), { wrapper })
      act(() => bridge.emitServerMessage(denied))

      act(() => result.current.knockToEnter())

      expect(sent).toContainEqual({ type: 'knock', roomId: 'room-1', active: true })
      expect(result.current.entryDenied).toMatchObject({ waiting: true })
    })

    it('cancelar depois de pedir retira o pedido e fecha o popup', () => {
      const bridge = new OfficeBridge()
      const sent: unknown[] = []
      bridge.onClientMessage((m) => sent.push(m))
      const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'), { wrapper })
      act(() => bridge.emitServerMessage(denied))
      act(() => result.current.knockToEnter())

      act(() => result.current.cancelEntryRequest())

      expect(sent).toContainEqual({ type: 'knock', roomId: 'room-1', active: false })
      expect(result.current.entryDenied).toBeNull()
    })

    it('fechar o popup antes de pedir não fala com o servidor', () => {
      const bridge = new OfficeBridge()
      const sent: unknown[] = []
      bridge.onClientMessage((m) => sent.push(m))
      const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'), { wrapper })
      act(() => bridge.emitServerMessage(denied))

      act(() => result.current.cancelEntryRequest())

      expect(sent).toEqual([])
      expect(result.current.entryDenied).toBeNull()
    })

    it('sem resposta, o pedido se desfaz sozinho e avisa', async () => {
      const bridge = new OfficeBridge()
      const sent: unknown[] = []
      bridge.onClientMessage((m) => sent.push(m))
      const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'), { wrapper })
      act(() => bridge.emitServerMessage(denied))
      act(() => result.current.knockToEnter())

      act(() => vi.advanceTimersByTime(30_100))

      expect(sent).toContainEqual({ type: 'knock', roomId: 'room-1', active: false })
      expect(result.current.entryDenied).toBeNull()
      await waitFor(() => expect(result.current.toast).toMatch(/ningu[ée]m respondeu/i))
    })

    it('pedido barrado pelo anti-spam destrava o botão sem fechar o popup', () => {
      const bridge = new OfficeBridge()
      const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'), { wrapper })
      act(() => bridge.emitServerMessage({ type: 'welcome', youId: 'you', occupants: [] }))
      act(() => bridge.emitServerMessage(denied))
      act(() => result.current.knockToEnter())

      act(() => bridge.emitServerMessage({ type: 'knock-cleared', roomId: 'room-1', userId: 'you' }))

      expect(result.current.entryDenied).toMatchObject({ waiting: false })
    })

    it('knock-cleared de outra pessoa não mexe no seu pedido', () => {
      const bridge = new OfficeBridge()
      const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'), { wrapper })
      act(() => bridge.emitServerMessage(denied))
      act(() => result.current.knockToEnter())

      act(() => bridge.emitServerMessage({ type: 'knock-cleared', roomId: 'room-1', userId: 'bruno' }))

      expect(result.current.entryDenied).toMatchObject({ waiting: true })
    })

    it('aceito: avisa e entra andando até o tile onde tinha sido barrado', async () => {
      const bridge = new OfficeBridge()
      const sent: unknown[] = []
      bridge.onClientMessage((m) => sent.push(m))
      const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you', 5, 5)], 'you'), { wrapper })
      act(() => bridge.emitServerMessage(denied))
      act(() => result.current.knockToEnter())
      sent.length = 0

      act(() =>
        bridge.emitServerMessage({
          type: 'knock-result',
          roomId: 'room-1',
          accepted: true,
          byUserId: 'ana',
          byName: 'Ana',
        }),
      )

      expect(result.current.entryDenied).toBeNull()
      await waitFor(() => expect(result.current.toast).toMatch(/liberou/i))
      // O tile recusado (6,5) fica um passo à direita de onde a pessoa está (5,5).
      expect(sent).toContainEqual({ type: 'move', dir: 'right' })
    })

    it('recusado: avisa e não anda', async () => {
      const bridge = new OfficeBridge()
      const sent: unknown[] = []
      bridge.onClientMessage((m) => sent.push(m))
      const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you', 5, 5)], 'you'), { wrapper })
      act(() => bridge.emitServerMessage(denied))
      act(() => result.current.knockToEnter())
      sent.length = 0

      act(() =>
        bridge.emitServerMessage({
          type: 'knock-result',
          roomId: 'room-1',
          accepted: false,
          byUserId: 'ana',
          byName: 'Ana',
        }),
      )

      expect(result.current.entryDenied).toBeNull()
      await waitFor(() => expect(result.current.toast).toMatch(/recusou/i))
      expect(sent).toEqual([])
    })
  })

  it('desmontar durante um follow em andamento encerra o loop de passos (sem leak)', async () => {
    const bridge = new OfficeBridge()
    const sent: unknown[] = []
    bridge.onClientMessage((m) => sent.push(m))
    const { result, unmount } = renderHook(
      () => useOfficeInteractions(bridge, [occ('you', 3, 4), occ('bruno', 8, 4)], 'you'),
      { wrapper },
    )
    act(() => result.current.follow('bruno')) // dispara o 1º passo e arma o timer de 500ms
    const before = sent.length
    expect(before).toBeGreaterThan(0)

    unmount() // navegação para fora do escritório: handlers do bridge são desinscritos

    // Sem o cleanup, o timer de passo (500ms) reagenda a si mesmo indefinidamente
    // mesmo sem receber `moved` — avançamos dez ciclos para provar que não há mais.
    act(() => vi.advanceTimersByTime(5000))
    expect(sent.length).toBe(before) // nenhum passo novo emitido após o unmount
  })
})
