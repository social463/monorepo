import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  canEditCalendarEvent,
  canManageCalendarEvents,
  canSeeInternalCalendarEvents,
  type CalendarEventOccurrenceDTO,
} from '@legends/shared'
import { useAuth } from '../../auth/AuthContext'
import { apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { SelectMenu } from '../../components/SelectMenu'
import { BrandName } from '../../components/BrandLogo'
import { TeamSkeleton } from '../../components/Skeleton'
import { errorMessage } from '../admin/shared'
import {
  CALENDAR_FILTER_ALL,
  CALENDAR_VIEWS,
  CALENDAR_VIEW_LABELS,
  EMPTY_CALENDAR_FILTERS,
  MONTH_NAMES,
  audienceOptions,
  filterOccurrences,
  localIsoOf,
  monthRefOf,
  shiftCursor,
  viewHeadline,
  weekDays,
  type CalendarFilters,
  type CalendarView,
} from './calendar-events'
import { useCalendarData } from './useCalendarData'
import { CalendarMonthGrid } from './CalendarMonthGrid'
import { CalendarTimeGrid } from './CalendarTimeGrid'
import { CalendarEventDetails } from './CalendarEventDetails'
import { CalendarEventModal } from './CalendarEventModal'

/**
 * "Hoje" precisa ser o dia civil **local**: usar UTC faria "hoje" virar amanhã
 * das 21h à meia-noite, já que America/Sao_Paulo é UTC−3.
 */
function todayIso(): string {
  return localIsoOf(new Date())
}

/** Três anos para trás e três para frente cobrem o planejamento de endomarketing. */
function yearOptions(cursorYear: number): number[] {
  const base = new Date().getFullYear()
  const anos = new Set<number>([cursorYear])
  for (let y = base - 3; y <= base + 3; y += 1) anos.add(y)
  return [...anos].sort((a, b) => a - b)
}

/**
 * **Calendário Endomarketing**: ações, datas comemorativas, campanhas e eventos
 * institucionais da empresa.
 *
 * Só eventos cadastrados. Aniversário, tempo de casa, férias e 1:1 saíram
 * daqui: cada um continua na aba do seu assunto, e juntos enchiam a grade de
 * marcações de pessoa a ponto de esconder as campanhas — que é o que este
 * calendário existe para mostrar.
 */
export function CalendarPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const [view, setView] = useState<CalendarView>('month')
  // O lembrete do evento manda `/calendario?dia=<iso>`; abrir no mês corrente
  // ignorando o parâmetro deixaria a notificação apontando para lugar nenhum.
  const [cursor, setCursor] = useState(() => searchParams.get('dia') ?? todayIso())
  const [filters, setFilters] = useState<CalendarFilters>(EMPTY_CALENDAR_FILTERS)
  const [selected, setSelected] = useState<CalendarEventOccurrenceDTO | null>(null)
  const [editor, setEditor] = useState<{ eventId: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { occurrences, types, isLoading, isError } = useCalendarData({ view, cursor })

  const podeCadastrar = canManageCalendarEvents(user?.role, user?.sectorFeatures ?? [], user?.adminAccess)
  const podeMarcarInterno = canSeeInternalCalendarEvents(user?.role, user?.sectorFeatures ?? [], user?.adminAccess)

  const visiveis = useMemo(() => filterOccurrences(occurrences, filters), [occurrences, filters])
  const publicos = useMemo(() => audienceOptions(occurrences), [occurrences])
  const hoje = todayIso()

  // A linha do "agora" na grade de horas anda sozinha. Um minuto de resolução
  // basta, e o `visibilitychange` corrige a defasagem de quem volta para a aba.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (view === 'month') return
    const tick = () => setNow(new Date())
    const id = window.setInterval(tick, 60_000)
    const onVis = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [view])

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/calendar/events/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setSelected(null)
      await qc.invalidateQueries({ queryKey: ['calendar-events'] })
    },
    onError: (err) => setError(errorMessage(err, 'Erro ao excluir o evento.')),
  })

  /** Muda o dia em foco e tira o `?dia=` da URL — ele valeu, já entregou. */
  function goTo(iso: string) {
    setCursor(iso)
    if (searchParams.has('dia')) {
      const next = new URLSearchParams(searchParams)
      next.delete('dia')
      setSearchParams(next, { replace: true })
    }
  }

  function changeView(next: CalendarView) {
    setView(next)
    // O recorte "Hoje" é de UM dia, e o dia dele é hoje: entrar nele exibindo
    // 14 de março porque o cursor tinha parado lá contradiz o próprio rótulo.
    if (next === 'day') goTo(hoje)
  }

  const [ano, mes] = monthRefOf(cursor).split('-').map(Number)

  function goToMonth(year: number, month: number) {
    // Fixa no dia 1: 31 de março com o mês trocado para fevereiro não existe.
    goTo(`${year}-${String(month).padStart(2, '0')}-01`)
  }

  const podeEditarSelecionado =
    selected !== null &&
    user !== null &&
    canEditCalendarEvent(
      {
        id: user.id,
        role: user.role,
        sectorFeatures: user.sectorFeatures ?? [],
        adminAccess: user.adminAccess,
      },
      { createdById: selected.createdById },
    )

  return (
    <section className="mx-auto flex max-w-page flex-col gap-md p-lg md:p-xl">
      <header>
        <div className="flex items-center gap-sm text-primary">
          <Icon name="calendar_month" className="text-[20px]" />
          <span className="font-label text-label-md uppercase tracking-[0.18em]">Endomarketing</span>
        </div>
        <h1 className="mt-2 font-headline text-headline-xl text-on-surface">Calendário</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Ações, datas comemorativas e eventos da <BrandName />.
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-sm">
        <div className="inline-flex rounded-lg border border-outline-variant/50 bg-surface-container p-0.5">
          {CALENDAR_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => changeView(v)}
              className={`rounded-md px-3 py-1.5 font-label text-label-sm transition-colors ${
                view === v ? 'bg-primary font-bold text-on-primary' : 'text-on-surface-variant hover:text-primary'
              }`}
            >
              {CALENDAR_VIEW_LABELS[v]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-sm">
          <button
            type="button"
            onClick={() => goTo(hoje)}
            className="rounded-full border border-outline-variant/50 px-3 py-1.5 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
          >
            Ir para hoje
          </button>
          {podeCadastrar && (
            <button
              type="button"
              onClick={() => setEditor({ eventId: null })}
              className="inline-flex items-center gap-xs rounded-full bg-primary px-3 py-1.5 font-label text-label-sm font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container"
            >
              <Icon name="add" className="text-[16px]" />
              Novo evento
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-sm">
        <div className="flex items-center gap-xs">
          <button
            type="button"
            onClick={() => goTo(shiftCursor(view, cursor, -1))}
            aria-label="Período anterior"
            className="rounded-md border border-outline-variant/50 p-1.5 text-on-surface-variant hover:border-primary hover:text-primary"
          >
            <Icon name="chevron_left" className="text-[18px]" />
          </button>
          <h2 className="min-w-56 text-center font-headline text-title-md capitalize text-on-surface">
            {viewHeadline(view, cursor)}
          </h2>
          <button
            type="button"
            onClick={() => goTo(shiftCursor(view, cursor, 1))}
            aria-label="Próximo período"
            className="rounded-md border border-outline-variant/50 p-1.5 text-on-surface-variant hover:border-primary hover:text-primary"
          >
            <Icon name="chevron_right" className="text-[18px]" />
          </button>
        </div>

        {/* Ir direto ao mês/ano: navegar de março de 2026 a novembro de 2027 pela
            setinha são 20 cliques. */}
        <div className="flex flex-wrap items-center gap-sm">
          <SelectMenu
            label="Mês"
            value={String(mes)}
            onChange={(v) => goToMonth(ano, Number(v))}
            className="w-36"
            searchPlaceholder="Buscar mês…"
            options={MONTH_NAMES.map((nome, i) => ({ value: String(i + 1), label: nome }))}
          />
          <SelectMenu
            label="Ano"
            value={String(ano)}
            onChange={(v) => goToMonth(Number(v), mes)}
            className="w-28"
            searchPlaceholder="Buscar ano…"
            options={yearOptions(ano).map((y) => ({ value: String(y), label: String(y) }))}
          />

          <SelectMenu
            label="Categoria"
            value={filters.category}
            onChange={(v) => setFilters({ ...filters, category: v })}
            className="min-w-[13rem]"
            searchPlaceholder="Buscar categoria…"
            options={[
              { value: CALENDAR_FILTER_ALL, label: 'Todas as categorias' },
              // Mesma bolinha da legenda abaixo da grade: é a chave de cor do
              // calendário, e repeti-la aqui liga o filtro ao que se vê nos dias.
              ...types.map((type) => ({
                value: type.slug,
                label: type.name,
                adornment: (
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: type.color }}
                  />
                ),
              })),
            ]}
          />

          <SelectMenu
            label="Público-alvo"
            value={filters.audience}
            onChange={(v) => setFilters({ ...filters, audience: v })}
            className="min-w-[13rem]"
            searchPlaceholder="Buscar público…"
            options={[
              { value: CALENDAR_FILTER_ALL, label: 'Todos os públicos' },
              ...publicos.map((tag) => ({ value: tag, label: tag })),
            ]}
          />
        </div>
      </div>

      {/* Legenda por cor: sem ela a grade é um mosaico colorido sem chave. */}
      <div className="flex flex-wrap gap-x-md gap-y-xs">
        {types.map((type) => (
          <span key={type.id} className="inline-flex items-center gap-xs font-label text-[11px] text-on-surface-variant">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: type.color }} />
            {type.name}
          </span>
        ))}
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" /> {error}
        </p>
      )}

      {isLoading && <TeamSkeleton />}

      {isError && (
        <div className="flex items-center gap-sm rounded-lg border border-error/40 bg-error-container/20 p-lg text-on-error-container">
          <Icon name="error" className="text-[20px]" />
          Erro ao carregar o calendário.
        </div>
      )}

      {!isLoading && !isError && view === 'month' && (
        <CalendarMonthGrid
          monthRef={monthRefOf(cursor)}
          events={visiveis}
          todayIso={hoje}
          onSelect={setSelected}
        />
      )}

      {!isLoading && !isError && view !== 'month' && (
        <CalendarTimeGrid
          days={view === 'week' ? weekDays(cursor) : [cursor]}
          events={visiveis}
          todayIso={hoje}
          now={now}
          onSelect={setSelected}
        />
      )}

      {!isLoading && !isError && visiveis.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhum evento neste período.</p>
      )}

      {selected && (
        <CalendarEventDetails
          event={selected}
          canEdit={podeEditarSelecionado}
          deleting={deleteMut.isPending}
          onEdit={() => {
            setEditor({ eventId: selected.eventId })
            setSelected(null)
          }}
          onDelete={() => deleteMut.mutate(selected.eventId)}
          onClose={() => setSelected(null)}
        />
      )}

      {editor && (
        <CalendarEventModal
          eventId={editor.eventId}
          types={types}
          initialDate={cursor}
          canMarkInternal={podeMarcarInterno}
          onClose={() => setEditor(null)}
        />
      )}
    </section>
  )
}
