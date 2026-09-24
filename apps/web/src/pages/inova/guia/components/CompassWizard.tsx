import { useMemo, useState } from 'react'
import { Icon } from '../../../../components/Icon'
import { trackEvent } from '../../../../lib/analytics'
import { GOLDEN_RULE, paths } from '../content/library'
import { promptById } from '../content/prompts'
import { situations } from '../content/situations'
import type { PathId, Situation } from '../content/types'
import { cx } from '../lib/cx'
import { CopyPromptButton } from './CopyPromptButton'
import { HelpfulFeedback } from './HelpfulFeedback'
import { PathBadge } from './PathBadge'

type PeopleAnswer = 'decide' | 'impacta' | 'nao'
type ImpactAnswer = 'alto' | 'medio' | 'baixo'
type ReviewAnswer = 'sim' | 'nao'

const QUESTIONS = {
  people: {
    title: 'Essa situação envolve pessoas?',
    help: 'Pense em quem sente o resultado: um colega, um aluno, o seu time.',
    options: [
      { id: 'decide' as const, label: 'Sim, decide algo sobre alguém', detail: 'Feedback, avaliação, promoção, mérito, desligamento, conflito.' },
      { id: 'impacta' as const, label: 'Em parte, afeta pessoas indiretamente', detail: 'Comunicação, processo do time, mudança de rotina, atendimento.' },
      { id: 'nao' as const, label: 'Não, é sobre conteúdo, dados ou organização', detail: 'Textos, planilhas, pesquisa, estruturação, estudo.' },
    ],
  },
  impact: {
    title: 'Qual o impacto se sair errado?',
    help: 'Sem drama e sem minimizar: qual o tamanho real do estrago?',
    options: [
      { id: 'alto' as const, label: 'Alto', detail: 'Afeta carreira, relação, imagem institucional, dinheiro ou risco legal.' },
      { id: 'medio' as const, label: 'Médio', detail: 'Gera retrabalho, ruído ou uma decisão que precisaria ser revista.' },
      { id: 'baixo' as const, label: 'Baixo', detail: 'Dá para corrigir rápido, sem consequências relevantes.' },
    ],
  },
  review: {
    title: 'O resultado passa pela sua revisão antes de ir adiante?',
    help: 'Você lê, ajusta e assume a entrega, ou ela sai direto?',
    options: [
      { id: 'sim' as const, label: 'Sim, eu reviso e assino', detail: 'Você é a última pessoa antes da entrega.' },
      { id: 'nao' as const, label: 'Não tenho como validar sozinho', detail: 'Falta contexto, dado ou autoridade para confirmar.' },
    ],
  },
}

export function decideCompassPath(people: PeopleAnswer, impact: ImpactAnswer, review: ReviewAnswer): PathId {
  if (people === 'decide') return 'pessoa'
  if (impact === 'alto') return review === 'sim' && people === 'nao' ? 'ia-pessoa' : 'pessoa'
  if (people === 'impacta') return 'ia-pessoa'
  if (impact === 'medio') return 'ia-pessoa'
  return review === 'sim' ? 'ia' : 'ia-pessoa'
}

export function CompassWizard() {
  const [step, setStep] = useState(0)
  const [people, setPeople] = useState<PeopleAnswer | null>(null)
  const [impact, setImpact] = useState<ImpactAnswer | null>(null)
  const [review, setReview] = useState<ReviewAnswer | null>(null)
  const [result, setResult] = useState<PathId | null>(null)

  const related: Situation[] = useMemo(() => {
    if (!result) return []
    return situations.filter((s) => s.path === result).slice(0, 3)
  }, [result])

  function reset() {
    setStep(0)
    setPeople(null)
    setImpact(null)
    setReview(null)
    setResult(null)
  }

  function goResult(p: PeopleAnswer, i: ImpactAnswer, r: ReviewAnswer) {
    const path = decideCompassPath(p, i, r)
    trackEvent('inova_guia_bussola_completada', { caminho: path })
    setResult(path)
    setStep(3)
  }

  if (step === 3 && result) {
    const info = paths[result]
    const firstPrompt = related[0]?.promptIds?.[0] ? promptById(related[0].promptIds[0]) : undefined
    return (
      <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <PathBadge path={result} />
        <h3 className="mt-md font-headline text-headline-sm text-on-surface">{info.message}</h3>
        <p className="mt-sm text-body-md text-on-surface-variant">{info.when}</p>
        <p className="mt-md rounded-xl border-l-4 border-primary bg-surface p-md text-body-sm text-on-surface-variant">
          <strong className="font-bold text-on-surface">Regra de ouro. </strong>
          {GOLDEN_RULE}
        </p>

        {related.length > 0 ? (
          <ul className="mt-lg grid gap-md sm:grid-cols-3">
            {related.map((s) => (
              <li key={s.id} className="rounded-xl border border-outline-variant/40 bg-surface p-md">
                <PathBadge path={s.path} />
                <p className="mt-sm font-label text-label-md font-bold text-on-surface">{s.title}</p>
                <p className="mt-xs line-clamp-2 text-body-sm text-on-surface-variant">{s.summary}</p>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-lg flex flex-wrap items-center gap-sm">
          {firstPrompt ? <CopyPromptButton text={firstPrompt.text} promptId={firstPrompt.id} label="Copiar prompt sugerido" /> : null}
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center gap-xs rounded-full border border-outline-variant/60 px-lg font-label text-label-md text-primary hover:border-primary/60"
          >
            <Icon name="restart_alt" className="text-[18px]" /> Testar outra situação
          </button>
        </div>

        <div className="mt-lg">
          <HelpfulFeedback contentId={`compass-${result}`} contentType="bussola" />
        </div>
      </div>
    )
  }

  const [key, setter] = step === 0 ? (['people', setPeople] as const) : step === 1 ? (['impact', setImpact] as const) : (['review', setReview] as const)
  const question = QUESTIONS[key]
  const value = key === 'people' ? people : key === 'impact' ? impact : review

  return (
    <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
      <h3 className="font-headline text-headline-sm text-on-surface">{question.title}</h3>
      <p className="mt-sm text-body-md text-on-surface-variant">{question.help}</p>
      <div className="mt-lg grid gap-sm">
        {question.options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => {
              // @ts-expect-error -- id pertence ao domínio do setter correspondente
              setter(opt.id)
              if (key === 'people') setStep(1)
              else if (key === 'impact') setStep(2)
              else if (people && impact) goResult(people, impact, opt.id as ReviewAnswer)
            }}
            className={cx(
              'rounded-xl border p-md text-left transition-colors',
              value === opt.id ? 'border-primary bg-surface' : 'border-outline-variant/40 bg-surface hover:border-primary/60',
            )}
          >
            <span className="block font-label text-label-md font-bold text-on-surface">{opt.label}</span>
            <span className="mt-1 block text-body-sm text-on-surface-variant">{opt.detail}</span>
          </button>
        ))}
      </div>
      {step > 0 ? (
        <button
          type="button"
          onClick={() => setStep((s) => s - 1)}
          className="mt-lg inline-flex items-center gap-xs text-body-sm text-on-surface-variant hover:text-primary"
        >
          <Icon name="arrow_back" className="text-[18px]" /> Voltar
        </button>
      ) : null}
    </div>
  )
}
