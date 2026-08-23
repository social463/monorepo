import { useCallback, useEffect, useRef, useState } from 'react'
import type { OfficeBridge } from '../OfficeBridge'
import { playKnockBeep } from '../../lib/beep'

/** Alguém batendo na porta da sala em que você está. */
export interface RoomKnock {
  userId: string
  name: string
}

export interface RoomLockState {
  /** Se a sala ATUAL está trancada nesta sessão. */
  locked: boolean
  /**
   * Todas as salas trancadas nesta sessão, por id de `OfficeRoom`. É o que
   * permite desenhar o cadeado no mapa de quem está de FORA — o hub já manda
   * `room-lock-changed` pro escritório inteiro, e o `welcome` traz o estado
   * inicial; sem expor a lista, essa informação morria aqui dentro.
   */
  lockedRoomIds: readonly string[]
  /** Se dá pra mexer no cadeado agora — exige estar dentro de uma sala de reunião, identificado e conectado. */
  canLock: boolean
  /** Tranca se destrancada, destranca se trancada. No-op fora de sala. */
  toggle: () => void
  /** Pedidos de entrada em aberto na sala atual, na ordem em que chegaram. */
  knocks: RoomKnock[]
  /** Aceita (libera a entrada) ou recusa o pedido de `userId`. */
  respond: (userId: string, accepted: boolean) => void
}

/**
 * Lado de DENTRO da sala trancada: estado do cadeado e fila de quem está
 * pedindo para entrar. Mesmo desenho de `useRaisedHands` — o servidor é a
 * única fonte, tudo é filtrado pelo `roomId` da sala atual e zerado ao trocar
 * de sala.
 *
 * A tranca é da sala, não de quem trancou: qualquer ocupante liga, desliga e
 * responde: quem responder primeiro resolve, e o `knock-cleared` do servidor
 * fecha o modal dos demais.
 *
 * O lado de FORA (ser barrado, pedir para entrar, receber a resposta) mora em
 * `useOfficeInteractions`, junto do popup de chamada e do `walkToTile`.
 */
export function useRoomLock(
  bridge: OfficeBridge,
  roomId: string | null,
  youId: string | null,
  connected: boolean,
  canControlRoomLock = true,
): RoomLockState {
  const [lockedRoomIds, setLockedRoomIds] = useState<string[]>([])
  const [knocks, setKnocks] = useState<RoomKnock[]>([])
  const roomIdRef = useRef(roomId)
  roomIdRef.current = roomId

  // Pedidos só valem pra sala em que você está — trocou de sala, zera.
  useEffect(() => {
    setKnocks([])
  }, [roomId])

  useEffect(
    () =>
      bridge.onServerMessage((message) => {
        if (message.type === 'welcome') {
          setLockedRoomIds(message.lockedRoomIds ?? [])
          return
        }
        if (message.type === 'room-lock-changed') {
          setLockedRoomIds((current) =>
            message.locked
              ? current.includes(message.roomId)
                ? current
                : [...current, message.roomId]
              : current.filter((id) => id !== message.roomId),
          )
          return
        }
        if (message.type === 'knock-request') {
          if (message.roomId !== roomIdRef.current) return
          setKnocks((current) =>
            current.some((knock) => knock.userId === message.userId)
              ? current
              : [...current, { userId: message.userId, name: message.name }],
          )
          playKnockBeep()
          return
        }
        if (message.type === 'knock-cleared') {
          if (message.roomId !== roomIdRef.current) return
          setKnocks((current) => current.filter((knock) => knock.userId !== message.userId))
        }
      }),
    [bridge],
  )

  const canLock = roomId !== null && youId !== null && connected && canControlRoomLock
  const locked = roomId !== null && lockedRoomIds.includes(roomId)

  const toggle = useCallback(() => {
    if (!canLock) return
    bridge.emitClientMessage({ type: 'set-room-lock', locked: !locked })
  }, [bridge, canLock, locked])

  const respond = useCallback(
    (userId: string, accepted: boolean) => {
      bridge.emitClientMessage({ type: 'knock-response', userId, accepted })
      // Some da lista na hora: o `knock-cleared` do servidor confirma, mas o
      // botão não deve ficar respondendo duas vezes no meio do round-trip.
      setKnocks((current) => current.filter((knock) => knock.userId !== userId))
    },
    [bridge],
  )

  return { locked, lockedRoomIds, canLock, toggle, knocks, respond }
}
