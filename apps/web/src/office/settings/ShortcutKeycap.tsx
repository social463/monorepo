export function ShortcutKeycap({ keys, className = '' }: { keys: string | readonly string[]; className?: string }) {
  const parts = Array.isArray(keys) ? keys : [keys]

  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center gap-1 ${className}`}>
      {parts.map((key, index) => (
        <span key={`${key}-${index}`} className="rounded border border-outline-variant/50 bg-surface-container-high px-1.5 py-0.5 font-label text-[10px] font-bold leading-none text-on-surface-variant shadow-sm">
          {key}
        </span>
      ))}
    </span>
  )
}
