import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AGENT_MESSAGE_MAX_LENGTH, type AgentKey, type AgentMessageDTO } from '@legends/shared'
import { ApiError } from '../lib/api'
import { askAgent, getAgentConversation, listAgentConversations } from '../lib/agent-api'
import { Icon } from './Icon'
import { Markdown } from './Markdown'

/**
 * Chat de um agente de IA: lista de conversas à esquerda, thread à direita.
 *
 * Extraído da tela do Benchmarking quando o assistente da trilha Eu Aprendiz
 * precisou do mesmo chat. O que muda de um agente para o outro é o system
 * prompt (que é do servidor) e os textos daqui — nunca a mecânica, então ela
 * mora num lugar só.
 */
export interface AgentChatProps {
  agent: AgentKey
  /** Título do painel da direita. */
  title: string
  /** Primeira fala, mostrada enquanto a conversa está vazia. */
  welcome: string
  placeholder: string
  /** O que aparece enquanto a IA responde ("Analisando o mercado…"). */
  pendingLabel: string
  /** Linha de rodapé explicando de onde vem o contexto. */
  footnote?: string
}

function panelCls(): string {
  return 'rounded-xl border border-outline-variant/40 bg-surface-container p-lg'
}

export function AgentChat({
  agent,
  title,
  welcome,
  placeholder,
  pendingLabel,
  footnote,
}: AgentChatProps) {
  const qc = useQueryClient()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const conversationsKey = ['admin', 'agent', agent, 'conversations']

  const conversations = useQuery({
    queryKey: conversationsKey,
    queryFn: () => listAgentConversations(agent),
  })

  const conversation = useQuery({
    queryKey: ['admin', 'agent', agent, 'conversation', conversationId],
    queryFn: () => getAgentConversation(agent, conversationId as string),
    enabled: conversationId !== null,
  })

  const messages: AgentMessageDTO[] = conversation.data?.conversation.messages ?? []

  const ask = useMutation({
    mutationFn: (message: string) =>
      askAgent(agent, { message, ...(conversationId ? { conversationId } : {}) }),
    onSuccess: (data) => {
      setError(null)
      setConversationId(data.conversation.id)
      qc.setQueryData(['admin', 'agent', agent, 'conversation', data.conversation.id], data)
      void qc.invalidateQueries({ queryKey: conversationsKey })
    },
    // Falha da IA chega como ApiError com mensagem já em português vinda do
    // backend — mostramos ela, não uma genérica. É ela que distingue "a empresa
    // não cadastrou chave" (503) de "a chave foi recusada" (502).
    onError: (err) =>
      setError(
        err instanceof ApiError
          ? err.message
          : 'Tive um problema para responder agora. Tente novamente.',
      ),
  })

  // A pergunta enviada aparece na hora, antes da resposta chegar: sem isso a
  // tela fica até 55s sem sinal do que foi perguntado.
  const pending = ask.isPending ? ask.variables : null

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

  return (
    <div className="grid gap-lg lg:grid-cols-[16rem_1fr]">
      <section className={panelCls()}>
        <div className="mb-lg flex flex-wrap items-center justify-between gap-md">
          <h3 className="font-headline text-headline-md text-on-surface">Conversas</h3>
          <button
            type="button"
            onClick={() => {
              setConversationId(null)
              setError(null)
            }}
            aria-label="Nova conversa"
            className="inline-flex items-center gap-xs rounded-md bg-primary px-md py-xs font-label text-label-sm font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
          >
            <Icon name="add" className="text-[16px]" />
            Nova
          </button>
        </div>
        <ul className="flex flex-col gap-xs">
          {(conversations.data?.conversations ?? []).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setConversationId(item.id)}
                aria-current={item.id === conversationId}
                className={`w-full truncate rounded-md px-sm py-xs text-left text-body-sm transition-colors ${
                  item.id === conversationId
                    ? 'bg-surface-container-highest text-on-surface'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {item.title}
              </button>
            </li>
          ))}
          {(conversations.data?.conversations.length ?? 0) === 0 && (
            <li className="text-body-sm text-on-surface-variant">Nenhuma conversa ainda.</li>
          )}
        </ul>
      </section>

      <section className={panelCls()}>
        <div className="mb-lg flex flex-wrap items-center justify-between gap-md">
          <h3 className="font-headline text-headline-md text-on-surface">{title}</h3>
        </div>
        <div className="flex flex-col gap-md">
          <div
            ref={scrollRef}
            className="flex h-[28rem] flex-col gap-md overflow-y-auto rounded-lg border border-outline-variant/40 bg-surface-container-low p-md"
          >
            {messages.length === 0 && !pending && (
              <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-outline-variant/40 bg-surface-container px-md py-sm">
                <Markdown content={welcome} />
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
                  {pendingLabel}
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
              placeholder={placeholder}
              className="w-full rounded-md border border-outline-variant bg-surface px-md py-sm font-body text-body-md text-on-surface"
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

          {footnote && <p className="text-body-sm text-on-surface-variant">{footnote}</p>}
        </div>
      </section>
    </div>
  )
}
