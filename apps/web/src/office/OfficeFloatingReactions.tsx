import { Avatar, type AvatarSource } from '../components/Avatar'
import type { OfficeFloatingReaction } from './office-floating-reactions'

/**
 * Mesmo modelo visual da Retrospectiva (`FloatingReactions.tsx`): decola do
 * rodapé numa posição horizontal aleatória, HTML puro — não depende do
 * canvas do Phaser, então sempre fica por cima de qualquer overlay (grade de
 * câmeras, painéis, MediaBar), ao contrário da bolha de reação antiga.
 */
export function OfficeFloatingReactions({ reactions }: { reactions: OfficeFloatingReaction[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[65] overflow-hidden">
      {reactions.map((r) => {
        const source: AvatarSource = {
          name: r.name,
          photoUrl: r.photoUrl,
          avatarStyle: r.avatarStyle,
          avatarSeed: r.avatarSeed,
          avatarOptions: r.avatarOptions,
        }
        return (
          <div
            key={r.id}
            data-office-float-reaction
            className="absolute bottom-24 flex animate-office-float flex-col items-center gap-0.5"
            style={{ left: `${r.xPercent}%` }}
          >
            <span className="text-3xl leading-none drop-shadow">{r.emoji}</span>
            {r.name && (
              <span className="flex items-center gap-1 rounded-full bg-surface-container-highest/90 px-1.5 py-0.5 shadow">
                <span className="flex h-4 w-4 items-center justify-center overflow-hidden rounded-full bg-zinc-700">
                  <Avatar preferCharacter user={source} initialsClassName="text-[8px] font-bold text-white" />
                </span>
                <span className="font-label text-[10px] text-on-surface">{r.name}</span>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
