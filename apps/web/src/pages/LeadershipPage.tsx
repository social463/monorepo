import { useState } from 'react'
import { Link } from 'react-router-dom'
import { SquadMoodPanel } from './profile/SquadMoodPanel'
import { TeamVacationsPanel } from './profile/TeamVacationsPanel'
import { TeamIndicatorsTab } from './leadership/TeamIndicatorsTab'
import { Icon } from '../components/Icon'

/**
 * Hub da liderança: o que um líder precisa ver sobre o time num lugar só.
 *
 * **Agrega, não reimplementa.** 1:1 e PDI já existem como features próprias;
 * aqui aparecem só como atalho para a tela de verdade. Humor e férias do time
 * não têm tela própria — moram nesta página, pelos painéis `SquadMoodPanel` e
 * `TeamVacationsPanel` (é por eles que se lança/edita um período de férias).
 * Duplicar qualquer um deles criaria uma segunda versão para divergir da
 * primeira. O Organograma é a exceção parcial: o atalho leva a
 * `/lideranca/organograma`, que é a mesma tela de `/time` recortada nos
 * liderados diretos — por esta entrada o líder vê o time dele, não a empresa.
 *
 * Duas abas: **Meu time** é o acompanhamento nominal (humor de cada pessoa,
 * férias, atalhos) e **Indicadores** é o agregado do período. Ficam separadas
 * porque respondem a perguntas diferentes — "como está fulano hoje" e "como o
 * time andou no mês" — e juntas numa rolagem só a página não termina nunca.
 *
 * Quem entra: papel de liderança (LEAD, MANAGER, HEAD), ADMIN, e quem tem o
 * bloco de Gente e Gestão — o mesmo filtro do item de menu.
 */

type TabKey = 'team' | 'indicators'

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'team', label: 'Meu time', icon: 'groups' },
  { key: 'indicators', label: 'Indicadores', icon: 'bar_chart' },
]

export function LeadershipPage() {
  const [tab, setTab] = useState<TabKey>('team')

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header>
        <h1 className="font-headline text-headline-xl text-on-surface">Liderança</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          O pulso do seu time: como as pessoas estão, o que está agendado e quem sai de férias.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Seções da Liderança"
        className="flex flex-wrap gap-1 rounded-xl border border-outline-variant/40 bg-surface-container-low p-1"
      >
        {TABS.map((item) => {
          const active = tab === item.key
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.key)}
              className={[
                'flex flex-1 items-center justify-center gap-xs rounded-lg px-md py-sm font-label text-label-md transition-colors',
                active
                  ? 'bg-primary/10 font-bold text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
              ].join(' ')}
            >
              <Icon name={item.icon} className="text-[18px]" />
              {item.label}
            </button>
          )
        })}
      </div>

      {tab === 'team' && <TeamTab />}
      {tab === 'indicators' && <TeamIndicatorsTab />}
    </section>
  )
}

function TeamTab() {
  return (
    <div className="flex flex-col gap-lg">
      <SquadMoodPanel />

      <TeamVacationsPanel />

      <section>
        <h2 className="mb-md font-headline text-headline-md text-on-surface">Onde acompanhar o resto</h2>
        <div className="grid gap-md sm:grid-cols-2">
          <ShortcutCard
            to="/1-1"
            icon="record_voice_over"
            title="1:1"
            text="Agendar, aceitar convite e registrar o que foi conversado."
          />
          <ShortcutCard to="/pdi" icon="flag" title="PDI" text="Os planos de desenvolvimento dos seus liderados." />
          <ShortcutCard
            to="/lideranca/organograma"
            icon="account_tree"
            title="Organograma"
            text="Quem responde diretamente a você."
          />
          <ShortcutCard
            to="/mural-feedbacks"
            icon="reviews"
            title="Mural de Feedbacks"
            text="O que as pessoas estão dizendo umas das outras."
          />
        </div>
      </section>
    </div>
  )
}

function ShortcutCard({ to, icon, title, text }: { to: string; icon: string; title: string; text: string }) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-md rounded-xl border border-outline-variant/40 bg-surface-container-low p-lg transition-colors hover:border-primary/40"
    >
      <Icon name={icon} className="text-[24px] text-primary" />
      <div className="min-w-0">
        <p className="font-label text-label-lg text-on-surface group-hover:underline">{title}</p>
        <p className="text-body-sm text-on-surface-variant">{text}</p>
      </div>
    </Link>
  )
}
