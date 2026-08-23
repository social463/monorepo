import { Link } from 'react-router-dom'
import { RANKING_TOP_LIMIT, type RankingEntryDTO } from '@legends/shared'
import { useRanking } from '../lib/use-ranking'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { OnlineDot } from './OnlineDot'

/**
 * Bloco "Top 5 engajamento" da coluna direita da Home.
 *
 * Cada linha responde às três perguntas que a regra do bloco pede: **posição**
 * (medalha nos três primeiros, número depois), **setor** (é o que distingue
 * colegas de times diferentes numa lista da empresa inteira) e **status de
 * presença** (bolinha verde/cinza), mais a pontuação à direita.
 *
 * Some inteiro enquanto carrega ou se a chamada falhar, como os demais cards da
 * sidebar: é conteúdo acessório, e um esqueleto permanente na Home chama mais
 * atenção para o erro do que o conteúdo teria.
 *
 * `limit` existe porque a lista não tem o mesmo tamanho em toda tela: na Home
 * ela divide a coluna com aniversários, férias e datas do time (daí os 5), e no
 * Feed Corporativo ela é o único bloco abaixo de "Como ganhar pontos" — a
 * coluna sobraria vazia com cinco linhas.
 */
export function TopEngagementCard({ limit = RANKING_TOP_LIMIT }: { limit?: number } = {}) {
  const { data, isLoading, isError } = useRanking(limit)
  if (isLoading || isError) return null

  const entries = data?.entries ?? []
  const me = data?.me ?? null

  return (
    <aside
      data-testid="top-engagement-card"
      className="flex flex-col gap-md rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg"
    >
      <h2 className="flex items-center gap-sm font-headline text-body-lg font-semibold text-on-surface">
        <Icon name="trophy" className="text-[20px] text-primary" />
        Top {limit} engajamento
      </h2>

      {entries.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          Ninguém pontuou ainda. Vote, deixe um feedback ou registre seu humor para abrir o placar.
        </p>
      ) : (
        <ul className="flex flex-col gap-xs">
          {entries.map((entry) => (
            <li key={entry.user.id}>
              <TopEngagementRow entry={entry} />
            </li>
          ))}
        </ul>
      )}

      {/* A própria posição só aparece para quem está fora do pódio mostrado —
          para quem já está na lista seria repetir a linha logo acima. */}
      {me && me.position > entries.length && (
        <p className="rounded-xl bg-surface-container px-md py-sm text-body-sm text-on-surface-variant">
          Você está em <span className="font-label font-bold text-on-surface">{me.position}º</span> com{' '}
          <span className="font-label font-bold text-on-surface">{me.points}</span> pontos.
        </p>
      )}

      <Link to="/ranking" className="group flex items-center gap-1 font-label text-label-md text-primary">
        <span className="group-hover:underline">Ver ranking completo</span>
        <Icon name="arrow_forward" className="text-[16px] transition-transform group-hover:translate-x-0.5" />
      </Link>
    </aside>
  )
}

function TopEngagementRow({ entry }: { entry: RankingEntryDTO }) {
  const { user, position, points, online } = entry
  return (
    <Link
      to={`/perfil/${user.id}`}
      className={`flex items-center gap-md rounded-xl px-sm py-sm transition-colors hover:bg-surface-container ${
        position === 1 ? 'bg-primary/10' : ''
      }`}
    >
      <PositionBadge position={position} />

      <div className="relative shrink-0">
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-outline-variant/50 bg-surface-container-highest">
          <Avatar user={user} />
        </div>
        <OnlineDot online={online} label={user.name} />
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={`truncate font-label text-label-md leading-tight ${
            position === 1 ? 'font-bold text-primary' : 'text-on-surface'
          }`}
        >
          {user.name}
        </p>
        {/* Setor, e não cargo: a lista cruza a empresa inteira, e é o setor que
            situa a pessoa (mesma escolha do card de aniversariantes). */}
        <p className="truncate text-body-sm text-on-surface-variant">{user.sectorName || 'Sem setor'}</p>
      </div>

      <div className="shrink-0 text-right">
        <p className="font-label text-label-md font-bold tabular-nums text-on-surface">{points}</p>
        <p className="font-label text-[10px] uppercase tracking-wide text-on-surface-variant">pts</p>
      </div>
    </Link>
  )
}

/**
 * Medalha nos três primeiros, número nos demais.
 *
 * Ouro/prata/bronze são cores do PÓDIO, não da marca — um tenant verde continua
 * com o primeiro lugar dourado, senão a hierarquia deixaria de ser lida de
 * relance.
 */
function PositionBadge({ position }: { position: number }) {
  const medal =
    position === 1
      ? 'bg-amber-400 text-amber-950'
      : position === 2
        ? 'bg-slate-300 text-slate-900'
        : position === 3
          ? 'bg-orange-400 text-orange-950'
          : null

  return (
    <span
      aria-label={`${position}º lugar`}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-label text-label-sm font-bold ${
        medal ?? 'bg-surface-container-highest text-on-surface-variant'
      }`}
    >
      {medal ? <Icon name="trophy" className="text-[16px]" filled /> : position}
    </span>
  )
}
