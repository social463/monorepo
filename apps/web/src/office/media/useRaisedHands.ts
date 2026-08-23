import { useEffect, useRef, useState } from 'react'
import type { OfficeBridge } from '../OfficeBridge'
import { playRaiseHandBeep } from '../../lib/beep'

export interface RaisedHandsState {
  /** Fila da zona ATUAL, ordenada (quem levantou primeiro vem primeiro) —
   * alimenta o contador/lista do topo, que só existe dentro de sala/zona. */
  queue: string[]
  /** Se o PRÓPRIO usuário está com a mão levantada agora. Alimenta o botão
   * da barra e, via `hand-raised` no Phaser, o ícone sobre o personagem. */
  raised: boolean
  /** Se dá pra levantar agora — exige estar DENTRO de uma sala de reunião ou
   * zona privada (`roomId` não-nulo), além de identificado e conectado. A
   * mão não existe fora dessas duas modalidades de zona. */
  canRaise: boolean
  /** Levanta se abaixada, abaixa se levantada. No-op fora de zona. */
  toggle: () => void
}

/**
 * Duas mensagens do servidor, ambas escopadas à mesma zona (sala de reunião
 * OU zona privada — `roomId` já vem resolvido pelo chamador, ver
 * `OfficeSessionContext`):
 * - `raised` (mensagem `hand-raised`, global mas só liga dentro de zona):
 *   mesmo padrão do confete — dirige o ícone sobre o personagem.
 * - `queue` (mensagem `raised-hands`): mesmo padrão de `useRoomChat` —
 *   filtra por `roomId`, zera ao trocar de zona.
 * Levantar fora de zona é no-op no servidor (`OfficeHub.raiseHand`); este
 * hook espelha essa regra em `canRaise`/`toggle` pro botão já nascer
 * desabilitado/escondido, sem depender só do servidor ignorar a mensagem.
 */
export function useRaisedHands(
  bridge: OfficeBridge,
  roomId: string | null,
  youId: string | null,
  connected: boolean,
  localSpeaking: boolean,
): RaisedHandsState {
  const [queue, setQueue] = useState<string[]>([])
  const [raised, setRaised] = useState(false)
  const roomIdRef = useRef(roomId)
  roomIdRef.current = roomId
  const youIdRef = useRef(youId)
  youIdRef.current = youId

  useEffect(() => {
    setQueue([])
  }, [roomId])

  useEffect(
    () =>
      bridge.onServerMessage((message) => {
        if (message.type === 'welcome') {
          setRaised(youIdRef.current !== null && (message.handRaisedUserIds ?? []).includes(youIdRef.current))
          return
        }
        if (message.type === 'hand-raised') {
          if (message.userId === youIdRef.current) setRaised(message.active)
          return
        }
        if (message.type !== 'raised-hands' || message.roomId !== roomIdRef.current) return
        setQueue(message.queue)
        // `event` ausente = snapshot (ex.: acabou de entrar na sala) — nunca toca som.
        if (message.event?.kind === 'raised') playRaiseHandBeep()
      }),
    [bridge],
  )

  // Abaixa sozinha só na TRANSIÇÃO para "falando" (borda de subida) — levantar
  // a mão no meio de uma fala já em andamento não deve derrubá-la na hora.
  const wasSpeakingRef = useRef(false)
  useEffect(() => {
    const startedSpeaking = localSpeaking && !wasSpeakingRef.current
    wasSpeakingRef.current = localSpeaking
    if (startedSpeaking && raised) {
      bridge.emitClientMessage({ type: 'raise-hand', active: false })
    }
  }, [localSpeaking, raised, bridge])

  function toggle() {
    if (!roomId || !youId || !connected) return
    bridge.emitClientMessage({ type: 'raise-hand', active: !raised })
  }

  return { queue, raised, canRaise: roomId !== null && youId !== null && connected, toggle }
}
