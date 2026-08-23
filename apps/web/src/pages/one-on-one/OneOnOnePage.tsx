import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { OneOnOneMeetingSummaryDTO } from '@legends/shared'
import { listOneOnOnes } from '../../lib/one-on-one-api'
import { useOneOnOneSocket } from '../../lib/useOneOnOneSocket'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { MeetingActionsMenu } from './MeetingActionsMenu'
import { NewOneOnOneModal } from './NewOneOnOneModal'

/**
 * Quantos "próximos" a lista mostra antes de dobrar o resto. A janela vai até
 * três meses à frente, e a recorrência é semanal na maioria das séries: sem
 * corte, UMA pessoa já enche a tela com ~12 cards que dizem a mesma coisa.
 * O passado não precisa disso — a janela só volta até o mês anterior.
 */
const LIMITE_PROXIMOS = 5

/** Janela da lista: do mês passado a três meses à frente. */
function janela(): { from: string; to: string } {
  const hoje = new Date()
  const from = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
  const to = new Date(hoje.getFullYear(), hoje.getMonth() + 3, 0)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { from: iso(from), to: iso(to) }
}

const soHora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const diaCompleto = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })

/**
 * Distância em dias de CALENDÁRIO, não em blocos de 24h: 23h de hoje e 7h de
 * amanhã são "amanhã", ainda que separados por 8 horas. `Date.now()` (e não
 * `new Date()`) porque é o relógio que a tela inteira usa — e o que os testes
 * congelam.
 */
function diasAte(startsAt: string): number {
  const meiaNoite = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((meiaNoite(new Date(startsAt)) - meiaNoite(new Date(Date.now()))) / 86_400_000)
}

function quando(startsAt: string): string {
  const data = new Date(startsAt)
  const hora = soHora.format(data)
  const dias = diasAte(startsAt)
  if (dias === 0) return `Hoje, ${hora}`
  if (dias === 1) return `Amanhã, ${hora}`
  if (dias === -1) return `Ontem, ${hora}`
  return `${diaCompleto.format(data)}, ${hora}`
}

/**
 * Um encontro só vira passado quando **termina** — o corte é o `endsAt`, não o
 * `startsAt`. Senão a 1:1 das 13h30 com 30 min cai no histórico às 13h30min01s,
 * esmaecida e com "Ver resumo", justamente enquanto está acontecendo.
 *
 * Entre início e fim ele fica `em-andamento`, um terceiro estado: é o mais
 * visível da tela, porque é o único onde ainda dá para fazer alguma coisa agora.
 */
type EstadoDoEncontro = 'em-andamento' | 'futuro' | 'passado'

function estadoDoEncontro(meeting: OneOnOneMeetingSummaryDTO, agora: number): EstadoDoEncontro {
  if (new Date(meeting.endsAt).getTime() <= agora) return 'passado'
  if (new Date(meeting.startsAt).getTime() <= agora) return 'em-andamento'
  return 'futuro'
}

/**
 * Onde o selo de pendência aparece. A contagem de ações em aberto é do PAR, não
 * do encontro, então ela vem igual em todas as ocorrências da série — repetir o
 * selo em cada linha só polui a lista. Aqui ele fica no **próximo encontro** de
 * cada pessoa, que é onde a pendência vai ser tratada.
 *
 * Sem encontro futuro com aquela pessoa, o selo cai no mais recente do passado:
 * o combinado continua em aberto, e some-lo da tela inteira esconderia a
 * pendência justamente de quem não remarcou.
 */
function meetingsComSelo(meetings: OneOnOneMeetingSummaryDTO[], agora: number): Set<string> {
  const porPessoa = new Map<string, OneOnOneMeetingSummaryDTO[]>()
  for (const meeting of meetings) {
    if (meeting.openActionCount === 0) continue
    const atual = porPessoa.get(meeting.counterpart.id)
    if (atual) atual.push(meeting)
    else porPessoa.set(meeting.counterpart.id, [meeting])
  }

  const ids = new Set<string>()
  for (const daPessoa of porPessoa.values()) {
    const ordenados = [...daPessoa].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    const proximo = ordenados.find((m) => estadoDoEncontro(m, agora) !== 'passado')
    const alvo = proximo ?? ordenados[ordenados.length - 1]
    if (alvo) ids.add(alvo.id)
  }
  return ids
}

