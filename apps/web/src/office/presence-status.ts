import type { OfficeUserStatus } from '@legends/shared'

export const presenceStatuses: OfficeUserStatus[] = ['online', 'away', 'brb', 'busy']

export const presenceStatusLabel: Record<OfficeUserStatus, string> = {
  online: 'Online',
  away: 'Ausente',
  brb: 'Volto logo',
  busy: 'Ocupado',
}

/** Mesma cor em qualquer lugar que mostre a bolinha de presença (MediaBar, badge sobre o personagem, lista de pessoas). */
export const presenceStatusDotCls: Record<OfficeUserStatus, string> = {
  online: 'bg-green-500',
  away: 'bg-yellow-400',
  brb: 'bg-blue-500',
  busy: 'bg-red-500',
}

/** Cor do texto do status, acompanhando a cor da bolinha. */
export const presenceStatusTextCls: Record<OfficeUserStatus, string> = {
  online: 'text-primary',
  away: 'text-yellow-400',
  brb: 'text-blue-400',
  busy: 'text-red-400',
}

/**
 * O que a escolha faz, além de pintar a bolinha. Só "Ocupado" tem efeito real
 * — e é forte o bastante para merecer aviso antes de a pessoa escolher.
 */
export const presenceStatusHint: Partial<Record<OfficeUserStatus, string>> = {
  busy: 'Você não ouve ninguém e ninguém ouve você',
}
