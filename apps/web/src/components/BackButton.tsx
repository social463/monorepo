import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './Icon'

interface BackButtonProps {
  /** Para onde ir quando a tela foi aberta direto pela URL (sem histórico interno). */
  fallback?: string
  className?: string
}

/**
 * Seta de voltar, usada **ao lado do título** das telas em que se entra a partir
 * de outra (não têm item no menu lateral) — ex.: Mural corporativo, Editar
 * personagem, Sprint de retrospectiva.
 *
 * Volta no histórico; se a aba abriu direto nessa URL (`location.key` = 'default',
 * ou seja, primeira entrada do histórico), navega para o `fallback` para não
 * jogar o usuário para fora do app.
 */
export function BackButton({ fallback = '/', className }: BackButtonProps) {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <button
      type="button"
      aria-label="Voltar"
      title="Voltar"
      onClick={() => (location.key === 'default' ? navigate(fallback) : navigate(-1))}
      className={`office-toolbar-btn flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-transparent text-on-surface-variant transition-all hover:border-primary-container/30 hover:bg-primary-container/10 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 ${className ?? ''}`}
    >
      <Icon name="arrow_back" className="text-[22px]" />
    </button>
  )
}
