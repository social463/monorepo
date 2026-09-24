import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../lib/api'
import { getDevelopmentSettings, updateDevelopmentSettings } from '../../lib/pdi-api'
import { Icon } from '../../components/Icon'
import { Panel, inputCls } from './shared'

/**
 * Configuração da aba Desenvolvimento: se concluir uma ação de PDI exige a
 * validação do líder e a URL do ImpulseUP (Avaliações e Pesquisas). As duas são
 * por empresa — sem URL, o item externo simplesmente não aparece no menu.
 */
export function DevelopmentSection() {
  const qc = useQueryClient()
  const [impulseUpUrl, setImpulseUpUrl] = useState('')
  const [inovaModuleEnabled, setInovaModuleEnabled] = useState(false)
  const [inovaTeamsWebhookUrl, setInovaTeamsWebhookUrl] = useState('')
  const [leaderApprovalRequired, setLeaderApprovalRequired] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  const settings = useQuery({ queryKey: ['development', 'settings'], queryFn: getDevelopmentSettings })

  useEffect(() => {
    if (settings.data) {
      setImpulseUpUrl(settings.data.settings.impulseUpUrl ?? '')
      setInovaModuleEnabled(settings.data.settings.inovaModuleEnabled)
      setInovaTeamsWebhookUrl(settings.data.settings.inovaTeamsWebhookUrl ?? '')
      setLeaderApprovalRequired(settings.data.settings.leaderApprovalRequired)
    }
  }, [settings.data])

  const save = useMutation({
    mutationFn: () =>
      updateDevelopmentSettings({
        impulseUpUrl: impulseUpUrl.trim() || null,
        inovaModuleEnabled,
        inovaTeamsWebhookUrl: inovaTeamsWebhookUrl.trim() || null,
        leaderApprovalRequired,
      }),
    onSuccess: () => {
      setMessage('Configuração salva.')
      qc.invalidateQueries({ queryKey: ['development', 'settings'] })
    },
    onError: (err) => setMessage(err instanceof ApiError ? err.message : 'Erro ao salvar configuração.'),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }

  return (
    <Panel title="Desenvolvimento (Aprendizado e PDI)">
      <form onSubmit={handleSubmit} className="flex flex-col gap-md">
        <label className="flex items-start gap-sm">
          <input
            type="checkbox"
            checked={leaderApprovalRequired}
            onChange={(event) => setLeaderApprovalRequired(event.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-label text-label-md text-on-surface">Exigir validação do líder no PDI</span>
            <span className="block text-body-sm text-on-surface-variant">
              Com a opção ligada, a ação concluída vai para a fila do líder do plano. Desligada, ela conclui direto.
            </span>
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">URL do ImpulseUP</span>
          <input
            value={impulseUpUrl}
            onChange={(event) => setImpulseUpUrl(event.target.value)}
            aria-label="URL do ImpulseUP (Avaliações e Pesquisas)"
            placeholder="https://sua-empresa.impulseup.com/"
            className={inputCls}
          />
          <span className="text-body-sm text-on-surface-variant">
            Sem URL configurada, o item "Avaliações" não aparece no menu.
          </span>
        </label>

        <label className="flex items-start gap-sm">
          <input
            type="checkbox"
            checked={inovaModuleEnabled}
            onChange={(event) => setInovaModuleEnabled(event.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-label text-label-md text-on-surface">Habilitar Comunidade INOVA</span>
            <span className="block text-body-sm text-on-surface-variant">
              Liga o módulo nativo de projetos de inovação. Sem esta opção, o item some do menu.
            </span>
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">
            Webhook do Teams para notificações do INOVA
          </span>
          <input
            value={inovaTeamsWebhookUrl}
            onChange={(event) => setInovaTeamsWebhookUrl(event.target.value)}
            aria-label="Webhook do Teams para notificações do INOVA"
            placeholder="https://.../IncomingWebhook/..."
            className={inputCls}
          />
          <span className="text-body-sm text-on-surface-variant">
            G&amp;G recebe um aviso aqui a cada projeto criado ou atualizado. Sem URL, nenhuma notificação é enviada.
          </span>
        </label>

        {message && (
          <p role="status" className="flex items-center gap-sm text-body-sm text-on-surface-variant">
            <Icon name={message.includes('Erro') ? 'error' : 'check_circle'} className="text-[18px] text-primary" />
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={save.isPending}
          className="inline-flex w-fit items-center gap-sm rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          <Icon name="save" className="text-[18px]" />
          Salvar
        </button>
      </form>
    </Panel>
  )
}
