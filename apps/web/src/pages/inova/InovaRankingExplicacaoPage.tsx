import { INOVA_PHASE_DESCRIPTIONS, INOVA_PHASE_POINTS, INOVA_PROJECT_PHASES, type InovaProjectPhase } from '@legends/shared'
import { Icon } from '../../components/Icon'

const EXEMPLO = [
  { nome: 'Projeto A', fase: 'TESTING_SOLUTION' as const },
  { nome: 'Projeto B', fase: 'ROUTINE_USE' as const },
  { nome: 'Projeto C', fase: 'IDEA' as const },
]

const PHASE_EMOJI: Record<InovaProjectPhase, string> = {
  IDEA: '💡',
  EXPLORING_SOLUTION: '🔎',
  TESTING_SOLUTION: '🧪',
  ROUTINE_USE: '⚙️',
  EXPANDING: '🚀',
  COMPLETED: '✅',
}

const CRITERIOS = [
  { titulo: 'Progresso consistente', texto: 'Projetos que avançam de fase demonstram execução real e comprometimento.' },
  { titulo: 'Protagonismo das áreas', texto: 'Quanto mais projetos ativos, mais a área está agindo como dona da inovação.' },
  { titulo: 'Execução com qualidade', texto: 'Cada avanço reflete método, aprendizado e entrega com excelência.' },
  { titulo: 'Impacto coletivo', texto: 'Todos os projetos somam para o resultado do setor, porque crescemos juntos.' },
]

/**
 * Explica a fórmula do painel "Evolução das Áreas" (kanban de Projetos) — link
 * de "Como funciona?", não uma aba da navegação principal, igual ao original
 * (`RankingExplicacaoPage.tsx`, rota solta `/ranking`).
 */
export function InovaRankingExplicacaoPage() {
  const exemploTotal = EXEMPLO.reduce((s, p) => s + INOVA_PHASE_POINTS[p.fase], 0)

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h1 className="font-headline text-headline-lg text-on-surface">Evolução das Áreas</h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Entenda como medimos o impacto e reconhecemos quem constrói com consistência
        </p>
      </header>

      <section className="rounded-2xl border border-outline-variant/40 bg-surface-container p-lg">
        <div className="flex items-center gap-sm">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
            <Icon name="help" className="text-primary" />
          </div>
          <h2 className="font-headline text-headline-sm text-on-surface">Como funciona?</h2>
        </div>
        <div className="mt-md flex flex-col gap-sm text-body-md text-on-surface-variant">
          <p>
            A evolução de cada área é medida pelo <span className="font-semibold text-primary">progresso real dos projetos</span>,
            porque resultado se constrói com método, constância e colaboração.
          </p>
          <p>
            A pontuação do setor é a <span className="font-semibold text-primary">soma dos pontos de todos os seus projetos</span>,
            refletindo o compromisso coletivo com a inovação.
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-outline-variant/40 bg-surface-container p-lg">
        <div className="flex items-center gap-sm">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
            <Icon name="star" className="text-primary" />
          </div>
          <h2 className="font-headline text-headline-sm text-on-surface">Pontuação por Fase</h2>
        </div>
        <ul className="mt-md flex flex-col gap-sm">
          {INOVA_PROJECT_PHASES.map((phase) => (
            <li key={phase.value} className="flex items-center gap-md rounded-xl bg-surface-container-low p-sm">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-label-lg">
                {PHASE_EMOJI[phase.value]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-label text-label-md font-semibold text-on-surface">{phase.label}</p>
                <p className="text-body-sm text-on-surface-variant">{INOVA_PHASE_DESCRIPTIONS[phase.value]}</p>
              </div>
              <div className="shrink-0 text-right">
                <span className="font-mono text-headline-sm font-bold text-primary">{INOVA_PHASE_POINTS[phase.value]}</span>
                <span className="ml-1 text-body-sm text-on-surface-variant">{INOVA_PHASE_POINTS[phase.value] > 1 ? 'pts' : 'pt'}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-outline-variant/40 bg-surface-container p-lg">
        <div className="flex items-center gap-sm">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
            <Icon name="emoji_events" className="text-primary" />
          </div>
          <h2 className="font-headline text-headline-sm text-on-surface">Exemplo na prática</h2>
        </div>
        <div className="mt-md rounded-xl bg-surface-container-low p-md">
          <p className="text-body-sm text-on-surface-variant">
            Imagine que o setor <span className="font-semibold text-on-surface">Marketing</span> tem 3 projetos em andamento:
          </p>
          <ul className="mt-sm flex flex-col gap-1">
            {EXEMPLO.map((p) => {
              const phase = INOVA_PROJECT_PHASES.find((f) => f.value === p.fase)!
              const pontos = INOVA_PHASE_POINTS[p.fase]
              return (
                <li key={p.nome} className="flex items-center gap-1 text-body-sm text-on-surface-variant">
                  <Icon name="arrow_right_alt" className="text-[16px] text-primary" />
                  {p.nome}, {phase.label} = <span className="font-bold text-primary">{pontos} {pontos > 1 ? 'pts' : 'pt'}</span>
                </li>
              )
            })}
          </ul>
          <p className="mt-sm border-t border-outline-variant/40 pt-sm font-label text-label-md font-semibold text-on-surface">
            Impacto total do Marketing: <span className="font-mono text-headline-sm font-bold text-primary">{exemploTotal} pontos</span>
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-outline-variant/40 bg-surface-container p-lg">
        <h2 className="font-headline text-headline-sm text-on-surface">O que valorizamos</h2>
        <div className="mt-md grid gap-sm md:grid-cols-2">
          {CRITERIOS.map((c) => (
            <div key={c.titulo} className="rounded-xl bg-surface-container-low p-sm">
              <p className="font-label text-label-md font-semibold text-on-surface">{c.titulo}</p>
              <p className="text-body-sm text-on-surface-variant">{c.texto}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
