import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type {
  AccessHeatmapDTO,
  AnalyticsWindowRequest,
  EngagementOverviewResponse,
  InovaAnalyticsResponse,
  PeopleOverviewResponse,
  SectorDTO,
} from '@legends/shared'
import { describeAnalyticsWindow, isFullAdmin, isSectorAdminOnly } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import {
  AccessHeatmap,
  AccessSeriesChart,
  ChartCard,
  DistributionBars,
  EmptyState,
  EngagementSeriesChart,
  StatCard,
} from '../../components/analytics/AnalyticsPrimitives'
import { PeriodFilter, windowKey, windowQuery } from '../../components/analytics/PeriodFilter'
import { useAuth } from '../../auth/AuthContext'
import { CollaboratorsSection } from './CollaboratorsSection'
import { CommunicationPanel } from './CommunicationPanel'
import { EngagementSection } from './EngagementSection'
import { MoodOverviewSection } from './MoodOverviewSection'
import { inputCls } from './shared'
import { TrainingAnalyticsTab } from './TrainingAnalyticsTab'

type TabKey = 'dashboard' | 'overview' | 'profile' | 'clima' | 'engajamento' | 'comunicacao' | 'desenvolvimento'

const TABS: { key: TabKey; label: string; icon: string }[] = [
  // Primeira aba, e primeira tela do Admin: `/admin` redireciona para cá.
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { key: 'overview', label: 'Visão geral', icon: 'insights' },
  { key: 'profile', label: 'Ficha & Perfil', icon: 'group' },
  // Clima e Engajamento eram uma aba só. Separadas porque respondem a perguntas
  // diferentes — "como o time está" e "quanto o time usa" — e porque o
  // termômetro completo, que vivia em `/admin/clima`, precisava de casa própria.
  { key: 'clima', label: 'Clima', icon: 'mood' },
  { key: 'engajamento', label: 'Engajamento', icon: 'favorite' },
  // Comunicação Interna nasceu embutida no Engajamento e saiu pelo mesmo motivo
  // que separou Clima de Engajamento: responde a outra pergunta — "o comunicado
  // chegou?", e não "quanto o time usa o produto". Empilhada, ela também
  // enterrava o "Telas mais acessadas" no fim de uma aba de rolagem longa.
  { key: 'comunicacao', label: 'Comunicação Interna', icon: 'campaign' },
  // Guarda-chuva de trilhas: Treinamento (Documento 4, seção 9.5) e Comunidade
  // INOVA (Guia AI First), cada uma com sub-aba própria dentro de
  // `DesenvolvimentoTab` — ver o comentário lá. Nasce aqui, e não em tela
  // própria, porque Ciclo, De/Até e Setor já valem para todas as abas desta
  // seção; só Cargo (de Treinamento) é dela.
  { key: 'desenvolvimento', label: 'Desenvolvimento', icon: 'school' },
]

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((tab) => tab.key === value)
}

interface TabProps {
  window: AnalyticsWindowRequest
  sectorId: string
}

/** O overview é lido por duas abas (Dashboard e Visão geral) — mesma queryKey. */
function useOverview(window: AnalyticsWindowRequest, sectorId: string) {
  return useQuery({
    queryKey: ['admin', 'people', 'overview', windowKey(window), sectorId],
    queryFn: () => apiFetch<PeopleOverviewResponse>(`/admin/people/overview?${windowQuery(window, sectorId)}`),
  })
}

/** Setores para os seletores; o SUBADMIN não escolhe (a API usa o do token). */
function useAnalyticsFilters() {
  const { user } = useAuth()
  const isSubadmin = isSectorAdminOnly(user)
  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
    enabled: !isSubadmin,
  })
  return { sectors: sectorsQuery.data?.sectors ?? [], isSubadmin }
}

function LoadError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-sm rounded-lg border border-error/40 bg-error-container/20 p-lg text-on-error-container">
      <Icon name="error" className="text-[20px]" />
      {message}
    </div>
  )
}

// ----- Aba: Dashboard -----

/**
 * Painel visual do Admin, no lugar do resumo operacional por setor em blocos de
 * texto (seção 3 do Documento 3). Lê o MESMO `/admin/people/overview` da Visão
 * geral: outra ida ao servidor para desenhar um KPI ao lado do primeiro não se
 * paga, e as duas abas responderiam números diferentes se cada uma consultasse
 * na sua vez.
 */
