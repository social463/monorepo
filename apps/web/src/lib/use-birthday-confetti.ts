import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useCelebrations } from './use-celebrations'

function storageKey(viewerId: string, targetId: string, referenceDay: string): string {
  return `legends:confetti-shown:${viewerId}:${targetId}:${referenceDay}`
}

/** `false` em caso de erro (storage bloqueado/privado): melhor comemorar de novo do que nunca comemorar. */
function alreadyShownToday(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function markShownToday(key: string): void {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // Modo privado ou storage bloqueado: sem persistência, mas não derruba a Home.
  }
}

/**
 * Confete no aniversário de nascimento de `targetUserId` (padrão: o próprio
 * usuário logado — uso da Home). Retorna um token (não-nulo quando deve
 * comemorar) que muda a cada alvo/dia — troque de perfil e ele muda de novo,
 * mesmo que o anterior já tivesse comemorado.
 *
 * `once` (padrão `true`) limita a Home a uma comemoração por dia civil
 * (America/Sao_Paulo, mesma referência do resto de `/celebrations`), guardada
 * por par visitante/alvo no localStorage. Perfil (`once: false`) comemora
 * de novo toda vez que a pessoa abre o perfil de quem faz aniversário hoje —
 * é uma ação deliberada da pessoa, não um efeito ambiente da Home.
 * Não dispara para aniversário de empresa — decisão explícita do produto.
 */
export function useBirthdayConfetti(targetUserId?: string, options?: { once?: boolean }): string | null {
  const once = options?.once ?? true
  const { user } = useAuth()
  const { birthdays, referenceDay } = useCelebrations()
  const [trigger, setTrigger] = useState<string | null>(null)
  const target = targetUserId ?? user?.id

  useEffect(() => {
    if (!user || !referenceDay || !target) return
    const isTargetBirthdayToday = birthdays.upcoming.some((b) => b.daysUntil === 0 && b.user.id === target)
    if (!isTargetBirthdayToday) return

    if (once) {
      const key = storageKey(user.id, target, referenceDay)
      if (alreadyShownToday(key)) return
      markShownToday(key)
    }

    setTrigger(`${target}:${referenceDay}`)
  }, [user, referenceDay, target, birthdays.upcoming, once])

  return trigger
}
