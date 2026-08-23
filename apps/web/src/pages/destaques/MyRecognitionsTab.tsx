import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { monthRefLabel, type MyRecognitionsResponse } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { MonthPicker } from './MonthPicker'
import { currentMonthRef } from './MonthlyHighlightsTab'

/**
 * "Meus destaques" — os meses em que a pessoa foi Destaque do Mês, com o texto.
 *
 * Existe porque hoje isso circula por fora: a G&G manda o template e o texto
 * por e-mail, e quem quer reler precisa caçar a mensagem. O filtro de mês é
 * opcional de propósito — o histórico inteiro é a pergunta mais comum ("em que
 * mês eu fui destaque?"), e o filtro serve para quem já sabe o mês.
 */
export function MyRecognitionsTab() {
  const [filtering, setFiltering] = useState(false)
  const [monthRef, setMonthRef] = useState(currentMonthRef())

  const query = useQuery({
    queryKey: ['monthly-highlights', 'mine', filtering ? monthRef : 'todos'],
    queryFn: () =>
      apiFetch<MyRecognitionsResponse>(
        `/monthly-highlights/mine${filtering ? `?monthRef=${monthRef}` : ''}`,
      ),
  })
  const highlights = query.data?.highlights ?? []

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center gap-md">
        <label className="flex items-center gap-xs font-label text-label-md text-on-surface-variant">
          <input
            type="checkbox"
            checked={filtering}
            onChange={(e) => setFiltering(e.target.checked)}
            className="h-4 w-4 accent-[rgb(var(--brand-primary))]"
          />
          Filtrar por mês
        </label>
        {filtering && <MonthPicker monthRef={monthRef} onChange={setMonthRef} />}
      </div>

      {query.isLoading ? (
        <p className="text-body-sm text-on-surface-variant">Carregando…</p>
      ) : query.isError ? (
        <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          Erro ao carregar seus destaques.
        </p>
      ) : highlights.length === 0 ? (
        <p className="rounded-xl border border-dashed border-outline-variant/50 bg-surface-container-low px-lg py-lg text-body-sm text-on-surface-variant">
          {filtering
            ? `Você não foi destaque em ${monthRefLabel(monthRef)}.`
            : 'Você ainda não foi destaque do mês. Continue brilhando 💚'}
        </p>
      ) : (
        <ul className="flex flex-col gap-md">
          {highlights.map((highlight) => (
            <li
              key={highlight.id}
              className="flex flex-col gap-xs rounded-xl border border-outline-variant/30 bg-surface-container p-lg"
            >
              <div className="flex items-center gap-sm">
                <span className="text-primary">
                  <Icon name="trophy" className="text-[20px]" />
                </span>
                <span className="font-headline text-headline-md text-on-surface">
                  {monthRefLabel(highlight.monthRef)}
                </span>
                <span className="rounded-full bg-primary/10 px-sm font-label text-label-sm text-primary">
                  {highlight.group.name}
                </span>
              </div>
              {highlight.message ? (
                <p className="text-body-md italic text-on-surface-variant">“{highlight.message}”</p>
              ) : (
                <p className="text-body-sm text-on-surface-variant">
                  Destaque sem texto registrado.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
