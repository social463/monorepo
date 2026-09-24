import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  ALLOWED_MEDIA_DOCUMENT_CONTENT_TYPES,
  ALLOWED_VIDEO_CONTENT_TYPES,
  CORPORATE_POST_AI_PROMPT_MAX_LENGTH,
  audienceHasSectors,
  CORPORATE_POST_AUDIENCES,
  CORPORATE_POST_AUDIENCE_LABELS,
  CORPORATE_POST_BODY_MAX_LENGTH,
  CORPORATE_POST_TITLE_MAX_LENGTH,
  MAX_CORPORATE_POST_ATTACHMENTS,
  isEmptyRichDoc,
  plainTextToRichDoc,
  richDocToPlainText,
  type AttachedGif,
  type CorporatePostAttachmentInput,
  type CorporatePostAudience,
  type CreateCorporatePostRequest,
  type RichDoc,
  type SectorOptionDTO,
  CORPORATE_POST_POLL_QUESTION_MAX_LENGTH,
  CORPORATE_POST_POLL_OPTION_MAX_LENGTH,
  CORPORATE_POST_POLL_MIN_OPTIONS,
  CORPORATE_POST_POLL_MAX_OPTIONS,
} from '@legends/shared'
import { Avatar } from '../../components/Avatar'
import { GifPicker } from '../../components/GifPicker'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { RichTextEditor } from '../../components/rich-text/RichTextEditor'
import { useAuth } from '../../auth/AuthContext'
import { apiFetch } from '../../lib/api'
import { useGifsEnabled } from '../../lib/use-gifs'
import { useImageUploadsEnabled } from '../../lib/use-image-upload'
import { useCorporatePostTags, useGenerateCorporatePost } from '../../lib/use-corporate-mural'
import { UploadError, uploadFeedMedia } from '../../lib/upload'

const EMPTY_DOC: RichDoc = { blocks: [{ type: 'paragraph', spans: [] }] }

/** Ícone de cada espécie de anexo na lista do composer. */
const KIND_ICON: Record<CorporatePostAttachmentInput['kind'], string> = {
  IMAGE: 'image',
  VIDEO: 'movie',
  DOCUMENT: 'description',
}

