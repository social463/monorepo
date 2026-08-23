/**
 * O painel de convite, no topo do encontro. Tem dois donos e nunca os dois ao
 * mesmo tempo:
 *
 * - **Convidado, convite pendente**: aceita ou recusa. Recusar abre o campo de
 *   sugestão de horário — o caso real quase nunca é "não quero", é "não posso
 *   nesse horário".
 * - **Quem marcou, com sugestão na mesa**: aceita a sugestão (só neste encontro
 *   ou movendo a série junto) ou descarta.
 *
 * O padrão do escopo muda conforme a ação, e isso é deliberado: aceitar assume
 * a série (quem topa o ritual topa o ritmo; 52 cliques para dizer sim é a
 * fricção que a feature existe para remover), recusar assume só esta ocorrência
 * (o caso comum é uma semana específica, não o fim do ritual).
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ONE_ON_ONE_DECLINE_NOTE_MAX_LENGTH,
  type OneOnOneMeetingSummaryDTO,
} from '@legends/shared'
import { ApiError } from '../../lib/api'
import {
  acceptOneOnOneProposal,
  declineOneOnOneProposal,
  respondToOneOnOne,
} from '../../lib/one-on-one-api'
import { Icon } from '../../components/Icon'

const campoCls =
  'w-full rounded-md border border-outline-variant/40 bg-surface-container-low px-sm py-xs text-body-md text-on-surface'
const rotuloCls = 'font-label text-label-sm text-on-surface-variant'
const botaoPrimarioCls =
  'rounded-md bg-primary px-md py-xs font-label text-label-lg text-on-primary transition-all hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant'
const botaoNeutroCls =
  'rounded-md border border-outline-variant/60 px-md py-xs font-label text-label-lg text-on-surface transition-colors hover:bg-surface-container-highest'

const quandoLongo = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

const dois = (n: number) => String(n).padStart(2, '0')

/** Instante → valor de `input[type=datetime-local]`, que fala relógio local. */
function paraCampoLocal(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}`
}

function Painel({
  tom,
  icone,
  titulo,
  children,
}: {
  tom: 'aviso' | 'neutro'
  icone: string
  titulo: string
  children: React.ReactNode
}) {
  return (
    <section
      className={`flex flex-col gap-md rounded-xl border p-lg ${
        tom === 'aviso'
          ? 'border-tertiary/40 bg-tertiary-container/10'
          : 'border-outline-variant/40 bg-surface-container-low'
      }`}
    >
      <h2 className="flex items-center gap-sm font-headline text-headline-sm text-on-surface">
        <Icon name={icone} className="text-[20px] text-primary" />
        {titulo}
      </h2>
      {children}
    </section>
  )
}

export function InvitePanel({ meeting }: { meeting: OneOnOneMeetingSummaryDTO }) {
  const queryClient = useQueryClient()
  const [recusando, setRecusando] = useState(false)
  const [sugestao, setSugestao] = useState('')
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const serie = meeting.recurrence !== 'NONE'
  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['one-on-ones'] })
    queryClient.invalidateQueries({ queryKey: ['one-on-one', meeting.id] })
  }
  const falhou = (fallback: string) => (err: unknown) =>
    setErro(err instanceof ApiError ? err.message : fallback)

  const responder = useMutation({
    mutationFn: (input: { aceitar: boolean }) =>
      respondToOneOnOne(
        meeting.id,
        input.aceitar
          ? { response: 'ACCEPTED' }
          : {
              response: 'DECLINED',
              // `datetime-local` não tem fuso; o `Date` local resolve para o
              // instante que a API espera, e é o mesmo relógio que a pessoa viu.
              proposedStartsAt: sugestao ? new Date(sugestao).toISOString() : null,
              declineNote: motivo.trim() || null,
            },
        // Aceitar assume a série; recusar, só esta ocorrência.
        input.aceitar && serie ? 'future' : 'this',
      ),
    onSuccess: () => {
      invalidar()
      setRecusando(false)
    },
    onError: falhou('Não foi possível responder ao convite.'),
  })

  const aceitarSugestao = useMutation({
    mutationFn: (scope: 'this' | 'future') => acceptOneOnOneProposal(meeting.id, scope),
    onSuccess: invalidar,
    onError: falhou('Não foi possível aceitar o horário sugerido.'),
  })

  const descartarSugestao = useMutation({
    mutationFn: () => declineOneOnOneProposal(meeting.id),
    onSuccess: invalidar,
    onError: falhou('Não foi possível descartar a sugestão.'),
  })

  const mensagemDeErro = erro && (
    <p role="alert" className="text-body-sm text-error">
      {erro}
    </p>
  )

  // Quem marcou, com sugestão na mesa.
  if (!meeting.viewerIsInvitee && meeting.proposedStartsAt) {
    return (
      <Painel tom="aviso" icone="schedule" titulo={`${meeting.counterpart.name} sugeriu outro horário`}>
        <p className="text-body-md text-on-surface">
          {quandoLongo.format(new Date(meeting.proposedStartsAt))}
        </p>
        {meeting.declineNote && (
          <p className="text-body-sm italic text-on-surface-variant">“{meeting.declineNote}”</p>
        )}
        {mensagemDeErro}
        <div className="flex flex-wrap gap-sm">
          <button
            type="button"
            className={botaoPrimarioCls}
            disabled={aceitarSugestao.isPending}
            onClick={() => {
              setErro(null)
              aceitarSugestao.mutate('this')
            }}
          >
            Aceitar só neste
          </button>
          {/* Move as seguintes pelo MESMO intervalo: a série quinzenal de terça
              vira quinzenal de quinta, sem remarcar uma a uma. */}
          {serie && (
            <button
              type="button"
              className={botaoNeutroCls}
              disabled={aceitarSugestao.isPending}
              onClick={() => {
                setErro(null)
                aceitarSugestao.mutate('future')
              }}
            >
              Aceitar e mover a série
            </button>
          )}
          <button
            type="button"
            className={botaoNeutroCls}
            disabled={descartarSugestao.isPending}
            onClick={() => {
              setErro(null)
              descartarSugestao.mutate()
            }}
          >
            Descartar
          </button>
        </div>
      </Painel>
    )
  }

  // Quem marcou, esperando resposta.
  if (!meeting.viewerIsInvitee) {
    if (meeting.inviteeResponse === 'ACCEPTED') return null
    return (
      <Painel
        tom="neutro"
        icone={meeting.inviteeResponse === 'DECLINED' ? 'event_busy' : 'hourglass_empty'}
        titulo={
          meeting.inviteeResponse === 'DECLINED'
            ? `${meeting.counterpart.name} não pode neste horário`
            : `Aguardando a resposta de ${meeting.counterpart.name}`
        }
      >
        <p className="text-body-sm text-on-surface-variant">
          {meeting.inviteeResponse === 'DECLINED'
            ? meeting.declineNote
              ? `“${meeting.declineNote}” — remarque ou cancele pelo menu de ações.`
              : 'Remarque ou cancele pelo menu de ações.'
            : 'O encontro segue marcado enquanto isso.'}
        </p>
      </Painel>
    )
  }

  // Convidado que já respondeu — nada a fazer, e o estado aparece no cabeçalho.
  if (meeting.inviteeResponse !== 'PENDING') return null

  return (
    <Painel tom="aviso" icone="mark_email_unread" titulo="Você foi convidado para este 1:1">
      <p className="text-body-md text-on-surface">{quandoLongo.format(new Date(meeting.startsAt))}</p>
      {mensagemDeErro}

      {!recusando ? (
        <div className="flex flex-wrap gap-sm">
          <button
            type="button"
            className={botaoPrimarioCls}
            disabled={responder.isPending}
            onClick={() => {
              setErro(null)
              responder.mutate({ aceitar: true })
            }}
          >
            {serie ? 'Aceitar a série' : 'Aceitar'}
          </button>
          <button type="button" className={botaoNeutroCls} onClick={() => setRecusando(true)}>
            Não posso
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-md"
          onSubmit={(event) => {
            event.preventDefault()
            setErro(null)
            responder.mutate({ aceitar: false })
          }}
        >
          <label className="flex flex-col gap-xs">
            <span className={rotuloCls}>Sugerir outro horário (opcional)</span>
            <input
              type="datetime-local"
              value={sugestao}
              min={paraCampoLocal(new Date().toISOString())}
              onChange={(event) => setSugestao(event.target.value)}
              className={campoCls}
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className={rotuloCls}>Motivo (opcional)</span>
            <input
              value={motivo}
              maxLength={ONE_ON_ONE_DECLINE_NOTE_MAX_LENGTH}
              placeholder="Ex.: estarei em viagem"
              onChange={(event) => setMotivo(event.target.value)}
              className={campoCls}
            />
          </label>
          <p className="text-body-sm text-on-surface-variant">
            Recusar não cancela o 1:1 — {meeting.counterpart.name} decide se remarca ou cancela.
          </p>
          <div className="flex flex-wrap gap-sm">
            <button type="submit" className={botaoPrimarioCls} disabled={responder.isPending}>
              Enviar recusa
            </button>
            <button type="button" className={botaoNeutroCls} onClick={() => setRecusando(false)}>
              Voltar
            </button>
          </div>
        </form>
      )}
    </Painel>
  )
}
