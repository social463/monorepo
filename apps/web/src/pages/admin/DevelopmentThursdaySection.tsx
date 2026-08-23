import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../lib/api'
import { getDevelopmentThursdaySettings, updateDevelopmentThursdaySettings } from '../../lib/development-thursday-api'
import { Icon } from '../../components/Icon'
import { Panel, inputCls } from './shared'

export function DevelopmentThursdaySection() {
  const qc = useQueryClient()
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const settings = useQuery({
    queryKey: ['admin', 'development-thursday-settings'],
    queryFn: getDevelopmentThursdaySettings,
  })

  useEffect(() => {
    if (settings.data) setTeamsWebhookUrl(settings.data.settings.teamsWebhookUrl ?? '')
  }, [settings.data])

  const updateSettings = useMutation({
    mutationFn: () => updateDevelopmentThursdaySettings({ teamsWebhookUrl: teamsWebhookUrl.trim() || null }),
    onSuccess: () => {
      setMessage('Configuração salva.')
      qc.invalidateQueries({ queryKey: ['admin', 'development-thursday-settings'] })
    },
    onError: (err) => setMessage(err instanceof ApiError ? err.message : 'Erro ao salvar configuração.'),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    updateSettings.mutate()
  }

  return (
    <Panel title="Quinta de Desenvolvimento">
      <form onSubmit={handleSubmit} className="flex flex-col gap-md">
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">URL do chat Teams</span>
          <input
            value={teamsWebhookUrl}
            onChange={(event) => setTeamsWebhookUrl(event.target.value)}
            aria-label="URL do chat Teams da Quinta de Desenvolvimento"
            placeholder="URL do fluxo Teams (Power Automate)"
            className={inputCls}
          />
        </label>
        {message && (
          <p role="status" className="flex items-center gap-sm text-body-sm text-on-surface-variant">
            <Icon name={message.includes('Erro') ? 'error' : 'check_circle'} className="text-[18px] text-primary" />
            {message}
          </p>
        )}
        <button type="submit" disabled={updateSettings.isPending} className="inline-flex w-fit items-center gap-sm rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant">
          <Icon name="save" className="text-[18px]" />
          Salvar
        </button>
      </form>
    </Panel>
  )
}
