import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { OfficeOccupant, OfficeUserStatus, PublicUser } from '@legends/shared'
import { apiFetch } from '../lib/api'
import { Icon } from '../components/Icon'
import { Avatar, type AvatarSource } from '../components/Avatar'
import { presenceStatusDotCls, presenceStatusLabel, presenceStatusTextCls } from './presence-status'

export interface PeopleListProps {
  occupants: OfficeOccupant[]
  youId: string | null
  searchTerm?: string
  onCall: (userId: string) => void
  onFollow: (userId: string) => void
  onViewProfile: (userId: string) => void
  /** Quem manda na sala em que VOCÊ está — ganha o selo na lista. */
  roomManagerId?: string | null
  /** Quem está na mesma sala que você agora: só esses podem ser removidos. */
  removableUserIds?: readonly string[]
  /** Ausente quando você não modera a sala: a ação nem aparece. */
  onRemoveFromRoom?: (userId: string) => void
}

export type PersonAction = 'call' | 'follow' | 'view-profile' | 'remove-from-room'

/**
 * Ações disponíveis no menu de uma pessoa. Chamar/seguir só fazem sentido para
 * OUTRA pessoa PRESENTE; a sua própria linha e qualquer offline só têm perfil.
 *
 * `canRemove` só chega true para quem modera a sala e para alguém que está
 * nela — por isso a remoção entra depois das demais, e nunca na própria linha.
 */
export function menuActionsFor(args: {
  isSelf: boolean
  isOnline: boolean
  isGuest?: boolean
  canRemove?: boolean
}): PersonAction[] {
  const remove: PersonAction[] = args.canRemove && !args.isSelf ? ['remove-from-room'] : []
  if (args.isGuest) return args.isSelf ? [] : ['call', 'follow', ...remove]
  if (args.isSelf) return ['view-profile']
  if (args.isOnline) return ['call', 'follow', 'view-profile', ...remove]
  return ['view-profile']
}

const ACTION_LABEL: Record<PersonAction, string> = {
  call: 'Chamar',
  follow: 'Seguir',
  'view-profile': 'Ver perfil',
  'remove-from-room': 'Remover da reunião',
}
const ACTION_ICON: Record<PersonAction, string> = {
  call: 'call',
  follow: 'directions_walk',
  'view-profile': 'account_circle',
  'remove-from-room': 'person_remove',
}

/**
 * Ordem das duas listas: alfabética por nome.
 *
 * Os online vinham na ordem em que o servidor devolve os ocupantes — ordem de
 * entrada no mapa, que muda a cada reconexão de qualquer pessoa. Procurar
 * alguém numa lista de 23 nomes que se reembaralha sozinha não funciona.
 *
 * `Intl.Collator('pt-BR')` e não `localeCompare` cru: é a comparação que põe
 * "Érika" entre "Emerson" e "Fábio" em vez de depois de "Z", e criar o
 * comparador uma vez fora do componente evita refazê-lo a cada render.
 */
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' })
const byName = (a: Person, b: Person): number => collator.compare(a.name, b.name)

interface Person extends AvatarSource {
  userId: string
  isSelf: boolean
  isOnline: boolean
  isGuest?: boolean
  /** Só faz sentido para quem está no escritório (`isOnline`) — offline não tem status. */
  status?: OfficeUserStatus
}

