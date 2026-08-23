import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { useMarkRead } from '../../lib/use-notifications'
import type { InviteToastItem } from './useOfficeInviteToasts'

const AUTO_DISMISS_MS = 10_000

const CTA_LABEL: Record<InviteToastItem['type'], string> = {
  RETRO_INVITED: 'Clique para participar',
  PERIOD_OPENED: 'Clique para votar',
  VOTE_REMINDER_MIDWAY: 'Clique para votar',
  VOTE_REMINDER_CLOSING: 'Clique para votar',
}

export function InviteToastStack({
  queue,
  dismiss,
}: {
  queue: InviteToastItem[]
  dismiss: (id: string) => void
}) {
  if (queue.length === 0) return null
  return (
    <div className="absolute top-16 right-3 z-30 flex w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-sm md:right-5 md:top-16">
      {queue.map((item) => (
        <InviteToast key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
      ))}
    </div>
  )
}

function InviteToast({ item, onDismiss }: { item: InviteToastItem; onDismiss: () => void }) {
  const markRead = useMarkRead()

  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  return (
    <div className="flex items-start gap-sm rounded-xl border border-outline-variant/40 bg-surface-container/95 p-md shadow-lg backdrop-blur">
      <Link
        to={item.link}
        onClick={() => markRead.mutate(item.id)}
        className="min-w-0 flex-1"
      >
        <p className="text-body-sm text-on-surface">{item.title}</p>
        <p className="mt-1 font-label text-label-sm font-bold text-primary">{CTA_LABEL[item.type]}</p>
      </Link>
      <button
        type="button"
        aria-label="Dispensar convite"
        onClick={onDismiss}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
      >
        <Icon name="close" className="text-[16px]" />
      </button>
    </div>
  )
}
