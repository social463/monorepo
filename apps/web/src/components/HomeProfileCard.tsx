import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  COIN_CURRENCY_LABEL,
  XP_CURRENCY_LABEL,
  XP_LEVEL_ON_COLOR,
  type AwardedBadgeDTO,
} from '@legends/shared'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import { useCoinBalance, useHasCoins } from '../lib/use-coins'
import { useXpBalance } from '../lib/use-xp'
import { Avatar } from './Avatar'
import { BadgeEmblem } from './BadgeEmblem'
import { Icon } from './Icon'

/** Quantos emblemas cabem na prévia antes do "ver todos". */
const BADGE_PREVIEW = 4

/**
 * Card de identidade da Home (coluna esquerda): quem é a pessoa, em que nível
 * está, quanto tem na carteira e os primeiros emblemas.
 *
 * A foto vem do cadastro (`Avatar` resolve photoUrl antes do personagem LPC):
 * é ela que identifica a pessoa em toda a plataforma; o personagem é do
 * Escritório Virtual.
 */
export function HomeProfileCard() {
  const { user } = useAuth()
  const hasCoins = useHasCoins()
  const xpQuery = useXpBalance(Boolean(user))
  const coinsQuery = useCoinBalance(hasCoins)
  const showCoins = hasCoins && !coinsQuery.isError
  const badgesQuery = useQuery({
    queryKey: ['badges', 'me', user?.id],
    queryFn: () => apiFetch<{ badges: AwardedBadgeDTO[] }>(`/users/${user!.id}/badges`),
    enabled: Boolean(user),
  })

  if (!user) return null

  const points = xpQuery.data?.points ?? null
  // Quem ainda não pontuou não tem nível: um "Bronze 0%" permanente não é
  // progressão, é um lembrete de que a pessoa não fez nada — e ocupa o bloco
  // mais alto do card. O bloco aparece no primeiro ponto ganho.
  const level = points !== null && points > 0 ? xpQuery.data!.level : null
  const earned = badgesQuery.data?.badges ?? []
  const preview = earned.slice(0, BADGE_PREVIEW)

  return (
    <aside
      data-testid="home-profile-card"
      className="flex flex-col gap-lg rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg"
    >
      <div className="flex flex-col items-center text-center">
        <Link
          to={`/perfil/${user.id}`}
          className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest"
        >
          <Avatar user={user} initialsClassName="font-headline text-headline-md font-bold text-primary" />
        </Link>
        <p className="mt-sm font-headline text-body-lg font-semibold leading-tight text-on-surface">{user.name}</p>
        {user.position && <p className="text-body-sm text-on-surface-variant">{user.position}</p>}
      </div>

      {/* A seção inteira some sem pontos — inclusive o título. */}
      {(level || xpQuery.isLoading) && (
      <section>
        <h3 className="mb-xs font-label text-label-sm uppercase tracking-widest text-on-surface-variant">Nível</h3>
        {level ? (
          // A cor vem do NÍVEL, não da marca: bronze é bronze, ouro é ouro, em
          // qualquer tenant (ver XP_LEVELS). Por isso vai em `style`, e não em
          // classe de token — o Tailwind aqui só conhece as cores da empresa.
          <div
            className="rounded-xl p-md"
            style={{ backgroundColor: level.color, color: XP_LEVEL_ON_COLOR }}
          >
            <div className="flex items-center gap-sm">
              <Icon name="trophy" className="text-[22px]" />
              <div className="min-w-0 flex-1">
                <p className="font-headline text-body-lg font-bold leading-tight">{level.name}</p>
                <p className="text-label-sm opacity-90">
                  {level.next
                    ? `Faltam ${level.remaining.toLocaleString('pt-BR')} pontos para ${level.next}`
                    : 'Nível máximo'}
                </p>
              </div>
            </div>
            <div className="mt-sm flex items-center gap-sm">
              {/* Barra em div, e não <progress>: o elemento nativo não aceita
                  cor arbitrária sem CSS específico de cada navegador. */}
              <div
                role="progressbar"
                aria-label={`Progresso para ${level.next ?? level.name}`}
                aria-valuenow={level.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25"
              >
                <div className="h-full rounded-full bg-white" style={{ width: `${level.progress}%` }} />
              </div>
              <span className="font-label text-label-sm font-semibold tabular-nums">{level.progress}%</span>
            </div>
          </div>
        ) : (
          <div className="h-[86px] animate-pulse rounded-xl bg-surface-container" />
        )}
      </section>
      )}

      <section>
        <h3 className="mb-xs font-label text-label-sm uppercase tracking-widest text-on-surface-variant">Carteira</h3>
        <div className={`grid gap-sm ${showCoins ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {/* Coins só aparecem para quem tem a feature: sem ela não há loja nem
              saldo, e um "0" permanente pareceria bug.
              `isError` entra junto porque a feature viaja no JWT: quem estava
              logado quando o admin desligou coins segue com ela no token por até
              15 minutos, a API recusa o saldo com 403 e o ladrilho ficava na
              tela com um travessão — exatamente o "EMR COINS —" que não deveria
              existir. */}
          {showCoins && (
            <WalletTile
              icon="paid"
              label={COIN_CURRENCY_LABEL}
              value={coinsQuery.data?.balance}
            />
          )}
          <WalletTile icon="stars" label={XP_CURRENCY_LABEL} value={xpQuery.data?.points} />
        </div>
      </section>

      <section>
        <div className="mb-xs flex items-center justify-between gap-sm">
          <h3 className="font-label text-label-sm uppercase tracking-widest text-on-surface-variant">Emblemas</h3>
          {earned.length > BADGE_PREVIEW && (
            <Link to="/engajamento" className="font-label text-label-sm text-primary hover:underline">
              Ver todos ({earned.length})
            </Link>
          )}
        </div>
        {preview.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">
            Nenhum emblema ainda — eles chegam conforme você participa.
          </p>
        ) : (
          <ul data-testid="home-badge-preview" className="flex flex-wrap gap-sm">
            {preview.map((entry) => (
              <li key={entry.id} title={entry.badge.name}>
                <BadgeEmblem badge={entry.badge} size={44} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link
        to={`/perfil/${user.id}`}
        className="group flex items-center justify-center gap-1 rounded-lg border border-outline-variant/40 py-sm font-label text-label-md text-primary"
      >
        <span className="group-hover:underline">Ver perfil completo</span>
        <Icon name="arrow_forward" className="text-[16px] transition-transform group-hover:translate-x-0.5" />
      </Link>
    </aside>
  )
}

/** Um valor da carteira. `undefined` = ainda carregando. */
function WalletTile({ icon, label, value }: { icon: string; label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border border-outline-variant/40 bg-surface-container p-sm">
      <div className="flex items-start justify-between gap-sm">
        <Icon name={icon} className="text-[20px] text-primary" />
        <span className="font-headline text-body-lg font-bold tabular-nums text-on-surface">
          {value === undefined ? '—' : value.toLocaleString('pt-BR')}
        </span>
      </div>
      <p className="mt-1 font-label text-label-sm uppercase tracking-wide text-on-surface-variant">{label}</p>
    </div>
  )
}
