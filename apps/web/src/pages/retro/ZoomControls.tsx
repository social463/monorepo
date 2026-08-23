export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
}) {
  const btn =
    'flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest'
  return (
    <div className="absolute bottom-4 right-4 flex items-center gap-1 rounded-full border border-outline-variant/40 bg-surface-container px-2 py-1 shadow-lg">
      <button type="button" aria-label="Centralizar" onClick={onReset} className={btn}>
        ⌖
      </button>
      <button type="button" aria-label="Diminuir zoom" onClick={onZoomOut} className={btn}>
        −
      </button>
      <span className="min-w-[3.5ch] text-center font-label text-label-sm text-on-surface">
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" aria-label="Aumentar zoom" onClick={onZoomIn} className={btn}>
        +
      </button>
    </div>
  )
}
