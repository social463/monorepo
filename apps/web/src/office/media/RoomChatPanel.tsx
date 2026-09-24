import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ROOM_CHAT_MESSAGE_MAX_LENGTH } from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Avatar, type AvatarSource } from '../../components/Avatar'
import { groupRoomChatMessages } from './roomChatGroups'
import type { RoomChatMessage } from './useRoomChat'

const URL_PATTERN = /https?:\/\/[^\s]+/g

/** Quebra o texto em trechos simples e links clicáveis, na ordem original. */
function renderMessageText(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  URL_PATTERN.lastIndex = 0
  let key = 0
  while ((match = URL_PATTERN.exec(text))) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const url = match[0]
    parts.push(
      <a
        key={`link-${key++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-on-surface-variant/50 underline-offset-2 hover:text-primary"
      >
        {url}
      </a>,
    )
    lastIndex = match.index + url.length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

export function RoomChatPanel({
  messages,
  occupants = [],
  canSend,
  onSendMessage,
  onClose,
  title = 'Chat da sala',
  emptyText = 'Sem mensagens na sala ainda.',
  closeLabel = 'Fechar painel de chat da sala',
}: {
  messages: RoomChatMessage[]
  /**
   * Quem está aqui agora — só serve para achar o avatar de quem falou. O tipo
   * é o mínimo de que o `Avatar` precisa (e não `OfficeOccupant`) desde que a
   * arena e o saguão passaram a usar este painel: lá quem está presente é
   * `ArenaOccupant`/`ArenaLobbyMember`, sem posição nem sala.
   */
  occupants?: Array<AvatarSource & { userId: string }>
  canSend: boolean
  onSendMessage: (text: string) => boolean
  onClose: () => void
  /** Cabeçalho — a arena e o saguão não são "sala". */
  title?: string
  emptyText?: string
  closeLabel?: string
}) {
  const [text, setText] = useState('')
  const groups = useMemo(() => groupRoomChatMessages(messages), [messages])
  const occupantsById = useMemo(
    () => new Map(occupants.map((occupant) => [occupant.userId, occupant])),
    [occupants],
  )
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Nova mensagem chegou: rola pro final, igual a qualquer chat.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Abriu o painel: joga o cursor direto no campo pra já poder digitar.
  useEffect(() => {
    if (canSend) inputRef.current?.focus()
  }, [canSend])

  // Campo cresce com o texto até o teto do CSS (max-h), aí passa a rolar.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  function submit() {
    const trimmed = text.trim()
    if (!trimmed) return
    if (onSendMessage(trimmed)) setText('')
  }

  return (
    <div className="flex h-full flex-col text-on-surface">
      <header className="flex items-center justify-between border-b border-outline-variant px-md py-sm">
        <h2 className="font-label text-label-md text-on-surface-variant">{title}</h2>
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
        >
          <Icon name="close" className="text-[18px]" />
        </button>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-md py-sm">
        {messages.length === 0 ? (
          <p className="font-body text-body-sm text-on-surface-variant">{emptyText}</p>
        ) : (
          <ul className="flex flex-col gap-md">
            {groups.map((group) => {
              // Quem já saiu da sala não está mais em `occupants`: cai nas
              // iniciais do nome que veio junto da mensagem, como no
              // KnockRequestModal.
              const occupant = occupantsById.get(group.userId)
              return (
                <li key={group.key} className="flex items-start gap-sm font-body text-body-sm">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-highest">
                    <Avatar
                      preferCharacter
                      user={occupant ?? { name: group.name }}
                      initialsClassName="font-label text-label-sm font-bold text-primary"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="font-label text-label-sm text-on-surface-variant">{group.name}</span>
                    {group.messages.map((message, index) => (
                      <p
                        key={`${message.sentAt}-${index}`}
                        className="whitespace-pre-wrap break-words text-on-surface"
                      >
                        {renderMessageText(message.text)}
                      </p>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <form
        className="flex items-end gap-sm border-t border-outline-variant px-md py-sm"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <textarea
          ref={inputRef}
          value={text}
          rows={1}
          disabled={!canSend}
          maxLength={ROOM_CHAT_MESSAGE_MAX_LENGTH}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Não deixa a tecla vazar pro Phaser (senão o personagem anda enquanto digita).
            event.stopPropagation()
            // Enter envia; Shift+Enter (ou o Enter de composição do IME) quebra a linha.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          onKeyUp={(event) => event.stopPropagation()}
          placeholder={canSend ? 'Mensagem...' : 'Chat indisponível'}
          className="max-h-32 min-w-0 flex-1 resize-none overflow-y-auto break-words rounded-lg border border-outline-variant bg-surface-container-high/70 px-sm py-xs font-body text-body-md leading-normal text-on-surface outline-none placeholder:text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Enviar mensagem"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="send" className="text-[20px]" />
        </button>
      </form>
    </div>
  )
}
