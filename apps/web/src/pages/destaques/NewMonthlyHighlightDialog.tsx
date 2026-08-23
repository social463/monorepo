import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  HIGHLIGHT_MESSAGE_MAX_LENGTH,
  MAX_HIGHLIGHTS_PER_REQUEST,
  type PublicUser,
} from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { MonthPicker } from './MonthPicker'

/**
 * "Novo destaque" — só a administração chega aqui.
 *
 * A pessoa vem do banco: a busca grava **o id**, e nome, foto e setor são lidos
 * do cadastro na hora de exibir. É o que o pedido descreve ("não deve ser
 * necessário digitar nome, setor e foto") e o que impede o quadro de envelhecer
 * com foto antiga e nome escrito errado.
 *
 * A seleção é múltipla porque o quadro do mês é montado de uma vez, com uma ou
 * várias pessoas por grupo.
 */
export function NewMonthlyHighlightDialog({
  monthRef,
  onClose,
}: {
  monthRef: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<PublicUser[]>([])
  const [term, setTerm] = useState('')
  const [month, setMonth] = useState(monthRef)
  const [message, setMessage] = useState('')

  const colleagues = useQuery({
    queryKey: ['users', 'company'],
    queryFn: () => apiFetch<{ users: PublicUser[] }>('/users/company'),
  })

  const results = useMemo(() => {
    const search = term.trim().toLowerCase()
    const chosen = new Set(selected.map((p) => p.id))
    return (colleagues.data?.users ?? [])
      .filter((user) => !chosen.has(user.id))
      .filter(
        (user) =>
          !search ||
          user.name.toLowerCase().includes(search) ||
          (user.sectorName ?? '').toLowerCase().includes(search),
      )
      .slice(0, 8)
  }, [colleagues.data, selected, term])

  const create = useMutation({
    mutationFn: () =>
      apiFetch<unknown>('/monthly-highlights', {
        method: 'POST',
        body: JSON.stringify({
          monthRef: month,
          userIds: selected.map((p) => p.id),
          ...(message.trim() ? { message: message.trim() } : {}),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monthly-highlights'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-lg">
      <div
        role="dialog"
        aria-label="Novo destaque"
        aria-modal="true"
        className="flex max-h-[90vh] w-full max-w-xl flex-col gap-md overflow-y-auto rounded-2xl border border-outline-variant/40 bg-surface-container p-lg shadow-xl"
      >
        <div className="flex items-center justify-between gap-md">
          <h2 className="font-headline text-headline-md text-on-surface">Novo destaque</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest"
          >
            <Icon name="close" className="text-[18px]" />
          </button>
        </div>

        <div className="flex flex-col gap-sm">
          <span className="font-label text-label-md text-on-surface">Mês do destaque</span>
          <MonthPicker monthRef={month} onChange={setMonth} />
        </div>

        <div className="flex flex-col gap-sm">
          <label htmlFor="destaque-busca" className="font-label text-label-md text-on-surface">
            Buscar colaborador
          </label>
          <p className="text-label-sm text-on-surface-variant">
            Nome, setor e foto vêm do cadastro — é só escolher a pessoa.
          </p>
          <input
            id="destaque-busca"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Digite o nome para buscar…"
            className="rounded-md border border-outline-variant/60 bg-surface-container-highest px-sm py-2 text-body-sm text-on-surface outline-none focus:border-primary"
          />

          {selected.length > 0 && (
            <ul className="flex flex-wrap gap-xs">
              {selected.map((person) => (
                <li
                  key={person.id}
                  className="flex items-center gap-xs rounded-full border border-primary/40 bg-primary/5 py-1 pl-1 pr-sm"
                >
                  <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-surface-container-highest">
                    <Avatar user={person} />
                  </span>
                  <span className="font-label text-label-sm text-on-surface">{person.name}</span>
                  <button
                    type="button"
                    aria-label={`Remover ${person.name}`}
                    onClick={() => setSelected((prev) => prev.filter((p) => p.id !== person.id))}
                    className="text-on-surface-variant transition-colors hover:text-error"
                  >
                    <Icon name="close" className="text-[16px]" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected.length < MAX_HIGHLIGHTS_PER_REQUEST && (
            <ul className="max-h-56 overflow-y-auto rounded-lg border border-outline-variant/40">
              {results.length === 0 ? (
                <li className="px-md py-sm text-body-sm text-on-surface-variant">Nenhum colega encontrado.</li>
              ) : (
                results.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected((prev) => [...prev, user])
                        setTerm('')
                      }}
                      className="flex w-full items-center gap-sm px-md py-sm text-left transition-colors hover:bg-surface-container-highest"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-highest">
                        <Avatar user={user} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-label text-label-md text-on-surface">{user.name}</span>
                        <span className="block truncate text-body-sm text-on-surface-variant">
                          {user.position ?? user.sectorName ?? ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-sm">
          <label htmlFor="destaque-justificativa" className="font-label text-label-md text-on-surface">
            Justificativa (opcional)
          </label>
          <textarea
            id="destaque-justificativa"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, HIGHLIGHT_MESSAGE_MAX_LENGTH))}
            rows={3}
            placeholder="O que essa pessoa fez que merece destaque…"
            className="resize-none rounded-md border border-outline-variant/60 bg-surface-container-highest px-sm py-2 text-body-sm text-on-surface outline-none focus:border-primary"
          />
          <span className="text-label-sm text-on-surface-variant">
            Vale para todas as pessoas deste cadastro. Dá para editar uma a uma depois.
          </span>
        </div>

        {create.isError && (
          <p role="alert" className="text-body-sm text-error">
            {(create.error as ApiError).message}
          </p>
        )}

        <div className="flex items-center justify-end gap-sm">
          <button
            type="button"
            onClick={onClose}
            className="font-label text-label-md text-on-surface-variant hover:text-on-surface"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={selected.length === 0 || create.isPending}
            className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {create.isPending ? 'Salvando…' : 'Salvar destaque'}
          </button>
        </div>
      </div>
    </div>
  )
}
