import { Link } from 'react-router-dom'
import { Icon } from '../../../../components/Icon'
import { CompassWizard } from '../components/CompassWizard'
import { SectionHeading } from '../components/SectionHeading'
import { GOLDEN_RULE, convictions, paths } from '../content/library'

const ENTRADAS = [
  { to: 'bussola', label: 'Não sei por onde começar', detail: 'Três perguntas rápidas e um caminho claro para a sua situação.', icon: 'explore' },
  { to: 'situacoes', label: 'Tenho uma situação específica', detail: 'Busque o seu caso e veja o papel da IA, o papel humano e o risco.', icon: 'auto_awesome' },
  { to: 'seguranca', label: 'Posso compartilhar esse dado?', detail: 'O semáforo do que pode, do que exige validação e do que nunca pode.', icon: 'verified_user' },
] as const

export function InovaGuiaHomePage() {
  return (
    <div className="flex flex-col gap-2xl">
      <header>
        <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">Cultura AI First</p>
        <h1 className="mt-1 font-headline text-headline-lg text-on-surface">
          Quem deve ajudar primeiro: a IA, a IA com pessoas, ou uma pessoa?
        </h1>
        <p className="mt-2 max-w-2xl text-body-md text-on-surface-variant">
          Traga uma dúvida real do seu dia. Em poucos segundos você descobre por onde começar, e sai daqui com um
          próximo passo concreto.
        </p>
        <div className="mt-lg flex flex-wrap gap-sm">
          <Link
            to="bussola"
            className="inline-flex min-h-11 items-center gap-xs rounded-full bg-primary px-lg font-label text-label-md font-bold text-on-primary transition-opacity hover:opacity-90"
          >
            Abrir a Bússola <Icon name="arrow_forward" className="text-[18px]" />
          </Link>
          <Link
            to="situacoes"
            className="inline-flex min-h-11 items-center rounded-full border border-outline-variant/60 px-lg font-label text-label-md font-bold text-on-surface transition-colors hover:border-primary"
          >
            Ver situações do dia a dia
          </Link>
        </div>
      </header>

      <div className="grid gap-md md:grid-cols-3">
        {ENTRADAS.map((e) => (
          <Link
            key={e.to}
            to={e.to}
            className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg transition-colors hover:border-primary/60"
          >
            <Icon name={e.icon} className="text-[24px] text-primary" />
            <p className="mt-sm font-label text-label-lg font-bold text-on-surface">{e.label}</p>
            <p className="mt-1 text-body-sm text-on-surface-variant">{e.detail}</p>
          </Link>
        ))}
      </div>

      <section>
        <SectionHeading
          eyebrow="Experimente agora"
          title="Uma dúvida real, um caminho em segundos"
          description="A Bússola não decide por você. Ela mostra onde a IA ajuda, onde você decide e quando é hora de chamar alguém."
        />
        <div className="mt-lg">
          <CompassWizard />
        </div>
      </section>

      <section>
        <SectionHeading eyebrow="Os três caminhos" title="Nenhum é melhor. O erro é usar o errado." />
        <div className="mt-lg grid gap-md lg:grid-cols-3">
          {Object.values(paths).map((p) => (
            <article key={p.id} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
              <h3 className="font-headline text-headline-sm text-on-surface">{p.label}</h3>
              <p className="mt-sm text-body-md text-on-surface-variant">{p.message}</p>
            </article>
          ))}
        </div>
        <p className="mt-md rounded-xl border-l-4 border-primary bg-surface-container-low p-lg text-body-md text-on-surface-variant">
          <strong className="font-bold text-on-surface">Regra de ouro. </strong>
          {GOLDEN_RULE}
        </p>
      </section>

      <section>
        <SectionHeading eyebrow="Por que isso importa" title="Pessoas primeiro. Sempre." />
        <ul className="mt-lg grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {convictions.map((c) => (
            <li key={c.title} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
              <p className="font-label text-label-lg font-bold text-on-surface">{c.title}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{c.detail}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
