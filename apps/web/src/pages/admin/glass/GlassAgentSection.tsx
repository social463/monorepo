import { useState } from 'react'
import { GlassChatTab } from './GlassChatTab'
import { GlassIngestTab } from './GlassIngestTab'
import { GlassPanelTab } from './GlassPanelTab'

type Tab = 'ingestao' | 'painel' | 'chat'

const ABAS: { key: Tab; label: string }[] = [
  { key: 'ingestao', label: 'Ingestão' },
  { key: 'painel', label: 'Painel' },
  { key: 'chat', label: 'Agente' },
]

export function GlassAgentSection() {
  const [tab, setTab] = useState<Tab>('painel')

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h2 className="font-headline text-headline-lg text-on-surface">GlassAgent</h2>
        <p className="text-body-sm text-on-surface-variant">
          Avaliações que pessoas de dentro, atuais e ex-funcionários, publicaram sobre a empresa —
          série histórica, recortes e alertas.
        </p>
      </header>

      <div role="tablist" className="flex gap-sm">
        {ABAS.map((aba) => (
          <button
            key={aba.key}
            role="tab"
            aria-selected={tab === aba.key}
            onClick={() => setTab(aba.key)}
            className={`rounded-full px-lg py-sm font-label text-label-md transition-colors ${
              tab === aba.key ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
            }`}
          >
            {aba.label}
          </button>
        ))}
      </div>

      {tab === 'ingestao' && <GlassIngestTab />}
      {tab === 'painel' && <GlassPanelTab />}
      {tab === 'chat' && <GlassChatTab />}
    </div>
  )
}
