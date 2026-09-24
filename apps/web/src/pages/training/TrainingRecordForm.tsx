import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  MAX_TRAINING_REASONS,
  TRAINING_COURSE_TITLE_MAX_LENGTH,
  TRAINING_INSTITUTION_MAX_LENGTH,
  TRAINING_LEARNING_TYPES,
  TRAINING_MODALITIES,
  TRAINING_REASONS,
  TRAINING_REASON_LABELS,
  TRAINING_SPONSORS,
  TRAINING_SPONSOR_LABELS,
  TRAINING_SPONSOR_OTHER_MAX_LENGTH,
  TRAINING_TYPES,
  TRAINING_TYPE_LABELS,
  type CreateTrainingRecordRequest,
  type TrainingReason,
  type TrainingRecordDTO,
  type TrainingSponsor,
  type TrainingType,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { errorMessage, inputCls } from '../admin/shared'
import { uploadCertificateAttachment, UploadError } from '../../lib/upload'
import { createTrainingRecord, fetchTrainingIdentity, updateTrainingRecord } from '../../lib/training-api'

/**
 * O formulário de registro de treinamento.
 *
 * Sucede "Envie seu Certificado": os campos de lá continuam todos aqui, com os
 * que faltavam para o T&D medir (carga horária, instituição, modalidade e data
 * de conclusão). Nome e setor seguem fora — o portal já sabe, e perguntar seria
 * criar um dado que diverge quando a pessoa muda de área.
 *
 * Dois campos são condicionais, como no formulário antigo: o valor investido só
 * aparece quando quem pagou foi a empresa, e o nome do patrocinador só quando
 * ele é "Outro". O servidor descarta os dois fora dessas condições — a tela
 * apenas não os oferece.
 */
