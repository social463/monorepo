import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { readOfficeGuestSession } from '../lib/officeGuestSession'

export function GuestThanksPage() {
  const navigate = useNavigate()
  const session = readOfficeGuestSession()
  const expiresLabel = useMemo(() => {
    if (!session) return ''
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(session.expiresAt))
  }, [session])

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-lg py-xl text-on-surface">
      <section className="w-full max-w-lg rounded-lg border border-outline-variant/40 bg-surface-container p-xl text-center shadow-xl">
        <p className="font-label text-label-md uppercase tracking-wide text-primary">Acesso convidado</p>
        <h1 className="mt-xs font-headline text-headline-md">Obrigado pela visita</h1>
        <p className="mt-sm font-body text-body-md text-on-surface-variant">
          Sua presença no escritório foi encerrada.
        </p>

        {session ? (
          <>
            <p className="mt-md font-body text-body-sm text-on-surface-variant">
              Seu convite ainda é válido até {expiresLabel}.
            </p>
            <button
              type="button"
              onClick={() => navigate('/escritorio')}
              className="mt-lg rounded-md bg-primary px-lg py-sm font-label text-label-lg font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container"
            >
              Voltar ao escritório
            </button>
          </>
        ) : (
          <p className="mt-md font-label text-label-md text-on-surface-variant">
            O acesso temporário expirou.
          </p>
        )}
      </section>
    </main>
  )
}
