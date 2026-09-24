import { useMemo, useState } from 'react'
import { INOVA_PHASE_POINTS, inovaSectorKey, type InovaProjectDTO, type InovaProjectPhase } from '@legends/shared'
import { Icon } from '../Icon'
import { EmptyState } from '../analytics/AnalyticsPrimitives'

type Tag = 'IA' | 'Automação' | 'Dados' | 'Produtividade' | 'Outros'

const CATEGORY_TO_TAG: Record<string, Tag> = {
  'Automação de processos': 'Automação',
  'Experiência do cliente': 'IA',
  'Análise de dados': 'Dados',
  'Marketing / conteúdo': 'IA',
  'Educação / ensino': 'IA',
  'Produtividade interna': 'Produtividade',
  Outro: 'Outros',
}

const TAG_STYLES: Record<Tag, string> = {
  IA: 'bg-primary/15 text-primary border-primary/30',
  Automação: 'bg-tertiary/15 text-tertiary border-tertiary/30',
  Dados: 'bg-secondary/15 text-secondary border-secondary/30',
  Produtividade: 'bg-secondary-container text-on-secondary-container border-transparent',
  Outros: 'bg-surface-container text-on-surface-variant border-outline-variant/40',
}

/** "Mistos" = setor com projetos de dois ou mais tipos — o filtro do original. */
type TagFilter = 'all' | Tag | 'Mistos'

type SortKey = 'count' | 'recent' | 'active'

/**
 * Fases que entram no overview: Testando, Rotina e Expandindo, como no
 * original. Concluído fica de fora — o overview é do que está em curso, e o
 * `INOVA_PHASE_POINTS >= 3` de antes contava o encerrado junto.
 */
const ADVANCED_PHASES = new Set<InovaProjectPhase>(['TESTING_SOLUTION', 'ROUTINE_USE', 'EXPANDING'])

/**
 * Ícone e resumo curados dos setores do INOVA original, casados por
 * `inovaSectorKey` — o cadastro escreve "Gente e Gestão", os projetos
 * importados "Gente & Gestão". Setor fora da lista (o cadastro é da empresa,
 * não um enum fixo) cai no ícone e no texto genéricos.
 */
const SECTOR_PROFILES: Record<string, { icon: string; summary: string }> = {
  [inovaSectorKey('Desenvolvimento de Produto')]: {
    icon: 'code',
    summary: 'Soluções inteligentes que aceleram o ciclo de produto, automatizam tarefas técnicas e apoiam decisões com IA.',
  },
  [inovaSectorKey('Estratégia e Finanças')]: {
    icon: 'trending_up',
    summary: 'Análises orientadas por dados e automações que aumentam a previsibilidade financeira e estratégica.',
  },
  [inovaSectorKey('Marketing')]: {
    icon: 'campaign',
    summary: 'Uso de IA para conteúdo, automação de campanhas e análise de métricas com ganho de escala.',
  },
  [inovaSectorKey('Ensino')]: {
    icon: 'school',
    summary: 'Iniciativas que personalizam a jornada de aprendizagem e ampliam o impacto educacional com IA.',
  },
  [inovaSectorKey('Comercial')]: {
    icon: 'work',
    summary: 'Automações comerciais e inteligência de vendas para acelerar conversão e fortalecer relacionamento.',
  },
  [inovaSectorKey('B2B')]: {
    icon: 'domain',
    summary: 'Soluções inteligentes voltadas a parceiros e clientes corporativos, com foco em escala e eficiência.',
  },
  [inovaSectorKey('CX')]: {
    icon: 'handshake',
    summary: 'Experiência do cliente potencializada por IA: atendimento mais rápido, empático e resolutivo.',
  },
  [inovaSectorKey('Gente & Gestão')]: {
    icon: 'groups',
    summary: 'Desenvolvimento humano, comunicação interna e automações de processos administrativos.',
  },
}

function sectorProfileOf(sector: string): { icon: string; summary: string } {
  return (
    SECTOR_PROFILES[inovaSectorKey(sector)] ?? {
      icon: 'auto_awesome',
      summary: `Iniciativas conduzidas pela área de ${sector}.`,
    }
  )
}

