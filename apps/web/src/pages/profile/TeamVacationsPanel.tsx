import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PublicUser, TeamMemberVacationsDTO, VacationDTO } from '@legends/shared'
import { ApiError } from '../../lib/api'
import { deleteVacation, fetchTeamVacations } from '../../lib/vacations-api'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { VacationDialog } from '../../components/VacationDialog'

function formatDay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd
}

/**
 * Painel do gestor para cadastrar as férias do time — irmão do
 * `SquadMoodPanel`, mesmo público (quem tem liderado direto, pelo `managerId`
 * do organograma) e mesmo lugar: os dois vivem na página de Liderança, não no
 * perfil.
 *
 * É aqui que se lança, edita e remove um período. O recorte de quem pode mexer
 * em quem é do backend (`listTeamVacations` só devolve os liderados).
 */
export function TeamVacationsPanel() {
  const teamQuery = useQuery({ queryKey: ['team-vacations'], queryFn: fetchTeamVacations })
  const [dialog, setDialog] = useState<{ user: PublicUser; vacation: VacationDTO | null } | null>(null)
  const groups = teamQuery.data?.groups ?? []

  // Não lidera nenhum grupo (ou ainda carregando) → não ocupa espaço.
  if (groups.length === 0) return null

  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
      <h3 className="mb-lg font-headline text-headline-md text-on-surface">Férias do time</h3>
      <div className="flex flex-col gap-lg">
        {groups.map((group) => (
          <div key={group.groupId}>
            {/* Grupo único ("Meu time") repetiria o título do painel logo acima. */}
            {groups.length > 1 && (
              <h4 className="mb-sm font-label text-label-md uppercase tracking-wide text-on-surface-variant">
                {group.groupName}
              </h4>
            )}
            {group.members.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant">Sem integrantes.</p>
            ) : (
              <ul className="flex flex-col gap-sm">
                {group.members.map((member) => (
                  <MemberRow
                    key={member.user.id}
                    member={member}
                    onLaunch={() => setDialog({ user: member.user, vacation: null })}
                    onEdit={(vacation) => setDialog({ user: member.user, vacation })}
                  />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {dialog && (
        <VacationDialog user={dialog.user} vacation={dialog.vacation} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

function MemberRow({
  member,
  onLaunch,
  onEdit,
}: {
  member: TeamMemberVacationsDTO
  onLaunch: () => void
  onEdit: (vacation: VacationDTO) => void
}) {
  const queryClient = useQueryClient()
  const [removeError, setRemoveError] = useState<string | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => deleteVacation(id),
    onSuccess: () => {
      setRemoveError(null)
      void queryClient.invalidateQueries({ queryKey: ['team-vacations'] })
      void queryClient.invalidateQueries({ queryKey: ['vacations'] })
    },
    onError: (err) => {
      // Sem isso, o botão só volta a ficar habilitado e o gestor conclui que
      // removeu — o período continua lá.
      setRemoveError(err instanceof ApiError ? err.message : 'Erro ao remover as férias.')
    },
  })

  return (
    <li className="rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
      <div className="flex items-center gap-md">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-container/20">
          <Avatar user={member.user} />
        </span>
        <span className="flex-grow font-label text-label-md text-on-surface">{member.user.name}</span>
        <button
          type="button"
          aria-label={`Lançar férias para ${member.user.name}`}
          onClick={onLaunch}
          className="rounded-md px-sm py-xs font-label text-label-sm text-primary hover:bg-surface-container-high"
        >
          Lançar férias
        </button>
      </div>

      {member.vacations.length > 0 && (
        <ul className="mt-sm flex flex-col gap-xs border-t border-outline-variant/10 pt-sm">
          {member.vacations.map((vacation) => (
            <li key={vacation.id} className="flex items-center justify-between gap-sm">
              <span className="font-body text-body-sm text-on-surface-variant">
                {formatDay(vacation.startDate)} – {formatDay(vacation.endDate)}
              </span>
              <span className="flex shrink-0 items-center gap-xs">
                <button
                  type="button"
                  aria-label={`Editar férias de ${member.user.name} de ${formatDay(vacation.startDate)} a ${formatDay(vacation.endDate)}`}
                  onClick={() => onEdit(vacation)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
                >
                  <Icon name="edit" className="text-[16px]" />
                </button>
                <button
                  type="button"
                  aria-label={`Remover férias de ${member.user.name} de ${formatDay(vacation.startDate)} a ${formatDay(vacation.endDate)}`}
                  onClick={() => remove.mutate(vacation.id)}
                  disabled={remove.isPending}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-error disabled:opacity-45"
                >
                  <Icon name="delete" className="text-[16px]" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {removeError && (
        <p role="alert" className="mt-xs text-body-sm text-error">
          {removeError}
        </p>
      )}
    </li>
  )
}
