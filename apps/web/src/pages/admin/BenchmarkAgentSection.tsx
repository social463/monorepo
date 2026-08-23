import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AGENT_MESSAGE_MAX_LENGTH,
  BENCHMARK_PRACTICE_CATEGORIES,
  BENCHMARK_PRACTICE_DESCRIPTION_MAX_LENGTH,
  BENCHMARK_PRACTICE_TITLE_MAX_LENGTH,
  type AgentMessageDTO,
  type BenchmarkPracticeDTO,
} from '@legends/shared'
import { ApiError } from '../../lib/api'
import {
  askAgent,
  createBenchmarkPractice,
  deleteBenchmarkPractice,
  getAgentConversation,
  listAgentConversations,
  listBenchmarkPractices,
} from '../../lib/agent-api'
import { Icon } from '../../components/Icon'
import { Markdown } from '../../components/Markdown'
import { Panel, inputCls } from './shared'

const PRACTICES_KEY = ['admin', 'benchmark-practices']
const CONVERSATIONS_KEY = ['admin', 'agent', 'benchmark', 'conversations']

const WELCOME =
  'Sou o agente de benchmarking de cultura, experiência do colaborador e employer branding. Posso analisar práticas de empresas do mercado, comparar com as práticas internas cadastradas e sugerir oportunidades. Por onde quer começar? Ex.: "Benchmark de programas de saúde mental em empresas de tecnologia no Brasil".'

type Tab = 'chat' | 'praticas'

export function BenchmarkAgentSection() {
  const [tab, setTab] = useState<Tab>('chat')
  const practices = useQuery({ queryKey: PRACTICES_KEY, queryFn: listBenchmarkPractices })
  const practiceCount = practices.data?.practices.length ?? 0

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h2 className="font-headline text-headline-lg text-on-surface">Agente de Benchmarking</h2>
        <p className="text-body-sm text-on-surface-variant">
          Análise de mercado em cultura, experiência do colaborador e employer branding.
        </p>
      </header>

      <div role="tablist" className="flex gap-sm">
        <button
          role="tab"
          aria-selected={tab === 'chat'}
          onClick={() => setTab('chat')}
          className={`rounded-full px-lg py-sm font-label text-label-md transition-colors ${tab === 'chat' ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}
        >
          Agente
        </button>
        <button
          role="tab"
          aria-selected={tab === 'praticas'}
          onClick={() => setTab('praticas')}
          className={`rounded-full px-lg py-sm font-label text-label-md transition-colors ${tab === 'praticas' ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}
        >
          Práticas internas ({practiceCount})
        </button>
      </div>

      {tab === 'chat' ? <ChatTab /> : <PracticesTab practices={practices.data?.practices ?? []} />}
    </div>
  )
}

// ----- Aba do chat -----

