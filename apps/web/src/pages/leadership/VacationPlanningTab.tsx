import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  formatCivilDate,
  validateVacationPlan,
  type VacationPlanDTO,
  type VacationPlanningResponse,
} from '@legends/shared'
import { ApiError } from '../../lib/api'
import {
  confirmVacationPlans,
  downloadMyTeamVacationCsv,
  fetchTeamPlanning,
  saveVacationPlan,
} from '../../lib/vacation-planning-api'
import { Icon } from '../../components/Icon'
import { DownloadCsvButton } from '../../components/DownloadCsvButton'
import { TeamVacationsPanel } from '../profile/TeamVacationsPanel'
import { VacationPlanCard } from './VacationPlanCard'
import { VacationTimeline } from './VacationTimeline'

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

function nomeDoMes(ym: string): string {
  const [ano, mes] = ym.split('-')
  return `${MESES[Number(mes) - 1] ?? ym} de ${ano}`
}

/** Hoje em data civil, para as regras que dependem de antecedência. */
function hoje(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

/**
 * Aba **Férias** da Liderança.
 *
 * Absorve o painel de lançamento avulso que ficava em "Meu time": lançar um
 * período e programar a campanha respondem à mesma pergunta — "quando meu time
 * sai?" — e mantê-los em dois lugares repetiria a duplicidade que a
 * desduplicação do termômetro desfez. Sem campanha aberta, esta aba é
 * exatamente o painel de antes.
 */
export function VacationPlanningTab() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['vacation-planning'], queryFn: fetchTeamPlanning })
  const [rascunhos, setRascunhos] = useState<Record<string, { startDate: string; days: number }[]>>({})
  const [erro, setErro] = useState<string | null>(null)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const salvar = useMutation({
    mutationFn: saveVacationPlan,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vacation-planning'] }),
  })
  const confirmar = useMutation({
    mutationFn: confirmVacationPlans,
    onSuccess: () => {
      setErro(null)
      void queryClient.invalidateQueries({ queryKey: ['vacation-planning'] })
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível confirmar.'),
  })

  // Os timers do salvamento automático morrem junto com a tela: um `setTimeout`
  // pendente disparando depois da desmontagem grava rascunho de uma aba que a
  // pessoa já fechou.
  useEffect(() => {
    const atuais = timers.current
    return () => {
      for (const id of Object.values(atuais)) clearTimeout(id)
    }
  }, [])

  const data: VacationPlanningResponse | undefined = query.data
  const holidays = useMemo(
    () => new Map((data?.holidays ?? []).map((h) => [h.date, h.name])),
    [data?.holidays],
  )
  const hojeYmd = hoje()

  if (query.isLoading) {
    return <p className="text-body-md text-on-surface-variant">Carregando a programação…</p>
  }
  if (query.isError) {
    return (
      <p className="rounded-lg border border-error/40 bg-error-container/30 p-lg text-body-md text-on-error-container">
        Não foi possível carregar a programação de férias.
      </p>
    )
  }

  const campanha = data?.campaign ?? null
  const planos = data?.plans ?? []

  // Sem campanha aberta a aba não fica vazia: ela é o painel de lançamento
  // avulso, que é o que o líder usa o ano inteiro.
  if (!campanha) {
    return (
      <div className="flex flex-col gap-lg">
        <TeamVacationsPanel />
      </div>
    )
  }

  function periodosDe(plan: VacationPlanDTO) {
    return rascunhos[plan.entitlement.id] ?? plan.periods.map((p) => ({ startDate: p.startDate, days: p.days }))
  }

  function alterar(plan: VacationPlanDTO, periods: { startDate: string; days: number }[]) {
    setRascunhos((atual) => ({ ...atual, [plan.entitlement.id]: periods }))
    // Salvamento automático com espera: digitar uma data dispara uma gravação,
    // e sem a espera cada tecla do campo de data viraria uma requisição.
    clearTimeout(timers.current[plan.entitlement.id])
    timers.current[plan.entitlement.id] = setTimeout(() => {
      salvar.mutate({
        entitlementId: plan.entitlement.id,
        periods: periods.filter((p) => p.startDate && p.days > 0),
      })
    }, 800)
  }

  const prontos = planos.filter((plan) => {
    const v = validateVacationPlan({
      policy: campanha.policy,
      balanceDays: plan.entitlement.balanceDays,
      acquisitionEnd: plan.entitlement.acquisitionEnd,
      dueDate: plan.entitlement.dueDate,
      periods: periodosDe(plan),
      holidays,
      today: hojeYmd,
    })
    return v.status === 'ok'
  })

  return (
    <div className="flex flex-col gap-lg">
      <header className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div>
            <h2 className="font-headline text-headline-md text-on-surface">
              Programação de Férias {campanha.year}
            </h2>
            <p className="mt-1 text-body-md text-on-surface-variant">
              Você programa o seu time — e as equipes dos seus liderados. Tudo o que preenche é
              salvo sozinho; ao terminar, confirme para o time de Gente e Gestão conferir.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-sm">
            <span className="flex items-center gap-xs rounded-lg bg-surface-container px-sm py-xs font-label text-label-sm text-on-surface-variant">
              <Icon name="event" className="text-[16px]" />
              Prazo: {formatCivilDate(campanha.deadline)}
            </span>
            {/* A planilha da própria área — o gestor imprime, confere e conversa
                com a equipe em cima dela. */}
            <DownloadCsvButton
              fetcher={downloadMyTeamVacationCsv}
              fallbackName="ferias-meu-time.csv"
              label="Baixar planilha"
            />
          </div>
        </div>

        <p className="mt-md font-label text-label-md text-on-surface">
          {prontos.length} de {planos.length} prontos
        </p>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-container-highest">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${planos.length ? (prontos.length / planos.length) * 100 : 0}%` }}
          />
        </div>

        {campanha.locked && (
          <p className="mt-md flex items-start gap-xs rounded-lg bg-secondary-container px-sm py-xs text-body-sm text-on-secondary-container">
            <Icon name="lock" className="mt-0.5 text-[16px]" />
            O prazo para preenchimento terminou. Fale com o time de Gente e Gestão se precisar
            alterar alguma coisa.
          </p>
        )}
      </header>

      <VacationTimeline plans={planos} holidays={holidays} periodsOf={periodosDe} />

      {/* Informativo, nunca impedimento: quem avalia se a área aguenta duas
          pessoas fora no mesmo mês é o gestor. Por isso vive aqui em cima, e
          não junto dos erros de cada cartão. */}
      {(data?.monthOverlaps ?? []).length > 0 && (
        <div className="rounded-xl border border-secondary/40 bg-secondary-container/40 p-lg">
          <p className="flex items-center gap-xs font-label text-label-lg text-on-secondary-container">
            <Icon name="groups" className="text-[18px]" />
            Mais de uma pessoa fora no mesmo mês
          </p>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Não é impedimento — só para você avaliar a cobertura da área.
          </p>
          <ul className="mt-sm space-y-1 text-body-sm text-on-surface">
            {(data?.monthOverlaps ?? []).map((overlap) => (
              <li key={overlap.month}>
                <strong>{nomeDoMes(overlap.month)}</strong>:{' '}
                {overlap.userIds
                  .map((id) => planos.find((p) => p.user.id === id)?.user.name ?? id)
                  .join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {planos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-outline-variant p-lg text-center text-body-md text-on-surface-variant">
          Ninguém do seu time tem período aquisitivo a programar nesta campanha.
        </p>
      ) : (
        planos.map((plan) => (
          <VacationPlanCard
            key={plan.entitlement.id}
            plan={{ ...plan, periods: periodosDe(plan).map((p) => ({ ...p, endDate: '', soldDays: 0 })) }}
            policy={campanha.policy}
            holidays={holidays}
            today={hojeYmd}
            readOnly={campanha.locked && !plan.unlockedUntil}
            onChange={(periods) => alterar(plan, periods)}
          />
        ))
      )}

      {planos.length > 0 && (
        <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-lg">
          <h3 className="font-label text-label-lg text-on-surface">Para finalizar</h3>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Confira a programação e confirme. O time de Gente e Gestão recebe o aviso — você não
            precisa mandar e-mail para ninguém.
          </p>
          {erro && (
            <p className="mt-sm flex items-start gap-xs rounded-lg bg-error-container px-sm py-xs text-body-sm text-on-error-container">
              <Icon name="error" className="mt-0.5 text-[16px]" />
              {erro}
            </p>
          )}
          <button
            type="button"
            disabled={confirmar.isPending || campanha.locked}
            onClick={() =>
              confirmar.mutate({ entitlementIds: planos.map((plan) => plan.entitlement.id) })
            }
            className="mt-md rounded-lg bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {confirmar.isPending ? 'Confirmando…' : 'Confirmar programação'}
          </button>
        </div>
      )}

      <TeamVacationsPanel />
    </div>
  )
}
