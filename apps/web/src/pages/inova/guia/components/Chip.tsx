import type { ReactNode } from 'react'
import { cx } from '../lib/cx'

export function Chip({
  children,
  active,
  onClick,
}: {
  children: ReactNode
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex min-h-9 items-center rounded-full border px-lg py-xs font-label text-label-md transition-colors',
        active
          ? 'border-primary bg-primary text-on-primary'
          : 'border-outline-variant/60 bg-surface text-on-surface-variant hover:border-primary/60',
      )}
    >
      {children}
    </button>
  )
}
