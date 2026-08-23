import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  canAdminister,
  canSeeCorporateMural,
  isFullAdmin,
  isLeaderRole,
  isSectorAdminOnly,
  type FeatureKey,
} from '@legends/shared'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { BrandProvider } from './brand/BrandContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { OfficeSessionProvider } from './office/session/OfficeSessionContext'
import { OfficePipWindow } from './office/pip/OfficePipWindow'
import { AppLayout } from './components/AppLayout'
import { LoginPage } from './pages/LoginPage'
import { TeamPage } from './pages/TeamPage'
import { LegendsPage } from './pages/LegendsPage'
import { VotePage } from './pages/VotePage'
import { CultureHubPage } from './pages/culture/CultureHubPage'
import { BenefitDetailPage } from './pages/culture/BenefitDetailPage'
import { ManifestoPage } from './pages/culture/ManifestoPage'
import { ManualDetailPage } from './pages/culture/ManualDetailPage'
import { EngagementPage } from './pages/EngagementPage'
import { RankingPage } from './pages/RankingPage'
import { ProfilePage } from './pages/ProfilePage'
import { CharacterEditorPage } from './pages/CharacterEditorPage'
import { AdminLayout } from './pages/admin/AdminLayout'
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage'
import { AdminAuditLogPage } from './pages/admin/AdminAuditLogPage'
import { PeriodsSection } from './pages/admin/PeriodsSection'
import { SectorsSection } from './pages/admin/SectorsSection'
import { CollaboratorsSection } from './pages/admin/CollaboratorsSection'
import { PeopleAnalyticsSection } from './pages/admin/PeopleAnalyticsSection'
import { ThirdPartySection } from './pages/admin/ThirdPartySection'
import { SquadsSection } from './pages/admin/SquadsSection'
import { CategoriesSection } from './pages/admin/CategoriesSection'
import { BadgesSection } from './pages/admin/BadgesSection'
import { ChallengesSection } from './pages/admin/ChallengesSection'
import { ChallengeSubmissionsSection } from './pages/admin/ChallengeSubmissionsSection'
import { CoinsSection } from './pages/admin/CoinsSection'
import { XpSection } from './pages/admin/XpSection'
import { EngagementSection } from './pages/admin/EngagementSection'
import { StoreSection } from './pages/admin/StoreSection'
import { DevelopmentThursdaySection } from './pages/admin/DevelopmentThursdaySection'
import { DevelopmentSection } from './pages/admin/DevelopmentSection'
import { CoursesSection } from './pages/admin/CoursesSection'
import { CertificateTemplatesSection } from './pages/admin/CertificateTemplatesSection'
import { CertificateRequestsSection } from './pages/admin/CertificateRequestsSection'
import { RetrospectivesSection } from './pages/admin/RetrospectivesSection'
import { CalendarEventsSection } from './pages/admin/CalendarEventsSection'
import { ModerationSection } from './pages/admin/ModerationSection'
import { MoodOverviewSection } from './pages/admin/MoodOverviewSection'
import { OfficeSection } from './pages/admin/OfficeSection'
import { MapsSection } from './pages/admin/MapsSection'
import { AdministratorsSection } from './pages/admin/AdministratorsSection'
import { CalendarSection } from './pages/admin/CalendarSection'
import { HrDashboardsSection } from './pages/admin/HrDashboardsSection'
import { BenchmarkAgentSection } from './pages/admin/BenchmarkAgentSection'
import { GlassAgentSection } from './pages/admin/glass/GlassAgentSection'
import { AiSettingsSection } from './pages/admin/AiSettingsSection'
import { KnowledgeBaseSection } from './pages/admin/KnowledgeBaseSection'
import { CampaignsSection } from './pages/admin/CampaignsSection'
import { CalendarPage } from './pages/calendar/CalendarPage'
import { ManifestoSection } from './pages/admin/culture/ManifestoSection'
import { ManualsSection } from './pages/admin/culture/ManualsSection'
import { BenefitsSection } from './pages/admin/culture/BenefitsSection'
import { KitVisualSection } from './pages/admin/culture/KitVisualSection'
import { EventAlbumsSection } from './pages/admin/EventAlbumsSection'
import { GalleryPage } from './pages/GalleryPage'
import { AlbumPage } from './pages/AlbumPage'
import { HighlightsPage } from './pages/HighlightsPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { RetrosPage, RetroSprintPage } from './pages/RetrosPage'
import { RetroRoomPage } from './pages/RetroRoomPage'
import { ResenhaPage } from './pages/resenha/ResenhaPage'
import { MuralCorporativoPage } from './pages/mural-corporativo/MuralCorporativoPage'
import { MeusEnviosPage } from './pages/mural-corporativo/MeusEnviosPage'
import { AdminResenhaPage } from './pages/AdminResenhaPage'
import { HomePage } from './pages/HomePage'
import { BirthdaysPage } from './pages/BirthdaysPage'
import { GameManualPage } from './pages/GameManualPage'
import { LeadershipPage } from './pages/LeadershipPage'
import { VacationsPage } from './pages/VacationsPage'
import { MuralFeedbacksPage } from './pages/mural-feedbacks/MuralFeedbacksPage'
import { ChallengesPage } from './pages/ChallengesPage'
import { StorePage } from './pages/StorePage'
import { SuperAdminPage } from './pages/SuperAdminPage'
import { CompanyDashboardPage } from './pages/CompanyDashboardPage'
import { AdoptionPage } from './pages/super-admin/AdoptionPage'
import { SuperAdminLayout } from './pages/super-admin/SuperAdminLayout'
import { DevelopmentThursdayPage } from './pages/DevelopmentThursdayPage'
import { LearningPage } from './pages/learning/LearningPage'
import { CoursePlayerPage } from './pages/learning/CoursePlayerPage'
import { QuizPage } from './pages/learning/QuizPage'
import { CertificatePage } from './pages/learning/CertificatePage'
import { PdiPage } from './pages/pdi/PdiPage'
import { OneOnOnePage } from './pages/one-on-one/OneOnOnePage'
import { OneOnOneDetailPage } from './pages/one-on-one/OneOnOneDetailPage'
import { OneOnOneTopicsSection } from './pages/admin/OneOnOneTopicsSection'
import { GuestInvitePage } from './pages/GuestInvitePage'
import { ThirdPartyInvitePage } from './pages/ThirdPartyInvitePage'
import { GuestThanksPage } from './pages/GuestThanksPage'
import { readOfficeGuestSession } from './lib/officeGuestSession'

