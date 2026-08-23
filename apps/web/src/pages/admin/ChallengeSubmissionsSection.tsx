import { useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CHALLENGE_SUBMISSION_PAGE_SIZE,
  REJECTION_REASON_MIN_LENGTH,
  type AdminUserDTO,
  type ChallengeBatchResult,
  type ChallengeListResponse,
  type ChallengeSubmissionDTO,
  type ChallengeSubmissionPage,
  type ChallengeSubmissionStatus,
} from '@legends/shared'
import { apiFetch, apiFetchBlob } from '../../lib/api'
import { Select } from '../../components/Select'
import { Panel, inputCls } from './shared'

type Tab = 'PENDING' | 'ALL'

const STATUS_LABEL: Record<ChallengeSubmissionStatus, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
}

interface Filters {
  userId: string
  challengeId: string
}

/** Querystring da fila. A paginação é do SERVIDOR — nunca fatiar no cliente. */
function buildQuery(tab: Tab, filters: Filters, cursor?: string): string {
  const params = new URLSearchParams()
  if (tab === 'PENDING') params.set('status', 'PENDING')
  if (filters.userId) params.set('userId', filters.userId)
  if (filters.challengeId) params.set('challengeId', filters.challengeId)
  params.set('limit', String(CHALLENGE_SUBMISSION_PAGE_SIZE))
  if (cursor) params.set('cursor', cursor)
  return params.toString()
}

/** Linha da tabela: uma participação, com ações individuais quando pendente. */
function SubmissionRow({
  item,
  selected,
  onToggleSelect,
  onApprove,
  onReject,
}: {
  item: ChallengeSubmissionDTO
  selected: boolean
  onToggleSelect: () => void
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <tr className="border-b border-outline-variant/10 align-top">
      <td className="py-2">
        {item.status === 'PENDING' && (
          <input
            type="checkbox"
            aria-label={`Selecionar ${item.user.name}`}
            checked={selected}
            onChange={onToggleSelect}
          />
        )}
      </td>
      <td className="py-2">
        <div className="font-label text-label-md text-on-surface">{item.user.name}</div>
        {item.note && <p className="text-body-sm text-on-surface-variant">{item.note}</p>}
        {item.evidenceUrl && (
          <a href={item.evidenceUrl} className="text-body-sm text-primary underline" target="_blank" rel="noreferrer">
            Ver evidência
          </a>
        )}
      </td>
      <td className="py-2 text-on-surface">{item.challenge.title}</td>
      <td className="py-2 text-on-surface">{item.challenge.rewardCoins}</td>
      <td className="py-2 text-on-surface">
        {STATUS_LABEL[item.status]}
        {item.rejectionReason && <p className="text-body-sm text-on-surface-variant">{item.rejectionReason}</p>}
      </td>
      <td className="py-2 text-right">
        {item.status === 'PENDING' && (
          <>
            <button type="button" onClick={onApprove} className="mr-3 font-label text-label-sm text-primary underline">
              Aprovar
            </button>
            <button type="button" onClick={onReject} className="font-label text-label-sm text-error underline">
              Rejeitar
            </button>
          </>
        )}
      </td>
    </tr>
  )
}

