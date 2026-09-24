import { useState } from 'react'
import { canPublishCorporatePostDirectly } from '@legends/shared'
import { useAuth } from '../../auth/AuthContext'
import { useCreateCorporatePost } from '../../lib/use-corporate-mural'
import { CorporatePostComposer } from '../mural-corporativo/CorporatePostComposer'
import { CampaignCalendar } from './CampaignCalendar'
import { CampaignGenerator } from './CampaignGenerator'
import { CampaignPromptPanel } from './CampaignPromptPanel'

type Tab = 'calendar' | 'generate' | 'publish'

/**
 * Calendário editorial de comunicação interna. A aba Calendário é a padrão de
 * propósito: sem chave de IA a aba Gerar não funciona, e a tela precisa
 * continuar útil mesmo assim.
 *
 * A aba **Publicar** (Documento 4, seção 13.1) renderiza o MESMO
 * `CorporatePostComposer` do Feed — o componente, não uma cópia. Ele carrega
 * menção, anexo, GIF, público-alvo, tipo de comunicação, geração por IA e o
 * agendamento; reimplementar qualquer fatia disso criaria uma segunda versão
 * para divergir da primeira no primeiro ajuste. É o que faz a G&G controlar
 * todos os comunicados da empresa sem sair da tela de Campanhas.
 */
export function CampaignsSection() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('calendar')
  const create = useCreateCorporatePost()
  // A decisão continua sendo do contrato compartilhado, e não uma regra nova
  // desta tela: quem chega aqui é do bloco de G&G e publica direto, mas é o
  // `canPublishCorporatePostDirectly` que diz isso.
  const podePublicarDireto = canPublishCorporatePostDirectly(user?.role, user?.adminAccess)
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
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'publish'}
          onClick={() => {
            setConfirmacao(null)
            setTab('publish')
          }}
          className={`rounded-full px-lg py-sm font-label text-label-md transition-colors ${tab === 'publish' ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}
        >
          Publicar
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
      ) : tab === 'generate' ? (
        <div className="flex flex-col gap-lg">
          <CampaignGenerator onConfirmed={handleConfirmed} />
          <CampaignPromptPanel />
        </div>
      ) : (
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-lg py-md">
          <CorporatePostComposer
            onSubmit={(body) => create.mutate(body)}
            pending={create.isPending}
            canPublishDirectly={podePublicarDireto}
          />
        </div>
      )}
    </div>
  )
}
