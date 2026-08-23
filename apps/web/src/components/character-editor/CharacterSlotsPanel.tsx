import {
  CHARACTER_FAVORITE_SLOTS,
  type CharacterFavoriteDTO,
  type CharacterFavoriteSlot,
  type CharacterOptions,
} from '@legends/shared'
import { Icon } from '../Icon'
import { useCharacterPortrait } from '../../hooks/useCharacterPortrait'

interface SlotView {
  slot: CharacterFavoriteSlot
  favorite: CharacterFavoriteDTO | null
}

function buildSlots(favorites: CharacterFavoriteDTO[]): SlotView[] {
  return CHARACTER_FAVORITE_SLOTS.map((slot) => ({
    slot,
    favorite: favorites.find((favorite) => favorite.slot === slot) ?? null,
  }))
}

function SlotPlaceholder() {
  return (
    <div className="grid h-24 w-24 place-items-center rounded-lg border border-dashed border-outline-variant/60 bg-surface-container-high text-on-surface-variant">
      <Icon name="person_add" className="text-[28px]" />
    </div>
  )
}

function SlotPortrait({ favorite }: { favorite: CharacterFavoriteDTO }) {
  const portrait = useCharacterPortrait({
    name: `Slot ${favorite.slot}`,
    avatarStyle: 'lpc',
    avatarSeed: favorite.seed,
    avatarOptions: favorite.options,
  })

  return portrait ? (
    <img
      src={portrait}
      alt={`Prévia do slot ${favorite.slot}`}
      className="h-24 w-24 rounded-lg bg-surface-container-high object-contain [image-rendering:pixelated]"
    />
  ) : (
    <SlotPlaceholder />
  )
}

export function CharacterSlotsPanel({
  favorites,
  currentOptions,
  busySlot,
  onSave,
  onUse,
  onDelete,
}: {
  favorites: CharacterFavoriteDTO[]
  currentOptions: CharacterOptions
  busySlot: CharacterFavoriteSlot | null
  onSave: (slot: CharacterFavoriteSlot) => void
  onUse: (favorite: CharacterFavoriteDTO) => void
  onDelete: (slot: CharacterFavoriteSlot) => void
}) {
  const slots = buildSlots(favorites)

  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container p-md">
      <div className="mb-md flex items-center justify-between gap-md">
        <h3 className="font-headline text-title-md text-on-surface">Meus visuais</h3>
        <span className="font-label text-label-sm text-on-surface-variant">{favorites.length}/5 salvos</span>
      </div>

      <div className="grid grid-cols-2 gap-sm sm:grid-cols-3 lg:grid-cols-5">
        {slots.map(({ slot, favorite }) => {
          const busy = busySlot === slot
          return (
            <article
              key={slot}
              className="flex min-h-[220px] flex-col items-center gap-sm rounded-lg border border-outline-variant/40 bg-surface p-sm"
            >
              <div className="flex w-full items-center justify-between">
                <span className="font-label text-label-sm font-bold text-on-surface">Slot {slot}</span>
                {favorite ? (
                  <button
                    type="button"
                    onClick={() => onDelete(slot)}
                    disabled={busy}
                    className="rounded-md p-xs text-on-surface-variant hover:bg-surface-container-high hover:text-error disabled:opacity-60"
                    aria-label={`Limpar slot ${slot}`}
                  >
                    <Icon name="delete" className="text-[18px]" />
                  </button>
                ) : null}
              </div>

              {favorite ? <SlotPortrait favorite={favorite} /> : <SlotPlaceholder />}

              {favorite ? (
                <div className="mt-auto grid w-full grid-cols-1 gap-xs">
                  <button
                    type="button"
                    onClick={() => onUse(favorite)}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-xs rounded-md bg-primary px-sm py-xs font-label text-label-sm font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
                  >
                    <Icon name="checkroom" className="text-[18px]" />
                    Usar
                  </button>
                  <button
                    type="button"
                    onClick={() => onSave(slot)}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-xs rounded-md border border-outline-variant/50 px-sm py-xs font-label text-label-sm text-on-surface hover:border-primary disabled:opacity-60"
                  >
                    <Icon name="save" className="text-[18px]" />
                    Substituir
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onSave(slot)}
                  disabled={busy || !currentOptions}
                  className="mt-auto inline-flex w-full items-center justify-center gap-xs rounded-md border border-outline-variant/50 px-sm py-xs font-label text-label-sm text-on-surface hover:border-primary disabled:opacity-60"
                >
                  <Icon name="save" className="text-[18px]" />
                  Salvar aqui
                </button>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
