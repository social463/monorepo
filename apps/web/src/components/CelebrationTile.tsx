import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { PublicUser } from '@legends/shared'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

/**
 * Pessoa celebrada numa linha: avatar + nome + setor + quando.
 * Serve aniversário de nascimento e de casa; `caption` é a linha extra opcional
 * ("3 anos de casa" no card de empresa) e `dateLabel` é o rótulo de "quando"
 * (ex.: `CelebrationDateLabel`).
 *
 * `highlighted` marca quem faz aniversário **hoje** — e é a ÚNICA linha que
 * recebe cor de marca. Com nome em versalete verde e setor em versalete em
 * todas as linhas, o card virava um bloco de maiúsculas coloridas em que nada
 * se destacava; aqui o nome é texto normal e o verde volta a significar "é
 * hoje".
 *
 * Só o setor aparece como subtítulo — a lista é da empresa toda (colegas de
 * outros times aparecem aqui, o setor é o que os diferencia). O cargo some
 * daqui de propósito (menos poluição visual); continua vindo no perfil.
 */
export function CelebrationTile({
  user,
  caption,
  dateLabel,
  highlighted = false,
}: {
  user: PublicUser
  caption?: string
  dateLabel?: ReactNode
  highlighted?: boolean
}) {
  const subtitle = user.sectorName
  return (
    <div
      className={`group/tile relative flex items-start gap-md rounded-xl px-sm py-sm transition-colors ${
        highlighted ? 'bg-primary/10' : 'hover:bg-surface-container'
      }`}
    >
      {/* O chip de quem é HOJE fica ancorado no canto superior direito, fora do
          fluxo: solto na linha do setor ele empurrava o texto e provocava a
          quebra que a linha acabou de deixar de ter. Só o "Hoje" sai do fluxo —
          "Em 12 dias · 11/08/2026" é largo demais para caber no canto sem
          espremer o nome. */}
      {highlighted && dateLabel && <div className="absolute right-sm top-sm">{dateLabel}</div>}
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-surface-container-highest ${
          highlighted ? 'border-primary/50' : 'border-outline-variant/50'
        }`}
      >
        <Avatar user={user} />
      </div>

      <div className="min-w-0 flex-1">
        {/* Espaço reservado à direita quando o chip está no canto, senão um
            nome longo passaria por baixo dele. */}
        <div className={`flex items-start gap-sm ${highlighted ? 'pr-14' : ''}`}>
          <p
            className={`min-w-0 flex-1 truncate font-label text-label-md leading-tight ${
              highlighted ? 'font-bold text-primary' : 'text-on-surface'
            }`}
          >
            {user.name}
          </p>
          {/* Ação secundária: ícone só, com o texto no title. Escrito por
              extenso em cada linha, competia com o nome da pessoa. */}
          <Link
            to={`/perfil/${user.id}`}
            title={`Deixe um feedback para ${user.name}`}
            aria-label={`Deixe um feedback para ${user.name}`}
            className="-mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-on-surface-variant opacity-0 transition-all hover:bg-surface-container-highest hover:text-primary focus:opacity-100 group-hover/tile:opacity-100"
          >
            <Icon name="favorite" className="text-[16px]" />
          </Link>
        </div>

        {/* Setor e data em linhas próprias, sem separador: "Desenvolvimento de
            Produto" não cabe ao lado de "Em 9 dias · 21/08/2026" numa coluna de
            sidebar, e um setor cortado no meio não identifica ninguém — que é
            justamente para isso que ele está aqui. */}
        {subtitle && <p className="mt-0.5 text-body-sm text-on-surface-variant">{subtitle}</p>}
        {!highlighted && dateLabel && (
          <p className="mt-0.5 text-body-sm text-on-surface-variant">{dateLabel}</p>
        )}
        {caption && <p className="mt-0.5 font-label text-label-sm text-on-surface-variant">{caption}</p>}
      </div>
    </div>
  )
}
