/**
 * Menu de ações de um encontro de 1:1 — remarcar e cancelar —, com os dois
 * diálogos que elas abrem. Vive num componente só porque a lista e o detalhe
 * oferecem exatamente as mesmas ações: duplicar daria duas regras de escopo
 * para manter, e é justamente aí que as duas telas divergiriam.
 *
 * Só encontro `SCHEDULED` tem ações: a API responde 409 para remarcar ou
 * cancelar o que já foi realizado ou cancelado, e um menu que só serve para
 * receber erro não é menu.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ONE_ON_ONE_DURATIONS_MINUTES,
  type OneOnOneMeetingSummaryDTO,
} from '@legends/shared'
import { ApiError } from '../../lib/api'
import { cancelOneOnOne, listOneOnOnes, rescheduleOneOnOne } from '../../lib/one-on-one-api'
import { Icon } from '../../components/Icon'

/**
 * `series` é escopo DA TELA, não da API: vira um `future` mirando a primeira
 * ocorrência ainda agendada. A API tem só `this` e `future` de propósito —
 * "este e os seguintes" nunca reescreve encontro anterior ao escolhido —, e é
 * exatamente por isso que faltava um jeito de dizer "a série toda" quando se
 * está no meio dela.
 *
 * Só vale para CANCELAR. Remarcar desloca todas as ocorrências pelo mesmo
 * intervalo, medido a partir do encontro que está na tela; mirar a primeira
 * ocorrência mudaria a régua da conta e moveria a série para um lugar que
 * ninguém pediu.
 */
type Escopo = 'this' | 'future' | 'series'

const campoCls =
  'w-full rounded-md border border-outline-variant/40 bg-surface-container-low px-sm py-xs text-body-md text-on-surface'
const rotuloCls = 'font-label text-label-sm text-on-surface-variant'
const botaoNeutroCls =
  'rounded-md px-md py-xs font-label text-label-lg text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'

const dois = (n: number) => String(n).padStart(2, '0')

/**
 * O encontro de volta para os campos do formulário. `input[type=date|time]` fala
 * relógio de parede local, que é o mesmo que a API espera receber — por isso os
 * getters locais, e não `toISOString`, que devolveria UTC.
 */
function camposDe(meeting: OneOnOneMeetingSummaryDTO): {
  date: string
  startTime: string
  durationMinutes: number
} {
  const inicio = new Date(meeting.startsAt)
  const minutos = Math.round((new Date(meeting.endsAt).getTime() - inicio.getTime()) / 60_000)
  return {
    date: `${inicio.getFullYear()}-${dois(inicio.getMonth() + 1)}-${dois(inicio.getDate())}`,
    startTime: `${dois(inicio.getHours())}:${dois(inicio.getMinutes())}`,
    // Duração fora da lista (encontro antigo, lista mudada) não pode sumir do
    // select e virar outra duração sem ninguém pedir: cai na mais próxima.
    durationMinutes: ONE_ON_ONE_DURATIONS_MINUTES.reduce((melhor, opcao) =>
      Math.abs(opcao - minutos) < Math.abs(melhor - minutos) ? opcao : melhor,
    ),
  }
}

const diaCurto = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })

/**
 * Quantos encontros a ação atinge, e em que intervalo. É a informação que
 * faltava: "este e os seguintes" pode valer por um único encontro (quando as
 * ocorrências posteriores já foram canceladas) ou por dez, e a tela não dizia
 * qual dos dois — o resultado parecia um escopo que não funcionou.
 */
function resumoDoLote(alvos: OneOnOneMeetingSummaryDTO[], verbo: string): string | null {
  if (alvos.length === 0) return null
  if (alvos.length === 1) return `${verbo} 1 encontro.`
  const primeiro = diaCurto.format(new Date(alvos[0].startsAt))
  const ultimo = diaCurto.format(new Date(alvos[alvos.length - 1].startsAt))
  return `${verbo} ${alvos.length} encontros, de ${primeiro} a ${ultimo}.`
}

