import { Link } from 'react-router-dom'
import {
  XP_CURRENCY_LABEL,
  XP_EVENT_LABELS,
  type RankingEntryDTO,
  type RankingEventRowDTO,
  type RankingIdlePersonDTO,
  type RankingOverviewDTO,
  type RankingSectorRowDTO,
} from '@legends/shared'
import { useRankingOverview } from '../../lib/use-ranking'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { OnlineDot } from '../../components/OnlineDot'
import { Panel } from './shared'

/**
 * Administração › Engajamento — a economia de XP da empresa.
 *
 * Complementa `/admin/xp`, que cuida das REGRAS (quanto vale cada evento). Aqui
 * é o resultado delas: quanto se distribuiu, por qual caminho, para quem, e —
 * a parte que o ranking público não conta — **quem ficou de fora**.
 *
 * Não confundir com Administração › People Analytics, que mede humor, alcance
 * do mural e telas mais vistas. Ali é comportamento; aqui é pontuação.
 */
export function EngagementSection() {
  const { data, isLoading, isError } = useRankingOverview()

  if (isLoading) {
    return <p className="text-body-md text-on-surface-variant">Carregando o panorama de engajamento…</p>
  }
  // Checa `data.overview`, e não só `data`: resposta sem o corpo esperado tem
  // que cair no aviso, não estourar no primeiro acesso a `overview.monthRef`.
  if (isError || !data?.overview) {
    return (
      <p role="alert" className="flex items-center gap-sm text-body-md text-error">
        <Icon name="error" className="text-[18px]" />
        Não foi possível carregar o panorama de engajamento.
      </p>
    )
  }

  const overview = data.overview

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h2 className="font-headline text-headline-lg text-on-surface">Engajamento</h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Como os {XP_CURRENCY_LABEL.toLowerCase()} estão circulando na empresa. Referência de adesão:{' '}
          <strong className="font-label text-on-surface">{formatMonth(overview.monthRef)}</strong>. As regras de
          quanto cada ação vale ficam em{' '}
          <Link to="/admin/xp" className="text-primary hover:underline">
            Pontos (XP)
          </Link>
          .
        </p>
      </header>

      <SummaryTiles overview={overview} />

      <div className="grid gap-lg xl:grid-cols-2">
        <Panel title="Por onde os pontos entram">
          <EventTable rows={overview.byEvent} />
        </Panel>

        <Panel title="Por setor">
          <SectorTable rows={overview.bySector} />
        </Panel>
      </div>

      <Panel
        title="Ranking"
        action={
          <Link to="/ranking" className="font-label text-label-md text-primary hover:underline">
            Ver ranking completo
          </Link>
        }
      >
        <TopTable rows={overview.top} />
      </Panel>

      <Panel title={`Sem pontuar em ${formatMonth(overview.monthRef)}`}>
        <p className="mb-lg text-body-sm text-on-surface-variant">
          Quem não recebeu nenhum ponto no mês, do maior acumulado para o menor — quem já participou e parou
          aparece primeiro, porque é o caso que pede conversa.
        </p>
        <IdleTable rows={overview.idle} />
      </Panel>
    </div>
  )
}

function SummaryTiles({ overview }: { overview: RankingOverviewDTO }) {
  const adoption = overview.people === 0 ? 0 : Math.round((overview.activeThisMonth / overview.people) * 100)
  const tiles = [
    { icon: 'group', label: 'Pessoas no ranking', value: String(overview.people), hint: 'Exclui contas de administração e terceirizados' },
    {
      icon: 'bolt',
      label: 'Pontuaram no mês',
      value: `${overview.activeThisMonth}`,
      hint: `${adoption}% do time — ${overview.scored} já pontuaram alguma vez`,
    },
    {
      icon: 'stars',
      label: `${XP_CURRENCY_LABEL} no mês`,
      value: overview.pointsThisMonth.toLocaleString('pt-BR'),
      hint: `${overview.totalPoints.toLocaleString('pt-BR')} distribuídos desde sempre`,
    },
    {
      icon: 'person_off',
      label: 'Fora do jogo no mês',
      value: String(Math.max(0, overview.people - overview.activeThisMonth)),
      hint: 'Sem nenhum ponto no mês de referência',
    },
  ]

  return (
    <div className="grid gap-md sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg"
        >
          <div className="flex items-center gap-sm text-on-surface-variant">
            <Icon name={tile.icon} className="text-[18px]" />
            <span className="font-label text-label-sm uppercase tracking-wide">{tile.label}</span>
          </div>
          <p className="mt-sm font-headline text-headline-lg tabular-nums text-on-surface">{tile.value}</p>
          <p className="mt-1 text-body-sm text-on-surface-variant">{tile.hint}</p>
        </div>
      ))}
    </div>
  )
}

