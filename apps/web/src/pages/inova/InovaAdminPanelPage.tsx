import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  INOVA_PROJECT_PHASES,
  inovaCategoryIcon,
  inovaSectorKey,
  type InovaProjectDTO,
  type InovaProjectPhase,
} from '@legends/shared'
import { StatCard, ChartCard, EmptyState, DistributionBars } from '../../components/analytics/AnalyticsPrimitives'
import { ValueBars, InovaTimelineChart, InovaCategoryBreakdown } from '../../components/inova/InovaAdminCharts'
import { InovaSectorOverview } from '../../components/inova/InovaSectorOverview'
import { InovaAdminChat } from '../../components/inova/InovaAdminChat'
import { Icon } from '../../components/Icon'
import { listInovaProjects, listSectors } from '../../lib/inova-api'

type PeriodMode = 'all' | 'year' | 'month'

const MESES = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
const MES_LABEL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function dateInPeriod(iso: string, mode: PeriodMode, year: string, month: string): boolean {
  if (mode === 'all') return true
  const y = iso.slice(0, 4)
  if (mode === 'year') return y === year
  return y === year && iso.slice(5, 7) === month
}

/**
 * O projeto "aconteceu" no período se foi criado, mudou de fase ou ganhou
 * registro no diário dentro dele — regra do original. Só pela criação, o
 * projeto de 2025 que chegou a "Usando na Rotina" em março/26 sumia do recorte
 * de março, justamente o mês em que ele mais andou.
 */
function matchesPeriod(project: InovaProjectDTO, mode: PeriodMode, year: string, month: string): boolean {
  if (mode === 'all') return true
  if (dateInPeriod(project.createdAt, mode, year, month)) return true
  if ((project.phaseHistory ?? []).some((h) => dateInPeriod(h.occurredAt, mode, year, month))) return true
  return (project.diaryDates ?? []).some((d) => dateInPeriod(d, mode, year, month))
}

/**
 * Mudanças de fase que contam como "avanço" no gráfico de evolução: todas
 * menos a linha que a criação grava (a fase inicial, "Ideia") — essa é o
 * nascimento do projeto, já contado em "Novos Projetos".
 */
function phaseAdvancesOf(project: InovaProjectDTO): string[] {
  const history = project.phaseHistory ?? []
  const [first, ...rest] = history
  return (first && first.phase !== 'IDEA' ? history : rest).map((h) => h.occurredAt)
}

/**
 * Colunas do "Pipeline de Inovação" — o quadro executivo do original, que
 * agrupa as seis fases em três perguntas. "Concluído" fica fora, como lá: o
 * pipeline é do que ainda está em curso; o concluído aparece no gráfico por
 * fase.
 */
const PIPELINE_COLUMNS: { key: string; label: string; icon: string; phases: InovaProjectPhase[] }[] = [
  { key: 'not_started', label: 'Projetos que ainda não iniciaram', icon: 'lightbulb', phases: ['IDEA'] },
  { key: 'in_progress', label: 'Projetos em andamento', icon: 'construction', phases: ['EXPLORING_SOLUTION', 'TESTING_SOLUTION'] },
  { key: 'executing', label: 'Projetos em execução', icon: 'rocket_launch', phases: ['ROUTINE_USE', 'EXPANDING'] },
]
const PIPELINE_PHASES = new Set(PIPELINE_COLUMNS.flatMap((c) => c.phases))

const SELECT_CLASS = 'rounded-md border border-outline-variant/60 bg-surface px-sm py-xs text-body-sm text-on-surface'

