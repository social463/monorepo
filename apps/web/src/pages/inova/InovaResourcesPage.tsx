import { Icon } from '../../components/Icon'

const RECURSOS = [
  {
    icone: 'auto_awesome',
    titulo: 'Mentorias da Viver de IA',
    texto:
      'Sessões com especialistas para acelerar seu projeto. Receba orientação sobre estratégia, ferramentas e implementação, porque aprendizado contínuo é parte da nossa cultura.',
  },
  {
    icone: 'menu_book',
    titulo: 'Cursos e trilhas',
    texto:
      'Trilhas estruturadas para desenvolver suas habilidades em IA, automação e análise de dados. Evolua com método e aplique no seu projeto.',
  },
  {
    icone: 'groups',
    titulo: 'Comunidade de protagonistas',
    texto:
      'Conecte-se com outros colaboradores que estão tirando ideias do papel. Troque experiências, aprenda junto e fortaleça a força coletiva.',
  },
]

export function InovaResourcesPage() {
  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h1 className="font-headline text-headline-lg text-on-surface">Recursos para evoluir</h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Ferramentas, conhecimento e pessoas para fortalecer sua jornada de inovação
        </p>
      </header>

      <div className="grid grid-cols-1 gap-md md:grid-cols-2">
        {RECURSOS.map((r) => (
          <div key={r.titulo} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
            <Icon name={r.icone} className="text-[24px] text-primary" />
            <h2 className="mt-2 font-headline text-headline-sm text-on-surface">{r.titulo}</h2>
            <p className="mt-1 text-body-md text-on-surface-variant">{r.texto}</p>
          </div>
        ))}
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
          <Icon name="rocket_launch" className="text-[24px] text-primary" />
          <h2 className="mt-2 font-headline text-headline-sm text-on-surface">Trilha AI First, Impulse UP</h2>
          <p className="mt-1 text-body-md text-on-surface-variant">
            Desenvolva competências estratégicas em Inteligência Artificial na plataforma Impulse UP. Um passo a mais
            na sua evolução profissional.
          </p>
          <a
            href="https://eu-medico-residente.impulseup.com/dashboard/appraisals/competencies/babafbae-e47b-42d8-9876-4f60c8627dde/appraisal-results;type=competencies"
            target="_blank"
            rel="noreferrer"
            className="mt-md inline-flex items-center gap-sm rounded-full border border-outline-variant/60 px-lg py-sm font-label text-label-md text-primary hover:border-primary/60"
          >
            Acessar
            <Icon name="open_in_new" className="text-[16px]" />
          </a>
        </div>
      </div>

      <div className="rounded-2xl bg-primary p-lg text-on-primary md:p-xl">
        <Icon name="school" className="text-[28px]" />
        <h2 className="mt-2 font-headline text-headline-sm">Aprendizado contínuo é parte do nosso DNA</h2>
        <p className="mt-1 text-body-md">Acesse a plataforma Viver de IA e continue evoluindo com propósito.</p>
        <a
          href="https://app.viverdeia.ai/team-management"
          target="_blank"
          rel="noreferrer"
          className="mt-md inline-flex items-center gap-sm rounded-full bg-on-primary px-lg py-sm font-label text-label-md font-bold text-primary hover:opacity-90"
        >
          Acessar Viver de IA
        </a>
      </div>
    </div>
  )
}
