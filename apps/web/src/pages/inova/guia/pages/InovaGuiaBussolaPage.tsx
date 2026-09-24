import { CompassWizard } from '../components/CompassWizard'
import { SectionHeading } from '../components/SectionHeading'
import { paths } from '../content/library'

export function InovaGuiaBussolaPage() {
  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Bússola de decisão"
        title="Quem deve ajudar primeiro?"
        description={'A dúvida real não é "a IA consegue fazer isso?", e sim "quem deve começar?". Descreva sua situação e responda três perguntas.'}
      />

      <CompassWizard />

      <section>
        <SectionHeading
          eyebrow="Os três caminhos"
          title="O que cada resposta significa"
          description="Nenhum caminho é melhor que o outro. O erro é usar o caminho errado para a situação."
        />
        <div className="mt-lg grid gap-md lg:grid-cols-3">
          {Object.values(paths).map((p) => (
            <article key={p.id} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
              <h3 className="font-headline text-headline-sm text-on-surface">{p.label}</h3>
              <p className="mt-sm text-body-md text-on-surface-variant">{p.message}</p>
              <p className="mt-md border-t border-outline-variant/40 pt-md text-body-sm text-on-surface-variant">
                <strong className="font-bold text-on-surface">Quando. </strong>
                {p.when}
              </p>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                <strong className="font-bold text-on-surface">Exemplos. </strong>
                {p.examples}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
