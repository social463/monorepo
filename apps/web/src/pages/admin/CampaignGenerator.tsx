import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  CAMPAIGN_AUDIENCES,
  CAMPAIGN_AUDIENCE_LABELS,
  CAMPAIGN_BODY_MAX_LENGTH,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_MANUAL_DELIVERY_CHANNELS,
  CAMPAIGN_QUANTITY_MAX,
  CAMPAIGN_QUANTITY_MIN,
  type CampaignAudience,
  type CampaignChannel,
  type CampaignDraftDTO,
} from '@legends/shared'
import { ApiError } from '../../lib/api'
import { confirmCampaign, previewCampaign } from '../../lib/campaign-api'
import { Icon } from '../../components/Icon'
import { inputCls, toLocalInput } from './shared'

interface FormState {
  theme: string
  startsAt: string
  endsAt: string
  audience: CampaignAudience
  channel: CampaignChannel
  quantity: number
  notes: string
}

const inicial: FormState = {
  theme: '',
  startsAt: '',
  endsAt: '',
  audience: 'ALL',
  channel: 'MURAL',
  quantity: 3,
  notes: '',
}

/** `type="date"` devolve `YYYY-MM-DD`; a API quer ISO com fuso. */
function toIso(dia: string): string {
  return new Date(`${dia}T00:00:00`).toISOString()
}

/**
 * Aba "Gerar": pede N rascunhos à IA a partir de um tema/janela/público/canal,
 * deixa o usuário editar o preview e só então confirma. O calendário
 * (`CampaignCalendar`) não depende desta aba — por isso o 503 de "sem chave"
 * substitui só o formulário, nunca a tela inteira.
 */
