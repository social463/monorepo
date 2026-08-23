import { useCallback, useEffect, useRef, useState } from 'react'
import { playChatMessageBeep } from '../../lib/beep'
import type { RoomChatMessage } from './useRoomChat'

/** Quanto tempo a prévia fica na tela antes de sumir sozinha. */
export const ROOM_CHAT_PREVIEW_MS = 6000
/**
 * Uma conversa animada manda várias mensagens em poucos segundos; sem isto o
 * bipe viraria metralhadora. A prévia continua trocando a cada mensagem — o
 * que incomoda é o som repetido, não o texto atualizado.
 */
export const ROOM_CHAT_BEEP_COOLDOWN_MS = 4000

/**
 * Avisa que chegou mensagem enquanto o chat da sala está fechado: devolve a
 * última mensagem para a prévia flutuante e toca um bipe curto.
 *
 * Mensagem própria nunca avisa, e trocar de sala (que zera o histórico em
 * `useRoomChat`) não dispara nada — só o que chega DEPOIS de o hook já estar
 * acompanhando a lista conta como novidade.
 */
export function useRoomChatAlerts({
  messages,
  youId,
  chatOpen,
}: {
  messages: RoomChatMessage[]
  youId: string | null
  chatOpen: boolean
}): { preview: RoomChatMessage | null; dismissPreview: () => void } {
  const [preview, setPreview] = useState<RoomChatMessage | null>(null)
  const seenCountRef = useRef(messages.length)
  const lastBeepAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismissPreview = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
    setPreview(null)
  }, [])

  useEffect(() => {
    // Lista encolheu = troca de sala: reancora sem avisar nada.
    if (messages.length < seenCountRef.current) {
      seenCountRef.current = messages.length
      dismissPreview()
      return
    }
    const fresh = messages.slice(seenCountRef.current)
    seenCountRef.current = messages.length
    if (chatOpen) return

    const fromOthers = fresh.filter((message) => message.userId !== youId)
    const latest = fromOthers[fromOthers.length - 1]
    if (!latest) return

    setPreview(latest)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setPreview(null)
    }, ROOM_CHAT_PREVIEW_MS)

    const now = Date.now()
    if (now - lastBeepAtRef.current >= ROOM_CHAT_BEEP_COOLDOWN_MS) {
      lastBeepAtRef.current = now
      playChatMessageBeep()
    }
  }, [messages, youId, chatOpen, dismissPreview])

  // Abriu o chat: a prévia perdeu a função.
  useEffect(() => {
    if (chatOpen) dismissPreview()
  }, [chatOpen, dismissPreview])

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
  }, [])

  return { preview, dismissPreview }
}
