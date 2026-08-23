import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { CorporateMuralEvent } from '@legends/shared'
import { getAccessToken, refreshAccessToken } from './api'
import { CORPORATE_FEED_KEY } from './use-corporate-mural'

/**
 * Conexão WebSocket do mural corporativo. Eventos magros: o cliente invalida a
 * query relevante e o refetch traz o estado já com as flags do viewer.
 *
 * Mora no `AppLayout` (via `CorporatePostToasts`), e **uma só por aba**: enquanto
 * o feed abria a dele e o toast abria outra, o comunicado publicado por um
 * colega chegava — mas na conexão do toast, que não invalida query nenhuma.
 * Resultado: quem estava na Home (ou com o feed montado do outro lado da
 * rota) via o aviso e continuava com o feed velho até dar F5. Com a conexão no
 * layout, todo mundo que usa `CORPORATE_FEED_KEY` — feed, prévia da Home —
 * atualiza sozinho.
 *
 * `onEvent` é o gancho para quem precisa do evento cru (o toast precisa do
 * `post:published`), sem abrir uma segunda conexão para isso.
 */
export function useCorporateMuralSocket(onEvent?: (event: CorporateMuralEvent) => void): void {
  const qc = useQueryClient()
  // Guardado em ref para a conexão não ser derrubada e refeita a cada render do
  // componente que passa o callback inline.
  const handler = useRef(onEvent)
  handler.current = onEvent

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
      ws = new WebSocket(`${scheme}://${window.location.host}/api/corporate-posts/ws?token=${token}`)

      ws.onopen = () => {
        attempts = 0
        // Reconexão: pode ter passado comunicado enquanto a aba estava sem rede.
        qc.invalidateQueries({ queryKey: CORPORATE_FEED_KEY })
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        let e: CorporateMuralEvent
        try {
          e = JSON.parse(ev.data) as CorporateMuralEvent
        } catch {
          return
        }
        if (e.type === 'feed:changed' || e.type === 'post:changed' || e.type === 'post:published') {
          qc.invalidateQueries({ queryKey: CORPORATE_FEED_KEY })
        } else if (e.type === 'comments:changed') {
          qc.invalidateQueries({ queryKey: ['corporate-posts', 'comments', e.postId] })
          qc.invalidateQueries({ queryKey: CORPORATE_FEED_KEY })
        }
        handler.current?.(e)
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
