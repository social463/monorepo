import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { canAdminister } from '@legends/shared'
import { useAuth } from '../../auth/AuthContext'
import { useDevelopmentSettings } from '../../lib/use-development-settings'

const tabCls = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-lg py-sm font-label text-label-md font-bold transition-colors ${
    isActive ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'
  }`

/**
 * Sub-navegação do módulo INOVA (Início/Projetos/Criar projeto/Recursos/Como
 * usar). Vive só dentro de `/comunidade-inova`, e o detalhe e a edição de um
 * projeto também moram aqui dentro: mesma largura das outras telas e a
 * sub-navegação à mão, como o cabeçalho fixo do INOVA original.
 */
export function InovaLayout() {
  const { user } = useAuth()
  const settings = useDevelopmentSettings()
  const podeAdministrar = user ? canAdminister(user) : false

  // Enquanto a config ainda não chegou, não redireciona — só depois que ela
  // chegar e o módulo estiver desligado (ou config indisponível).
  if (settings.isPending) return null
  if (!settings.data?.settings?.inovaModuleEnabled) return <Navigate to="/" replace />

  return (
    <div className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <nav className="flex flex-wrap gap-sm border-b border-outline-variant/40 pb-sm" aria-label="Navegação da Comunidade INOVA">
        <NavLink to="/comunidade-inova" end className={tabCls}>
          Início
        </NavLink>
        <NavLink to="/comunidade-inova/projetos" className={tabCls}>
          Projetos
        </NavLink>
        {/* Criar projeto é de qualquer colaborador — a aba não esconde mais. */}
        <NavLink to="/comunidade-inova/novo" className={tabCls}>
          Criar projeto
        </NavLink>
        <NavLink to="/comunidade-inova/recursos" className={tabCls}>
          Recursos
        </NavLink>
        <NavLink to="/comunidade-inova/guia" className={tabCls}>
          Guia
        </NavLink>
        <NavLink to="/comunidade-inova/como-usar" className={tabCls}>
          Como usar
        </NavLink>
        <NavLink to="/comunidade-inova/responsabilidades" className={tabCls}>
          Responsabilidades
        </NavLink>
        {podeAdministrar && (
          <NavLink to="/comunidade-inova/painel" className={tabCls}>
            Painel
          </NavLink>
        )}
      </nav>
      <Outlet />
    </div>
  )
}
