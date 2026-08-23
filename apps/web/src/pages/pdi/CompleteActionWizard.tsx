import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  MAX_PDI_PRACTICAL_APPLICATION_LENGTH,
  MAX_PDI_REFLECTION_LENGTH,
  MIN_PDI_REFLECTION_LENGTH,
  PDI_REFLECTION_FIELDS,
  isPdiReflectionComplete,
  type PdiActionDTO,
  type PdiEvidenceInput,
  type PdiReflection,
  type PdiReflectionKey,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { ApiError } from '../../lib/api'
import { completePdiAction, getPdiEvidenceConfig, uploadPdiEvidence } from '../../lib/pdi-api'

const STEPS = ['Comprovante', 'Aplicação', 'Reflexão', 'Revisão'] as const

interface DraftEvidence extends PdiEvidenceInput {
  /** Chave local só para a lista da tela — o backend gera a sua. */
  localId: string
}

function EvidenceList({
  title,
  helper,
  kind,
  items,
  onAdd,
  onRemove,
  uploadEnabled,
}: {
  title: string
  helper: string
  kind: 'COMPLETION' | 'APPLICATION'
  items: DraftEvidence[]
  onAdd: (evidence: DraftEvidence) => void
  onRemove: (localId: string) => void
  uploadEnabled: boolean
}) {
  const [link, setLink] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File | null) {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const uploaded = await uploadPdiEvidence(file)
      onAdd({ localId: `${Date.now()}-${file.name}`, kind, ...uploaded })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar o arquivo.')
    } finally {
      setUploading(false)
    }
  }

  function addLink() {
    const url = link.trim()
    if (!url) return
    onAdd({ localId: `${Date.now()}-link`, kind, externalUrl: url })
    setLink('')
  }

  return (
    <div className="flex flex-col gap-sm">
      <div>
        <p className="font-label text-label-md text-on-surface">{title}</p>
        <p className="text-body-sm text-on-surface-variant">{helper}</p>
      </div>

      <ul className="flex flex-col gap-xs">
        {items.map((item) => (
          <li
            key={item.localId}
            className="flex items-center gap-sm rounded-lg bg-surface-container-highest px-md py-sm text-body-sm text-on-surface"
          >
            <Icon name={item.externalUrl ? 'link' : 'attach_file'} className="text-[18px] text-primary" />
            <span className="min-w-0 flex-1 truncate">{item.fileName ?? item.externalUrl}</span>
            <button
              type="button"
              onClick={() => onRemove(item.localId)}
              aria-label="Remover evidência"
              className="text-on-surface-variant hover:text-error"
            >
              <Icon name="close" className="text-[18px]" />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-sm">
        {uploadEnabled && (
          <label className="inline-flex cursor-pointer items-center gap-xs rounded-full bg-surface-container-highest px-md py-sm font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface">
            <Icon name="upload" className="text-[18px]" />
            {uploading ? 'Enviando…' : 'Anexar arquivo'}
            <input
              type="file"
              className="hidden"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              disabled={uploading}
              onChange={(event) => {
                void handleFile(event.target.files?.[0] ?? null)
                event.target.value = ''
              }}
            />
          </label>
        )}
        <div className="flex min-w-[16rem] flex-1 items-center gap-xs">
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://…"
            className="w-full rounded-full border border-outline-variant/40 bg-surface px-md py-sm text-body-sm text-on-surface outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={addLink}
            className="shrink-0 rounded-full bg-surface-container-highest px-md py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface"
          >
            Adicionar link
          </button>
        </div>
      </div>
      {error && <p className="text-body-sm text-error">{error}</p>}
    </div>
  )
}

/**
 * Conclusão guiada de uma ação de PDI: evidência da conclusão, aplicação prática
 * (com evidência opcional) e as perguntas de reflexão. Conforme a configuração
 * da empresa, o envio vai para a validação do líder ou conclui direto.
 */
export function CompleteActionWizard({
  action,
  leaderRequired,
  onClose,
}: {
  action: PdiActionDTO
  leaderRequired: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [step, setStep] = useState(0)
  const [evidences, setEvidences] = useState<DraftEvidence[]>([])
  const [practical, setPractical] = useState(action.practicalApplication ?? '')
  const [reflection, setReflection] = useState<PdiReflection>(action.reflection ?? {})
  const [error, setError] = useState<string | null>(null)

  const { data: uploadConfig } = useQuery({ queryKey: ['pdi', 'evidence-config'], queryFn: getPdiEvidenceConfig })

  const completionItems = evidences.filter((item) => item.kind === 'COMPLETION')
  const applicationItems = evidences.filter((item) => item.kind === 'APPLICATION')

  const mutation = useMutation({
    mutationFn: () =>
      completePdiAction(action.id, {
        practicalApplication: practical.trim(),
        reflection,
        evidences: evidences.map(({ localId: _localId, ...evidence }) => evidence),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pdi'] })
      onClose()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível concluir a ação.'),
  })

  const canAdvance =
    (step === 0 && completionItems.length > 0) ||
    (step === 1 && practical.trim().length >= 10) ||
    (step === 2 && isPdiReflectionComplete(reflection)) ||
    step === 3

  const progress = Math.round(((step + 1) / STEPS.length) * 100)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Concluir ação de desenvolvimento"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-outline-variant/40 bg-surface-container p-lg shadow-xl">
        <header className="flex items-start justify-between gap-md">
          <div>
            <h2 className="font-headline text-headline-sm text-on-surface">Concluir ação</h2>
            <p className="mt-xs text-body-sm text-on-surface-variant">{action.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
          >
            <Icon name="close" className="text-[24px]" />
          </button>
        </header>

        <div className="mt-lg flex flex-col gap-xs">
          <div className="flex items-center justify-between text-body-sm text-on-surface-variant">
            <span>
              Etapa {step + 1} de {STEPS.length} · <strong className="text-on-surface">{STEPS[step]}</strong>
            </span>
            <span className="tabular-nums">{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="mt-lg flex flex-col gap-lg">
          {step === 0 && (
            <EvidenceList
              title="Comprovante da conclusão"
              helper="Certificado, print, foto, documento — ou um link externo. Pelo menos um é obrigatório."
              kind="COMPLETION"
              items={completionItems}
              uploadEnabled={uploadConfig?.enabled ?? false}
              onAdd={(evidence) => setEvidences((current) => [...current, evidence])}
              onRemove={(localId) => setEvidences((current) => current.filter((item) => item.localId !== localId))}
            />
          )}

          {step === 1 && (
            <div className="flex flex-col gap-lg">
              <div className="flex flex-col gap-sm">
                <label htmlFor="pdi-practical" className="font-label text-label-md text-on-surface">
                  Como você aplicou (ou aplicará) esse aprendizado no dia a dia?
                </label>
                <p className="text-body-sm text-on-surface-variant">
                  Ex.: “Fiz o curso de Excel e automatizei uma planilha do setor”.
                </p>
                <textarea
                  id="pdi-practical"
                  value={practical}
                  onChange={(event) => setPractical(event.target.value)}
                  rows={5}
                  maxLength={MAX_PDI_PRACTICAL_APPLICATION_LENGTH}
                  className="w-full rounded-lg border border-outline-variant/40 bg-surface p-md text-body-md text-on-surface outline-none focus:border-primary"
                />
              </div>
              <EvidenceList
                title="Evidência da aplicação (opcional)"
                helper="Slides, ata, planilha, print, link para o material produzido…"
                kind="APPLICATION"
                items={applicationItems}
                uploadEnabled={uploadConfig?.enabled ?? false}
                onAdd={(evidence) => setEvidences((current) => [...current, evidence])}
                onRemove={(localId) => setEvidences((current) => current.filter((item) => item.localId !== localId))}
              />
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-md">
              {PDI_REFLECTION_FIELDS.map((field) => (
                <div key={field.key} className="flex flex-col gap-xs">
                  <label htmlFor={`pdi-${field.key}`} className="font-label text-label-md text-on-surface">
                    {field.emoji} {field.label}
                    {field.required && <span className="text-error"> *</span>}
                  </label>
                  <textarea
                    id={`pdi-${field.key}`}
                    value={reflection[field.key as PdiReflectionKey] ?? ''}
                    onChange={(event) =>
                      setReflection((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                    rows={2}
                    maxLength={MAX_PDI_REFLECTION_LENGTH}
                    placeholder="Escreva sua reflexão…"
                    className="w-full rounded-lg border border-outline-variant/40 bg-surface p-md text-body-md text-on-surface outline-none focus:border-primary"
                  />
                </div>
              ))}
              {!isPdiReflectionComplete(reflection) && (
                <p className="text-body-sm text-on-surface-variant">
                  A primeira pergunta é obrigatória (mínimo de {MIN_PDI_REFLECTION_LENGTH} caracteres).
                </p>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-md rounded-lg bg-surface-container-highest p-lg">
              <p className="text-body-md text-on-surface">
                <strong>{completionItems.length}</strong> evidência(s) da conclusão e{' '}
                <strong>{applicationItems.length}</strong> da aplicação.
              </p>
              <p className="text-body-sm text-on-surface-variant">{practical}</p>
              <ul className="flex flex-col gap-xs text-body-sm text-on-surface-variant">
                {PDI_REFLECTION_FIELDS.filter((field) => reflection[field.key as PdiReflectionKey]?.trim()).map(
                  (field) => (
                    <li key={field.key}>
                      <strong className="text-on-surface">{field.emoji} </strong>
                      {reflection[field.key as PdiReflectionKey]}
                    </li>
                  ),
                )}
              </ul>
              <p className="rounded-lg bg-primary/10 p-md text-body-sm text-on-surface">
                {leaderRequired
                  ? 'Ao enviar, a ação vai para a validação do seu líder.'
                  : 'Ao enviar, a ação será concluída na hora.'}
              </p>
            </div>
          )}
        </div>

        {error && <p className="mt-md text-body-sm text-error">{error}</p>}

        <footer className="mt-lg flex items-center justify-between gap-md">
          <button
            type="button"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={step === 0}
            className="rounded-full px-lg py-sm font-label text-label-md text-on-surface-variant disabled:opacity-40"
          >
            Voltar
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((current) => current + 1)}
              disabled={!canAdvance}
              className="rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              Próximo
            </button>
          ) : (
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              {leaderRequired ? 'Enviar para validação' : 'Concluir ação'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
