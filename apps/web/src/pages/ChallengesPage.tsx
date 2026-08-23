import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CHALLENGE_NOTE_MAX_LENGTH, COIN_CURRENCY_LABEL, type MyChallengeDTO } from '@legends/shared'
import { apiFetch } from '../lib/api'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { Skeleton } from '../components/Skeleton'
import { useImageUploadsEnabled } from '../lib/use-image-upload'
import { UploadError, uploadChallengeEvidence } from '../lib/upload'

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Em análise',
  APPROVED: 'Aprovada',
  REJECTED: 'Não aprovada',
}

// Sem token "warning" dedicado no tema: usa os três tons semânticos
// disponíveis (secondary/primary/error) — igual à convenção de badge de
// status em AdminDashboardPage.tsx (STATE_BADGE_CLASSES).
const STATUS_CLASS: Record<string, string> = {
  PENDING: 'bg-secondary/15 text-secondary',
  APPROVED: 'bg-primary/15 text-primary',
  REJECTED: 'bg-error/15 text-error',
}

/**
 * Espelha `isChallengeOpen` de `challenge-service.ts` (não importável aqui: é
 * código de servidor). Sem isso o botão "Participar" ficava disponível fora da
 * janela do desafio e o clique sempre voltava 409.
 */
function isChallengeOpen(item: Pick<MyChallengeDTO, 'isActive' | 'startsAt' | 'endsAt'>, now: Date = new Date()): boolean {
  if (!item.isActive) return false
  if (item.startsAt && now < new Date(item.startsAt)) return false
  if (item.endsAt && now > new Date(item.endsAt)) return false
  return true
}

function ChallengesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Carregando desafios…</span>
      <div className="grid items-start gap-md lg:grid-cols-2">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-md rounded-xl border border-outline-variant/30 bg-surface-container p-lg"
          >
            <div className="flex items-start justify-between gap-md">
              <div className="flex-1 space-y-sm">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-4 w-24 rounded-full" />
              </div>
              <Skeleton className="h-7 w-28 rounded-full" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-9 w-32 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}

