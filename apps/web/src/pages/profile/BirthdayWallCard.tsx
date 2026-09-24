import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CELEBRATION_KIND_LABELS,
  FEEDBACK_REACTIONS,
  GREETING_MAX_LENGTH,
  GREETING_SUGGESTIONS,
  MONTH_LABELS,
  celebrationWhenLabel,
  tenureLabel,
  type BirthdayGreetingDTO,
  type BirthdayWallOccurrenceDTO,
  type BirthdayWallResponse,
  type FeedbackReactionEmoji,
} from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { useAuth } from '../../auth/AuthContext'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { FeedbackReactions } from './FeedbackReactions'

/** "27 de agosto" a partir de uma data civil AAAA-MM-DD, sem `Date` e sem fuso. */
function dayLabel(ymd: string): string {
  const [, month, day] = ymd.split('-').map(Number)
  return `${day} de ${MONTH_LABELS[month!]}`
}

function occurrenceLabel(occurrence: BirthdayWallOccurrenceDTO): string {
  const base = `${CELEBRATION_KIND_LABELS[occurrence.kind]} ${occurrence.year}`
  return occurrence.years ? `${base} · ${tenureLabel(occurrence.years)}` : base
}

/** Dias entre hoje e a data do mural — só para o "É hoje!" do cabeçalho. */
function daysUntil(date: string, today: string): number {
  const to = new Date(`${date}T00:00:00.000Z`).getTime()
  const from = new Date(`${today}T00:00:00.000Z`).getTime()
  return Math.round((to - from) / 86_400_000)
}

function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/**
 * Mural de aniversário do perfil — as felicitações dos colegas, de nascimento e
 * de casa.
 *
 * Fica ao lado do "Deixar feedback" e **não é** feedback: sem tipo, sem
 * categoria, sem mínimo de caracteres, sem coins e sem peso de selo. O botão de
 * parabéns abria o `FeedbackComposer` com um rascunho, e "Parabéns, Victoria!"
 * ia parar no meio da lista de feedbacks da pessoa — ver a spec
 * `2026-08-31-mural-de-aniversarios-design.md`.
 *
 * Some do perfil quando a pessoa não tem mural nenhum (nem aberto, nem
 * histórico): um card vazio de aniversário 11 meses por ano é ruído.
 *
 * `autoFocus` é o destino do botão de parabéns dos cards de aniversário da Home
 * (`/perfil/:id?parabens=1`): quem clicou lá já decidiu felicitar, então o
 * perfil rola até aqui e põe o cursor no campo — o mural fica no meio da coluna
 * da esquerda, e sem isso a pessoa caía no topo do perfil sem saber onde
 * assinar.
 */
