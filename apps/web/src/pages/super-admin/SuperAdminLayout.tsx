import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { Icon } from '../../components/Icon'

interface SuperAdminNavItem {
  to: string
  label: string
  icon: string
  end?: boolean
}

const NAV_ITEMS: SuperAdminNavItem[] = [
  { to: '/super-admin', label: 'Empresas', icon: 'apartment', end: true },
  { to: '/super-admin/adocao', label: 'Adoção', icon: 'monitoring' },
]

/**
 * Shell do console do super admin. Espelha a estrutura do `AppLayout` (sidebar
 * fixa + header grudento + coluna de conteúdo) para o console não parecer outro
 * produto, mas é um componente à parte de propósito: o `AppLayout` carrega
 * período de votação, ofensiva, coins, notificações e sessão de escritório —
 * tudo recurso de tenant, que o super admin da empresa interna não tem.
 */
export function SuperAdminLayout() {
  const { user, logout } = useAuth()
  const initial = user?.name?.trim()?.charAt(0)?.toUpperCase() ?? '—'

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <aside className="fixed left-0 top-0 z-50 hidden h-screen w-64 flex-col border-r border-outline-variant/40 bg-surface-container-lowest py-xl md:flex">
        {/* Logo do PRODUTO, cravada de propósito — e não `BrandLogo`. Este é o
            console da equipe interna, que administra todas as empresas; vestir
            ele com a marca de um tenant seria mentira de tela. */}
        <div className="mb-xl flex items-center justify-center px-md">
          <Link to="/super-admin" aria-label="Ir para as empresas">
            <img src="/illustration/horizontal_logo.png" alt="Legends" className="h-14 w-auto object-contain" />
          </Link>
        </div>

        <p className="mb-md px-lg font-label text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface-variant">
          Console interno
        </p>

        <nav aria-label="Navegação do super admin" className="flex flex-1 flex-col gap-1 px-sm">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  'flex items-center gap-md rounded-md px-md py-sm font-label text-label-lg transition-colors',
                  isActive
                    ? 'border-r-2 border-primary bg-primary/10 font-bold text-primary'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={item.icon} filled={isActive} className="text-[24px]" />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-outline-variant/40 px-md pt-md">
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-md rounded-md px-md py-sm text-body-sm text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          >
            <Icon name="logout" className="text-[20px]" />
            Sair
          </button>
        </div>
      </aside>

      <div className="ml-0 flex min-h-screen flex-col md:ml-64">
        <header className="sticky top-0 z-40 flex items-center justify-between gap-sm border-b border-outline-variant/40 bg-surface-container/80 px-md py-md backdrop-blur-md md:px-xl">
          <div className="flex min-w-0 items-center gap-sm">
            <Link to="/super-admin" aria-label="Ir para as empresas" className="md:hidden">
              <img src="/illustration/l.png" alt="Legends" className="h-9 w-auto shrink-0 object-contain" />
            </Link>
            <p className="truncate font-headline text-headline-md text-primary">Console do super admin</p>
          </div>

          <div className="flex items-center gap-md">
            <div className="hidden leading-tight text-right md:block">
              <p className="font-label text-label-md text-on-surface">{user?.name}</p>
              <p className="text-[11px] text-on-surface-variant">Super admin</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-primary/30 bg-surface-container-highest font-label text-label-md font-bold text-primary">
              {initial}
            </div>
            {/* No mobile a sidebar não aparece; o logout precisa de um caminho aqui. */}
            <button
              type="button"
              onClick={logout}
              aria-label="Sair"
              className="rounded-md border border-outline-variant/60 p-2 text-on-surface-variant transition-colors hover:border-primary hover:text-primary md:hidden"
            >
              <Icon name="logout" className="text-[20px]" />
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-page p-lg md:p-xl">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
