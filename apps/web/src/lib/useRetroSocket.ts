import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  CURSOR_THROTTLE_MS,
  MOVE_THROTTLE_MS,
  type RetroClientMessage,
  type RetroEvent,
  type RetroRoomDTO,
} from '@legends/shared'
import { getAccessToken, refreshAccessToken } from './api'
import {
  makeFloatingReaction,
  type FloatingReaction,
  FLOAT_REACTION_TTL_MS,
  FLOAT_REACTION_THROTTLE_MS,
} from '../pages/retro/floating-reactions'

type Cached = { room: RetroRoomDTO } | undefined
export interface RetroCursor { userId: string; name: string; x: number; y: number }

function setCardXY(prev: Cached, cardId: string, x: number, y: number): Cached {
  if (!prev) return prev
  return { room: { ...prev.room, cards: prev.room.cards.map((c) => (c.id === cardId ? { ...c, x, y } : c)) } }
}

function applyEvent(prev: Cached, e: RetroEvent): Cached {
  if (!prev) return prev
  const room = prev.room
  switch (e.type) {
    case 'card.created':
    case 'card.updated': {
      const exists = room.cards.some((c) => c.id === e.card.id)
      const cards = exists ? room.cards.map((c) => (c.id === e.card.id ? e.card : c)) : [...room.cards, e.card]
      return { room: { ...room, cards } }
    }
    case 'card.deleted':
      return { room: { ...room, cards: room.cards.filter((c) => c.id !== e.cardId) } }
    case 'card.moved':
    case 'card.moving':
      return setCardXY(prev, e.cardId, e.x, e.y)
    case 'vote.changed':
      return { room: { ...room, cards: room.cards.map((c) => (c.id === e.cardId ? { ...c, voteCount: e.voteCount } : c)) } }
    case 'reaction.changed':
      return { room: { ...room, cards: room.cards.map((c) => (c.id === e.cardId ? { ...c, reactions: e.reactions } : c)) } }
    case 'anonymous.changed':
      return { room: { ...room, anonymous: e.anonymous } }
    case 'timer.changed':
      return { room: { ...room, timer: e.timer } }
    default:
      return prev
  }
}

