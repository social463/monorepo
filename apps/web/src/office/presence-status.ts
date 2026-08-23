import type { OfficeUserStatus } from '@legends/shared'

export const presenceStatuses: OfficeUserStatus[] = ['online', 'away', 'brb']

export const presenceStatusLabel: Record<OfficeUserStatus, string> = {
  online: 'Online',
  away: 'Ausente',
  brb: 'Volto logo',
}

/** Mesma cor em qualquer lugar que mostre a bolinha de presença (MediaBar, badge sobre o personagem, lista de pessoas). */
export const presenceStatusDotCls: Record<OfficeUserStatus, string> = {
  online: 'bg-green-500',
  away: 'bg-yellow-400',
  brb: 'bg-blue-500',
}

/** Cor do texto do status, acompanhando a cor da bolinha. */
export const presenceStatusTextCls: Record<OfficeUserStatus, string> = {
  online: 'text-primary',
  away: 'text-yellow-400',
  brb: 'text-blue-400',
}