export function CampaignGenerator({
  onConfirmed,
}: {
  onConfirmed: (firstScheduledFor: string | undefined, count: number) => void
}) {
  const [form, setForm] = useState<FormState>(inicial)
  const [drafts, setDrafts] = useState<CampaignDraftDTO[]>([])

  const gerar = useMutation({
    mutationFn: () =>
      previewCampaign({
        theme: form.theme,
        startsAt: toIso(form.startsAt),
        endsAt: toIso(form.endsAt),
        audience: form.audience,
        channel: form.channel,
        quantity: form.quantity,
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      }),
    onSuccess: (data) => setDrafts(data.drafts),
  })

  const confirmar = useMutation({
    // Manda os cartões COMO ESTÃO no state: é isso que faz a edição do preview
    // sobreviver até o item agendado. Nunca reenviar `gerar.data.drafts`.
    mutationFn: () =>
      confirmCampaign({
        theme: form.theme,
        startsAt: toIso(form.startsAt),
        endsAt: toIso(form.endsAt),
        audience: form.audience,
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        posts: drafts.map((d) => ({
          title: d.title,
          body: d.body,
          visualHint: d.visualHint,
          scheduledFor: d.scheduledFor,
          channel: form.channel,
        })),
      }),
    onSuccess: (data) => {
      // Leva o calendário até o mês do primeiro item agendado: sem isso, uma
      // campanha confirmada em agosto para setembro cai numa grade de agosto
      // vazia, sem nenhuma evidência de que algo foi salvo.
      const primeiraData = data.posts[0]?.scheduledFor
      setDrafts([])
      setForm(inicial)
      onConfirmed(primeiraData, data.posts.length)
    },
  })

  // Sem chave da empresa a geração é 503 — mas só a geração. O calendário
  // continua inteiro na outra aba, por isso o bloco substitui o formulário e
  // não a tela.
  const semChave = gerar.error instanceof ApiError && gerar.error.status === 503
  if (semChave) {
    return (
      <div role="alert" className="rounded-xl border border-tertiary/40 bg-tertiary-container/20 p-lg">
        <p className="flex items-center gap-sm text-body-sm text-on-tertiary-container">
          <Icon name="warning" className="text-[18px]" />
          {(gerar.error as ApiError).message}
        </p>
        <Link to="/admin/ia" className="mt-sm inline-block font-label text-label-sm text-primary hover:underline">
          Configurar a chave de IA
        </Link>
        <button
          type="button"
          onClick={() => gerar.reset()}
          className="ml-lg font-label text-label-sm text-on-surface-variant hover:text-on-surface"
        >
          Tentar de novo
        </button>
      </div>
    )
  }

  const atualizar = (index: number, campo: keyof CampaignDraftDTO, valor: string) =>
    setDrafts((atual) => atual.map((d, i) => (i === index ? { ...d, [campo]: valor } : d)))

  return (
    <div className="flex flex-col gap-lg">
      <form
        className="grid gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          gerar.mutate()
        }}
      >
        <div className="md:col-span-2">
          <label htmlFor="gen-theme" className="font-label text-label-sm text-on-surface-variant">
            Tema da campanha
          </label>
          <input
            id="gen-theme"
            required
            value={form.theme}
            onChange={(e) => setForm({ ...form, theme: e.target.value })}
            className={inputCls}
          />
        </div>

        <div>
          <label htmlFor="gen-start" className="font-label text-label-sm text-on-surface-variant">
            Data inicial
          </label>
          <input
            id="gen-start"
            type="date"
            required
            value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            className={inputCls}
          />
        </div>

        <div>
          <label htmlFor="gen-end" className="font-label text-label-sm text-on-surface-variant">
            Data final
          </label>
          <input
            id="gen-end"
            type="date"
            required
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            className={inputCls}
          />
        </div>

        <div>
          <label htmlFor="gen-audience" className="font-label text-label-sm text-on-surface-variant">
            Público
          </label>
          <select
            id="gen-audience"
            value={form.audience}
            onChange={(e) => setForm({ ...form, audience: e.target.value as CampaignAudience })}
            className={inputCls}
          >
            {CAMPAIGN_AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {CAMPAIGN_AUDIENCE_LABELS[a]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="gen-channel" className="font-label text-label-sm text-on-surface-variant">
            Canal
          </label>
          <select
            id="gen-channel"
            value={form.channel}
            onChange={(e) => setForm({ ...form, channel: e.target.value as CampaignChannel })}
            className={inputCls}
          >
            {CAMPAIGN_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CAMPAIGN_CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="gen-quantity" className="font-label text-label-sm text-on-surface-variant">
            Quantidade
          </label>
          <input
            id="gen-quantity"
            type="number"
            min={CAMPAIGN_QUANTITY_MIN}
            max={CAMPAIGN_QUANTITY_MAX}
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            className={inputCls}
          />
        </div>

        <div className="md:col-span-2">
          <label htmlFor="gen-notes" className="font-label text-label-sm text-on-surface-variant">
            Observações (opcional)
          </label>
          <textarea
            id="gen-notes"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className={inputCls}
          />
        </div>

        {gerar.error && !semChave ? (
          <p role="alert" className="flex items-center gap-sm text-body-sm text-error md:col-span-2">
            <Icon name="error" className="text-[16px]" />
            {(gerar.error as Error).message}
          </p>
        ) : null}

        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={gerar.isPending}
            className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {gerar.isPending ? 'Gerando…' : 'Gerar comunicados'}
          </button>
        </div>
      </form>

      {drafts.length > 0 ? (
        <div className="flex flex-col gap-md">
          <p className="rounded-md border border-tertiary/40 bg-tertiary-container/20 p-sm text-body-sm text-on-tertiary-container">
            Nada foi gravado ainda. Os comunicados só entram no calendário quando você confirmar.
          </p>

          {drafts.map((draft, index) => (
            <article key={index} className="flex flex-col gap-sm rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
              <div className="flex items-center justify-between gap-sm">
                <input
                  value={draft.title}
                  aria-label={`Título do comunicado ${index + 1}`}
                  onChange={(e) => atualizar(index, 'title', e.target.value)}
                  className={`${inputCls} flex-1`}
                />
                <button
                  type="button"
                  onClick={() => setDrafts(drafts.filter((_, i) => i !== index))}
                  className="font-label text-label-sm text-on-surface-variant hover:text-error"
                >
                  Descartar
                </button>
              </div>

              <textarea
                rows={4}
                value={draft.body}
                maxLength={CAMPAIGN_BODY_MAX_LENGTH}
                aria-label={`Comunicado ${index + 1}`}
                onChange={(e) => atualizar(index, 'body', e.target.value)}
                className={inputCls}
              />
              <p className="text-label-sm text-on-surface-variant">
                {draft.body.length}/{CAMPAIGN_BODY_MAX_LENGTH}
              </p>

              <input
                value={draft.visualHint ?? ''}
                aria-label={`Sugestão visual do comunicado ${index + 1}`}
                onChange={(e) => atualizar(index, 'visualHint', e.target.value)}
                className={inputCls}
              />

              <input
                type="datetime-local"
                aria-label={`Data do comunicado ${index + 1}`}
                value={toLocalInput(draft.scheduledFor)}
                onChange={(e) => {
                  // Limpar o campo (selecionar tudo + Backspace) dispara `change`
                  // com value === ''. `new Date('').toISOString()` lança
                  // RangeError DENTRO do handler, antes de `atualizar` rodar — o
                  // React propaga pro error boundary e o usuário perde todos os
                  // rascunhos não confirmados desta tela (o preview não grava,
                  // não há cópia no servidor). Mantém o valor anterior em vez de
                  // travar a tela.
                  const data = new Date(e.target.value)
                  if (Number.isNaN(data.getTime())) return
                  atualizar(index, 'scheduledFor', data.toISOString())
                }}
                className={`${inputCls} w-fit`}
              />
            </article>
          ))}

          {form.audience === 'LEADERSHIP' ? (
            <p className="flex items-center gap-sm rounded-md border border-tertiary/40 bg-tertiary-container/20 p-sm text-body-sm text-on-tertiary-container">
              <Icon name="warning" className="text-[16px]" />
              A campanha publica para toda a empresa: o recorte por setor existe no composer do Feed Corporativo, não aqui.
            </p>
          ) : null}

          {CAMPAIGN_MANUAL_DELIVERY_CHANNELS.includes(form.channel) ? (
            <p className="flex items-center gap-sm rounded-md border border-tertiary/40 bg-tertiary-container/20 p-sm text-body-sm text-on-tertiary-container">
              <Icon name="warning" className="text-[16px]" />
              A entrega por {CAMPAIGN_CHANNEL_LABELS[form.channel]} ainda é manual — o Legends registra o
              agendamento, mas não envia.
            </p>
          ) : null}

          {confirmar.error ? (
            <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
              <Icon name="error" className="text-[16px]" />
              {(confirmar.error as Error).message}
            </p>
          ) : null}

          <button
            type="button"
            disabled={confirmar.isPending}
            onClick={() => confirmar.mutate()}
            className="w-fit rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {confirmar.isPending ? 'Agendando…' : 'Confirmar e agendar'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
