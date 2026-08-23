import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AGENT_MESSAGE_MAX_LENGTH, GLASS_COMMANDS, type AgentMessageDTO } from '@legends/shared'
import { ApiError } from '../../../lib/api'
import { askAgent, getAgentConversation, listAgentConversations } from '../../../lib/agent-api'
import { Icon } from '../../../components/Icon'
import { Markdown } from '../../../components/Markdown'
import { Panel, inputCls } from '../shared'

const CONVERSATIONS_KEY = ['admin', 'agent', 'glass', 'conversations']

const WELCOME =
  'Sou o GlassAgent. Leio as avaliações externas cadastradas e analiso o que elas dizem sobre a empresa. Os números vêm do banco, não da minha estimativa. Comandos: /relatorio, /tendencia, /criticos e /cruzamento [dimensão] [dimensão].'

export function GlassChatTab() {
  const qc = useQueryClient()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const conversations = useQuery({ queryKey: CONVERSATIONS_KEY, queryFn: () => listAgentConversations('glass') })

  const conversation = useQuery({
    queryKey: ['admin', 'agent', 'glass', 'conversation', conversationId],
    queryFn: () => getAgentConversation('glass', conversationId as string),
    enabled: conversationId !== null,
  })

  const messages: AgentMessageDTO[] = conversation.data?.conversation.messages ?? []

  const ask = useMutation({
    mutationFn: (message: string) =>
      askAgent('glass', { message, ...(conversationId ? { conversationId } : {}) }),
    onSuccess: (data) => {
      setError(null)
      setConversationId(data.conversation.id)
      qc.setQueryData(['admin', 'agent', 'glass', 'conversation', data.conversation.id], data)
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

      <Panel title="Analista de avaliações externas">
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
                  Analisando as avaliações…
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
              placeholder="Ex.: o que mais aparece nas avaliações de quem saiu no último ano?"
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

          <div className="mt-sm flex flex-wrap gap-xs">
            {GLASS_COMMANDS.map((comando) => (
              <button
                key={comando}
                type="button"
                onClick={() => setInput(comando)}
                className="rounded-full bg-surface-container-high px-md py-xs font-mono text-label-sm text-on-surface-variant"
              >
                {comando}
              </button>
            ))}
          </div>

          <p className="text-body-sm text-on-surface-variant">
            O agente só responde com números já calculados a partir das avaliações cadastradas — nunca estima
            ou inventa um número que não esteja no banco.
          </p>
        </div>
      </Panel>
    </div>
  )
}
