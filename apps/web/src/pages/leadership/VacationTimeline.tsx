import { useMemo } from 'react'
import { addCivilDays, civilDaysBetween, formatCivilDate, type VacationPlanDTO } from '@legends/shared'
import { Icon } from '../../components/Icon'

/**
 * Linha do tempo do time.
 *
 * O formulário valida cada pessoa isolada; o risco real da programação não é a
 * pessoa, é **quantas saem juntas**. Aqui os períodos aparecem lado a lado, e o
 * gestor vê a sobreposição sem precisar somar datas de cabeça.
 *
 * Os feriados aparecem junto, e isso resolve de lambuja o pior momento do
 * formulário: sem eles, a data é recusada com uma mensagem e o gestor tenta
 * adivinhar a próxima válida.
 *
 * **Não trava nada.** A G&G foi explícita de que não há limite de pessoas fora
 * ao mesmo tempo, e que quem avalia a cobertura da área é o gestor. Isto é
 * informação, não regra.
 */
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export interface VacationTimelineProps {
  plans: VacationPlanDTO[]
  /** Datas de feriado (`YYYY-MM-DD`) da janela da campanha. */
  holidays: ReadonlyMap<string, string>
  periodsOf: (plan: VacationPlanDTO) => { startDate: string; days: number }[]
}

export function VacationTimeline({ plans, holidays, periodsOf }: VacationTimelineProps) {
  const linhas = useMemo(
    () =>
      plans
        .map((plan) => ({
          plan,
          periodos: periodsOf(plan)
            .filter((p) => p.startDate && p.days > 0)
            .map((p) => ({ start: p.startDate, end: addCivilDays(p.startDate, p.days - 1), days: p.days })),
        }))
        .filter((linha) => linha.periodos.length > 0),
    [plans, periodsOf],
  )

  // A janela é o que existe, não um ano cheio: mostrar 12 meses vazios porque
  // uma pessoa marcou uma semana em julho não ajuda ninguém a enxergar nada.
  const janela = useMemo(() => {
    const todas = linhas.flatMap((l) => l.periodos)
    if (todas.length === 0) return null
    const inicio = todas.reduce((min, p) => (p.start < min ? p.start : min), todas[0]!.start)
    const fim = todas.reduce((max, p) => (p.end > max ? p.end : max), todas[0]!.end)
    // Uma folga de uma semana de cada lado para as barras não colarem na borda.
    return { inicio: addCivilDays(inicio, -7), fim: addCivilDays(fim, 7) }
  }, [linhas])

  if (!janela || linhas.length === 0) return null

  const total = civilDaysBetween(janela.inicio, janela.fim) || 1
  const pct = (ymd: string) => (civilDaysBetween(janela.inicio, ymd) / total) * 100

  // Um marcador por mês que começa dentro da janela.
  const marcos: { ymd: string; label: string }[] = []
  let cursor = `${janela.inicio.slice(0, 7)}-01`
  while (cursor <= janela.fim) {
    if (cursor >= janela.inicio) {
      const mes = Number(cursor.slice(5, 7))
      marcos.push({ ymd: cursor, label: `${MESES[mes - 1]}/${cursor.slice(2, 4)}` })
    }
    const [ano, mesAtual] = [Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7))]
    cursor = mesAtual === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mesAtual + 1).padStart(2, '0')}-01`
  }

  const feriadosNaJanela = [...holidays.entries()].filter(
    ([date]) => date >= janela.inicio && date <= janela.fim,
  )

  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-lg">
      <h3 className="flex items-center gap-xs font-label text-label-lg text-on-surface">
        <Icon name="calendar_view_week" className="text-[18px]" />
        Quando o time sai
      </h3>
      <p className="mt-1 text-body-sm text-on-surface-variant">
        Os períodos lado a lado, com os feriados marcados. É para você enxergar a cobertura da
        área — nada aqui impede salvar.
      </p>

      <div className="mt-md overflow-x-auto">
        <div className="min-w-[36rem]">
          <div className="relative mb-xs h-4">
            {marcos.map((marco) => (
              <span
                key={marco.ymd}
                className="absolute -translate-x-1/2 font-label text-label-sm text-on-surface-variant"
                style={{ left: `${pct(marco.ymd)}%` }}
              >
                {marco.label}
              </span>
            ))}
          </div>

          <div className="space-y-xs">
            {linhas.map(({ plan, periodos }) => (
              <div key={plan.entitlement.id} className="flex items-center gap-sm">
                <span className="w-32 shrink-0 truncate text-body-sm text-on-surface" title={plan.user.name}>
                  {plan.user.name}
                </span>
                <div className="relative h-6 flex-1 rounded-md bg-surface-container">
                  {feriadosNaJanela.map(([date, nome]) => (
                    <span
                      key={date}
                      title={`${nome} — ${formatCivilDate(date)}`}
                      className="absolute top-0 h-full w-px bg-error/50"
                      style={{ left: `${pct(date)}%` }}
                    />
                  ))}
                  {periodos.map((periodo) => (
                    <span
                      key={periodo.start}
                      title={`${formatCivilDate(periodo.start)} a ${formatCivilDate(periodo.end)} · ${periodo.days} dias`}
                      className="absolute top-0.5 flex h-5 items-center justify-center overflow-hidden rounded bg-primary px-1 font-label text-label-sm text-on-primary"
                      style={{
                        left: `${pct(periodo.start)}%`,
                        // O `max` garante que um período de poucos dias ainda
                        // seja clicável e visível numa janela de vários meses.
                        width: `${Math.max((periodo.days / total) * 100, 1.5)}%`,
                      }}
                    >
                      {periodo.days}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {feriadosNaJanela.length > 0 && (
        <p className="mt-sm flex items-center gap-xs text-body-sm text-on-surface-variant">
          <span className="inline-block h-3 w-px bg-error/50" />
          As linhas verticais são feriados da empresa.
        </p>
      )}
    </section>
  )
}
