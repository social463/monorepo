import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isApprentice } from '@legends/shared'
import { useAuth } from '../../auth/AuthContext'
import { Skeleton } from '../../components/Skeleton'
import {
  fetchApprenticeContract,
  signApprenticeContract,
  updateApprenticeContract,
} from '../../lib/apprentice-api'
import { useApprenticeFacilitator } from './use-apprentice-facilitator'

export function ContractPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isFacilitator = useApprenticeFacilitator()

  const { data, isPending } = useQuery({
    queryKey: ['apprentice', 'contract'],
    queryFn: fetchApprenticeContract,
  })

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (data) setDraft(data.clauses.join('\n'))
  }, [data])

  const save = useMutation({
    mutationFn: () =>
      updateApprenticeContract(
        draft
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      ),
    onSuccess: () => {
      setEditing(false)
      void queryClient.invalidateQueries({ queryKey: ['apprentice', 'contract'] })
    },
  })

  const sign = useMutation({
    mutationFn: signApprenticeContract,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['apprentice'] }),
  })

  if (isPending) return <Skeleton className="h-96 w-full rounded-xl" />
  if (!data) return null

  return (
    <div className="flex flex-col gap-xl">
      <header>
        <h2 className="font-headline text-headline-md text-on-surface">Contrato da Trilha</h2>
        <p className="font-body text-body-sm text-on-surface-variant">
          Acordado no primeiro encontro e válido para todo o ciclo.
        </p>
      </header>

      <section className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
        {editing ? (
          <div className="flex flex-col gap-sm">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={10}
              className="w-full rounded-lg border border-outline-variant bg-surface p-md font-body text-body-md text-on-surface"
            />
            <p className="font-body text-body-sm text-on-surface-variant">Uma regra por linha.</p>
            <div className="flex gap-sm">
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate()}
                className="rounded-full bg-primary px-lg py-sm font-label text-label-lg text-on-primary disabled:bg-surface-container-highest disabled:text-on-surface-variant"
              >
                Salvar
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(data.clauses.join('\n'))
                  setEditing(false)
                }}
                className="rounded-full border border-outline-variant px-lg py-sm font-label text-label-lg text-on-surface"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <>
            {data.clauses.length === 0 ? (
              <p className="font-body text-body-md text-on-surface-variant">
                O contrato da trilha ainda não foi publicado.
              </p>
            ) : (
              <ol className="flex flex-col gap-md">
                {data.clauses.map((clause, index) => (
                  <li key={clause} className="flex items-start gap-sm">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary font-label text-label-md text-on-primary">
                      {index + 1}
                    </span>
                    <span className="font-body text-body-md text-on-surface">{clause}</span>
                  </li>
                ))}
              </ol>
            )}
            {isFacilitator && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="mt-lg rounded-full border border-outline-variant px-lg py-sm font-label text-label-lg text-on-surface"
              >
                Editar contrato
              </button>
            )}
          </>
        )}
      </section>

      {isApprentice(user) && !data.signedByViewer && data.clauses.length > 0 && (
        <section className="rounded-xl border border-primary/40 bg-surface-container p-lg">
          <p className="font-body text-body-md text-on-surface">
            Você ainda não assinou o Contrato da Trilha.
          </p>
          <button
            type="button"
            disabled={sign.isPending}
            onClick={() => sign.mutate()}
            className="mt-sm rounded-full bg-primary px-lg py-sm font-label text-label-lg text-on-primary disabled:bg-surface-container-highest disabled:text-on-surface-variant"
          >
            Assinar contrato digital
          </button>
        </section>
      )}

      <section className="flex flex-col gap-lg">
        <h3 className="font-headline text-headline-sm text-on-surface">Aprendizes assinantes</h3>
        {data.signatures.length === 0 ? (
          <p className="font-body text-body-md text-on-surface-variant">Nenhuma assinatura ainda.</p>
        ) : (
          <div className="grid gap-lg sm:grid-cols-2 lg:grid-cols-3">
            {data.signatures.map((signature) => (
              <article
                key={signature.person.id}
                className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg"
              >
                <p className="font-label text-label-lg text-on-surface">{signature.person.name}</p>
                <p className="font-body text-body-sm text-on-surface-variant">
                  {signature.person.className ?? 'Sem turma'}
                </p>
                <p className="mt-md border-t border-outline-variant/40 pt-sm font-body text-body-sm text-on-surface-variant">
                  Assinado em {new Date(signature.signedAt).toLocaleDateString('pt-BR')}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
