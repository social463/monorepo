import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CERTIFICATE_REQUEST_STATUSES,
  CERTIFICATE_REQUEST_STATUS_LABELS,
  type CertificateRequestDTO,
  type CertificateRequestStatus,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { approveCertificateRequest, listCertificateRequests, rejectCertificateRequest } from '../../lib/learning-api'
import { Panel, errorMessage, inputCls } from './shared'

const QUERY_KEY = ['admin', 'certificate-requests']

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function statusBadgeCls(status: CertificateRequestStatus): string {
  if (status === 'APPROVED') return 'bg-primary/15 text-primary'
  if (status === 'REJECTED') return 'bg-error/10 text-error'
  return 'bg-surface-container-highest text-on-surface-variant'
}

/**
 * Uma linha da fila. Aprovar/recusar vivem aqui (mutação própria por linha)
 * para que o botão desabilitado durante uma ação nunca trave a fila inteira.
 */
function RequestRow({ request, onChanged }: { request: CertificateRequestDTO; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  const approve = useMutation({
    mutationFn: (id: string) => approveCertificateRequest(id),
    onSuccess: () => {
      setError(null)
      onChanged()
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível aprovar esta solicitação.')),
  })

  const reject = useMutation({
    mutationFn: (variables: { id: string; rejectionReason: string }) =>
      rejectCertificateRequest(variables.id, variables.rejectionReason),
    onSuccess: () => {
      setError(null)
      setRejecting(false)
      setReason('')
      onChanged()
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível recusar esta solicitação.')),
  })

  const isPending = request.status === 'PENDING'
  // Reabertura por atividade do aprendiz (ver `ensureCertificateRequestForEnrollment`):
  // uma linha PENDING pode carregar o motivo/revisor de uma recusa anterior —
  // quem for avaliar de novo precisa ver que essa pessoa já foi recusada antes.
  const hasPriorRejection = isPending && Boolean(request.rejectionReason)

  return (
    <li className="flex flex-col gap-sm rounded-lg border border-outline-variant/30 bg-surface-container-low p-md">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <div className="min-w-0">
          <p className="truncate font-label text-label-lg text-on-surface">{request.userName}</p>
          <p className="text-body-sm text-on-surface-variant">{request.courseTitle}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-sm py-0.5 font-label text-label-sm ${statusBadgeCls(request.status)}`}
        >
          {CERTIFICATE_REQUEST_STATUS_LABELS[request.status]}
        </span>
      </div>

      {hasPriorRejection && (
        <p className="flex items-start gap-1 rounded-md bg-error/10 p-sm text-body-sm text-error">
          <Icon name="history" className="mt-0.5 shrink-0 text-[16px]" />
          <span>
            Já foi recusada antes
            {request.reviewedBy ? ` por ${request.reviewedBy.name}` : ''}
            {request.reviewedAt ? ` em ${formatDateTime(request.reviewedAt)}` : ''}: {request.rejectionReason}
          </span>
        </p>
      )}

      {!isPending && request.reviewedBy && (
        <p className="text-body-sm text-on-surface-variant">
          {request.status === 'APPROVED' ? 'Aprovada' : 'Recusada'} por {request.reviewedBy.name}
          {request.reviewedAt ? ` em ${formatDateTime(request.reviewedAt)}` : ''}
          {request.status === 'REJECTED' && request.rejectionReason ? `: ${request.rejectionReason}` : ''}
        </p>
      )}

      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}

      {isPending &&
        (rejecting ? (
          <div className="flex flex-col gap-sm">
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Motivo da recusa</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                className={inputCls}
              />
            </label>
            <div className="flex gap-sm">
              <button
                type="button"
                onClick={() => reject.mutate({ id: request.id, rejectionReason: reason.trim() })}
                disabled={!reason.trim() || reject.isPending}
                aria-label={`Confirmar recusa da solicitação de ${request.userName}`}
                className="rounded-md bg-error px-lg py-sm font-label text-label-md font-bold text-on-error disabled:opacity-50"
              >
                Confirmar recusa
              </button>
              <button
                type="button"
                onClick={() => {
                  setRejecting(false)
                  setReason('')
                  setError(null)
                }}
                disabled={reject.isPending}
                className="rounded-md px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-sm">
            <button
              type="button"
              onClick={() => approve.mutate(request.id)}
              disabled={approve.isPending}
              aria-label={`Aprovar solicitação de ${request.userName}`}
              className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              Aprovar
            </button>
            <button
              type="button"
              onClick={() => setRejecting(true)}
              disabled={approve.isPending}
              aria-label={`Recusar solicitação de ${request.userName}`}
              className="rounded-md border border-error/40 px-lg py-sm font-label text-label-md text-error disabled:opacity-50"
            >
              Recusar
            </button>
          </div>
        ))}
    </li>
  )
}

const STATUS_OPTIONS: { value: CertificateRequestStatus | ''; label: string }[] = [
  { value: '', label: 'Todos' },
  ...CERTIFICATE_REQUEST_STATUSES.map((status) => ({ value: status, label: CERTIFICATE_REQUEST_STATUS_LABELS[status] })),
]

/**
 * Fila de aprovação de certificado — ADMIN e SUBADMIN (recorte por setor do
 * curso feito no servidor, ver `admin-certificates.ts`). Começa filtrada em
 * Pendente: é a visão acionável; "Todos" existe pra auditar o histórico.
 */
export function CertificateRequestsSection() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<CertificateRequestStatus | ''>('PENDING')

  const { data, isLoading, isError } = useQuery({
    queryKey: [...QUERY_KEY, status],
    queryFn: () => listCertificateRequests(status || undefined),
  })

  const requests = data?.requests ?? []

  function invalidate() {
    qc.invalidateQueries({ queryKey: QUERY_KEY })
  }

  return (
    <Panel
      title="Fila de certificados"
      action={
        <Select
          ariaLabel="Filtrar por status"
          value={status}
          options={STATUS_OPTIONS}
          onChange={(next) => setStatus(next as CertificateRequestStatus | '')}
          className="w-48"
        />
      }
    >
      {isLoading && <p className="text-body-md text-on-surface-variant">Carregando…</p>}
      {isError && <p className="text-body-md text-error">Erro ao carregar a fila.</p>}
      {!isLoading && requests.length === 0 && (
        <p className="text-body-md text-on-surface-variant">Nenhuma solicitação encontrada.</p>
      )}

      <ul className="flex flex-col gap-sm">
        {requests.map((request) => (
          <RequestRow key={request.id} request={request} onChanged={invalidate} />
        ))}
      </ul>
    </Panel>
  )
}
