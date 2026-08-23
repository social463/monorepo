import { Link } from 'react-router-dom'
import { tenureLabel } from '@legends/shared'
import { useCelebrations } from '../lib/use-celebrations'
import { CelebrationDateLabel } from './CelebrationDateLabel'
import { CelebrationTile } from './CelebrationTile'
import { Icon } from './Icon'

/** Card da sidebar da Home: os próximos aniversários de empresa (3 datas mais próximas, hoje incluso). */
export function WorkAnniversariesCard() {
  const { workAnniversaries, isLoading, isError } = useCelebrations()
  // Mesma regra do card de aniversários: conteúdo acessório não ocupa a sidebar
  // com skeleton nem com mensagem de erro.
  if (isLoading || isError) return null

  const upcoming = workAnniversaries.upcoming

  return (
    <aside
      data-testid="work-anniversaries-card"
      className="flex flex-col gap-md rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg"
    >
      <h2 className="flex items-center gap-sm font-headline text-body-lg font-semibold text-on-surface">
        <Icon name="workspace_premium" className="text-[20px] text-tertiary" />
        Próximos aniversários de empresa
      </h2>

      {upcoming.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">Nenhum aniversário de casa chegando por aqui.</p>
      ) : (
        <ul className="-mx-sm flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: '22rem' }}>
          {upcoming.map((anniversary) => (
            <li key={anniversary.user.id}>
              <CelebrationTile
                user={anniversary.user}
                caption={tenureLabel(anniversary.years)}
                highlighted={anniversary.daysUntil === 0}
                dateLabel={
                  <CelebrationDateLabel daysUntil={anniversary.daysUntil} observedDate={anniversary.observedDate} />
                }
              />
            </li>
          ))}
        </ul>
      )}

      {/* Abre a tela de aniversariantes já na aba de tempo de casa. */}
      <Link
        to="/aniversariantes?aba=tempo-de-casa"
        className="group flex items-center gap-1 font-label text-label-md text-primary"
      >
        <span className="group-hover:underline">Ver todos os aniversários</span>
        <Icon
          name="arrow_forward"
          className="text-[16px] transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </aside>
  )
}
