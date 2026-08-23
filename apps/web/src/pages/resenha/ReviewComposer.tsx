import { useState, type FormEvent } from 'react'
import {
  REVIEW_MAX_LENGTH,
  REVIEW_POLL_MAX_OPTIONS,
  REVIEW_POLL_OPTION_MAX_LENGTH,
  REVIEW_POLL_QUESTION_MAX_LENGTH,
  type CreateReviewPollRequest,
} from '@legends/shared'
import type { AttachedGif } from '@legends/shared'
import type { AttachedImage } from '@legends/shared'
import { Avatar } from '../../components/Avatar'
import { MentionTextarea } from '../../components/MentionTextarea'
import { GifPicker } from '../../components/GifPicker'
import { ImagePicker } from '../../components/ImagePicker'
import { Icon } from '../../components/Icon'
import { useAuth } from '../../auth/AuthContext'
import { useColleagues } from '../../lib/use-colleagues'
import { useGifsEnabled } from '../../lib/use-gifs'
import { useImageUploadsEnabled } from '../../lib/use-image-upload'

export function ReviewComposer({
  onSubmit,
  pending,
}: {
  onSubmit: (
    content: string,
    mentionedUserIds: string[],
    gif: AttachedGif | null,
    image: AttachedImage | null,
    poll: CreateReviewPollRequest | null,
  ) => void
  pending: boolean
}) {
  const { user } = useAuth()
  const colleagues = useColleagues().data ?? []
  const gifsEnabled = useGifsEnabled()
  const imageUploadsEnabled = useImageUploadsEnabled()
  const [image, setImage] = useState<AttachedImage | null>(null)
  const [content, setContent] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const [gif, setGif] = useState<AttachedGif | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState(['', ''])
  const trimmed = content.trim()
  const tooLong = content.length > REVIEW_MAX_LENGTH
  const normalizedPollOptions = pollOptions.map((option) => option.trim())
  // Só compara o que já foi preenchido: com os campos ainda vazios eles são todos
  // iguais entre si, e avisar "use opções diferentes" antes de o usuário digitar
  // qualquer coisa é ruído.
  const filledPollOptions = normalizedPollOptions.filter((option) => option.length >= 1)
  const pollOptionsDistinct =
    new Set(filledPollOptions.map((option) => option.toLocaleLowerCase('pt-BR'))).size === filledPollOptions.length
  const pollValid =
    pollQuestion.trim().length >= 1 &&
    normalizedPollOptions.every((option) => option.length >= 1) &&
    pollOptionsDistinct
  const canSubmit =
    (trimmed.length >= 1 || gif !== null || image !== null || (pollOpen && pollValid)) &&
    (!pollOpen || pollValid) &&
    !tooLong &&
    !pending

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit(
      trimmed,
      mentionIds,
      gif,
      image,
      pollOpen ? { question: pollQuestion.trim(), options: normalizedPollOptions } : null,
    )
    setContent('')
    setMentionIds([])
    setGif(null)
    setImage(null)
    setPollOpen(false)
    setPollQuestion('')
    setPollOptions(['', ''])
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-md">
      {user && (
        <div className="hidden h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest sm:flex">
          <Avatar user={user} />
        </div>
      )}
      <div className="flex flex-1 flex-col">
        <MentionTextarea
          value={content}
          onChange={setContent}
          onMentionsChange={setMentionIds}
          colleagues={colleagues}
          placeholder="Manda a resenha pro time…"
          ariaLabel="Sua resenha"
          className="min-h-[56px] w-full resize-none bg-transparent py-1 text-body-lg text-on-surface outline-none placeholder:text-on-surface-variant"
        />
        {gif && (
          <div className="relative mt-sm w-fit">
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
        {image && (
          <div className="relative mt-sm w-fit">
            <img
              src={image.url}
              alt="Imagem anexada"
              className="max-h-48 max-w-full rounded-lg border border-outline-variant/40"
            />
            <button
              type="button"
              onClick={() => setImage(null)}
              aria-label="Remover imagem"
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-surface/90 text-on-surface hover:bg-surface"
            >
              <Icon name="close" className="text-[16px]" />
            </button>
          </div>
        )}
        {pollOpen && (
          <div className="mt-sm rounded-xl border border-outline-variant/60 bg-surface-container-high p-md">
            <div className="mb-sm flex items-center justify-between gap-sm">
              <span className="flex items-center gap-xs font-label text-label-md font-bold text-on-surface">
                <Icon name="poll" className="text-[18px] text-primary" /> Enquete
              </span>
              <button
                type="button"
                onClick={() => {
                  setPollOpen(false)
                  setPollQuestion('')
                  setPollOptions(['', ''])
                }}
                aria-label="Remover enquete"
                className="flex h-7 w-7 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
              >
                <Icon name="close" className="text-[17px]" />
              </button>
            </div>
            <label className="block">
              <span className="sr-only">Pergunta da enquete</span>
              <input
                value={pollQuestion}
                onChange={(event) => setPollQuestion(event.target.value)}
                maxLength={REVIEW_POLL_QUESTION_MAX_LENGTH}
                placeholder="Faça uma pergunta"
                className="w-full rounded-lg border border-outline-variant/60 bg-surface px-md py-2 text-body-md text-on-surface outline-none transition-colors placeholder:text-on-surface-variant focus:border-primary"
              />
            </label>
            <div className="mt-sm flex flex-col gap-xs">
              {pollOptions.map((option, index) => (
                <div key={index} className="flex items-center gap-xs">
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Opção {index + 1}</span>
                    <input
                      value={option}
                      onChange={(event) =>
                        setPollOptions((current) =>
                          current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)),
                        )
                      }
                      maxLength={REVIEW_POLL_OPTION_MAX_LENGTH}
                      placeholder={`Opção ${index + 1}`}
                      className="w-full rounded-lg border border-outline-variant/60 bg-surface px-md py-2 text-body-sm text-on-surface outline-none transition-colors placeholder:text-on-surface-variant focus:border-primary"
                    />
                  </label>
                  {pollOptions.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setPollOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      aria-label={`Remover opção ${index + 1}`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-error/10 hover:text-error"
                    >
                      <Icon name="close" className="text-[17px]" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-sm flex items-center justify-between gap-sm">
              {pollOptions.length < REVIEW_POLL_MAX_OPTIONS ? (
                <button
                  type="button"
                  onClick={() => setPollOptions((current) => [...current, ''])}
                  className="flex items-center gap-xs font-label text-label-sm font-bold text-primary hover:underline"
                >
                  <Icon name="add" className="text-[17px]" /> Adicionar opção
                </button>
              ) : (
                <span />
              )}
              {!pollOptionsDistinct && (
                <span role="alert" className="font-label text-label-sm text-error">
                  Use opções diferentes.
                </span>
              )}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-sm border-t border-outline-variant/30 pt-sm">
          <div className="flex items-center gap-sm">
            {gifsEnabled && !image && !pollOpen && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  aria-label="Adicionar GIF"
                  className="flex items-center gap-xs rounded-full border border-outline-variant/60 px-sm py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
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
            {imageUploadsEnabled && !gif && !pollOpen && (
              <ImagePicker onSelect={setImage} />
            )}
            {!gif && !image && !pollOpen && (
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false)
                  setPollOpen(true)
                }}
                aria-label="Adicionar enquete"
                className="flex items-center gap-xs rounded-full border border-outline-variant/60 px-sm py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
              >
                <Icon name="poll" className="text-[18px]" /> Enquete
              </button>
            )}
            <span className={`font-label text-label-sm ${tooLong ? 'text-error' : 'text-on-surface-variant'}`}>
              {content.length}/{REVIEW_MAX_LENGTH}
            </span>
          </div>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-full bg-primary px-xl py-2 font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            Publicar
          </button>
        </div>
      </div>
    </form>
  )
}
