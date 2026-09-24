import { useCallback, useEffect, useRef, useState } from 'react'
import type { OfficeRoomManager } from '@legends/shared'
import type { OfficeBridge } from '../OfficeBridge'

/** Você foi tirado de uma reunião — o que a barra de mídia mostra no lugar de "reconectando". */
export interface RoomRemoval {
  roomId: string
  byName: string
}

export interface RoomModerationState {
  /** Quem manda em cada sala ocupada, do jeito que o servidor calculou. */
  managers: readonly OfficeRoomManager[]
  /** Quem manda na sala em que você está (`null` fora de sala ou em sala vazia). */
  currentManager: OfficeRoomManager | null
  /** Você pode tirar alguém desta reunião agora. */
  canRemove: boolean
  /** Tira `userId` da chamada da sala atual. No-op sem permissão. */
  remove: (userId: string) => void
  /**
   * Preenchido quando VOCÊ foi removido, e limpo assim que você sai da área da
   * sala. Existe para a interface não dizer "tentando reconectar" quando a
   * mídia caiu de propósito.
   */
  removedFrom: RoomRemoval | null
}

/**
 * Moderação da sala de reunião: quem manda e a remoção da chamada.
 *
 * Mesmo desenho de `useRoomLock` — o servidor é a única fonte e o estado vem
 * de `welcome` + eventos. A diferença é que a lista de managers vale para o
 * escritório inteiro (como `lockedRoomIds`): o selo precisa aparecer também
 * para quem está fora da sala.
 */
export function useRoomModeration(
  bridge: OfficeBridge,
  roomId: string | null,
  youId: string | null,
  connected: boolean,
  isAdmin = false,
): RoomModerationState {
  const [managers, setManagers] = useState<OfficeRoomManager[]>([])
  const [removedFrom, setRemovedFrom] = useState<RoomRemoval | null>(null)
  const roomIdRef = useRef(roomId)
  roomIdRef.current = roomId

  // Saiu da área (ou entrou em outra sala): o bloqueio do servidor caiu junto,
  // então o aviso não tem mais o que explicar.
  useEffect(() => {
    setRemovedFrom((current) => (current && current.roomId !== roomId ? null : current))
  }, [roomId])

  useEffect(
    () =>
      bridge.onServerMessage((message) => {
        if (message.type === 'welcome') {
          setManagers(message.roomManagers ?? [])
          return
        }
        if (message.type === 'room-managers-changed') {
          setManagers(message.managers)
          return
        }
        if (message.type === 'removed-from-room') {
          if (message.userId !== youId) return
          setRemovedFrom({ roomId: message.roomId, byName: message.byName })
        }
      }),
    [bridge, youId],
  )

  const currentManager = roomId ? managers.find((m) => m.roomId === roomId) ?? null : null
  const canRemove =
    roomId !== null && youId !== null && connected && (isAdmin || currentManager?.userId === youId)

  const remove = useCallback(
    (userId: string) => {
      if (!canRemove || userId === youId) return
      bridge.emitClientMessage({ type: 'remove-from-room', userId })
    },
    [bridge, canRemove, youId],
  )

  return { managers, currentManager, canRemove, remove, removedFrom }
}
