import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  APPRENTICE_CONTRACT_WARNING_DAYS,
  APPRENTICE_JOURNEY_STAGES,
  APPRENTICE_MIN_MONTHS_IN_SECTOR,
  apprenticeTenureLabel,
  type ApprenticeJourneyDTO,
  type ApprenticeJourneyStage,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import {
  createApprenticeSectorMove,
  deleteApprenticeSectorMove,
  fetchApprenticeJourneys,
  saveApprenticeJourney,
} from '../../lib/apprentice-api'

const inputCls =
  'w-full rounded-lg border border-outline-variant bg-surface px-md py-sm font-body text-body-md text-on-surface'
const labelCls = 'font-label text-label-sm uppercase text-on-surface-variant'
const cardCls = 'rounded-xl border border-outline-variant/40 bg-surface-container p-lg'

function formatDate(ymd: string | null): string {
  if (!ymd) return '—'
  const [year, month, day] = ymd.split('-')
  return `${day}/${month}/${year}`
}

function Eligibility({ journey }: { journey: ApprenticeJourneyDTO }) {
  if (journey.monthsInCurrentSector === null) {
    return (
      <span className="rounded-full bg-surface-container-highest px-md py-xs font-label text-label-sm text-on-surface-variant">
        Informe a data de admissão no cadastro
      </span>
    )
  }
  if (journey.eligibleForSectorChange) {
    return (
      <span className="rounded-full bg-primary/15 px-md py-xs font-label text-label-sm text-on-primary-container">
        Elegível para mudança de setor
      </span>
    )
  }
  const months = journey.monthsInCurrentSector
  return (
    <span className="rounded-full bg-error/10 px-md py-xs font-label text-label-sm text-error">
      Não elegível — {months} {months === 1 ? 'mês' : 'meses'} no setor atual (mínimo:{' '}
      {APPRENTICE_MIN_MONTHS_IN_SECTOR})
    </span>
  )
}

