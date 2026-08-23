import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { AuthResponse, ThirdPartyInvitePublicDTO } from '@legends/shared'
import { ApiError } from '../lib/api'
import { setAccessToken } from '../lib/api'
import { useAuth } from '../auth/AuthContext'

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

export function ThirdPartyInvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { setUser } = useAuth()
  const [invite, setInvite] = useState<ThirdPartyInvitePublicDTO | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    publicApiFetch<ThirdPartyInvitePublicDTO>(`/third-party-invites/${encodeURIComponent(token)}`)
      .then((data) => {
        if (!alive) return
        setInvite(data)
        setError(null)
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Convite inválido.'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [token])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !email.trim() || password.length < 8) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await publicApiFetch<AuthResponse>(`/third-party-invites/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      })
      setAccessToken(res.accessToken)
      setUser(res.user)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar sua conta.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-surface px-lg py-xl text-on-surface">
      <form onSubmit={submit} className="mx-auto flex w-full max-w-md flex-col gap-lg">
        <header>
          <p className="font-label text-label-md uppercase tracking-wide text-primary">Acesso de terceirizado</p>
          <h1 className="mt-xs font-headline text-headline-lg">Crie sua conta</h1>
          {invite && (
            <p className="mt-sm font-body text-body-md text-on-surface-variant">
              Convite de {invite.createdByName}. Expira em {new Date(invite.expiresAt).toLocaleString('pt-BR')}.
            </p>
          )}
        </header>

        {error && (
          <div role="alert" className="rounded-lg border border-error/40 bg-error-container/20 px-md py-sm font-label text-label-md text-error">
            {error}
          </div>
        )}

        {loading ? (
          <p className="font-body text-body-md text-on-surface-variant">Carregando convite...</p>
        ) : (
          <>
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-md text-on-surface">Nome</span>
              <input
                aria-label="Nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-lg border border-outline-variant/50 bg-surface-container px-md py-sm font-body text-body-md text-on-surface outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-md text-on-surface">E-mail</span>
              <input
                aria-label="E-mail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg border border-outline-variant/50 bg-surface-container px-md py-sm font-body text-body-md text-on-surface outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-md text-on-surface">Senha</span>
              <input
                aria-label="Senha"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                className="rounded-lg border border-outline-variant/50 bg-surface-container px-md py-sm font-body text-body-md text-on-surface outline-none focus:border-primary"
              />
            </label>
            <button
              type="submit"
              disabled={submitting || !name.trim() || !email.trim() || password.length < 8}
              className="rounded-md bg-primary px-lg py-sm font-label text-label-lg font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              {submitting ? 'Criando conta...' : 'Criar conta'}
            </button>
          </>
        )}
      </form>
    </main>
  )
}
