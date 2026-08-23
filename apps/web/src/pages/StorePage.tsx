import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { COIN_CURRENCY_LABEL, STORE_ORDER_STATUS_LABELS, type StoreProductDTO } from '@legends/shared'
import { useAuth } from '../auth/AuthContext'
import { administersBlock } from '../lib/features'
import { useCoinBalance } from '../lib/use-coins'
import { useMyStoreOrders, useRedeemProduct, useStoreProducts } from '../lib/use-store'
import { CoinLedger } from '../components/CoinLedger'
import { Icon } from '../components/Icon'

type StoreTab = 'vitrine' | 'pedidos' | 'extrato'
const TAB_LABELS: Record<StoreTab, string> = {
  vitrine: 'Vitrine',
  pedidos: 'Meus pedidos',
  extrato: 'Extrato',
}

function isStoreTab(value: string | null): value is StoreTab {
  return value === 'vitrine' || value === 'pedidos' || value === 'extrato'
}

/**
 * Lojinha EMR: onde as {@link COIN_CURRENCY_LABEL} viram recompensa.
 *
 * A aba fica na URL (`?tab=`) porque a notificação de decisão do pedido faz
 * deep-link para `/loja?tab=pedidos` e o chip de saldo do cabeçalho, para
 * `/loja?tab=extrato`.
 */
export function StorePage() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab: StoreTab = isStoreTab(requested) ? requested : 'vitrine'

  const balanceQuery = useCoinBalance()
  const balance = balanceQuery.data?.balance ?? 0

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header>
        <h1 className="font-headline text-headline-xl text-on-surface">Lojinha EMR</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Troque suas {COIN_CURRENCY_LABEL} por experiências, conteúdos e equipamentos.
        </p>
      </header>

      <BalanceBanner balance={balance} />

      <div role="tablist" className="flex flex-wrap gap-sm">
        {(Object.keys(TAB_LABELS) as StoreTab[]).map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={tab === option}
            onClick={() => setParams({ tab: option }, { replace: true })}
            className={`rounded-full px-lg py-sm font-label text-label-md transition-colors ${
              tab === option ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
            }`}
          >
            {TAB_LABELS[option]}
          </button>
        ))}
      </div>

      {tab === 'vitrine' && <Showcase balance={balance} />}
      {tab === 'pedidos' && <MyOrders />}
      {tab === 'extrato' && <CoinLedger />}
    </section>
  )
}

/** O saldo em destaque, com o lembrete de que gastar coin não custa XP. */
function BalanceBanner({ balance }: { balance: number }) {
  return (
    <div className="flex flex-col gap-md rounded-2xl border border-primary/20 bg-primary/5 p-lg md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-md">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-[28px] leading-none">
          <span aria-hidden>🪙</span>
        </span>
        <div>
          <p className="font-label text-label-sm uppercase tracking-[0.14em] text-on-surface-variant">
            Saldo atual
          </p>
          <p className="font-headline text-headline-lg font-bold tabular-nums text-on-surface">
            {balance.toLocaleString('pt-BR')}{' '}
            <span className="font-label text-label-lg font-normal text-on-surface-variant">
              {COIN_CURRENCY_LABEL}
            </span>
          </p>
        </div>
      </div>
      <p className="flex items-start gap-sm text-body-sm text-on-surface-variant md:max-w-xs">
        <Icon name="auto_awesome" className="mt-0.5 shrink-0 text-[18px] text-primary" />
        XP do ranking permanece intacto — só as {COIN_CURRENCY_LABEL} são debitadas em compras.
      </p>
    </div>
  )
}

