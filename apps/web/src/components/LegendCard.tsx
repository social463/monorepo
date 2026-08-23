import { Link } from 'react-router-dom'
import { XP_CURRENCY_LABEL, XP_LEVEL_ON_COLOR, type ShowcaseEntry } from '@legends/shared'
import { Icon } from './Icon'
import { BadgeEmblem } from './BadgeEmblem'
import { Avatar } from './Avatar'

function formerSinceLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
}

const CARD_CLASS =
  'group flex flex-col items-center rounded-xl border border-outline-variant/30 bg-surface-container p-lg text-center transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10'
const COMPACT_CARD_CLASS =
  'group flex flex-col items-center rounded-lg border border-outline-variant/30 bg-surface-container p-md text-center transition-all hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10'

/**
 * Card de uma lenda (avatar, cargo, selos, feedbacks). Reusado na galeria
 * (/lendas) e no overlay do escritório.
 *
 * `linkTo`: string ⇒ o card inteiro navega para lá; `null` ⇒ não é link (o
 * overlay do escritório tem os próprios botões); ausente ⇒ perfil da pessoa.
 */
export function LegendCard({
  entry,
  linkTo,
  compact = false,
}: {
  entry: ShowcaseEntry
  linkTo?: string | null
  compact?: boolean
}) {
  const { user, feedbacksReceived, badges } = entry
  const topBadges = badges.slice(0, 3)
  // Sem ponto nenhum não há degrau alcançado: marcar "Bronze" aqui anunciaria
  // uma conquista que não houve. Mesma regra do card de perfil da Home.
  const level = entry.xp && entry.xp.points > 0 ? entry.xp.level : null
  const href = linkTo === undefined ? `/perfil/${user.id}?from=lendas` : linkTo
  const cardClass = compact ? COMPACT_CARD_CLASS : CARD_CLASS

  const inner = (
    <>
      <div className={compact ? 'relative mb-sm' : 'relative mb-md'}>
        <div className="absolute inset-0 rounded-full bg-primary/20 blur-md transition-opacity group-hover:opacity-100" />
        <div className={`relative z-10 flex items-center justify-center overflow-hidden rounded-full border-2 border-primary bg-surface-container-highest ${compact ? 'h-16 w-16' : 'h-24 w-24'}`}>
          <Avatar
            user={user}
            initialsClassName={`font-headline font-bold text-primary ${compact ? 'text-title-lg' : 'text-headline-md'}`}
          />
        </div>
      </div>

      <h3 className={`font-headline text-on-surface ${compact ? 'text-title-lg' : 'text-headline-md'}`}>{user.name}</h3>
      <span className={`mt-xs rounded-full bg-primary/10 font-label text-primary ${compact ? 'px-sm py-0.5 text-[11px]' : 'px-md py-xs text-label-sm'}`}>
        {user.position ?? 'Desenvolvimento de Produto'}
      </span>
      {user.sectorName && (
        <span className="mt-xs font-label text-label-sm text-on-surface-variant">{user.sectorName}</span>
      )}

      {level && (
        // A cor é a do METAL, não a da marca (ver XP_LEVELS): bronze é bronze em
        // qualquer tenant, por isso vai em `style` e não em classe de token.
        <span
          className={`mt-xs inline-flex items-center gap-xs rounded-full font-label font-bold ${compact ? 'px-sm py-0.5 text-[11px]' : 'px-md py-xs text-label-sm'}`}
          style={{ backgroundColor: level.color, color: XP_LEVEL_ON_COLOR }}
          title={`${entry.xp.points.toLocaleString('pt-BR')} ${XP_CURRENCY_LABEL.toLowerCase()}`}
        >
          <Icon name="workspace_premium" className={compact ? 'text-[13px]' : 'text-[15px]'} />
          {level.name}
        </span>
      )}

      {user.leftAt && (
        <span className="mt-xs inline-flex items-center gap-xs rounded-full bg-surface-container-highest px-md py-xs font-label text-label-sm text-on-surface-variant">
          <Icon name="workspace_premium" className="text-[14px]" />
          saiu em {formerSinceLabel(user.leftAt)}
        </span>
      )}

      <div className={`${compact ? 'my-sm' : 'my-md'} w-full border-t border-outline-variant/20`} />

      <div className={`${compact ? 'mb-sm' : 'mb-md'} w-full`}>
        <p className={`${compact ? 'mb-xs text-[10px]' : 'mb-sm text-label-sm'} font-label uppercase tracking-wide text-on-surface-variant`}>
          Principais conquistas
        </p>
        {topBadges.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">Sem selos ainda.</p>
        ) : (
          <div className={`flex justify-center ${compact ? 'gap-xs' : 'gap-sm'}`}>
            {topBadges.map((awarded) => (
              <div key={awarded.id} className="transition-transform group-hover:scale-105">
                <BadgeEmblem badge={awarded.badge} size={compact ? 32 : 40} />
              </div>
            ))}
            {badges.length > 3 && (
              <div className={`flex items-center justify-center rounded-full bg-surface-container-highest font-label text-label-sm text-on-surface-variant ${compact ? 'h-8 w-8' : 'h-10 w-10'}`}>
                +{badges.length - 3}
              </div>
            )}
          </div>
        )}
      </div>

      {feedbacksReceived > 0 && (
        <div className="flex items-center gap-xs text-on-surface-variant">
          <Icon name="verified" className="text-[18px]" />
          <span className="text-body-sm">
            {feedbacksReceived} {feedbacksReceived === 1 ? 'feedback' : 'feedbacks'}
          </span>
        </div>
      )}
    </>
  )

  if (href === null) {
    return <div className={cardClass}>{inner}</div>
  }
  return (
    <Link to={href} className={cardClass}>
      {inner}
    </Link>
  )
}
