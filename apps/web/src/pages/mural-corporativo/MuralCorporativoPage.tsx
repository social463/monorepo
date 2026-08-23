import { Link } from 'react-router-dom'
import { BrandName } from '../../components/BrandLogo'
import { TopEngagementCard } from '../../components/TopEngagementCard'
import { HowToEarnPointsCard } from './HowToEarnPointsCard'
import { MuralCorporativoFeed } from './MuralCorporativoFeed'

export function MuralCorporativoPage() {
  // A conexão de tempo real vive no MuralCorporativoFeed (ao vivo onde aparecer).
  // Sem item no menu lateral: entra-se pela Home ("Ver tudo"), daí a seta de voltar.
  return (
    <section className="mx-auto max-w-page p-lg md:p-xl">
      <h1 className="mb-xs font-headline text-headline-xl text-on-surface">Feed Corporativo</h1>
      {/* "com o time EMR" no desenho da G&G vira o nome da EMPRESA: a tela é a
          mesma para todo tenant, e a marca vem do `BrandProvider`. */}
      <p className="mb-sm text-body-sm text-on-surface-variant">
        Compartilhe, interaja e acumule pontos com o time <BrandName />.
      </p>
      <Link
        to="/mural-corporativo/meus-envios"
        className="mb-lg inline-block font-label text-label-md text-primary hover:underline"
      >
        Meus envios
      </Link>

      {/* Duas colunas a partir de lg: o feed manda, e a lateral responde às duas
          perguntas que a G&G pediu junto do Feed — quanto vale cada interação e
          quem está na frente. Abaixo de lg a lateral vai para o fim da página:
          empurrar o placar antes do composer esconderia o que se veio fazer. */}
      <div className="grid items-start gap-lg lg:grid-cols-[minmax(0,1fr)_320px]">
        <MuralCorporativoFeed />

        {/* `sticky`: a coluna acompanha o scroll infinito do feed, senão ela
            some depois de duas rolagens e o ranking deixa de existir. */}
        <aside className="flex flex-col gap-lg lg:sticky lg:top-lg">
          <HowToEarnPointsCard />
          {/* 10, e não os 5 da Home: aqui a lista é o único bloco abaixo de
              "Como ganhar pontos" e acompanha um feed que rola sem fim. */}
          <TopEngagementCard limit={10} />
        </aside>
      </div>
    </section>
  )
}