function DashboardTab({ window, sectorId }: TabProps) {
  const query = useOverview(window, sectorId)
  if (query.isLoading) return <p className="text-body-sm text-on-surface-variant">Carregando…</p>
  // Checa o CORPO, e não só `isError`: resposta sem `overview` tem que cair no
  // aviso, não estourar no primeiro acesso a `overview.days`.
  if (query.isError || !query.data?.overview) return <LoadError message="Erro ao carregar o dashboard." />

  const overview = query.data.overview
  const legenda = describeAnalyticsWindow(window, overview.days)

  return (
    <div className="flex flex-col gap-lg">
      <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon="person" label="Usuários ativos" value={overview.uniqueUsersInRange} hint={legenda} />
        <StatCard icon="campaign" label="Publicações" value={overview.postsPublished} hint={legenda} />
        <StatCard icon="forum" label="Feedbacks" value={overview.feedbacksCount} hint={legenda} />
        <StatCard
          icon="trending_up"
          label="Adesão"
          value={`${overview.adoptionRate}%`}
          hint={`${overview.uniqueUsersInRange} de ${overview.activePeople} pessoas`}
        />
      </div>

      <ChartCard title="Atividade dos usuários" subtitle={legenda}>
        <AccessSeriesChart points={overview.accessSeries} />
      </ChartCard>

      <ChartCard title="Engajamento dos usuários" subtitle="Feedbacks, reações e comentários por dia">
        <EngagementSeriesChart points={overview.engagementSeries} />
      </ChartCard>
    </div>
  )
}

// ----- Aba: Visão geral -----

function OverviewTab({ window, sectorId }: TabProps) {
  const query = useOverview(window, sectorId)

  if (query.isLoading) return <p className="text-body-sm text-on-surface-variant">Carregando…</p>
  if (query.isError || !query.data?.overview) return <LoadError message="Erro ao carregar a visão geral." />

  const overview = query.data.overview
  // A legenda vem da janela EFETIVA devolvida pelo servidor, não de um texto
  // cravado na tela: era isso que fazia o card dizer "Únicos em 7 dias" com o
  // filtro em 40 dias (seção 4.1).
  const legenda = describeAnalyticsWindow(window, overview.days)

  return (
    <div className="flex flex-col gap-lg">
      <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon="badge" label="Pessoas ativas" value={overview.activePeople} hint="Cadastros ativos no recorte" />
        <StatCard icon="person" label="Únicos no período" value={overview.uniqueUsersInRange} hint={legenda} />
        <StatCard icon="ads_click" label="Acessos no período" value={overview.accessesInRange} hint={legenda} />
        <StatCard
          icon="trending_up"
          label="Adesão"
          value={`${overview.adoptionRate}%`}
          hint={`${overview.uniqueUsersInRange} de ${overview.activePeople} pessoas acessaram`}
        />
      </div>

      <ChartCard title="Acessos por dia" subtitle={legenda}>
        <AccessSeriesChart points={overview.accessSeries} />
      </ChartCard>

      <AccessHeatmapCard window={window} sectorId={sectorId} />

      <ChartCard title="Feedbacks no período" subtitle="Trocas entre colegas na janela selecionada">
        <div className="grid gap-md sm:grid-cols-2">
          <StatCard icon="forum" label="Feedbacks" value={overview.feedbacksCount} />
          <StatCard icon="mood" label="Reações" value={overview.feedbackReactionsCount} />
        </div>
      </ChartCard>

      {/* Seção 4.3: "analisar os feedbacks, inserindo os tipos de acordo com as
          tags e competências". Competência é o catálogo da empresa; tag é a
          categoria personalizada que quem escreve digita. */}
      <div className="grid gap-lg lg:grid-cols-2">
        <ChartCard
          title="Feedbacks por competência"
          subtitle="Um feedback pode ter várias — a soma passa do total de feedbacks"
        >
          <DistributionBars
            slices={overview.feedbacksByCategory}
            emptyMessage="Nenhum feedback com competência no período."
          />
        </ChartCard>
        <ChartCard title="Feedbacks por tag" subtitle="Categorias personalizadas, fora do catálogo">
          <DistributionBars
            slices={overview.feedbacksByTag}
            emptyMessage="Nenhuma categoria personalizada no período."
          />
        </ChartCard>
      </div>

      <div className="grid gap-lg lg:grid-cols-2">
        <ChartCard title="Distribuição por papel">
          <DistributionBars slices={overview.byRole} emptyMessage="Nenhuma pessoa ativa no recorte." />
        </ChartCard>
        <ChartCard title="Distribuição por squad">
          <DistributionBars slices={overview.bySquad} emptyMessage="Nenhuma pessoa ativa no recorte." />
        </ChartCard>
      </div>
    </div>
  )
}

