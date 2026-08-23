import { useState } from 'react'
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

/** Mês corrente em `AAAA-MM` — é onde a tela abre. */
export function currentMonthRef(): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)
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
 * Quadro do mês: um bloco por grupo, com uma ou várias pessoas — o formato do
 * template que a G&G divulga. O grupo hoje é o **setor** (ver a spec, decisão
 * 2); o DTO já entrega `{ id, name }`, então trocar a origem do agrupamento não
 * mexe nesta tela.
 */
export function MonthlyHighlightsTab() {
  const { user } = useAuth()
  const [monthRef, setMonthRef] = useState(currentMonthRef())
  const [dialogOpen, setDialogOpen] = useState(false)

  const query = useQuery({
    queryKey: ['monthly-highlights', monthRef],
    queryFn: () =>
      apiFetch<MonthlyHighlightsResponse & { canManage: boolean }>(`/monthly-highlights?monthRef=${monthRef}`),
  })
  // A API é a autoridade; enquanto ela não responde, o papel já decide se o
  // botão aparece (evita piscar para quem administra).
  const canManage = query.data?.canManage ?? canManageMonthlyHighlights(user?.role, user?.adminAccess)

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <MonthPicker monthRef={monthRef} onChange={setMonthRef} />
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

      {query.isLoading ? (
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
        <div className="flex flex-col gap-xl">
          {(query.data?.groups ?? []).map((group) => (
            <section key={group.group.id} className="flex flex-col gap-md">
              <h3 className="font-headline text-headline-md text-on-surface">{group.group.name}</h3>
              <div className="grid grid-cols-2 gap-gutter sm:grid-cols-3 lg:grid-cols-4">
                {group.people.map((highlight) => (
                  <PersonCard key={highlight.id} highlight={highlight} canManage={canManage} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {dialogOpen && <NewMonthlyHighlightDialog monthRef={monthRef} onClose={() => setDialogOpen(false)} />}
    </div>
  )
}
