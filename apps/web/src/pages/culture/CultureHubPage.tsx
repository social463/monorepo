import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { BenefitsTab } from './BenefitsTab'
import { ManualsTab } from './ManualsTab'
import { KitVisualTab } from './KitVisualTab'

/**
 * Hub da área de Cultura. As telas vivem em abas da mesma rota (e não em um
 * submenu do menu lateral, que é flat e vira rail de ícones quando recolhido).
 * A aba ativa vai na URL para o link ser compartilhável.
 *
 * O Manifesto saiu daqui para `/manifesto`: é o texto mais longo do produto e o
 * que mais se manda por link, e dividir a rota com Manuais e Benefícios não
 * ajudava nenhum dos três. `?aba=manifesto` redireciona, que os links antigos
 * estão em conversa de Teams e em favorito de gente.
 *
 * Benefícios é para **todo colaborador logado** — é a identidade da empresa. Só
 * Manuais é documento operacional e segue na feature `cultura` do setor, então
 * a aba some para quem não a tem (a API também recusa).
 */
const TABS = [
  { key: 'manuais', label: 'Manuais', feature: 'cultura' },
  // Kit visual é da empresa toda, como Manifesto e Benefícios: são os arquivos
  // da marca, não documento operacional.
  { key: 'kit-visual', label: 'Kit visual' },
  { key: 'beneficios', label: 'Benefícios' },
] as const

type TabKey = (typeof TABS)[number]['key']

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((tab) => tab.key === value)
}

export function CultureHubPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('aba')

  // Admin enxerga tudo; terceirizado usa a allowlist individual.
  const enabled = user?.role === 'THIRD_PARTY' ? user.enabledFeatures : (user?.sectorFeatures ?? [])
  const canSeeAll = user?.role === 'ADMIN' || user?.role === 'SUBADMIN'
  const tabs = TABS.filter((tab) => !('feature' in tab) || canSeeAll || enabled.includes(tab.feature))

  const requestedIsVisible = isTabKey(requested) && tabs.some((tab) => tab.key === requested)
  // A primeira aba VISÍVEL, e não uma fixa: quem não tem a feature `cultura`
  // não vê Manuais, e cair numa aba inexistente deixaria a tela vazia.
  const active: TabKey = requestedIsVisible ? (requested as TabKey) : (tabs[0]?.key ?? 'beneficios')

  // Link antigo do manifesto (aba) para a tela própria.
  if (requested === 'manifesto') return <Navigate to="/manifesto" replace />

  function selectTab(key: TabKey) {
    const next = new URLSearchParams(searchParams)
    next.set('aba', key)
    setSearchParams(next, { replace: true })
  }

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header>
        <h1 className="font-headline text-headline-xl text-on-surface">Cultura</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Quem somos, como trabalhamos e o que a empresa oferece para cuidar de você.
        </p>
      </header>

      <div role="tablist" aria-label="Seções de Cultura" className="flex flex-wrap gap-sm">
        {tabs.map((tab) => {
          const isActive = tab.key === active
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => selectTab(tab.key)}
              className={`rounded-full px-lg py-sm font-label text-label-md transition-colors ${
                isActive ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {active === 'manuais' && <ManualsTab />}
      {active === 'kit-visual' && <KitVisualTab />}
      {active === 'beneficios' && <BenefitsTab />}
    </section>
  )
}