export function PeopleList({
  occupants,
  youId,
  searchTerm = '',
  onCall,
  onFollow,
  onViewProfile,
  roomManagerId = null,
  removableUserIds,
  onRemoveFromRoom,
}: PeopleListProps) {
  const [openMenuUserId, setOpenMenuUserId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState({ online: true, offline: false })

  const { data } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<{ users: PublicUser[] }>('/users'),
    staleTime: 60_000,
  })

  const normalizedSearch = searchTerm.trim().toLocaleLowerCase('pt-BR')
  const matchesSearch = (person: Person) =>
    !normalizedSearch || person.name.toLocaleLowerCase('pt-BR').includes(normalizedSearch)

  const onlineIds = new Set(occupants.map((o) => o.userId))
  const onlinePeople: Person[] = occupants.map((o) => ({
    userId: o.userId,
    name: o.name,
    photoUrl: o.photoUrl,
    avatarStyle: o.avatarStyle,
    avatarSeed: o.avatarSeed,
    avatarOptions: o.avatarOptions,
    isSelf: o.userId === youId,
    isOnline: true,
    isGuest: o.isGuest,
    status: o.status ?? 'online',
  }))
  const offlinePeople: Person[] = (data?.users ?? [])
    .filter((u) => !onlineIds.has(u.id) && u.id !== youId)
    .map((u) => ({
      userId: u.id,
      name: u.name,
      photoUrl: u.photoUrl,
      avatarStyle: u.avatarStyle,
      avatarSeed: u.avatarSeed,
      avatarOptions: u.avatarOptions,
      isSelf: false,
      isOnline: false,
    }))
  const online = onlinePeople.filter(matchesSearch).sort(byName)
  const offline = offlinePeople.filter(matchesSearch).sort(byName)

  // Um menu por vez: fecha em Esc e em clique fora de qualquer raiz de menu.
  useEffect(() => {
    if (!openMenuUserId) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-people-menu-root]')) setOpenMenuUserId(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuUserId(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenuUserId])

  // Se a pessoa com menu aberto sumir do mapa (e não estiver offline), fecha.
  useEffect(() => {
    if (!openMenuUserId) return
    const stillThere = online.some((p) => p.userId === openMenuUserId) || offline.some((p) => p.userId === openMenuUserId)
    if (!stillThere) setOpenMenuUserId(null)
  }, [online, offline, openMenuUserId])

  const removable = new Set(removableUserIds ?? [])

  const runAction = (action: PersonAction, userId: string) => {
    if (action === 'call') onCall(userId)
    else if (action === 'follow') onFollow(userId)
    else if (action === 'remove-from-room') onRemoveFromRoom?.(userId)
    else onViewProfile(userId)
    setOpenMenuUserId(null)
  }

  const renderRow = (person: Person) => {
    const actions = menuActionsFor({
      isSelf: person.isSelf,
      isOnline: person.isOnline,
      isGuest: person.isGuest,
      canRemove: !!onRemoveFromRoom && removable.has(person.userId),
    })
    const menuOpen = openMenuUserId === person.userId
    return (
      <li key={person.userId} className="flex items-center gap-sm">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#9bd7ed] font-label text-label-lg text-[#24505f]">
          <div className="h-full w-full overflow-hidden rounded-full">
            <Avatar preferCharacter user={person} initialsClassName="font-label text-label-lg text-[#24505f]" />
          </div>
          <span
            aria-hidden
            className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-surface-container ${
              person.isOnline ? presenceStatusDotCls[person.status ?? 'online'] : 'bg-on-surface-variant/50'
            }`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-label text-label-md text-on-surface">
            {person.name}
            {person.isSelf ? ' (você)' : ''}
            {person.isGuest ? ' (Convidado)' : ''}
            {person.userId === roomManagerId && (
              <span
                title="Responsável pela sala"
                aria-label="Responsável pela sala"
                className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary align-middle font-label text-[10px] leading-none text-on-primary"
              >
                M
              </span>
            )}
          </p>
          <p
            className={`font-body text-body-sm ${
              person.isOnline ? presenceStatusTextCls[person.status ?? 'online'] : 'text-on-surface-variant'
            }`}
          >
            {person.isOnline ? presenceStatusLabel[person.status ?? 'online'] : 'Offline'}
          </p>
        </div>

        {actions.length > 0 && <div className="relative shrink-0" data-people-menu-root>
          <button
            type="button"
            aria-label={`Ações para ${person.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setOpenMenuUserId(menuOpen ? null : person.userId)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
          >
            <Icon name="more_vert" className="text-[20px]" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-10 mt-1 w-40 overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-container shadow-lg"
            >
              {actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  role="menuitem"
                  onClick={() => runAction(action, person.userId)}
                  className="flex w-full items-center gap-sm px-md py-sm text-left font-label text-label-md text-on-surface transition-colors hover:bg-surface-container-highest"
                >
                  <Icon name={ACTION_ICON[action]} className="text-[18px]" />
                  {ACTION_LABEL[action]}
                </button>
              ))}
            </div>
          )}
        </div>}
      </li>
    )
  }

  const section = (
    key: 'online' | 'offline',
    label: string,
    people: Person[],
    emptyText: string,
  ) => {
    const isExpanded = Boolean(normalizedSearch) || expanded[key]
    return (
      <div className="mb-md">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
          className="mb-sm flex w-full items-center gap-xs font-label text-label-sm text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <Icon name={isExpanded ? 'expand_more' : 'chevron_right'} className="text-[18px]" />
          <span>
            {label} ({people.length})
          </span>
        </button>
        {isExpanded &&
          (people.length === 0 ? (
            <p className="px-sm py-xs font-body text-body-sm text-on-surface-variant">{emptyText}</p>
          ) : (
            <ul className="flex flex-col gap-sm">{people.map(renderRow)}</ul>
          ))}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-lg py-md">
      {section('online', 'Online', online, normalizedSearch ? 'Nenhuma pessoa online encontrada' : 'Ninguém online')}
      {section('offline', 'Offline', offline, normalizedSearch ? 'Nenhuma pessoa offline encontrada' : 'Ninguém offline')}
    </div>
  )
}
