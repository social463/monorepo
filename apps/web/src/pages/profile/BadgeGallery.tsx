import { useEffect, useMemo, useRef, useState } from 'react'
import { MAX_FEATURED_BADGES, type AwardedBadgeDTO } from '@legends/shared'
import { BadgeEmblem } from '../../components/BadgeEmblem'

const COLLAPSED_BADGE_COUNT = 6

function badgeHoverDescription(awarded: AwardedBadgeDTO): string {
  const { badge } = awarded
  if (badge.kind === 'STREAK') {
    return `Strike de ${badge.threshold} ${badge.threshold === 1 ? 'dia útil' : 'dias úteis'}`
  }
  return badge.description
}

function BadgeTooltip({ awarded }: { awarded: AwardedBadgeDTO }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[13rem] -translate-x-1/2 rounded-md border border-outline-variant/50 bg-surface-container-highest px-3 py-2 text-left opacity-0 shadow-xl transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
    >
      <span className="block font-label text-label-md text-on-surface">{awarded.badge.name}</span>
      <span className="mt-0.5 block whitespace-normal text-body-sm leading-snug text-on-surface-variant">
        {badgeHoverDescription(awarded)}
      </span>
    </span>
  )
}

export function BadgeGallery({
  badges,
  emptyLabel,
  className = '',
  highlightId,
  editable = false,
  onSaveFeatured,
}: {
  badges: AwardedBadgeDTO[]
  emptyLabel: string
  className?: string
  /** Quando vindo do mural (deep-link): rola até e destaca este selo (id do UserBadge). */
  highlightId?: string | null
  /** Habilita o modo de edição de destaques (perfil do próprio usuário). */
  editable?: boolean
  /** Persiste o conjunto de destaques (ids de UserBadge). */
  onSaveFeatured?: (badgeIds: string[]) => Promise<void> | void
}) {
  const scrolledRef = useRef(false)
  useEffect(() => {
    scrolledRef.current = false
  }, [highlightId])
  useEffect(() => {
    if (!highlightId || scrolledRef.current) return
    if (!badges.some((b) => b.id === highlightId)) return
    scrolledRef.current = true
    document.getElementById(`badge-${highlightId}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [highlightId, badges])

  const featuredIds = useMemo(() => badges.filter((b) => b.featured).map((b) => b.id), [badges])
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string[]>(featuredIds)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)

  function startEditing() {
    setSelected(featuredIds)
    setEditing(true)
  }
  function cancelEditing() {
    setSelected(featuredIds)
    setEditing(false)
  }
  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= MAX_FEATURED_BADGES) return prev
      return [...prev, id]
    })
  }
  async function save() {
    if (!onSaveFeatured) return
    setSaving(true)
    try {
      await onSaveFeatured(selected)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const canEdit = editable && badges.length > 0 && Boolean(onSaveFeatured)
  const shouldPaginate = badges.length > COLLAPSED_BADGE_COUNT
  const highlightIsHidden =
    Boolean(highlightId) && badges.findIndex((badge) => badge.id === highlightId) >= COLLAPSED_BADGE_COUNT
  const showAllBadges = editing || expanded || highlightIsHidden
  const visibleBadges = showAllBadges ? badges : badges.slice(0, COLLAPSED_BADGE_COUNT)
  const hiddenCount = badges.length - COLLAPSED_BADGE_COUNT

  return (
    <div className={`rounded-xl border border-outline-variant/40 bg-surface-container p-lg ${className}`}>
      <div className="mb-lg flex items-center justify-between gap-sm">
        <h3 className="font-headline text-headline-md text-on-surface">Galeria de selos</h3>
        {editing ? (
          <span className="font-label text-label-sm text-on-surface-variant">
            {selected.length}/{MAX_FEATURED_BADGES} em destaque
          </span>
        ) : canEdit ? (
          <button
            type="button"
            onClick={startEditing}
            className="rounded-md border border-outline-variant/60 px-md py-xs font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
          >
            Escolher destaques
          </button>
        ) : null}
      </div>

      {editing && (
        <div className="mb-md flex items-center justify-end gap-sm">
          <button
            type="button"
            onClick={cancelEditing}
            disabled={saving}
            className="rounded-md border border-outline-variant/60 px-md py-xs font-label text-label-sm text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-md bg-primary px-md py-xs font-label text-label-sm font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      )}

      {editing && (
        <p className="mb-md text-body-sm text-on-surface-variant">
          Escolha até {MAX_FEATURED_BADGES} selos para destacar no card da galeria de Lendas.
        </p>
      )}

      {badges.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">{emptyLabel}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-md">
            {visibleBadges.map((awarded) => {
              const isSelected = selected.includes(awarded.id)
              const limitReached = selected.length >= MAX_FEATURED_BADGES
              const baseClass =
                'group relative flex flex-col items-center rounded-lg border bg-surface-container-high p-md transition-all'
              if (editing) {
                return (
                  <button
                    key={awarded.id}
                    type="button"
                    onClick={() => toggle(awarded.id)}
                    disabled={!isSelected && limitReached}
                    aria-pressed={isSelected}
                    className={`${baseClass} ${isSelected ? 'border-primary ring-2 ring-primary/40' : 'border-outline-variant/20 hover:border-outline-variant/50'} disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    <BadgeTooltip awarded={awarded} />
                    <div className="mb-sm transition-transform group-hover:scale-110">
                      <BadgeEmblem badge={awarded.badge} size={64} />
                    </div>
                    <p className="text-center font-label text-label-sm text-on-surface">{awarded.badge.name}</p>
                  </button>
                )
              }
              return (
                <div
                  key={awarded.id}
                  id={`badge-${awarded.id}`}
                  tabIndex={0}
                  className={`${baseClass} cursor-default ${awarded.featured ? 'border-primary/50' : 'border-outline-variant/20 hover:border-outline-variant/50'} ${awarded.id === highlightId ? 'mural-highlight' : ''}`}
                >
                  <BadgeTooltip awarded={awarded} />
                  <div className="mb-sm transition-transform group-hover:scale-110">
                    <BadgeEmblem badge={awarded.badge} size={64} />
                  </div>
                  <p className="text-center font-label text-label-sm text-on-surface">{awarded.badge.name}</p>
                </div>
              )
            })}
          </div>

          {shouldPaginate && !editing && !highlightIsHidden && (
            <div className="mt-md flex justify-center">
              <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="rounded-md border border-outline-variant/60 px-md py-xs font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
              >
                {expanded ? 'Mostrar menos' : `Mostrar mais ${hiddenCount}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
