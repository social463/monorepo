import { Icon } from '../../components/Icon'

function volumeIcon(volume: number): string {
  if (volume <= 0) return 'volume_off'
  if (volume < 50) return 'volume_down'
  return 'volume_up'
}

export function UserVolumeControl({
  name,
  volume,
  onVolumeChange,
  compact = false,
  className = '',
}: {
  name: string
  volume: number
  onVolumeChange: (volume: number) => void
  compact?: boolean
  className?: string
}) {
  const label = `Volume de ${name}`
  return (
    <label
      className={`flex items-center gap-xs rounded-md border border-white/10 bg-black/35 px-sm py-xs text-white shadow-sm backdrop-blur ${className}`}
    >
      <Icon name={volumeIcon(volume)} className="shrink-0 text-[18px] text-white/85" />
      <input
        aria-label={label}
        type="range"
        min={0}
        max={100}
        step={5}
        value={volume}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => onVolumeChange(Number(event.currentTarget.value))}
        className={compact ? 'h-5 w-20 accent-primary' : 'h-5 min-w-0 flex-1 accent-primary'}
      />
      <span className="w-9 text-right font-label text-[11px] text-white/85">{volume}%</span>
    </label>
  )
}

