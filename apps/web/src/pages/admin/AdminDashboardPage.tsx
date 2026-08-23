import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { AdminDashboardResponse, SectorDashboardCardDTO, VotingPeriodState } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'

const STATE_LABELS: Record<VotingPeriodState, string> = {
  SCHEDULED: 'Agendado',
  ACTIVE: 'Ativo',
  ENDED: 'Encerrado',
}

const STATE_BADGE_CLASSES: Record<VotingPeriodState, string> = {
  SCHEDULED: 'bg-tertiary-container/40 text-tertiary',
  ACTIVE: 'bg-primary/15 text-primary',
  ENDED: 'bg-outline-variant/30 text-on-surface-variant',
}

function PeriodStateBadge({ state }: { state: VotingPeriodState }) {
  return (
    <span
      className={`rounded-full px-sm py-[2px] font-label text-label-sm ${STATE_BADGE_CLASSES[state] ?? 'bg-outline-variant/30 text-on-surface-variant'}`}
    >
      {STATE_LABELS[state] ?? state}
    </span>
  )
}

function SectorCard({ card }: { card: SectorDashboardCardDTO }) {
  return (
    <div className="flex flex-col gap-sm rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
      <div className="flex items-center justify-between gap-sm">
        <h3 className="font-headline text-headline-md text-on-surface">{card.sectorName}</h3>
        {card.period && <PeriodStateBadge state={card.period.state} />}
      </div>

      <p className="font-label text-label-sm text-on-surface-variant">{card.activeUserCount} usuários ativos</p>

      {card.period && card.period.state === 'ACTIVE' ? (
        <p className="text-body-sm text-on-surface-variant">
          Período {card.period.monthRef} — {card.period.votesCast} votos de {card.activeUserCount} colaboradores
        </p>
      ) : card.period ? (
        <p className="text-body-sm text-on-surface-variant">Período {card.period.monthRef}.</p>
      ) : (
        <p className="text-body-sm text-on-surface-variant">Sem período agendado ou ativo.</p>
      )}

      {card.pendingHighlight && (
        <p className="flex items-center gap-xs text-body-sm text-error">
          <Icon name="warning" className="text-[16px]" />
          Destaque pendente de gerar/publicar
        </p>
      )}

      <Link to="/admin/periodos" className="mt-sm inline-block font-label text-label-sm text-primary hover:underline">
        Ver períodos
      </Link>
    </div>
  )
}

export function AdminDashboardPage() {
  const dashboardQuery = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => apiFetch<AdminDashboardResponse>('/admin/dashboard'),
  })
  const sectors = dashboardQuery.data?.sectors ?? []

  return (
    <section className="flex flex-col gap-lg">
      <header>
        <h2 className="font-headline text-headline-lg text-on-surface">Dashboard</h2>
        <p className="mt-2 text-body-md text-on-surface-variant">Resumo operacional por setor.</p>
      </header>

      {dashboardQuery.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}

      {dashboardQuery.isError && (
        <div className="flex items-center gap-sm rounded-lg border border-error/40 bg-error-container/20 p-lg text-on-error-container">
          <Icon name="error" className="text-[20px]" />
          Erro ao carregar o dashboard.
        </div>
      )}

      {!dashboardQuery.isLoading && !dashboardQuery.isError && sectors.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhum setor cadastrado ainda.</p>
      )}

      {!dashboardQuery.isLoading && !dashboardQuery.isError && sectors.length > 0 && (
        <div className="grid gap-lg sm:grid-cols-2 lg:grid-cols-3">
          {sectors.map((card) => (
            <SectorCard key={card.sectorId} card={card} />
          ))}
        </div>
      )}
    </section>
  )
}
