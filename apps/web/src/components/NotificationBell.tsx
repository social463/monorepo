import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNotifications, useUnreadCount, useMarkAllRead } from '../lib/use-notifications'
import { Icon } from './Icon'

export function NotificationBell({
  variant = 'default',
  anchor = 'bottom',
  open: openProp,
  onOpenChange,
}: {
  variant?: 'default' | 'bare'
  anchor?: 'bottom' | 'right'
  open?: boolean
  onOpenChange?: (open: boolean) => void
} = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = openProp ?? uncontrolledOpen
  function setOpen(next: boolean) {
    if (openProp === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const ref = useRef<HTMLDivElement>(null)
  const unread = useUnreadCount()
  const list = useNotifications('all', open)
  const markAllRead = useMarkAllRead()

  const count = unread.data?.unreadCount ?? 0
  const items = list.data?.pages.flatMap((p) => p.items) ?? []

  // Abrir o sino marca tudo como lido (zera o contador).
  useEffect(() => {
    if (open && count > 0) markAllRead.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Notificações"
        className={`office-toolbar-btn relative flex items-center justify-center rounded-full border transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 ${
          variant === 'bare'
            ? `h-11 w-11 ${
                open
                  ? 'border-primary-container/40 bg-primary-container/20 text-primary shadow-[0_0_15px_rgb(var(--brand-primary,37 222 136)/0.3)]'
                  : 'border-transparent text-on-surface-variant hover:border-primary-container/30 hover:bg-primary-container/10 hover:text-primary hover:shadow-[0_0_15px_rgb(var(--brand-primary,37 222 136)/0.3)]'
              }`
            : 'h-10 w-10 border-outline-variant/40 bg-surface-container/95 text-on-surface-variant shadow-lg backdrop-blur transition-colors hover:bg-surface-container-highest hover:text-on-surface'
        }`}
      >
        <Icon name="notifications" className="text-[24px]" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-error px-1 font-label text-[10px] font-bold text-on-error">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={
            anchor === 'right'
              ? 'absolute left-full top-0 z-50 ml-sm flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container shadow-lg'
              : 'fixed inset-x-sm top-[4.75rem] z-50 flex max-h-[calc(100vh-5.5rem)] flex-col overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container shadow-lg md:absolute md:left-auto md:right-0 md:top-full md:mt-sm md:block md:max-h-none md:w-80'
          }
        >
          <div className="border-b border-outline-variant/40 px-lg py-md font-label text-label-md font-bold text-on-surface">
            Notificações
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto md:max-h-96 md:flex-none">
            {items.length === 0 ? (
              <p className="px-lg py-xl text-center text-body-sm text-on-surface-variant">
                Nenhuma notificação ainda
              </p>
            ) : (
              items.map((n) => {
                const inner = (
                  <div className="flex items-start gap-sm px-lg py-md transition-colors hover:bg-surface-container-highest">
                    <Icon name={iconFor(n.type)} className="mt-0.5 text-[20px] text-primary" />
                    <div className="min-w-0">
                      <p className={`text-body-sm ${n.read ? 'text-on-surface-variant' : 'font-bold text-on-surface'}`}>
                        {n.title}
                      </p>
                    </div>
                  </div>
                )
                return n.link ? (
                  <Link key={n.id} to={n.link} onClick={() => setOpen(false)} className="block">
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id}>{inner}</div>
                )
              })
            )}
          </div>
          <Link
            to="/notificacoes"
            onClick={() => setOpen(false)}
            className="block border-t border-outline-variant/40 px-lg py-md text-center font-label text-label-md text-primary hover:bg-surface-container-highest"
          >
            Ver todas
          </Link>
        </div>
      )}
    </div>
  )
}

function iconFor(type: string): string {
  switch (type) {
    case 'FEEDBACK_RECEIVED':
      return 'chat'
    case 'FEEDBACK_REACTION':
      return 'add_reaction'
    case 'FEEDBACK_COMMENT':
      return 'chat_bubble'
    case 'BADGE_EARNED':
      return 'workspace_premium'
    case 'HIGHLIGHT_PUBLISHED':
      return 'trophy'
    case 'BIRTHDAY_GREETING_RECEIVED':
      return 'cake'
    case 'MEETING_INVITED':
    case 'MEETING_UPDATED':
    case 'MEETING_CANCELED':
    case 'MEETING_REMINDER':
      return 'calendar_month'
    case 'ONE_ON_ONE_INVITED':
    case 'ONE_ON_ONE_ACTION_ASSIGNED':
    case 'ONE_ON_ONE_REMINDER':
      return 'forum'
    case 'VACATION_PLAN_VALIDATED':
    case 'VACATION_PLAN_DEADLINE':
      return 'beach_access'
    case 'OFFICE_DESK_REMINDER_RECEIVED':
      return 'redeem'
    case 'OFFICE_DESK_REMINDER_READ':
      return 'mark_email_read'
    case 'PDI_ACTION_AWAITING_REVIEW':
      return 'pending_actions'
    case 'PDI_ACTION_APPROVED':
      return 'task_alt'
    case 'PDI_ACTION_CHANGES_REQUESTED':
      return 'edit_note'
    case 'MANDATORY_COURSE_ASSIGNED':
      return 'menu_book'
    case 'REVIEW_POLL_PUBLISHED':
      return 'poll'
    default:
      return 'how_to_vote'
  }
}