/** Modal simples de rejeição: pede o motivo (mínimo obrigatório) para uma ou várias participações. */
function RejectionModal({
  count,
  reason,
  onChangeReason,
  onConfirm,
  onCancel,
}: {
  count: number
  reason: string
  onChangeReason: (value: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low p-md">
      <h2 className="font-label text-label-md font-bold text-on-surface">
        Rejeitar {count} participação(ões)
      </h2>
      <label className="mt-2 block font-label text-label-sm text-on-surface-variant" htmlFor="rejection-reason">
        Motivo
        <textarea
          id="rejection-reason"
          rows={3}
          value={reason}
          onChange={(event) => onChangeReason(event.target.value)}
          className={`${inputCls} mt-1`}
        />
      </label>
      <div className="mt-3 flex gap-sm">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md bg-error px-lg py-sm font-label text-label-md font-bold text-on-error"
        >
          Confirmar rejeição
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

/**
 * Fila de resultados dos desafios: aprovação/rejeição individual e em lote,
 * com filtros de status/desafio/pessoa e exportação para CSV. Paginação é do
 * SERVIDOR (cursor) — o portal de origem fatiava no cliente, não repetimos isso.
 */
export function ChallengeSubmissionsSection() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('PENDING')
  const [filters, setFilters] = useState<Filters>({ userId: '', challengeId: '' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rejecting, setRejecting] = useState<{ ids: string[] } | null>(null)
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [batchResult, setBatchResult] = useState<ChallengeBatchResult | null>(null)

  const challenges = useQuery({
    queryKey: ['admin-challenges'],
    queryFn: () => apiFetch<ChallengeListResponse>('/admin/challenges'),
  })

  // Lista completa da empresa (não só quem já apareceu na página carregada) —
  // senão não dá pra filtrar por alguém cuja participação ainda não veio.
  const users = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => apiFetch<{ users: AdminUserDTO[] }>('/admin/users'),
  })

  const queue = useInfiniteQuery({
    queryKey: ['admin-challenge-submissions', tab, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiFetch<ChallengeSubmissionPage>(`/admin/challenge-submissions?${buildQuery(tab, filters, pageParam)}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

  // Dedupe por id: uma página recarregada (ex. cursor repetido em mock/dev)
  // não pode gerar linhas com key duplicada na tabela.
  const items = useMemo(() => {
    const byId = new Map<string, ChallengeSubmissionDTO>()
    for (const page of queue.data?.pages ?? []) {
      for (const item of page.items) byId.set(item.id, item)
    }
    return [...byId.values()]
  }, [queue.data])

  /**
   * Troca de aba/filtro dispara um fetch novo no servidor — as linhas visíveis
   * mudam. Uma seleção feita antes disso não pode sobreviver: um "Aprovar
   * selecionadas" clicado depois agiria sobre ids que o admin não vê mais na
   * tela (e aqui isso credita coins). Um único ponto para as duas transições
   * (aba e filtro) evita que um terceiro filtro futuro esqueça de limpar.
   */
  function resetSelectionAndResult() {
    setSelected(new Set())
    setBatchResult(null)
  }

  function updateFilters(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch }))
    resetSelectionAndResult()
  }

  const refresh = () => {
    setSelected(new Set())
    // Um erro de uma decisão anterior não pode sobreviver a uma decisão seguinte
    // bem-sucedida — senão o banner fica "preso" na tela mostrando uma falha que
    // já não é mais verdade.
    setFormError(null)
    void queryClient.invalidateQueries({ queryKey: ['admin-challenge-submissions'] })
  }

  const approveOne = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/challenge-submissions/${id}/approve`, { method: 'POST' }),
    onSuccess: refresh,
    onError: (err: Error) => setFormError(err.message),
  })

  const rejectOne = useMutation({
    mutationFn: ({ id, rejectionReason }: { id: string; rejectionReason: string }) =>
      apiFetch(`/admin/challenge-submissions/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ rejectionReason }),
      }),
    onSuccess: () => {
      setRejecting(null)
      setReason('')
      refresh()
    },
    onError: (err: Error) => setFormError(err.message),
  })

  const batch = useMutation({
    mutationFn: (payload: { ids: string[]; decision: 'APPROVE' | 'REJECT'; rejectionReason?: string }) =>
      apiFetch<ChallengeBatchResult>('/admin/challenge-submissions/batch', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (result) => {
      setBatchResult(result)
      setRejecting(null)
      setReason('')
      refresh()
    },
    onError: (err: Error) => setFormError(err.message),
  })

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function confirmRejection() {
    if (reason.trim().length < REJECTION_REASON_MIN_LENGTH) {
      setFormError(`Informe o motivo da rejeição (mínimo ${REJECTION_REASON_MIN_LENGTH} caracteres).`)
      return
    }
    setFormError(null)
    const ids = rejecting?.ids ?? []
    if (ids.length === 1) rejectOne.mutate({ id: ids[0], rejectionReason: reason.trim() })
    else batch.mutate({ ids, decision: 'REJECT', rejectionReason: reason.trim() })
  }

  /**
   * O CSV NÃO pode ser um <a href> comum: o access token só vive em memória, e
   * navegar direto para a URL não mandaria o Authorization — cairia em 401.
   * `apiFetchBlob` já resolve isso (mesmo caminho do download de .ics).
   */
  async function downloadCsv() {
    try {
      const { blob, filename } = await apiFetchBlob(
        `/admin/challenge-submissions/export.csv?${buildQuery(tab, filters)}`,
      )
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename ?? 'resultados-desafios.csv'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Não foi possível exportar o CSV.')
    }
  }

  return (
    <Panel
      title="Resultados dos desafios"
      action={
        <button
          type="button"
          onClick={() => void downloadCsv()}
          className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
        >
          Exportar CSV
        </button>
      }
    >
      <div className="mb-md flex gap-sm">
        {(['PENDING', 'ALL'] as Tab[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setTab(value)
              resetSelectionAndResult()
            }}
            className={`rounded-md px-md py-1.5 font-label text-label-sm ${
              tab === value ? 'bg-primary text-on-primary' : 'bg-surface-container-highest text-on-surface-variant'
            }`}
          >
            {value === 'PENDING' ? 'Pendentes' : 'Todas'}
          </button>
        ))}
      </div>

      <div className="mb-md flex flex-wrap gap-sm">
        <Select
          value={filters.challengeId}
          onChange={(value) => updateFilters({ challengeId: value })}
          ariaLabel="Desafio"
          placeholder="Todos os desafios"
          options={[
            { value: '', label: 'Todos os desafios' },
            ...(challenges.data?.challenges ?? []).map((challenge) => ({
              value: challenge.id,
              label: challenge.title,
            })),
          ]}
          className="w-56"
        />
        <Select
          value={filters.userId}
          onChange={(value) => updateFilters({ userId: value })}
          ariaLabel="Pessoa"
          placeholder="Todas as pessoas"
          searchable
          options={[
            { value: '', label: 'Todas as pessoas' },
            ...(users.data?.users ?? []).map((user) => ({ value: user.id, label: user.name })),
          ]}
          className="w-56"
        />
      </div>

      {formError && (
        <p role="alert" className="mb-md text-body-sm text-error">
          {formError}
        </p>
      )}

      {batchResult && (
        <div className="mb-md rounded-md bg-surface-container-highest p-md text-body-sm">
          <p className="font-label text-label-sm font-bold text-on-surface">
            {batchResult.succeeded.length} aprovada(s) ou rejeitada(s), {batchResult.failed.length} com falha.
          </p>
          <ul className="mt-1 list-inside list-disc text-on-surface-variant">
            {batchResult.failed.map((failure) => (
              <li key={failure.id}>{failure.message}</li>
            ))}
          </ul>
        </div>
      )}

      {selected.size > 0 && (
        <div className="mb-md flex items-center gap-sm rounded-md bg-surface-container-highest p-md text-body-sm">
          <span className="text-on-surface-variant">{selected.size} selecionada(s)</span>
          <button
            type="button"
            onClick={() => batch.mutate({ ids: [...selected], decision: 'APPROVE' })}
            className="rounded-md bg-primary px-md py-1.5 font-label text-label-sm font-bold text-on-primary"
          >
            Aprovar selecionadas
          </button>
          <button
            type="button"
            onClick={() => setRejecting({ ids: [...selected] })}
            className="rounded-md bg-error px-md py-1.5 font-label text-label-sm font-bold text-on-error"
          >
            Rejeitar selecionadas
          </button>
        </div>
      )}

      {!queue.isLoading && items.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhuma participação encontrada.</p>
      )}

      {items.length > 0 && (
        <table className="w-full text-left text-body-sm">
          <thead className="border-b border-outline-variant/30 text-on-surface-variant">
            <tr>
              <th className="py-2" />
              <th className="py-2 font-label text-label-sm font-normal">Pessoa</th>
              <th className="py-2 font-label text-label-sm font-normal">Desafio</th>
              <th className="py-2 font-label text-label-sm font-normal">Recompensa</th>
              <th className="py-2 font-label text-label-sm font-normal">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <SubmissionRow
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                onToggleSelect={() => toggle(item.id)}
                onApprove={() => approveOne.mutate(item.id)}
                onReject={() => setRejecting({ ids: [item.id] })}
              />
            ))}
          </tbody>
        </table>
      )}

      {queue.hasNextPage && (
        <button
          type="button"
          onClick={() => void queue.fetchNextPage()}
          disabled={queue.isFetchingNextPage}
          className="mt-md rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-sm text-on-surface-variant disabled:opacity-50"
        >
          Carregar mais
        </button>
      )}

      {rejecting && (
        <div className="mt-md">
          <RejectionModal
            count={rejecting.ids.length}
            reason={reason}
            onChangeReason={setReason}
            onConfirm={confirmRejection}
            onCancel={() => {
              setRejecting(null)
              setReason('')
              setFormError(null)
            }}
          />
        </div>
      )}
    </Panel>
  )
}
