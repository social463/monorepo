import { useCallback, useRef, useState } from 'react'
import { ARENA_LOBBY_ID, type ArenaLobbyClientMessage, type ArenaLobbyMember } from '@legends/shared'
import { Avatar } from '../components/Avatar'
import { RoomChatPanel } from '../office/media/RoomChatPanel'
import { ArenaMediaBar } from './media/ArenaMediaBar'
import { ArenaRemoteAudio } from './media/ArenaRemoteAudio'
import { useArenaMedia } from './media/useArenaMedia'
import { useArenaChat } from './useArenaChat'
import { useArenaLobbySocket } from './useArenaLobbySocket'

/**
 * Saguão da arena — quem está no menu, esperando para jogar.
 *
 * Existe para o menu não ser uma sala de espera solitária: aqui se vê quem
 * mais está por perto, escreve-se e conversa-se por voz antes de escolher o
 * modo. A voz do saguão NÃO é espacial (não há posição no menu, ver
 * `arena-lobby.ts`): todo mundo se ouve por igual, como numa mesa.
 */
export function ArenaLobby({
  you,
  onEntrar,
}: {
  you: { userId: string; name: string } | null
  /** Renderizado à esquerda do saguão — os cartões de modo. */
  onEntrar: React.ReactNode
}) {
  const [membros, setMembros] = useState<ArenaLobbyMember[]>([])
  const [chatAberto, setChatAberto] = useState(true)
  /**
   * A mídia só conecta depois do `welcome`: o token do LiveKit é autorizado
   * pela PRESENÇA no hub do saguão, então pedi-lo antes de entrar volta 409.
   */
  const [presente, setPresente] = useState(false)

  /**
   * O `send` do socket vai por ref porque o chat é declarado ANTES dele — e
   * precisa ser: é o `chat.receive` que o handler do socket chama.
   */
  const sendRef = useRef<(message: ArenaLobbyClientMessage) => void>(() => {})
  const chat = useArenaChat({
    send: (text) => sendRef.current({ type: 'chat', text }),
    sender: you,
    connected: presente,
    open: chatAberto,
  })

  const lobby = useArenaLobbySocket(true, (message) => {
    switch (message.type) {
      case 'welcome':
        setMembros(message.members)
        setPresente(true)
        break
      case 'joined':
        setMembros((atuais) => [
          ...atuais.filter((membro) => membro.userId !== message.member.userId),
          message.member,
        ])
        break
      case 'left':
        setMembros((atuais) => atuais.filter((membro) => membro.userId !== message.userId))
        break
      case 'chat':
        chat.receive(message)
        break
    }
  })

  sendRef.current = lobby.send

  const media = useArenaMedia({ arenaId: presente ? ARENA_LOBBY_ID : null, spatial: false })

  const abrirChat = useCallback(() => {
    setChatAberto((aberto) => {
      if (aberto) return false
      chat.markRead()
      return true
    })
  }, [chat])

  return (
    <div className="flex w-full max-w-5xl flex-col items-center gap-lg lg:flex-row lg:items-stretch lg:justify-center">
      <div className="flex flex-col items-center gap-lg">{onEntrar}</div>

      <aside className="flex h-[26rem] w-full max-w-sm flex-col overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container">
        <header className="flex items-center justify-between border-b border-outline-variant/40 px-md py-sm">
          <h2 className="font-label text-label-md text-on-surface-variant">
            No saguão {membros.length > 0 && `· ${membros.length}`}
          </h2>
          <span className="flex -space-x-2">
            {membros.slice(0, 6).map((membro) => (
              <span
                key={membro.userId}
                title={membro.name}
                className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-surface-container bg-surface-container-highest"
              >
                <Avatar
                  preferCharacter
                  user={membro}
                  initialsClassName="font-label text-[10px] font-bold text-primary"
                />
              </span>
            ))}
          </span>
        </header>

        {/* O botão de chat da barra alterna entre a conversa e a lista de
            quem está aqui — o painel é o mesmo espaço, e manter os dois
            empilhados espremeria os dois. */}
        {!chatAberto ? (
          <ul className="min-h-0 flex-1 overflow-y-auto px-md py-sm">
            {membros.map((membro) => (
              <li key={membro.userId} className="flex items-center gap-sm py-1 font-body text-body-sm">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-highest">
                  <Avatar
                    preferCharacter
                    user={membro}
                    initialsClassName="font-label text-[10px] font-bold text-primary"
                  />
                </span>
                <span className="min-w-0 flex-1 truncate text-on-surface">{membro.name}</span>
                {membro.userId === you?.userId && (
                  <span className="font-label text-label-sm text-on-surface-variant">você</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
        <div className="min-h-0 flex-1">
          <RoomChatPanel
            messages={chat.messages}
            occupants={membros}
            canSend={presente && you !== null}
            onSendMessage={chat.sendMessage}
            onClose={() => setChatAberto(false)}
            title="Chat do saguão"
            emptyText={
              membros.length > 1
                ? 'Combine a próxima partida por aqui.'
                : 'Ninguém mais por aqui ainda — escreva e quem chegar vai ver.'
            }
            closeLabel="Fechar chat do saguão"
          />
        </div>
        )}

        <div className="flex justify-center border-t border-outline-variant/40 p-sm">
          <ArenaMediaBar
            media={media}
            chatAberto={chatAberto}
            chatNaoLidas={chat.unread}
            onToggleChat={abrirChat}
            /* Quem está no SAGUÃO, não quem está na sala de voz: aqui a
               presença é o socket, e alguém sem mídia conectada continua
               presente na conversa por texto. */
            pessoas={membros.length}
          />
        </div>
      </aside>

      {media.remotes.map(
        (remoto) =>
          remoto.audioTrack && (
            <ArenaRemoteAudio key={remoto.userId} track={remoto.audioTrack} userId={remoto.userId} />
          ),
      )}
    </div>
  )
}
