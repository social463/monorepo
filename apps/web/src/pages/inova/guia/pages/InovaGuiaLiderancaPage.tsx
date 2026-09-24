import { useEffect } from 'react'
import { trackEvent } from '../../../../lib/analytics'
import { SectionHeading } from '../components/SectionHeading'
import { headcountQuestions, leadershipBlocks, leadershipChecklist, leadershipQuestions } from '../content/library'

export function InovaGuiaLiderancaPage() {
  useEffect(() => trackEvent('inova_guia_lideranca_aberta', {}), [])

  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Liderança"
        title="A transformação começa pelo exemplo"
        description="Ninguém segue quem não pratica. Liderar AI First é usar, perguntar, destravar e continuar assumindo as decisões que são suas."
      />

      <ul className="grid gap-md md:grid-cols-2 xl:grid-cols-4">
        {leadershipBlocks.map((b) => (
          <li key={b.title} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
            <p className="font-label text-label-md font-bold text-on-surface">{b.title}</p>
            <p className="mt-1 text-body-sm text-on-surface-variant">{b.detail}</p>
          </li>
        ))}
      </ul>

      <div className="grid gap-2xl lg:grid-cols-2">
        <div>
          <SectionHeading eyebrow="Perguntas que desenvolvem" title="Estimule com perguntas, não com respostas prontas" />
          <ul className="mt-lg space-y-xs">
            {leadershipQuestions.map((q) => (
              <li key={q} className="rounded-xl border-l-4 border-primary bg-surface-container-low p-md text-on-surface">
                {q}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <SectionHeading eyebrow="Antes de pedir headcount" title="Sete perguntas honestas" />
          <ol className="mt-lg space-y-xs">
            {headcountQuestions.map((q, i) => (
              <li key={q} className="flex gap-sm rounded-xl border border-outline-variant/40 bg-surface-container-low p-md text-body-sm text-on-surface-variant">
                <span className="font-bold text-primary">{i + 1}.</span>
                <span>{q}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <section>
        <SectionHeading
          eyebrow="Checklist da liderança"
          title="Seis perguntas para revisitar todo mês"
          description="Sem burocracia: o que você observa e a evidência que mostra que está acontecendo."
        />
        <ul className="mt-lg grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {leadershipChecklist.map((c) => (
            <li key={c.question} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
              <p className="font-label text-label-md font-bold text-on-surface">{c.question}</p>
              <p className="mt-sm text-body-sm text-on-surface-variant">
                <strong className="font-bold text-primary">Evidência. </strong>
                {c.evidence}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
