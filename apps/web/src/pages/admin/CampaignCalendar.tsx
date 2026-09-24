import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CAMPAIGN_BODY_MAX_LENGTH,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_MANUAL_DELIVERY_CHANNELS,
  CAMPAIGN_POST_STATUS_LABELS,
  canEditCalendarEvent,
  canSeeInternalCalendarEvents,
  tenureLabel,
  type AttachedImage,
  type CalendarEventOccurrenceDTO,
  type CalendarEventTypeDTO,
  type CalendarEventsResponse,
  type CampaignCalendarContextDTO,
  type CampaignChannel,
  type CampaignBandDTO,
  type CampaignPostDTO,
  type PublicUser,
  type ScheduledFeedPostDTO,
} from '@legends/shared'
import { useAuth } from '../../auth/AuthContext'
import { apiFetch, ApiError } from '../../lib/api'
import {
  cancelCampaignPost,
  createCampaignPost,
  deleteCampaignPost,
  getCampaignCalendarContext,
  listCampaignPosts,
  listScheduledFeedPosts,
  publishCampaignPost,
  updateCampaignPost,
} from '../../lib/campaign-api'
import { Icon } from '../../components/Icon'
import { ImagePicker } from '../../components/ImagePicker'
import { useImageUploadsEnabled } from '../../lib/use-image-upload'
import { errorMessage } from './shared'
import { inputCls, toLocalInput } from './shared'
import { CalendarEventDetails } from '../calendar/CalendarEventDetails'
import { CalendarEventModal } from '../calendar/CalendarEventModal'
import { computeSpans, monthWeekRows, WEEKDAY_LABELS, type RowSpan } from '../calendar/calendar-events'

/**
 * Instante ISO → data civil LOCAL (AAAA-MM-DD).
 *
 * Local, e não UTC: é assim que o comunicado já é posicionado na grade
 * (`new Date(post.scheduledFor)`), e faixa e item precisam concordar sobre em
 * que dia caem. Resolver a faixa em UTC faria uma campanha que termina às 21h
 * de Brasília acabar no dia seguinte.
 */
function ymdLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Tons da faixa de campanha. Pares container/on-container do M3, e não cor
 * gerada por hash do id: a campanha não tem cor cadastrada, e inventar uma
 * arriscaria contraste — os pares do tema já vêm com o texto legível junto, nos
 * dois esquemas.
 */
/** Identidade estável para o mês que ainda não carregou. */
const SEM_CAMPANHA: readonly CampaignBandDTO[] = []

const FAIXA_TONS = [
  'bg-primary-container text-on-primary-container',
  'bg-tertiary-container text-on-tertiary-container',
  'bg-secondary-container text-on-secondary-container',
]

/** A campanha atravessando a semana. Cantos redondos só nas pontas de verdade. */
function CampanhaFaixa({ faixa, tom }: { faixa: RowSpan<CampaignBandDTO>; tom: number }) {
  const { item, isStart, isEnd } = faixa
  return (
    <div
      title={`Campanha ${item.theme}`}
      style={{
        borderTopLeftRadius: isStart ? 4 : 0,
        borderBottomLeftRadius: isStart ? 4 : 0,
        borderTopRightRadius: isEnd ? 4 : 0,
        borderBottomRightRadius: isEnd ? 4 : 0,
      }}
      className={`flex h-full w-full items-center gap-1 overflow-hidden px-1.5 font-label text-[10px] leading-none ${
        FAIXA_TONS[tom % FAIXA_TONS.length]
      }`}
    >
      {/* O trecho continuado repete o tema com a seta: quem olha só a segunda
          semana da campanha precisa saber que faixa é aquela. */}
      {!isStart && <span aria-hidden="true">↳</span>}
      <span className="truncate">{item.theme}</span>
    </div>
  )
}

// Cor por status do item — reaproveita os tokens de tema, sem cor nova
// (mesmo critério de EVENT_TONE em pages/calendar/CalendarGrid.tsx).
const STATUS_CLASS: Record<CampaignPostDTO['status'], string> = {
  SCHEDULED: 'bg-tertiary/20 text-tertiary',
  PUBLISHED: 'bg-primary/20 text-primary',
  CANCELLED: 'bg-surface-container-highest text-on-surface-variant line-through',
}

/**
 * A grade mistura duas origens. Um item de campanha é editável aqui; um
 * agendado do Feed Corporativo é só leitura — reagendar e editar não existem
 * nem para o autor dele, e inventar isso no calendário seria uma segunda regra
 * de propriedade divergindo da do mural.
 */