function Showcase({ balance }: { balance: number }) {
  const { data, isLoading } = useStoreProducts()
  const redeem = useRedeemProduct()
  const [confirming, setConfirming] = useState<StoreProductDTO | null>(null)

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Carregando…</p>

  const products = data?.products ?? []
  // Vitrine vazia não é erro: é o estado de hoje, com Gente e Gestão ainda
  // definindo os prêmios. Assim que o primeiro produto é publicado, a vitrine
  // aparece sozinha — sem flag para alguém lembrar de desligar.
  if (products.length === 0) return <ComingSoon balance={balance} />

  return (
    <>
      {redeem.isError && (
        <p role="alert" className="mb-md text-body-sm text-error">
          {redeem.error instanceof Error ? redeem.error.message : 'Não foi possível concluir o resgate.'}
        </p>
      )}

      <ul className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <li key={product.id} className="rounded-lg bg-surface-container p-md">
            {product.imageUrl && (
              <img src={product.imageUrl} alt="" className="mb-sm h-40 w-full rounded-md object-cover" />
            )}
            <p className="text-label-sm text-on-surface-variant">{product.category}</p>
            <h2 className="text-title-md">{product.title}</h2>
            {product.description && (
              <p className="mt-xs text-body-sm text-on-surface-variant">{product.description}</p>
            )}
            <p className="mt-sm text-title-sm">{product.priceInCoins} coins</p>
            <button
              className="mt-sm rounded-full bg-primary px-md py-xs text-label-lg text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
              disabled={balance < product.priceInCoins || redeem.isPending}
              onClick={() => setConfirming(product)}
            >
              Resgatar
            </button>
          </li>
        ))}
      </ul>

      {confirming && (
        <div role="dialog" aria-label="Confirmar resgate" className="mt-lg rounded-lg bg-surface-container p-md">
          <p className="text-body-md">
            Resgatar “{confirming.title}” por {confirming.priceInCoins} coins? O valor sai do seu saldo
            agora e o pedido vai para a fila de Gente e Gestão.
          </p>
          <div className="mt-sm flex gap-sm">
            <button
              className="rounded-full bg-primary px-md py-xs text-label-lg text-on-primary"
              onClick={() => {
                redeem.mutate(confirming.id)
                setConfirming(null)
              }}
            >
              Confirmar resgate
            </button>
            <button className="rounded-full px-md py-xs text-label-lg" onClick={() => setConfirming(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Vitrine em preparação: a mensagem de expectativa enquanto Gente e Gestão
 * define os prêmios. O saldo aparece de novo aqui de propósito — é o que dá
 * sentido a continuar participando antes de existir o que resgatar.
 */
function ComingSoon({ balance }: { balance: number }) {
  const { user } = useAuth()
  const canManage = administersBlock(user, 'gente-gestao')

  return (
    <div className="rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/10 via-surface-container-low to-secondary/10 p-lg md:p-xl">
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <span
          aria-hidden
          className="mb-lg flex h-24 w-24 items-center justify-center rounded-3xl bg-primary/15 text-[48px] leading-none"
        >
          🎁
        </span>

        <span className="mb-md inline-flex items-center gap-sm rounded-full border border-primary/30 bg-primary/10 px-md py-1 font-label text-label-sm uppercase tracking-[0.14em] text-primary">
          <Icon name="auto_awesome" className="text-[16px]" />
          Em breve
        </span>

        <h2 className="font-headline text-headline-lg text-on-surface">
          Preparando os melhores prêmios para você! 🎁
        </h2>

        <p className="mt-md max-w-xl text-body-md text-on-surface-variant">
          A nossa <strong className="text-on-surface">Lojinha EMR</strong> está sendo abastecida com itens
          e vantagens exclusivas. Continue interagindo no portal, junte suas{' '}
          <strong className="text-on-surface">{COIN_CURRENCY_LABEL}</strong> e aguarde… em breve traremos{' '}
          <strong className="text-on-surface">novidades incríveis</strong>!
        </p>

        <p className="mt-lg flex items-center gap-sm rounded-full border border-outline-variant/40 bg-surface px-lg py-sm text-body-sm text-on-surface">
          <span aria-hidden className="text-[20px] leading-none">🪙</span>
          Você já tem{' '}
          <strong className="tabular-nums text-primary">{balance.toLocaleString('pt-BR')}</strong>{' '}
          {COIN_CURRENCY_LABEL} guardadas
        </p>

        <button
          type="button"
          disabled
          className="mt-lg cursor-not-allowed rounded-full bg-surface-container px-xl py-sm font-label text-label-lg text-on-surface-variant opacity-70"
        >
          🔒 Vitrine em preparação
        </button>

        {/* Só quem administra o bloco de Gente e Gestão: colaborador e líder
            não têm painel de Lojinha para acessar. */}
        {canManage && (
          <Link
            to="/admin/loja"
            className="mt-md font-label text-label-md text-primary hover:underline"
          >
            Acessar painel administrativo →
          </Link>
        )}
      </div>
    </div>
  )
}

function MyOrders() {
  const { data, isLoading } = useMyStoreOrders(1)
  if (isLoading) return <p className="text-body-md text-on-surface-variant">Carregando…</p>

  const orders = data?.orders ?? []
  if (orders.length === 0) {
    return <p className="text-body-md text-on-surface-variant">Você ainda não resgatou nada.</p>
  }

  return (
    <ul className="flex flex-col gap-sm">
      {orders.map((order) => (
        <li key={order.id} className="flex items-center justify-between rounded-lg bg-surface-container p-md">
          <div>
            {/* Título congelado no resgate — não é o nome atual do produto. */}
            <p className="text-title-sm">{order.productTitle}</p>
            <p className="text-body-sm text-on-surface-variant">
              {order.pricePaid} coins · {new Date(order.createdAt).toLocaleDateString('pt-BR')}
            </p>
          </div>
          <span className="text-label-lg">{STORE_ORDER_STATUS_LABELS[order.status]}</span>
        </li>
      ))}
    </ul>
  )
}
