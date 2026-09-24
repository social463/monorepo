import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  canManageMonthlyHighlights,
  monthRefLabel,
  type MonthlyHighlightDTO,
  type MonthlyHighlightsResponse,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../auth/AuthContext'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { HighlightsSkeleton } from '../../components/Skeleton'
import { MonthPicker } from './MonthPicker'
import { NewMonthlyHighlightDialog } from './NewMonthlyHighlightDialog'

/** Mês corrente em `AAAA-MM`. */
export function currentMonthRef(): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)
}

/**
 * Mês em que a tela abre: o corrente quando já tem destaque, senão o **último
 * mês registrado**.
 *
 * O quadro é sempre do mês que passou — a G&G cadastra agosto lá pelo meio de
 * setembro —, então abrir no mês corrente mostrava o vazio para todo mundo e
 * obrigava a filtrar para ver o que existe. Meses futuros (cadastro adiantado)
 * ficam de fora do fallback: quem abre quer o quadro mais recente já divulgado.
 */
export function defaultMonthRef(months: string[], current = currentMonthRef()): string {
  if (months.includes(current)) return current
  return months.find((month) => month < current) ?? current
}

function PersonCard({ highlight, canManage }: { highlight: MonthlyHighlightDTO; canManage: boolean }) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => apiFetch<void>(`/monthly-highlights/${highlight.id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['monthly-highlights'] }),
  })

  return (
    <article className="group/person relative flex flex-col items-center gap-sm rounded-xl border border-outline-variant/30 bg-surface-container p-md text-center">
      <Link
        to={`/perfil/${highlight.person.id}`}
        className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-primary/40 bg-surface-container-highest"
      >
        <Avatar user={highlight.person} />
      </Link>
      <div>
        <p className="font-label text-label-md font-bold text-on-surface">{highlight.person.name}</p>
        {highlight.person.position && (
          <p className="text-label-sm text-on-surface-variant">{highlight.person.position}</p>
        )}
      </div>
      {/* O grupo (hoje o setor) é etiqueta no card, e não título de seção: com
          uma pessoa por setor, cada seção virava uma faixa quase vazia. */}
      <span className="rounded-full bg-primary/10 px-sm py-0.5 font-label text-label-sm text-primary">
        {highlight.group.name}
      </span>
      {highlight.message && (
        <p className="text-body-sm italic text-on-surface-variant">“{highlight.message}”</p>
      )}
      {canManage && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Remover ${highlight.person.name} dos destaques deste mês?`)) remove.mutate()
          }}
          disabled={remove.isPending}
          aria-label={`Remover ${highlight.person.name}`}
          className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full text-on-surface-variant opacity-0 transition-opacity hover:bg-error/10 hover:text-error focus:opacity-100 group-hover/person:opacity-100"
        >
          <Icon name="close" className="text-[16px]" />
        </button>
      )}
    </article>
  )
}

/**
 * Quadro do mês: uma grade única de pessoas, cada card etiquetado com o grupo.
 * O grupo hoje é o **setor** (ver a spec, decisão 2); o DTO já entrega
 * `{ id, name }`, então trocar a origem do agrupamento não mexe nesta tela.
 */
export function MonthlyHighlightsTab() {
  const { user } = useAuth()
  // `null` = ninguém filtrou ainda: quem escolhe o mês é `defaultMonthRef`.
  const [pickedMonth, setPickedMonth] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const current = currentMonthRef()

  const monthsQuery = useQuery({
    queryKey: ['monthly-highlights', 'months'],
    queryFn: () => apiFetch<{ months: string[] }>('/monthly-highlights/months'),
  })
  const fallbackMonth = useMemo(
    () => defaultMonthRef(monthsQuery.data?.months ?? [], current),
    [monthsQuery.data, current],
  )
  const monthRef = pickedMonth ?? fallbackMonth
  // Só avisa quando a tela escolheu sozinha um mês que não é o corrente.
  const showingPreviousMonth = pickedMonth === null && monthRef !== current

  const query = useQuery({
    queryKey: ['monthly-highlights', monthRef],
    queryFn: () =>
      apiFetch<MonthlyHighlightsResponse & { canManage: boolean }>(`/monthly-highlights?monthRef=${monthRef}`),
    // Espera saber o mês certo antes de buscar, senão a tela pisca no vazio do
    // mês corrente para depois trocar para o último registrado.
    enabled: !monthsQuery.isPending,
  })
  // A API é a autoridade; enquanto ela não responde, o papel já decide se o
  // botão aparece (evita piscar para quem administra).
  const canManage = query.data?.canManage ?? canManageMonthlyHighlights(user?.role, user?.adminAccess)
  const people = useMemo(
    () => (query.data?.groups ?? []).flatMap((group) => group.people),
    [query.data],
  )

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <div className="flex flex-wrap items-center gap-md">
          <MonthPicker monthRef={monthRef} onChange={setPickedMonth} />
          {showingPreviousMonth && (
            <p className="flex items-center gap-xs text-label-sm text-on-surface-variant">
              <Icon name="info" className="text-[16px]" />
              Ainda não há destaques de {monthRefLabel(current)} — mostrando os de {monthRefLabel(monthRef)}.
            </p>
          )}
        </div>
        {canManage && query.data && query.data.total > 0 && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="flex items-center gap-xs rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container"
          >
            <Icon name="add" className="text-[18px]" />
            Adicionar destaque
          </button>
        )}
      </div>

      {monthsQuery.isPending || query.isLoading ? (
        <HighlightsSkeleton />
      ) : query.isError ? (
        <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          Erro ao carregar os destaques.
        </p>
      ) : query.data && query.data.total === 0 ? (
        <div className="flex flex-col items-center gap-md rounded-xl border border-dashed border-outline-variant/50 bg-surface-container-low px-lg py-xl text-center">
          <p className="text-body-md text-on-surface-variant">
            Nenhum destaque cadastrado para {monthRefLabel(monthRef)}.
          </p>
          {canManage && (
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="flex items-center gap-xs rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container"
            >
              <Icon name="add" className="text-[18px]" />
              Adicionar o primeiro
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-gutter sm:grid-cols-3 lg:grid-cols-4">
          {people.map((highlight) => (
            <PersonCard key={highlight.id} highlight={highlight} canManage={canManage} />
          ))}
        </div>
      )}

      {dialogOpen && <NewMonthlyHighlightDialog monthRef={monthRef} onClose={() => setDialogOpen(false)} />}
    </div>
  )
}
