import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { VoteDTO } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Panel } from './shared'
import { CorporateMuralReachTab } from './CorporateMuralReachTab'
import { CorporateFeedApprovalTab } from './CorporateFeedApprovalTab'

type Tab = 'votos' | 'mural' | 'aprovacao'

const TABS: { id: Tab; label: string }[] = [
  { id: 'votos', label: 'Votos' },
  { id: 'mural', label: 'Alcance do feed' },
  { id: 'aprovacao', label: 'Aprovação do feed' },
]

function VotesTab() {
  const queryClient = useQueryClient()
  const votesQuery = useQuery({
    queryKey: ['admin', 'votes'],
    queryFn: () => apiFetch<{ votes: VoteDTO[] }>('/admin/votes'),
  })
  const removeVote = useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`/admin/votes/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'votes'] }),
  })

  return (
    <>
      {votesQuery.data && votesQuery.data.votes.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhum voto registrado.</p>
      )}
      <ul className="flex flex-col gap-2">
        {votesQuery.data?.votes.map((vote) => (
          <li key={vote.id} className="flex items-start justify-between gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
            <div className="min-w-0">
              <p className="font-label text-label-md text-on-surface">
                {vote.voter.name} → {vote.voted.name}
                <span className="ml-2 font-body text-body-sm text-on-surface-variant">· {vote.categories.map((c) => c.name).join(", ")}</span>
              </p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{vote.justification}</p>
            </div>
            <button
              onClick={() => removeVote.mutate(vote.id)}
              className="shrink-0 rounded-md border border-error/40 px-3 py-1 font-label text-label-sm text-error transition-colors hover:border-error"
            >
              Remover
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

export function ModerationSection() {
  const [tab, setTab] = useState<Tab>('votos')

  return (
    <Panel title="Moderação">
      <div role="tablist" aria-label="Moderação" className="mb-lg flex gap-xs border-b border-outline-variant/40">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-md py-sm font-label text-label-md transition-colors ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'votos' ? <VotesTab /> : tab === 'mural' ? <CorporateMuralReachTab /> : <CorporateFeedApprovalTab />}
    </Panel>
  )
}
