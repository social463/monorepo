import type { RetroParticipantDTO } from '@legends/shared'
import { Avatar, type AvatarSource } from '../../components/Avatar'
import type { FloatingReaction } from './floating-reactions'

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name
}

export function FloatingReactions({
  reactions,
  participants,
}: {
  reactions: FloatingReaction[]
  participants: RetroParticipantDTO[]
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
      {reactions.map((r) => {
        const p = participants.find((x) => x.user.id === r.userId)
        const source: AvatarSource = p?.user ?? { name: r.name }
        return (
          <div
            key={r.id}
            data-float-reaction
            className="absolute bottom-2 flex animate-retro-float flex-col items-center gap-0.5"
            style={{ left: `${r.xPercent}%` }}
          >
            <span className="text-3xl leading-none drop-shadow">{r.emoji}</span>
            <span className="flex items-center gap-1 rounded-full bg-surface-container-highest/90 px-1.5 py-0.5 shadow">
              <span className="flex h-4 w-4 items-center justify-center overflow-hidden rounded-full bg-zinc-700">
                <Avatar user={source} initialsClassName="text-[8px] font-bold text-white" />
              </span>
              <span className="font-label text-[10px] text-on-surface">{firstName(r.name)}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
