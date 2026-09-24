import { useEffect, useRef, useState } from 'react'
import type { ArenaLobbyClientMessage, ArenaLobbyServerMessage } from '@legends/shared'
import { getAccessToken, refreshAccessToken } from '../lib/api'

export interface ArenaLobbyConnection {
  connected: boolean
  send(message: ArenaLobbyClientMessage): void
}

/**
 * Conexão com o saguão enquanto o menu está aberto.
 *
 * Gêmea do `useArenaSocket` (mesma dança de token, StrictMode e reconexão) e
 * separada por causa do que o saguão NÃO é: aqui não há input, nem snapshot,
 * nem cena — o estado cabe em React, e por isso este hook devolve as mensagens
 * pelo callback e a página guarda a lista.
 *
 * `enabled: false` significa NÃO conectar: quem está em campo não fica no
 * saguão.
 */
export function useArenaLobbySocket(
  enabled: boolean,
  onMessage: (message: ArenaLobbyServerMessage) => void,
): ArenaLobbyConnection {
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)
  const handlerRef = useRef(onMessage)
  handlerRef.current = onMessage

  useEffect(() => {
    if (!enabled) return
    let closedByUs = false
    let attempts = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let ws: WebSocket | null = null

    async function connect() {
      if (closedByUs) return
      let token = getAccessToken()
      if (attempts > 0 || !token) {
        await refreshAccessToken()
        token = getAccessToken()
      }
      if (!token || closedByUs) return

      const url = new URL('/api/arena/lobby/ws', window.location.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('token', token)

      const socket = new WebSocket(url)
      ws = socket
      socketRef.current = socket
      socket.onopen = () => {
        // Segunda montagem do StrictMode: este socket já foi substituído.
        if (socketRef.current !== socket) return socket.close()
        attempts = 0
        setConnected(true)
      }
      socket.onmessage = (event) => {
        try {
          handlerRef.current(JSON.parse(String(event.data)) as ArenaLobbyServerMessage)
        } catch {
          // pacote malformado não derruba o saguão
        }
      }
      socket.onclose = () => {
        // Só o socket ATUAL mexe no ref (ver o comentário longo em `useArenaSocket`).
        if (socketRef.current !== socket) return
        socketRef.current = null
        setConnected(false)
        if (closedByUs) return
        attempts += 1
        reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** attempts, 15_000))
      }
      socket.onerror = () => socket.close()
    }

    // `catch` explícito: `connect` faz `await refreshAccessToken()`, e um
    // refresh que falha (sessão morta, rede fora) viraria rejeição sem dono —
    // ruído no console em produção e erro não tratado no teste. Ficar sem
    // saguão já é o comportamento correto nesse caso.
    connect().catch(() => {})

    return () => {
      closedByUs = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
      socketRef.current = null
    }
  }, [enabled])

  return {
    connected,
    send(message) {
      const ws = socketRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
    },
  }
}
