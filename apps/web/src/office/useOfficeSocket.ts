import { useEffect, useState } from 'react'
import type { OfficeBall, OfficeKart, OfficeOccupant, OfficeServerMessage } from '@legends/shared'
import { getAccessToken, refreshAccessToken } from '../lib/api'
import type { OfficeBridge } from './OfficeBridge'

export interface OfficeSocketState {
  occupants: OfficeOccupant[]
  youId: string | null
  connected: boolean
  editorUserIds: string[]
  karts: OfficeKart[]
  balls: OfficeBall[]
}

/**
 * Mantém a conexão com o escritório enquanto a rota está montada.
 *
 * Repassa TODAS as mensagens ao bridge (de onde a cena do Phaser se vira) e
 * espelha o snapshot do PRÓPRIO bridge em estado React, para o HUD ("quem
 * está online"). O bridge é quem reduz `welcome`/`joined`/`left`/`moved`/`sync`
 * num snapshot — não duplicamos esse reducer aqui, só relemos
 * `bridge.snapshot()` a cada mensagem. O estado do jogo em si é do servidor:
 * aqui não há predição nem correção — a predição VISUAL do próprio passo vive
 * na OfficeScene (`ArenaPredictor`), fora deste hook.
 */
export function useOfficeSocket(
  bridge: OfficeBridge,
  mapId: string | null | undefined = undefined,
  guestToken: string | null = null,
): OfficeSocketState {
  const [occupants, setOccupants] = useState<OfficeOccupant[]>([])
  const [youId, setYouId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [editorUserIds, setEditorUserIds] = useState<string[]>([])
  const [karts, setKarts] = useState<OfficeKart[]>([])
  const [balls, setBalls] = useState<OfficeBall[]>([])

  useEffect(() => {
    // Sessão nova (bridge/mapa trocados): o snapshot da anterior não
    // pode vazar — o estado volta a preencher com o próximo welcome.
    setOccupants([])
    setYouId(null)
    setEditorUserIds([])
    setKarts([])
    setBalls([])
    let closedByUs = false
    let attempts = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let ws: WebSocket | null = null

    const unsubscribeMove = bridge.onInput((input) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', input }))
      }
    })

    const unsubscribeClient = bridge.onClientMessage((message) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message))
      }
    })

    // Espelha o snapshot do bridge no React — se já houver welcome (ex.:
    // remount com bridge reaproveitado), a inscrição já chega com o estado
    // atual via replay síncrono (ver `OfficeBridge.onServerMessage`).
    const unsubscribeServer = bridge.onServerMessage(() => {
      const snapshot = bridge.snapshot()
      setYouId(snapshot.youId)
      setOccupants(snapshot.occupants)
      setEditorUserIds(snapshot.editorUserIds)
      setKarts(snapshot.karts)
      setBalls(snapshot.balls)
    })

    const leaveOnPageHide = () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'leave-office' }))
      }
    }
    window.addEventListener('pagehide', leaveOnPageHide)

    function scheduleReconnect() {
      attempts += 1
      reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** attempts, 15000))
    }

    async function connect() {
      if (closedByUs) return
      // `null` significa que a tela já consultou o runtime e não há mapa.
      // `undefined` preserva consumidores legados/testes que não versionavam a URL.
      if (mapId === null) return
      let token = guestToken ?? getAccessToken()
      if (!guestToken && (attempts > 0 || !token)) {
        await refreshAccessToken()
        token = getAccessToken()
      }
      if (closedByUs) return
      if (!token) {
        // A API pode estar fora do ar (ex.: durante um deploy) — o refresh
        // falha sem token nenhum. Isso NÃO é motivo para desistir: a página
        // do escritório fica aberta o dia todo, então continuamos tentando
        // com o mesmo backoff exponencial em vez de deixar a conexão morta
        // para sempre.
        scheduleReconnect()
        return
      }

      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const version = mapId ? `&mapId=${encodeURIComponent(mapId)}` : ''
      ws = new WebSocket(
        `${scheme}://${window.location.host}/api/office/ws?token=${encodeURIComponent(token)}${version}`,
      )

      ws.onopen = () => {
        attempts = 0
        setConnected(true)
        bridge.setConnected(true)
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        let message: OfficeServerMessage
        try {
          message = JSON.parse(ev.data) as OfficeServerMessage
        } catch {
          return
        }
        bridge.emitServerMessage(message)
      }
      ws.onclose = () => {
        setConnected(false)
        bridge.setConnected(false)
        if (closedByUs) return
        scheduleReconnect()
      }
      ws.onerror = () => ws?.close()
    }
    void connect()

    return () => {
      closedByUs = true
      unsubscribeMove()
      unsubscribeClient()
      unsubscribeServer()
      window.removeEventListener('pagehide', leaveOnPageHide)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
      ws = null
    }
  }, [bridge, mapId, guestToken])

  return { occupants, youId, connected, editorUserIds, karts, balls }
}
