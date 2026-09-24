import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BADGE_CLAIM_STATUS_LABELS,
  BADGE_KINDS,
  BADGE_KIND_LABELS,
  type AwardedBadgeDTO,
  type BadgeCatalogEntryDTO,
  type BadgeClaimDTO,
  type BadgeKind,
} from '@legends/shared'
import { apiFetch } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { BadgesSkeleton } from './Skeleton'
import { BadgeEmblem } from './BadgeEmblem'
import { BadgeClaimDialog } from './BadgeClaimDialog'
import { Icon } from './Icon'

type KindFilter = BadgeKind | 'ALL'

/**
 * Galeria de selos do usuário, com filtro por tipo. O filtro é client-side —
 * `GET /badges` devolve o catálogo inteiro e não recebe parâmetro.
 */
export function BadgesGallery() {
  const { user } = useAuth()
  const [kind, setKind] = useState<KindFilter>('ALL')
  const [reivindicando, setReivindicando] = useState<BadgeCatalogEntryDTO | null>(null)

  const catalogQuery = useQuery({
    queryKey: ['badges'],
    queryFn: () => apiFetch<{ badges: BadgeCatalogEntryDTO[] }>('/badges'),
  })
  const earnedQuery = useQuery({
    queryKey: ['badges', 'me', user?.id],
    queryFn: () => apiFetch<{ badges: AwardedBadgeDTO[] }>(`/users/${user!.id}/badges`),
    enabled: Boolean(user),
  })
  // As reivindicações desta pessoa: é o que troca o botão pelo estado da fila
  // depois de enviada (Documento 4, seção 11.2).
  const claimsQuery = useQuery({
    queryKey: ['badgeClaims', 'me'],
    queryFn: () => apiFetch<{ claims: BadgeClaimDTO[] }>('/me/badge-claims'),
    enabled: Boolean(user),
  })

  const earnedSlugs = new Set(earnedQuery.data?.badges.map((entry) => entry.badge.slug))
  // A mais recente por selo — a lista vem do servidor em ordem decrescente.
  const claimByBadgeId = new Map<string, BadgeClaimDTO>()
  for (const claim of claimsQuery.data?.claims ?? []) {
    if (!claimByBadgeId.has(claim.badge.id)) claimByBadgeId.set(claim.badge.id, claim)
  }
  const catalog = catalogQuery.data?.badges ?? []
  // Arrays derivados: usados só no JSX, nunca em dep array nem em setState.
  const availableKinds = BADGE_KINDS.filter((option) => catalog.some((badge) => badge.kind === option))
  const visible = kind === 'ALL' ? catalog : catalog.filter((badge) => badge.kind === kind)

  return (
    <div className="flex flex-col gap-lg">
      {catalogQuery.isError && (
        <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          Erro ao carregar os selos.
        </p>
      )}

      {catalogQuery.isLoading && <BadgesSkeleton />}

      {!catalogQuery.isLoading && availableKinds.length > 1 && (
        <div className="flex flex-wrap gap-sm" role="group" aria-label="Filtrar selos por tipo">
          {(['ALL', ...availableKinds] as KindFilter[]).map((option) => {
            const active = option === kind
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => setKind(option)}
                className={`rounded-full px-lg py-sm font-label text-label-md transition ${
                  active
                    ? 'bg-primary text-on-primary'
                    : 'border border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {option === 'ALL' ? 'Todos' : BADGE_KIND_LABELS[option]}
              </button>
            )
          })}
        </div>
      )}

      {!catalogQuery.isLoading && visible.length === 0 && catalog.length > 0 && (
        <p className="text-body-md text-on-surface-variant">Nenhum selo desse tipo por aqui ainda.</p>
      )}

      {!catalogQuery.isLoading && (
        <ul className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((badge) => {
            const earned = earnedSlugs.has(badge.slug)
            const pct =
              badge.progress && badge.progress.target > 0
                ? Math.min(100, Math.round((badge.progress.current / badge.progress.target) * 100))
                : 0
            return (
              <li
                key={badge.id}
                className={`flex flex-col items-center gap-sm rounded-xl border p-lg text-center ${
                  earned ? 'border-primary bg-surface-container' : 'border-outline-variant bg-surface-container'
                }`}
              >
                {/*
                  Selo bloqueado esmaece o EMBLEMA, não o card inteiro.
                  `opacity` no container atinge o texto junto, e opacidade em
                  texto empurra a cor na direção do fundo: no tema escuro isso
                  só tira brilho, mas no claro desbota até sumir (o mesmo
                  `on-surface-variant` cai de 5.3:1 para 2.5:1 a 60%). O
                  emblema é decoração e pode apagar à vontade.
                */}
                <div className={earned ? undefined : 'opacity-50 grayscale'}>
                  <BadgeEmblem badge={badge} size={72} />
                </div>
                <p className="flex items-center gap-sm font-headline text-title-md text-on-surface">
                  {badge.name}
                  {earned && (
                    <span className="font-label text-label-sm uppercase tracking-widest text-secondary">
                      conquistado
                    </span>
                  )}
                </p>
                <p className="text-body-sm text-on-surface-variant">{badge.description}</p>
                <p className="font-label text-label-sm text-on-surface-variant">{badge.requirement}</p>
                {!earned && badge.progress && (
                  <div className="w-full">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-xs font-label text-label-sm text-on-surface-variant">
                      {Math.min(badge.progress.current, badge.progress.target)}/{badge.progress.target}
                    </p>
                  </div>
                )}

                {/*
                  Reivindicar só faz sentido no selo que a pessoa ainda não tem.
                  Solicitação em análise ou aprovada ocupa o lugar do botão — sem
                  isso, o caminho natural depois de enviar seria enviar de novo.
                  Recusada volta a oferecer o botão: recusar existe para a pessoa
                  tentar de novo com uma comprovação melhor.
                */}
                {!earned && (() => {
                  const claim = claimByBadgeId.get(badge.id)
                  if (claim && claim.status !== 'REJECTED') {
                    return (
                      <p className="font-label text-label-sm text-primary">
                        Solicitação {BADGE_CLAIM_STATUS_LABELS[claim.status].toLowerCase()}
                      </p>
                    )
                  }
                  return (
                    <div className="flex flex-col items-center gap-xs">
                      {claim?.status === 'REJECTED' && claim.rejectionReason && (
                        <p className="text-body-sm text-error">Recusada: {claim.rejectionReason}</p>
                      )}
                      <button
                        type="button"
                        onClick={() => setReivindicando(badge)}
                        className="rounded-full border border-outline-variant/60 px-md py-1 font-label text-label-sm text-primary transition-colors hover:border-primary"
                      >
                        {claim?.status === 'REJECTED' ? 'Reivindicar de novo' : 'Reivindicar'}
                      </button>
                    </div>
                  )
                })()}
              </li>
            )
          })}
        </ul>
      )}

      {reivindicando && (
        <BadgeClaimDialog badge={reivindicando} onClose={() => setReivindicando(null)} />
      )}
    </div>
  )
}
