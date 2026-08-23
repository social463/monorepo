import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { AwardedBadgeDTO, BadgeCatalogEntryDTO } from '@legends/shared'
import { apiFetch } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { BadgeEmblem } from './BadgeEmblem'
import { Icon } from './Icon'

/** Anos completos entre a data ISO de entrada e agora. */
function completedYears(iso: string): number {
  const start = new Date(iso)
  const now = new Date()
  let years = now.getFullYear() - start.getFullYear()
  const m = now.getMonth() - start.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < start.getDate())) years--
  return Math.max(0, years)
}

function tenureLabel(iso: string): string {
  const years = completedYears(iso)
  if (years < 1) return 'Menos de 1 ano de casa'
  return years === 1 ? '1 ano de casa' : `${years} anos de casa`
}

const MAX_PROGRESS = 3

/** Card da sidebar da Home: selos conquistados, tempo de casa e próximos selos. */
export function MyStatsCard() {
  const { user } = useAuth()

  const catalogQuery = useQuery({
    queryKey: ['badges'],
    queryFn: () => apiFetch<{ badges: BadgeCatalogEntryDTO[] }>('/badges'),
  })
  const earnedQuery = useQuery({
    queryKey: ['badges', 'me', user?.id],
    queryFn: () => apiFetch<{ badges: AwardedBadgeDTO[] }>(`/users/${user!.id}/badges`),
    enabled: Boolean(user),
  })

  const earnedSlugs = new Set(earnedQuery.data?.badges.map((e) => e.badge.slug))
  const earnedCount = earnedQuery.data?.badges.length ?? 0

  // Selos não conquistados com progresso mensurável.
  const candidates = (catalogQuery.data?.badges ?? []).filter(
    (b) => !earnedSlugs.has(b.slug) && b.progress && b.progress.target > 0,
  )
  // Os selos de tempo de casa formam uma escada (4, 5, 6 anos…) e apareceriam
  // todos de uma vez. Na Home exibimos só o próximo marco (o de menor alvo).
  const nextTenure = candidates
    .filter((b) => b.kind === 'TENURE')
    .reduce<BadgeCatalogEntryDTO | null>(
      (closest, b) =>
        !closest || b.progress!.target < closest.progress!.target ? b : closest,
      null,
    )
  const inProgress = candidates
    .filter((b) => b.kind !== 'TENURE' || b === nextTenure)
    .sort((a, b) => b.progress!.current / b.progress!.target - a.progress!.current / a.progress!.target)
    .slice(0, MAX_PROGRESS)

  return (
    <aside
      data-testid="my-stats-card"
      className="flex flex-col gap-lg rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg"
    >
      <h2 className="font-headline text-headline-md text-on-surface">Minhas Conquistas</h2>

      <div className="flex items-center gap-md">
        <div className="flex flex-col items-center rounded-xl border border-outline-variant/40 bg-surface px-lg py-md">
          <span className="font-label text-label-sm uppercase tracking-widest text-on-surface-variant">
            Selos
          </span>
          <span className="font-headline text-headline-md text-primary tabular-nums">{earnedCount}</span>
        </div>
        {user && (
          <span className="flex items-center gap-1 text-body-sm text-on-surface-variant">
            <Icon name="workspace_premium" className="text-[18px] text-tertiary" />
            {tenureLabel(user.joinedAt)}
          </span>
        )}
      </div>

      {inProgress.length > 0 && (
        <div className="flex flex-col gap-sm">
          <p className="font-label text-label-sm uppercase tracking-widest text-on-surface-variant">
            Próximos selos
          </p>
          <ul className="flex flex-col gap-md">
            {inProgress.map((badge) => {
              const pct = Math.min(
                100,
                Math.round((badge.progress!.current / badge.progress!.target) * 100),
              )
              return (
                <li key={badge.id} className="flex items-center gap-sm">
                  <BadgeEmblem badge={badge} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-label text-label-md text-on-surface">{badge.name}</p>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-on-surface-variant">
                    {Math.min(badge.progress!.current, badge.progress!.target)}/{badge.progress!.target}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <Link
        to="/selos"
        className="group flex items-center justify-center gap-1 font-label text-label-md text-primary"
      >
        <span className="group-hover:underline">Ver Galeria Completa</span>
        <Icon
          name="arrow_forward"
          className="text-[16px] transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </aside>
  )
}
