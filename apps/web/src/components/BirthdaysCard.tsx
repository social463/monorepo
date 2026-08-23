import { Link } from 'react-router-dom'
import { useCelebrations } from '../lib/use-celebrations'
import { CelebrationDateLabel } from './CelebrationDateLabel'
import { CelebrationTile } from './CelebrationTile'
import { Icon } from './Icon'

/** Card da sidebar da Home: os próximos aniversariantes de nascimento (3 datas mais próximas, hoje incluso). */
export function BirthdaysCard() {
  const { birthdays, isLoading, isError } = useCelebrations()
  // Enquanto carrega (ou se a chamada falhar) o card não aparece: é conteúdo
  // acessório, não vale ocupar a sidebar com skeleton nem com mensagem de erro.
  if (isLoading || isError) return null

  const upcoming = birthdays.upcoming

  return (
    <aside
      data-testid="birthdays-card"
      className="flex flex-col gap-md rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg"
    >
      {/* 18px em vez de headline-md: a sidebar tem 320px e o título quebrava em duas linhas. */}
      <h2 className="flex items-center gap-sm font-headline text-body-lg font-semibold text-on-surface">
        <Icon name="cake" className="text-[20px] text-primary" />
        Próximos aniversariantes
      </h2>

      {upcoming.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">Nenhum aniversário chegando por aqui.</p>
      ) : (
        <ul className="-mx-sm flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: '22rem' }}>
          {upcoming.map((birthday) => (
            <li key={birthday.user.id}>
              <CelebrationTile
                user={birthday.user}
                highlighted={birthday.daysUntil === 0}
                dateLabel={
                  <CelebrationDateLabel daysUntil={birthday.daysUntil} observedDate={birthday.observedDate} />
                }
              />
            </li>
          ))}
        </ul>
      )}

      {/* A tela de aniversariantes, não o calendário: quem clica aqui quer a
          lista de quem comemora, e o calendário responde "o que tem no dia". */}
      <Link to="/aniversariantes" className="group flex items-center gap-1 font-label text-label-md text-primary">
        <span className="group-hover:underline">Ver todos os aniversários</span>
        <Icon
          name="arrow_forward"
          className="text-[16px] transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </aside>
  )
}