const OfficePage = lazy(() =>
  import('./pages/OfficePage').then((m) => ({ default: m.OfficePage })),
)

const OfficeMapEditorPage = lazy(() =>
  import('./pages/admin/OfficeMapEditorPage').then((m) => ({ default: m.OfficeMapEditorPage })),
)

const queryClient = new QueryClient()

/** Bloqueia admins (ADMIN ou SUBADMIN): eles não votam nem têm perfil. */
function DevOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.role === 'ADMIN' || user?.role === 'SUBADMIN') return <Navigate to="/admin" replace />
  return <>{children}</>
}

/** Restringe a rota a quem administra: ADMIN, SUBADMIN ou acesso delegado. */
function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user && !canAdminister(user)) return <Navigate to="/" replace />
  return <>{children}</>
}

/**
 * Restringe a rota ao poder de ADMIN pleno — Subadmin cai no Dashboard do admin.
 * O acesso administrativo delegado é pleno, então entra aqui.
 */
function StrictAdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user && isSectorAdminOnly(user)) return <Navigate to="/admin" replace />
  if (user && !isFullAdmin(user)) return <Navigate to="/" replace />
  return <>{children}</>
}

/**
 * Rota de admin que, entre os SUBADMINs, só libera o setor com a feature ligada.
 * Espelha `app.requireSectorFeature` na API — sem isso, um subadmin de outro
 * setor abriria a tela pela URL e só descobriria pelo 403 de cada request.
 * Diferente do `FeatureGate`, que deixa qualquer ADMIN/SUBADMIN passar.
 */
