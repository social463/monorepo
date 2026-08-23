import { useEffect } from 'react'
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from '@legends/shared'
import { apiFetch } from '../lib/api'

/**
 * Avisa o servidor, de tempos em tempos, que esta pessoa continua na
 * plataforma. É o que acende a bolinha verde do ranking.
 *
 * Três decisões que valem o comentário:
 *
 * 1. **Só com a aba visível.** Aba de fundo esquecida por três dias não é
 *    presença, é uma janela aberta. O `visibilitychange` também bate na hora em
 *    que a aba volta ao primeiro plano, para a bolinha não esperar o próximo
 *    ciclo para reacender.
 * 2. **Best-effort.** A promessa é engolida, como no ping de navegação: perder
 *    um heartbeat apaga uma bolinha, nunca uma tela.
 * 3. **Não invalida query nenhuma.** O ranking se atualiza pelo próprio
 *    `refetchInterval`; disparar invalidação a cada batida faria toda a Home
 *    recarregar de dois em dois minutos.
 */
export function usePresenceHeartbeat(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return

    const beat = () => {
      if (document.visibilityState !== 'visible') return
      void apiFetch('/me/presence', { method: 'POST' }).catch(() => {
        // Presença não pode quebrar navegação: falhou, esquece.
      })
    }

    beat()
    const timer = window.setInterval(beat, PRESENCE_HEARTBEAT_INTERVAL_MS)
    document.addEventListener('visibilitychange', beat)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', beat)
    }
  }, [enabled])
}
