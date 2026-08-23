import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AI_DEFAULT_PROVIDER,
  AI_PROVIDER_OPTIONS,
  aiProviderInfo,
  type AiProvider,
  type UpdateAiSettingsRequest,
} from '@legends/shared'
import { ApiError } from '../../lib/api'
import { getAiSettings, updateAiSettings } from '../../lib/ai-settings-api'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { Panel, inputCls } from './shared'

const QUERY_KEY = ['admin', 'ai-settings']

/** Sentinela do select de modelo — nunca vai para a API. */
const OUTRO_MODELO = '__outro__'

/**
 * Credencial de IA da empresa (BYO key), com o provedor à escolha do admin. A
 * chave nunca volta da API: campo vazio com placeholder "configurada" significa
 * "mantém a atual" — só enviamos `apiKey` quando o admin digita um valor novo,
 * ou string vazia quando ele pede a remoção explicitamente.
 *
 * Trocar de provedor apaga a chave no servidor (chave da OpenAI não vale no
 * Gemini), então a tela exige a chave nova no mesmo salvamento em vez de deixar
 * a empresa sem agente por engano.
 */
export function AiSettingsSection() {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: QUERY_KEY, queryFn: getAiSettings })
  const [message, setMessage] = useState<string | null>(null)
  const [provider, setProvider] = useState<AiProvider>(AI_DEFAULT_PROVIDER)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  /**
   * O select cobre os modelos conhecidos do provedor, mas a lista não tem como
   * ser exaustiva (modelo novo sai antes do nosso deploy, e o compatível-com-
   * OpenAI nem tem lista). "Outro modelo…" troca o select por um campo livre.
   */
  const [modeloLivre, setModeloLivre] = useState(false)

  // Hidrata os campos só na primeira carga: revalidação da query não pode pisar
  // em texto que o admin está digitando e ainda não salvou.
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!settings.data || hydratedRef.current) return
    hydratedRef.current = true
    setProvider(settings.data.provider)
    setModel(settings.data.model)
    setBaseUrl(settings.data.baseUrl ?? '')
    setModeloLivre(!aiProviderInfo(settings.data.provider).suggestedModels.includes(settings.data.model))
  }, [settings.data])

  const save = useMutation({
    mutationFn: (body: UpdateAiSettingsRequest) => updateAiSettings(body),
    onSuccess: (data) => {
      setMessage(data.configured ? 'Configuração salva.' : 'Chave removida. Os agentes ficam indisponíveis.')
      setApiKey('')
      setProvider(data.provider)
      setModel(data.model)
      setBaseUrl(data.baseUrl ?? '')
      setModeloLivre(!aiProviderInfo(data.provider).suggestedModels.includes(data.model))
      qc.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (err) => setMessage(err instanceof ApiError ? err.message : 'Erro ao salvar configuração.'),
  })

  const info = aiProviderInfo(provider)
  const savedProvider = settings.data?.provider ?? AI_DEFAULT_PROVIDER
  const trocouProvedor = Boolean(settings.data) && provider !== savedProvider
  const configured = (settings.data?.configured ?? false) && !trocouProvedor

  function trocarProvedor(next: AiProvider) {
    const proximo = aiProviderInfo(next)
    setProvider(next)
    setApiKey('')
    setModel(proximo.defaultModel)
    setBaseUrl('')
    setModeloLivre(proximo.suggestedModels.length === 0)
    setMessage(null)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (trocouProvedor && !apiKey.trim()) {
      setMessage(`Erro: informe a chave do ${info.label} — trocar de provedor apaga a chave atual.`)
      return
    }
    if (info.requiresBaseUrl && !baseUrl.trim()) {
      setMessage('Erro: informe a URL da API do serviço compatível com OpenAI.')
      return
    }
    const body: UpdateAiSettingsRequest = {
      provider,
      model: model.trim() || info.defaultModel,
      ...(info.requiresBaseUrl ? { baseUrl: baseUrl.trim() } : {}),
    }
    if (apiKey) body.apiKey = apiKey
    save.mutate(body)
  }

  function removeKey() {
    setApiKey('')
    save.mutate({ apiKey: '' })
  }

  return (
    <div className="flex flex-col gap-lg">
      <Panel title="Chave da API de IA">
        <form onSubmit={submit} className="flex flex-col gap-md">
          <p className="text-body-sm text-on-surface-variant">
            Os agentes de IA usam a chave <strong className="text-on-surface">desta empresa</strong> — nunca uma chave
            compartilhada. Escolha o provedor, cole a chave e informe o modelo. Ela é cifrada antes de ser gravada e não
            é exibida de volta em nenhum momento.
          </p>

          <p className="flex items-center gap-sm text-body-sm">
            <Icon
              name={configured ? 'check_circle' : 'error'}
              className={`text-[18px] ${configured ? 'text-primary' : 'text-on-surface-variant'}`}
            />
            <span className={configured ? 'text-on-surface' : 'text-on-surface-variant'}>
              {trocouProvedor
                ? `Troca de provedor pendente: informe a chave do ${info.label} e salve.`
                : configured
                  ? `Chave configurada (${aiProviderInfo(savedProvider).label}).`
                  : 'Nenhuma chave cadastrada — os agentes estão indisponíveis.'}
            </span>
          </p>

          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Provedor</span>
            <Select
              options={AI_PROVIDER_OPTIONS.map((option) => ({ value: option.key, label: option.label }))}
              value={provider}
              onChange={(value) => trocarProvedor(value as AiProvider)}
              ariaLabel="Provedor de IA"
            />
          </label>

          {info.apiKeyUrl && (
            <p className="text-body-sm text-on-surface-variant">
              Gere a chave do {info.label} em{' '}
              <a
                href={info.apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {info.apiKeyUrlLabel}
              </a>
              .
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Chave da API</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              aria-label="Chave da API de IA"
              placeholder={configured ? 'configurada' : 'cole a chave da API'}
              autoComplete="off"
              className={inputCls}
            />
          </label>

          {info.requiresBaseUrl && (
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">URL da API</span>
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                aria-label="URL da API compatível com OpenAI"
                placeholder={info.baseUrlPlaceholder}
                autoComplete="off"
                className={inputCls}
              />
              <span className="text-body-sm text-on-surface-variant">
                Endpoint compatível com OpenAI do serviço, incluindo o caminho de versão (ex.:{' '}
                {info.baseUrlPlaceholder}).
              </span>
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Modelo</span>
            {info.suggestedModels.length > 0 && !modeloLivre ? (
              <Select
                options={[
                  ...info.suggestedModels.map((suggestion) => ({ value: suggestion, label: suggestion })),
                  { value: OUTRO_MODELO, label: 'Outro modelo…' },
                ]}
                value={model}
                onChange={(value) => {
                  if (value === OUTRO_MODELO) {
                    setModeloLivre(true)
                    setModel('')
                    return
                  }
                  setModel(value)
                }}
                ariaLabel="Modelo de IA"
              />
            ) : (
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                aria-label="Modelo de IA"
                placeholder={info.defaultModel || 'nome do modelo no provedor'}
                autoComplete="off"
                className={inputCls}
              />
            )}
            {info.suggestedModels.length > 0 && modeloLivre && (
              <button
                type="button"
                onClick={() => {
                  setModeloLivre(false)
                  setModel(info.defaultModel)
                }}
                className="w-fit font-label text-label-sm text-primary underline underline-offset-2"
              >
                Escolher da lista
              </button>
            )}
          </label>

          <div className="flex flex-wrap items-center gap-sm">
            <button
              type="submit"
              disabled={save.isPending}
              aria-label="Salvar configuração de IA"
              className="inline-flex w-fit items-center gap-sm rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              <Icon name="save" className="text-[18px]" />
              Salvar
            </button>
            {configured && (
              <button
                type="button"
                onClick={removeKey}
                disabled={save.isPending}
                aria-label="Remover chave da API"
                className="inline-flex w-fit items-center gap-sm rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface disabled:opacity-50"
              >
                <Icon name="delete" className="text-[18px]" />
                Remover chave
              </button>
            )}
          </div>
        </form>
      </Panel>

      {message && (
        <p role="status" className="flex items-center gap-sm text-body-sm text-on-surface-variant">
          <Icon name={message.includes('Erro') ? 'error' : 'check_circle'} className="text-[18px] text-primary" />
          {message}
        </p>
      )}
    </div>
  )
}