export function TrainingRecordForm({
  record,
  onDone,
  onCancel,
}: {
  /** Preenchido = edição de um registro que ainda não foi validado. */
  record?: TrainingRecordDTO
  onDone: () => void
  onCancel?: () => void
}) {
  const queryClient = useQueryClient()
  const { data: identity } = useQuery({ queryKey: ['training', 'identity'], queryFn: fetchTrainingIdentity })

  const [courseTitle, setCourseTitle] = useState(record?.courseTitle ?? '')
  const [learningType, setLearningType] = useState<string>(record?.learningType ?? 'Curso')
  const [otherLearningType, setOtherLearningType] = useState('')
  const [modality, setModality] = useState(record?.modality ?? 'Online gravado')
  const [trainingType, setTrainingType] = useState<TrainingType | ''>(record?.trainingType ?? '')
  const [hours, setHours] = useState(record ? String(record.hours) : '')
  const [institution, setInstitution] = useState(record?.institution ?? '')
  const [sponsor, setSponsor] = useState<TrainingSponsor | ''>(record?.sponsor ?? '')
  const [sponsorOther, setSponsorOther] = useState(record?.sponsorOther ?? '')
  const [amount, setAmount] = useState(record ? String(record.investmentCents / 100) : '')
  const [reasons, setReasons] = useState<TrainingReason[]>(record?.reasons ?? [])
  const [completionDate, setCompletionDate] = useState(record?.completionDate ?? '')
  const [requestDate, setRequestDate] = useState(record?.requestDate ?? '')
  const [notes, setNotes] = useState(record?.notes ?? '')
  const [anexo, setAnexo] = useState<{ key: string; name: string } | null>(null)
  const [enviandoAnexo, setEnviandoAnexo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const pedeValor = sponsor === 'EMR'
  const pedeOutroPatrocinador = sponsor === 'OUTRO'
  const tipoEhOutro = learningType === 'Outro'

  function alternarMotivo(reason: TrainingReason) {
    setReasons((atuais) => {
      if (atuais.includes(reason)) return atuais.filter((r) => r !== reason)
      if (atuais.length >= MAX_TRAINING_REASONS) return atuais
      return [...atuais, reason]
    })
  }

  async function anexarArquivo(file: File | undefined) {
    if (!file) return
    setErro(null)
    setEnviandoAnexo(true)
    try {
      setAnexo(await uploadCertificateAttachment(file))
    } catch (err) {
      setErro(err instanceof UploadError ? err.message : 'Não foi possível enviar o arquivo.')
    } finally {
      setEnviandoAnexo(false)
    }
  }

  const salvar = useMutation({
    mutationFn: () => {
      const body: CreateTrainingRecordRequest = {
        courseTitle: courseTitle.trim(),
        learningType: tipoEhOutro && otherLearningType.trim() ? otherLearningType.trim() : learningType,
        modality: modality || null,
        trainingType: trainingType === '' ? null : trainingType,
        hours: Number(hours.replace(',', '.')) || 0,
        institution: institution.trim() || null,
        sponsor: sponsor as TrainingSponsor,
        sponsorOther: pedeOutroPatrocinador ? sponsorOther.trim() || null : null,
        // Em centavos: dinheiro em ponto flutuante acumula erro de arredondamento.
        investmentCents: pedeValor && amount ? Math.round(Number(amount.replace(',', '.')) * 100) : null,
        reasons,
        completionDate,
        requestDate: requestDate || null,
        notes: notes.trim() || null,
        ...(anexo ? { attachmentKey: anexo.key } : {}),
      }
      return record ? updateTrainingRecord(record.id, body) : createTrainingRecord(body)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['training', 'me'] })
      onDone()
    },
  })

  function enviar(event: FormEvent) {
    event.preventDefault()
    setErro(null)
    if (!courseTitle.trim()) return setErro('Informe o curso ou capacitação.')
    if (!completionDate) return setErro('Informe a data de conclusão.')
    if (sponsor === '') return setErro('Informe quem pagou.')
    if (reasons.length === 0) return setErro('Escolha ao menos um motivo.')
    salvar.mutate()
  }

  const identidade = [
    { label: 'Nome', value: identity?.userName },
    { label: 'Setor', value: identity?.sectorName },
    { label: 'Squad', value: identity?.squad },
    { label: 'Liderança', value: identity?.leaderName },
    { label: 'Cargo', value: identity?.position },
    { label: 'Categoria', value: identity?.positionCategory },
  ]

  return (
    <form onSubmit={enviar} className="flex flex-col gap-lg">
      <section className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
        <h2 className="font-headline text-headline-md text-on-surface">Identificação</h2>
        <p className="mt-xs font-body text-body-sm text-on-surface-variant">
          Vem do seu cadastro e fica gravado no registro — se você mudar de setor depois, este treinamento continua
          contando para a área em que foi feito.
        </p>
        <dl className="mt-md grid gap-sm sm:grid-cols-2 lg:grid-cols-3">
          {identidade.map((item) => (
            <div key={item.label} className="rounded-lg bg-surface-container-high px-md py-sm">
              <dt className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">{item.label}</dt>
              <dd className="truncate font-body text-body-md text-on-surface">{item.value || '—'}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
        <h2 className="font-headline text-headline-md text-on-surface">O treinamento</h2>

        <label className="flex flex-col gap-xs">
          <span className="font-label text-label-md text-on-surface">Curso ou capacitação *</span>
          <input
            className={inputCls}
            value={courseTitle}
            maxLength={TRAINING_COURSE_TITLE_MAX_LENGTH}
            onChange={(event) => setCourseTitle(event.target.value)}
          />
        </label>

        <div className="grid gap-md sm:grid-cols-2">
          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Tipo de aprendizado</span>
            <select className={inputCls} value={learningType} onChange={(e) => setLearningType(e.target.value)}>
              {TRAINING_LEARNING_TYPES.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {tipo}
                </option>
              ))}
            </select>
          </label>

          {tipoEhOutro && (
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-md text-on-surface">Qual?</span>
              <input className={inputCls} value={otherLearningType} onChange={(e) => setOtherLearningType(e.target.value)} />
            </label>
          )}

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Modalidade</span>
            <select className={inputCls} value={modality} onChange={(e) => setModality(e.target.value)}>
              {TRAINING_MODALITIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Carga horária (horas) *</span>
            <input
              className={inputCls}
              type="number"
              min="0"
              step="0.5"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Instituição</span>
            <input
              className={inputCls}
              value={institution}
              maxLength={TRAINING_INSTITUTION_MAX_LENGTH}
              onChange={(e) => setInstitution(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Data da conclusão *</span>
            <input
              className={inputCls}
              type="date"
              value={completionDate}
              onChange={(e) => setCompletionDate(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Quando você pediu / começou</span>
            <input
              className={inputCls}
              type="date"
              value={requestDate}
              onChange={(e) => setRequestDate(e.target.value)}
            />
            <span className="font-body text-body-sm text-on-surface-variant">
              É daqui que sai o prazo de atendimento. Em branco, vale hoje.
            </span>
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Natureza do conteúdo</span>
            <select
              className={inputCls}
              value={trainingType}
              onChange={(e) => setTrainingType(e.target.value as TrainingType | '')}
            >
              <option value="">Não informar</option>
              {TRAINING_TYPES.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {TRAINING_TYPE_LABELS[tipo]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
        <h2 className="font-headline text-headline-md text-on-surface">Investimento e motivo</h2>

        <div className="grid gap-md sm:grid-cols-2">
          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Quem pagou? *</span>
            <select
              className={inputCls}
              value={sponsor}
              onChange={(e) => setSponsor(e.target.value as TrainingSponsor | '')}
            >
              <option value="">Selecione…</option>
              {TRAINING_SPONSORS.map((item) => (
                <option key={item} value={item}>
                  {TRAINING_SPONSOR_LABELS[item]}
                </option>
              ))}
            </select>
          </label>

          {pedeOutroPatrocinador && (
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-md text-on-surface">Quem?</span>
              <input
                className={inputCls}
                value={sponsorOther}
                maxLength={TRAINING_SPONSOR_OTHER_MAX_LENGTH}
                onChange={(e) => setSponsorOther(e.target.value)}
              />
            </label>
          )}

          {pedeValor && (
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-md text-on-surface">Valor investido (R$)</span>
              <input
                className={inputCls}
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          )}
        </div>

        <fieldset className="flex flex-col gap-xs">
          <legend className="font-label text-label-md text-on-surface">
            Por que você fez? (até {MAX_TRAINING_REASONS})
          </legend>
          <div className="flex flex-wrap gap-sm">
            {TRAINING_REASONS.map((reason) => {
              const marcado = reasons.includes(reason)
              return (
                <label
                  key={reason}
                  className={`flex cursor-pointer items-center gap-xs rounded-full border px-md py-xs font-label text-label-sm transition-colors ${
                    marcado
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-outline-variant/60 text-on-surface-variant'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={marcado}
                    onChange={() => alternarMotivo(reason)}
                  />
                  {TRAINING_REASON_LABELS[reason]}
                </label>
              )
            })}
          </div>
        </fieldset>

        <label className="flex flex-col gap-xs">
          <span className="font-label text-label-md text-on-surface">Observações</span>
          <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </section>

      <section className="flex flex-col gap-sm rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
        <h2 className="font-headline text-headline-md text-on-surface">Comprovante</h2>
        <p className="font-body text-body-sm text-on-surface-variant">
          Certificado, declaração ou print da conclusão — PDF ou imagem. É o que a G&amp;G confere para validar.
        </p>
        <label className="inline-flex w-fit cursor-pointer items-center gap-xs rounded-full border border-outline-variant px-lg py-sm font-label text-label-md text-on-surface">
          <Icon name="upload_file" className="text-[18px]" />
          {enviandoAnexo ? 'Enviando…' : 'Escolher arquivo'}
          <input
            type="file"
            className="sr-only"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={(event) => void anexarArquivo(event.target.files?.[0])}
          />
        </label>
        {anexo && <p className="font-body text-body-sm text-on-surface">Anexado: {anexo.name}</p>}
        {!anexo && record?.hasCertificate && (
          <p className="font-body text-body-sm text-on-surface-variant">
            O comprovante enviado antes continua valendo. Escolha um arquivo só se quiser substituí-lo.
          </p>
        )}
      </section>

      {(erro || salvar.isError) && (
        <p role="alert" className="rounded-lg bg-error/10 px-md py-sm font-body text-body-sm text-error">
          {erro ?? errorMessage(salvar.error, 'Não foi possível registrar o treinamento.')}
        </p>
      )}

      <div className="flex flex-wrap gap-sm">
        <button
          type="submit"
          disabled={salvar.isPending || enviandoAnexo}
          className="inline-flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          {salvar.isPending ? 'Salvando…' : record ? 'Salvar alterações' : 'Registrar treinamento'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-outline-variant px-lg py-sm font-label text-label-md text-on-surface"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}
