import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { OneOnOneEvent } from '@legends/shared'
import { getAccessToken, refreshAccessToken } from './api'

/** A agenda (`/1-1`), com uma entrada por janela de datas consultada. */
const AGENDA_KEY = ['one-on-ones'] as const
/** Prefixo dos detalhes: `['one-on-one', id]`. Invalidar o prefixo pega o aberto. */
const ENCONTRO_KEY = ['one-on-one'] as const
const PDI_KEY = ['pdi'] as const

/**
 * Mantém uma conexão WebSocket com o canal de 1:1 da pessoa enquanto a rota
 * está montada. Ao receber um evento, invalida a query relevante do React Query
 * — eventos magros, então o refetch é que traz o estado já com o recorte de
 * quem está olhando (a nota privada do outro participante nunca vem junto).
 *
 * Os detalhes são invalidados pelo PREFIXO `['one-on-one']`, e não pelo id do
 * encontro: combinado em aberto pertence ao PAR e aparece em todo encontro
 * entre as duas pessoas, então uma ação concluída num 1:1 muda também a tela do
 * anterior. Como o canal só entrega eventos dos próprios 1:1 de quem está
 * conectado, invalidar os detalhes em cache custa quase nada e nunca erra.
 */
export function useOneOnOneSocket(): void {
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
      ws = new WebSocket(`${scheme}://${window.location.host}/api/one-on-ones/ws?token=${token}`)

      ws.onopen = () => {
        attempts = 0
        // Reconectou: enquanto o socket esteve fora do ar pode ter mudado
        // qualquer coisa, e nenhum evento perdido volta.
        qc.invalidateQueries({ queryKey: AGENDA_KEY })
        qc.invalidateQueries({ queryKey: ENCONTRO_KEY })
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        let e: OneOnOneEvent
        try {
          e = JSON.parse(ev.data) as OneOnOneEvent
        } catch {
          return
        }
        if (e.type === 'agenda:changed') {
          qc.invalidateQueries({ queryKey: AGENDA_KEY })
          qc.invalidateQueries({ queryKey: ENCONTRO_KEY })
          return
        }
        if (e.type === 'meeting:changed') {
          qc.invalidateQueries({ queryKey: [...ENCONTRO_KEY, e.meetingId] })
          // A lista mostra "sem pauta": tópico novo também muda o cartão de lá.
          qc.invalidateQueries({ queryKey: AGENDA_KEY })
          return
        }
        if (e.type === 'actions:changed') {
          qc.invalidateQueries({ queryKey: ENCONTRO_KEY })
          // …e o contador de combinados em aberto na agenda.
          qc.invalidateQueries({ queryKey: AGENDA_KEY })
          return
        }
        if (e.type === 'pdi:changed') {
          qc.invalidateQueries({ queryKey: PDI_KEY })
          // O bloco "Plano de X" mora no detalhe do encontro.
          qc.invalidateQueries({ queryKey: ENCONTRO_KEY })
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