/**
 * Mapa de calor com filtro **próprio** de período e setor (seção 4.2).
 *
 * Nasce com o recorte do cabeçalho e se solta dele no primeiro toque: quem quer
 * comparar o horário de pico de um setor contra a janela geral da tela precisa
 * dos dois recortes ao mesmo tempo, não de um substituindo o outro.
 */
function AccessHeatmapCard({ window, sectorId }: TabProps) {
  const [ownWindow, setOwnWindow] = useState<AnalyticsWindowRequest | null>(null)
  const [ownSector, setOwnSector] = useState<string | null>(null)
  const { sectors, isSubadmin } = useAnalyticsFilters()

  const effWindow = ownWindow ?? window
  const effSector = ownSector ?? sectorId
  const solto = ownWindow !== null || ownSector !== null

  const query = useQuery({
    queryKey: ['admin', 'people', 'heatmap', windowKey(effWindow), effSector],
    queryFn: () =>
      apiFetch<{ heatmap: AccessHeatmapDTO }>(`/admin/people/heatmap?${windowQuery(effWindow, effSector)}`),
  })
  const heatmap = query.data?.heatmap

  return (
    <ChartCard
      title="Mapa de calor de atividade"
      subtitle="Dia da semana × hora (horário de São Paulo)"
    >
      <div className="mb-md flex flex-wrap items-end gap-md">
        <PeriodFilter value={effWindow} onChange={setOwnWindow} label="Período do mapa" />
        {!isSubadmin && (
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Setor do mapa
            <Select
              ariaLabel="Setor do mapa de calor"
              value={effSector}
              onChange={setOwnSector}
              options={[
                { value: '', label: 'Todos os setores' },
                ...sectors.map((sector) => ({ value: sector.id, label: sector.name })),
              ]}
            />
          </label>
        )}
        {solto && (
          <button
            type="button"
            onClick={() => {
              setOwnWindow(null)
              setOwnSector(null)
            }}
            className="pb-2 font-label text-label-sm text-primary hover:underline"
          >
            Voltar ao filtro da tela
          </button>
        )}
      </div>

      {query.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}
      {query.isError && <LoadError message="Erro ao carregar o mapa de calor." />}

      {heatmap && (
        <div className="flex flex-col gap-md">
          <div className="grid gap-md sm:grid-cols-2">
            <StatCard
              icon="schedule"
              label="Tempo médio na plataforma"
              value={heatmap.avgSessionMinutes === null ? '—' : `${heatmap.avgSessionMinutes} min`}
              // A ressalva fica na legenda, não numa nota de rodapé que ninguém
              // lê: o número é derivado do histórico de navegação, e a última
              // tela de cada sessão não tem como ser medida.
              hint={
                heatmap.sessions === 0
                  ? 'Sem acessos no recorte'
                  : `${heatmap.sessions} sessões · estimado pelo histórico de navegação, é um piso`
              }
            />
            <StatCard icon="ads_click" label="Sessões no recorte" value={heatmap.sessions} />
          </div>
          <AccessHeatmap cells={heatmap.cells} />
        </div>
      )}
    </ChartCard>
  )
}

// ----- Aba: Engajamento -----

/**
 * Painel de pontos (vindo de `/admin/engajamento`, seção 4.7) e as telas mais
 * acessadas — as duas respondem "quanto o time usa o produto".
 *
 * A Comunicação Interna (seção 4.8) morava aqui e virou aba própria: ela
 * responde outra pergunta, e empilhada enterrava "Telas mais acessadas" no fim
 * de uma rolagem longa.
 *
 * O painel de pontos aparece **só para o ADMIN pleno**: em `/admin/engajamento`
 * ele era `adminOnly` (regra de recompensa é da empresa, não do setor), e mudar
 * de lugar não é motivo para afrouxar o recorte.
 */
function EngagementTab({ window, sectorId }: TabProps) {
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['admin', 'people', 'engagement', windowKey(window), sectorId],
    queryFn: () =>
      apiFetch<EngagementOverviewResponse>(`/admin/people/engagement?${windowQuery(window, sectorId)}`),
  })

  return (
    <div className="flex flex-col gap-lg">
      {isFullAdmin(user) && <EngagementSection embedded />}

      <ChartCard title="Telas mais acessadas" subtitle="Onde o time passa o tempo no período">
        {query.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}
        {(query.isError || (!query.isLoading && !query.data?.engagement)) && (
          <LoadError message="Erro ao carregar as telas mais acessadas." />
        )}
        {query.data?.engagement &&
          (query.data.engagement.topScreens.length === 0 ? (
            <EmptyState message="Nenhum acesso registrado no período." />
          ) : (
            <DistributionBars
              slices={query.data.engagement.topScreens.map((screen) => ({
                key: screen.path,
                label: screen.label,
                count: screen.accesses,
              }))}
              emptyMessage="Nenhum acesso registrado no período."
            />
          ))}
      </ChartCard>
    </div>
  )
}

