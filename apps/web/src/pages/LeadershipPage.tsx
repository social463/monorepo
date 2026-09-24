import { useState } from 'react'
import { Link } from 'react-router-dom'
import { SquadMoodPanel } from './profile/SquadMoodPanel'
import { TeamIndicatorsTab } from './leadership/TeamIndicatorsTab'
import { Icon } from '../components/Icon'
import { useDevelopmentSettings } from '../lib/use-development-settings'

/**
 * Hub da liderança: o que um líder precisa ver sobre o time num lugar só.
 *
 * **Agrega, não reimplementa.** 1:1 e PDI moram na ImpulseUp — os atalhos daqui
 * saem do portal (Documento 4, seção 5). O humor do time não tem tela própria e
 * mora nesta página, pelo `SquadMoodPanel`; duplicá-lo criaria uma segunda
 * versão para divergir da primeira. O Organograma é a exceção parcial: o atalho
 * leva a `/lideranca/organograma`, que é a mesma tela de `/time` recortada nos
 * liderados diretos — por esta entrada o líder vê o time dele, não a empresa.
 *
 * Duas abas: **Meu time** é o acompanhamento nominal (humor de cada pessoa,
 * atalhos) e **Indicadores** é o agregado do período. Ficam separadas porque
 * respondem a perguntas diferentes — "como está fulano hoje" e "como o time
 * andou no mês" — e juntas numa rolagem só a página não termina nunca.
 *
 * **Férias saiu daqui em 08/09/2026.** A gestão passa a ser do DP, em
 * Administração › Férias, e o líder não lança mais período nem preenche a
 * programação anual do time. O que sobra para todo mundo é leitura: o card da
 * Home e "Férias do Mês" (`/ferias`), que não editam nada. `VacationPlanningTab`
 * e `TeamVacationsPanel` continuam no repo, sem ponto de montagem — as rotas de
 * `/vacation-planning` que eles consomem também seguem de pé, e é o que torna
 * essa remoção reversível se o fluxo do líder voltar.
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
          O pulso do seu time: como as pessoas estão e como o time andou no período.
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
  /**
   * 1:1 e PDI apontavam para `/1-1` e `/pdi`, que passam por `FeatureGate` —
   * e a EMR não usa nenhum dos dois no portal, então as features estão
   * desligadas e o clique caía na Home. O destino de verdade é a ImpulseUp, e
   * a URL é a mesma de Administração › Desenvolvimento que alimenta o item
   * "Avaliações e Pesquisas" do menu: empresa sem URL cadastrada não vê os
   * cards, em vez de ver um atalho para lugar nenhum.
   */
  const { data: development } = useDevelopmentSettings()
  const impulseUpUrl = development?.settings?.impulseUpUrl ?? null

  return (
    <div className="flex flex-col gap-lg">
      <SquadMoodPanel />

      <section>
        <h2 className="mb-md font-headline text-headline-md text-on-surface">Onde acompanhar o resto</h2>
        <div className="grid gap-md sm:grid-cols-2">
          {impulseUpUrl && (
            <>
              <ShortcutCard
                to={impulseUpUrl}
                external
                icon="record_voice_over"
                title="1:1"
                text="Agendar, aceitar convite e registrar o que foi conversado, na ImpulseUp."
              />
              <ShortcutCard
                to={impulseUpUrl}
                external
                icon="flag"
                title="PDI"
                text="Os planos de desenvolvimento dos seus liderados, na ImpulseUp."
              />
            </>
          )}
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

function ShortcutCard({
  to,
  icon,
  title,
  text,
  external = false,
}: {
  to: string
  icon: string
  title: string
  text: string
  /** Destino fora do portal (ImpulseUp): abre em aba nova e se anuncia como tal. */
  external?: boolean
}) {
  const cls =
    'group flex items-start gap-md rounded-xl border border-outline-variant/40 bg-surface-container-low p-lg transition-colors hover:border-primary/40'
  const conteudo = (
    <>
      <Icon name={icon} className="text-[24px] text-primary" />
      <div className="min-w-0">
        <p className="flex items-center gap-xs font-label text-label-lg text-on-surface group-hover:underline">
          {title}
          {external && <Icon name="open_in_new" className="text-[16px] text-on-surface-variant" />}
        </p>
        <p className="text-body-sm text-on-surface-variant">{text}</p>
      </div>
    </>
  )

  if (external) {
    return (
      <a href={to} target="_blank" rel="noreferrer" className={cls}>
        {conteudo}
      </a>
    )
  }
  return (
    <Link to={to} className={cls}>
      {conteudo}
    </Link>
  )
}
