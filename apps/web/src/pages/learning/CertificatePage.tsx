import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { getPublicCertificate } from '../../lib/learning-api'

/**
 * Verificação pública do certificado. Fora do `ProtectedRoute` de propósito: é o
 * link que a pessoa compartilha no LinkedIn e precisa abrir sem login.
 */
export function CertificatePage() {
  const { code = '' } = useParams<{ code: string }>()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['certificate', code],
    queryFn: () => getPublicCertificate(code),
    enabled: Boolean(code),
    retry: false,
  })

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-lg">
      <div className="w-full max-w-2xl rounded-2xl border border-outline-variant/30 bg-surface-container p-xl text-center">
        {isLoading && <p className="text-body-md text-on-surface-variant">Verificando certificado…</p>}

        {isError && (
          <>
            <Icon name="gpp_bad" className="text-[48px] text-error" />
            <h1 className="mt-md font-headline text-headline-md text-on-surface">Certificado não encontrado</h1>
            <p className="mt-sm text-body-md text-on-surface-variant">
              Confira o código <strong>{code}</strong> e tente de novo.
            </p>
          </>
        )}

        {data && (
          <>
            <Icon name="verified" filled className="text-[48px] text-primary" />
            <p className="mt-md font-label text-label-md uppercase tracking-wide text-primary">Certificado verificado</p>
            <h1 className="mt-sm font-headline text-headline-lg text-on-surface">{data.certificate.userName}</h1>
            <p className="mt-sm text-body-md text-on-surface-variant">concluiu o curso</p>
            <p className="mt-xs font-headline text-headline-sm text-on-surface">{data.certificate.title}</p>
            <p className="mt-md text-body-md text-on-surface-variant">
              {data.certificate.hours} hora{data.certificate.hours === 1 ? '' : 's'} ·{' '}
              {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date(data.certificate.issuedAt))}
            </p>
            <p className="mt-xs text-body-sm text-on-surface-variant">
              Emitido por {data.certificate.companyName} · Código {data.certificate.code}
            </p>
            {data.certificate.imageUrl && (
              <img
                src={data.certificate.imageUrl}
                alt={`Certificado de ${data.certificate.userName}`}
                className="mt-lg w-full rounded-xl border border-outline-variant/30"
              />
            )}
          </>
        )}
      </div>
    </main>
  )
}