/** Botão de anexo por espécie (Foto, Vídeo, Documento). */
function AttachButton({
  icon,
  label,
  accept,
  uploading,
  onFiles,
}: {
  icon: string
  label: string
  accept: string
  uploading: boolean
  onFiles: (files: FileList | null) => void | Promise<void>
}) {
  return (
    <label className="flex cursor-pointer items-center gap-xs rounded-full border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary">
      <Icon name={icon} className="text-[18px]" />
      {uploading ? 'Enviando…' : label}
      <input
        type="file"
        multiple
        accept={accept}
        className="sr-only"
        aria-label={`Anexar ${label.toLowerCase()}`}
        onChange={(e) => {
          void onFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </label>
  )
}

/**
 * Composer do Feed Corporativo. **Todo colaborador escreve** — o que muda por
 * papel é o destino: quem não publica direto vê o aviso de que o comunicado vai
 * para aprovação (é o `canPublishDirectly` que o feed devolve).
 */
export function CorporatePostComposer({
  onSubmit,
  pending,
  canPublishDirectly,
}: {
  onSubmit: (body: CreateCorporatePostRequest) => void
  pending: boolean
  canPublishDirectly: boolean
}) {
  const { user } = useAuth()
  const gifsEnabled = useGifsEnabled()
  const uploadsEnabled = useImageUploadsEnabled()
  const generate = useGenerateCorporatePost()
  const sectors = useQuery({
    queryKey: ['sectors'],
    queryFn: () => apiFetch<{ sectors: SectorOptionDTO[] }>('/sectors'),
    staleTime: 5 * 60 * 1000,
  })

  const [title, setTitle] = useState('')
  const [doc, setDoc] = useState<RichDoc>(EMPTY_DOC)
  const [gif, setGif] = useState<AttachedGif | null>(null)
  const [attachments, setAttachments] = useState<CorporatePostAttachmentInput[]>([])
  const [audience, setAudience] = useState<CorporatePostAudience>('ALL')
  const [tagId, setTagId] = useState('')
  const tags = useCorporatePostTags()
  const [sectorIds, setSectorIds] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  // Agendamento (Documento 4, seção 12). Só quem publica direto agenda: para
  // quem passa pela aprovação, marcar data seria prometer o que não controla.
  const [agendar, setAgendar] = useState(false)
  const [publishAt, setPublishAt] = useState('')
  // Enquete. Não desabilita anexo nenhum: no Feed ela CONVIVE com imagem e GIF
  // — "banner + enquete" é o formato normal de comunicação interna.
  const [pollOpen, setPollOpen] = useState(false)
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState<string[]>(['', ''])

  const plain = richDocToPlainText(doc)
  const tooLong = plain.length > CORPORATE_POST_BODY_MAX_LENGTH
  // Só o escopo por setor exige escolha: 'Toda a empresa' e 'Liderança' já
  // dizem quem alcançam.
  const audienceOk = !audienceHasSectors(audience) || sectorIds.length > 0
  const pollTrimmed = pollOptions.map((opt) => opt.trim())
  const pollDistinct =
    new Set(pollTrimmed.map((opt) => opt.toLocaleLowerCase('pt-BR'))).size === pollTrimmed.length
  const pollValid =
    pollQuestion.trim().length > 0 &&
    pollQuestion.trim().length <= CORPORATE_POST_POLL_QUESTION_MAX_LENGTH &&
    pollTrimmed.length >= CORPORATE_POST_POLL_MIN_OPTIONS &&
    pollTrimmed.every((opt) => opt.length > 0) &&
    pollDistinct
  // A enquete conta como conteúdo: post que é só a pergunta é legítimo.
  const hasContent = !isEmptyRichDoc(doc) || gif !== null || attachments.length > 0 || (pollOpen && pollValid)
  const agendamentoOk = !agendar || (publishAt !== '' && new Date(publishAt).getTime() > Date.now())
  // Enquete aberta e incompleta trava o envio: publicar ignorando o que a
  // pessoa começou a escrever perderia o trabalho dela sem avisar.
  const canSubmit =
    hasContent && !tooLong && audienceOk && agendamentoOk && (!pollOpen || pollValid) && !pending && !uploading

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({
      ...(title.trim() ? { title: title.trim() } : {}),
      body: doc,
      ...(gif ? { gif } : {}),
      ...(attachments.length ? { attachments } : {}),
      audience,
      ...(tagId ? { tagId } : {}),
      ...(audienceHasSectors(audience) ? { audienceSectorIds: sectorIds } : {}),
      // `datetime-local` entrega hora local sem fuso; o servidor exige ISO com
      // offset, então quem converte é o `Date` do navegador.
      ...(agendar && publishAt ? { publishAt: new Date(publishAt).toISOString() } : {}),
      ...(pollOpen && pollValid ? { poll: { question: pollQuestion.trim(), options: pollTrimmed } } : {}),
    })
    setTitle('')
    setDoc(EMPTY_DOC)
    setGif(null)
    setAttachments([])
    setAudience('ALL')
    setTagId('')
    setSectorIds([])
    setPollOpen(false)
    setPollQuestion('')
    setPollOptions(['', ''])
    setAgendar(false)
    setPublishAt('')
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setUploadError(null)
    setUploading(true)
    try {
      const room = MAX_CORPORATE_POST_ATTACHMENTS - attachments.length
      for (const file of Array.from(files).slice(0, Math.max(room, 0))) {
        const uploaded = await uploadFeedMedia(file)
        setAttachments((prev) => [...prev, uploaded])
      }
    } catch (err) {
      setUploadError(err instanceof UploadError ? err.message : 'Falha ao enviar o arquivo.')
    } finally {
      setUploading(false)
    }
  }

  async function handleGenerate() {
    const draft = await generate.mutateAsync({
      instructions,
      ...(audienceHasSectors(audience) ? { audience, audienceSectorIds: sectorIds } : {}),
    })
    setTitle(draft.title)
    setDoc(plainTextToRichDoc(draft.body))
    setAiOpen(false)
    setInstructions('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-md">
      {user && (
        <div className="hidden h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest sm:flex">
          <Avatar user={user} />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-sm">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, CORPORATE_POST_TITLE_MAX_LENGTH))}
          placeholder="Título (opcional)"
          aria-label="Título do comunicado"
          className="w-full bg-transparent font-headline text-title-md font-bold text-on-surface outline-none placeholder:font-normal placeholder:text-on-surface-variant"
        />

        {/* O botão de IA mora na PONTA DIREITA da barra do editor, como no
            desenho da G&G — é a ação do texto, não um anexo. */}
        <RichTextEditor
          value={doc}
          onChange={setDoc}
          placeholder="Comunique algo para a empresa…"
          toolbarEnd={
            <button
              type="button"
              onClick={() => setAiOpen((v) => !v)}
              aria-expanded={aiOpen}
              // Mesmo corpo das pílulas de setor e dos anexos: a barra tem
              // controles de três tamanhos diferentes se este ficar miúdo.
              className="flex items-center gap-xs rounded-full bg-primary px-md py-1.5 font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container"
            >
              <Icon name="auto_awesome" className="text-[18px]" /> Gerar com IA
            </button>
          }
        />

        {gif && (
          <div className="relative w-fit">
            <img src={gif.url} alt="GIF" className="max-h-48 rounded-lg border border-outline-variant/40" />
            <button
              type="button"
              onClick={() => setGif(null)}
              aria-label="Remover GIF"
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-surface/90 text-on-surface hover:bg-surface"
            >
              <Icon name="close" className="text-[16px]" />
            </button>
          </div>
        )}

        {attachments.length > 0 && (
          <ul className="flex flex-col gap-xs">
            {attachments.map((att) => (
              <li
                key={att.url}
                className="flex items-center gap-sm rounded-lg border border-outline-variant/40 px-sm py-1"
              >
                <Icon name={KIND_ICON[att.kind]} className="text-[18px] text-on-surface-variant" />
                <span className="min-w-0 flex-1 truncate text-body-sm text-on-surface">{att.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((a) => a.url !== att.url))}
                  aria-label={`Remover ${att.name}`}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant hover:bg-error/10 hover:text-error"
                >
                  <Icon name="close" className="text-[16px]" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Faixa "Direcionar para o Setor": rótulo à esquerda e o destino à
            direita, como no desenho da G&G. O recorte por setor é a decisão
            mais consequente do composer — ela merece linha própria, e não um
            controle solto no meio dos anexos. */}
        {/* Tipo de comunicação (seção 13). Fica ao lado do direcionamento por
            setor porque as duas respondem "para quem e sobre o quê" — e é a tag
            que alimenta o filtro do Feed e o painel de Comunicação Interna. */}
        {(tags.data?.tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-sm rounded-lg border border-outline-variant/40 bg-surface-container px-md py-sm">
            <span className="flex items-center gap-xs font-label text-label-md text-on-surface">
              <Icon name="sell" className="text-[18px] text-primary" />
              Tipo de comunicação
            </span>
            <Select
              options={[
                { value: '', label: 'Sem categoria' },
                ...(tags.data?.tags ?? []).map((tag) => ({ value: tag.id, label: tag.name })),
              ]}
              value={tagId}
              onChange={setTagId}
              ariaLabel="Tipo de comunicação"
              searchable={false}
              className="ml-auto w-56"
            />
          </div>
        )}

        {canPublishDirectly && (
          <div className="flex flex-wrap items-center gap-sm rounded-lg border border-outline-variant/40 bg-surface-container px-md py-sm">
            <label className="flex cursor-pointer items-center gap-xs font-label text-label-md text-on-surface">
              <input
                type="checkbox"
                checked={agendar}
                onChange={(event) => setAgendar(event.target.checked)}
              />
              <Icon name="schedule" className="text-[18px] text-primary" />
              Agendar publicação
            </label>
            {agendar && (
              <input
                type="datetime-local"
                value={publishAt}
                onChange={(event) => setPublishAt(event.target.value)}
                aria-label="Data e hora da publicação"
                className="ml-auto rounded-md border border-outline-variant/60 bg-surface px-sm py-1 font-body text-body-sm text-on-surface"
              />
            )}
            {agendar && !agendamentoOk && (
              <p className="w-full text-body-sm text-error">
                Escolha uma data e hora no futuro para agendar o comunicado.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-sm rounded-lg border border-outline-variant/40 bg-surface-container px-md py-sm">
          <span className="flex items-center gap-xs font-label text-label-md text-on-surface">
            <Icon name="my_location" className="text-[18px] text-primary" />
            Direcionar para
          </span>
          <Select
            options={CORPORATE_POST_AUDIENCES.map((value) => ({
              value,
              label: CORPORATE_POST_AUDIENCE_LABELS[value],
            }))}
            value={audience}
            onChange={(value) => setAudience(value as CorporatePostAudience)}
            ariaLabel="Destino do comunicado"
            searchable={false}
            className="ml-auto w-56"
          />
          {audienceHasSectors(audience) && (
            <div className="flex w-full flex-wrap gap-xs">
              {(sectors.data?.sectors ?? []).map((sector) => {
                const checked = sectorIds.includes(sector.id)
                return (
                  <label
                    key={sector.id}
                    className={`cursor-pointer rounded-full border px-sm py-1 font-label text-label-sm transition-colors ${
                      checked
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-outline-variant/60 text-on-surface-variant'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() =>
                        setSectorIds((prev) =>
                          prev.includes(sector.id) ? prev.filter((id) => id !== sector.id) : [...prev, sector.id],
                        )
                      }
                    />
                    {sector.name}
                  </label>
                )
              })}
            </div>
          )}
        </div>

        {uploadError && (
          <span role="alert" className="text-label-sm text-error">
            {uploadError}
          </span>
        )}

        {pollOpen && (
          <div className="flex flex-col gap-sm rounded-xl border border-outline-variant/50 bg-surface-container p-md">
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Pergunta da enquete</span>
              <input
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                maxLength={CORPORATE_POST_POLL_QUESTION_MAX_LENGTH}
                placeholder="Qual proposta de logo você prefere?"
                className="rounded-lg border border-outline-variant/60 bg-surface px-md py-2 text-body-md text-on-surface"
              />
            </label>

            {pollOptions.map((option, i) => (
              <div key={i} className="flex items-center gap-sm">
                <label className="flex-1">
                  <span className="sr-only">{`Opção ${i + 1}`}</span>
                  <input
                    value={option}
                    onChange={(e) =>
                      setPollOptions((atuais) => atuais.map((o, idx) => (idx === i ? e.target.value : o)))
                    }
                    maxLength={CORPORATE_POST_POLL_OPTION_MAX_LENGTH}
                    placeholder={`Opção ${i + 1}`}
                    aria-label={`Opção ${i + 1}`}
                    className="w-full rounded-lg border border-outline-variant/60 bg-surface px-md py-2 text-body-md text-on-surface"
                  />
                </label>
                {pollOptions.length > CORPORATE_POST_POLL_MIN_OPTIONS && (
                  <button
                    type="button"
                    onClick={() => setPollOptions((atuais) => atuais.filter((_, idx) => idx !== i))}
                    aria-label={`Remover opção ${i + 1}`}
                    className="text-on-surface-variant transition-colors hover:text-error"
                  >
                    <Icon name="close" className="text-[18px]" />
                  </button>
                )}
              </div>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-sm">
              {pollOptions.length < CORPORATE_POST_POLL_MAX_OPTIONS ? (
                <button
                  type="button"
                  onClick={() => setPollOptions((atuais) => [...atuais, ''])}
                  className="font-label text-label-sm font-bold text-primary hover:underline"
                >
                  + Adicionar opção
                </button>
              ) : (
                <span />
              )}
              {!pollDistinct && (
                <span role="alert" className="text-label-sm text-error">
                  Use opções diferentes.
                </span>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-sm border-t border-outline-variant/30 pt-sm">
          <div className="flex flex-wrap items-center gap-sm">
            {uploadsEnabled && (
              <>
                {/* Um botão por espécie, como no desenho: o `accept` de cada um
                    é a allowlist do servidor (`@legends/shared/media`), então o
                    seletor de arquivo já não oferece o que seria recusado. */}
                <AttachButton
                  icon="image"
                  label="Foto"
                  accept={ALLOWED_IMAGE_CONTENT_TYPES.join(',')}
                  uploading={uploading}
                  onFiles={handleFiles}
                />
                <AttachButton
                  icon="movie"
                  label="Vídeo"
                  accept={ALLOWED_VIDEO_CONTENT_TYPES.join(',')}
                  uploading={uploading}
                  onFiles={handleFiles}
                />
                <AttachButton
                  icon="description"
                  label="Documento"
                  accept={ALLOWED_MEDIA_DOCUMENT_CONTENT_TYPES.join(',')}
                  uploading={uploading}
                  onFiles={handleFiles}
                />
              </>
            )}
            {/* Enquete entra na mesma fila e NÃO desabilita os outros: no Feed
                ela convive com anexo, ao contrário da Resenha. */}
            <button
              type="button"
              onClick={() => setPollOpen((aberta) => !aberta)}
              aria-pressed={pollOpen}
              className={`flex items-center gap-xs rounded-full border px-md py-1 font-label text-label-sm transition-colors ${
                pollOpen
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-outline-variant/60 text-on-surface-variant hover:border-primary hover:text-primary'
              }`}
            >
              <Icon name="bar_chart" className="text-[18px]" /> Enquete
            </button>
            {/* GIF fecha a fila, como no desenho: é o único que não é upload. */}
            {gifsEnabled && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  aria-label="Adicionar GIF"
                  className="flex items-center gap-xs rounded-full border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                >
                  <Icon name="gif_box" className="text-[18px]" /> GIF
                </button>
                {pickerOpen && (
                  <GifPicker
                    onSelect={(g) => {
                      setGif({ url: g.url, width: g.width, height: g.height })
                      setPickerOpen(false)
                    }}
                    onClose={() => setPickerOpen(false)}
                  />
                )}
              </div>
            )}
            <span className={`font-label text-label-sm ${tooLong ? 'text-error' : 'text-on-surface-variant'}`}>
              {plain.length}/{CORPORATE_POST_BODY_MAX_LENGTH}
            </span>
          </div>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-full bg-primary px-xl py-2 font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {canPublishDirectly ? 'Publicar' : 'Enviar para aprovação'}
          </button>
        </div>

        {!canPublishDirectly && (
          <p className="text-label-sm text-on-surface-variant">
            Seu comunicado passa por aprovação de Gente e Gestão antes de aparecer no feed.
          </p>
        )}

        {aiOpen && (
          <div className="flex flex-col gap-sm rounded-lg border border-outline-variant/60 p-md">
            <label htmlFor="composer-ai" className="font-label text-label-md text-on-surface">
              O que você quer comunicar?
            </label>
            <textarea
              id="composer-ai"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value.slice(0, CORPORATE_POST_AI_PROMPT_MAX_LENGTH))}
              rows={3}
              placeholder="Ex.: avisar que a academia parceira mudou de endereço a partir de segunda"
              className="w-full resize-none rounded-lg border border-outline-variant/60 bg-transparent px-sm py-1 text-body-md text-on-surface outline-none focus:border-primary"
            />
            {generate.isError && (
              <span role="alert" className="text-label-sm text-error">
                {(generate.error as Error).message}
              </span>
            )}
            <div className="flex items-center gap-sm">
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={instructions.trim().length === 0 || generate.isPending}
                className="rounded-full bg-primary px-lg py-1 font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
              >
                {generate.isPending ? 'Gerando…' : 'Gerar comunicado'}
              </button>
              <button
                type="button"
                onClick={() => setAiOpen(false)}
                className="font-label text-label-md text-on-surface-variant hover:text-on-surface"
              >
                Cancelar
              </button>
            </div>
            <p className="text-label-sm text-on-surface-variant">
              O texto gerado substitui o título e o corpo. Revise antes de publicar.
            </p>
          </div>
        )}
      </div>
    </form>
  )
}
