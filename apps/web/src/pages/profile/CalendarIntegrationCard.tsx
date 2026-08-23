import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CALENDAR_PROVIDERS,
  CALENDAR_PROVIDER_LABELS,
  type CalendarProviderKey,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import {
  disconnectCalendar,
  getCalendarIntegration,
  startCalendarConnect,
} from '../../lib/calendar-api'

const QUERY_KEY = ['me', 'calendar-integration']

/**
 * Conectar/desconectar a própria agenda. Renderizado só no próprio perfil —
 * é configuração pessoal, não informação de perfil público.
 */
export function CalendarIntegrationCard() {
  const qc = useQueryClient()
  const integration = useQuery({ queryKey: QUERY_KEY, queryFn: getCalendarIntegration })

  const connect = useMutation({
    mutationFn: (provider: CalendarProviderKey) => startCalendarConnect(provider),
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl),
  })

  const disconnect = useMutation({
    mutationFn: (provider: CalendarProviderKey) => disconnectCalendar(provider),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  })

  const available = integration.data?.available ?? []
  const connections = integration.data?.connections ?? []

  return (
    /* Mesma moldura das seções vizinhas do perfil (`rounded-xl`,
       `outline-variant/40`, `bg-surface-container`): o card era o único com
       borda esverdeada, fundo de página e título miúdo, e por isso lia como
       um aviso espremido entre os cartões em vez de uma seção como as outras. */
    <section className="mb-lg rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
      <header className="mb-md">
        <h2 className="font-headline text-title-md text-on-surface">Integrações de calendário</h2>
        <p className="mt-xs text-body-sm text-on-surface-variant">
          Conecte sua agenda para que os 1:1 e as reuniões do escritório apareçam nela.
        </p>
      </header>

      {integration.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}

      {!integration.isLoading && available.length === 0 && (
        <p className="rounded-lg border border-dashed border-outline-variant/50 p-md text-body-sm text-on-surface-variant">
          Seu administrador ainda não configurou nenhum calendário para a empresa.
        </p>
      )}

      <ul className="flex flex-col gap-md">
        {CALENDAR_PROVIDERS.filter((provider) => available.includes(provider)).map((provider) => {
          const label = CALENDAR_PROVIDER_LABELS[provider]
          const connection = connections.find((item) => item.provider === provider)
          const needsReauth = connection?.status === 'needs_reauth'
          const busy = connect.isPending || disconnect.isPending

          return (
            <li key={provider} className="flex items-center justify-between gap-md">
              <div className="flex flex-col">
                <span className="font-label text-label-md text-on-surface">{label}</span>
                {connection && !needsReauth && (
                  <span className="text-body-sm text-on-surface-variant">{connection.accountEmail}</span>
                )}
                {needsReauth && (
                  <span className="flex items-center gap-1 text-body-sm text-error">
                    <Icon name="error" className="text-[16px]" />O acesso expirou. Reconecte sua conta.
                  </span>
                )}
              </div>

              {connection && !needsReauth ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => disconnect.mutate(provider)}
                  aria-label={`Desconectar ${label}`}
                  className="rounded-md border border-primary-container/40 px-md py-sm font-label text-label-sm text-on-surface hover:bg-primary-container/10 disabled:opacity-50"
                >
                  Desconectar
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => connect.mutate(provider)}
                  aria-label={`${needsReauth ? 'Reconectar' : 'Conectar'} ${label}`}
                  className="rounded-md bg-primary px-md py-sm font-label text-label-sm font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
                >
                  {needsReauth ? 'Reconectar' : 'Conectar'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
