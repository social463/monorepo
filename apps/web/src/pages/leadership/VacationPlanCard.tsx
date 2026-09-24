import { useMemo } from 'react'
import {
  formatCivilDate,
  matchSplit,
  periodEndDate,
  splitsForBalance,
  validateVacationPlan,
  type VacationPlanDTO,
  type VacationPolicy,
} from '@legends/shared'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'

/**
 * Um cartão por **direito**, não por pessoa: quem tem dois períodos aquisitivos
 * em aberto aparece duas vezes, cada uma com o próprio limite de gozo. Na base
 * da G&G isso é quase um terço do quadro, então o cartão diz isso em voz alta —
 * sem o aviso o gestor acha que é duplicidade e ignora um dos dois.
 */
export interface VacationPlanCardProps {
  plan: VacationPlanDTO
  policy: VacationPolicy
  holidays: ReadonlyMap<string, string>
  today: string
  /** Trava do prazo: a G&G continua editando, o gestor não. */
  readOnly: boolean
  onChange: (periods: { startDate: string; days: number }[]) => void
}

const STATUS_PILL: Record<string, { text: string; cls: string }> = {
  vazio: { text: 'Ainda não preenchido', cls: 'bg-surface-container-highest text-on-surface-variant' },
  erro: { text: 'Corrija para continuar', cls: 'bg-error-container text-on-error-container' },
  atencao: { text: 'Falta completar', cls: 'bg-secondary-container text-on-secondary-container' },
  ok: { text: 'Pronto', cls: 'bg-tertiary-container text-on-tertiary-container' },
}

