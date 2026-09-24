import { useState } from 'react'
import { Icon } from '../../../../components/Icon'
import { trackEvent } from '../../../../lib/analytics'
import { cx } from '../lib/cx'

export function CopyPromptButton({
  text,
  promptId,
  label = 'Copiar prompt',
}: {
  text: string
  promptId: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* clipboard bloqueado pelo navegador */
    }
    setCopied(true)
    trackEvent('inova_guia_prompt_copiado', { promptId })
    window.setTimeout(() => setCopied(false), 2200)
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cx(
        'inline-flex min-h-11 items-center gap-sm rounded-full px-lg font-label text-label-md font-bold transition-colors',
        copied ? 'bg-primary-container text-on-primary-container' : 'bg-primary text-on-primary hover:brightness-95',
      )}
    >
      <Icon name={copied ? 'check' : 'content_copy'} className="text-[18px]" />
      {copied ? 'Prompt copiado' : label}
    </button>
  )
}