function JourneyCard({ journey, today }: { journey: ApprenticeJourneyDTO; today: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    contractEndsOn: journey.contractEndsOn ?? '',
    activities: journey.activities,
  })
  const [move, setMove] = useState({
    toSector: '',
    movedOn: today,
    reason: '',
    responsibles: '',
  })
  const [notice, setNotice] = useState<string | null>(null)

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['apprentice'] })

  const save = useMutation({
    mutationFn: () =>
      saveApprenticeJourney(journey.person.id, {
        contractEndsOn: form.contractEndsOn || null,
        activities: form.activities,
      }),
    onSuccess: () => {
      setNotice('Jornada salva.')
      invalidate()
    },
    onError: (err: Error) => setNotice(err.message),
  })

  const register = useMutation({
    mutationFn: () =>
      createApprenticeSectorMove({
        userId: journey.person.id,
        fromSector: journey.sectorName ?? '',
        toSector: move.toSector,
        movedOn: move.movedOn,
        reason: move.reason,
        responsibles: move.responsibles,
      }),
    onSuccess: () => {
      setMove({ toSector: '', movedOn: today, reason: '', responsibles: '' })
      setNotice('Movimentação registrada.')
      invalidate()
    },
    onError: (err: Error) => setNotice(err.message),
  })

  const removeMove = useMutation({
    mutationFn: (moveId: string) => deleteApprenticeSectorMove(moveId),
    onSuccess: invalidate,
  })

  const ending =
    journey.daysToContractEnd !== null && journey.daysToContractEnd <= APPRENTICE_CONTRACT_WARNING_DAYS

  function registrar() {
    if (!move.toSector.trim()) return
    // A elegibilidade avisa, não barra: o histórico tem de conseguir gravar a
    // mudança que de fato aconteceu. Quem decide é quem está olhando.
    if (
      !journey.eligibleForSectorChange &&
      journey.monthsInCurrentSector !== null &&
      !window.confirm(
        `${journey.person.name} está no setor atual há ${journey.monthsInCurrentSector} ` +
          `${journey.monthsInCurrentSector === 1 ? 'mês' : 'meses'} (mínimo de ` +
          `${APPRENTICE_MIN_MONTHS_IN_SECTOR}). Registrar a mudança mesmo assim?`,
      )
    ) {
      return
    }
    register.mutate()
  }

  return (
    <article className={cardCls}>
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="min-w-0">
          <p className="font-label text-label-lg text-on-surface">{journey.person.name}</p>
          <p className="font-body text-body-sm text-on-surface-variant">
            {journey.person.className ?? 'Sem turma'} · {journey.sectorName ?? 'setor não informado'}
            {journey.squad ? ` · ${journey.squad}` : ''}
          </p>
        </div>
        {ending && (
          <span className="rounded-full bg-error/10 px-md py-xs font-label text-label-sm text-error">
            {journey.daysToContractEnd! < 0
              ? 'Contrato encerrado'
              : `Vence em ${journey.daysToContractEnd} dias`}
          </span>
        )}
      </div>

      <dl className="mt-md grid gap-md sm:grid-cols-4">
        <div>
          <dt className={labelCls}>Etapa (automática)</dt>
          <dd className="font-body text-body-sm text-on-surface">
            {journey.stage ?? 'Informe a admissão'}
          </dd>
        </div>
        <div>
          <dt className={labelCls}>Tempo de casa</dt>
          <dd className="font-body text-body-sm text-on-surface">
            {apprenticeTenureLabel(journey.joinedOn, today)}
          </dd>
        </div>
        <div>
          <dt className={labelCls}>Líder direto</dt>
          <dd className="font-body text-body-sm text-on-surface">{journey.leaderName ?? '—'}</dd>
        </div>
        <div>
          <dt className={labelCls}>Fim do contrato</dt>
          <dd className="font-body text-body-sm text-on-surface">
            {formatDate(journey.contractEndsOn)}
          </dd>
        </div>
      </dl>

      <div className="mt-md">
        <Eligibility journey={journey} />
        {journey.inSectorSince && (
          <p className="mt-xs font-body text-body-sm text-on-surface-variant">
            No setor atual desde {formatDate(journey.inSectorSince)}.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mt-md inline-flex items-center gap-xs font-label text-label-md text-on-primary-container"
      >
        <Icon name={open ? 'expand_less' : 'expand_more'} />
        {open ? 'Fechar' : `Abrir gestão (${journey.moves.length} movimentações)`}
      </button>

      {open && (
        <div className="mt-lg flex flex-col gap-lg border-t border-outline-variant/40 pt-lg">
          <div className="grid gap-md sm:grid-cols-2">
            <label className="flex flex-col gap-xs">
              <span className={labelCls}>Término previsto do contrato</span>
              <input
                type="date"
                value={form.contractEndsOn}
                onChange={(e) => setForm({ ...form, contractEndsOn: e.target.value })}
                className={inputCls}
              />
            </label>
            <div className="flex flex-col gap-xs">
              <span className={labelCls}>Setor, squad, líder e admissão</span>
              <p className="rounded-lg bg-surface-container-highest px-md py-sm font-body text-body-sm text-on-surface-variant">
                Vêm de Administração › Organização — edite lá, não aqui.
              </p>
            </div>
          </div>

          <label className="flex flex-col gap-xs">
            <span className={labelCls}>Atividades sob responsabilidade (uma por linha)</span>
            <textarea
              rows={4}
              value={form.activities}
              onChange={(e) => setForm({ ...form, activities: e.target.value })}
              className={inputCls}
            />
          </label>

          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="self-start rounded-full bg-primary px-lg py-sm font-label text-label-lg text-on-primary disabled:bg-surface-container-highest disabled:text-on-surface-variant"
          >
            Salvar jornada
          </button>

          <div className="rounded-lg border border-outline-variant/40 p-md">
            <p className="font-label text-label-lg text-on-surface">Registrar mudança de setor</p>
            <div className="mt-md grid gap-md sm:grid-cols-2">
              <label className="flex flex-col gap-xs">
                <span className={labelCls}>Novo setor</span>
                <input
                  value={move.toSector}
                  onChange={(e) => setMove({ ...move, toSector: e.target.value })}
                  className={inputCls}
                />
              </label>
              <label className="flex flex-col gap-xs">
                <span className={labelCls}>Data da mudança</span>
                <input
                  type="date"
                  value={move.movedOn}
                  onChange={(e) => setMove({ ...move, movedOn: e.target.value })}
                  className={inputCls}
                />
              </label>
              <label className="flex flex-col gap-xs">
                <span className={labelCls}>Responsáveis</span>
                <input
                  value={move.responsibles}
                  onChange={(e) => setMove({ ...move, responsibles: e.target.value })}
                  className={inputCls}
                />
              </label>
              <label className="flex flex-col gap-xs">
                <span className={labelCls}>Motivo</span>
                <input
                  value={move.reason}
                  onChange={(e) => setMove({ ...move, reason: e.target.value })}
                  className={inputCls}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={!move.toSector.trim() || register.isPending}
              onClick={registrar}
              className="mt-md rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container-highest disabled:text-on-surface-variant"
            >
              Registrar mudança
            </button>
          </div>

          <div>
            <p className="font-label text-label-lg text-on-surface">Linha do tempo</p>
            {journey.moves.length === 0 ? (
              <p className="mt-xs font-body text-body-sm text-on-surface-variant">
                Nenhuma movimentação registrada.
              </p>
            ) : (
              <ol className="mt-md flex flex-col gap-md border-l border-outline-variant pl-lg">
                {journey.moves.map((row) => (
                  <li key={row.id} className="relative">
                    <span className="absolute -left-[25px] top-2 h-2.5 w-2.5 rounded-full bg-primary" />
                    <div className="flex items-start justify-between gap-sm">
                      <div>
                        <p className={labelCls}>{formatDate(row.movedOn)}</p>
                        <p className="font-body text-body-md text-on-surface">
                          {row.fromSector || '—'} → {row.toSector}
                        </p>
                        {row.reason && (
                          <p className="font-body text-body-sm text-on-surface-variant">{row.reason}</p>
                        )}
                        {row.responsibles && (
                          <p className="font-body text-body-sm text-on-surface-variant">
                            Responsáveis: {row.responsibles}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeMove.mutate(row.id)}
                        aria-label="Remover movimentação"
                        className="text-on-surface-variant hover:text-error"
                      >
                        <Icon name="delete" />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {notice && <p className="font-label text-label-md text-on-primary-container">{notice}</p>}
        </div>
      )}
    </article>
  )
}

export function JourneyTab() {
  const { data, isPending } = useQuery({
    queryKey: ['apprentice', 'journeys'],
    queryFn: fetchApprenticeJourneys,
  })
  const [stage, setStage] = useState<ApprenticeJourneyStage | ''>('')
  const [ending, setEnding] = useState(false)

  if (isPending) return <Skeleton className="h-96 w-full rounded-xl" />
  if (!data) return null

  const today = new Date().toISOString().slice(0, 10)
  const list = data
    .filter((journey) => !stage || journey.stage === stage)
    .filter(
      (journey) =>
        !ending ||
        (journey.daysToContractEnd !== null &&
          journey.daysToContractEnd <= APPRENTICE_CONTRACT_WARNING_DAYS),
    )

  return (
    <div className="flex flex-col gap-lg">
      <div className={`${cardCls} grid gap-md sm:grid-cols-2`}>
        <label className="flex flex-col gap-xs">
          <span className={labelCls}>Etapa da jornada</span>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as ApprenticeJourneyStage | '')}
            className={inputCls}
          >
            <option value="">Todas as etapas</option>
            {APPRENTICE_JOURNEY_STAGES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-end gap-sm pb-sm font-body text-body-md text-on-surface">
          <input
            type="checkbox"
            checked={ending}
            onChange={(e) => setEnding(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Contratos a vencer em {APPRENTICE_CONTRACT_WARNING_DAYS} dias
        </label>
      </div>

      {list.length === 0 ? (
        <p className={`${cardCls} font-body text-body-md text-on-surface-variant`}>
          Nenhum aprendiz com esses filtros.
        </p>
      ) : (
        <div className="flex flex-col gap-lg">
          {list.map((journey) => (
            <JourneyCard key={journey.person.id} journey={journey} today={today} />
          ))}
        </div>
      )}
    </div>
  )
}
