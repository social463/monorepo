/** Aviso global de "alguém no alto-falante" — o áudio é do OfficeSessionProvider. */
export function BroadcastBanner({ speakers }: { speakers: string[] }) {
  if (speakers.length === 0) return null
  return (
    <div
      role="status"
      className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-primary/40 bg-surface-container/95 px-lg py-sm font-label text-label-md text-on-surface shadow-lg backdrop-blur"
    >
      📢 {speakers.join(', ')} no alto-falante
    </div>
  )
}