export function BirthdayWallCard({
  targetId,
  targetName,
  autoFocus = false,
}: {
  targetId: string
  targetName: string
  autoFocus?: boolean
}) {
  const { user } = useAuth()
  const [picked, setPicked] = useState<{ kind: string; year: number } | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  // Uma vez por deep-link: o mural chega assíncrono (e o seletor de ocorrência
  // re-renderiza o card), então sem a trava ele roubaria o scroll de novo a cada
  // troca de mural.
  const scrolledRef = useRef(false)
  useEffect(() => {
    scrolledRef.current = false
  }, [targetId, autoFocus])

  const query = useQuery({
    queryKey: ['birthday-wall', targetId, picked ? `${picked.kind}:${picked.year}` : 'atual'],
    queryFn: () =>
      apiFetch<BirthdayWallResponse>(
        `/users/${targetId}/birthday-wall${picked ? `?kind=${picked.kind}&year=${picked.year}` : ''}`,
      ),
  })

  // Depende do DOM já montado (a seção só existe com `wall.selected`), por isso
  // olha o resultado da query em vez de rodar no primeiro render.
  useEffect(() => {
    if (!autoFocus || scrolledRef.current) return
    if (!query.data?.selected) return
    scrolledRef.current = true
    sectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    sectionRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true })
  }, [autoFocus, query.data])

  if (query.isLoading || query.isError) return null
  const wall = query.data
  if (!wall?.selected) return null

  const selected = wall.selected
  const isBirth = selected.kind === 'BIRTH'
  const distance = daysUntil(selected.date, todayYmd())
  const firstName = targetName.split(' ')[0]

  return (
    <section
      ref={sectionRef}
      id="mural-aniversario"
      data-testid="birthday-wall"
      className="flex flex-col gap-md rounded-xl border border-outline-variant/40 bg-gradient-to-br from-primary/10 via-surface-container to-surface-container p-lg"
    >
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="min-w-0">
          <h2 className="flex items-center gap-sm font-headline text-title-md text-on-surface">
            <Icon name={isBirth ? 'cake' : 'workspace_premium'} className="text-[20px] text-primary" />
            Mural de aniversário
          </h2>
          <p className="mt-0.5 text-body-sm text-on-surface-variant">
            {selected.isToday ? (
              <span className="font-bold text-primary">É hoje! {dayLabel(selected.date)} 🎉</span>
            ) : (
              <>
                {celebrationWhenLabel(distance)} · {dayLabel(selected.date)}
              </>
            )}
            {selected.years ? ` · ${tenureLabel(selected.years)}` : ''}
          </p>
        </div>

        {/* O seletor só aparece quando há mais de um mural: com um só, ele é uma
            caixa que não escolhe nada. */}
        {wall.occurrences.length > 1 && (
          <select
            aria-label="Mural"
            value={`${selected.kind}:${selected.year}`}
            onChange={(event) => {
              const [kind, year] = event.target.value.split(':')
              setPicked({ kind: kind!, year: Number(year) })
            }}
            className="rounded-full border border-outline-variant/60 bg-surface px-md py-1 font-label text-label-sm text-on-surface"
          >
            {wall.occurrences.map((occurrence) => (
              <option key={`${occurrence.kind}:${occurrence.year}`} value={`${occurrence.kind}:${occurrence.year}`}>
                {occurrenceLabel(occurrence)}
              </option>
            ))}
          </select>
        )}
      </div>

      {wall.canSign ? (
        <GreetingComposer
          targetId={targetId}
          firstName={firstName}
          occurrence={selected}
          existing={wall.greetings.find((greeting) => greeting.id === wall.mySignatureId) ?? null}
        />
      ) : (
        !selected.isOpen && (
          <p className="rounded-lg border border-outline-variant/40 bg-surface/60 px-md py-sm text-body-sm text-on-surface-variant">
            Este mural já está fechado para novas mensagens.
          </p>
        )
      )}

      {wall.greetings.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          {user?.id === targetId
            ? 'Ninguém assinou o seu mural ainda.'
            : `Seja a primeira pessoa a assinar o mural de ${firstName}.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-md">
          {wall.greetings.map((greeting) => (
            <GreetingRow key={greeting.id} greeting={greeting} targetId={targetId} />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * O compositor. As frases prontas são **rascunho**: clicar preenche o campo e o
 * texto continua editável — quem quiser mandar só "Parabéns! 🎉" manda.
 *
 * Assinar de novo reescreve a própria mensagem (é o que o servidor faz), então
 * quem já assinou vê o próprio texto no campo e o botão vira "Atualizar".
 */
function GreetingComposer({
  targetId,
  firstName,
  occurrence,
  existing,
}: {
  targetId: string
  firstName: string
  occurrence: BirthdayWallOccurrenceDTO
  existing: BirthdayGreetingDTO | null
}) {
  const queryClient = useQueryClient()
  const [message, setMessage] = useState(existing?.message ?? '')
  const [error, setError] = useState<string | null>(null)

  const sign = useMutation({
    mutationFn: () =>
      apiFetch(`/users/${targetId}/birthday-wall`, {
        method: 'POST',
        body: JSON.stringify({ kind: occurrence.kind, year: occurrence.year, message: message.trim() }),
      }),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['birthday-wall', targetId] })
      queryClient.invalidateQueries({ queryKey: ['celebrations'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao enviar a mensagem.'),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (message.trim()) sign.mutate()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-sm">
      <div className="flex flex-wrap gap-xs">
        {GREETING_SUGGESTIONS[occurrence.kind].map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => setMessage(suggestion)}
            className="rounded-full border border-outline-variant/60 bg-surface px-md py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
          >
            {suggestion}
          </button>
        ))}
      </div>

      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value.slice(0, GREETING_MAX_LENGTH))}
        rows={2}
        aria-label={`Mensagem para ${firstName}`}
        placeholder={`Escreva algo para ${firstName}…`}
        className="w-full rounded-lg border border-outline-variant/50 bg-surface p-md text-body-md text-on-surface outline-none placeholder:text-on-surface-variant focus:border-primary"
      />

      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-sm">
        <span className="font-label text-label-sm text-on-surface-variant">
          {message.trim().length}/{GREETING_MAX_LENGTH}
        </span>
        <button
          type="submit"
          disabled={!message.trim() || sign.isPending}
          className="flex items-center gap-xs rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          <Icon name="celebration" className="text-[18px]" />
          {existing ? 'Atualizar mensagem' : 'Assinar o mural'}
        </button>
      </div>
    </form>
  )
}

/** Uma assinatura: quem escreveu, o texto, as reações e as ações de quem pode. */
function GreetingRow({ greeting, targetId }: { greeting: BirthdayGreetingDTO; targetId: string }) {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['birthday-wall', targetId] })

  const react = useMutation({
    mutationFn: (emoji: FeedbackReactionEmoji) =>
      apiFetch(`/birthday-greetings/${greeting.id}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      }),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: () => apiFetch<void>(`/birthday-greetings/${greeting.id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })

  return (
    <li className="flex gap-sm rounded-lg bg-surface/70 p-sm">
      <Link
        to={`/perfil/${greeting.author.id}`}
        className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/50 bg-surface-container-highest"
      >
        <Avatar user={greeting.author} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-sm">
          <p className="min-w-0 truncate font-label text-label-md text-on-surface">{greeting.author.name}</p>
          {greeting.canDelete && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Apagar esta mensagem do mural?')) remove.mutate()
              }}
              disabled={remove.isPending}
              aria-label={`Apagar a mensagem de ${greeting.author.name}`}
              className="shrink-0 text-on-surface-variant transition-colors hover:text-error"
            >
              <Icon name="close" className="text-[16px]" />
            </button>
          )}
        </div>
        <p className="whitespace-pre-wrap break-words text-body-md text-on-surface">{greeting.message}</p>
        <div className="mt-xs">
          <FeedbackReactions
            reactions={greeting.reactions}
            options={FEEDBACK_REACTIONS}
            onToggle={(emoji) => react.mutate(emoji)}
          />
        </div>
      </div>
    </li>
  )
}
