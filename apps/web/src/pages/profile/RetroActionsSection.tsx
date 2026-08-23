import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { RetroActionItemDTO } from '@legends/shared'
import {
  archiveRetroAction,
  listArchivedRetroActions,
  toggleRetroAction,
  updateRetroActionNote,
} from '../../lib/retro-api'
import { Icon } from '../../components/Icon'

function formatDue(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd
}

function quandoArquivou(iso: string | null): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso))
}

/**
 * Ações de retrospectiva sob responsabilidade da pessoa do perfil.
 *
 * A lista não tem paginação e só cresce: cada sprint acrescenta ações, e as
 * concluídas ficavam empilhadas para sempre no meio das pendentes. Por isso
 * **arquivar** — que é do responsável e só vale para ação concluída (o servidor
 * recusa arquivar pendente, senão a pendência sumiria sem ser resolvida). O
 * arquivo não é exclusão: as arquivadas continuam a um clique daqui, e a
 * auditoria da liderança segue enxergando o card normalmente.
 */
export function RetroActionsSection({
  actions,
  archivedCount,
  isOwnProfile,
  profileId,
}: {
  actions: RetroActionItemDTO[]
  archivedCount: number
  isOwnProfile: boolean
  profileId: string
}) {
  const queryClient = useQueryClient()
  const [verArquivadas, setVerArquivadas] = useState(false)

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['profile', profileId] })
    queryClient.invalidateQueries({ queryKey: ['retro-actions-archived'] })
  }

  const toggleActionM = useMutation({
    mutationFn: (v: { cardId: string; done: boolean }) => toggleRetroAction(v.cardId, v.done),
    onSuccess: invalidar,
  })

  const updateNoteM = useMutation({
    mutationFn: ({ cardId, note }: { cardId: string; note: string }) => updateRetroActionNote(cardId, note),
    onSuccess: invalidar,
  })

  const archiveM = useMutation({
    mutationFn: (v: { cardId: string; archived: boolean }) => archiveRetroAction(v.cardId, v.archived),
    onSuccess: invalidar,
  })

  /**
   * Qual linha está esperando resposta. A mutation é UMA para a lista inteira,
   * então `isPending` sozinho desabilita e esmaece TODOS os botões — clicar em
   * arquivar numa ação fazia as outras reagirem como se também tivessem sido
   * clicadas. `variables` diz de quem é a requisição em voo (só vale enquanto
   * `isPending`: ela sobrevive ao fim da chamada).
   */
  const arquivando = archiveM.isPending ? archiveM.variables?.cardId : undefined
  const alternando = toggleActionM.isPending ? toggleActionM.variables?.cardId : undefined

  // Só busca quando a gaveta abre: quem nunca arquivou nada não paga request.
  const { data: arquivadasData, isLoading: carregandoArquivadas } = useQuery({
    queryKey: ['retro-actions-archived'],
    queryFn: listArchivedRetroActions,
    enabled: isOwnProfile && verArquivadas,
  })
  const arquivadas = arquivadasData?.actions ?? []

  // No perfil dos outros a seção é só a lista: arquivar é do responsável.
  if (actions.length === 0 && !isOwnProfile) return null

  return (
    <div className="mb-lg rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
      <div className="mb-lg flex flex-wrap items-center justify-between gap-sm">
        <h3 className="font-headline text-headline-md text-on-surface">Ações de Retrospectivas</h3>
        {/* O acesso ao arquivo só aparece quando existe arquivo: botão para uma
            gaveta comprovadamente vazia é ruído em todo perfil que nunca
            arquivou nada. A contagem vem do próprio payload do perfil. */}
        {isOwnProfile && (archivedCount > 0 || verArquivadas) && (
          <button
            type="button"
            aria-expanded={verArquivadas}
            onClick={() => setVerArquivadas((aberto) => !aberto)}
            className="flex items-center gap-xs rounded-lg border border-outline-variant/50 px-md py-xs font-label text-label-md text-on-surface-variant transition-colors hover:border-primary/40 hover:text-on-surface"
          >
            <Icon name={verArquivadas ? 'unarchive' : 'inventory_2'} className="text-[18px]" />
            {verArquivadas ? 'Ver ações ativas' : `Ações arquivadas (${archivedCount})`}
          </button>
        )}
      </div>

      {verArquivadas ? (
        <>
          {carregandoArquivadas && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}
          {!carregandoArquivadas && arquivadas.length === 0 && (
            <p className="rounded-lg border border-dashed border-outline-variant/50 p-lg text-center text-body-sm text-on-surface-variant">
              Nada arquivado por aqui. Ao concluir uma ação, você pode arquivá-la para tirar da lista.
            </p>
          )}
          <ul className="divide-y divide-outline-variant/30">
            {arquivadas.map((a) => (
              <li key={a.id} className="flex items-start gap-md py-md first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-body-md text-on-surface-variant line-through">{a.problem || a.plan}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-sm font-label text-label-sm text-on-surface-variant">
                    <Link to={`/retrospectivas/${a.roomId}`} className="text-primary hover:underline">
                      Sprint {a.sprint}
                    </Link>
                    {a.squad && <span>· {a.squad}</span>}
                    <span>· Arquivada em {quandoArquivou(a.archivedAt)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={arquivando === a.id}
                  onClick={() => archiveM.mutate({ cardId: a.id, archived: false })}
                  className="flex shrink-0 items-center gap-xs rounded-lg border border-outline-variant/50 px-sm py-xs font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary/40 hover:text-on-surface disabled:opacity-50"
                >
                  <Icon name="unarchive" className="text-[16px]" />
                  Desarquivar
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {actions.length === 0 && (
            <p className="rounded-lg border border-dashed border-outline-variant/50 p-lg text-center text-body-sm text-on-surface-variant">
              Nenhuma ação ativa.
            </p>
          )}
          <ul className="divide-y divide-outline-variant/30">
            {actions.map((a) => {
              const overdue = !a.done && a.dueDate < new Date().toISOString().slice(0, 10)
              return (
                <li key={a.id} className="flex items-start gap-md py-md first:pt-0 last:pb-0">
                  <input
                    type="checkbox"
                    checked={a.done}
                    disabled={!isOwnProfile || alternando === a.id}
                    onChange={() => toggleActionM.mutate({ cardId: a.id, done: !a.done })}
                    className="mt-1 h-4 w-4 shrink-0 accent-primary disabled:opacity-50"
                    aria-label={a.done ? 'Marcar como pendente' : 'Marcar como concluída'}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-body-md ${a.done ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}>
                      {a.problem || a.plan}
                    </p>
                    {a.problem && (
                      <p
                        className={`mt-0.5 text-body-sm ${a.done ? 'text-on-surface-variant line-through' : 'text-on-surface-variant'}`}
                      >
                        Ação: {a.plan}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-sm font-label text-label-sm">
                      <span className={overdue ? 'text-error' : 'text-on-surface-variant'}>
                        Prazo: {formatDue(a.dueDate)}
                        {overdue ? ' · Atrasada' : ''}
                      </span>
                      <Link to={`/retrospectivas/${a.roomId}`} className="text-primary hover:underline">
                        Sprint {a.sprint}
                      </Link>
                      {a.squad && <span className="text-on-surface-variant">· {a.squad}</span>}
                      {a.auditStatus === 'VALIDATED' && (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-primary">Validada</span>
                      )}
                      {a.auditStatus === 'REJECTED' && (
                        <span className="rounded-full bg-error/15 px-2 py-0.5 text-error">Reprovada</span>
                      )}
                    </div>
                    {isOwnProfile ? (
                      <textarea
                        defaultValue={a.note ?? ''}
                        placeholder="Adicionar observação…"
                        maxLength={500}
                        rows={2}
                        onBlur={(e) => {
                          const value = e.target.value.trim()
                          if (value !== (a.note ?? '')) {
                            updateNoteM.mutate({ cardId: a.id, note: value })
                          }
                        }}
                        className="mt-2 w-full resize-y rounded-lg border border-outline-variant/40 bg-surface p-2 text-body-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
                      />
                    ) : (
                      a.note && <p className="mt-2 text-body-sm text-on-surface-variant">Observação: {a.note}</p>
                    )}
                  </div>
                  {/* Arquivar é o que segura o tamanho da lista, e só aparece no
                      que já foi concluído: em ação pendente o botão seria um
                      atalho para esconder a pendência. */}
                  {isOwnProfile && a.done && (
                    <button
                      type="button"
                      disabled={arquivando === a.id}
                      onClick={() => archiveM.mutate({ cardId: a.id, archived: true })}
                      className="flex shrink-0 items-center gap-xs rounded-lg border border-outline-variant/50 px-sm py-xs font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary/40 hover:text-on-surface disabled:opacity-50"
                    >
                      <Icon name="inventory_2" className="text-[16px]" />
                      Arquivar
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
