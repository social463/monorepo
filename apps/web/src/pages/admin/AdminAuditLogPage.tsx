import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AuditLogActorsResponse, AuditLogEntryDTO, AuditLogListResponse } from '@legends/shared'
import {
  ADMIN_AUDIT_ACTION_LABELS,
  auditChangedFields,
  auditEntityLabel,
  auditFieldLabel,
  auditSubjectName,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Select } from '../../components/Select'
import { Panel, inputCls } from './shared'

// Tipos de entidade auditados hoje (ver services/*-service.ts, chamadas a
// recordAuditLog) — lista fixa porque a API não expõe um endpoint de
// "tipos existentes".
const ENTITY_TYPE_OPTIONS = [
  'AppSetting',
  'Badge',
  'Category',
  'CorporatePost',
  'CorporatePostComment',
  'OfficeDeskClaim',
  'OfficeGuestInvite',
  'OfficeMap',
  'OfficeMapAsset',
  'OfficeMapPublication',
  'OfficeRoom',
  'OfficeSetting',
  'RetroRoom',
  'Sector',
  'Squad',
  'SquadMember',
  'ThirdPartyInvite',
  'User',
  'UserBadge',
  'Vote',
  'VotingPeriod',
]

const ACTION_BADGE_CLS: Record<string, string> = {
  CREATE: 'bg-success-container text-on-success-container',
  UPDATE: 'bg-primary-container text-on-primary-container',
  DELETE: 'bg-error-container text-on-error-container',
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  const diffMs = date.getTime() - Date.now()
  const diffMinutes = Math.round(diffMs / 60000)
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute')
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour')
  const diffDays = Math.round(diffHours / 24)
  if (Math.abs(diffDays) < 30) return rtf.format(diffDays, 'day')
  const diffMonths = Math.round(diffDays / 30)
  return rtf.format(diffMonths, 'month')
}

/** Chaves que mudaram entre `before` e `after` (só faz sentido quando ambos são objetos). */
function changedKeys(before: unknown, after: unknown): Set<string> {
  const changed = new Set<string>()
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) {
    return changed
  }
  const beforeObj = before as Record<string, unknown>
  const afterObj = after as Record<string, unknown>
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])
  for (const key of keys) {
    if (JSON.stringify(beforeObj[key]) !== JSON.stringify(afterObj[key])) {
      changed.add(key)
    }
  }
  return changed
}

function DiffPanel({ label, value, changed, emptyLabel }: { label: string; value: unknown; changed: Set<string>; emptyLabel: string }) {
  if (value === null || value === undefined) {
    return (
      <div className="rounded-md bg-surface-container-highest p-sm">
        <p className="mb-xs font-label text-label-sm text-on-surface-variant">{label}</p>
        <p className="text-body-sm italic text-on-surface-variant">{emptyLabel}</p>
      </div>
    )
  }
  const obj = typeof value === 'object' ? (value as Record<string, unknown>) : null
  return (
    <div className="rounded-md bg-surface-container-highest p-sm">
      <p className="mb-xs font-label text-label-sm text-on-surface-variant">{label}</p>
      {obj ? (
        <pre className="overflow-x-auto text-body-sm">
          {'{\n'}
          {Object.entries(obj).map(([key, val], idx, arr) => (
            <span key={key} className={changed.has(key) ? 'bg-tertiary-container text-on-tertiary-container' : undefined}>
              {`  "${key}": ${JSON.stringify(val, null, 2)}${idx < arr.length - 1 ? ',' : ''}\n`}
            </span>
          ))}
          {'}'}
        </pre>
      ) : (
        <pre className="overflow-x-auto text-body-sm">{JSON.stringify(value, null, 2)}</pre>
      )}
    </div>
  )
}