type ItemDaGrade =
  | { origem: 'calendario'; quando: string; post: CampaignPostDTO }
  | { origem: 'feed'; quando: string; post: ScheduledFeedPostDTO }

/** Cor do agendado do feed: distinta das do calendário, para não se confundir. */
const FEED_CLASS = 'bg-secondary/20 text-secondary'

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
})

interface Draft {
  id: string | null
  title: string
  body: string
  visualHint: string
  image: AttachedImage | null
  scheduledFor: string
  channel: CampaignChannel
  responsibleId: string
  status: CampaignPostDTO['status']
  campaignTheme: string | null
}

function emptyDraft(): Draft {
  const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000)
  return {
    id: null,
    title: '',
    body: '',
    visualHint: '',
    image: null,
    scheduledFor: toLocalInput(amanha.toISOString()),
    channel: 'MURAL',
    responsibleId: '',
    status: 'SCHEDULED',
    campaignTheme: null,
  }
}

/**
 * Aba padrão da tela de campanhas: grade do mês com os comunicados agendados
 * e um painel de edição. É a aba que fica útil mesmo sem chave de IA
 * cadastrada (a aba Gerar não funciona nesse caso) — por isso "Novo item"
 * (criar comunicado na mão) mora aqui.
 */
export function CampaignCalendar({ initialDate }: { initialDate?: string } = {}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  // Lazy initializer: só roda uma vez, na montagem. `initialDate` chega da aba
  // Gerar (data do primeiro item confirmado) — sem isso, confirmar uma
  // campanha de um mês futuro cai numa grade do mês atual, vazia e sem aviso.
  const [cursor, setCursor] = useState(() => {
    const base = initialDate ? new Date(initialDate) : new Date()
    return { year: base.getFullYear(), month: base.getMonth() }
  })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [feedPost, setFeedPost] = useState<ScheduledFeedPostDTO | null>(null)
  /** Contexto do calendário organizacional (eventos, aniversários, tempo de
   * casa) — nasce ligado: é sempre contexto útil pra quem planeja campanha. */
  const [showContext, setShowContext] = useState(true)
  /** Id do item que está esperando confirmação de exclusão. */
  const [confirmarExclusao, setConfirmarExclusao] = useState<string | null>(null)
  const uploadsHabilitados = useImageUploadsEnabled()

  /** Evento do calendário organizacional aberto para consulta (clique no contexto). */
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventOccurrenceDTO | null>(null)
  const [eventEditor, setEventEditor] = useState<{ eventId: string | null } | null>(null)
  const [eventoErro, setEventoErro] = useState<string | null>(null)

  const range = useMemo(() => {
    const from = new Date(cursor.year, cursor.month, 1)
    const to = new Date(cursor.year, cursor.month + 1, 0, 23, 59, 59)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [cursor])

  const postsQuery = useQuery({
    // O mês visível entra na chave: sem isso, navegar de mês não recarrega.
    queryKey: ['campaign-posts', cursor.year, cursor.month],
    queryFn: () => listCampaignPosts(range.from, range.to),
  })

  /**
   * Os agendados do Feed Corporativo do mesmo mês. Consulta separada de
   * propósito: uma falha aqui não pode apagar o calendário editorial, que é o
   * que a tela existe para mostrar.
   */
  const feedQuery = useQuery({
    queryKey: ['campaign-feed-posts', cursor.year, cursor.month],
    queryFn: () => listScheduledFeedPosts(range.from, range.to),
  })

  /** Data civil (AAAA-MM-DD), sem hora — o formato que o contexto organizacional espera. */
  const contextRange = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0')
    const ultimoDia = new Date(cursor.year, cursor.month + 1, 0).getDate()
    return {
      from: `${cursor.year}-${pad(cursor.month + 1)}-01`,
      to: `${cursor.year}-${pad(cursor.month + 1)}-${pad(ultimoDia)}`,
    }
  }, [cursor])

  /**
   * Eventos do calendário organizacional e aniversários/tempo de casa do mês —
   * só contexto pra planejar, nunca editável aqui (ver `porDia`, que continua
   * só com os itens de campanha/feed). Consulta separada de propósito, e só
   * disparada com o toggle ligado: falha aqui não pode apagar a grade
   * editorial, e desligado não vale gastar a chamada.
   */
  const contextQuery = useQuery({
    queryKey: ['campaign-calendar-context', cursor.year, cursor.month],
    queryFn: () => getCampaignCalendarContext(contextRange.from, contextRange.to),
    enabled: showContext,
  })

  /**
   * Catálogo de categorias do calendário organizacional — só o que
   * `CalendarEventModal` precisa para editar um evento clicado no contexto.
   * Mesma janela e mesmo gate de `contextQuery`: sem o toggle ligado não há
   * evento para clicar.
   */
  const eventTypesQuery = useQuery({
    queryKey: ['campaign-calendar-event-types', cursor.year, cursor.month],
    queryFn: () =>
      apiFetch<CalendarEventsResponse>(`/calendar/events?from=${contextRange.from}&to=${contextRange.to}`),
    enabled: showContext,
  })
  const eventTypes: CalendarEventTypeDTO[] = eventTypesQuery.data?.types ?? []

  const podeMarcarInterno = canSeeInternalCalendarEvents(user?.role, user?.sectorFeatures ?? [], user?.adminAccess)

  const podeEditarEventoSelecionado =
    selectedEvent !== null &&
    user !== null &&
    canEditCalendarEvent(
      { id: user.id, role: user.role, sectorFeatures: user.sectorFeatures ?? [], adminAccess: user.adminAccess },
      { createdById: selectedEvent.createdById },
    )

  const deleteEventMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/calendar/events/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setSelectedEvent(null)
      await queryClient.invalidateQueries({ queryKey: ['campaign-calendar-context'] })
    },
    onError: (err: unknown) => setEventoErro(errorMessage(err, 'Erro ao excluir o evento.')),
  })

  const contextByDia = useMemo(() => {
    const mapa = new Map<
      number,
      { occurrences: CampaignCalendarContextDTO['occurrences']; birthdays: CampaignCalendarContextDTO['birthdays']; workAnniversaries: CampaignCalendarContextDTO['workAnniversaries'] }
    >()
    if (!showContext || !contextQuery.data) return mapa
    const entrada = (dia: number) => {
      const existente = mapa.get(dia)
      if (existente) return existente
      const novo = { occurrences: [], birthdays: [], workAnniversaries: [] }
      mapa.set(dia, novo)
      return novo
    }
    for (const o of contextQuery.data.occurrences) entrada(Number(o.iso.slice(8, 10))).occurrences.push(o)
    for (const b of contextQuery.data.birthdays) entrada(b.day).birthdays.push(b)
    for (const w of contextQuery.data.workAnniversaries) entrada(w.day).workAnniversaries.push(w)
    return mapa
  }, [showContext, contextQuery.data])

  const colleaguesQuery = useQuery({
    queryKey: ['colleagues-for-campaigns'],
    // scope=company: campanha é da empresa inteira (audience ALL), então o
    // responsável editorial pode ser de qualquer setor, não só o do admin logado.
    queryFn: () => apiFetch<{ users: PublicUser[] }>('/users?scope=company'),
  })

  const invalidate = () => {
    setErro(null)
    setDraft(null)
    setFeedPost(null)
    setConfirmarExclusao(null)
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['campaign-posts'] }),
      queryClient.invalidateQueries({ queryKey: ['campaign-feed-posts'] }),
    ])
  }
  const onError = (err: unknown) => setErro(err instanceof ApiError ? err.message : 'Não consegui salvar.')

  const salvar = useMutation({
    mutationFn: (d: Draft) => {
      const payload = {
        title: d.title,
        body: d.body,
        // Vazio vira `null` explicitamente — sem isso, incluir o campo no
        // payload zeraria `visualHint` a cada edição (string vazia != undefined,
        // então o service sempre aplicaria o update).
        visualHint: d.visualHint.trim() ? d.visualHint : null,
        // Mesmo motivo do `visualHint`: `null` explícito é o que apaga a arte
        // de um item que tinha uma.
        image: d.image,
        scheduledFor: new Date(d.scheduledFor).toISOString(),
        channel: d.channel,
        responsibleId: d.responsibleId || null,
      }
      return d.id
        ? updateCampaignPost(d.id, payload)
        : createCampaignPost({ ...payload, audience: 'ALL' })
    },
    onSuccess: invalidate,
    onError,
  })
  const publicar = useMutation({ mutationFn: publishCampaignPost, onSuccess: invalidate, onError })
  const cancelar = useMutation({ mutationFn: cancelCampaignPost, onSuccess: invalidate, onError })
  /**
   * Exclusão do agendado do Feed pela rota que já existe no mural — a permissão
   * é a de lá (`deletePost` já deixa quem administra apagar post de terceiro),
   * e não uma regra nova escrita no calendário.
   */
  /**
   * Excluir é diferente de cancelar, e os dois ficam: cancelado é registro
   * ("ia ter e desistimos") e continua riscado na grade; excluído é o que nunca
   * deveria ter entrado — teste, engano, duplicado — e que riscado só polui o
   * mês de quem for planejar depois.
   */
  const excluir = useMutation({
    mutationFn: deleteCampaignPost,
    onSuccess: () => {
      setConfirmarExclusao(null)
      return invalidate()
    },
    onError: (err: unknown) => {
      setConfirmarExclusao(null)
      onError(err)
    },
  })
  const excluirDoFeed = useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`/corporate-posts/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (err: unknown) =>
      setErro(err instanceof ApiError ? err.message : 'Não consegui excluir o comunicado.'),
  })

  const porDia = useMemo(() => {
    const itens: ItemDaGrade[] = [
      ...(postsQuery.data?.posts ?? []).map(
        (post) => ({ origem: 'calendario', quando: post.scheduledFor, post }) as const,
      ),
      ...(feedQuery.data?.posts ?? []).map(
        (post) => ({ origem: 'feed', quando: post.publishAt, post }) as const,
      ),
    ]
    // Ordena por hora, e não por origem: o valor da grade unificada é justamente
    // ver que às 13h30 do mesmo dia já havia comunicado marcado.
    itens.sort((a, b) => new Date(a.quando).getTime() - new Date(b.quando).getTime())

    const mapa = new Map<number, ItemDaGrade[]>()
    for (const item of itens) {
      const dia = new Date(item.quando).getDate()
      mapa.set(dia, [...(mapa.get(dia) ?? []), item])
    }
    return mapa
  }, [postsQuery.data, feedQuery.data])

  const monthRef = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`
  const semanas = useMemo(() => monthWeekRows(monthRef), [monthRef])
  // `?? SEM_CAMPANHA` e não `?? []`: array novo a cada render invalida o memo
  // abaixo sempre (ver o gotcha de identidade de array no AGENTS.md).
  const campanhas = postsQuery.data?.campaigns ?? SEM_CAMPANHA
  /** Índice estável por campanha, para a faixa não trocar de cor a cada render. */
  const tomDaCampanha = useMemo(() => new Map(campanhas.map((c, i) => [c.id, i])), [campanhas])
  const nomeDoMes = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(
    new Date(cursor.year, cursor.month, 1),
  )

  function abrir(post: CampaignPostDTO) {
    setErro(null)
    setFeedPost(null)
    setDraft({
      id: post.id,
      title: post.title,
      body: post.body,
      visualHint: post.visualHint ?? '',
      image: post.image,
      scheduledFor: toLocalInput(post.scheduledFor),
      channel: post.channel,
      responsibleId: post.responsibleId ?? '',
      status: post.status,
      campaignTheme: post.campaignTheme,
    })
  }

  /** Agendado do Feed: abre em leitura, e fecha o formulário do calendário. */
  function abrirDoFeed(post: ScheduledFeedPostDTO) {
    setErro(null)
    setDraft(null)
    setFeedPost(post)
  }

  return (
    <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
        <div className="mb-lg flex items-center justify-between">
          <button
            type="button"
            onClick={() =>
              setCursor((c) => ({ year: c.month === 0 ? c.year - 1 : c.year, month: c.month === 0 ? 11 : c.month - 1 }))
            }
            aria-label="Mês anterior"
            className="rounded-md border border-outline-variant/50 p-2 text-on-surface-variant hover:border-primary hover:text-primary"
          >
            <Icon name="chevron_left" className="text-[20px]" />
          </button>
          <h2 className="font-headline text-headline-md capitalize text-on-surface">{nomeDoMes}</h2>
          <button
            type="button"
            onClick={() =>
              setCursor((c) => ({ year: c.month === 11 ? c.year + 1 : c.year, month: c.month === 11 ? 0 : c.month + 1 }))
            }
            aria-label="Próximo mês"
            className="rounded-md border border-outline-variant/50 p-2 text-on-surface-variant hover:border-primary hover:text-primary"
          >
            <Icon name="chevron_right" className="text-[20px]" />
          </button>
        </div>

        <label className="mb-md flex w-fit items-center gap-xs font-label text-label-sm text-on-surface-variant">
          <input
            type="checkbox"
            checked={showContext}
            onChange={(e) => setShowContext(e.target.checked)}
          />
          Mostrar eventos e aniversários
        </label>

        {postsQuery.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}
        {postsQuery.isError && (
          <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
            <Icon name="error" className="text-[16px]" />
            Erro ao carregar os comunicados agendados.
          </p>
        )}
        {/* Falha só na consulta do Feed: o calendário editorial continua na tela
            (é o que ela existe para mostrar), mas dizer que falta metade da
            grade é melhor do que deixar parecer que o mês está livre. */}
        {feedQuery.isError && !postsQuery.isError && (
          <p role="alert" className="flex items-center gap-sm text-body-sm text-on-surface-variant">
            <Icon name="error" className="text-[16px]" />
            Não consegui carregar os agendados do Feed. A grade mostra só os itens do calendário.
          </p>
        )}
        {showContext && contextQuery.isError && (
          <p role="alert" className="flex items-center gap-sm text-body-sm text-on-surface-variant">
            <Icon name="error" className="text-[16px]" />
            Não consegui carregar eventos e aniversários do calendário organizacional.
          </p>
        )}

        {/* Mesmo desenho do calendário de `/calendario`: cabeçalho de dias da
            semana e uma linha por semana, com os dias alinhados ao dia real.
            A grade daqui numerava 1..31 em sete colunas, então o dia 1 caía
            sempre na primeira coluna — "quinta-feira" na tela do editorial e
            na tela de todo mundo eram colunas diferentes. */}
        <div className="overflow-hidden rounded-xl border border-outline-variant/40">
          <div className="grid grid-cols-7 border-b border-outline-variant/30 bg-surface-container-highest">
            {WEEKDAY_LABELS.map((rotulo) => (
              <div
                key={rotulo}
                className="px-sm py-1 text-center font-label text-label-sm text-on-surface-variant"
              >
                {rotulo}
              </div>
            ))}
          </div>

          {semanas.map((semana) => {
            const faixas = computeSpans(
              semana.map((d) => d.iso),
              campanhas,
              (c) => ({ start: ymdLocal(c.startsAt), end: ymdLocal(c.endsAt) }),
            )
            return (
              <div key={semana[0].iso} className="border-b border-outline-variant/20 last:border-b-0">
                {/* A campanha por trás dos comunicados que nasceram dela. Fica
                    ACIMA das células e atravessa a semana inteira: é a única
                    forma de ler "a campanha dura estes dias" em vez de ler o
                    tema repetido, em letra miúda, sob cada item. */}
                {faixas.length > 0 && (
                  <div
                    className="grid grid-cols-7 gap-y-[3px] px-[2px] pt-[2px]"
                    style={{ gridAutoRows: '16px' }}
                  >
                    {faixas.map((faixa) => (
                      <div
                        key={`${faixa.item.id}-${faixa.start}`}
                        style={{ gridColumn: `${faixa.start + 1} / span ${faixa.length}`, minWidth: 0 }}
                      >
                        <CampanhaFaixa faixa={faixa} tom={tomDaCampanha.get(faixa.item.id) ?? 0} />
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-7">
                  {semana.map((doMes) => {
            const dia = doMes.inMonth ? doMes.day : -1
            return (
            <div
              key={doMes.iso}
              className={`min-h-20 border-r border-outline-variant/20 p-1 last:border-r-0 ${
                doMes.inMonth ? '' : 'bg-surface'
              }`}
            >
              <span
                className={`text-label-sm ${doMes.inMonth ? 'text-on-surface-variant' : 'text-outline'}`}
              >
                {doMes.day}
              </span>
              <ul className="mt-1 space-y-1">
                {(porDia.get(dia) ?? []).map((item) =>
                  item.origem === 'calendario' ? (
                    <li key={item.post.id}>
                      <button
                        type="button"
                        onClick={() => abrir(item.post)}
                        aria-label={`${timeFormatter.format(new Date(item.post.scheduledFor))} ${item.post.title}${item.post.campaignTheme ? ` — campanha ${item.post.campaignTheme}` : ''} — ${CAMPAIGN_POST_STATUS_LABELS[item.post.status]}`}
                        className={`w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-label ${STATUS_CLASS[item.post.status]}`}
                      >
                        {item.post.title}
                        {/* Sem isso, um mês com itens de três campanhas diferentes
                            fica indistinguível de um mês de avisos avulsos. */}
                        {item.post.campaignTheme && (
                          <span className="block truncate text-[9px] font-normal normal-case opacity-70">
                            {item.post.campaignTheme}
                          </span>
                        )}
                      </button>
                    </li>
                  ) : (
                    <li key={`feed-${item.post.id}`}>
                      <button
                        type="button"
                        onClick={() => abrirDoFeed(item.post)}
                        aria-label={`${timeFormatter.format(new Date(item.post.publishAt))} ${item.post.title ?? 'Comunicado do Feed'} — agendado no Feed por ${item.post.authorName}`}
                        className={`w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-label ${FEED_CLASS}`}
                      >
                        {item.post.title ?? 'Comunicado do Feed'}
                        <span className="block truncate text-[9px] font-normal normal-case opacity-70">
                          Feed · {item.post.authorName}
                        </span>
                      </button>
                    </li>
                  ),
                )}
              </ul>
              {/* Contexto do calendário organizacional: não se cria nem se edita
                  daqui (ver `porDia` acima) — só se abre a consulta, com o
                  mesmo Editar/Excluir do calendário normal. Serve pra não
                  marcar campanha em cima de um feriado ou data comemorativa já
                  cadastrada, e agora também pra corrigir um cadastro errado
                  sem trocar de tela. */}
              {showContext && contextByDia.get(dia) && (
                <ul className="mt-1 space-y-0.5 border-t border-outline-variant/20 pt-1">
                  {contextByDia.get(dia)!.occurrences.map((o) => (
                    <li key={o.eventId}>
                      <button
                        type="button"
                        onClick={() => {
                          setEventoErro(null)
                          setSelectedEvent(o)
                        }}
                        className="w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-label"
                        style={{ backgroundColor: `${o.color}26`, color: o.color }}
                      >
                        {o.title}
                      </button>
                    </li>
                  ))}
                  {contextByDia.get(dia)!.birthdays.map((b) => (
                    <li key={`b-${b.user.id}`} className="truncate text-[10px] text-on-surface-variant">
                      🎂 {b.user.name}
                    </li>
                  ))}
                  {contextByDia.get(dia)!.workAnniversaries.map((w) => (
                    <li key={`w-${w.user.id}`} className="truncate text-[10px] text-on-surface-variant">
                      🏢 {w.user.name} · {tenureLabel(w.years)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <aside className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
        {feedPost ? (
          /* Leitura, e só. Reagendar e editar não existem nem para o autor de um
             agendado do Feed — o botão de "Meus envios" só aparece em pendente —,
             então oferecê-los aqui seria inventar regra num lugar que não é dono
             dela. Excluir sai pela rota do mural, com a permissão de lá. */
          <div className="flex flex-col gap-md">
            <div className="flex flex-col gap-1">
              <span className={`w-fit rounded-full px-sm font-label text-label-sm ${FEED_CLASS}`}>
                Agendado no Feed
              </span>
              <p className="font-headline text-title-sm font-bold text-on-surface">
                {feedPost.title ?? 'Comunicado do Feed'}
              </p>
              <p className="text-label-sm text-on-surface-variant">
                por {feedPost.authorName} · sai em{' '}
                {new Date(feedPost.publishAt).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>

            {/* O banner de erro do formulário mora dentro dele; aqui precisa do
                seu, senão uma exclusão recusada (403, post já apagado) falharia
                em silêncio. */}
            {erro && (
              <p role="alert" className="rounded-md border border-error/40 bg-error-container/20 p-sm text-body-sm text-on-error-container">
                {erro}
              </p>
            )}

            <p className="whitespace-pre-wrap text-body-sm text-on-surface">{feedPost.content}</p>

            <p className="text-label-sm text-on-surface-variant">
              Este comunicado foi agendado direto no Feed Corporativo. Para mudar o texto ou a data,
              quem o escreveu precisa excluir e publicar de novo — o calendário só mostra.
            </p>

            <div className="flex flex-wrap gap-sm">
              <button
                type="button"
                disabled={excluirDoFeed.isPending}
                onClick={() => excluirDoFeed.mutate(feedPost.id)}
                className="rounded-md border border-error/60 px-md py-sm font-label text-label-sm text-error disabled:opacity-50"
              >
                Excluir comunicado
              </button>
            </div>
            <button
              type="button"
              onClick={() => setFeedPost(null)}
              className="w-fit font-label text-label-sm text-on-surface-variant hover:text-on-surface"
            >
              Fechar
            </button>
          </div>
        ) : draft === null ? (
          <button
            type="button"
            onClick={() => setDraft(emptyDraft())}
            className="w-full rounded-md bg-primary px-md py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
          >
            Novo item
          </button>
        ) : (
          <form
            className="flex flex-col gap-md"
            onSubmit={(e) => {
              e.preventDefault()
              salvar.mutate(draft)
            }}
          >
            {erro && (
              <p role="alert" className="rounded-md border border-error/40 bg-error-container/20 p-sm text-body-sm text-on-error-container">
                {erro}
              </p>
            )}

            {draft.campaignTheme && (
              <p className="flex items-center gap-xs text-label-sm text-on-surface-variant">
                <Icon name="campaign" className="text-[16px]" />
                Campanha: {draft.campaignTheme}
              </p>
            )}

            <label className="font-label text-label-sm text-on-surface-variant" htmlFor="campaign-title">
              Título
            </label>
            <input
              id="campaign-title"
              value={draft.title}
              disabled={draft.status === 'PUBLISHED'}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className={inputCls}
            />

            <label className="font-label text-label-sm text-on-surface-variant" htmlFor="campaign-body">
              Comunicado
            </label>
            <textarea
              id="campaign-body"
              rows={14}
              value={draft.body}
              maxLength={CAMPAIGN_BODY_MAX_LENGTH}
              disabled={draft.status === 'PUBLISHED'}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              className={inputCls}
            />
            <p className="text-label-sm text-on-surface-variant">
              {draft.body.length}/{CAMPAIGN_BODY_MAX_LENGTH}
            </p>

            <label className="font-label text-label-sm text-on-surface-variant" htmlFor="campaign-visual-hint">
              Sugestão visual (opcional)
            </label>
            <input
              id="campaign-visual-hint"
              value={draft.visualHint}
              disabled={draft.status === 'PUBLISHED'}
              onChange={(e) => setDraft({ ...draft, visualHint: e.target.value })}
              className={inputCls}
            />
            <p className="text-label-sm text-on-surface-variant">
              Briefing em texto para quem faz a peça. A arte pronta vai no campo abaixo.
            </p>

            {/* Os dois campos convivem de propósito: o item nasce com o pedido
                e ganha a peça depois. Quem publica leva a arte para o Mural. */}
            <span className="font-label text-label-sm text-on-surface-variant">Arte (opcional)</span>
            {draft.image ? (
              <div className="flex flex-col items-start gap-xs">
                <img
                  src={draft.image.url}
                  alt="Arte do comunicado"
                  className="max-h-40 rounded-lg border border-outline-variant/40 object-contain"
                />
                {draft.status !== 'PUBLISHED' && (
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, image: null })}
                    className="font-label text-label-sm text-error hover:underline"
                  >
                    Remover arte
                  </button>
                )}
              </div>
            ) : draft.status === 'PUBLISHED' ? (
              <p className="text-body-sm text-on-surface-variant">Publicado sem arte.</p>
            ) : uploadsHabilitados ? (
              <ImagePicker onSelect={(image) => setDraft({ ...draft, image })} />
            ) : (
              <p className="text-body-sm text-on-surface-variant">
                Envio de imagem indisponível: este ambiente não tem armazenamento configurado.
              </p>
            )}

            <label className="font-label text-label-sm text-on-surface-variant" htmlFor="campaign-when">
              Data e hora
            </label>
            <input
              id="campaign-when"
              type="datetime-local"
              value={draft.scheduledFor}
              disabled={draft.status === 'PUBLISHED'}
              onChange={(e) => {
                // Mesmo buraco do preview em CampaignGenerator: aqui degrada bem
                // (o React Query mostraria "Não consegui salvar." no submit), mas
                // a guarda evita até isso — mantém o valor anterior se o campo
                // for limpo ou ficar num estado intermediário inválido.
                if (Number.isNaN(new Date(e.target.value).getTime())) return
                setDraft({ ...draft, scheduledFor: e.target.value })
              }}
              className={inputCls}
            />

            <label className="font-label text-label-sm text-on-surface-variant" htmlFor="campaign-channel">
              Canal
            </label>
            <select
              id="campaign-channel"
              value={draft.channel}
              disabled={draft.status === 'PUBLISHED'}
              onChange={(e) => setDraft({ ...draft, channel: e.target.value as CampaignChannel })}
              className={inputCls}
            >
              {CAMPAIGN_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CAMPAIGN_CHANNEL_LABELS[c]}
                </option>
              ))}
            </select>
            {/* O que a data significa depende do canal, e a tela precisa dizer:
                antes daqui, "agendado para 13h30" não fazia nada às 13h30 e
                ninguém tinha como saber onde o comunicado tinha ido parar. */}
            <p className="text-label-sm text-on-surface-variant">
              {CAMPAIGN_MANUAL_DELIVERY_CHANNELS.includes(draft.channel)
                ? 'Entrega manual: o Legends registra o combinado, não dispara. Use o calendário como lembrete.'
                : 'Sai sozinho no Mural na data e hora marcadas. "Publicar agora" só antecipa.'}
            </p>

            <label className="font-label text-label-sm text-on-surface-variant" htmlFor="campaign-owner">
              Responsável
            </label>
            <select
              id="campaign-owner"
              value={draft.responsibleId}
              disabled={draft.status === 'PUBLISHED'}
              onChange={(e) => setDraft({ ...draft, responsibleId: e.target.value })}
              className={inputCls}
            >
              <option value="">Sem responsável</option>
              {(colleaguesQuery.data?.users ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>

            {draft.status === 'PUBLISHED' ? (
              <p className="flex items-center gap-sm text-body-sm text-primary">
                <Icon name="check_circle" className="text-[16px]" />
                Este comunicado já foi publicado no Mural.
              </p>
            ) : (
              <div className="flex flex-wrap gap-sm">
                <button
                  type="submit"
                  disabled={salvar.isPending}
                  className="rounded-md bg-primary px-md py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
                >
                  Salvar
                </button>
                {draft.id && (
                  <>
                    {/* Comunicado cancelado é estado terminal: o backend sempre recusa a
                        publicação (409), então a ação nem aparece — reflete a regra em vez
                        de oferecer e deixar falhar. Salvar (reagendar) continua válido. */}
                    {draft.status !== 'CANCELLED' && (
                      <button
                        type="button"
                        disabled={publicar.isPending}
                        onClick={() => publicar.mutate(draft.id as string)}
                        className="rounded-md border border-outline-variant/60 px-md py-sm font-label text-label-sm text-on-surface disabled:opacity-50"
                      >
                        Publicar agora
                      </button>
                    )}
                    {/* Cancelar só aparece enquanto há o que cancelar: no item
                        já cancelado ele não faria nada visível, e ficava ao lado
                        do Excluir parecendo a mesma coisa. */}
                    {draft.status !== 'CANCELLED' && (
                      <button
                        type="button"
                        disabled={cancelar.isPending}
                        onClick={() => cancelar.mutate(draft.id as string)}
                        className="rounded-md border border-error/60 px-md py-sm font-label text-label-sm text-error disabled:opacity-50"
                      >
                        Cancelar comunicado
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={excluir.isPending}
                      onClick={() => {
                        setErro(null)
                        setConfirmarExclusao(draft.id as string)
                      }}
                      className="rounded-md border border-error/60 px-md py-sm font-label text-label-sm text-error disabled:opacity-50"
                    >
                      Excluir
                    </button>
                  </>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="w-fit font-label text-label-sm text-on-surface-variant hover:text-on-surface"
            >
              Fechar
            </button>
          </form>
        )}
      </aside>

      {/* Exclusão é irreversível e o botão fica ao lado de "Cancelar", que não
          é: sem o passo de confirmação, um clique errado apaga o item e não há
          de onde trazer de volta. Mesmo molde do diálogo de Retrospectivas. */}
      {confirmarExclusao && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-lg">
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl bg-surface-container p-lg">
            <h4 className="font-headline text-headline-sm text-on-surface">Excluir este comunicado?</h4>
            <p className="mt-2 text-body-sm text-on-surface-variant">
              A ação é irreversível: o item some do calendário. Se a intenção é registrar que a
              campanha desistiu dele, use "Cancelar comunicado" — ele fica na grade, riscado.
            </p>
            <div className="mt-lg flex justify-end gap-sm">
              <button
                type="button"
                onClick={() => setConfirmarExclusao(null)}
                className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-sm text-on-surface-variant"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={excluir.isPending}
                onClick={() => excluir.mutate(confirmarExclusao)}
                className="rounded-md bg-error px-lg py-sm font-label text-label-sm font-bold text-on-error disabled:opacity-50"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedEvent && (
        <>
          {eventoErro && (
            <p role="alert" className="fixed left-1/2 top-4 z-[60] flex -translate-x-1/2 items-center gap-sm rounded-md border border-error/40 bg-error-container px-lg py-sm text-body-sm text-on-error-container shadow-lg">
              <Icon name="error" className="text-[16px]" />
              {eventoErro}
            </p>
          )}
          <CalendarEventDetails
            event={selectedEvent}
            canEdit={podeEditarEventoSelecionado}
            deleting={deleteEventMut.isPending}
            onEdit={() => {
              setEventEditor({ eventId: selectedEvent.eventId })
              setSelectedEvent(null)
            }}
            onDelete={() => deleteEventMut.mutate(selectedEvent.eventId)}
            onClose={() => setSelectedEvent(null)}
          />
        </>
      )}

      {eventEditor && (
        <CalendarEventModal
          eventId={eventEditor.eventId}
          types={eventTypes}
          initialDate={contextRange.from}
          canMarkInternal={podeMarcarInterno}
          onClose={() => {
            setEventEditor(null)
            // `CalendarEventModal` só invalida a query de `/calendario`; sem
            // isto, salvar aqui deixaria o contexto desta tela desatualizado
            // até o próximo troca de mês.
            queryClient.invalidateQueries({ queryKey: ['campaign-calendar-context'] })
          }}
        />
      )}
    </div>
  )
}