function countBy<T>(items: T[], keyOf: (item: T) => string): { key: string; count: number }[] {
  const map = new Map<string, number>()
  for (const item of items) {
    const key = keyOf(item)
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
}

function phaseLabel(phase: string): string {
  return INOVA_PROJECT_PHASES.find((p) => p.value === phase)?.label ?? phase
}

// Mês curto ("jan/26") a partir de um "YYYY-MM", sem passar por Date (que em
// string ISO sem hora é interpretada em UTC e, renderizada em horário local
// de Brasil, volta um mês — ver docs/superpowers/specs do painel INOVA).
function monthShortLabel(month: string): string {
  const [year, monthNum] = month.split('-')
  const index = Number(monthNum) - 1
  const abbrev = (MES_LABEL[index] ?? monthNum).slice(0, 3)
  return `${abbrev}/${year.slice(2)}`
}

// Extrai valores em R$ de um texto livre, somando todos os tokens numéricos
// encontrados. pt-BR usa "." como separador de milhar e "," como decimal:
// "R$ 5.000" deve virar 5000, não 5 (parseFloat("5.000") == 5). Um token só
// com ponto (sem vírgula) só é decimal se o grupo após o ponto não tiver
// exatamente 3 dígitos (ex.: "5.5" é decimal, "5.000" é milhar).
function parseBRL(raw: string | null): number {
  if (!raw) return 0
  const matches = raw.match(/[\d.,]+/g)
  if (!matches) return 0
  return matches.reduce((sum, token) => {
    let n = token
    const hasDot = n.includes('.')
    const hasComma = n.includes(',')
    if (hasDot && hasComma) {
      n = n.replace(/\./g, '').replace(',', '.')
    } else if (hasComma) {
      n = n.replace(',', '.')
    } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(n)) {
      // Sem vírgula e todo grupo separado por ponto tem exatamente 3
      // dígitos: é milhar ("5.000", "1.234.567"), não decimal.
      n = n.replace(/\./g, '')
    }
    const v = parseFloat(n)
    return sum + (Number.isNaN(v) ? 0 : v)
  }, 0)
}

/**
 * Painel administrativo executivo do INOVA — métricas, insights automáticos,
 * gráficos, overview por setor e o chat de IA. Ver
 * docs/superpowers/specs/2026-09-05-comunidade-inova-painel-administrativo-design.md.
 */
