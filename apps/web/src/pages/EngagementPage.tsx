import { BadgesGallery } from '../components/BadgesGallery'

/**
 * Hub de engajamento: os emblemas conquistados.
 *
 * A aba de EMR Coins saiu daqui. Ela repetia as regras de crédito que o Manual
 * do Game já descreve — duas fontes para o mesmo número divergem no primeiro
 * ajuste de valor. O extrato, que era o único conteúdo exclusivo da aba, foi
 * para a Lojinha (`/loja?tab=extrato`), onde a moeda é gasta.
 */
export function EngagementPage() {
  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header>
        <h1 className="font-headline text-headline-xl text-on-surface">Engajamento</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Suas conquistas e o que você acumulou participando do time.
        </p>
      </header>

      <BadgesGallery />
    </section>
  )
}
