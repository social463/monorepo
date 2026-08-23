import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { trackPageView } from '../lib/analytics'

/**
 * Registra a navegação autenticada atual no `AccessLog` (base do People
 * Analytics em `/admin/pessoas`).
 *
 * Duas garantias, ambas exigidas pelo PBI:
 *
 * 1. **Um registro por rota.** A guarda `lastLoggedRef` compara com o último
 *    path enviado, então re-render da mesma tela não grava de novo — só a
 *    troca de rota grava. (É o `lastLogged` do portal EMR.)
 * 2. **Best-effort.** A promessa é engolida: um erro de rede ou um 4xx aqui é
 *    telemetria perdida, nunca um erro que suba para a tela de quem navega.
 *
 * Só o `pathname` é enviado — nunca `search` nem `hash`, que podem carregar
 * termo de busca e outros dados do usuário.
 *
 * O mesmo page view também vai para o GA4, quando configurado. O `AccessLog`
 * continua sendo a fonte de verdade (é dele que saem o People Analytics e o
 * painel de adoção do super-admin); o GA4 é onde a análise de comportamento
 * acontece. Como o hook mora no `AppLayout`, a cobertura é a das telas
 * autenticadas do produto — `/login`, `/escritorio` e `/super-admin` ficam de
 * fora dos dois, e é a mesma cobertura de antes.
 */
export function useAccessLogPing(enabled: boolean): void {
  const { pathname } = useLocation()
  const lastLoggedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (lastLoggedRef.current === pathname) return
    lastLoggedRef.current = pathname
    trackPageView(pathname)
    void apiFetch('/access-logs', { method: 'POST', body: JSON.stringify({ path: pathname }) }).catch(() => {
      // Telemetria não pode quebrar navegação: falhou, esquece.
    })
  }, [enabled, pathname])
}