export function useRetroSocket(roomId: string, opts?: { onRoomDeleted?: () => void }): {
  presentUserIds: string[]
  cursors: RetroCursor[]
  floatingReactions: FloatingReaction[]
  lockOf: (cardId: string) => { byUserId: string; byName: string } | null
  sendCursor: (x: number, y: number) => void
  sendReaction: (emoji: string) => void
  grab: (cardId: string) => void
  move: (cardId: string, x: number, y: number) => void
  drop: (cardId: string) => void
} {
  const qc = useQueryClient()
  const [presentUserIds, setPresentUserIds] = useState<string[]>([])
  const [cursors, setCursors] = useState<Record<string, RetroCursor>>({})
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([])
  const lastReactionAt = useRef(0)
  const reactionSeq = useRef(0)
  const locksRef = useRef<Record<string, { byUserId: string; byName: string }>>({})
  const [, forceLockRender] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const closedByUs = useRef(false)
  const attempts = useRef(0)
  const lastCursorAt = useRef(0)
  const lastMoveAt = useRef<Record<string, number>>({})
  const onRoomDeletedRef = useRef(opts?.onRoomDeleted)
  onRoomDeletedRef.current = opts?.onRoomDeleted

  useEffect(() => {
    if (!roomId) return
    closedByUs.current = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    async function connect() {
      let token = getAccessToken()
      if (attempts.current > 0 || !token) {
        await refreshAccessToken()
        token = getAccessToken()
      }
      if (!token || closedByUs.current) return
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${scheme}://${window.location.host}/api/retro/rooms/${roomId}/ws?token=${token}`)
      wsRef.current = ws

      ws.onopen = () => {
        attempts.current = 0
        qc.invalidateQueries({ queryKey: ['retro-room', roomId] })
      }
      ws.onmessage = (ev) => {
        // Ignora mensagens de um socket que já foi substituído (evita processar o
        // mesmo evento duas vezes quando há uma conexão obsoleta ainda aberta).
        if (wsRef.current !== ws) return
        if (typeof ev.data !== 'string') return
        let e: RetroEvent
        try {
          e = JSON.parse(ev.data) as RetroEvent
        } catch {
          return
        }
        if (e.type === 'room.deleted') {
          qc.invalidateQueries({ queryKey: ['retro-rooms'] })
          onRoomDeletedRef.current?.()
          return
        }
        if (e.type === 'presence.changed') {
          setPresentUserIds(e.userIds)
          setCursors((cur) => Object.fromEntries(Object.entries(cur).filter(([uid]) => e.userIds.includes(uid))))
          return
        }
        if (e.type === 'phase.changed') {
          qc.invalidateQueries({ queryKey: ['retro-room', roomId] })
          return
        }
        if (e.type === 'cursor.moved') {
          setCursors((cur) => ({ ...cur, [e.userId]: { userId: e.userId, name: e.name, x: e.x, y: e.y } }))
          return
        }
        if (e.type === 'reaction.floated') {
          reactionSeq.current += 1
          const item = makeFloatingReaction(
            { userId: e.userId, name: e.name, emoji: e.emoji },
            { id: `fr-${reactionSeq.current}`, rand: Math.random() },
          )
          setFloatingReactions((cur) => [...cur, item])
          setTimeout(() => setFloatingReactions((cur) => cur.filter((r) => r.id !== item.id)), FLOAT_REACTION_TTL_MS)
          return
        }
        if (e.type === 'card.locked') {
          locksRef.current[e.cardId] = { byUserId: e.byUserId, byName: e.byName }
          forceLockRender((n) => n + 1)
          return
        }
        if (e.type === 'card.unlocked') {
          delete locksRef.current[e.cardId]
          forceLockRender((n) => n + 1)
          return
        }
        qc.setQueryData<Cached>(['retro-room', roomId], (prev) => applyEvent(prev, e))
        if (e.type === 'anonymous.changed') qc.invalidateQueries({ queryKey: ['retro-room', roomId] })
        if (e.type === 'participants.changed') qc.invalidateQueries({ queryKey: ['retro-room', roomId] })
        if (e.type === 'carryover.changed') qc.invalidateQueries({ queryKey: ['retro-carryover', roomId] })
        if (e.type === 'edits.changed') {
          qc.invalidateQueries({ queryKey: ['retro-edits', roomId] })
          qc.invalidateQueries({ queryKey: ['retro-room', roomId] })
        }
      }
      ws.onclose = () => {
        // Só o socket atual reconecta. Um socket obsoleto (ex.: remontagem do
        // StrictMode ou reconexão anterior) que fecha depois não pode criar uma
        // segunda conexão — isso deixaria dois sockets vivos no mesmo tab.
        if (closedByUs.current || wsRef.current !== ws) return
        attempts.current += 1
        reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** attempts.current, 15000))
      }
      ws.onerror = () => ws.close()
    }
    void connect()

    return () => {
      closedByUs.current = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [roomId, qc])

  const send = useCallback((msg: RetroClientMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  const sendCursor = useCallback(
    (x: number, y: number) => {
      const now = Date.now()
      if (now - lastCursorAt.current < CURSOR_THROTTLE_MS) return
      lastCursorAt.current = now
      send({ type: 'cursor', x, y })
    },
    [send],
  )
  const grab = useCallback((cardId: string) => send({ type: 'card.grab', cardId }), [send])
  const move = useCallback(
    (cardId: string, x: number, y: number) => {
      const now = Date.now()
      if (now - (lastMoveAt.current[cardId] ?? 0) < MOVE_THROTTLE_MS) return
      lastMoveAt.current[cardId] = now
      send({ type: 'card.move', cardId, x, y })
    },
    [send],
  )
  const drop = useCallback((cardId: string) => send({ type: 'card.drop', cardId }), [send])
  const lockOf = useCallback((cardId: string) => locksRef.current[cardId] ?? null, [])
  const sendReaction = useCallback(
    (emoji: string) => {
      const now = Date.now()
      if (now - lastReactionAt.current < FLOAT_REACTION_THROTTLE_MS) return
      lastReactionAt.current = now
      send({ type: 'reaction.float', emoji })
    },
    [send],
  )

  return { presentUserIds, cursors: Object.values(cursors), floatingReactions, lockOf, sendCursor, sendReaction, grab, move, drop }
}
