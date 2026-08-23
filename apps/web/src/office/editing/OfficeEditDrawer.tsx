import type { MapTilesetV1 } from '@legends/shared'
import { Icon } from '../../components/Icon'
import AssetPalette from '../editor/AssetPalette'
import type { useOfficeMapEditing, EditTool } from './useOfficeMapEditing'

type ToolDef = { tool: EditTool; label: string; icon: string; disabled?: boolean }

const TOOL_GROUPS: { label: string; tools: ToolDef[] }[] = [
  {
    label: 'Pintura',
    tools: [
      { tool: 'brush', label: 'Mobília', icon: 'chair' },
      { tool: 'select', label: 'Girar', icon: 'rotate_right' },
      { tool: 'eraser', label: 'Borracha', icon: 'ink_eraser' },
    ],
  },
  {
    label: 'Áreas',
    tools: [
      { tool: 'silence-zone', label: 'Silêncio', icon: 'volume_off' },
      { tool: 'call-zone', label: 'Chamada', icon: 'call' },
      { tool: 'collision', label: 'Colisão', icon: 'block' },
      // Par da ferramenta acima: a borracha comum apaga a PEÇA sob o cursor, e
      // a colisão desenhada sobre um móvel ficava inalcançável por ela.
      { tool: 'collision-eraser', label: 'Apagar colisão', icon: 'do_not_disturb_off' },
    ],
  },
  {
    label: 'Interações',
    tools: [
      { tool: 'link', label: 'Link', icon: 'link' },
      { tool: 'action-point', label: 'Ação', icon: 'bolt', disabled: true },
      { tool: 'door', label: 'Porta', icon: 'door_open', disabled: true },
    ],
  },
]

export interface OfficeEditDrawerProps {
  editing: ReturnType<typeof useOfficeMapEditing>
  mapTilesets: MapTilesetV1[]
  mapTileWidth: number
}

/**
 * Painel de edição in-place do mapa (Task C5) — fica por cima do canvas
 * enquanto `editing.state.active` é true. Só troca a ferramenta ativa e
 * dispara Salvar/Cancelar; o desenho (pintura de tile ou retângulo de área)
 * acontece na cena Phaser via os callbacks ligados em `useOfficeMapEditing`.
 */
export default function OfficeEditDrawer({ editing, mapTilesets, mapTileWidth }: OfficeEditDrawerProps) {
  const { state, setTool, selectTile, clearSelectedTile, clearAllFurniture, save, cancel, undo } = editing
  void mapTilesets
  return (
    <aside
      onWheel={(event) => event.stopPropagation()}
      className="absolute inset-y-0 right-0 z-[70] flex w-[22rem] max-w-[calc(100vw-1rem)] flex-col border-l border-outline-variant/40 bg-surface-container/95 text-on-surface shadow-2xl backdrop-blur"
    >
      <header className="flex items-center justify-between border-b border-outline-variant/30 px-lg py-md">
        <div className="min-w-0">
          <p className="font-label text-[11px] uppercase tracking-wide text-primary">Editar mapa</p>
          <h3 className="truncate font-headline text-headline-sm text-on-surface">Decoração</h3>
        </div>
        <button
          type="button"
          onClick={cancel}
          aria-label="Fechar sem salvar"
          title="Fechar sem salvar"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
        >
          <Icon name="close" className="text-[20px]" />
        </button>
      </header>

      {state.limitError && (
        <div className="mx-lg mt-md rounded-lg bg-error-container/90 px-md py-sm font-label text-label-sm text-on-error-container">
          {state.limitError}
        </div>
      )}

      {state.saveError && (
        <div className="mx-lg mt-md rounded-lg bg-error-container/90 px-md py-sm font-label text-label-sm text-on-error-container">
          {state.saveError}
        </div>
      )}

      <div className="flex-1 space-y-lg overflow-y-auto px-lg py-md">
        {TOOL_GROUPS.map((group) => (
          <section key={group.label}>
            <p className="mb-sm font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
              {group.label}
            </p>
            <div className="grid grid-cols-3 gap-sm">
              {group.tools.map((t) => {
                const active = state.tool === t.tool
                return (
                  <button
                    key={t.tool}
                    type="button"
                    aria-pressed={active}
                    disabled={t.disabled}
                    title={t.disabled ? 'Em breve' : t.label}
                    onClick={() => {
                      if (!t.disabled) setTool(t.tool)
                    }}
                    className={`flex flex-col items-center gap-xs rounded-xl border px-xs py-sm font-label text-label-sm transition-colors ${
                      active
                        ? 'border-primary bg-primary-container text-on-primary-container'
                        : 'border-outline-variant/40 bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
                    } ${t.disabled ? 'cursor-not-allowed opacity-40 hover:bg-surface-container-high hover:text-on-surface-variant' : ''}`}
                  >
                    <Icon name={t.icon} className="text-[20px]" />
                    <span className="leading-tight">{t.label}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}

        {state.tool === 'brush' && (
          <AssetPalette
            tileSize={mapTileWidth}
            selected={state.selectedTile}
            onSelect={selectTile}
            onDeselect={clearSelectedTile}
            onClearAll={clearAllFurniture}
          />
        )}
      </div>

      <footer className="flex items-center gap-sm border-t border-outline-variant/30 px-lg py-md">
        <button
          type="button"
          onClick={() => void undo()}
          disabled={!state.canUndo || state.saving}
          aria-label="Desfazer"
          title="Desfazer (Ctrl/Cmd+Z)"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-outline-variant/40 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-on-surface-variant"
        >
          <Icon name="undo" className="text-[20px]" />
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!state.dirty || state.saving}
          className="flex flex-1 items-center justify-center gap-xs rounded-full bg-primary px-md py-sm font-label text-label-lg text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          <Icon name="save" className="text-[18px]" />
          {state.saving ? 'Salvando…' : 'Salvar'}
        </button>
        <button
          type="button"
          onClick={cancel}
          className="rounded-full border border-outline-variant/40 px-md py-sm font-label text-label-lg text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
        >
          Cancelar
        </button>
      </footer>
    </aside>
  )
}
