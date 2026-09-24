import type { ReactNode } from 'react'

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-sm md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? (
          <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">{eyebrow}</p>
        ) : null}
        <h2 className="mt-1 font-headline text-headline-md text-on-surface">{title}</h2>
        {description ? <p className="mt-2 text-body-md text-on-surface-variant">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
