import { useEffect, useState } from 'react'
import { Icon } from './Icon'

export interface LightboxImage {
  url: string
  /** Nome do arquivo; vira o texto alternativo e o rótulo do "Abrir original". */
  name: string
}

/**
 * Visualizador de imagem em tela cheia — o que faltava no feed: a foto do card
 * é uma prévia contida, e ler um banner com texto miúdo exigia abrir o arquivo
 * na mão.
 *
 * Duas escalas, e não zoom livre: **ajustada** (cabe na tela) e **100%**, que
 * rola dentro do próprio overlay. Zoom contínuo pediria arrasto, pinça e limite
 * de escala — três controles para o caso de uso real, que é aproximar o texto
 * de um comunicado.
 *
 * O overlay é `fixed` e cobre a tela toda: Esc fecha, clique no fundo fecha, e
 * as setas ‹ › só existem quando o post tem mais de uma imagem.
 */
export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: LightboxImage[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}) {
  const [zoomed, setZoomed] = useState(false)
  const count = images.length
  const current = images[index]

  // Trocar de imagem com a anterior ampliada deixaria a próxima entrando em
  // 100%, cortada, sem que ninguém tenha pedido.
  useEffect(() => setZoomed(false), [index])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight' && count > 1) onIndexChange((index + 1) % count)
      if (event.key === 'ArrowLeft' && count > 1) onIndexChange((index - 1 + count) % count)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onIndexChange, index, count])

  if (!current) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Imagem: ${current.name}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
    >
      <div className="flex shrink-0 items-center justify-end gap-sm p-md">
        {count > 1 && (
          <span className="mr-auto font-label text-label-sm text-white/70">
            {index + 1} de {count}
          </span>
        )}
        <button
          type="button"
          onClick={() => setZoomed((z) => !z)}
          className="inline-flex items-center gap-xs rounded-md border border-white/30 px-3 py-1 font-label text-label-sm text-white hover:bg-white/10"
        >
          <Icon name={zoomed ? 'zoom_out' : 'zoom_in'} className="text-[16px]" />
          {zoomed ? 'Ajustar à tela' : 'Ampliar'}
        </button>
        <a
          href={current.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-xs rounded-md border border-white/30 px-3 py-1 font-label text-label-sm text-white hover:bg-white/10"
        >
          <Icon name="open_in_new" className="text-[16px]" />
          Abrir original
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="inline-flex items-center gap-xs rounded-md border border-white/30 px-3 py-1 font-label text-label-sm text-white hover:bg-white/10"
        >
          <Icon name="close" className="text-[16px]" />
          Fechar
        </button>
      </div>

      <div
        className={`flex min-h-0 flex-1 items-center justify-center gap-sm px-md pb-md ${zoomed ? 'overflow-auto' : ''}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        {count > 1 && (
          <button
            type="button"
            onClick={() => onIndexChange((index - 1 + count) % count)}
            aria-label="Imagem anterior"
            className="shrink-0 self-center rounded-full border border-white/30 p-2 text-white hover:bg-white/10"
          >
            <Icon name="chevron_left" className="text-[20px]" />
          </button>
        )}
        <img
          src={current.url}
          alt={current.name}
          onClick={() => setZoomed((z) => !z)}
          className={
            zoomed
              ? 'max-w-none cursor-zoom-out rounded-lg'
              : 'max-h-full min-h-0 max-w-full cursor-zoom-in rounded-lg object-contain'
          }
        />
        {count > 1 && (
          <button
            type="button"
            onClick={() => onIndexChange((index + 1) % count)}
            aria-label="Próxima imagem"
            className="shrink-0 self-center rounded-full border border-white/30 p-2 text-white hover:bg-white/10"
          >
            <Icon name="chevron_right" className="text-[20px]" />
          </button>
        )}
      </div>
    </div>
  )
}
