import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BADGE_CLAIM_REJECTION_REASON_MAX_LENGTH,
  BADGE_CLAIM_STATUS_LABELS,
  type BadgeClaimDTO,
  type BadgeClaimStatus,
} from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { BadgeEmblem } from '../../components/BadgeEmblem'
import { Panel, inputCls } from './shared'

const ABAS: { key: BadgeClaimStatus; label: string }[] = [
  { key: 'PENDING', label: 'Pendentes' },
  { key: 'APPROVED', label: 'Aprovadas' },
  { key: 'REJECTED', label: 'Recusadas' },
]

/**
 * Fila de reivindicações de selo (Documento 4, seções 11.2 e 11.3).
 *
 * Fica **no topo** do Painel de Emblemas: é a única parte da tela com trabalho
 * esperando alguém: catálogo se lê quando dá, solicitação pendente segura uma
 * pessoa do outro lado.
 */
export function BadgeClaimsQueue() {
  const queryClient = useQueryClient()
  const [aba, setAba] = useState<BadgeClaimStatus>('PENDING')
  const [motivoDe, setMotivoDe] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<string | null>(null)

  const claimsQuery = useQuery({
    queryKey: ['admin', 'badgeClaims', aba],
    queryFn: () => apiFetch<{ claims: BadgeClaimDTO[] }>(`/admin/badge-claims?status=${aba}`),
  })

  function aoTerminar() {
    setErro(null)
    // Todas as abas: aprovar tira de Pendentes e põe em Aprovadas.
    queryClient.invalidateQueries({ queryKey: ['admin', 'badgeClaims'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'userBadges'] })
  }

  const aprovar = useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`/admin/badge-claims/${id}/approve`, { method: 'POST' }),
    onSuccess: aoTerminar,
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Erro ao aprovar a solicitação.'),
  })

  const recusar = useMutation({
    mutationFn: (vars: { id: string; reason: string }) =>
      apiFetch<unknown>(`/admin/badge-claims/${vars.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: vars.reason }),
      }),
    onSuccess: aoTerminar,
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Erro ao recusar a solicitação.'),
  })

  const claims = claimsQuery.data?.claims ?? []

  return (
    <Panel title="Solicitações de emblema">
      <div
        role="tablist"
        aria-label="Status das solicitações"
        className="mb-md flex gap-1 rounded-xl border border-outline-variant/40 bg-surface-container-low p-1"
      >
        {ABAS.map((item) => {
          const ativa = aba === item.key
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={ativa}
              onClick={() => setAba(item.key)}
              className={[
                'flex flex-1 items-center justify-center rounded-lg px-md py-sm font-label text-label-md transition-colors',
                ativa
                  ? 'bg-primary/10 font-bold text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
              ].join(' ')}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      {erro && (
        <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {erro}
        </p>
      )}

      {claims.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          {aba === 'PENDING' ? 'Nenhuma solicitação esperando análise.' : 'Nada por aqui.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-md">
          {claims.map((claim) => (
            <li
              key={claim.id}
              className="flex flex-col gap-sm rounded-lg border border-outline-variant/20 bg-surface-container-low p-md"
            >
              <div className="flex items-start gap-md">
                <BadgeEmblem badge={claim.badge} size={40} />
                <div className="min-w-0 flex-grow">
                  <p className="font-label text-label-md text-on-surface">
                    {claim.user.name} · {claim.badge.name}
                  </p>
                  <p className="whitespace-pre-wrap text-body-sm text-on-surface-variant">{claim.story}</p>
                  <div className="mt-xs flex flex-wrap items-center gap-md">
                    {claim.attachmentUrl && (
                      <a
                        href={claim.attachmentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-xs font-label text-label-sm text-primary hover:underline"
                      >
                        <Icon name="attach_file" className="text-[16px]" />
                        Ver comprovação
                      </a>
                    )}
                    {claim.link && (
                      <a
                        href={claim.link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-xs font-label text-label-sm text-primary hover:underline"
                      >
                        <Icon name="link" className="text-[16px]" />
                        Link enviado
                      </a>
                    )}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-surface-container-high px-sm py-[2px] font-label text-label-sm text-on-surface-variant">
                  {BADGE_CLAIM_STATUS_LABELS[claim.status]}
                </span>
              </div>

              {claim.status === 'REJECTED' && claim.rejectionReason && (
                <p className="text-body-sm text-error">Motivo: {claim.rejectionReason}</p>
              )}

              {claim.status === 'PENDING' && (
                <div className="flex flex-wrap items-center gap-sm">
                  <input
                    className={`${inputCls} min-w-[16rem] flex-grow`}
                    value={motivoDe[claim.id] ?? ''}
                    maxLength={BADGE_CLAIM_REJECTION_REASON_MAX_LENGTH}
                    onChange={(e) => setMotivoDe({ ...motivoDe, [claim.id]: e.target.value })}
                    aria-label={`Motivo da recusa de ${claim.user.name}`}
                    placeholder="Motivo da recusa (obrigatório para recusar)"
                  />
                  <button
                    type="button"
                    disabled={aprovar.isPending}
                    onClick={() => aprovar.mutate(claim.id)}
                    className="rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
                  >
                    Aprovar
                  </button>
                  <button
                    type="button"
                    disabled={recusar.isPending || !(motivoDe[claim.id] ?? '').trim()}
                    onClick={() => recusar.mutate({ id: claim.id, reason: motivoDe[claim.id] ?? '' })}
                    className="rounded-full border border-error/40 px-lg py-sm font-label text-label-md text-error disabled:border-outline-variant/40 disabled:text-on-surface-variant"
                  >
                    Recusar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
