import { useMemo, useState } from 'react'
import { Icon } from '../../../../components/Icon'
import { Chip } from '../components/Chip'
import { CopyPromptButton } from '../components/CopyPromptButton'
import { SectionHeading } from '../components/SectionHeading'
import {
  areas,
  behaviorQuiz,
  behaviorsDo,
  behaviorsDont,
  cycleSteps,
  deliveryChecklist,
  exercises,
  weeklyChallenge,
  weeklyDiscovery,
} from '../content/library'
import { promptById } from '../content/prompts'
import { cx } from '../lib/cx'
import { useGuiaLocalState } from '../lib/useGuiaLocalState'

type Tab = 'ciclo' | 'comportamentos' | 'exercicios' | 'areas'

const TABS: { id: Tab; label: string }[] = [
  { id: 'ciclo', label: 'Ciclo AI First' },
  { id: 'comportamentos', label: 'Comportamentos' },
  { id: 'exercicios', label: 'Exercícios' },
  { id: 'areas', label: 'Por área' },
]

export function NaPraticaSections() {
  const [tab, setTab] = useState<Tab>('ciclo')
  const challengePrompt = promptById(weeklyChallenge.promptId)
  const discoveryPrompt = promptById(weeklyDiscovery.promptId)

  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="AI First na prática"
        title="Do princípio ao hábito"
        description="Aqui a cultura vira rotina: um ciclo para seguir, comportamentos para reconhecer, exercícios curtos para praticar."
      />

      <div className="grid gap-md lg:grid-cols-2">
        <article className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
          <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">{weeklyChallenge.title}</p>
          <h3 className="mt-sm font-headline text-headline-sm text-on-surface">{weeklyChallenge.text}</h3>
          <p className="mt-sm text-body-md text-on-surface-variant">{weeklyChallenge.instruction}</p>
          {challengePrompt ? (
            <div className="mt-md">
              <CopyPromptButton text={challengePrompt.text} promptId={challengePrompt.id} label="Copiar prompt do desafio" />
            </div>
          ) : null}
        </article>

        <article className="rounded-2xl bg-primary p-lg text-on-primary">
          <p className="font-label text-label-md font-bold uppercase tracking-wide">{weeklyDiscovery.title}</p>
          <h3 className="mt-sm font-headline text-headline-sm">{weeklyDiscovery.highlight}</h3>
          <p className="mt-sm text-body-sm">{weeklyDiscovery.text}</p>
          {discoveryPrompt ? (
            <div className="mt-md">
              <CopyPromptButton text={discoveryPrompt.text} promptId={discoveryPrompt.id} label="Copiar prompt do crítico" />
            </div>
          ) : null}
        </article>
      </div>

      <div>
        <div className="flex flex-wrap gap-xs">
          {TABS.map((t) => (
            <Chip key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </Chip>
          ))}
        </div>
        <div className="mt-lg">
          {tab === 'ciclo' && <CycleTab />}
          {tab === 'comportamentos' && <BehaviorsTab />}
          {tab === 'exercicios' && <ExercisesTab />}
          {tab === 'areas' && <AreasTab />}
        </div>
      </div>
    </div>
  )
}

