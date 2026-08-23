import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  AGENT_MESSAGE_MAX_LENGTH,
  ASSISTANT_DEFAULT_PERSONA_NAME,
  type AgentMessageDTO,
} from '@legends/shared'
import { apiFetch, ApiError } from '../../lib/api'
import { Markdown } from '../Markdown'
import { askAssistantChat, getAssistantPersona } from '../../lib/agent-api'
import { useAuth } from '../../auth/AuthContext'

type DisplayMessage = AgentMessageDTO & { isGreeting?: boolean }

/** Avatar da persona: foto quando a empresa tem uma (hoje só a EMR), senão um círculo com a inicial. */
function PersonaAvatar({ avatarUrl, initial, size }: { avatarUrl: string | null; initial: string; size: 'sm' | 'md' }) {
  const dimension = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" className={`${dimension} shrink-0 rounded-full object-cover`} />
  }
  return (
    <div
      className={`flex ${dimension} shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary`}
    >
      {initial}
    </div>
  )
}

/**
 * Assistente de RH: conversa multi-turno (agente `assistant`, ver
 * `agent-service.ts`), ancorada na base de conhecimento, com persona
 * configurável por empresa e feedback por resposta. Espelha a regra do
 * backend — `requireFeature` libera ADMIN e SUBADMIN mesmo sem a feature no
 * setor, para quem cura a base conseguir testar antes de ligar.
 */
