import { useCallback, useEffect, useState, type RefObject } from 'react'

/**
 * Tela cheia de verdade (Fullscreen API do navegador), não o overlay interno.
 *
 * A grade expandida já cobre a viewport, mas continua dentro da aba: barra de
 * endereço, abas e barra do sistema seguem na tela. Isto aqui é o que tira tudo
 * isso — o mesmo que o vídeo do YouTube faz.
 *
 * Safari só tem a versão com prefixo (`webkit*`), e o iOS não implementa
 * `requestFullscreen` em elemento nenhum (só `webkitEnterFullscreen` no
 * `<video>`). Por isso `supported` existe: onde não dá, o botão não aparece, em
 * vez de aparecer e não fazer nada.
 */

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

/** O elemento em tela cheia agora, seja qual for o prefixo. */
export function fullscreenElement(): Element | null {
  const doc = document as FullscreenDocument
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null
}

function request(el: FullscreenElement): Promise<void> | void {
  if (typeof el.requestFullscreen === 'function') return el.requestFullscreen()
  return el.webkitRequestFullscreen?.()
}

function exit(): Promise<void> | void {
  const doc = document as FullscreenDocument
  if (typeof document.exitFullscreen === 'function') return document.exitFullscreen()
  return doc.webkitExitFullscreen?.()
}

function canFullscreen(el: HTMLElement | null): boolean {
  if (!el) return false
  const candidate = el as FullscreenElement
  return typeof candidate.requestFullscreen === 'function' || typeof candidate.webkitRequestFullscreen === 'function'
}

export function useFullscreen(ref: RefObject<HTMLElement | null>): {
  isFullscreen: boolean
  supported: boolean
  toggle: () => void
} {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [supported, setSupported] = useState(false)

  // `fullscreenchange` é a única fonte de verdade do estado: quem sai pelo Esc
  // ou pelo botão do navegador não passa pelo nosso `toggle`, e sem escutar o
  // evento o ícone ficaria mentindo.
  useEffect(() => {
    const sync = () => setIsFullscreen(ref.current !== null && fullscreenElement() === ref.current)
    setSupported(canFullscreen(ref.current))
    sync()
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
    }
  }, [ref])

  const toggle = useCallback(() => {
    const el = ref.current
    if (!el) return
    // Já há OUTRO elemento em tela cheia (ex.: a página inteira, e o clique foi
    // num tile): sai dele antes de entrar neste, senão o pedido é ignorado.
    const current = fullscreenElement()
    const promise = current === el ? exit() : current ? Promise.resolve(exit()).then(() => request(el)) : request(el)
    // Sem permissão/gesto do usuário o navegador rejeita — não é erro nosso, e
    // deixar a promise solta viraria "unhandled rejection" no console.
    Promise.resolve(promise).catch(() => {})
  }, [ref])

  return { isFullscreen, supported, toggle }
}
