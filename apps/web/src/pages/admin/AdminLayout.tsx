import { Outlet } from 'react-router-dom'

export function AdminLayout() {
  // Mesma caixa de conteúdo do resto do app: a navegação do console mora na
  // segunda linha do header (ver `AppLayout`), não numa sidebar própria.
  return (
    <div className="mx-auto max-w-page p-lg md:p-xl">
      <Outlet />
    </div>
  )
}
