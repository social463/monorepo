import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CAMPAIGN_BODY_MAX_LENGTH,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_POST_STATUS_LABELS,
  type CampaignChannel,
  type CampaignPostDTO,
  type PublicUser,
} from '@legends/shared'
import { apiFetch, ApiError } from '../../lib/api'
import {
  cancelCampaignPost,
  createCampaignPost,
  listCampaignPosts,
  publishCampaignPost,
  updateCampaignPost,
} from '../../lib/campaign-api'
import { Icon } from '../../components/Icon'
import { inputCls, toLocalInput } from './shared'

// Cor por status do item — reaproveita os tokens de tema, sem cor nova
// (mesmo critério de EVENT_TONE em pages/calendar/CalendarGrid.tsx).
const STATUS_CLASS: Record<CampaignPostDTO['status'], string> = {
  SCHEDULED: 'bg-tertiary/20 text-tertiary',
  PUBLISHED: 'bg-primary/20 text-primary',
  CANCELLED: 'bg-surface-container-highest text-on-surface-variant line-through',
}

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

  const colleaguesQuery = useQuery({
    queryKey: ['colleagues-for-campaigns'],
    // scope=company: campanha é da empresa inteira (audience ALL), então o
    // responsável editorial pode ser de qualquer setor, não só o do admin logado.
    queryFn: () => apiFetch<{ users: PublicUser[] }>('/users?scope=company'),
  })

  const invalidate = () => {
    setErro(null)
    setDraft(null)
    return queryClient.invalidateQueries({ queryKey: ['campaign-posts'] })
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

  const porDia = useMemo(() => {
    const mapa = new Map<number, CampaignPostDTO[]>()
    for (const post of postsQuery.data?.posts ?? []) {
      const dia = new Date(post.scheduledFor).getDate()
      mapa.set(dia, [...(mapa.get(dia) ?? []), post])
    }
    return mapa
  }, [postsQuery.data])

  const diasNoMes = new Date(cursor.year, cursor.month + 1, 0).getDate()
  const nomeDoMes = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(
    new Date(cursor.year, cursor.month, 1),
  )

  function abrir(post: CampaignPostDTO) {
    setErro(null)
    setDraft({
      id: post.id,
      title: post.title,
      body: post.body,
      visualHint: post.visualHint ?? '',
      scheduledFor: toLocalInput(post.scheduledFor),
      channel: post.channel,
      responsibleId: post.responsibleId ?? '',
      status: post.status,
      campaignTheme: post.campaignTheme,
    })
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

        {postsQuery.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}
        {postsQuery.isError && (
          <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
            <Icon name="error" className="text-[16px]" />
            Erro ao carregar os comunicados agendados.
          </p>
        )}

        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: diasNoMes }, (_, i) => i + 1).map((dia) => (
            <div key={dia} className="min-h-20 rounded border border-outline-variant/30 p-1">
              <span className="text-label-sm text-on-surface-variant">{dia}</span>
              <ul className="mt-1 space-y-1">
                {(porDia.get(dia) ?? []).map((post) => (
                  <li key={post.id}>
                    <button
                      type="button"
                      onClick={() => abrir(post)}
                      aria-label={`${timeFormatter.format(new Date(post.scheduledFor))} ${post.title}${post.campaignTheme ? ` — campanha ${post.campaignTheme}` : ''} — ${CAMPAIGN_POST_STATUS_LABELS[post.status]}`}
                      className={`w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-label ${STATUS_CLASS[post.status]}`}
                    >
                      {post.title}
                      {/* Sem isso, um mês com itens de três campanhas diferentes
                          fica indistinguível de um mês de avisos avulsos. */}
                      {post.campaignTheme && (
                        <span className="block truncate text-[9px] font-normal normal-case opacity-70">
                          {post.campaignTheme}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <aside className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
        {draft === null ? (
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
              rows={5}
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
                    <button
                      type="button"
                      disabled={cancelar.isPending}
                      onClick={() => cancelar.mutate(draft.id as string)}
                      className="rounded-md border border-error/60 px-md py-sm font-label text-label-sm text-error disabled:opacity-50"
                    >
                      Cancelar comunicado
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
    </div>
  )
}
