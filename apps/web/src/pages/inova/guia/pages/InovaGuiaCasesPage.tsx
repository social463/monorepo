import { Link } from 'react-router-dom'
import { SectionHeading } from '../components/SectionHeading'
import { caseFields, cases, inovaCycle } from '../content/cases'
import { NaPraticaSections } from './InovaGuiaNaPraticaPage'

export function InovaGuiaCasesPage() {
  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Comunidade AI First"
        title="AI First acontecendo na INOVA"
        description="Esta vitrine começa vazia de propósito: os cases aqui serão os reais, registrados pelas áreas. Uma vitória rápida conta: um prompt que poupa uma hora por semana, um processo simplificado, uma análise que ficou melhor. Registre e ajude outra área a andar mais rápido."
        action={
          // Case é projeto da comunidade: registra-se no formulário de projeto,
          // e não no formulário externo do site original.
          <Link
            to="/comunidade-inova/novo"
            className="inline-flex min-h-11 items-center rounded-full bg-primary px-lg font-label text-label-md font-bold text-on-primary transition-opacity hover:opacity-90"
          >
            Registrar um case
          </Link>
        }
      />

      {cases.length > 0 ? (
        <ul className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {cases.map((c) => (
            <li key={c.id} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
              <h3 className="font-headline text-headline-sm text-on-surface">{c.title}</h3>
              <p className="mt-sm text-body-sm text-on-surface-variant">{c.problem}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-2xl lg:grid-cols-2">
        <div>
          <SectionHeading eyebrow="Trilha INOVA" title="O ciclo da aprendizagem coletiva" />
          <ol className="mt-lg space-y-sm">
            {inovaCycle.map((s, i) => (
              <li key={s.step} className="flex gap-md rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-label-sm font-bold text-primary">{i + 1}</span>
                <div>
                  <p className="font-label text-label-md font-bold text-on-surface">{s.step}</p>
                  <p className="mt-1 text-body-sm text-on-surface-variant">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <SectionHeading eyebrow="Como registrar" title="O que um bom case precisa ter" />
          <ul className="mt-lg space-y-sm">
            {caseFields.map((f) => (
              <li key={f.field} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <p className="font-label text-label-md font-bold text-on-surface">{f.field}</p>
                <p className="mt-1 text-body-sm text-on-surface-variant">{f.describe}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <NaPraticaSections />
    </div>
  )
}