export function AssistantWidget() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<AgentMessageDTO[]>([])
  const [conversationId, setConversationId] = useState<string | undefined>(undefined)
  const [queryIdByIndex, setQueryIdByIndex] = useState<Record<number, string>>({})
  const [feedback, setFeedback] = useState<Record<number, { rating: -1 | 1 }>>({})
  const [commentFor, setCommentFor] = useState<number | null>(null)
  const [commentText, setCommentText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const persona = useQuery({
    queryKey: ['assistant-persona'],
    queryFn: getAssistantPersona,
    staleTime: Infinity,
  })
  const personaName = persona.data?.name ?? ASSISTANT_DEFAULT_PERSONA_NAME
  const personaAvatarUrl = persona.data?.avatarUrl ?? null
  const personaInitial = personaName.charAt(0).toUpperCase()

  const chat = useMutation({
    mutationFn: (message: string) => askAssistantChat({ conversationId, message }),
    onSuccess: (data) => {
      setMessages(data.conversation.messages)
      setConversationId(data.conversation.id)
      setQueryIdByIndex((prev) => ({ ...prev, [data.conversation.messages.length - 1]: data.queryId }))
      setError(null)
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Não foi possível falar com a assistente agora.')
    },
  })

  const sendFeedback = useMutation({
    mutationFn: (payload: { queryId: string; rating: -1 | 1; comment?: string }) =>
      apiFetch<void>(`/assistant/queries/${payload.queryId}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ rating: payload.rating, comment: payload.comment ?? null }),
      }),
  })

  useEffect(() => {
    // `scrollTop = scrollHeight` em vez de `scrollTo`: jsdom (testes) não implementa
    // `scrollTo` em elemento, e o efeito visual é o mesmo.
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, open])

  function send() {
    const text = input.trim()
    if (!text || chat.isPending) return
    setInput('')
    setMessages((prev) => [
      ...prev,
      { id: `pending-${prev.length}`, role: 'user', content: text, createdAt: new Date().toISOString() },
    ])
    chat.mutate(text)
  }

  function resetChat() {
    setMessages([])
    setConversationId(undefined)
    setQueryIdByIndex({})
    setFeedback({})
    setCommentFor(null)
    setCommentText('')
    setInput('')
    setError(null)
  }

  function submitFeedback(realIndex: number, rating: -1 | 1, comment?: string) {
    const queryId = queryIdByIndex[realIndex]
    if (!queryId) return
    setFeedback((f) => ({ ...f, [realIndex]: { rating } }))
    sendFeedback.mutate(
      { queryId, rating, comment },
      {
        onSuccess: () => {
          if (rating === -1 && !comment) {
            setCommentFor(realIndex)
            setCommentText('')
          } else {
            setCommentFor(null)
          }
        },
      },
    )
  }

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUBADMIN'
  // THIRD_PARTY carrega allowlist individual do convite; os demais, as features do
  // setor — mesmo critério do FeatureGate em App.tsx.
  const features = user?.role === 'THIRD_PARTY' ? user.enabledFeatures : user?.sectorFeatures
  const hasFeature = (features ?? []).includes('assistente')
  if (!user || (!hasFeature && !isAdmin)) return null

  const greeting: DisplayMessage = {
    id: 'greeting',
    role: 'assistant',
    content: `Oi! Eu sou ${personaName} 💚. Posso te ajudar com dúvidas sobre políticas, benefícios e processos. Como posso ajudar?`,
    createdAt: '',
    isGreeting: true,
  }
  const displayMessages: DisplayMessage[] = [greeting, ...messages]

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? `Fechar ${personaName}` : `Abrir ${personaName}`}
        className="fixed bottom-6 right-6 z-50 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-lg font-semibold text-primary shadow-lg"
      >
        {open ? (
          '×'
        ) : personaAvatarUrl ? (
          <img src={personaAvatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          personaInitial
        )}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[34rem] w-[min(24rem,calc(100vw-3rem))] flex-col overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container shadow-xl">
          <header className="flex items-center gap-sm border-b border-outline-variant/40 bg-primary px-md py-sm text-on-primary">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/20 text-sm font-semibold">
              <PersonaAvatar avatarUrl={personaAvatarUrl} initial={personaInitial} size="md" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">{personaName}</p>
              <p className="text-xs opacity-80">Assistente de RH</p>
            </div>
            <button
              type="button"
              onClick={resetChat}
              aria-label="Iniciar novo chat"
              title="Iniciar novo chat"
              className="rounded-full p-xs text-on-primary/90 transition hover:bg-white/15"
            >
              ↺
            </button>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-sm overflow-y-auto p-md">
            {displayMessages.map((message, displayIndex) => {
              const realIndex = displayIndex - 1
              const isUser = message.role === 'user'
              const canGiveFeedback = !isUser && !message.isGreeting && queryIdByIndex[realIndex] !== undefined
              return (
                <div key={message.id} className="flex flex-col gap-xs">
                  <div className={`flex items-end gap-xs ${isUser ? 'justify-end' : ''}`}>
                    {!isUser && <PersonaAvatar avatarUrl={personaAvatarUrl} initial={personaInitial} size="sm" />}
                    {isUser ? (
                      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-sm py-xs text-sm text-on-primary">
                        {message.content}
                      </div>
                    ) : (
                      // `Markdown` em vez de HTML montado à mão: o modelo responde em
                      // lista com rótulo em negrito (ver `assistant-prompt.ts`), e o
                      // renderizador antigo só sabia negrito e quebra de linha — item
                      // de lista chegava à tela como um "-" ou "*" solto no meio do
                      // texto. De quebra, sai um `dangerouslySetInnerHTML` do caminho:
                      // o texto vem de um LLM que ecoa base cadastrada por gente.
                      <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-surface px-sm py-xs leading-relaxed">
                        <Markdown content={message.content} className="gap-xs text-on-surface" />
                      </div>
                    )}
                  </div>

                  {canGiveFeedback && (
                    <div className="ml-9 flex items-center gap-xs text-on-surface-variant">
                      {feedback[realIndex] ? (
                        <span className="text-xs">Obrigado pelo feedback</span>
                      ) : (
                        <>
                          <span className="text-xs">Essa resposta ajudou?</span>
                          <button
                            type="button"
                            aria-label="Resposta útil"
                            disabled={sendFeedback.isPending}
                            onClick={() => submitFeedback(realIndex, 1)}
                            className="rounded p-xs text-xs hover:bg-surface disabled:opacity-50"
                          >
                            👍
                          </button>
                          <button
                            type="button"
                            aria-label="Resposta não útil"
                            disabled={sendFeedback.isPending}
                            onClick={() => submitFeedback(realIndex, -1)}
                            className="rounded p-xs text-xs hover:bg-surface disabled:opacity-50"
                          >
                            👎
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {commentFor === realIndex && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault()
                        submitFeedback(realIndex, -1, commentText.trim() || undefined)
                      }}
                      className="ml-9 flex items-center gap-xs"
                    >
                      <input
                        autoFocus
                        value={commentText}
                        onChange={(event) => setCommentText(event.target.value)}
                        placeholder="Conte o que poderia ser melhor (opcional)"
                        className="flex-1 rounded-full border border-outline-variant/40 bg-surface px-sm py-xs text-xs outline-none"
                      />
                      <button
                        type="submit"
                        disabled={sendFeedback.isPending}
                        className="rounded-full border border-outline-variant/60 px-sm py-xs text-xs disabled:opacity-50"
                      >
                        Enviar comentário
                      </button>
                    </form>
                  )}
                </div>
              )
            })}
            {chat.isPending && (
              <p className="text-sm text-on-surface-variant">{personaName} está pensando...</p>
            )}
            {error && <p role="alert" className="text-sm text-error">{error}</p>}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              send()
            }}
            className="flex items-center gap-xs border-t border-outline-variant/40 bg-surface-container p-sm"
          >
            <input
              value={input}
              maxLength={AGENT_MESSAGE_MAX_LENGTH}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Pergunte algo..."
              disabled={chat.isPending}
              className="flex-1 rounded-full border border-outline-variant/40 bg-surface px-md py-sm text-sm outline-none"
            />
            <button
              type="submit"
              disabled={chat.isPending || input.trim() === ''}
              aria-label="Enviar"
              className="rounded-lg bg-primary px-md py-sm text-on-primary disabled:bg-surface disabled:text-on-surface-variant"
            >
              Enviar
            </button>
          </form>
        </div>
      )}
    </>
  )
}