function ChatTab() {
  const qc = useQueryClient()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const conversations = useQuery({ queryKey: CONVERSATIONS_KEY, queryFn: () => listAgentConversations('benchmark') })

  const conversation = useQuery({
    queryKey: ['admin', 'agent', 'benchmark', 'conversation', conversationId],
    queryFn: () => getAgentConversation('benchmark', conversationId as string),
    enabled: conversationId !== null,
  })

  const messages: AgentMessageDTO[] = conversation.data?.conversation.messages ?? []

  const ask = useMutation({
    mutationFn: (message: string) =>
      askAgent('benchmark', { message, ...(conversationId ? { conversationId } : {}) }),
    onSuccess: (data) => {
      setError(null)
      setConversationId(data.conversation.id)
      qc.setQueryData(['admin', 'agent', 'benchmark', 'conversation', data.conversation.id], data)
      qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
    },
    // Falha da IA chega como ApiError com mensagem já em português vinda do
    // backend — mostramos ela, não uma genérica.
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Tive um problema para responder agora. Tente novamente.'),
  })

  // A pergunta enviada aparece na hora, antes da resposta chegar: sem isso a
  // tela fica 55s sem sinal do que foi perguntado.
  const pending = ask.isPending ? ask.variables : null

  // Mesmo recurso do chat do escritório (`office/media/RoomChatPanel.tsx`):
  // `scrollTop = scrollHeight` em vez de `scrollTo`, que o jsdom não implementa.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, pending])

  function submit(event: FormEvent) {
    event.preventDefault()
    const text = input.trim()
    if (!text || ask.isPending) return
    setInput('')
    ask.mutate(text)
  }

  function startNew() {
    setConversationId(null)
    setError(null)
  }

  return (
    <div className="grid gap-lg lg:grid-cols-[16rem_1fr]">
      <Panel
        title="Conversas"
        action={
          <button
            type="button"
            onClick={startNew}
            aria-label="Nova conversa"
            className="inline-flex items-center gap-xs rounded-md bg-primary px-md py-xs font-label text-label-sm font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
          >
            <Icon name="add" className="text-[16px]" />
            Nova
          </button>
        }
      >
        <ul className="flex flex-col gap-xs">
          {(conversations.data?.conversations ?? []).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setConversationId(item.id)}
                aria-current={item.id === conversationId}
                className={`w-full truncate rounded-md px-sm py-xs text-left text-body-sm transition-colors ${item.id === conversationId ? 'bg-surface-container-highest text-on-surface' : 'text-on-surface-variant hover:text-on-surface'}`}
              >
                {item.title}
              </button>
            </li>
          ))}
          {(conversations.data?.conversations.length ?? 0) === 0 && (
            <li className="text-body-sm text-on-surface-variant">Nenhuma conversa ainda.</li>
          )}
        </ul>
      </Panel>

      <Panel title="Consultor estratégico de cultura">
        <div className="flex flex-col gap-md">
          <div
            ref={scrollRef}
            className="flex h-[28rem] flex-col gap-md overflow-y-auto rounded-lg border border-outline-variant/40 bg-surface-container-low p-md"
          >
            {messages.length === 0 && !pending && (
              <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-outline-variant/40 bg-surface-container px-md py-sm">
                <Markdown content={WELCOME} />
              </div>
            )}

            {messages.map((message) =>
              message.role === 'user' ? (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-md py-sm text-body-sm text-on-primary">
                    {message.content}
                  </div>
                </div>
              ) : (
                <div key={message.id} className="flex justify-start">
                  <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-outline-variant/40 bg-surface-container px-md py-sm">
                    <Markdown content={message.content} />
                  </div>
                </div>
              ),
            )}

            {pending && (
              <>
                <div className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-md py-sm text-body-sm text-on-primary">
                    {pending}
                  </div>
                </div>
                <p className="flex items-center gap-sm text-body-sm text-on-surface-variant">
                  <Icon name="progress_activity" className="animate-spin text-[18px]" />
                  Analisando o mercado…
                </p>
              </>
            )}

            {error && (
              <p
                role="alert"
                className="flex items-start gap-sm rounded-lg border border-error/40 bg-error-container/20 px-md py-sm text-body-sm text-on-error-container"
              >
                <Icon name="error" className="text-[18px]" />
                {error}
              </p>
            )}
          </div>

          <form onSubmit={submit} className="flex items-center gap-sm">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={AGENT_MESSAGE_MAX_LENGTH}
              disabled={ask.isPending}
              aria-label="Pergunta para o agente"
              placeholder="Ex.: Benchmark de ações de Setembro Amarelo em edtechs brasileiras"
              className={inputCls}
            />
            <button
              type="submit"
              disabled={ask.isPending || !input.trim()}
              aria-label="Enviar pergunta"
              className="inline-flex items-center gap-sm rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              <Icon name="send" className="text-[18px]" />
            </button>
          </form>

          <p className="text-body-sm text-on-surface-variant">
            O agente usa as práticas internas cadastradas como contexto de comparação.
          </p>
        </div>
      </Panel>
    </div>
  )
}

// ----- Aba do inventário -----

