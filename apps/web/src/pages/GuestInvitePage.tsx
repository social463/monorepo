import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type {
  OfficeGuestInvitePublicDTO,
  OfficeGuestSessionDTO,
  OfficeGuestCharacterPreset,
} from '@legends/shared'
import { OFFICE_GUEST_NAME_MAX_LENGTH } from '@legends/shared'
import { CharacterPreview } from '../components/CharacterPreview'
import { Icon } from '../components/Icon'
import { ApiError } from '../lib/api'
import { saveOfficeGuestSession } from '../lib/officeGuestSession'

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

async function publicApiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  if (!res.ok) {
    let message = 'Não foi possível abrir o convite.'
    try {
      const body = (await res.json()) as { message?: string }
      if (body.message) message = body.message
    } catch {
      // sem corpo JSON
    }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as T
}

export function GuestInvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [invite, setInvite] = useState<OfficeGuestInvitePublicDTO | null>(null)
  const [options, setOptions] = useState<OfficeGuestCharacterPreset[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    publicApiFetch<OfficeGuestInvitePublicDTO>(`/office/guest-invites/${encodeURIComponent(token)}`)
      .then((data) => {
        if (!alive) return
        const first = shuffle(data.presets).slice(0, 6)
        setInvite(data)
        setOptions(first)
        setSelectedId(first[0]?.id ?? null)
        setError(null)
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Convite inválido.'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [token])

  const expiresLabel = useMemo(() => {
    if (!invite) return ''
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(invite.expiresAt))
  }, [invite])

  function reshuffle() {
    if (!invite) return
    const next = shuffle(invite.presets).slice(0, 6)
    setOptions(next)
    setSelectedId(next[0]?.id ?? null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!selectedId || !name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const session = await publicApiFetch<OfficeGuestSessionDTO>('/office/guest-session', {
        method: 'POST',
        body: JSON.stringify({ token, name: name.trim(), presetId: selectedId }),
      })
      saveOfficeGuestSession(session)
      navigate('/escritorio', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar no escritório.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-surface px-lg py-xl text-on-surface">
      <form onSubmit={submit} className="mx-auto flex w-full max-w-4xl flex-col gap-lg">
        <header>
          <p className="font-label text-label-md uppercase tracking-wide text-primary">Acesso convidado</p>
          <h1 className="mt-xs font-headline text-headline-lg">Escolha seu personagem</h1>
          <p className="mt-sm max-w-2xl font-body text-body-md text-on-surface-variant">
            Seu acesso é temporário e expira em {expiresLabel || 'instantes'}. Escolha um dos personagens disponíveis e informe seu nome para entrar no escritório.
          </p>
        </header>

        {error && (
          <div role="alert" className="rounded-lg border border-error/40 bg-error-container/20 px-md py-sm font-label text-label-md text-error">
            {error}
          </div>
        )}

        <label className="flex max-w-md flex-col gap-xs">
          <span className="font-label text-label-md text-on-surface">Nome</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, OFFICE_GUEST_NAME_MAX_LENGTH))}
            maxLength={OFFICE_GUEST_NAME_MAX_LENGTH}
            placeholder="Como devemos te chamar?"
            className="rounded-lg border border-outline-variant/50 bg-surface-container px-md py-sm font-body text-body-md text-on-surface outline-none focus:border-primary"
          />
        </label>

        <section className="flex flex-col gap-md">
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <h2 className="font-headline text-title-lg">Personagens disponíveis</h2>
            <button
              type="button"
              onClick={reshuffle}
              disabled={loading || !invite}
              className="inline-flex items-center gap-sm rounded-md border border-outline-variant/50 px-md py-sm font-label text-label-md text-on-surface transition-colors hover:border-primary disabled:opacity-50"
            >
              <Icon name="shuffle" className="text-[18px]" />
              Embaralhar opções
            </button>
          </div>

          {loading ? (
            <p className="font-body text-body-md text-on-surface-variant">Carregando personagens...</p>
          ) : (
            <div className="grid grid-cols-2 gap-md md:grid-cols-3">
              {options.map((preset) => {
                const selected = preset.id === selectedId
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedId(preset.id)}
                    className={`flex aspect-square min-h-44 flex-col items-center justify-center gap-sm rounded-lg border bg-surface-container p-md transition-colors ${
                      selected ? 'border-primary ring-2 ring-primary/30' : 'border-outline-variant/40 hover:border-primary'
                    }`}
                  >
                    <CharacterPreview options={preset.options} size={144} />
                    <span className="font-label text-label-md text-on-surface">
                      {selected ? 'Selecionado' : 'Escolher'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || loading || !selectedId || !name.trim()}
            className="rounded-md bg-primary px-lg py-sm font-label text-label-lg font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {submitting ? 'Entrando...' : 'Entrar no escritório'}
          </button>
        </div>
      </form>
    </main>
  )
}
