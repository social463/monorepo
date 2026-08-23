import { useState } from 'react'
import { StoreOrdersTab } from './StoreOrdersTab'
import { StoreProductsTab } from './StoreProductsTab'

type AdminStoreTab = 'pedidos' | 'produtos'
const TAB_LABELS: Record<AdminStoreTab, string> = { pedidos: 'Pedidos', produtos: 'Produtos' }

/** Pedidos é a aba padrão: é a tela de trabalho da G&G, o catálogo muda pouco. */
export function StoreSection() {
  const [tab, setTab] = useState<AdminStoreTab>('pedidos')

  return (
    <section>
      <h1 className="mb-lg text-headline-sm">Loja</h1>
      <div role="tablist" className="mb-lg flex gap-sm">
        {(Object.keys(TAB_LABELS) as AdminStoreTab[]).map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={tab === option}
            onClick={() => setTab(option)}
            className={`rounded-full px-md py-xs text-label-lg ${
              tab === option ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
            }`}
          >
            {TAB_LABELS[option]}
          </button>
        ))}
      </div>
      {tab === 'pedidos' ? <StoreOrdersTab /> : <StoreProductsTab />}
    </section>
  )
}
