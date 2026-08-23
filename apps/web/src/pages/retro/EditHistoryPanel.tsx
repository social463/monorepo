import type { JSX } from 'react'
import type { RetroEditDTO } from '@legends/shared'

const ACTION_LABEL: Record<string, string> = {
  'action.updated': 'editou uma ação',
}

export function EditHistoryPanel({ edits, onClose }: { edits: RetroEditDTO[]; onClose: () => void }): JSX.Element {
  return (
    <div className="absolute right-0 top-0 z-20 flex h-full w-80 flex-col border-l border-outline-variant/40 bg-surface-container shadow-xl">
      <div className="flex items-center justify-between border-b border-outline-variant/40 px-4 py-3">
        <h3 className="font-label text-title-sm font-bold text-on-surface">Histórico de edições</h3>
        <button type="button" aria-label="Fechar" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {edits.length === 0 ? (
          <p className="px-2 py-1 text-body-sm text-on-surface-variant">Nenhuma edição registrada.</p>
        ) : (
          <ul className="space-y-2">
            {edits.map((e) => (
              <li key={e.id} className="rounded-lg border border-outline-variant/30 bg-surface-container-high p-3">
                <p className="text-body-sm text-on-surface">
                  <span className="font-bold">{e.editor.name}</span> {ACTION_LABEL[e.action] ?? e.action}
                </p>
                {e.detail && <p className="mt-1 text-body-sm text-on-surface-variant">{e.detail}</p>}
                <p className="mt-1 font-label text-label-sm text-on-surface-variant">{new Date(e.createdAt).toLocaleString('pt-BR')}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
