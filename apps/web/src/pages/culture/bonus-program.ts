import { useQuery } from '@tanstack/react-query'
import type { BonusProgramSettings } from '@legends/shared'
import { apiFetch } from '../../lib/api'

/**
 * Id do manual que abre a calculadora do Todos Pelos 9, escolhido pela G&G em
 * Administração › Todos Pelos 9. É id, e não slug fixo: o manual é cadastrado
 * em produção, e casar por título quebraria numa renomeação.
 *
 * A calculadora saiu do menu lateral, então este é o caminho de entrada dela:
 * o botão no card da lista de Manuais e o atalho dentro do próprio manual — os
 * dois perguntam a mesma coisa, daí o hook. `null` significa que ninguém
 * vinculou um manual, e aí a tela fica só pela URL (é o que o próprio select
 * do admin avisa).
 */
export function useBonusCalculatorManualId(): string | null {
  const { data } = useQuery({
    queryKey: ['bonus-program'],
    queryFn: () => apiFetch<{ settings: BonusProgramSettings }>('/bonus-program'),
  })
  return data?.settings?.manualId ?? null
}
