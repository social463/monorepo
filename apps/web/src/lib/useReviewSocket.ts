import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ReviewEvent } from '@legends/shared'
import { getAccessToken, refreshAccessToken } from './api'

const FEED_KEY = ['reviews', 'feed'] as const

/**
 * Mantém uma conexão WebSocket com o feed de resenha enquanto a rota está
 * montada. Ao receber um evento, invalida a query relevante do React Query
 * (eventos magros — o refetch traz o estado já com as flags do viewer).
 */
export function useReviewSocket(): void {
  const qc = useQueryClient()

  useEffect(() => {
    let closedByUs = false
    let attempts = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let ws: WebSocket | null = null

    async function connect() {
      let token = getAccessToken()
      if (attempts > 0 || !token) {
        await refreshAccessToken()
        token = getAccessToken()
      }
      if (!token || closedByUs) return
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${scheme}://${window.location.host}/api/reviews/ws?token=${token}`)

      ws.onopen = () => {
        attempts = 0
        qc.invalidateQueries({ queryKey: FEED_KEY })
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        let e: ReviewEvent
        try {
          e = JSON.parse(ev.data) as ReviewEvent
        } catch {
          return
        }
        if (e.type === 'feed:changed') {
          qc.invalidateQueries({ queryKey: FEED_KEY })
          return
        }
        if (e.type === 'review:changed') {
          qc.invalidateQueries({ queryKey: FEED_KEY })
          qc.invalidateQueries({ queryKey: ['reviews', 'poll-votes', e.reviewId] })
          return
        }
        if (e.type === 'comments:changed') {
          qc.invalidateQueries({ queryKey: ['reviews', 'comments', e.reviewId] })
          qc.invalidateQueries({ queryKey: FEED_KEY })
        }
      }
      ws.onclose = () => {
        if (closedByUs) return
        attempts += 1
        reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** attempts, 15000))
      }
      ws.onerror = () => ws?.close()
    }
    void connect()

    return () => {
      closedByUs = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
      ws = null
    }
  }, [qc])
}