export function VacationPlanCard({
  plan,
  policy,
  holidays,
  today,
  readOnly,
  onChange,
}: VacationPlanCardProps) {
  const { entitlement } = plan
  const periods = useMemo(
    () => plan.periods.map((p) => ({ startDate: p.startDate, days: p.days })),
    [plan.periods],
  )
  const ehPJ = entitlement.employmentType === 'PJ'
  const splits = splitsForBalance(policy, entitlement.balanceDays, entitlement.employmentType)
  const current = ehPJ ? null : matchSplit(policy, entitlement.balanceDays, periods)

  const validation = validateVacationPlan({
    policy,
    balanceDays: entitlement.balanceDays,
    acquisitionEnd: entitlement.acquisitionEnd,
    dueDate: entitlement.dueDate,
    periods,
    holidays,
    today,
    employmentType: entitlement.employmentType,
  })

  const pill =
    plan.status === 'VALIDATED'
      ? { text: 'Validado pelo DP', cls: 'bg-tertiary-container text-on-tertiary-container' }
      : plan.status === 'CONFIRMED'
        ? { text: 'Confirmado, aguardando o DP', cls: 'bg-primary-container text-on-primary-container' }
        : STATUS_PILL[validation.status]!

  // Escolher a combinação preenche os dias sozinho — o gestor só informa o
  // primeiro dia de cada período, que é a única decisão que é dele.
  function applySplit(id: string) {
    const split = splits.find((s) => s.id === id)
    if (!split) return
    onChange(split.days.map((days, i) => ({ startDate: periods[i]?.startDate ?? '', days })))
  }

  function setStart(index: number, startDate: string) {
    onChange(periods.map((p, i) => (i === index ? { ...p, startDate } : p)))
  }

  const semSaldo = entitlement.balanceDays <= 0

  // O cartão NÃO leva `overflow-hidden`: ele arredondaria o cabeçalho, mas
  // corta a lista do seletor de combinação, que abre para fora do cartão. O
  // canto é resolvido no próprio cabeçalho, com `rounded-t-xl`.

  return (
    <article className="rounded-xl border border-outline-variant/40 bg-surface-container-low">
      <header className="flex flex-wrap items-start justify-between gap-sm rounded-t-xl border-b border-outline-variant/40 bg-surface-container px-lg py-md">
        <div className="flex items-start gap-sm">
          {/* O `Avatar` não tem tamanho próprio: ele preenche o container. Sem a
              moldura fixa, a foto ocupa a largura inteira do cartão. */}
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-container/20">
            <Avatar user={plan.user} />
          </span>
          <div>
            <p className="font-label text-label-lg text-on-surface">{plan.user.name}</p>
            <p className="text-body-sm text-on-surface-variant">
              Período aquisitivo {formatCivilDate(entitlement.acquisitionStart)} a{' '}
              {formatCivilDate(entitlement.acquisitionEnd)}
            </p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-sm py-1 font-label text-label-sm ${pill.cls}`}>
          {pill.text}
        </span>
      </header>

      <div className="grid gap-md px-lg py-md sm:grid-cols-3">
        <div className="rounded-lg border border-outline-variant/40 p-sm">
          <p className="font-label text-label-sm uppercase text-on-surface-variant">Dias disponíveis</p>
          <p className="mt-1 font-headline text-headline-md text-on-surface">{entitlement.balanceDays}</p>
          <p className="text-body-sm text-on-surface-variant">
            {validation.soldDays > 0
              ? `${entitlement.balanceDays - validation.soldDays} para descanso + ${validation.soldDays} vendidos`
              : 'dias de férias a programar'}
          </p>
        </div>
        {/* O custo real de uma programação malfeita é pagamento em dobro — por
            isso o limite tem destaque próprio, e não vira uma linha de texto. */}
        <div className="rounded-lg border border-error/40 bg-error-container/30 p-sm">
          <p className="font-label text-label-sm uppercase text-on-error-container">Limite para as férias</p>
          <p className="mt-1 font-label text-label-lg text-on-error-container">
            {formatCivilDate(entitlement.dueDate)}
          </p>
          <p className="text-body-sm text-on-surface-variant">
            As férias precisam <strong>terminar</strong> até esta data.
          </p>
        </div>
        <div className="rounded-lg border border-outline-variant/40 p-sm">
          <p className="font-label text-label-sm uppercase text-on-surface-variant">Vence em</p>
          <p className="mt-1 font-headline text-headline-md text-on-surface">
            {entitlement.daysToDueDate}
          </p>
          <p className="text-body-sm text-on-surface-variant">dias</p>
        </div>
      </div>

      {entitlement.note && (
        <p className="mx-lg mb-md flex items-start gap-xs rounded-lg bg-surface-container px-sm py-xs text-body-sm text-on-surface-variant">
          <Icon name="info" className="mt-0.5 text-[16px] text-primary" />
          Observação do DP: {entitlement.note}
        </p>
      )}

      {/* O que a pessoa pediu. Fica ACIMA do formulário de propósito: pedido
          que aparece depois da decisão não é pedido, é conferência. */}
      {plan.request && (
        <div className="mx-lg mb-md rounded-lg border border-primary/40 bg-primary-container/40 px-sm py-xs">
          <p className="flex items-center gap-xs font-label text-label-sm text-on-primary-container">
            <Icon name="waving_hand" className="text-[16px]" />
            {plan.user.name.split(' ')[0]} pediu
          </p>
          <ul className="mt-1 space-y-0.5 text-body-sm text-on-surface">
            {plan.request.periods.map((p) => (
              <li key={p.startDate}>
                {formatCivilDate(p.startDate)} — {p.days} dia{p.days === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
          {plan.request.note && (
            <p className="mt-1 text-body-sm text-on-surface-variant">{plan.request.note}</p>
          )}
          <p className="mt-1 text-body-sm text-on-surface-variant">
            É um pedido, não uma decisão — quem programa é você.
          </p>
        </div>
      )}

      {/* Períodos lançados à mão que a validação vai substituir. Aparecem aqui,
          e não na validação: quem lançou tinha um motivo, e quem programa
          precisa ver que está passando por cima dele. */}
      {plan.replacing.length > 0 && (
        <div className="mx-lg mb-md rounded-lg border border-secondary/40 bg-secondary-container/40 px-sm py-xs">
          <p className="flex items-start gap-xs font-label text-label-sm text-on-secondary-container">
            <Icon name="warning" className="mt-0.5 text-[16px]" />
            Esta pessoa já tem férias lançadas à mão nesta janela. Ao validar, a programação substitui:
          </p>
          <ul className="mt-1 space-y-0.5 text-body-sm text-on-surface-variant">
            {plan.replacing.map((v) => (
              <li key={v.startDate}>
                {formatCivilDate(v.startDate)} a {formatCivilDate(v.endDate)}
                {v.note ? ` — ${v.note}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {semSaldo ? (
        // 15 das 112 linhas da base atual. Sem este ramo, essas pessoas ficariam
        // eternamente como pendência na barra de progresso do gestor.
        <p className="mx-lg mb-lg flex items-start gap-xs rounded-lg bg-tertiary-container px-sm py-xs text-body-sm text-on-tertiary-container">
          <Icon name="check_circle" className="mt-0.5 text-[16px]" />
          Este período aquisitivo não tem saldo a programar.
        </p>
      ) : (
        <div className="space-y-md border-t border-outline-variant/40 px-lg py-md">
          {/* PJ não escolhe combinação: o padrão dele é contrato, não CLT, e o
              combinado é entre a pessoa e o líder direto. Oferecer as cinco
              opções aqui imporia uma regra que não é dele. */}
          {ehPJ ? (
            <div>
              <p className="font-label text-label-md text-on-surface">
                Como dividir os {entitlement.balanceDays} dias?
              </p>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                Contrato PJ: a divisão é livre e combinada com a pessoa. Informe o início e quantos
                dias em cada período.
              </p>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => onChange([...periods, { startDate: '', days: 0 }])}
                className="mt-sm rounded-lg border border-outline-variant px-md py-sm font-label text-label-md text-on-surface disabled:text-on-surface-variant"
              >
                + Adicionar período
              </button>
            </div>
          ) : (
          <div>
            <label className="font-label text-label-md text-on-surface" htmlFor={`split-${plan.entitlement.id}`}>
              Como dividir os {entitlement.balanceDays} dias?
            </label>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              Escolha uma das combinações da empresa — os dias são preenchidos sozinhos e você só
              informa o primeiro dia de cada período.
            </p>
            <Select
              ariaLabel="Combinação de férias"
              className="mt-2 w-full sm:w-80"
              value={current?.id ?? ''}
              onChange={applySplit}
              disabled={readOnly}
              options={[
                { value: '', label: 'Selecione a combinação' },
                ...splits.map((s) => ({ value: s.id, label: s.label })),
              ]}
            />
            {current && <p className="mt-1 text-body-sm text-on-surface-variant">{current.description}</p>}
          </div>
          )}

          {periods.map((period, index) => {
            const end = periodEndDate(period.startDate, period.days)
            return (
              <div
                key={index}
                className="grid gap-sm rounded-lg border border-outline-variant/40 p-sm sm:grid-cols-3 sm:items-end"
              >
                <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
                  {index + 1}º período — primeiro dia
                  <input
                    type="date"
                    value={period.startDate}
                    disabled={readOnly}
                    min={policy.minStartDate}
                    max={entitlement.dueDate}
                    onChange={(e) => setStart(index, e.target.value)}
                    className="rounded-lg border border-outline-variant bg-surface px-sm py-xs text-body-md text-on-surface"
                  />
                </label>
                {ehPJ ? (
                  <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
                    Dias
                    <input
                      type="number"
                      min={1}
                      max={entitlement.balanceDays}
                      value={period.days || ''}
                      disabled={readOnly}
                      onChange={(e) =>
                        onChange(
                          periods.map((p, i) =>
                            i === index ? { ...p, days: Number(e.target.value) } : p,
                          ),
                        )
                      }
                      className="rounded-lg border border-outline-variant bg-surface px-sm py-xs text-body-md text-on-surface"
                    />
                  </label>
                ) : (
                  <div className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
                    Dias
                    <p className="rounded-lg bg-surface-container px-sm py-xs text-body-md text-on-surface">
                      {period.days}
                    </p>
                  </div>
                )}
                <div className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
                  Último dia
                  <p className="rounded-lg bg-surface-container px-sm py-xs text-body-md text-on-surface">
                    {end ? formatCivilDate(end) : '—'}
                  </p>
                </div>
              </div>
            )
          })}

          {validation.errors.map((error) => (
            <p
              key={error}
              className="flex items-start gap-xs rounded-lg bg-error-container px-sm py-xs text-body-sm text-on-error-container"
            >
              <Icon name="error" className="mt-0.5 text-[16px]" />
              {error}
            </p>
          ))}
          {validation.warnings.map((warning) => (
            <p
              key={warning}
              className="flex items-start gap-xs rounded-lg bg-secondary-container px-sm py-xs text-body-sm text-on-secondary-container"
            >
              <Icon name="info" className="mt-0.5 text-[16px]" />
              {warning}
            </p>
          ))}
        </div>
      )}
    </article>
  )
}
