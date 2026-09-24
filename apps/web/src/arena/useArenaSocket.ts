import { useEffect, useRef, useState } from 'react'
import type { ArenaClientMessage, ArenaServerMessage } from '@legends/shared'
import { getAccessToken, refreshAccessToken } from '../lib/api'

/**
 * Conexão com a arena enquanto a rota está montada.
 *
 * Bem mais magra que a do escritório de propósito: aqui não há snapshot em
 * estado React nem reducer. O estado do jogo vive na cena do Phaser (predição
 * e interpolação são de quadro, não de render), e passar por `useState` faria
 * cada snapshot — vinte por segundo — disparar um render da árvore inteira.
 */
export interface ArenaConnection {
  connected: boolean
  send(message: ArenaClientMessage): void
}

/**
 * `mode: null` significa NÃO conectar — é o que mantém o menu fora da arena.
 * Entrar numa partida só porque a tela abriu poria a pessoa em campo antes de
 * ela escolher o que quer jogar.
 */
export function useArenaSocket(
  mode: string | null,
  onMessage: (message: ArenaServerMessage) => void,
): ArenaConnection {
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)
  const handlerRef = useRef(onMessage)
  handlerRef.current = onMessage

  useEffect(() => {
    if (mode === null) return
    // Fixa o modo já estreitado: a closure de `connect` não herda o
    // estreitamento do guarda acima.
    const modoAtivo: string = mode
    let closedByUs = false
    let attempts = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let ws: WebSocket | null = null

    async function connect() {
      if (closedByUs) return
      // `refreshAccessToken` devolve sucesso, não o token — quem entrega o
      // token é sempre `getAccessToken` (mesmo padrão do socket do escritório).
      let token = getAccessToken()
      if (attempts > 0 || !token) {
        await refreshAccessToken()
        token = getAccessToken()
      }
      if (!token || closedByUs) return

      const url = new URL('/api/arena/ws', window.location.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('token', token)
      // O modo identifica a instância: cada um tem a sua arena, e trocar de
      // modo é trocar de arena — não mexer na partida de quem está jogando.
      url.searchParams.set('modo', modoAtivo)

      const socket = new WebSocket(url)
      ws = socket
      socketRef.current = socket
      socket.onopen = () => {
        // A montagem em StrictMode roda o efeito duas vezes: se este socket já
        // foi substituído enquanto abria, ele não pode reivindicar o ref.
        if (socketRef.current !== socket) return socket.close()
        attempts = 0
        setConnected(true)
      }
      socket.onmessage = (event) => {
        try {
          handlerRef.current(JSON.parse(String(event.data)) as ArenaServerMessage)
        } catch {
          // pacote malformado não derruba a partida
        }
      }
      socket.onclose = () => {
        // Só o socket ATUAL mexe no ref. Sem esta guarda, o `close` do socket
        // descartado pela segunda montagem do StrictMode chega DEPOIS de o
        // novo já ter se registrado e zera o ref dele: a conexão continua
        // aberta e recebendo, mas `send` cai num ref nulo e nada mais sai.
        // O sintoma é cruel — a tela diz "conectado", os outros aparecem, e o
        // seu personagem só anda na predição, sem o servidor nunca saber.
        if (socketRef.current !== socket) return
        socketRef.current = null
        setConnected(false)
        if (closedByUs) return
        attempts += 1
        reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** attempts, 15_000))
      }
      socket.onerror = () => socket.close()
    }

    void connect()

    return () => {
      closedByUs = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'leave-arena' } satisfies ArenaClientMessage))
      }
      ws?.close()
      socketRef.current = null
    }
  }, [mode])

  return {
    connected,
    send(message) {
      const ws = socketRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
    },
  }
}
