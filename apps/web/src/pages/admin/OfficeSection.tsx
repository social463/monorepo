import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  OFFICE_GUEST_INVITE_MAX_MINUTES,
  OFFICE_GUEST_INVITE_MIN_MINUTES,
  type CreateOfficeGuestInviteResponse,
  type OfficeConfigDTO,
  type OfficeGuestInviteDTO,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { useState } from 'react'

const KEY = ['admin', 'office-settings'] as const
const OFFICE_CONFIG_KEY = ['office', 'config'] as const

/** Configurações do escritório virtual — hoje, só o interruptor do alto-falante. */
export function OfficeSection() {
  const queryClient = useQueryClient()
  const [expiresInMinutes, setExpiresInMinutes] = useState(60)
  const [invite, setInvite] = useState<OfficeGuestInviteDTO | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: KEY,
    queryFn: () => apiFetch<OfficeConfigDTO>('/admin/office-settings'),
  })
  const mutation = useMutation({
    mutationFn: (broadcastEnabled: boolean) =>
      apiFetch<OfficeConfigDTO>('/admin/office-settings', {
        method: 'PATCH',
        body: JSON.stringify({ broadcastEnabled }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(KEY, updated)
      queryClient.setQueryData(OFFICE_CONFIG_KEY, updated)
    },
  })

  const enabled = data?.broadcastEnabled ?? false
  const inviteMutation = useMutation({
    mutationFn: (minutes: number) =>
      apiFetch<CreateOfficeGuestInviteResponse>('/admin/office-guest-invites', {
        method: 'POST',
        body: JSON.stringify({ expiresInMinutes: minutes }),
      }),
    onSuccess: (res) => setInvite(res.invite),
  })

  return (
    <section className="flex flex-col gap-lg rounded-lg bg-surface-container p-lg">
      <h3 className="font-headline text-headline-sm text-on-surface">Escritório virtual</h3>
      <div className="mt-md flex items-center justify-between gap-md">
        <div>
          <p className="font-label text-label-lg text-on-surface">Alto-falante</p>
          <p className="font-body text-body-sm text-on-surface-variant">
            Permite que a liderança fale para o escritório inteiro. Custo: mantém uma
            conexão de mídia extra por pessoa no escritório enquanto estiver ativo.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Alto-falante do escritório"
          disabled={isLoading || mutation.isPending}
          onClick={() => mutation.mutate(!enabled)}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
            enabled ? 'bg-primary' : 'bg-surface-container-highest'
          } disabled:bg-surface-container disabled:text-on-surface-variant`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-surface transition-all ${
              enabled ? 'left-6' : 'left-1'
            }`}
          />
        </button>
      </div>

      <div className="border-t border-outline-variant/30 pt-lg">
        <div className="flex flex-col gap-md md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-label text-label-lg text-on-surface">Convite temporário</p>
            <p className="font-body text-body-sm text-on-surface-variant">
              Gera um link de convidado para entrar no escritório com personagem presetado.
            </p>
          </div>
          <label className="flex w-full max-w-xs flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Duração em minutos</span>
            <input
              type="number"
              min={OFFICE_GUEST_INVITE_MIN_MINUTES}
              max={OFFICE_GUEST_INVITE_MAX_MINUTES}
              value={expiresInMinutes}
              onChange={(event) => setExpiresInMinutes(Number(event.target.value))}
              className="rounded-md border border-outline-variant/50 bg-surface px-md py-sm font-body text-body-md text-on-surface outline-none focus:border-primary"
            />
          </label>
          <button
            type="button"
            disabled={inviteMutation.isPending}
            onClick={() => inviteMutation.mutate(expiresInMinutes)}
            className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {inviteMutation.isPending ? 'Criando...' : 'Criar convite'}
          </button>
        </div>

        {inviteMutation.error && (
          <p role="alert" className="mt-sm font-label text-label-sm text-error">
            {inviteMutation.error instanceof Error ? inviteMutation.error.message : 'Não foi possível criar o convite.'}
          </p>
        )}

        {invite && (
          <div className="mt-md rounded-lg border border-outline-variant/40 bg-surface p-md">
            <p className="font-label text-label-sm text-on-surface-variant">
              Expira em {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(invite.expiresAt))}
            </p>
            <div className="mt-sm flex flex-col gap-sm md:flex-row">
              <input
                readOnly
                value={invite.url}
                className="min-w-0 flex-1 rounded-md border border-outline-variant/40 bg-surface-container px-md py-sm font-body text-body-sm text-on-surface"
              />
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(invite.url)}
                className="rounded-md border border-outline-variant/50 px-md py-sm font-label text-label-md text-on-surface transition-colors hover:border-primary"
              >
                Copiar link
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
