import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CAMPAIGN_PROMPT_TEMPLATE_MAX_LENGTH,
  SMART_BREVITY_PROMPT,
  type CampaignPromptTemplateResponse,
} from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Panel, inputCls } from './shared'

/**
 * Modelo padrão de comunicado (Documento 4, seção 13.4).
 *
 * O texto oficial é a **Brevidade Inteligente** (Smart Brevity), com os quatro
 * blocos fixos. Ele é o valor padrão, não um valor cravado: a OBS da seção pede
 * que a G&G possa refiná-lo sem depender do time de TI.
 *
 * Vale para os DOIS geradores — o de campanhas e o do Feed Corporativo. Um
 * modelo por empresa, não um por tela: a voz da comunicação interna é uma só.
 */
export function CampaignPromptPanel() {
  const queryClient = useQueryClient()
  const [texto, setTexto] = useState('')
  const [mensagem, setMensagem] = useState<string | null>(null)

  const templateQuery = useQuery({
    queryKey: ['admin', 'campaignPromptTemplate'],
    queryFn: () => apiFetch<CampaignPromptTemplateResponse>('/admin/campaign-prompt-template'),
  })

  useEffect(() => {
    if (templateQuery.data) setTexto(templateQuery.data.template)
  }, [templateQuery.data])

  const salvar = useMutation({
    mutationFn: (template: string) =>
      apiFetch<CampaignPromptTemplateResponse>('/admin/campaign-prompt-template', {
        method: 'PUT',
        body: JSON.stringify({ template }),
      }),
    onSuccess: (data) => {
      setTexto(data.template)
      setMensagem(data.isDefault ? 'Modelo oficial restaurado.' : 'Modelo salvo.')
      queryClient.invalidateQueries({ queryKey: ['admin', 'campaignPromptTemplate'] })
    },
    onError: (err) => setMensagem(err instanceof ApiError ? err.message : 'Erro ao salvar o modelo.'),
  })

  const ehOficial = templateQuery.data?.isDefault ?? true

  return (
    <Panel
      title="Modelo padrão de comunicado"
      action={
        <span className="font-label text-label-sm text-on-surface-variant">
          {ehOficial ? 'Usando o modelo oficial' : 'Modelo personalizado'}
        </span>
      }
    >
      <p className="mb-md text-body-sm text-on-surface-variant">
        A fórmula da <strong className="text-on-surface">Brevidade Inteligente</strong>: título
        provocativo, lide, "Por que isso importa" e ação necessária. Entra automaticamente no
        gerador de campanhas e no da IA do Feed Corporativo — e dá para desligar em uma geração
        específica, sem apagar o que está aqui.
      </p>

      <label className="flex flex-col gap-1">
        <span className="font-label text-label-sm text-on-surface-variant">Instrução enviada à IA</span>
        <textarea
          value={texto}
          onChange={(event) => setTexto(event.target.value)}
          rows={14}
          maxLength={CAMPAIGN_PROMPT_TEMPLATE_MAX_LENGTH}
          aria-label="Instrução enviada à IA"
          className={`${inputCls} font-mono text-body-sm`}
        />
        <span className="self-end font-label text-label-sm text-on-surface-variant">
          {texto.length}/{CAMPAIGN_PROMPT_TEMPLATE_MAX_LENGTH}
        </span>
      </label>

      {mensagem && (
        <p role="status" className="mt-sm flex items-center gap-sm text-body-sm text-on-surface-variant">
          <Icon name={mensagem.includes('Erro') ? 'error' : 'check_circle'} className="text-[18px] text-primary" />
          {mensagem}
        </p>
      )}

      <div className="mt-md flex flex-wrap gap-sm">
        <button
          type="button"
          disabled={salvar.isPending}
          onClick={() => salvar.mutate(texto)}
          className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          Salvar modelo
        </button>
        {/*
          Restaurar manda texto VAZIO, e o servidor apaga a linha em vez de
          gravar o oficial: assim a empresa volta a acompanhar o padrão se ele
          mudar, em vez de congelar uma cópia dele.
        */}
        <button
          type="button"
          disabled={salvar.isPending || ehOficial}
          onClick={() => salvar.mutate('')}
          className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-50"
        >
          Restaurar o oficial
        </button>
        <button
          type="button"
          onClick={() => setTexto(SMART_BREVITY_PROMPT)}
          className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:border-primary hover:text-primary"
        >
          Ver o texto oficial
        </button>
      </div>
    </Panel>
  )
}