function ChallengeCard({ item }: { item: MyChallengeDTO }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [evidenceKey, setEvidenceKey] = useState<string | null>(null)
  const [evidenceFileName, setEvidenceFileName] = useState<string | null>(null)
  const [uploadingEvidence, setUploadingEvidence] = useState(false)
  // Mesma flag pública que outras telas usam (ex. composer do mural): reflete
  // se o backend tem S3 configurado. Sem isso, some o campo inteiro — não dá
  // pra oferecer "anexar evidência" que sempre falharia com 503.
  const uploadsEnabled = useImageUploadsEnabled()

  const submit = useMutation({
    mutationFn: () =>
      apiFetch(`/challenges/${item.id}/submissions`, {
        method: 'POST',
        body: JSON.stringify({
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(evidenceKey ? { evidenceKey } : {}),
        }),
      }),
    onSuccess: () => {
      setOpen(false)
      setNote('')
      setEvidenceKey(null)
      setEvidenceFileName(null)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['my-challenges'] })
    },
    onError: (err: Error) => setError(err.message),
  })

  async function handleEvidenceFile(file: File) {
    setError(null)
    setUploadingEvidence(true)
    try {
      const uploaded = await uploadChallengeEvidence(file)
      setEvidenceKey(uploaded.key)
      setEvidenceFileName(uploaded.fileName)
    } catch (err) {
      setError(err instanceof UploadError ? err.message : 'Falha ao enviar o arquivo.')
    } finally {
      setUploadingEvidence(false)
    }
  }

  // Pendente e aprovada ocupam a vaga; rejeitada libera nova tentativa — mas só
  // dentro da janela do desafio. Fora dela (inativo ou startsAt/endsAt) o card
  // fica só leitura: sem isso o clique em "Participar" sempre voltava 409.
  const isOpenForParticipation = isChallengeOpen(item)
  const canParticipate = isOpenForParticipation && (!item.mySubmission || item.mySubmission.status === 'REJECTED')

  return (
    <article className="flex flex-col gap-md rounded-xl border border-outline-variant/30 bg-surface-container p-lg">
      {/* No mobile a recompensa desce para baixo do título: lado a lado, o chip
          espremia o título em três linhas. */}
      <header className="flex flex-col-reverse items-start gap-sm sm:flex-row sm:justify-between sm:gap-md">
        <div className="flex flex-col gap-sm">
          <div className="flex flex-wrap items-center gap-sm">
            <h2 className="font-headline text-headline-md text-on-surface">{item.title}</h2>
            {item.isFeatured && (
              <span className="rounded-full bg-tertiary px-sm py-xs font-label text-label-sm text-on-tertiary">
                Em destaque
              </span>
            )}
          </div>
          <span className="w-fit rounded-full bg-surface-container-highest px-sm py-xs font-label text-label-sm text-on-surface-variant">
            {item.category}
          </span>
          <p className="whitespace-pre-line text-body-sm text-on-surface-variant">{item.description}</p>
        </div>
        <span className="flex shrink-0 items-center gap-xs rounded-full bg-tertiary/15 px-md py-xs font-label text-label-md text-tertiary">
          <span aria-hidden>🪙</span>
          {item.rewardCoins} {COIN_CURRENCY_LABEL}
        </span>
      </header>

      {item.imageUrl && <img src={item.imageUrl} alt="" className="max-w-full rounded-lg" />}

      {item.detailsMarkdown && (
        <div className="flex flex-col gap-sm">
          <button
            type="button"
            onClick={() => setDetailOpen((value) => !value)}
            className="flex w-fit items-center gap-xs font-label text-label-md text-primary transition-colors hover:text-primary"
          >
            <Icon name={detailOpen ? 'expand_less' : 'expand_more'} className="text-[18px]" />
            {detailOpen ? 'Ocultar detalhe' : 'Ver detalhe'}
          </button>
          {detailOpen && <Markdown content={item.detailsMarkdown} />}
        </div>
      )}

      {item.mySubmission && (
        <div className="flex flex-col gap-sm rounded-lg bg-surface-container-highest p-md">
          <span
            className={`w-fit rounded-full px-sm py-xs font-label text-label-sm ${STATUS_CLASS[item.mySubmission.status]}`}
          >
            {STATUS_LABEL[item.mySubmission.status]}
          </span>
          {item.mySubmission.rejectionReason && (
            <p className="text-body-sm text-on-surface-variant">{item.mySubmission.rejectionReason}</p>
          )}
        </div>
      )}

      {!isOpenForParticipation && (
        <p className="flex items-center gap-xs font-label text-label-sm text-on-surface-variant">
          <Icon name="lock" className="text-[16px]" />
          {item.isActive ? 'Fora do período de participação.' : 'Desafio encerrado — só leitura.'}
        </p>
      )}

      {canParticipate && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-fit rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container"
        >
          Participar
        </button>
      )}

      {open && (
        <form
          className="flex flex-col gap-md"
          onSubmit={(event) => {
            event.preventDefault()
            submit.mutate()
          }}
        >
          <div className="flex flex-col gap-sm">
            <label className="font-label text-label-md text-on-surface-variant" htmlFor={`note-${item.id}`}>
              Conte como foi (opcional)
            </label>
            <textarea
              id={`note-${item.id}`}
              value={note}
              maxLength={CHALLENGE_NOTE_MAX_LENGTH}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-outline-variant/60 bg-surface-container-highest p-md text-body-sm text-on-surface outline-none focus:border-primary"
            />
          </div>

          {uploadsEnabled && (
            <div className="flex flex-col gap-sm">
              <label className="font-label text-label-md text-on-surface-variant" htmlFor={`evidence-${item.id}`}>
                Evidência (opcional, PDF)
              </label>
              <input
                id={`evidence-${item.id}`}
                type="file"
                accept="application/pdf"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleEvidenceFile(file)
                }}
                className="block w-full text-body-sm text-on-surface-variant"
              />
              {uploadingEvidence && <p className="text-label-sm text-on-surface-variant">Enviando arquivo…</p>}
              {evidenceFileName && !uploadingEvidence && (
                <p className="text-label-sm text-on-surface-variant">Arquivo: {evidenceFileName}</p>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
              <Icon name="error" className="text-[16px]" />
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-sm">
            <button
              type="submit"
              disabled={submit.isPending || uploadingEvidence}
              className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              Enviar participação
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setEvidenceKey(null)
                setEvidenceFileName(null)
                setError(null)
              }}
              className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </article>
  )
}

export function ChallengesPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['my-challenges'],
    queryFn: () => apiFetch<MyChallengeDTO[]>('/challenges'),
  })

  const challenges = data ?? []

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header>
        <div className="flex items-center gap-sm text-primary">
          <Icon name="sports_score" className="text-[20px]" />
          <span className="font-label text-label-md uppercase tracking-[0.18em]">Missões e recompensas</span>
        </div>
        <h1 className="mt-2 font-headline text-headline-xl text-on-surface">Desafios</h1>
        <p className="mt-2 max-w-xl text-body-md text-on-surface-variant">
          Participe dos desafios, conquiste {COIN_CURRENCY_LABEL}, pontos e se desenvolva!
        </p>
      </header>

      {isLoading && <ChallengesSkeleton />}

      {isError && (
        <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          Erro ao carregar os desafios.
        </p>
      )}

      {!isLoading && !isError && challenges.length === 0 && (
        <p className="rounded-xl border border-dashed border-outline-variant/50 bg-surface-container-low px-lg py-lg text-body-sm text-on-surface-variant">
          Nenhum desafio aberto no momento. Assim que o time publicar um novo desafio, ele aparece
          aqui para você participar.
        </p>
      )}

      {challenges.length > 0 && (
        <div className="grid items-start gap-md lg:grid-cols-2">
          {challenges.map((item) => (
            <ChallengeCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}
