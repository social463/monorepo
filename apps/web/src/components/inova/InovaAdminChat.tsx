import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AgentMessageDTO } from '@legends/shared'
import { Icon } from '../Icon'
import { Markdown } from '../Markdown'
import { ApiError } from '../../lib/api'
import { askInovaAdminChat, getInovaAdminChatConversation, listInovaAdminChatConversations } from '../../lib/inova-api'

const SUGESTOES = [
  'O que mudou de abril para maio?',
  'Compare maio e junho em projetos, economia e horas.',
  'Qual setor mais avançou no último mês?',
  'Faça uma análise geral do cenário atual.',
]

const CONVERSATIONS_KEY = ['inova', 'admin-chat', 'conversations']

/**
 * "IA Analista do Painel" — chat de perguntas livres sobre os projetos do
 * INOVA. Diferente do original (efêmero, só em memória): aqui a conversa
 * persiste, mesmo mecanismo genérico do Benchmarking/GlassAgent.
 *
 * `projectIds` é o recorte que o painel está mostrando (setor/período). Vai a
 * cada pergunta, e não na abertura da conversa: trocar o filtro no meio muda o
 * que a próxima resposta enxerga, como no original, que mandava o snapshot
 * filtrado a cada envio. Ausente = empresa inteira.
 */
export function InovaAdminChat({ projectIds, scopeLabel }: { projectIds?: string[]; scopeLabel?: string } = {}) {
  const qc = useQueryClient()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const conversations = useQuery({ queryKey: CONVERSATIONS_KEY, queryFn: listInovaAdminChatConversations })

  const conversation = useQuery({
    queryKey: ['inova', 'admin-chat', 'conversation', conversationId],
    queryFn: () => getInovaAdminChatConversation(conversationId as string),
    enabled: conversationId !== null,
  })

  const messages: AgentMessageDTO[] = conversation.data?.conversation.messages ?? []

  const ask = useMutation({
    mutationFn: (message: string) =>
      askInovaAdminChat({
        message,
        ...(conversationId ? { conversationId } : {}),
        ...(projectIds ? { projectIds } : {}),
      }),
    onSuccess: (data) => {
      setError(null)
      setConversationId(data.conversation.id)
      qc.setQueryData(['inova', 'admin-chat', 'conversation', data.conversation.id], data)
      qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Tive um problema para responder agora. Tente novamente.'),
  })

  const pending = ask.isPending ? ask.variables : null

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
    <section className="flex flex-col gap-md rounded-2xl border border-primary/20 bg-surface-container p-md">
      <div className="flex items-center gap-sm">
        <Icon name="auto_awesome" className="text-primary" />
        <h2 className="font-headline text-headline-md text-on-surface">IA Analista do Painel</h2>
        <span className="text-body-sm text-on-surface-variant">· pergunte sobre evolução, comparações e cenário</span>
        {conversationId && (
          <button
            type="button"
            onClick={() => {
              // A conversa antiga continua salva em "Conversas anteriores";
              // aqui só volta para a tela em branco, com as sugestões.
              setConversationId(null)
              setError(null)
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-sm py-xs font-label text-label-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          >
            <Icon name="add_comment" className="text-[16px]" />
            Nova conversa
          </button>
        )}
      </div>

      {scopeLabel && (
        <p className="flex items-center gap-xs text-body-sm text-on-surface-variant">
          <Icon name="filter_alt" className="text-[16px] text-primary" />
          Analisando o recorte do painel: {scopeLabel}
        </p>
      )}

      <div ref={scrollRef} className="flex max-h-[420px] flex-col gap-sm overflow-y-auto">
        {messages.length === 0 && !conversationId && (
          <div className="flex flex-col gap-sm">
            <p className="text-body-sm text-on-surface-variant">Comece com uma das perguntas abaixo ou digite a sua:</p>
            <div className="flex flex-wrap gap-xs">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask.mutate(s)}
                  className="rounded-full border border-primary/20 bg-primary/10 px-sm py-xs text-body-sm text-on-surface hover:bg-primary/20"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'user' ? (
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary px-md py-sm text-body-sm text-on-primary">
                {m.content}
              </p>
            ) : (
              // A IA responde com listas e negrito; em texto cru o "**" e o
              // "- " apareciam literais. O `Markdown` monta elementos React,
              // sem HTML — a resposta ecoa título de projeto digitado por
              // qualquer colaborador.
              <div className="max-w-[85%] rounded-2xl border border-outline-variant/40 bg-surface-container-low px-md py-sm">
                <Markdown content={m.content} className="gap-sm text-on-surface" />
              </div>
            )}
          </div>
        ))}

        {pending && (
          <div className="flex justify-end">
            <p className="max-w-[85%] rounded-2xl bg-primary/60 px-md py-sm text-body-sm text-on-primary">{pending}</p>
          </div>
        )}
        {ask.isPending && <p className="text-body-sm text-on-surface-variant">Analisando os dados…</p>}
      </div>

      {error && <p className="text-body-sm text-error">{error}</p>}

      <form onSubmit={submit} className="flex items-end gap-sm">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit(e as unknown as FormEvent)
            }
          }}
          placeholder="Ex.: O que mudou de abril para maio?"
          rows={2}
          disabled={ask.isPending}
          className="flex-1 resize-none rounded-md border border-outline-variant/60 bg-surface p-sm text-body-sm text-on-surface"
        />
        <button
          type="submit"
          disabled={ask.isPending || !input.trim()}
          aria-label="Enviar"
          className="rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          <Icon name="send" className="text-[18px]" />
        </button>
      </form>

      {(conversations.data?.conversations.length ?? 0) > 0 && (
        <details className="text-body-sm text-on-surface-variant">
          <summary className="cursor-pointer font-label">Conversas anteriores</summary>
          <ul className="mt-xs flex flex-col gap-xs">
            {conversations.data!.conversations.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setConversationId(item.id)} className="truncate text-left hover:text-on-surface hover:underline">
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
