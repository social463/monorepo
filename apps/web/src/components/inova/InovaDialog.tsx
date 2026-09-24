import { useEffect, useId, type ReactNode } from 'react'
import { Icon } from '../Icon'

/**
 * Modal simples do INOVA (nova entrada do diário, nova tarefa). Fecha no Esc e
 * no clique fora; o conteúdo rola sozinho para caber em tela de celular.
 */
export function InovaDialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-outline-variant/40 bg-surface-container p-lg shadow-lg"
      >
        <div className="mb-md flex items-start justify-between gap-md">
          <h2 id={titleId} className="font-headline text-headline-sm text-on-surface">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
          >
            <Icon name="close" className="text-[20px]" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
