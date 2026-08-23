import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateCalendarSettingsRequest } from '@legends/shared'
import { ApiError } from '../../lib/api'
import { getCalendarSettings, updateCalendarSettings } from '../../lib/calendar-api'
import { Icon } from '../../components/Icon'
import { Panel, inputCls } from './shared'

const QUERY_KEY = ['admin', 'calendar-settings']

/**
 * Credenciais OAuth por empresa (BYO app). O secret nunca volta da API: campo
 * vazio com placeholder "configurado" significa "mantém o atual" — só enviamos
 * `clientSecret` quando o admin digita um valor novo.
 */
export function CalendarSection() {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: QUERY_KEY, queryFn: getCalendarSettings })
  const [message, setMessage] = useState<string | null>(null)

  const [googleClientId, setGoogleClientId] = useState('')
  const [googleSecret, setGoogleSecret] = useState('')
  const [msClientId, setMsClientId] = useState('')
  const [msSecret, setMsSecret] = useState('')
  const [msTenantId, setMsTenantId] = useState('')

  // Hidrata os campos só na primeira carga bem-sucedida. Depois disso o
  // formulário passa a ser dono do valor: revalidações da query (foco de
  // janela, invalidação após salvar o *outro* provedor) não podem pisar em
  // texto que o admin está digitando e ainda não salvou.
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!settings.data || hydratedRef.current) return
    hydratedRef.current = true
    setGoogleClientId(settings.data.google.clientId ?? '')
    setMsClientId(settings.data.microsoft.clientId ?? '')
    setMsTenantId(settings.data.microsoft.tenantId ?? '')
  }, [settings.data])

  // Duas mutations independentes: salvar um provedor só pode limpar o
  // secret digitado daquele provedor, nunca do outro.
  const saveGoogle = useMutation({
    mutationFn: (patch: NonNullable<UpdateCalendarSettingsRequest['google']>) =>
      updateCalendarSettings({ google: patch }),
    onSuccess: () => {
      setMessage('Configuração salva.')
      setGoogleSecret('')
      qc.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (err) => setMessage(err instanceof ApiError ? err.message : 'Erro ao salvar configuração.'),
  })

  const saveMicrosoft = useMutation({
    mutationFn: (patch: NonNullable<UpdateCalendarSettingsRequest['microsoft']>) =>
      updateCalendarSettings({ microsoft: patch }),
    onSuccess: () => {
      setMessage('Configuração salva.')
      setMsSecret('')
      qc.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (err) => setMessage(err instanceof ApiError ? err.message : 'Erro ao salvar configuração.'),
  })

  function submitGoogle(event: FormEvent) {
    event.preventDefault()
    const patch: NonNullable<UpdateCalendarSettingsRequest['google']> = { clientId: googleClientId.trim() }
    if (googleSecret) patch.clientSecret = googleSecret
    saveGoogle.mutate(patch)
  }

  function submitMicrosoft(event: FormEvent) {
    event.preventDefault()
    const patch: NonNullable<UpdateCalendarSettingsRequest['microsoft']> = {
      clientId: msClientId.trim(),
      tenantId: msTenantId.trim(),
    }
    if (msSecret) patch.clientSecret = msSecret
    saveMicrosoft.mutate(patch)
  }

  const secretPlaceholder = (configured: boolean) => (configured ? 'configurado' : 'cole o client secret')

  return (
    <div className="flex flex-col gap-lg">
      <Panel title="Google Calendar">
        <form onSubmit={submitGoogle} className="flex flex-col gap-md">
          <p className="text-body-sm text-on-surface-variant">
            Registre este redirect URI no seu app do Google Cloud:{' '}
            <code className="font-mono text-body-sm">{settings.data?.google.redirectUri}</code>
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Client ID</span>
            <input
              value={googleClientId}
              onChange={(event) => setGoogleClientId(event.target.value)}
              aria-label="Client ID do Google Calendar"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Client Secret</span>
            <input
              type="password"
              value={googleSecret}
              onChange={(event) => setGoogleSecret(event.target.value)}
              aria-label="Client Secret do Google Calendar"
              placeholder={secretPlaceholder(settings.data?.google.configured ?? false)}
              className={inputCls}
            />
          </label>
          <button
            type="submit"
            disabled={saveGoogle.isPending}
            aria-label="Salvar Google Calendar"
            className="inline-flex w-fit items-center gap-sm rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            <Icon name="save" className="text-[18px]" />
            Salvar
          </button>
        </form>
      </Panel>

      <Panel title="Microsoft 365">
        <form onSubmit={submitMicrosoft} className="flex flex-col gap-md">
          <p className="text-body-sm text-on-surface-variant">
            Registre este redirect URI no seu app do Entra ID:{' '}
            <code className="font-mono text-body-sm">{settings.data?.microsoft.redirectUri}</code>
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Client ID</span>
            <input
              value={msClientId}
              onChange={(event) => setMsClientId(event.target.value)}
              aria-label="Client ID da Microsoft"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Client Secret</span>
            <input
              type="password"
              value={msSecret}
              onChange={(event) => setMsSecret(event.target.value)}
              aria-label="Client Secret da Microsoft"
              placeholder={secretPlaceholder(settings.data?.microsoft.configured ?? false)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Tenant ID</span>
            <input
              value={msTenantId}
              onChange={(event) => setMsTenantId(event.target.value)}
              aria-label="Tenant ID"
              className={inputCls}
            />
          </label>
          <button
            type="submit"
            disabled={saveMicrosoft.isPending}
            aria-label="Salvar Microsoft 365"
            className="inline-flex w-fit items-center gap-sm rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            <Icon name="save" className="text-[18px]" />
            Salvar
          </button>
        </form>
      </Panel>

      {message && (
        <p role="status" className="flex items-center gap-sm text-body-sm text-on-surface-variant">
          <Icon name={message.includes('Erro') ? 'error' : 'check_circle'} className="text-[18px] text-primary" />
          {message}
        </p>
      )}
    </div>
  )
}
