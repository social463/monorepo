interface IconProps {
  name: string
  className?: string
  /** Render the filled variant of the symbol. */
  filled?: boolean
}

/**
 * Material Symbols Outlined glyph. Decorative by default (aria-hidden);
 * pair it with visible text or an aria-label on the parent control.
 */
export function Icon({ name, className, filled = false }: IconProps) {
  return (
    <span
      aria-hidden
      className={`material-symbols-outlined select-none leading-none ${className ?? ''}`}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
    >
      {name}
    </span>
  )
}
