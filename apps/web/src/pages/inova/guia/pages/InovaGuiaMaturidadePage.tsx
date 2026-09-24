import { Link } from 'react-router-dom'
import { Icon } from '../../../../components/Icon'
import { trackEvent } from '../../../../lib/analytics'
import { SectionHeading } from '../components/SectionHeading'
import { StatBar } from '../components/StatBar'
import { exerciseById, maturityLevels, maturityQuestions, maturityScale } from '../content/library'
import { cx } from '../lib/cx'
import { useGuiaLocalState } from '../lib/useGuiaLocalState'

export function levelFromScore(score: number) {
  const pct = (score / (maturityQuestions.length * 5)) * 100
  if (pct < 32) return 1
  if (pct < 50) return 2
  if (pct < 68) return 3
  if (pct < 86) return 4
  return 5
}

export function InovaGuiaMaturidadePage() {
  const [answers, setAnswers] = useGuiaLocalState<Record<string, number>>('maturidade', {})
  const answered = Object.keys(answers).length
  const complete = answered === maturityQuestions.length
  const score = Object.values(answers).reduce((a, b) => a + b, 0)
  const level = complete ? levelFromScore(score) : null
  const levelInfo = level ? maturityLevels.find((l) => l.level === level)! : null
  const exercise = levelInfo?.exerciseId ? exerciseById(levelInfo.exerciseId) : undefined

  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Autodiagnóstico"
        title="Qual é o seu momento AI First?"
        description="Dez perguntas, resposta honesta. Não existe nota, ranking nem envio para gestores — a resposta fica só neste navegador."
      />

      <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <StatBar value={(answered / maturityQuestions.length) * 100} label={`${answered} de ${maturityQuestions.length} respondidas`} />

        <ol className="mt-lg space-y-md">
          {maturityQuestions.map((q, i) => (
            <li key={q}>
              <p className="text-body-md text-on-surface">
                <span className="mr-sm text-on-surface-variant">{i + 1}.</span>
                {q}
              </p>
              <div className="mt-sm flex flex-wrap gap-xs">
                {maturityScale.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      const next = { ...answers, [`q${i}`]: opt.value }
                      const wasComplete = Object.keys(answers).length === maturityQuestions.length
                      setAnswers(next)
                      if (!wasComplete && Object.keys(next).length === maturityQuestions.length) {
                        trackEvent('inova_guia_maturidade_respondida', {
                          nivel: levelFromScore(Object.values(next).reduce((a, b) => a + b, 0)),
                        })
                      }
                    }}
                    className={cx(
                      'min-h-9 rounded-full border px-md text-label-sm',
                      answers[`q${i}`] === opt.value ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant/60 bg-surface text-on-surface-variant hover:border-primary/60',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ol>

        {complete && levelInfo ? (
          <div className="mt-2xl rounded-2xl border border-outline-variant/40 bg-surface p-lg">
            <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">Seu momento</p>
            <h3 className="mt-sm font-headline text-headline-md text-on-surface">
              Nível {levelInfo.level} · {levelInfo.name}
            </h3>
            <p className="mt-sm text-body-md text-on-surface-variant">{levelInfo.description}</p>
            <div className="mt-lg grid gap-md sm:grid-cols-2">
              <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-md">
                <p className="font-label text-label-sm font-bold uppercase tracking-wide text-on-surface-variant">Sua força</p>
                <p className="mt-1 text-body-sm text-on-surface">{levelInfo.strengths}</p>
              </div>
              <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-md">
                <p className="font-label text-label-sm font-bold uppercase tracking-wide text-on-surface-variant">Próximo passo</p>
                <p className="mt-1 text-body-sm text-on-surface">{levelInfo.nextStep}</p>
              </div>
            </div>
            <ul className="mt-lg space-y-xs">
              {levelInfo.actions.map((a) => (
                <li key={a} className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-sm text-body-sm text-on-surface-variant">
                  {a}
                </li>
              ))}
            </ul>
            {exercise ? (
              <p className="mt-lg text-body-sm text-on-surface-variant">
                <strong className="font-bold text-on-surface">Exercício sugerido. </strong>
                {exercise.title}, {exercise.description}
              </p>
            ) : null}
            <div className="mt-lg flex flex-wrap gap-sm">
              <Link
                to="/comunidade-inova/guia/na-pratica"
                className="inline-flex min-h-11 items-center gap-xs rounded-full bg-primary px-lg font-label text-label-md font-bold text-on-primary transition-opacity hover:opacity-90"
              >
                Praticar agora <Icon name="arrow_forward" className="text-[18px]" />
              </Link>
              <button
                type="button"
                onClick={() => setAnswers({})}
                className="inline-flex min-h-11 items-center gap-xs rounded-full border border-outline-variant/60 px-lg font-label text-label-md text-primary hover:border-primary/60"
              >
                <Icon name="restart_alt" className="text-[18px]" /> Refazer
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <section>
        <SectionHeading eyebrow="Os cinco níveis" title="Todo mundo começa em algum lugar" />
        <ul className="mt-lg grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {maturityLevels.map((l) => (
            <li key={l.level}>
              <article className={cx('h-full rounded-2xl border bg-surface-container-low p-lg', level === l.level ? 'border-primary ring-2 ring-primary/30' : 'border-outline-variant/40')}>
                <p className="font-label text-label-sm font-bold uppercase tracking-wide text-primary">{l.level}º nível</p>
                <h3 className="mt-sm font-headline text-headline-sm text-on-surface">{l.name}</h3>
                <p className="mt-sm text-body-sm text-on-surface-variant">{l.description}</p>
              </article>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