function AdminSectorFeatureOnly({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return <>{children}</>
  if (isFullAdmin(user)) return <>{children}</>
  if (user.role === 'SUBADMIN' && user.sectorFeatures.includes(feature)) return <>{children}</>
  return <Navigate to="/admin" replace />
}

/**
 * Hub da liderança: papel de líder (LEAD, MANAGER, HEAD), ADMIN, ou quem tem o
 * bloco de Gente e Gestão no setor. Espelha o filtro `leadershipOnly` do menu —
 * sem isto a URL abriria direto para qualquer pessoa.
 */
function LeadershipOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return <>{children}</>
  if (isFullAdmin(user) || isLeaderRole(user.role)) return <>{children}</>
  if (user.sectorFeatures.includes('gente-gestao' as FeatureKey)) return <>{children}</>
  return <Navigate to="/" replace />
}

/** Restringe a rota exclusivamente à equipe interna (SUPER_ADMIN). */
function SuperAdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user && user.role !== 'SUPER_ADMIN') return <Navigate to="/" replace />
  return <>{children}</>
}

/** Bloqueia quem não tem a feature habilitada (pelo setor, ou pela allowlist individual se for terceirizado). Admin e Subadmin sempre passam. */
function FeatureGate({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  const { user } = useAuth()
  if (!user || user.role === 'ADMIN' || user.role === 'SUBADMIN') return <>{children}</>
  const enabled = user.role === 'THIRD_PARTY' ? user.enabledFeatures : user.sectorFeatures
  if (!enabled.includes(feature)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

/** O Mural da empresa não é gated por setor (ver `canSeeCorporateMural`): só o
 * terceirizado precisa da feature na allowlist individual. */
function CorporateMuralGate({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (!canSeeCorporateMural({ role: user?.role, features: user?.enabledFeatures })) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

/**
 * Página inicial: o "pulso do time" (Home feed-first) para não-admin. Admins
 * (ADMIN ou SUBADMIN) vão para o painel de administração. (Esta rota vive
 * dentro do ProtectedRoute, então sempre há usuário autenticado aqui.)
 */
function HomeRoute() {
  const { user } = useAuth()
  if (user?.role === 'SUPER_ADMIN') return <Navigate to="/super-admin" replace />
  if (user?.role === 'ADMIN' || user?.role === 'SUBADMIN') return <Navigate to="/admin" replace />
  return <HomePage />
}

function OfficeLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden bg-[#15151a] px-lg text-on-surface">
      <div className="relative flex w-full max-w-sm flex-col items-center gap-lg text-center">
        <div className="relative h-40 w-56 overflow-hidden rounded-2xl border border-outline-variant/35 bg-[#24242c] shadow-2xl">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:32px_32px]" />
          <div className="absolute left-6 top-7 h-10 w-16 rounded-sm bg-[#5a4632]/80" />
          <div className="absolute right-7 top-9 h-10 w-16 rounded-sm bg-[#5a4632]/80" />
          <div className="absolute bottom-8 left-8 h-12 w-24 rounded-sm bg-primary/15 ring-1 ring-primary/25" />
          <div className="absolute bottom-7 right-8 h-9 w-12 rounded-sm bg-[#2f5d3a]/90" />
          <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-10 -translate-y-1 rounded-full bg-primary/70 animate-ping" />
          <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-2 translate-y-4 rounded-full bg-primary/60 animate-pulse" />
          <span className="absolute left-1/2 top-1/2 h-2 w-2 translate-x-8 -translate-y-4 rounded-full bg-primary/50 animate-pulse" />
          <div className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 animate-bounce items-center justify-center rounded-full border-4 border-[#8bd3e6] bg-[#9bd7ed] font-label text-label-lg text-[#24505f] shadow-lg">
            L
            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#24242c] bg-green-500" />
          </div>
        </div>
        <div>
          <p className="font-label text-[11px] uppercase tracking-wide text-primary">Escritório virtual</p>
          <h1 className="mt-xs font-headline text-headline-sm text-on-surface">Entrando no escritório</h1>
          <p className="mt-xs font-body text-body-sm text-on-surface-variant">
            Posicionando avatares, salas e conversas por proximidade...
          </p>
        </div>
        <div className="flex items-center gap-xs" aria-hidden>
          <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.2s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.1s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-primary" />
        </div>
      </div>
    </div>
  )
}

function OfficeRoute() {
  const { user, loading } = useAuth()
  const guestSession = readOfficeGuestSession()
  if (loading) return <OfficeLoadingFallback />
  if (user) {
    return (
      <DevOnly>
        <FeatureGate feature="escritorio">
          <Suspense fallback={<OfficeLoadingFallback />}>
            <OfficePage />
          </Suspense>
        </FeatureGate>
      </DevOnly>
    )
  }
  if (guestSession) {
    return (
      <Suspense fallback={<OfficeLoadingFallback />}>
        <OfficePage />
      </Suspense>
    )
  }
  return <Navigate to="/login" replace />
}

function GuestAccessBoundary({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  const guestSession = readOfficeGuestSession()
  const allowed =
    location.pathname === '/escritorio' ||
    location.pathname === '/convidado/obrigado' ||
    location.pathname.startsWith('/convidado/')

  if (!loading && !user && guestSession && !allowed) {
    return <Navigate to="/escritorio" replace />
  }
  return <>{children}</>
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Acima do AuthProvider: a tela de login precisa da marca certa, e nesse
          momento ainda não existe token — quem resolve o tenant é o subdomínio. */}
      <BrandProvider>
        <AuthProvider>
          <BrowserRouter>
            <OfficeSessionProvider>
              <GuestAccessBoundary>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/convidado/obrigado" element={<GuestThanksPage />} />
                  <Route path="/convidado/:token" element={<GuestInvitePage />} />
                  <Route path="/terceirizado/convite/:token" element={<ThirdPartyInvitePage />} />
                  {/* Verificação de certificado: pública de propósito (é o link do LinkedIn). */}
                  <Route path="/certificado/:code" element={<CertificatePage />} />
                  <Route
                    path="/alterar-senha"
                    element={
                      <ProtectedRoute>
                        <ChangePasswordPage />
                      </ProtectedRoute>
                    }
                  />
                  {/* Console do super admin: shell próprio (SuperAdminLayout), fora
                      do AppLayout — o menu do produto é do tenant, não dele. */}
                  <Route
                    element={
                      <ProtectedRoute>
                        <SuperAdminOnly>
                          <SuperAdminLayout />
                        </SuperAdminOnly>
                      </ProtectedRoute>
                    }
                  >
                    <Route path="/super-admin" element={<SuperAdminPage />} />
                    <Route path="/super-admin/adocao" element={<AdoptionPage />} />
                    <Route path="/super-admin/companies/:id" element={<CompanyDashboardPage />} />
                  </Route>
                  <Route
                    path="/retrospectivas/:id"
                    element={
                      <ProtectedRoute>
                        <DevOnly>
                          <FeatureGate feature="retrospectivas">
                            <RetroRoomPage />
                          </FeatureGate>
                        </DevOnly>
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/escritorio" element={<OfficeRoute />} />
                  <Route
                    path="/admin/mapas/:mapId/editar"
                    element={
                      <ProtectedRoute>
                        <StrictAdminOnly>
                          <Suspense fallback={<p className="p-lg text-on-surface-variant">Abrindo o editor…</p>}>
                            <OfficeMapEditorPage />
                          </Suspense>
                        </StrictAdminOnly>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    element={
                      <ProtectedRoute>
                        <AppLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route path="/" element={<HomeRoute />} />
                    {/* O link antigo agora leva à tela própria de aniversariantes. */}
                    <Route path="/aniversarios" element={<Navigate to="/aniversariantes" replace />} />
                    <Route path="/aniversariantes" element={<BirthdaysPage />} />
                    <Route path="/ferias" element={<VacationsPage />} />
                    <Route path="/manual-game" element={<GameManualPage />} />
                    <Route
                      path="/lideranca"
                      element={
                        <LeadershipOnly>
                          <LeadershipPage />
                        </LeadershipOnly>
                      }
                    />
                    {/*
                      Organograma pela entrada da Liderança: só os liderados
                      diretos. A visão completa da empresa continua em `/time`,
                      e daqui só o Admin/G&G tem link para ela.
                    */}
                    <Route
                      path="/lideranca/organograma"
                      element={
                        <LeadershipOnly>
                          <FeatureGate feature="time">
                            <TeamPage scope="direct-reports" />
                          </FeatureGate>
                        </LeadershipOnly>
                      }
                    />
                    <Route
                      path="/calendario"
                      element={
                        <FeatureGate feature="calendario">
                          <CalendarPage />
                        </FeatureGate>
                      }
                    />
                    <Route
                      path="/time"
                      element={
                        <FeatureGate feature="time">
                          <TeamPage />
                        </FeatureGate>
                      }
                    />
                    <Route
                      path="/lendas"
                      element={
                        <FeatureGate feature="lendas">
                          <LegendsPage />
                        </FeatureGate>
                      }
                    />
                    <Route
                      path="/votar"
                      element={
                        <DevOnly>
                          <FeatureGate feature="votar">
                            <VotePage />
                          </FeatureGate>
                        </DevOnly>
                      }
                    />
                    <Route
                      path="/engajamento"
                      element={
                        // Só `selos`: desde que a aba de EMR Coins saiu, a
                        // página é a galeria de emblemas e nada mais.
                        <FeatureGate feature="selos">
                          <EngagementPage />
                        </FeatureGate>
                      }
                    />
                    {/* Sem gate de feature, como o XP: o ranking é a leitura
                        pública dos MESMOS pontos que aparecem no card de perfil
                        de todo mundo. Empresa sem regra de XP vê um ranking
                        zerado, não uma rota quebrada. */}
                    <Route path="/ranking" element={<RankingPage />} />
                    {/* Rota antiga da galeria: links salvos, o card da Home e as
                        notificações de selo continuam funcionando pelo redirect. */}
                    <Route path="/selos" element={<Navigate to="/engajamento" replace />} />
                    <Route path="/cultura" element={<CultureHubPage />} />
                    {/* Manifesto em rota própria: é o texto mais longo do produto
                        e o que mais se manda por link. A aba antiga redireciona. */}
                    <Route path="/manifesto" element={<ManifestoPage />} />
                    <Route path="/galeria" element={<FeatureGate feature="galeria"><GalleryPage /></FeatureGate>} />
                    {/* Álbum em rota própria: sem isso não dá para mandar o
                        link de um evento para o time. */}
                    <Route path="/galeria/:albumId" element={<FeatureGate feature="galeria"><AlbumPage /></FeatureGate>} />
                    {/* Detalhe em tela própria: o corpo do benefício é longo demais
                        para um modal, e assim o link é compartilhável. */}
                    <Route path="/cultura/beneficios/:benefitId" element={<BenefitDetailPage />} />
                    <Route path="/cultura/manuais/:manualId" element={<ManualDetailPage />} />
                    <Route
                      path="/destaques"
                      element={
                        <FeatureGate feature="destaques">
                          <HighlightsPage />
                        </FeatureGate>
                      }
                    />
                    <Route
                      path="/notificacoes"
                      element={
                        <FeatureGate feature="notificacoes">
                          <NotificationsPage />
                        </FeatureGate>
                      }
                    />
                    <Route
                      path="/resenha"
                      element={
                        <FeatureGate feature="resenha">
                          <ResenhaPage />
                        </FeatureGate>
                      }
                    />
                    <Route
                      path="/mural-corporativo"
                      element={
                        <CorporateMuralGate>
                          <MuralCorporativoPage />
                        </CorporateMuralGate>
                      }
                    />
                    <Route
                      path="/mural-corporativo/meus-envios"
                      element={
                        <CorporateMuralGate>
                          <MeusEnviosPage />
                        </CorporateMuralGate>
                      }
                    />
                    <Route
                      path="/quinta-desenvolvimento"
                      element={
                        <FeatureGate feature="quinta-desenvolvimento">
                          <DevelopmentThursdayPage />
                        </FeatureGate>
                      }
                    />
                    <Route
                      path="/aprendizado"
                      element={
                        <FeatureGate feature="aprendizado">
                          <LearningPage />
                        </FeatureGate>
                      }
                    />
                    <Route
                      path="/aprendizado/curso/:id"
                      element={
                        <FeatureGate feature="aprendizado">
                          <CoursePlayerPage />
                        </FeatureGate>
                      }
                    />
                    <Route
                      path="/aprendizado/quiz/:id"
                      element={
                        <FeatureGate feature="aprendizado">
                          <QuizPage />
                        </FeatureGate>
                      }
                    />
                    <Route
                      path="/pdi"
                      element={
                        <DevOnly>
                          <FeatureGate feature="pdi">
                            <PdiPage />
                          </FeatureGate>
                        </DevOnly>
                      }
                    />
                    <Route
                      path="/1-1"
                      element={
                        <DevOnly>
                          <FeatureGate feature="um-a-um">
                            <OneOnOnePage />
                          </FeatureGate>
                        </DevOnly>
                      }
                    />
                    <Route
                      path="/1-1/:id"
                      element={
                        <DevOnly>
                          <FeatureGate feature="um-a-um">
                            <OneOnOneDetailPage />
                          </FeatureGate>
                        </DevOnly>
                      }
                    />
                    <Route path="/mural-feedbacks" element={<MuralFeedbacksPage />} />
                    <Route path="/perfil/:id" element={<ProfilePage />} />
                    <Route
                      path="/desafios"
                      element={
                        <FeatureGate feature="desafios">
                          <ChallengesPage />
                        </FeatureGate>
                      }
                    />
                    <Route
                      path="/loja"
                      element={
                        <FeatureGate feature="coins">
                          <StorePage />
                        </FeatureGate>
                      }
                    />
                    <Route path="/personagem" element={<CharacterEditorPage />} />
                    <Route
                      path="/retrospectivas"
                      element={
                        <DevOnly>
                          <FeatureGate feature="retrospectivas">
                            <RetrosPage />
                          </FeatureGate>
                        </DevOnly>
                      }
                    />
                    <Route
                      path="/retrospectivas/sprint/:sprint"
                      element={
                        <DevOnly>
                          <FeatureGate feature="retrospectivas">
                            <RetroSprintPage />
                          </FeatureGate>
                        </DevOnly>
                      }
                    />
                    <Route
                      path="/admin"
                      element={
                        <AdminOnly>
                          <AdminLayout />
                        </AdminOnly>
                      }
                    >
                      <Route index element={<AdminDashboardPage />} />
                      <Route path="pessoas" element={<AdminSectorFeatureOnly feature="gente-gestao"><PeopleAnalyticsSection /></AdminSectorFeatureOnly>} />
                      <Route path="setores" element={<StrictAdminOnly><SectorsSection /></StrictAdminOnly>} />
                      <Route path="lendas" element={<CollaboratorsSection />} />
                      <Route path="terceirizados" element={<ThirdPartySection />} />
                      <Route path="squads" element={<SquadsSection />} />
                      <Route path="periodos" element={<PeriodsSection />} />
                      <Route path="categorias" element={<CategoriesSection />} />
                      <Route path="selos" element={<BadgesSection />} />
                      <Route path="coins" element={<StrictAdminOnly><CoinsSection /></StrictAdminOnly>} />
                      <Route path="xp" element={<StrictAdminOnly><XpSection /></StrictAdminOnly>} />
                      {/* Leitura da economia de XP. ADMIN global, como o CRUD
                          de regras: as regras são da empresa, não do setor. */}
                      <Route path="engajamento" element={<StrictAdminOnly><EngagementSection /></StrictAdminOnly>} />
                      <Route path="loja" element={<AdminSectorFeatureOnly feature="gente-gestao"><StoreSection /></AdminSectorFeatureOnly>} />
                      <Route path="quinta-dev" element={<AdminSectorFeatureOnly feature="desenvolvimento-produto"><DevelopmentThursdaySection /></AdminSectorFeatureOnly>} />
                      <Route path="cursos" element={<AdminSectorFeatureOnly feature="gente-gestao"><CoursesSection /></AdminSectorFeatureOnly>} />
                      {/* Certificado é parte de Cursos: mesmo bloco de G&G. Modelo leva
                          StrictAdminOnly por cima porque a API é `requireAdmin`. */}
                      <Route
                        path="certificados/modelos"
                        element={<AdminSectorFeatureOnly feature="gente-gestao"><StrictAdminOnly><CertificateTemplatesSection /></StrictAdminOnly></AdminSectorFeatureOnly>}
                      />
                      <Route
                        path="certificados/fila"
                        element={<AdminSectorFeatureOnly feature="gente-gestao"><CertificateRequestsSection /></AdminSectorFeatureOnly>}
                      />
                      <Route path="desenvolvimento" element={<StrictAdminOnly><DevelopmentSection /></StrictAdminOnly>} />
                      <Route path="retrospectivas" element={<AdminSectorFeatureOnly feature="desenvolvimento-produto"><RetrospectivesSection /></AdminSectorFeatureOnly>} />
                      <Route path="eventos" element={<AdminSectorFeatureOnly feature="desenvolvimento-produto"><CalendarEventsSection /></AdminSectorFeatureOnly>} />
                      <Route path="moderacao" element={<ModerationSection />} />
                      <Route path="desafios" element={<ChallengesSection />} />
                      <Route path="resultados-desafios" element={<ChallengeSubmissionsSection />} />
                      <Route path="clima" element={<AdminSectorFeatureOnly feature="gente-gestao"><MoodOverviewSection /></AdminSectorFeatureOnly>} />
                      <Route path="topicos-1-1" element={<AdminSectorFeatureOnly feature="gente-gestao"><OneOnOneTopicsSection /></AdminSectorFeatureOnly>} />
                      <Route path="paineis" element={<AdminSectorFeatureOnly feature="gente-gestao"><HrDashboardsSection /></AdminSectorFeatureOnly>} />
                      <Route
                        path="benchmarking"
                        element={
                          <AdminSectorFeatureOnly feature="gente-gestao">
                            <BenchmarkAgentSection />
                          </AdminSectorFeatureOnly>
                        }
                      />
                      <Route
                        path="glass"
                        element={
                          <AdminSectorFeatureOnly feature="gente-gestao">
                            <GlassAgentSection />
                          </AdminSectorFeatureOnly>
                        }
                      />
                      <Route path="base-conhecimento" element={<KnowledgeBaseSection />} />
                      <Route
                        path="campanhas"
                        element={
                          <AdminSectorFeatureOnly feature="gente-gestao">
                            <CampaignsSection />
                          </AdminSectorFeatureOnly>
                        }
                      />
                      <Route path="cultura/manifesto" element={<AdminSectorFeatureOnly feature="gente-gestao"><ManifestoSection /></AdminSectorFeatureOnly>} />
                      <Route path="cultura/manuais" element={<AdminSectorFeatureOnly feature="gente-gestao"><ManualsSection /></AdminSectorFeatureOnly>} />
                      <Route path="cultura/beneficios" element={<AdminSectorFeatureOnly feature="gente-gestao"><BenefitsSection /></AdminSectorFeatureOnly>} />
                      <Route path="cultura/kit-visual" element={<AdminSectorFeatureOnly feature="gente-gestao"><KitVisualSection /></AdminSectorFeatureOnly>} />
                      <Route path="galeria" element={<AdminSectorFeatureOnly feature="gente-gestao"><EventAlbumsSection /></AdminSectorFeatureOnly>} />
                      <Route path="resenha" element={<AdminResenhaPage />} />
                      <Route path="escritorio" element={<StrictAdminOnly><OfficeSection /></StrictAdminOnly>} />
                      <Route path="mapas" element={<StrictAdminOnly><MapsSection /></StrictAdminOnly>} />
                      <Route path="auditoria" element={<StrictAdminOnly><AdminAuditLogPage /></StrictAdminOnly>} />
                      <Route path="calendario" element={<StrictAdminOnly><CalendarSection /></StrictAdminOnly>} />
                      <Route path="ia" element={<StrictAdminOnly><AiSettingsSection /></StrictAdminOnly>} />
                      <Route path="administradores" element={<StrictAdminOnly><AdministratorsSection /></StrictAdminOnly>} />
                    </Route>
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </GuestAccessBoundary>
              <OfficePipWindow />
            </OfficeSessionProvider>
          </BrowserRouter>
        </AuthProvider>
      </BrandProvider>
    </QueryClientProvider>
  )
}