function EntryRow({ entry }: { entry: AuditLogEntryDTO }) {
  const [expanded, setExpanded] = useState(false)
  const changed = useMemo(() => changedKeys(entry.before, entry.after), [entry.before, entry.after])
  const subject = useMemo(() => auditSubjectName(entry), [entry])
  // O que mudou, em uma linha: responde "o que aconteceu" sem obrigar a abrir
  // o diff e ler dois JSONs lado a lado.
  const changedFields = useMemo(() => auditChangedFields(entry.before, entry.after), [entry.before, entry.after])
  const actionCls = ACTION_BADGE_CLS[entry.action] ?? 'bg-surface-container-highest text-on-surface-variant'

  return (
    <li className="rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <div className="flex flex-wrap items-center gap-sm">
          <strong className="text-on-surface">{entry.actor.name}</strong>
          <span className={`rounded-full px-2 py-0.5 font-label text-label-sm ${actionCls}`}>{ADMIN_AUDIT_ACTION_LABELS[entry.action]}</span>
          <span className="font-label text-label-sm text-on-surface-variant">{auditEntityLabel(entry.entityType)}</span>
          {/* Nome do alvo, tirado do próprio payload — sem ele a linha só tinha
              o cuid, que não responde "quem foi editado". Falta de nome cai no
              id, que ainda é melhor do que nada. */}
          <strong className="text-on-surface">{subject ?? entry.entityId}</strong>
          <time dateTime={entry.createdAt} title={new Date(entry.createdAt).toLocaleString('pt-BR')} className="font-label text-label-sm text-on-surface-variant">
            {formatRelativeTime(entry.createdAt)}
          </time>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
        >
          {expanded ? 'Esconder detalhes' : 'Ver detalhes'}
        </button>
      </div>
      {changedFields.length > 0 && (
        <p className="mt-xs font-label text-label-sm text-on-surface-variant">
          Alterou: {changedFields.map(auditFieldLabel).join(', ')}
        </p>
      )}
      {expanded && (
        <div className="mt-sm grid gap-sm sm:grid-cols-2">
          <DiffPanel label="Antes" value={entry.before} changed={changed} emptyLabel="Não existia antes (criação)" />
          <DiffPanel label="Depois" value={entry.after} changed={changed} emptyLabel="Não existe mais (exclusão)" />
        </div>
      )}
    </li>
  )
}

export function AdminAuditLogPage() {
  const [page, setPage] = useState(1)
  const [actorId, setActorId] = useState('')
  const [entityType, setEntityType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const pageSize = 30

  const actorsQuery = useQuery({
    queryKey: ['admin', 'audit-log', 'actors'],
    queryFn: () => apiFetch<AuditLogActorsResponse>('/admin/audit-log/actors'),
  })
  const actors = actorsQuery.data?.actors ?? []

  const query = useQuery({
    queryKey: ['admin', 'audit-log', page, actorId, entityType, from, to],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (actorId) params.set('actorId', actorId)
      if (entityType) params.set('entityType', entityType)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      return apiFetch<AuditLogListResponse>(`/admin/audit-log?${params.toString()}`)
    },
  })

  const entries = query.data?.entries ?? []
  const total = query.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  function resetToFirstPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setPage(1)
      setter(value)
    }
  }

  return (
    <Panel title="Auditoria">
      <div className="mb-md grid gap-sm sm:grid-cols-4">
        <Select
          value={actorId}
          onChange={resetToFirstPage(setActorId)}
          ariaLabel="Filtrar por autor"
          options={[{ value: '', label: 'Todos os autores' }, ...actors.map((user) => ({ value: user.id, label: user.name }))]}
          searchable
        />
        <Select
          value={entityType}
          onChange={resetToFirstPage(setEntityType)}
          ariaLabel="Filtrar por tipo de entidade"
          options={[
            { value: '', label: 'Todos os tipos' },
            // Ordenado pelo RÓTULO, não pelo nome do model: quem procura
            // "Colaborador" não sabe que ele está no C de `User`.
            ...ENTITY_TYPE_OPTIONS.map((type) => ({ value: type, label: auditEntityLabel(type) })).sort((a, b) =>
              a.label.localeCompare(b.label, 'pt-BR'),
            ),
          ]}
          searchable
        />
        <input
          type="date"
          value={from}
          onChange={(e) => resetToFirstPage(setFrom)(e.target.value)}
          aria-label="Data inicial"
          className={inputCls}
        />
        <input
          type="date"
          value={to}
          onChange={(e) => resetToFirstPage(setTo)(e.target.value)}
          aria-label="Data final"
          className={inputCls}
        />
      </div>
      <ul className="flex flex-col gap-sm">
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </ul>
      {entries.length === 0 && !query.isLoading && <p className="text-body-sm text-on-surface-variant">Nenhum evento encontrado.</p>}
      <div className="mt-md flex items-center gap-sm">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant disabled:opacity-40"
        >
          Anterior
        </button>
        <span className="font-label text-label-sm text-on-surface-variant">
          Página {page} de {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant disabled:opacity-40"
        >
          Próxima
        </button>
      </div>
    </Panel>
  )
}
