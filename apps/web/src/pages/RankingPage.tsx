import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  RANKING_PAGE_SIZES,
  type PublicUser,
  type RankingEntryDTO,
  type StreakRankingEntryDTO,
} from '@legends/shared'
import { useAuth } from '../auth/AuthContext'
import { useRanking, useStreakRanking } from '../lib/use-ranking'
import { Avatar } from '../components/Avatar'
import { Icon } from '../components/Icon'
import { OnlineDot } from '../components/OnlineDot'

type RankingTab = 'geral' | 'consistencia'

const TAB_LABELS: Record<RankingTab, string> = {
  geral: 'Ranking geral',
  consistencia: 'Consistência',
}

/**
 * Ranking do time — a leitura pública do XP.
 *
 * Duas competições, porque medem coisas diferentes: **geral** é acúmulo (quem
 * mais participou desde sempre) e **consistência** é frequência (quantos dias
 * úteis seguidos a pessoa apareceu). Sem a segunda, o ranking premiaria só quem
 * está há mais tempo na casa.
 *
 * A aba vive na URL (`?aba=`) para o link ser compartilhável — "olha o ranking
 * de consistência" precisa abrir na aba certa.
 */
export function RankingPage() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('aba') as RankingTab | null
  const tab: RankingTab = requested === 'consistencia' ? 'consistencia' : 'geral'

  return (
    <section className="mx-auto flex w-full max-w-page flex-col gap-lg p-lg md:p-xl">
      <header>
        <h1 className="font-headline text-headline-xl text-on-surface">Ranking</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Quem mais participa do time — e a sua posição em cada disputa.
        </p>
      </header>

      <div role="tablist" className="flex gap-sm">
        {(Object.keys(TAB_LABELS) as RankingTab[]).map((option) => (
          <button
            key={option}
            role="tab"
            type="button"
            aria-selected={tab === option}
            onClick={() => setParams({ aba: option }, { replace: true })}
            className={`rounded-full px-lg py-sm font-label text-label-md transition-colors ${
              tab === option
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            {TAB_LABELS[option]}
          </button>
        ))}
      </div>

      {tab === 'geral' ? <PointsRanking /> : <ConsistencyRanking />}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Aba: ranking geral (pontos)
// ---------------------------------------------------------------------------

function PointsRanking() {
  const { user } = useAuth()
  const { data, isLoading, isError } = useRanking()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(RANKING_PAGE_SIZES[0])

  const entries = useMemo(() => data?.entries ?? [], [data])
  const filtered = useMemo(() => filterByName(entries, search), [entries, search])

  useEffect(() => {
    setPage(1)
  }, [search, pageSize])

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState />

  const podium = entries.slice(0, 3)
  const me = data?.me ?? null

  return (
    <div className="flex flex-col gap-lg">
      {podium.length > 0 && (
        <Podium>
          {/* Ordem visual do pódio: 2º, 1º, 3º. Em telas estreitas a ordem
              volta a ser 1-2-3, porque uma coluna só não tem "meio". */}
          <div className="order-2 md:order-1">{podium[1] && <PodiumCard entry={podium[1]} />}</div>
          <div className="order-1 md:order-2">{podium[0] && <PodiumCard entry={podium[0]} highlight />}</div>
          <div className="order-3">{podium[2] && <PodiumCard entry={podium[2]} />}</div>
        </Podium>
      )}

      {me && (
        <p className="rounded-2xl border border-primary/30 bg-primary/5 px-lg py-md text-body-md text-on-surface">
          Sua posição: <span className="font-label font-bold text-primary">{me.position}º</span> de{' '}
          {data?.total ?? 0} — <span className="font-label font-bold">{me.points}</span> pontos.
        </p>
      )}

      <SearchField value={search} onChange={setSearch} />

      <RankingTable
        rows={filtered}
        page={page}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={setPageSize}
        emptyLabel="Nenhum participante encontrado."
        head={
          <>
            <th className="px-lg py-md text-left font-label text-label-sm uppercase tracking-wide">Participante</th>
            <th className="hidden px-lg py-md text-left font-label text-label-sm uppercase tracking-wide md:table-cell">
              Nível
            </th>
            <th className="px-lg py-md text-right font-label text-label-sm uppercase tracking-wide">Pontos</th>
          </>
        }
        renderRow={(entry) => (
          <tr
            key={entry.user.id}
            className={`border-t border-outline-variant/30 ${
              entry.user.id === user?.id ? 'bg-primary/5' : ''
            }`}
          >
            <td className="px-lg py-sm">
              <PersonCell
                user={entry.user}
                position={entry.position}
                online={entry.online}
                isMe={entry.user.id === user?.id}
              />
            </td>
            <td className="hidden px-lg py-sm md:table-cell">
              <LevelChip name={entry.level.name} color={entry.level.color} />
            </td>
            <td className="px-lg py-sm text-right font-label text-label-lg font-bold tabular-nums text-on-surface">
              {entry.points}
            </td>
          </tr>
        )}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Aba: consistência (sequência de dias úteis)
// ---------------------------------------------------------------------------

function ConsistencyRanking() {
  const { user } = useAuth()
  const { data, isLoading, isError } = useStreakRanking()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(RANKING_PAGE_SIZES[0])

  const entries = useMemo(() => data?.entries ?? [], [data])
  const filtered = useMemo(() => filterByName(entries, search), [entries, search])

  useEffect(() => {
    setPage(1)
  }, [search, pageSize])

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState />

  const me = data?.me ?? null

  return (
    <div className="flex flex-col gap-lg">
      <p className="text-body-md text-on-surface-variant">
        Dias <strong className="font-label text-on-surface">úteis seguidos</strong> registrando o humor do dia.
        Fim de semana é ponte: não conta e não quebra a sequência.
      </p>

      {me && (
        <p className="rounded-2xl border border-primary/30 bg-primary/5 px-lg py-md text-body-md text-on-surface">
          Sua posição: <span className="font-label font-bold text-primary">{me.position}º</span> de{' '}
          {data?.total ?? 0} — sequência atual de{' '}
          <span className="font-label font-bold">{me.currentStreak}</span>{' '}
          {me.currentStreak === 1 ? 'dia' : 'dias'}.
        </p>
      )}

      <SearchField value={search} onChange={setSearch} />

      <RankingTable
        rows={filtered}
        page={page}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={setPageSize}
        emptyLabel="Ainda não há sequências registradas."
        head={
          <>
            <th className="px-lg py-md text-left font-label text-label-sm uppercase tracking-wide">Participante</th>
            <th className="hidden px-lg py-md text-right font-label text-label-sm uppercase tracking-wide md:table-cell">
              Maior sequência
            </th>
            <th className="px-lg py-md text-right font-label text-label-sm uppercase tracking-wide">
              Sequência atual
            </th>
          </>
        }
        renderRow={(entry) => (
          <tr
            key={entry.user.id}
            className={`border-t border-outline-variant/30 ${
              entry.user.id === user?.id ? 'bg-primary/5' : ''
            }`}
          >
            <td className="px-lg py-sm">
              <PersonCell
                user={entry.user}
                position={entry.position}
                online={entry.online}
                isMe={entry.user.id === user?.id}
              />
            </td>
            <td className="hidden px-lg py-sm text-right tabular-nums text-on-surface-variant md:table-cell">
              {entry.bestStreak}
            </td>
            <td className="px-lg py-sm text-right">
              <StreakChip days={entry.currentStreak} />
            </td>
          </tr>
        )}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Peças compartilhadas pelas duas abas
// ---------------------------------------------------------------------------

interface HasUser {
  user: PublicUser
}

function filterByName<T extends HasUser>(rows: T[], search: string): T[] {
  const query = search.trim().toLowerCase()
  if (!query) return rows
  return rows.filter((row) => row.user.name.toLowerCase().includes(query))
}

function LoadingState() {
  return <p className="text-body-md text-on-surface-variant">Carregando o ranking…</p>
}

function ErrorState() {
  return (
    <p className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg text-body-md text-on-surface-variant">
      Não foi possível carregar o ranking agora. Tente de novo em alguns instantes.
    </p>
  )
}

function SearchField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <label className="relative block">
      <span className="sr-only">Buscar participante pelo nome</span>
      <Icon
        name="search"
        className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Buscar participante pelo nome…"
        className="w-full rounded-full border border-outline-variant/50 bg-surface-container-low py-sm pl-[2.75rem] pr-lg text-body-md text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
      />
    </label>
  )
}

function Podium({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
      <h2 className="mb-lg flex items-center gap-sm font-headline text-body-lg font-semibold text-on-surface">
        <Icon name="trophy" className="text-[20px] text-primary" />
        Destaques
      </h2>
      <div className="grid grid-cols-1 items-end gap-lg md:grid-cols-3">{children}</div>
    </div>
  )
}

function PodiumCard({ entry, highlight = false }: { entry: RankingEntryDTO; highlight?: boolean }) {
  const { position, user, points, level, online } = entry
  const ring =
    position === 1
      ? 'border-amber-400'
      : position === 2
        ? 'border-slate-300'
        : 'border-orange-400'
  const badge =
    position === 1 ? 'bg-amber-400 text-amber-950' : position === 2 ? 'bg-slate-300 text-slate-900' : 'bg-orange-400 text-orange-950'

  return (
    <Link
      to={`/perfil/${user.id}`}
      className={`relative mx-auto flex w-full max-w-[260px] flex-col items-center rounded-2xl border-2 bg-surface-container p-lg text-center transition-transform hover:-translate-y-0.5 ${ring} ${
        highlight ? 'pt-xl' : ''
      }`}
    >
      <span
        className={`absolute -top-4 flex h-8 w-8 items-center justify-center rounded-full font-label text-label-md font-bold shadow-sm ${badge}`}
      >
        {position === 1 ? <Icon name="trophy" className="text-[18px]" filled /> : position}
      </span>

      <div className="relative">
        <div
          className={`flex items-center justify-center overflow-hidden rounded-full border-2 bg-surface-container-highest ${ring} ${
            highlight ? 'h-24 w-24' : 'h-16 w-16'
          }`}
        >
          <Avatar user={user} />
        </div>
        <OnlineDot online={online} label={user.name} />
      </div>

      <p className={`mt-md font-label text-on-surface ${highlight ? 'text-label-lg font-bold' : 'text-label-md font-semibold'}`}>
        {user.name}
      </p>
      <p className="text-body-sm text-on-surface-variant">{user.sectorName || 'Sem setor'}</p>
      <p className="mt-sm font-label text-label-lg font-bold tabular-nums text-on-surface">{points} pts</p>
      <div className="mt-sm">
        <LevelChip name={level.name} color={level.color} />
      </div>
    </Link>
  )
}

/**
 * Cor do nível vem do metal (ver `XP_LEVELS`), não da marca — por isso entra por
 * `style` e não por classe do Tailwind, que não tem como conhecer a cor em
 * tempo de build.
 */
function LevelChip({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-sm py-0.5 font-label text-label-sm font-bold text-white"
      style={{ backgroundColor: color }}
    >
      <Icon name="workspace_premium" className="text-[14px]" />
      {name}
    </span>
  )
}

function StreakChip({ days }: { days: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-sm py-1 font-label text-label-md font-bold tabular-nums ${
        days > 0 ? 'bg-orange-500 text-white' : 'bg-surface-container-highest text-on-surface-variant'
      }`}
    >
      <Icon name="local_fire_department" className="text-[16px]" filled={days > 0} />
      {days}
    </span>
  )
}

function PersonCell({
  user,
  position,
  online,
  isMe,
}: {
  user: PublicUser
  position: number
  online: boolean
  isMe: boolean
}) {
  return (
    <div className="flex items-center gap-md">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-label text-label-sm font-bold ${
          position === 1
            ? 'bg-amber-400 text-amber-950'
            : position === 2
              ? 'bg-slate-300 text-slate-900'
              : position === 3
                ? 'bg-orange-400 text-orange-950'
                : 'bg-surface-container-highest text-on-surface-variant'
        }`}
      >
        {position}
      </span>

      <div className="relative shrink-0">
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-outline-variant/50 bg-surface-container-highest">
          <Avatar user={user} />
        </div>
        <OnlineDot online={online} label={user.name} />
      </div>

      <div className="min-w-0">
        <Link
          to={`/perfil/${user.id}`}
          className="block truncate font-label text-label-md text-on-surface hover:underline"
        >
          {user.name}
          {isMe && <span className="ml-sm font-label text-label-sm text-primary">(você)</span>}
        </Link>
        <p className="truncate text-body-sm text-on-surface-variant">{user.sectorName || 'Sem setor'}</p>
      </div>
    </div>
  )
}

/**
 * Tabela paginada no cliente. A paginação é local de propósito: a API já devolve
 * no máximo `RANKING_MAX_ENTRIES` linhas, e paginar no servidor obrigaria a
 * refazer a busca por nome lá — que aqui é instantânea.
 */
function RankingTable<T extends HasUser>({
  rows,
  page,
  pageSize,
  onPage,
  onPageSize,
  head,
  renderRow,
  emptyLabel,
}: {
  rows: T[]
  page: number
  pageSize: number
  onPage: (next: number) => void
  onPageSize: (next: number) => void
  head: React.ReactNode
  renderRow: (row: T) => React.ReactNode
  emptyLabel: string
}) {
  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, totalPages)
  const pageRows = rows.slice((current - 1) * pageSize, current * pageSize)

  return (
    <div className="overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-low">
      {/* Só a tabela rola no eixo X: a página nunca ganha barra horizontal. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse">
          <thead className="bg-surface-container text-on-surface-variant">
            <tr>{head}</tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-lg py-xl text-center text-body-md text-on-surface-variant">
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              pageRows.map(renderRow)
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-md border-t border-outline-variant/30 px-lg py-md text-body-sm text-on-surface-variant">
        <span>
          {total === 0
            ? '0 de 0'
            : `${(current - 1) * pageSize + 1}–${Math.min(total, current * pageSize)} de ${total}`}
        </span>

        <div className="flex items-center gap-xs">
          <PageButton icon="first_page" label="Primeira página" disabled={current === 1} onClick={() => onPage(1)} />
          <PageButton
            icon="chevron_left"
            label="Página anterior"
            disabled={current === 1}
            onClick={() => onPage(current - 1)}
          />
          <span className="rounded-lg bg-primary/10 px-sm py-0.5 font-label text-label-sm font-bold text-primary">
            {current}
          </span>
          <PageButton
            icon="chevron_right"
            label="Próxima página"
            disabled={current >= totalPages}
            onClick={() => onPage(current + 1)}
          />
          <PageButton
            icon="last_page"
            label="Última página"
            disabled={current >= totalPages}
            onClick={() => onPage(totalPages)}
          />
        </div>

        <label className="flex items-center gap-sm">
          <span className="sr-only">Linhas por página</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
            className="rounded-lg border border-outline-variant/50 bg-surface-container-low px-sm py-1 text-body-sm text-on-surface focus:border-primary focus:outline-none"
          >
            {RANKING_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} por página
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

function PageButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: string
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon name={icon} className="text-[18px]" />
    </button>
  )
}
