import { useState } from 'react'
import { CampaignCalendar } from './CampaignCalendar'
import { CampaignGenerator } from './CampaignGenerator'

type Tab = 'calendar' | 'generate'

/**
 * Calendário editorial de comunicação interna. A aba Calendário é a padrão de
 * propósito: sem chave de IA a aba Gerar não funciona, e a tela precisa
 * continuar útil mesmo assim.
 */
export function CampaignsSection() {
  const [tab, setTab] = useState<Tab>('calendar')
  // Guarda o resultado da última confirmação: a data do primeiro item leva o
  // calendário até o mês certo (uma campanha de setembro confirmada em agosto
  // não pode cair numa grade de agosto vazia), e a contagem vira a evidência
  // visível de que algo foi salvo — o fluxo termina em silêncio sem isso.
  const [confirmacao, setConfirmacao] = useState<{ date?: string; count: number } | null>(null)

  function handleConfirmed(firstScheduledFor: string | undefined, count: number) {
    setConfirmacao({ date: firstScheduledFor, count })
    setTab('calendar')
  }

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h2 className="font-headline text-headline-lg text-on-surface">Campanhas de comunicação</h2>
        <p className="text-body-sm text-on-surface-variant">
          Planeje a comunicação interna: gere comunicados com IA, revise, agende e publique no Feed Corporativo.
        </p>
      </header>

      <div role="tablist" aria-label="Campanhas" className="flex gap-sm">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'calendar'}
          onClick={() => setTab('calendar')}
          className={`rounded-full px-lg py-sm font-label text-label-md transition-colors ${tab === 'calendar' ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}
        >
          Calendário
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'generate'}
          onClick={() => {
            setConfirmacao(null)
            setTab('generate')
          }}
          className={`rounded-full px-lg py-sm font-label text-label-md transition-colors ${tab === 'generate' ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}
        >
          Gerar
        </button>
      </div>

      {tab === 'calendar' ? (
        <div className="flex flex-col gap-md">
          {confirmacao && (
            <p
              role="status"
              className="rounded-md border border-primary/40 bg-primary-container/20 p-sm text-body-sm text-on-primary-container"
            >
              {confirmacao.count} {confirmacao.count === 1 ? 'comunicado agendado' : 'comunicados agendados'} com
              sucesso.
            </p>
          )}
          <CampaignCalendar initialDate={confirmacao?.date} />
        </div>
      ) : (
        <CampaignGenerator onConfirmed={handleConfirmed} />
      )}
    </div>
  )
}