/** Overview executivo por setor — só projetos nas fases de `ADVANCED_PHASES`. */
export function InovaSectorOverview({ projects }: { projects: InovaProjectDTO[] }) {
  const [search, setSearch] = useState('')
  const [filterTag, setFilterTag] = useState<TagFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('count')

  const advanced = useMemo(() => projects.filter((p) => ADVANCED_PHASES.has(p.phase)), [projects])

  const sectorData = useMemo(() => {
    const bySector = new Map<string, InovaProjectDTO[]>()
    advanced.forEach((p) => {
      if (!bySector.has(p.sector)) bySector.set(p.sector, [])
      bySector.get(p.sector)!.push(p)
    })
    return [...bySector.entries()].map(([sector, items]) => {
      const tags = [...new Set(items.map((p) => CATEGORY_TO_TAG[p.category] ?? 'Outros'))]
      const lastUpdate = items.reduce((max, p) => Math.max(max, new Date(p.updatedAt).getTime()), 0)
      const activity = items.reduce((s, p) => s + INOVA_PHASE_POINTS[p.phase], 0)
      const totalCost = items.reduce((s, p) => s + (p.costReduction ?? 0), 0)
      const totalHours = items.reduce((s, p) => s + (p.hoursSaved ?? 0), 0)
      const highlights = items
        .filter((p) => (p.results && p.results.trim()) || (p.otherMetrics && p.otherMetrics.trim()))
        .map((p) => ({ title: p.title, text: (p.results || p.otherMetrics || '').trim() }))
        .slice(0, 3)
      return { sector, count: items.length, tags, lastUpdate, activity, totalCost, totalHours, highlights }
    })
  }, [advanced])

  const filtered = useMemo(() => {
    let list = sectorData.filter((s) => s.sector.toLowerCase().includes(search.toLowerCase()))
    if (filterTag === 'Mistos') list = list.filter((s) => s.tags.length >= 2)
    else if (filterTag !== 'all') list = list.filter((s) => s.tags.includes(filterTag))
    if (sortKey === 'count') list = [...list].sort((a, b) => b.count - a.count)
    else if (sortKey === 'recent') list = [...list].sort((a, b) => b.lastUpdate - a.lastUpdate)
    else list = [...list].sort((a, b) => b.activity - a.activity)
    return list
  }, [sectorData, search, filterTag, sortKey])

  const maxActivity = Math.max(1, ...sectorData.map((s) => s.activity))

  return (
    <section className="flex flex-col gap-md">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <div className="flex items-center gap-sm">
          <Icon name="grid_view" className="text-primary" />
          <h2 className="font-headline text-headline-md text-on-surface">Overview por Setor</h2>
          <span className="text-body-sm text-on-surface-variant">· fases avançadas (Testando, Em uso e Expandindo)</span>
        </div>
        <div className="flex flex-wrap items-center gap-sm">
          <input
            placeholder="Buscar setor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-full border border-outline-variant/60 bg-surface px-md py-xs text-body-sm text-on-surface"
          />
          <select
            aria-label="Tipo"
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value as TagFilter)}
            className="rounded-full border border-outline-variant/60 bg-surface px-md py-xs text-body-sm text-on-surface"
          >
            <option value="all">Todos os tipos</option>
            <option value="IA">IA</option>
            <option value="Automação">Automação</option>
            <option value="Dados">Dados</option>
            <option value="Produtividade">Produtividade</option>
            <option value="Outros">Outros</option>
            <option value="Mistos">Mistos</option>
          </select>
          <select
            aria-label="Ordenar"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-full border border-outline-variant/60 bg-surface px-md py-xs text-body-sm text-on-surface"
          >
            <option value="count">Maior nº de projetos</option>
            <option value="recent">Mais recentes</option>
            <option value="active">Mais ativos</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="Nenhum setor encontrado com esses filtros." />
      ) : (
        <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => {
            const activityPct = Math.round((s.activity / maxActivity) * 100)
            const profile = sectorProfileOf(s.sector)
            return (
              <div key={s.sector} className="rounded-2xl border border-outline-variant/40 bg-surface-container p-md">
                <div className="mb-sm flex items-start justify-between">
                  <div className="flex items-center gap-sm">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                      <Icon name={profile.icon} className="text-primary" />
                    </div>
                    <div>
                      <h3 className="font-label text-label-md font-bold text-on-surface">{s.sector}</h3>
                      <p className="font-mono text-body-sm text-on-surface-variant">
                        {s.count} {s.count === 1 ? 'projeto' : 'projetos'}
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-headline-sm font-black text-on-surface">{s.count}</span>
                </div>

                <div className="mb-sm flex flex-wrap gap-xs">
                  {s.tags.map((t) => (
                    <span key={t} className={`rounded-full border px-sm py-0.5 text-[10px] font-bold ${TAG_STYLES[t]}`}>
                      {t}
                    </span>
                  ))}
                </div>

                <p className="mb-sm text-body-sm text-on-surface-variant">{profile.summary}</p>

                {(s.totalCost > 0 || s.totalHours > 0 || s.highlights.length > 0) && (
                  <div className="mb-sm rounded-xl border border-outline-variant/40 bg-surface-container-low p-sm">
                    {(s.totalCost > 0 || s.totalHours > 0) && (
                      <div className="grid grid-cols-2 gap-sm">
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-on-surface-variant">Economia</p>
                          <p className="font-mono text-body-sm font-bold text-on-surface">R$ {s.totalCost.toLocaleString('pt-BR')}</p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-on-surface-variant">Horas/mês</p>
                          <p className="font-mono text-body-sm font-bold text-on-surface">{s.totalHours}h</p>
                        </div>
                      </div>
                    )}
                    {s.highlights.length > 0 && (
                      <ul className="mt-sm space-y-1 border-t border-outline-variant/30 pt-sm">
                        {s.highlights.map((h) => (
                          <li key={h.title} className="text-body-sm text-on-surface">
                            <span className="font-semibold">{h.title}:</span> <span className="text-on-surface-variant">{h.text}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div>
                  <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-on-surface-variant">
                    <span>Atividade</span>
                    <span className="font-mono text-primary">{activityPct}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${activityPct}%` }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
