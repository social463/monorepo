import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { getDevelopmentSettings } from './pdi-api'

/**
 * Configuração da aba Desenvolvimento (exigência de validação do líder e URL do
 * ImpulseUP). O menu depende dela para decidir se mostra o item externo de
 * Avaliações e Pesquisas — por isso fica em cache longo.
 */
export function useDevelopmentSettings() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['development', 'settings'],
    queryFn: getDevelopmentSettings,
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  })
}