/** O seletor de escopo só aparece em série: encontro avulso não tem "seguintes". */
function EscopoField({
  value,
  onChange,
  legenda,
  opcoes,
}: {
  value: Escopo
  onChange: (escopo: Escopo) => void
  legenda: string
  opcoes: { escopo: Escopo; rotulo: string; resumo: string | null }[]
}) {
  return (
    <fieldset className="flex flex-col gap-xs">
      <legend className={`mb-xs ${rotuloCls}`}>{legenda}</legend>
      {opcoes.map(({ escopo, rotulo, resumo }) => (
        <label key={escopo} className="flex items-start gap-sm text-body-md text-on-surface">
          <input
            type="radio"
            name="escopo"
            value={escopo}
            checked={value === escopo}
            onChange={() => onChange(escopo)}
            className="mt-[3px] h-4 w-4 shrink-0 accent-primary"
          />
          <span>
            {rotulo}
            {/* O resumo só existe depois que a agenda da série carrega — sem ele,
                a opção aparece sozinha, em vez de mentir uma contagem. */}
            {resumo && <span className="block text-body-sm text-on-surface-variant">{resumo}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  )
}

function Dialogo({
  titulo,
  onClose,
  children,
}: {
  titulo: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const fecharNoEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', fecharNoEsc)
    return () => document.removeEventListener('keydown', fecharNoEsc)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-outline-variant/40 bg-surface-container p-lg shadow-xl">
        <div className="mb-md flex items-center justify-between">
          <h2 className="font-headline text-title-md text-on-surface">{titulo}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
          >
            <Icon name="close" className="text-[18px]" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function MeetingActionsMenu({
  meeting,
  onCanceled,
  className = '',
}: {
  meeting: OneOnOneMeetingSummaryDTO
  /** Chamado depois de cancelar — o detalhe usa para sair da tela do encontro. */
  onCanceled?: () => void
  className?: string
}) {
  const queryClient = useQueryClient()
  const [aberto, setAberto] = useState(false)
  const [dialogo, setDialogo] = useState<'remarcar' | 'cancelar' | null>(null)
  const [escopo, setEscopo] = useState<Escopo>('this')
  const [campos, setCampos] = useState(() => camposDe(meeting))
  const [erro, setErro] = useState<string | null>(null)
  const raiz = useRef<HTMLDivElement>(null)

  const serie = meeting.recurrence !== 'NONE'

  useEffect(() => {
    if (!aberto) return
    const fechar = (event: MouseEvent) => {
      if (!raiz.current?.contains(event.target as Node)) setAberto(false)
    }
    const fecharNoEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', fechar)
    document.addEventListener('keydown', fecharNoEsc)
    return () => {
      document.removeEventListener('mousedown', fechar)
      document.removeEventListener('keydown', fecharNoEsc)
    }
  }, [aberto])

  // As ocorrências da série, para contar o que cada escopo atinge. Vem da agenda
  // que já existe (`GET /one-on-ones?from&to`), numa janela larga o bastante para
  // caber a série inteira — o teto é 52 ocorrências, e mensal é o ritmo mais
  // esparso. Só busca quando um diálogo abre: contagem é informação de confirmação.
  const janela = useMemo(() => {
    const base = new Date(meeting.startsAt)
    const iso = (d: Date) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`
    const de = new Date(base)
    de.setFullYear(de.getFullYear() - 5)
    const ate = new Date(base)
    ate.setFullYear(ate.getFullYear() + 5)
    return { from: iso(de), to: iso(ate) }
  }, [meeting.startsAt])

  const { data: agenda } = useQuery({
    queryKey: ['one-on-ones', janela.from, janela.to],
    queryFn: () => listOneOnOnes(janela.from, janela.to),
    enabled: dialogo !== null && serie,
  })

  // O que a API vai de fato mexer: `futureScheduledWhere` filtra por SCHEDULED,
  // então encontro já realizado ou cancelado não entra na conta.
  const agendadas = useMemo(
    () =>
      (agenda?.meetings ?? [])
        .filter((m) => m.seriesId === meeting.seriesId && m.status === 'SCHEDULED')
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [agenda, meeting.seriesId],
  )
  const seguintes = agendadas.filter((m) => m.startsAt >= meeting.startsAt)
  // "Toda a série" só é oferecida quando difere de "este e os seguintes" — ou
  // seja, quando existe ocorrência agendada ANTES desta.
  const temAnteriores = agendadas.length > seguintes.length

  const alvos = (qual: Escopo) => (qual === 'this' ? [meeting] : qual === 'future' ? seguintes : agendadas)

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['one-on-ones'] })
    queryClient.invalidateQueries({ queryKey: ['one-on-one', meeting.id] })
  }
  const falhou = (err: unknown, fallback: string) =>
    setErro(err instanceof ApiError ? err.message : fallback)

  const remarcar = useMutation({
    // Remarcar não oferece "toda a série" (ver o comentário do tipo `Escopo`).
    mutationFn: () => rescheduleOneOnOne(meeting.id, campos, escopo === 'this' ? 'this' : 'future'),
    onSuccess: () => {
      invalidar()
      setDialogo(null)
    },
    onError: (err) => falhou(err, 'Não foi possível remarcar o 1:1.'),
  })

  const cancelar = useMutation({
    mutationFn: () =>
      escopo === 'series'
        ? // A série toda = `future` a partir da primeira ainda agendada.
          cancelOneOnOne((agendadas[0] ?? meeting).id, 'future')
        : cancelOneOnOne(meeting.id, escopo),
    onSuccess: () => {
      invalidar()
      setDialogo(null)
      onCanceled?.()
    },
    onError: (err) => falhou(err, 'Não foi possível cancelar o 1:1.'),
  })

  if (meeting.status !== 'SCHEDULED') return null

  const abrirDialogo = (qual: 'remarcar' | 'cancelar') => {
    setAberto(false)
    setErro(null)
    setEscopo('this')
    if (qual === 'remarcar') setCampos(camposDe(meeting))
    setDialogo(qual)
  }

  return (
    <div ref={raiz} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        aria-label={`Ações do 1:1 com ${meeting.counterpart.name}`}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((estava) => !estava)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
      >
        <Icon name="more_vert" className="text-[20px]" />
      </button>

      {aberto && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-container shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => abrirDialogo('remarcar')}
            className="flex w-full items-center gap-sm px-md py-sm text-left font-label text-label-md text-on-surface transition-colors hover:bg-surface-container-highest"
          >
            <Icon name="edit_calendar" className="text-[18px]" />
            Remarcar
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => abrirDialogo('cancelar')}
            className="flex w-full items-center gap-sm px-md py-sm text-left font-label text-label-md text-error transition-colors hover:bg-error-container/20"
          >
            <Icon name="event_busy" className="text-[18px]" />
            Cancelar 1:1
          </button>
        </div>
      )}

      {dialogo === 'remarcar' && (
        <Dialogo titulo="Remarcar 1:1" onClose={() => setDialogo(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              setErro(null)
              remarcar.mutate()
            }}
          >
            <div className="flex flex-col gap-md">
              <div className="grid grid-cols-2 gap-sm">
                <label className="flex flex-col gap-xs">
                  <span className={rotuloCls}>Data</span>
                  <input
                    type="date"
                    value={campos.date}
                    onChange={(event) => setCampos((c) => ({ ...c, date: event.target.value }))}
                    required
                    className={campoCls}
                  />
                </label>
                <label className="flex flex-col gap-xs">
                  <span className={rotuloCls}>Horário</span>
                  <input
                    type="time"
                    value={campos.startTime}
                    onChange={(event) => setCampos((c) => ({ ...c, startTime: event.target.value }))}
                    required
                    className={campoCls}
                  />
                </label>
              </div>

              <label className="flex flex-col gap-xs">
                <span className={rotuloCls}>Duração</span>
                <select
                  value={campos.durationMinutes}
                  onChange={(event) =>
                    setCampos((c) => ({ ...c, durationMinutes: Number(event.target.value) }))
                  }
                  className={campoCls}
                >
                  {ONE_ON_ONE_DURATIONS_MINUTES.map((minutos) => (
                    <option key={minutos} value={minutos}>
                      {minutos} minutos
                    </option>
                  ))}
                </select>
              </label>

              {/* Em série, `future` desloca as seguintes pelo MESMO intervalo,
                  preservando o espaçamento — não joga todas para o mesmo dia. */}
              {serie && (
                <EscopoField
                  value={escopo}
                  onChange={setEscopo}
                  legenda="O que remarcar"
                  opcoes={[
                    { escopo: 'this', rotulo: 'Só este encontro', resumo: null },
                    {
                      escopo: 'future',
                      rotulo: 'Este e os seguintes',
                      resumo: resumoDoLote(alvos('future'), 'Move'),
                    },
                  ]}
                />
              )}

              {erro && (
                <p role="alert" className="text-body-sm text-error">
                  {erro}
                </p>
              )}
            </div>

            <div className="mt-lg flex justify-end gap-sm">
              <button type="button" onClick={() => setDialogo(null)} className={botaoNeutroCls}>
                Voltar
              </button>
              <button
                type="submit"
                disabled={remarcar.isPending}
                className="rounded-md bg-primary px-md py-xs font-label text-label-lg text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
              >
                Remarcar
              </button>
            </div>
          </form>
        </Dialogo>
      )}

      {dialogo === 'cancelar' && (
        <Dialogo titulo="Cancelar 1:1" onClose={() => setDialogo(null)}>
          <div className="flex flex-col gap-md">
            {/* Cancelar não apaga: o encontro vira CANCELED e some da lista, mas
                a pauta e os combinados continuam de pé — daí o texto dizer isso. */}
            <p className="text-body-md text-on-surface-variant">
              O 1:1 com {meeting.counterpart.name} sai da agenda de vocês dois. A pauta e o que já ficou
              combinado continuam guardados.
            </p>

            {serie && (
              <EscopoField
                value={escopo}
                onChange={setEscopo}
                legenda="O que cancelar"
                opcoes={[
                  { escopo: 'this', rotulo: 'Só este encontro', resumo: null },
                  {
                    escopo: 'future',
                    rotulo: 'Este e os seguintes',
                    resumo: resumoDoLote(alvos('future'), 'Cancela'),
                  },
                  // Só quando difere de "os seguintes": senão são a mesma coisa
                  // com dois nomes, e escolher entre elas vira adivinhação.
                  ...(temAnteriores
                    ? [
                        {
                          escopo: 'series' as const,
                          rotulo: 'Toda a série',
                          resumo: resumoDoLote(alvos('series'), 'Cancela'),
                        },
                      ]
                    : []),
                ]}
              />
            )}

            {erro && (
              <p role="alert" className="text-body-sm text-error">
                {erro}
              </p>
            )}
          </div>

          <div className="mt-lg flex justify-end gap-sm">
            <button type="button" onClick={() => setDialogo(null)} className={botaoNeutroCls}>
              Voltar
            </button>
            <button
              type="button"
              disabled={cancelar.isPending}
              onClick={() => {
                setErro(null)
                cancelar.mutate()
              }}
              className="rounded-md bg-error px-md py-xs font-label text-label-lg text-on-error hover:brightness-110 disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              Cancelar 1:1
            </button>
          </div>
        </Dialogo>
      )}
    </div>
  )
}
