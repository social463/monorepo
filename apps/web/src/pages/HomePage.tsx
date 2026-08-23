import { BirthdayConfetti } from '../components/BirthdayConfetti'
import { BirthdaysCard } from '../components/BirthdaysCard'
import { CorporateFeedPreview } from '../components/CorporateFeedPreview'
import { FeedbackWallSection } from '../components/FeedbackWallSection'
import { HomeProfileCard } from '../components/HomeProfileCard'
import { MonthVacationsCard } from '../components/MonthVacationsCard'
import { MuralBanner } from '../components/MuralBanner'
import { TopEngagementCard } from '../components/TopEngagementCard'
import { VotingBanner } from '../components/VotingBanner'
import { WorkAnniversariesCard } from '../components/WorkAnniversariesCard'
import { useAuth } from '../auth/AuthContext'
import { canSeeCorporateMural } from '@legends/shared'
import { MoodOfDay } from './profile/MoodOfDay'

/** Bom dia / Boa tarde / Boa noite pela hora local de quem está olhando. */
function greetingFor(date: Date): string {
  const hour = date.getHours()
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

/**
 * Home em três colunas: **quem eu sou** à esquerda, **o que a empresa está
 * comunicando** no meio, **datas do time** à direita — com uma faixa de
 * boas-vindas e o termômetro de humor no topo.
 *
 * A pilha vertical anterior escondia cada assunto numa altura diferente da
 * página; aqui eles aparecem juntos, e só a coluna do meio rola de verdade.
 *
 * O termômetro some assim que a pessoa responde o dia (ver `MoodOfDay`), e a
 * faixa de boas-vindas então ocupa a linha inteira.
 */
export function HomePage({ now = new Date() }: { now?: Date }) {
  const { user } = useAuth()
  const showCorporateMural = canSeeCorporateMural({
    role: user?.role,
    features: user?.enabledFeatures,
  })
  const firstName = user?.name.split(' ')[0] ?? ''

  return (
    <section className="mx-auto flex w-full max-w-page flex-col gap-lg p-lg md:p-xl">
      <BirthdayConfetti />
      <VotingBanner />
      <MuralBanner />

      {/* Faixa do topo: saudação + termômetro lado a lado. A saudação saiu da
          barra superior, onde disputava espaço com a busca. */}
      {/* `items-start`: a faixa NÃO acompanha a altura do termômetro. Esticando
          junto, ela virava um retângulo vazio de meia tela quando o painel de
          motivo abria. O `min-h` é só cosmético — iguala as duas caixas
          enquanto o termômetro está fechado, que é o estado mais comum. */}
      <div className="grid items-start gap-lg xl:grid-cols-[minmax(0,1fr)_560px]">
        <div className="flex flex-col justify-center rounded-2xl border border-outline-variant/40 bg-surface-container-low p-xl xl:min-h-[12rem]">
          <p className="font-label text-label-sm uppercase tracking-widest text-primary">
            Bem-vindo(a) de volta
          </p>
          <h1 className="mt-xs font-headline text-headline-xl text-on-surface">
            {greetingFor(now)}
            {firstName ? `, ${firstName}` : ''}! 👋
          </h1>
          <p className="mt-xs text-body-md text-on-surface-variant">
            Tudo o que importa na sua jornada está aqui.
          </p>
        </div>

        {user && <MoodOfDay />}
      </div>

      <div className="grid items-start gap-lg lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_400px]">
        {user && <HomeProfileCard />}

        <div className="flex flex-col gap-lg">
          {showCorporateMural && <CorporateFeedPreview />}
          <FeedbackWallSection />
        </div>

        {/* Em xl a coluna da direita é própria; abaixo disso ela vira uma faixa
            de cards lado a lado, para não empurrar o feed para baixo da dobra. */}
        <div className="grid gap-lg sm:grid-cols-2 lg:col-span-2 xl:col-span-1 xl:grid-cols-1">
          <BirthdaysCard />
          <WorkAnniversariesCard />
          <MonthVacationsCard />
          {/* Último bloco da coluna, como no protótipo: as datas do time vêm
              primeiro (informação do dia) e o placar fecha a coluna. */}
          <TopEngagementCard />
        </div>
      </div>
    </section>
  )
}
