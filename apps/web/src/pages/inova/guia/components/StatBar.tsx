export function StatBar({ value, label }: { value: number; label: string }) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div>
      <div className="flex items-center justify-between text-body-sm text-on-surface-variant">
        <span>{label}</span>
        <span>{Math.round(clamped)}%</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-container-high">
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}
