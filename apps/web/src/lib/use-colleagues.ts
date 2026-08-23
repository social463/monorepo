import { useQuery } from '@tanstack/react-query'
import type { PublicUser } from '@legends/shared'
import { apiFetch } from './api'

/**
 * Colegas mencionáveis: ativos e não-admin (admins não têm perfil navegável).
 * `scope: 'company'` traz a empresa inteira — usado pelo mural corporativo, que
 * não é setorizado. O padrão continua sendo o setor do usuário.
 */
export function useColleagues(scope: 'sector' | 'company' = 'sector') {
  return useQuery({
    queryKey: ['colleagues', scope],
    queryFn: async () => {
      const { users } = await apiFetch<{ users: PublicUser[] }>(
        scope === 'company' ? '/users?scope=company' : '/users',
      )
      return users.filter((u) => u.active && u.role !== 'ADMIN')
    },
    staleTime: 5 * 60_000,
  })
}
