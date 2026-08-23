import { useEffect, useRef, useState } from 'react'
import { useUnreadNotificationsPoll } from '../../lib/use-notifications'
import { useCurrentPeriod } from '../../lib/use-current-period'
import { getRetroRoom } from '../../lib/retro-api'

const INVITE_TOAST_TYPES = ['RETRO_INVITED', 'PERIOD_OPENED', 'VOTE_REMINDER_MIDWAY', 'VOTE_REMINDER_CLOSING'] as const
type InviteToastType = (typeof INVITE_TOAST_TYPES)[number]

export interface InviteToastItem {
  id: string
  type: InviteToastType
  title: string
  link: string
}

function isInviteToastType(type: string): type is InviteToastType {
  return (INVITE_TOAST_TYPES as readonly string[]).includes(type)
}

/** Extrai o id da sala do link `/retrospectivas/:id` — formato gravado por notifyRetroInvited. */
function retroRoomIdFromLink(link: string): string | null {
  const match = link.match(/^\/retrospectivas\/(.+)$/)
  return match ? match[1]! : null
}

/**
 * Convites (retro/votação) não-lidos e ainda em aberto, prontos pra virar
 * toast no Escritório. `seen` é só desta sessão — nunca persiste, reseta ao
 * reentrar no Escritório.
 */
export function useOfficeInviteToasts() {
  const poll = useUnreadNotificationsPoll()
  const { votingOpen, isLoading: periodLoading } = useCurrentPeriod()
  const [queue, setQueue] = useState<InviteToastItem[]>([])
  const seenRef = useRef<Set<string>>(new Set())
  const checkedRef = useRef<Set<string>>(new Set())

  const candidates = (poll.data?.items ?? []).filter(
    (n) => isInviteToastType(n.type) && n.link && !seenRef.current.has(n.id) && !checkedRef.current.has(n.id),
  )

  // Cada candidato só entra em um único fetch de checagem "ainda aberta"
  // (checkedRef evita refetch a cada re-render/poll enquanto aguarda).
  const retroCandidates = candidates.filter((n) => n.type === 'RETRO_INVITED')
  const votingCandidates = candidates.filter((n) => n.type !== 'RETRO_INVITED')

  useEffect(() => {
    // Enquanto o período ainda está carregando, `votingOpen` pode ser `false`
    // só por ainda não ter resolvido (não porque a votação está fechada de
    // fato) — não marcar candidatos como checados/vistos nesse meio-tempo,
    // senão eles somem da fila de candidatos e nunca mais são reavaliados
    // quando o período de fato resolver como aberto.
    if (periodLoading) return
    for (const n of votingCandidates) {
      checkedRef.current.add(n.id)
      if (votingOpen) {
        setQueue((q) => [...q, { id: n.id, type: n.type as InviteToastType, title: n.title, link: n.link! }])
      } else {
        seenRef.current.add(n.id)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [votingCandidates.map((n) => n.id).join(','), votingOpen, periodLoading])

  useEffect(() => {
    for (const n of retroCandidates) {
      checkedRef.current.add(n.id)
      const roomId = retroRoomIdFromLink(n.link!)
      if (!roomId) {
        seenRef.current.add(n.id)
        continue
      }
      getRetroRoom(roomId)
        .then(({ room }) => {
          if (room.status === 'OPEN') {
            setQueue((q) => [...q, { id: n.id, type: 'RETRO_INVITED', title: n.title, link: n.link! }])
          } else {
            seenRef.current.add(n.id)
          }
        })
        .catch(() => {
          seenRef.current.add(n.id)
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retroCandidates.map((n) => n.id).join(',')])

  function dismiss(id: string) {
    seenRef.current.add(id)
    setQueue((q) => q.filter((item) => item.id !== id))
  }

  return { queue, dismiss }
}