// ----- Aba: Desenvolvimento -----

/**
 * Analytics de acesso ao Guia AI First (Comunidade INOVA) — sub-aba de
 * Desenvolvimento. Só as 11 páginas do Guia contam aqui; o hub da Comunidade
 * INOVA (Início, Projetos, Recursos…) já tem o analytics dele.
 *
 * Diferente do resto do People Analytics (só agregados), esta tela também
 * lista quem acessou — pedido explícito, não um padrão a repetir em outra
 * aba sem o mesmo pedido.
 */
function InovaAnalyticsTab({ window, sectorId }: TabProps) {
  const [search, setSearch] = useState('')
  const query = useQuery({
    queryKey: ['admin', 'people', 'inova', windowKey(window), sectorId],
    queryFn: () => apiFetch<InovaAnalyticsResponse>(`/admin/people/inova?${windowQuery(window, sectorId)}`),
  })

  if (query.isLoading) return <p className="text-body-sm text-on-surface-variant">Carregando…</p>
  if (query.isError || !query.data?.inova) return <LoadError message="Erro ao carregar o analytics da Comunidade INOVA." />

  const inova = query.data.inova
  const legenda = describeAnalyticsWindow(window, inova.days)
  const term = search.trim().toLowerCase()
  const filteredLogs = term
    ? inova.recentLogs.filter(
        (row) => row.userName.toLowerCase().includes(term) || row.userEmail.toLowerCase().includes(term),
      )
    : inova.recentLogs

  return (
    <div className="flex flex-col gap-lg">
      <div className="grid gap-md sm:grid-cols-3">
        <StatCard icon="ads_click" label="Total de acessos" value={inova.totalAccesses} hint={legenda} />
        <StatCard icon="group" label="Usuários únicos" value={inova.uniqueUsers} hint={legenda} />
        <StatCard icon="star" label="Página mais acessada" value={inova.topPage?.label ?? '—'} />
      </div>

      <ChartCard title="Acessos por página" subtitle={legenda}>
        <DistributionBars
          slices={inova.byPage.map((page) => ({ key: page.path, label: page.label, count: page.accesses }))}
          emptyMessage="Nenhum acesso ao Guia no período."
        />
      </ChartCard>

      <ChartCard title="Log de acessos" subtitle="Quem acessou, qual página e quando — os mais recentes primeiro">
        <input
          className={inputCls}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar por nome ou e-mail"
          placeholder="Buscar por nome ou e-mail…"
          type="search"
        />
        {filteredLogs.length === 0 ? (
          <EmptyState message={term ? 'Nenhum acesso encontrado para essa busca.' : 'Nenhum acesso ao Guia no período.'} />
        ) : (
          <div className="mt-md overflow-x-auto rounded-lg border border-outline-variant/40">
            <table className="w-full text-left text-body-sm">
              <thead className="bg-surface-container-high font-label text-label-sm text-on-surface-variant">
                <tr>
                  <th className="px-md py-sm">Pessoa</th>
                  <th className="px-md py-sm">Página</th>
                  <th className="px-md py-sm">Data/hora</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((row) => (
                  <tr key={row.id} className="border-t border-outline-variant/40">
                    <td className="px-md py-sm text-on-surface">
                      {row.userName}
                      <span className="block text-on-surface-variant">{row.userEmail}</span>
                    </td>
                    <td className="px-md py-sm text-on-surface-variant">{row.label}</td>
                    <td className="px-md py-sm text-on-surface-variant">
                      {new Date(row.createdAt).toLocaleString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {inova.recentLogsTotal > inova.recentLogs.length && (
          <p className="mt-sm text-body-sm text-on-surface-variant">
            Mostrando os {inova.recentLogs.length} acessos mais recentes de {inova.recentLogsTotal}.
          </p>
        )}
      </ChartCard>
    </div>
  )
}

type DevSubTabKey = 'treinamento' | 'inova'

const DEV_SUB_TABS: { key: DevSubTabKey; label: string }[] = [
  { key: 'treinamento', label: 'Treinamento' },
  { key: 'inova', label: 'Comunidade INOVA' },
]

function isDevSubTabKey(value: string | null): value is DevSubTabKey {
  return DEV_SUB_TABS.some((item) => item.key === value)
}

/**
 * Guarda-chuva de trilhas: Treinamento (o que já existia como aba
 * "Treinamentos") e Comunidade INOVA (acessos ao Guia AI First) — cada uma
 * com seu próprio painel de analytics, o mesmo recorte de período/setor da
 * seção.
 */
function DesenvolvimentoTab({ window, sectorId }: TabProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedSub = searchParams.get('sub')
  const sub: DevSubTabKey = isDevSubTabKey(requestedSub) ? requestedSub : 'treinamento'

  function selectSub(key: DevSubTabKey) {
    const next = new URLSearchParams(searchParams)
    next.set('sub', key)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="flex flex-col gap-lg">
      <div
        role="tablist"
        aria-label="Trilhas de Desenvolvimento"
        className="flex w-fit gap-1 rounded-xl border border-outline-variant/40 bg-surface-container-low p-1"
      >
        {DEV_SUB_TABS.map((item) => {
          const active = sub === item.key
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectSub(item.key)}
              className={[
                'rounded-lg px-md py-sm font-label text-label-md transition-colors',
                active
                  ? 'bg-primary/10 font-bold text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
              ].join(' ')}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      {sub === 'treinamento' && <TrainingAnalyticsTab window={window} sectorId={sectorId} />}
      {sub === 'inova' && <InovaAnalyticsTab window={window} sectorId={sectorId} />}
    </div>
  )
}

// ----- Casca -----

export function PeopleAnalyticsSection() {
  const { user } = useAuth()
  const isSubadmin = isSectorAdminOnly(user)
  // A aba ativa vai na URL: é o que permite a `/admin/clima` (removida do menu
  // na desduplicação do termômetro) redirecionar para o lugar certo, e o que
  // torna o link de uma aba compartilhável — mesmo padrão da `LearningPage`.
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('aba')
  const tab: TabKey = isTabKey(requested) ? requested : 'dashboard'
  const [window, setWindow] = useState<AnalyticsWindowRequest>({ range: '30d' })
  // O SUBADMIN não escolhe setor: a API sempre usa o do token.
  const [sectorId, setSectorId] = useState('')
  const { sectors } = useAnalyticsFilters()

  function selectTab(key: TabKey) {
    const next = new URLSearchParams(searchParams)
    next.set('aba', key)
    setSearchParams(next, { replace: true })
  }

  return (
    <section className="flex flex-col gap-lg">
      <header className="flex flex-wrap items-end justify-between gap-md">
        <div>
          <h2 className="font-headline text-headline-lg text-on-surface">People Analytics</h2>
          <p className="mt-2 text-body-md text-on-surface-variant">
            Adoção, perfis e clima do time — tudo no mesmo recorte de período e setor.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-md">
          {/* O atalho "Hoje" ficou apagado na aba Clima enquanto a série do
              termômetro exigia 7 dias. A G&G pediu justamente para ver o dia
              corrente, MOOD_OVERVIEW_MIN_DAYS caiu para 1 e a rota já responde
              — não há mais atalho a desligar aqui. */}
          <PeriodFilter value={window} onChange={setWindow} />
          {!isSubadmin && (
            <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
              Setor
              <Select
                ariaLabel="Setor"
                value={sectorId}
                onChange={setSectorId}
                options={[
                  { value: '', label: 'Todos os setores' },
                  ...sectors.map((sector) => ({ value: sector.id, label: sector.name })),
                ]}
              />
            </label>
          )}
        </div>
      </header>

      <div role="tablist" aria-label="Seções do People Analytics" className="flex flex-wrap gap-1 rounded-xl border border-outline-variant/40 bg-surface-container-low p-1">
        {TABS.map((item) => {
          const active = tab === item.key
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(item.key)}
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

      {tab === 'dashboard' && <DashboardTab window={window} sectorId={sectorId} />}
      {tab === 'overview' && <OverviewTab window={window} sectorId={sectorId} />}
      {/* A ficha é a listagem de pessoas que já existe — reusada, não duplicada. */}
      {tab === 'profile' && <CollaboratorsSection />}
      {/* O termômetro completo, que era uma página à parte em `/admin/clima`.
          O recorte vem daqui: o painel é controlado, sem filtro próprio. */}
      {tab === 'clima' && <MoodOverviewSection window={window} sectorId={sectorId} />}
      {tab === 'engajamento' && <EngagementTab window={window} sectorId={sectorId} />}
      {/* Como o Clima: o recorte vem do cabeçalho, o painel não tem filtro de
          período próprio. A categoria de comunicado, essa sim, é dele. */}
      {tab === 'comunicacao' && <CommunicationPanel window={window} sectorId={sectorId} />}
      {tab === 'desenvolvimento' && <DesenvolvimentoTab window={window} sectorId={sectorId} />}
    </section>
  )
}