function PracticesTab({ practices }: { practices: BenchmarkPracticeDTO[] }) {
  const qc = useQueryClient()
  const [category, setCategory] = useState(BENCHMARK_PRACTICE_CATEGORIES[0])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [channel, setChannel] = useState('')
  const [tags, setTags] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: createBenchmarkPractice,
    onSuccess: () => {
      setMessage('Prática cadastrada.')
      setTitle('')
      setDescription('')
      setChannel('')
      setTags('')
      qc.invalidateQueries({ queryKey: PRACTICES_KEY })
    },
    onError: (err) => setMessage(err instanceof ApiError ? err.message : 'Erro ao cadastrar prática.'),
  })

  const remove = useMutation({
    mutationFn: deleteBenchmarkPractice,
    onSuccess: () => qc.invalidateQueries({ queryKey: PRACTICES_KEY }),
    onError: (err) => setMessage(err instanceof ApiError ? err.message : 'Erro ao remover prática.'),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    create.mutate({
      category,
      title: title.trim(),
      description: description.trim() || null,
      channel: channel.trim() || null,
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    })
  }

  return (
    <div className="flex flex-col gap-lg">
      <Panel title="Cadastrar prática interna">
        <form onSubmit={submit} className="flex flex-col gap-md">
          <div className="grid gap-md sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Categoria</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                aria-label="Categoria da prática"
                className={inputCls}
              >
                {BENCHMARK_PRACTICE_CATEGORIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Canal de divulgação</span>
              <input
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
                aria-label="Canal de divulgação"
                placeholder="LinkedIn, Teams, Notion…"
                className={inputCls}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Título da prática</span>
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={BENCHMARK_PRACTICE_TITLE_MAX_LENGTH}
              aria-label="Título da prática"
              placeholder="Ex.: Day off de aniversário"
              className={inputCls}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Descrição</span>
            <textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={BENCHMARK_PRACTICE_DESCRIPTION_MAX_LENGTH}
              aria-label="Descrição da prática"
              placeholder="O que é, público-alvo, frequência, resultados…"
              className={inputCls}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Tags (separadas por vírgula)</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              aria-label="Tags da prática"
              placeholder="reconhecimento, mensal, presencial"
              className={inputCls}
            />
          </label>

          <button
            type="submit"
            disabled={create.isPending}
            aria-label="Adicionar prática"
            className="inline-flex w-fit items-center gap-sm rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            <Icon name="add" className="text-[18px]" />
            Adicionar prática
          </button>
        </form>
      </Panel>

      {message && (
        <p role="status" className="flex items-center gap-sm text-body-sm text-on-surface-variant">
          <Icon name={message.includes('Erro') ? 'error' : 'check_circle'} className="text-[18px] text-primary" />
          {message}
        </p>
      )}

      {practices.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          Nenhuma prática cadastrada ainda. Adicione as iniciativas da empresa para o agente comparar com o mercado.
        </p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {practices.map((practice) => (
            <li
              key={practice.id}
              className="flex items-start justify-between gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-md"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-sm">
                  <span className="rounded-full bg-primary/10 px-sm py-0.5 font-label text-label-sm text-primary">
                    {practice.category}
                  </span>
                  {practice.channel && (
                    <span className="text-body-sm text-on-surface-variant">via {practice.channel}</span>
                  )}
                </div>
                <p className="mt-xs font-label text-label-lg text-on-surface">{practice.title}</p>
                {practice.description && (
                  <p className="text-body-sm text-on-surface-variant">{practice.description}</p>
                )}
                {practice.tags.length > 0 && (
                  <div className="mt-xs flex flex-wrap gap-xs">
                    {practice.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-surface-container-highest px-xs py-0.5 text-body-sm text-on-surface-variant"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove.mutate(practice.id)}
                disabled={remove.isPending}
                aria-label={`Remover ${practice.title}`}
                className="rounded-md p-xs text-on-surface-variant hover:text-error disabled:opacity-50"
              >
                <Icon name="delete" className="text-[18px]" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
