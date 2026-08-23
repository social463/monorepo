import { useEffect, useState } from 'react'
import { Icon } from './Icon'

/** Só aparece depois de rolar bem — em página curta o botão seria ruído. */
const LIMIAR_PX = 600

/**
 * Botão flutuante de voltar ao topo, para telas de leitura longa (manual,
 * benefício). A página rola na janela — o `<main>` do AppLayout não tem
 * container de scroll próprio —, então basta observar `window.scrollY`.
 */
export function ScrollToTopButton() {
  const [visivel, setVisivel] = useState(false)

  useEffect(() => {
    function onScroll() {
      setVisivel(window.scrollY > LIMIAR_PX)
    }
    onScroll() // já entra visível se a rota abriu com a página rolada
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!visivel) return null

  function subir() {
    // Respeita quem pediu menos animação no sistema.
    const reduzido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduzido ? 'auto' : 'smooth' })
  }

  return (
    <button
      type="button"
      onClick={subir}
      aria-label="Voltar ao topo"
      title="Voltar ao topo"
      className="fixed bottom-6 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg transition-colors hover:bg-primary-container hover:text-on-primary-container focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      <Icon name="arrow_upward" className="text-[22px]" />
    </button>
  )
}
