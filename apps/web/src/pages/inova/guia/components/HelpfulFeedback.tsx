import { useState } from 'react'
import { Icon } from '../../../../components/Icon'

export function HelpfulFeedback({ contentId, contentType }: { contentId: string; contentType: string }) {
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null)

  return (
    <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg" data-content-id={contentId} data-content-type={contentType}>
      {answer === null ? (
        <div className="flex flex-wrap items-center gap-sm">
          <span className="font-label text-label-md font-bold text-on-surface">Isso ajudou?</span>
          <button
            type="button"
            onClick={() => setAnswer('yes')}
            className="inline-flex min-h-9 items-center gap-xs rounded-full border border-outline-variant/60 px-md text-label-md hover:border-primary/60"
          >
            <Icon name="thumb_up" className="text-[16px]" /> Sim
          </button>
          <button
            type="button"
            onClick={() => setAnswer('no')}
            className="inline-flex min-h-9 items-center gap-xs rounded-full border border-outline-variant/60 px-md text-label-md hover:border-primary/60"
          >
            <Icon name="thumb_down" className="text-[16px]" /> Não
          </button>
        </div>
      ) : (
        <p className="text-body-md text-on-surface-variant">
          {answer === 'yes' ? 'Obrigado pela resposta!' : 'Obrigado pela resposta.'}
        </p>
      )}
    </div>
  )
}