export function InovaAdminPanelPage() {
  const now = new Date()
  const [filterSector, setFilterSector] = useState('all')
  const [periodMode, setPeriodMode] = useState<PeriodMode>('all')
  const [filterYear, setFilterYear] = useState(String(now.getFullYear()))
  const [filterMonth, setFilterMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'))
  // Filtros próprios do pipeline. O setor é o MESMO do filtro global, como no
  // original: dois seletores de setor divergindo na mesma tela confundiriam.
  const [showPipelineFilters, setShowPipelineFilters] = useState(false)
  const [pipelineCategory, setPipelineCategory] = useState('all')
  const [pipelinePhase, setPipelinePhase] = useState('all')
  const [pipelineResponsible, setPipelineResponsible] = useState('all')

  const { data } = useQuery({ queryKey: ['inova', 'projects', 'painel'], queryFn: () => listInovaProjects({ archived: false }) })
  const { data: sectorsData } = useQuery({ queryKey: ['sectors'], queryFn: listSectors })

  // Filtra arquivado no cliente também: a API já recebe `archived: false`,
  // mas o teste (e um cache stale) não garantem isso — o painel não deve
  // contar projeto arquivado nas métricas em hipótese nenhuma.
  //
  // O setor do projeto é texto livre ("Gente & Gestão", do INOVA original) e o
  // cadastro escreve "Gente e Gestão": sem trazer o projeto para o nome do
  // cadastro, o painel dava G&G como setor sem projeto. Setor que não existe
  // no cadastro fica como veio.
  const projects = useMemo(() => {
    const canonical = new Map((sectorsData?.sectors ?? []).map((s) => [inovaSectorKey(s.name), s.name]))
    return (data?.projects ?? [])
      .filter((p) => !p.archived)
      .map((p) => {
        const name = canonical.get(inovaSectorKey(p.sector))
        return name && name !== p.sector ? { ...p, sector: name } : p
      })
  }, [data, sectorsData])

  const availableYears = useMemo(() => {
    const set = new Set<string>()
    // Anos de mudança de fase e de diário também: o período conta esses
    // eventos, então um ano só com avanço precisa estar selecionável.
    projects.forEach((p) => {
      set.add(p.createdAt.slice(0, 4))
      p.phaseHistory?.forEach((h) => set.add(h.occurredAt.slice(0, 4)))
      p.diaryDates?.forEach((d) => set.add(d.slice(0, 4)))
    })
    set.add(String(now.getFullYear()))
    return [...set].sort((a, b) => b.localeCompare(a))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects])

  const availableSectors = useMemo(() => [...new Set(projects.map((p) => p.sector))].sort(), [projects])

  // Escopado por setor + período — alimenta métricas, insights, gráficos por
  // categoria/fase, overview por setor e o chat de IA.
  const scopedProjects = useMemo(
    () =>
      projects.filter((p) => {
        if (filterSector !== 'all' && p.sector !== filterSector) return false
        return matchesPeriod(p, periodMode, filterYear, filterMonth)
      }),
    [projects, filterSector, periodMode, filterYear, filterMonth],
  )

  // Só por setor (sem período) — "Projetos por Setor" e "Pessoas por Área"
  // mostram a distribuição total, mesmo com um período estreito selecionado.
  const filteredForSectorChart = useMemo(
    () => projects.filter((p) => filterSector === 'all' || p.sector === filterSector),
    [projects, filterSector],
  )

  const presentSectors = useMemo(() => new Set(projects.map((p) => p.sector)), [projects])
  const registeredSectors = useMemo(() => (sectorsData?.sectors ?? []).map((s) => s.name), [sectorsData])
  const missingSectors = useMemo(
    () => registeredSectors.filter((name) => !presentSectors.has(name)),
    [registeredSectors, presentSectors],
  )
  // Numerador e denominador da mesma lista: projeto com setor fora do cadastro
  // não pode fazer "9/8".
  const participatingSectors = registeredSectors.length > 0
    ? registeredSectors.length - missingSectors.length
    : presentSectors.size

  const totalCostReduction = scopedProjects.reduce((s, p) => s + (p.costReduction ?? 0), 0)
  const totalHoursSaved = scopedProjects.reduce((s, p) => s + (p.hoursSaved ?? 0), 0)
  const totalPeople = useMemo(() => {
    const set = new Set<string>()
    scopedProjects.forEach((p) => {
      if (p.responsible1) set.add(p.responsible1.id)
      if (p.responsible2) set.add(p.responsible2.id)
    })
    return set.size
  }, [scopedProjects])

  const sectorDistribution = useMemo(() => countBy(filteredForSectorChart, (p) => p.sector), [filteredForSectorChart])
  const categoryBreakdown = useMemo(() => countBy(scopedProjects, (p) => p.category), [scopedProjects])
  const categoryGroups = useMemo(() => {
    const map = new Map<string, { id: string; title: string; sector: string }[]>()
    scopedProjects.forEach((p) => {
      if (!map.has(p.category)) map.set(p.category, [])
      map.get(p.category)!.push({ id: p.id, title: p.title, sector: p.sector })
    })
    return [...map.entries()].map(([category, items]) => ({ category, projects: items }))
  }, [scopedProjects])
  const phaseBreakdown = useMemo(() => countBy(scopedProjects, (p) => p.phase), [scopedProjects])

  const peopleBySector = useMemo(() => {
    const map = new Map<string, Set<string>>()
    filteredForSectorChart.forEach((p) => {
      if (!map.has(p.sector)) map.set(p.sector, new Set())
      if (p.responsible1) map.get(p.sector)!.add(p.responsible1.id)
      if (p.responsible2) map.get(p.sector)!.add(p.responsible2.id)
    })
    return [...map.entries()].map(([sector, people]) => ({ key: sector, label: sector, count: people.size })).sort((a, b) => b.count - a.count)
  }, [filteredForSectorChart])

  const sectorCost = useMemo(() => {
    const map = new Map<string, number>()
    scopedProjects.forEach((p) => map.set(p.sector, (map.get(p.sector) ?? 0) + (p.costReduction ?? 0)))
    return [...map.entries()].map(([sector, value]) => ({ key: sector, label: sector, value }))
  }, [scopedProjects])

  const sectorHours = useMemo(() => {
    const map = new Map<string, number>()
    scopedProjects.forEach((p) => map.set(p.sector, (map.get(p.sector) ?? 0) + (p.hoursSaved ?? 0)))
    return [...map.entries()].map(([sector, value]) => ({ key: sector, label: sector, value }))
  }, [scopedProjects])

  const timeline = useMemo(() => {
    const map = new Map<string, { novosProjetos: number; avancosDeFase: number }>()
    const bump = (month: string, field: 'novosProjetos' | 'avancosDeFase') => {
      const current = map.get(month) ?? { novosProjetos: 0, avancosDeFase: 0 }
      current[field] += 1
      map.set(month, current)
    }
    scopedProjects.forEach((p) => {
      bump(p.createdAt.slice(0, 7), 'novosProjetos')
      phaseAdvancesOf(p).forEach((at) => bump(at.slice(0, 7), 'avancosDeFase'))
    })
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, counts]) => ({ month: monthShortLabel(month), ...counts }))
  }, [scopedProjects])

  const responsibles = useMemo(() => {
    const map = new Map<string, string>()
    projects.forEach((p) => {
      if (p.responsible1) map.set(p.responsible1.id, p.responsible1.name)
      if (p.responsible2) map.set(p.responsible2.id, p.responsible2.name)
    })
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [projects])

  const pipelineProjects = useMemo(
    () =>
      scopedProjects.filter((p) => {
        if (pipelineCategory !== 'all' && p.category !== pipelineCategory) return false
        if (pipelinePhase !== 'all' && p.phase !== pipelinePhase) return false
        if (pipelineResponsible !== 'all' && p.responsible1?.id !== pipelineResponsible && p.responsible2?.id !== pipelineResponsible) {
          return false
        }
        return true
      }),
    [scopedProjects, pipelineCategory, pipelinePhase, pipelineResponsible],
  )
  const pipelineHasFilters = filterSector !== 'all' || pipelineCategory !== 'all' || pipelinePhase !== 'all' || pipelineResponsible !== 'all'
  const clearPipelineFilters = () => {
    setFilterSector('all')
    setPipelineCategory('all')
    setPipelinePhase('all')
    setPipelineResponsible('all')
  }

  const globalFilterActive = filterSector !== 'all' || periodMode !== 'all'
  // O chat analisa o que a tela mostra. Sem filtro não manda nada: a IA vê a
  // empresa inteira e não precisa ser avisada de que é "um recorte".
  const chatScope = useMemo(() => {
    if (!globalFilterActive) return { projectIds: undefined, label: undefined }
    const periodo =
      periodMode === 'all'
        ? null
        : periodMode === 'year'
          ? filterYear
          : `${MES_LABEL[Number(filterMonth) - 1]} de ${filterYear}`
    const label = [filterSector !== 'all' ? filterSector : null, periodo].filter(Boolean).join(' · ')
    return { projectIds: scopedProjects.map((p) => p.id), label }
  }, [globalFilterActive, periodMode, filterYear, filterMonth, filterSector, scopedProjects])

  const totalInvestment = useMemo(() => scopedProjects.reduce((s, p) => s + parseBRL(p.projectCosts), 0), [scopedProjects])
  const roi = useMemo(() => (totalInvestment > 0 ? (totalCostReduction / totalInvestment).toFixed(1) : '-'), [totalInvestment, totalCostReduction])

  const insights = useMemo(() => {
    const list: string[] = []
    if (sectorDistribution.length > 0) {
      list.push(`${sectorDistribution[0].key} é o setor com maior número de projetos ativos (${sectorDistribution[0].count}).`)
    }
    const automacao = categoryBreakdown.find((c) => c.key === 'Automação de processos')
    if (automacao && scopedProjects.length > 0) {
      const pct = Math.round((automacao.count / scopedProjects.length) * 100)
      list.push(`Automação representa ${pct}% dos projetos ${filterSector === 'all' ? 'ativos' : `em ${filterSector}`}.`)
    }
    if (missingSectors.length > 0) {
      list.push(`${missingSectors.length} ${missingSectors.length === 1 ? 'setor está' : 'setores estão'} sem projetos em andamento.`)
    }
    if (phaseBreakdown.length > 0) {
      list.push(`A maior parte dos projetos está em "${phaseLabel(phaseBreakdown[0].key)}" (${phaseBreakdown[0].count}).`)
    }
    if (totalCostReduction > 0) {
      list.push(`Economia estimada acumulada: R$ ${totalCostReduction.toLocaleString('pt-BR')}.`)
    }
    return list.slice(0, 5)
  }, [sectorDistribution, categoryBreakdown, missingSectors, phaseBreakdown, totalCostReduction, filterSector, scopedProjects.length])

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <p className="font-label text-label-md uppercase tracking-[0.2em] text-primary">Painel Administrativo</p>
        <h1 className="mt-2 font-headline text-headline-lg text-on-surface">Impacto da IA na Empresa</h1>
        <p className="mt-1 text-body-md text-on-surface-variant">Visão estratégica do pipeline de inovação</p>
      </header>

      <div className="flex flex-wrap items-end gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-md">
        <label className="flex flex-col gap-xs">
          <span className="font-label text-label-sm text-on-surface-variant">Período</span>
          <select
            value={periodMode}
            onChange={(e) => setPeriodMode(e.target.value as PeriodMode)}
            className="rounded-md border border-outline-variant/60 bg-surface px-sm py-xs text-body-sm text-on-surface"
          >
            <option value="all">Todo o período</option>
            <option value="year">Anual</option>
            <option value="month">Mensal</option>
          </select>
        </label>
        {periodMode !== 'all' && (
          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Ano</span>
            <select
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="rounded-md border border-outline-variant/60 bg-surface px-sm py-xs text-body-sm text-on-surface"
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
        )}
        {periodMode === 'month' && (
          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Mês</span>
            <select
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="rounded-md border border-outline-variant/60 bg-surface px-sm py-xs text-body-sm text-on-surface"
            >
              {MESES.map((m, i) => (
                <option key={m} value={m}>{MES_LABEL[i]}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-xs">
          <span className="font-label text-label-sm text-on-surface-variant">Setor</span>
          <select
            id="painel-filtro-setor"
            aria-label="Setor"
            value={filterSector}
            onChange={(e) => setFilterSector(e.target.value)}
            className="min-w-[12rem] rounded-md border border-outline-variant/60 bg-surface px-sm py-xs text-body-sm text-on-surface"
          >
            <option value="all">Todos os setores</option>
            {availableSectors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        {globalFilterActive && (
          <button
            type="button"
            onClick={() => {
              setFilterSector('all')
              setPeriodMode('all')
            }}
            className="inline-flex items-center gap-1 self-end rounded-full px-md py-xs font-label text-label-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          >
            <Icon name="close" className="text-[16px]" />
            Limpar
          </button>
        )}
      </div>

      <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon="payments" label="Economia Estimada" value={`R$ ${totalCostReduction.toLocaleString('pt-BR')}`} />
        <StatCard icon="schedule" label="Horas Economizadas/mês" value={`${totalHoursSaved}h`} />
        <StatCard icon="rocket_launch" label="Projetos Ativos" value={scopedProjects.length} />
        <StatCard
          icon="apartment"
          label="Áreas Participando"
          value={`${participatingSectors}/${registeredSectors.length || presentSectors.size}`}
          hint={missingSectors.length > 0 ? `Sem projetos ativos: ${missingSectors.join(', ')}` : undefined}
        />
        <StatCard icon="groups" label="Pessoas na Comunidade" value={totalPeople} />
      </div>

      {insights.length > 0 && (
        <ChartCard title="Insights automáticos">
          <ul className="grid gap-sm sm:grid-cols-2">
            {insights.map((text) => (
              <li key={text} className="flex items-start gap-sm rounded-xl border border-primary/20 bg-primary/5 p-sm">
                <Icon name="auto_awesome" className="mt-0.5 shrink-0 text-[16px] text-primary" />
                <span className="text-body-sm text-on-surface">{text}</span>
              </li>
            ))}
          </ul>
        </ChartCard>
      )}

      <InovaAdminChat projectIds={chatScope.projectIds} scopeLabel={chatScope.label} />

      <ChartCard title="ROI e Impacto Operacional da IA">
        <div className="grid grid-cols-2 gap-md lg:grid-cols-4">
          <StatCard icon="payments" label="Investimento total" value={`R$ ${totalInvestment.toLocaleString('pt-BR')}`} hint='Soma de "Custos do projeto"' />
          <StatCard icon="savings" label="Retorno (economia)" value={`R$ ${totalCostReduction.toLocaleString('pt-BR')}`} hint='Soma de "Redução de custo"' />
          <StatCard icon="target" label="ROI" value={roi === '-' ? '-' : `${roi}x`} hint="Retorno ÷ investimento" />
          <StatCard icon="schedule" label="Horas economizadas" value={`${totalHoursSaved}h/mês`} hint="Estimativa operacional" />
        </div>
        <p className="mt-sm flex items-start gap-xs rounded-lg bg-tertiary-container p-sm text-body-sm text-on-tertiary-container">
          <Icon name="info" className="mt-0.5 shrink-0 text-[16px]" />
          Horas economizadas é uma estimativa de impacto operacional. Pode variar conforme uso, plano ou processo, não representa economia fixa garantida.
        </p>
      </ChartCard>

      <div className="grid gap-md md:grid-cols-2">
        <ChartCard title="Projetos por Setor">
          <DistributionBars slices={sectorDistribution.map((s) => ({ key: s.key, label: s.key, count: s.count }))} emptyMessage="Nenhum projeto ainda." />
        </ChartCard>
        <ChartCard title="Pessoas Inovando por Área">
          <DistributionBars slices={peopleBySector} emptyMessage="Nenhuma pessoa ainda." showShare={false} />
        </ChartCard>
      </div>

      <ChartCard title="Projetos por Fase">
        <DistributionBars
          slices={INOVA_PROJECT_PHASES.map((phase) => ({
            key: phase.value,
            label: phase.label,
            count: phaseBreakdown.find((p) => p.key === phase.value)?.count ?? 0,
          }))}
          emptyMessage="Nenhum projeto ainda."
          showShare={false}
        />
      </ChartCard>

      <ChartCard title="Tipos de Projetos em Andamento" subtitle={`${scopedProjects.length} ${scopedProjects.length === 1 ? 'projeto' : 'projetos'}`}>
        <InovaCategoryBreakdown groups={categoryGroups} showSector={filterSector === 'all'} emptyMessage="Nenhum projeto neste setor ainda." />
      </ChartCard>

      <div className="grid gap-md md:grid-cols-2">
        <ChartCard title="Economia financeira por Setor (R$)">
          <ValueBars items={sectorCost} formatValue={(v) => `R$ ${v.toLocaleString('pt-BR')}`} emptyMessage="Sem dados de economia ainda." />
        </ChartCard>
        <ChartCard title="Horas economizadas por Setor (estimativa)">
          <ValueBars items={sectorHours} formatValue={(v) => `${v}h`} emptyMessage="Sem dados de horas ainda." />
        </ChartCard>
      </div>

      <ChartCard title="Evolução ao Longo do Tempo">
        <InovaTimelineChart points={timeline} />
      </ChartCard>

      <InovaSectorOverview projects={scopedProjects} />

      <section className="flex flex-col gap-md" aria-labelledby="inova-pipeline-titulo">
        <div className="flex flex-wrap items-center gap-sm">
          <h2 id="inova-pipeline-titulo" className="mr-auto flex items-center gap-sm font-headline text-headline-md text-on-surface">
            <Icon name="trending_up" className="text-primary" />
            Pipeline de Inovação
          </h2>
          <button
            type="button"
            onClick={() => setShowPipelineFilters((v) => !v)}
            aria-expanded={showPipelineFilters}
            aria-controls="inova-pipeline-filtros"
            className={`inline-flex items-center gap-sm rounded-full border px-md py-1 font-label text-label-sm transition-colors ${
              showPipelineFilters ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/60 text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            <Icon name="filter_list" className="text-[16px]" />
            Filtros
          </button>
          {pipelineHasFilters && (
            <button
              type="button"
              onClick={clearPipelineFilters}
              className="inline-flex items-center gap-1 rounded-full px-md py-1 font-label text-label-sm text-on-surface-variant hover:bg-surface-container"
            >
              <Icon name="close" className="text-[16px]" />
              Limpar filtros
            </button>
          )}
        </div>

        {showPipelineFilters && (
          <div id="inova-pipeline-filtros" className="grid gap-sm rounded-xl border border-outline-variant/40 bg-surface-container p-md sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-sm text-on-surface-variant">Setor</span>
              <select aria-label="Setor do pipeline" value={filterSector} onChange={(e) => setFilterSector(e.target.value)} className={SELECT_CLASS}>
                <option value="all">Todos os setores</option>
                {availableSectors.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-sm text-on-surface-variant">Categoria</span>
              <select aria-label="Categoria do pipeline" value={pipelineCategory} onChange={(e) => setPipelineCategory(e.target.value)} className={SELECT_CLASS}>
                <option value="all">Todas as categorias</option>
                {[...new Set(projects.map((p) => p.category))].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-sm text-on-surface-variant">Fase</span>
              <select aria-label="Fase do pipeline" value={pipelinePhase} onChange={(e) => setPipelinePhase(e.target.value)} className={SELECT_CLASS}>
                <option value="all">Todas as fases</option>
                {INOVA_PROJECT_PHASES.filter((f) => PIPELINE_PHASES.has(f.value)).map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-sm text-on-surface-variant">Responsável</span>
              <select aria-label="Responsável do pipeline" value={pipelineResponsible} onChange={(e) => setPipelineResponsible(e.target.value)} className={SELECT_CLASS}>
                <option value="all">Todos os responsáveis</option>
                {responsibles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="grid gap-md md:grid-cols-3">
          {PIPELINE_COLUMNS.map((col) => {
            const colProjects = pipelineProjects.filter((p) => col.phases.includes(p.phase))
            return (
              <section key={col.key} aria-label={col.label} className="flex flex-col gap-sm rounded-xl border border-outline-variant/40 bg-surface-container p-md">
                <header className="flex items-center gap-sm">
                  <Icon name={col.icon} className="text-[18px] text-primary" />
                  <h3 className="font-label text-label-md font-semibold text-on-surface">{col.label}</h3>
                  <span className="ml-auto rounded-full bg-primary/15 px-sm py-0.5 font-mono text-label-sm text-primary">{colProjects.length}</span>
                </header>
                {colProjects.length === 0 ? (
                  <p className="py-lg text-center text-body-sm text-on-surface-variant">Nenhum projeto nesta categoria</p>
                ) : (
                  <ul className="flex max-h-[32rem] flex-col gap-sm overflow-y-auto">
                    {colProjects.map((p) => (
                      <li key={p.id}>
                        <PipelineCard project={p} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      </section>

      {scopedProjects.length === 0 && projects.length > 0 && (
        <EmptyState message="Nenhum projeto neste filtro." />
      )}
    </div>
  )
}

/** Card compacto do pipeline: o cartão inteiro abre o projeto. */
function PipelineCard({ project }: { project: InovaProjectDTO }) {
  const responsaveis = [project.responsible1, project.responsible2]
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => r.name)
    .join(', ')
  return (
    <Link
      to={`/comunidade-inova/projetos/${project.id}`}
      className="block rounded-xl border border-outline-variant/40 bg-surface p-sm transition-shadow hover:border-primary/40 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    >
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-sm py-0.5 font-label text-label-sm text-on-surface">
        {inovaCategoryIcon(project.category)} {project.category}
      </span>
      <p className="mt-xs line-clamp-2 font-label text-label-md font-semibold text-on-surface">{project.title}</p>
      <p className="mt-xs flex items-center gap-1 text-body-sm text-on-surface-variant">
        <Icon name="apartment" className="text-[14px]" />
        {project.sector}
      </p>
      {responsaveis && (
        <p className="mt-1 flex items-center gap-1 truncate text-body-sm text-on-surface-variant">
          <Icon name="person" className="text-[14px]" />
          {responsaveis}
        </p>
      )}
      <span className="mt-xs inline-flex items-center gap-1.5 rounded-full border border-outline-variant/60 bg-surface-container px-sm py-0.5 font-label text-[10px] font-semibold text-on-surface-variant">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
        {phaseLabel(project.phase)}
      </span>
    </Link>
  )
}