const TOM_DO_SELO = {
  agora: 'border-primary/40 bg-primary-container/30 text-primary',
  ok: 'border-secondary/30 bg-secondary-container/20 text-secondary',
  alerta: 'border-error/30 bg-error-container/20 text-error',
  atencao: 'border-tertiary/30 bg-tertiary-container/10 text-tertiary',
  neutro: 'border-outline-variant/50 bg-surface-container-highest text-on-surface-variant',
} as const

function Selo({ tom, icone, children }: { tom: keyof typeof TOM_DO_SELO; icone: string; children: string }) {
  return (
    <span
      className={`flex shrink-0 items-center gap-xs rounded-full border px-sm py-xs font-label text-label-sm ${TOM_DO_SELO[tom]}`}
    >
      <Icon name={icone} className="text-[14px]" />
      {children}
    </span>
  )
}

function MeetingCard({
  meeting,
  mostraPendencias,
  estado,
}: {
  meeting: OneOnOneMeetingSummaryDTO
  mostraPendencias: boolean
  estado: EstadoDoEncontro
}) {
  const passado = estado === 'passado'
  const emAndamento = estado === 'em-andamento'
  const hoje = estado === 'futuro' && diasAte(meeting.startsAt) === 0
  // O encontro de hoje e o que está rolando dividem o mesmo realce; só o selo
  // e o horário de fim separam "é hoje" de "é agora".
  const destacado = emAndamento || hoje
  const acoes = meeting.openActionCount

  return (
    /* O card é um `div`, e não o `<Link>` inteiro: o menu de ações é um botão, e
       botão dentro de link é HTML inválido. Quem carrega a navegação é o link
       esticado (`after:absolute after:inset-0`), que mantém UM ponto de foco para
       o card; o menu fica acima dele (`z-10`), como irmão. */
    <div
      data-meeting-card={meeting.id}
      className={`group relative flex flex-col gap-md rounded-xl border p-md transition-colors md:flex-row md:items-center md:justify-between ${
        emAndamento
          ? 'border-primary/60 bg-surface-container shadow-lg shadow-primary/10 hover:border-primary'
          : hoje
            ? 'border-primary/30 bg-surface-container shadow-lg shadow-primary/5 hover:border-primary/60'
            : passado
              ? 'border-outline-variant/30 bg-surface-container-lowest opacity-80 hover:opacity-100'
              : 'border-outline-variant/50 bg-surface-container hover:border-outline-variant'
      }`}
    >
      {/* A tarja marca o encontro de hoje sem gastar um selo com isso — e fica
          mais grossa no que está acontecendo, que é o único com selo próprio. */}
      {destacado && (
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 overflow-hidden rounded-l-xl bg-primary ${emAndamento ? 'w-1.5' : 'w-1'}`}
        />
      )}

      <Link
        to={`/1-1/${meeting.id}`}
        className="flex min-w-0 items-center gap-md after:absolute after:inset-0 after:rounded-xl after:content-['']"
      >
        <span className="relative shrink-0">
          <span
            className={`flex items-center justify-center overflow-hidden rounded-full border border-outline-variant bg-surface-container-high ${
              passado ? 'h-10 w-10' : 'h-12 w-12'
            }`}
          >
            <Avatar user={meeting.counterpart} />
          </span>
          {destacado && (
            <span
              aria-hidden
              className={`absolute -bottom-[2px] -right-[2px] h-4 w-4 rounded-full border-2 border-surface-container ${
                emAndamento ? 'animate-pulse bg-primary' : 'bg-primary-container'
              }`}
            />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-label text-title-md text-on-surface">{meeting.counterpart.name}</span>
          <span className="mt-xs flex items-center gap-xs text-body-sm text-on-surface-variant">
            <Icon
              name={emAndamento ? 'sensors' : hoje ? 'calendar_today' : 'schedule'}
              className={destacado ? 'text-[16px] text-primary' : 'text-[16px]'}
            />
            {/* Em andamento o fim é a informação que falta: diz quanto ainda dá
                para conversar, e é ele que decide quando o card sai daqui. */}
            {emAndamento ? `${quando(meeting.startsAt)} — até ${soHora.format(new Date(meeting.endsAt))}` : quando(meeting.startsAt)}
          </span>
        </span>
      </Link>

      <span className="flex flex-wrap items-center gap-sm md:justify-end">
        {emAndamento && (
          <Selo tom="agora" icone="sensors">
            Acontecendo agora
          </Selo>
        )}
        {/* O convite pendente vem antes de tudo: é o que decide se o encontro
            existe. Preparar pauta de encontro que talvez não aconteça é a ordem
            errada, então o selo de pauta some enquanto não há resposta. */}
        {!passado && meeting.inviteeResponse === 'PENDING' && (
          <Selo tom="atencao" icone={meeting.viewerIsInvitee ? 'mark_email_unread' : 'hourglass_empty'}>
            {meeting.viewerIsInvitee ? 'Responder convite' : 'Aguardando resposta'}
          </Selo>
        )}
        {!passado && meeting.inviteeResponse === 'DECLINED' && (
          <Selo tom="alerta" icone="event_busy">
            {meeting.proposedStartsAt ? 'Recusado — sugeriu outro horário' : 'Recusado'}
          </Selo>
        )}
        {!passado &&
          meeting.inviteeResponse === 'ACCEPTED' &&
          (meeting.topicCount === 0 ? (
            <Selo tom="alerta" icone="warning">
              Sem pauta
            </Selo>
          ) : (
            <Selo tom="ok" icone="checklist">
              Pauta pronta
            </Selo>
          ))}
        {passado && meeting.status === 'DONE' && (
          <Selo tom="neutro" icone="check">
            Realizado
          </Selo>
        )}
        {mostraPendencias && acoes > 0 && (
          <Selo tom="atencao" icone="assignment_turned_in">
            {`${acoes} ${acoes === 1 ? 'ação em aberto' : 'ações em aberto'}`}
          </Selo>
        )}
        {/* Afordância visual, não um controle: o link esticado já cobre o card, e
            um segundo caminho para o mesmo destino só somaria parada de foco. */}
        <span
          className={`shrink-0 rounded-lg px-md py-xs font-label text-label-md transition-colors ${
            destacado
              ? 'bg-primary text-on-primary'
              : 'border border-outline-variant text-on-surface group-hover:bg-surface-container-high'
          }`}
        >
          {passado ? 'Ver resumo' : 'Abrir pauta'}
        </span>
        {/* Acima do link esticado, senão o clique no menu abriria o encontro. */}
        <MeetingActionsMenu meeting={meeting} className="z-10" />
      </span>
    </div>
  )
}

export function OneOnOnePage() {
  // Convite respondido, encontro remarcado ou cancelado pelo outro lado chegam
  // aqui sem refresh — a lista é onde a pessoa decide o que fazer com eles.
  useOneOnOneSocket()
  const [novoAberto, setNovoAberto] = useState(false)
  const [verTodosProximos, setVerTodosProximos] = useState(false)
  const { from, to } = useMemo(janela, [])
  const { data, isLoading } = useQuery({
    queryKey: ['one-on-ones', from, to],
    queryFn: () => listOneOnOnes(from, to),
  })

  const agora = Date.now()
  const meetings = data?.meetings ?? []
  const proximos = meetings.filter((m) => estadoDoEncontro(m, agora) !== 'passado')
  const passados = meetings.filter((m) => estadoDoEncontro(m, agora) === 'passado').reverse()
  const temEmAndamento = proximos.some((m) => estadoDoEncontro(m, agora) === 'em-andamento')
  const comSelo = useMemo(() => meetingsComSelo(meetings, agora), [meetings, agora])

  const proximosVisiveis = verTodosProximos ? proximos : proximos.slice(0, LIMITE_PROXIMOS)
  const dobrados = proximos.slice(LIMITE_PROXIMOS)
  // Uma pendência escondida atrás do "ver mais" é justamente o que o selo
  // existe para não deixar sumir, então o botão a anuncia.
  const pendenciasDobradas = dobrados.filter((m) => comSelo.has(m.id)).length

  return (
    <section className="mx-auto flex max-w-page flex-col gap-xl p-lg md:p-xl">
      <header className="flex flex-col gap-md md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-headline text-headline-lg text-on-surface md:text-headline-xl">1:1</h1>
          <p className="mt-sm max-w-2xl text-body-md text-on-surface-variant">
            Suas conversas, a pauta e o que ficou combinado com o time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNovoAberto(true)}
          className="flex shrink-0 items-center gap-xs self-start rounded-lg bg-primary-container px-md py-sm font-label text-label-md font-bold text-on-primary-container shadow-lg shadow-primary/10 transition-all hover:brightness-110 md:self-auto"
        >
          <Icon name="add" className="text-[18px]" />
          Marcar 1:1
        </button>
      </header>

      {isLoading && <p className="text-body-md text-on-surface-variant">Carregando…</p>}

      {!isLoading && meetings.length === 0 && (
        <p className="rounded-xl border border-dashed border-outline-variant/60 p-xl text-center text-body-md text-on-surface-variant">
          Você ainda não tem nenhum 1:1 marcado.
        </p>
      )}

      {proximos.length > 0 && (
        <section>
          <h2 className="mb-md flex items-center gap-sm font-headline text-headline-md text-primary">
            <Icon name={temEmAndamento ? 'sensors' : 'event_upcoming'} filled className="text-[24px]" />
            {/* Um encontro rolando agora não é "próximo": o título muda para não
                desmentir o card que está logo abaixo dizendo que já começou. */}
            {temEmAndamento ? 'Agora e a seguir' : 'Próximos encontros'}
          </h2>
          <div className="flex flex-col gap-sm">
            {proximosVisiveis.map((meeting) => (
              <MeetingCard
                key={meeting.id}
                meeting={meeting}
                mostraPendencias={comSelo.has(meeting.id)}
                estado={estadoDoEncontro(meeting, agora)}
              />
            ))}
          </div>
          {dobrados.length > 0 && (
            <button
              type="button"
              aria-expanded={verTodosProximos}
              onClick={() => setVerTodosProximos((aberto) => !aberto)}
              className="mt-sm flex w-full items-center justify-center gap-xs rounded-xl border border-dashed border-outline-variant/60 py-sm font-label text-label-md text-on-surface-variant transition-colors hover:border-primary/40 hover:text-on-surface"
            >
              <Icon name={verTodosProximos ? 'expand_less' : 'expand_more'} className="text-[18px]" />
              {verTodosProximos
                ? 'Ver menos'
                : `Ver mais ${dobrados.length} ${dobrados.length === 1 ? 'encontro' : 'encontros'}${
                    pendenciasDobradas > 0
                      ? ` · ${pendenciasDobradas} com ${pendenciasDobradas === 1 ? 'ação' : 'ações'} em aberto`
                      : ''
                  }`}
            </button>
          )}
        </section>
      )}

      {passados.length > 0 && (
        <section>
          <h2 className="mb-md flex items-center gap-sm font-headline text-headline-md text-on-surface-variant">
            <Icon name="history" className="text-[24px]" />
            Histórico recente
          </h2>
          <div className="flex flex-col gap-sm">
            {passados.map((meeting) => (
              <MeetingCard
                key={meeting.id}
                meeting={meeting}
                mostraPendencias={comSelo.has(meeting.id)}
                estado="passado"
              />
            ))}
          </div>
        </section>
      )}

      {novoAberto && <NewOneOnOneModal onClose={() => setNovoAberto(false)} />}
    </section>
  )
}
