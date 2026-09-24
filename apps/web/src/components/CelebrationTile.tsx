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
  celebrating = false,
  canCongratulate = false,
}: {
  user: PublicUser
  caption?: string
  dateLabel?: ReactNode
  highlighted?: boolean
  /** É HOJE: rende bolo e balões animados ao lado do nome. */
  celebrating?: boolean
  /** Falso, o botão de parabéns não aparece — quem decide é o card. */
  canCongratulate?: boolean
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
      {celebrating && (
        // Decoração pura, ancorada no canto inferior direito — onde a linha
        // tem espaço livre. Dentro do nome (que trunca) ela era cortada por
        // nomes longos; o chip "Hoje" já diz, em texto, o que o bolo comemora.
        <span
          aria-hidden="true"
          className="absolute bottom-sm right-sm inline-flex items-baseline gap-0.5"
        >
          <span className="inline-block animate-bounce">🎂</span>
          <span className="inline-block animate-bounce [animation-delay:150ms]">🎈</span>
        </span>
      )}
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
          {/* Ação única da linha: ícone só, com o texto no title. Escrito por
              extenso em cada linha, competia com o nome da pessoa. O coração
              (deixar feedback) saiu daqui: duas ações lado a lado numa lista de
              aniversário faziam escolher entre parabenizar e elogiar, quando a
              data só pede a primeira — o feedback continua a um clique, no
              perfil para onde este botão leva.

              É um link, e não um diálogo: parabenizar agora é assinar o mural
              de aniversário, que vive no perfil da pessoa (spec
              2026-08-31-mural-de-aniversarios). `?parabens=1` faz o perfil rolar
              até o mural e focar o campo. Como é a única ação, fica sempre
              visível — escondê-la no hover deixava a linha sem nada para fazer
              no toque. */}
          {canCongratulate && (
            <Link
              to={`/perfil/${user.id}?parabens=1`}
              title={`Dê os parabéns a ${user.name}`}
              aria-label={`Dê os parabéns a ${user.name}`}
              className={`-mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-container-highest hover:text-primary ${
                celebrating ? 'text-primary' : 'text-on-surface-variant'
              }`}
            >
              <Icon name="celebration" className="text-[16px]" />
            </Link>
          )}
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