function CycleTab() {
  const [checked, setChecked] = useGuiaLocalState<string[]>('checklist-entrega', [])

  return (
    <div className="grid gap-lg lg:grid-cols-[1.15fr_1fr]">
      <ol className="space-y-sm">
        {cycleSteps.map((step) => (
          <li key={step.n} className="flex gap-md rounded-xl border border-outline-variant/40 bg-surface-container-low p-md">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">{step.n}</span>
            <div>
              <p className="font-label text-label-md font-bold text-on-surface">{step.title}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <aside className="h-fit rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">Checklist antes de entregar</p>
        <p className="mt-1 text-body-sm text-on-surface-variant">Fica salvo só no seu navegador.</p>
        <ul className="mt-md space-y-xs">
          {deliveryChecklist.map((item) => {
            const isChecked = checked.includes(item)
            return (
              <li key={item}>
                <button
                  type="button"
                  onClick={() => setChecked((prev) => (prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]))}
                  aria-pressed={isChecked}
                  className={cx(
                    'flex w-full items-start gap-sm rounded-xl border p-sm text-left text-body-sm',
                    isChecked ? 'border-primary bg-surface text-on-surface' : 'border-outline-variant/40 bg-surface text-on-surface-variant',
                  )}
                >
                  <Icon name="check_circle" filled={isChecked} className="mt-0.5 shrink-0 text-[18px]" />
                  <span>{item}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>
    </div>
  )
}

function BehaviorsTab() {
  const [answers, setAnswers] = useState<Record<string, boolean>>({})

  return (
    <div className="flex flex-col gap-2xl">
      <div className="grid gap-md lg:grid-cols-2">
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
          <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">Comportamentos que fazem a diferença</p>
          <ul className="mt-md space-y-sm">
            {behaviorsDo.map((b) => (
              <li key={b} className="flex gap-sm text-body-sm text-on-surface-variant">
                <Icon name="check_circle" className="mt-0.5 shrink-0 text-[18px] text-primary" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
          <p className="font-label text-label-md font-bold uppercase tracking-wide text-error">O que não é AI First</p>
          <ul className="mt-md space-y-sm">
            {behaviorsDont.map((b) => (
              <li key={b} className="flex gap-sm text-body-sm text-on-surface-variant">
                <Icon name="cancel" className="mt-0.5 shrink-0 text-[18px] text-error" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <SectionHeading eyebrow="Isso é AI First?" title="Seis cenários para calibrar o olhar" description="Responda e veja a explicação." />
        <ul className="mt-lg grid gap-md lg:grid-cols-2">
          {behaviorQuiz.map((q) => {
            const answered = q.id in answers
            const correct = answers[q.id] === q.isAiFirst
            return (
              <li key={q.id} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <p className="text-body-sm text-on-surface">{q.scenario}</p>
                {!answered ? (
                  <div className="mt-md flex gap-sm">
                    <button type="button" onClick={() => setAnswers((a) => ({ ...a, [q.id]: true }))} className="min-h-9 rounded-full border border-outline-variant/60 px-md text-label-sm hover:border-primary/60">
                      É AI First
                    </button>
                    <button type="button" onClick={() => setAnswers((a) => ({ ...a, [q.id]: false }))} className="min-h-9 rounded-full border border-outline-variant/60 px-md text-label-sm hover:border-primary/60">
                      Não é
                    </button>
                  </div>
                ) : (
                  <div
                    className={cx(
                      'mt-md rounded-xl border-l-4 p-sm text-body-sm',
                      correct
                        ? 'border-primary bg-primary-container text-on-primary-container'
                        : 'border-error bg-error-container text-on-error-container',
                    )}
                  >
                    <strong className="font-bold">{correct ? 'Isso mesmo. ' : 'Quase lá. '}</strong>
                    {q.explanation}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function ExercisesTab() {
  const [done, setDone] = useGuiaLocalState<string[]>('exercicios-feitos', [])

  return (
    <ul className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
      {exercises.map((ex) => {
        const complete = done.includes(ex.id)
        return (
          <li key={ex.id}>
            <article className={cx('flex h-full flex-col rounded-2xl border bg-surface-container-low p-lg', complete ? 'border-primary' : 'border-outline-variant/40')}>
              <span className="inline-flex items-center gap-xs text-body-sm text-on-surface-variant">
                <Icon name="schedule" className="text-[16px]" /> {ex.minutes} min
              </span>
              <h3 className="mt-sm font-headline text-headline-sm text-on-surface">{ex.title}</h3>
              <p className="mt-sm flex-1 text-body-sm text-on-surface-variant">{ex.description}</p>
              <button
                type="button"
                onClick={() => setDone((prev) => (complete ? prev.filter((x) => x !== ex.id) : [...prev, ex.id]))}
                className={cx(
                  'mt-md inline-flex min-h-9 items-center justify-center gap-xs rounded-full border px-md text-label-sm',
                  complete ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/60 text-on-surface-variant hover:border-primary/60',
                )}
              >
                <Icon name="check_circle" className="text-[16px]" /> {complete ? 'Feito' : 'Marcar como feito'}
              </button>
            </article>
          </li>
        )
      })}
    </ul>
  )
}

function AreasTab() {
  const [selected, setSelected] = useState(areas[0]!.id)
  const area = useMemo(() => areas.find((a) => a.id === selected) ?? areas[0]!, [selected])

  return (
    <div className="grid gap-lg lg:grid-cols-[260px_1fr]">
      <ul className="flex gap-xs overflow-x-auto lg:flex-col">
        {areas.map((a) => (
          <li key={a.id} className="shrink-0">
            <button
              type="button"
              onClick={() => setSelected(a.id)}
              className={cx(
                'w-full whitespace-nowrap rounded-full border px-md py-sm text-left text-label-sm lg:whitespace-normal lg:rounded-xl',
                a.id === selected ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant/60 bg-surface text-on-surface-variant hover:border-primary/60',
              )}
            >
              {a.name}
            </button>
          </li>
        ))}
      </ul>

      <article className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <h3 className="font-headline text-headline-sm text-on-surface">{area.name}</h3>
        <p className="mt-sm text-body-md text-on-surface-variant">{area.help}</p>
        <div className="mt-md grid gap-md sm:grid-cols-2">
          <div className="rounded-xl border border-outline-variant/40 bg-surface p-md">
            <p className="font-label text-label-sm font-bold uppercase tracking-wide text-primary">Exemplos de uso</p>
            <p className="mt-1 text-body-sm text-on-surface-variant">{area.examples}</p>
          </div>
          <div className="rounded-xl border border-outline-variant/40 bg-surface p-md">
            <p className="font-label text-label-sm font-bold uppercase tracking-wide text-error">O que continua humano</p>
            <p className="mt-1 text-body-sm text-on-surface-variant">{area.human}</p>
          </div>
        </div>
      </article>
    </div>
  )
}

export function InovaGuiaNaPraticaPage() {
  return <NaPraticaSections />
}