function EventTable({ rows }: { rows: RankingEventRowDTO[] }) {
  if (rows.length === 0) return <EmptyLine>Nenhum ponto distribuído ainda.</EmptyLine>
  const max = Math.max(...rows.map((row) => row.points), 1)

  return (
    <ul className="flex flex-col gap-md">
      {rows.map((row) => (
        <li key={row.event}>
          <div className="flex items-baseline justify-between gap-md">
            <span className="font-label text-label-md text-on-surface">{XP_EVENT_LABELS[row.event]}</span>
            <span className="font-label text-label-md font-bold tabular-nums text-on-surface">
              {row.points.toLocaleString('pt-BR')}
            </span>
          </div>
          {/* Barra proporcional ao maior evento: comparar cinco números soltos é
              mais lento do que comparar cinco comprimentos. */}
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(row.points / max) * 100}%` }} />
          </div>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            {row.credits.toLocaleString('pt-BR')} {row.credits === 1 ? 'crédito' : 'créditos'} ·{' '}
            {row.people} {row.people === 1 ? 'pessoa' : 'pessoas'}
          </p>
        </li>
      ))}
    </ul>
  )
}

function SectorTable({ rows }: { rows: RankingSectorRowDTO[] }) {
  if (rows.length === 0) return <EmptyLine>Nenhum setor com pessoas no ranking.</EmptyLine>

  return (
    <TableShell head={['Setor', 'Pessoas', 'Pontuaram', 'Média', 'Total']}>
      {rows.map((row) => (
        <tr key={row.sectorId} className="border-t border-outline-variant/30">
          <td className="px-md py-sm font-label text-label-md text-on-surface">{row.sectorName}</td>
          <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">{row.people}</td>
          <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">
            {row.scored}
            <span className="ml-1 text-body-sm">
              ({row.people === 0 ? 0 : Math.round((row.scored / row.people) * 100)}%)
            </span>
          </td>
          <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">{row.averagePoints}</td>
          <td className="px-md py-sm text-right font-label font-bold tabular-nums text-on-surface">
            {row.points.toLocaleString('pt-BR')}
          </td>
        </tr>
      ))}
    </TableShell>
  )
}

function TopTable({ rows }: { rows: RankingEntryDTO[] }) {
  if (rows.length === 0) return <EmptyLine>Ninguém pontuou ainda.</EmptyLine>

  return (
    <TableShell head={['#', 'Pessoa', 'Setor', 'Nível', 'Pontos']}>
      {rows.map((entry) => (
        <tr key={entry.user.id} className="border-t border-outline-variant/30">
          <td className="px-md py-sm font-label font-bold tabular-nums text-on-surface-variant">{entry.position}</td>
          <td className="px-md py-sm">
            <PersonCell user={entry.user} online={entry.online} />
          </td>
          <td className="px-md py-sm text-body-sm text-on-surface-variant">{entry.user.sectorName || '—'}</td>
          <td className="px-md py-sm">
            <span
              className="inline-flex rounded-full px-sm py-0.5 font-label text-label-sm font-bold text-white"
              style={{ backgroundColor: entry.level.color }}
            >
              {entry.level.name}
            </span>
          </td>
          <td className="px-md py-sm text-right font-label font-bold tabular-nums text-on-surface">
            {entry.points.toLocaleString('pt-BR')}
          </td>
        </tr>
      ))}
    </TableShell>
  )
}

function IdleTable({ rows }: { rows: RankingIdlePersonDTO[] }) {
  if (rows.length === 0) return <EmptyLine>Todo mundo pontuou neste mês. 🎉</EmptyLine>

  return (
    <TableShell head={['Pessoa', 'Setor', 'Último ponto', 'Acumulado']}>
      {rows.map((row) => (
        <tr key={row.user.id} className="border-t border-outline-variant/30">
          <td className="px-md py-sm">
            <PersonCell user={row.user} online={false} showDot={false} />
          </td>
          <td className="px-md py-sm text-body-sm text-on-surface-variant">{row.user.sectorName || '—'}</td>
          <td className="px-md py-sm text-body-sm text-on-surface-variant">
            {row.lastPointAt ? new Date(row.lastPointAt).toLocaleDateString('pt-BR') : 'Nunca pontuou'}
          </td>
          <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">
            {row.points.toLocaleString('pt-BR')}
          </td>
        </tr>
      ))}
    </TableShell>
  )
}

function PersonCell({
  user,
  online,
  showDot = true,
}: {
  user: RankingEntryDTO['user']
  online: boolean
  showDot?: boolean
}) {
  return (
    <div className="flex items-center gap-sm">
      <div className="relative shrink-0">
        <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-outline-variant/50 bg-surface-container-highest">
          <Avatar user={user} />
        </div>
        {showDot && <OnlineDot online={online} label={user.name} />}
      </div>
      <Link to={`/perfil/${user.id}`} className="font-label text-label-md text-on-surface hover:underline">
        {user.name}
      </Link>
    </div>
  )
}

function TableShell({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] border-collapse">
        <thead className="bg-surface-container-highest text-on-surface-variant">
          <tr>
            {head.map((label, index) => (
              <th
                key={label}
                className={`px-md py-sm font-label text-label-sm uppercase tracking-wide ${
                  index === 0 || (index === 1 && head[0] === '#') ? 'text-left' : 'text-right'
                }`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-body-md text-on-surface-variant">{children}</p>
}

/** "2026-08" → "agosto de 2026". */
function formatMonth(monthRef: string): string {
  const [year, month] = monthRef.split('-').map(Number)
  // Dia 15 e não 1: à meia-noite do dia 1 o fuso do navegador pode jogar a data
  // para o mês anterior, e o rótulo mostraria o mês errado.
  return new Date(year!, (month ?? 1) - 1, 15).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  })
}
