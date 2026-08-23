import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ADOPTION_WINDOWS,
  DEFAULT_ADOPTION_WINDOW,
  analyticsEventLabel,
  type AdoptionOverviewDTO,
  type AdoptionWindow,
  type CompanyAdoptionDTO,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Panel, errorMessage } from '../admin/shared'
import { ErrorBanner, CompanyMonogram, StatCard, StatusChip, ghostBtn } from './shared'

const WINDOW_LABELS: Record<AdoptionWindow, string> = {
  7: '7 dias',
  30: '30 dias',
  90: '90 dias',
}

function formatDate(iso: string | null): string {
  if (!iso) return 'nunca'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * Proporção de gente ativa sobre o total da empresa. É a coluna que diferencia
 * "empresa grande usando pouco" de "empresa pequena usando muito" — o número
 * absoluto de eventos sozinho sempre premia a maior.
 */
function ReachBar({ active, total }: { active: number; total: number }) {
  const pct = total > 0 ? Math.round((active / total) * 100) : 0
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-label text-label-sm text-on-surface-variant">
        {active}/{total} pessoas · {pct}%
      </span>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-outline-variant/30" aria-hidden>
        <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}

function CompanyCard({ company }: { company: CompanyAdoptionDTO }) {
  const [open, setOpen] = useState(false)
  const silenciosa = company.totalEvents === 0

  return (
    <li className="rounded-xl border border-outline-variant/40 bg-surface-container">
      <div className="flex flex-wrap items-center gap-md p-lg">
        <CompanyMonogram name={company.companyName} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-sm">
            <span className="truncate font-headline text-title-md text-on-surface">{company.companyName}</span>
            <StatusChip active={company.active} />
            {/* Empresa ativa e sem nenhum evento é o sinal que o painel existe
                para dar — não some da lista, ganha destaque. */}
            {silenciosa && company.active && (
              <span className="shrink-0 rounded-full bg-error/15 px-sm py-[2px] font-label text-label-sm text-error">
                Sem uso
              </span>
            )}
          </span>
          <span className="font-label text-label-sm text-on-surface-variant">
            {company.totalEvents} {company.totalEvents === 1 ? 'evento' : 'eventos'} · último uso{' '}
            {formatDate(company.lastEventAt)}
          </span>
        </div>

        <div className="w-48 shrink-0">
          <ReachBar active={company.activeUsers} total={company.totalUsers} />
        </div>

        <button
          type="button"
          className={ghostBtn}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          disabled={silenciosa}
        >
          {open ? 'Fechar' : 'Detalhar'}
        </button>
      </div>

      {open && !silenciosa && (
        <div className="grid gap-lg border-t border-outline-variant/40 p-lg md:grid-cols-2">
          <div>
            <h3 className="mb-sm font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
              Por setor
            </h3>
            <ul className="flex flex-col gap-sm">
              {company.sectors.map((sector) => (
                <li key={sector.sectorId} className="flex items-baseline justify-between gap-md">
                  <span className="truncate text-body-md text-on-surface">{sector.sectorName}</span>
                  <span className="shrink-0 font-label text-label-sm text-on-surface-variant">
                    {sector.totalEvents} · {sector.activeUsers}{' '}
                    {sector.activeUsers === 1 ? 'pessoa' : 'pessoas'}
                  </span>
                </li>
              ))}
              {company.sectors.length === 0 && (
                <li className="text-body-sm text-on-surface-variant">Nenhum setor com uso na janela.</li>
              )}
            </ul>
          </div>

          <div>
            <h3 className="mb-sm font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
              O que mais usam
            </h3>
            <ul className="flex flex-col gap-sm">
              {company.topEvents.map((event) => (
                <li key={event.name} className="flex items-baseline justify-between gap-md">
                  <span className="truncate text-body-md text-on-surface">{analyticsEventLabel(event.name)}</span>
                  <span className="shrink-0 font-label text-label-sm text-on-surface-variant">{event.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * Adoção por empresa e por setor — a visão cross-tenant que só a equipe interna
 * enxerga.
 *
 * Os dados vêm do `AnalyticsEvent` no Postgres, e não do GA4 de propósito: o
 * GA4 retém evento por no máximo 14 meses e responder por lá exigiria a Data
 * API, com dado atrasado e amostrado. Aqui a série é completa e imediata.
 */
export function AdoptionPage() {
  const [windowDays, setWindowDays] = useState<AdoptionWindow>(DEFAULT_ADOPTION_WINDOW)

  const query = useQuery({
    queryKey: ['super-admin', 'analytics', windowDays],
    queryFn: () => apiFetch<AdoptionOverviewDTO>(`/super-admin/analytics?days=${windowDays}`),
  })

  const companies = query.data?.companies ?? []
  const comUso = companies.filter((c) => c.totalEvents > 0)
  const semUso = companies.filter((c) => c.totalEvents === 0 && c.active)
  const totalEventos = companies.reduce((sum, c) => sum + c.totalEvents, 0)
  const totalPessoas = companies.reduce((sum, c) => sum + c.activeUsers, 0)

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-wrap items-end justify-between gap-md">
        <div>
          <h1 className="font-headline text-headline-md text-on-surface">Adoção</h1>
          <p className="text-body-md text-on-surface-variant">
            Como cada empresa e cada setor usam o produto.
          </p>
        </div>
        <div className="flex gap-sm" role="group" aria-label="Janela de tempo">
          {ADOPTION_WINDOWS.map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setWindowDays(days)}
              aria-pressed={windowDays === days}
              className={
                windowDays === days
                  ? 'rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary'
                  : ghostBtn
              }
            >
              {WINDOW_LABELS[days]}
            </button>
          ))}
        </div>
      </header>

      {query.isError && (
        <ErrorBanner message={errorMessage(query.error, 'Não foi possível carregar a adoção.')} />
      )}

      <div className="grid gap-md sm:grid-cols-3">
        <StatCard label="Empresas com uso" value={`${comUso.length}/${companies.length}`} icon="apartment" />
        <StatCard label="Pessoas ativas" value={totalPessoas} icon="group" />
        <StatCard label="Eventos na janela" value={totalEventos} icon="monitoring" />
      </div>

      {semUso.length > 0 && (
        <p className="flex items-center gap-sm rounded-lg border border-error/40 bg-error/10 p-md text-body-sm text-on-surface">
          <Icon name="warning" className="shrink-0 text-[18px] text-error" />
          {semUso.length === 1
            ? '1 empresa ativa não registrou nenhum uso nesta janela.'
            : `${semUso.length} empresas ativas não registraram nenhum uso nesta janela.`}
        </p>
      )}

      <Panel title="Empresas">
        {query.isLoading ? (
          <p className="text-body-md text-on-surface-variant">Carregando…</p>
        ) : companies.length === 0 ? (
          <p className="text-body-md text-on-surface-variant">Nenhuma empresa cadastrada.</p>
        ) : (
          <ul className="flex flex-col gap-md">
            {companies.map((company) => (
              <CompanyCard key={company.companyId} company={company} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
