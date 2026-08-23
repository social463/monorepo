import type { XpEvent } from '@legends/shared'
import { Icon } from '../../components/Icon'
import { useXpRules } from '../../lib/use-xp'

/**
 * As três formas de pontuar no Feed, na ordem em que a pessoa esbarra nelas
 * (reagir → comentar → ler por inteiro).
 *
 * Rótulo curto e próprio, não o `XP_EVENT_LABELS` do contrato: aquele texto
 * ("Reagir a um comunicado") existe para o formulário do admin e para o Manual
 * do Game, onde o evento aparece longe do Feed e precisa se explicar. Aqui a
 * lista está DENTRO do Feed — repetir "um comunicado" em três linhas seguidas
 * só rouba espaço da coluna.
 */
const ROWS: { event: XpEvent; icon: string; label: string }[] = [
  { event: 'CORPORATE_POST_REACTION', icon: 'favorite', label: 'Reagir' },
  { event: 'CORPORATE_POST_COMMENT', icon: 'chat_bubble', label: 'Comentar' },
  { event: 'CORPORATE_POST_READ_FULL', icon: 'menu_book', label: 'Ler conteúdo completo' },
]

/**
 * Bloco "Como ganhar pontos" da coluna do Feed Corporativo.
 *
 * Os valores saem de `GET /xp/rules`, que devolve **só regra ativa** da
 * empresa: quem desligou o crédito de reação não vê a linha da reação, e quem
 * mudou o +3 para +5 vê +5. Cravar 1/2/3 aqui faria a tela prometer pontos que
 * o servidor não paga.
 *
 * Sem nenhuma das três regras ativas o card não é montado — um "Como ganhar
 * pontos" vazio anuncia gamificação que a empresa desligou.
 */
export function HowToEarnPointsCard() {
  const { data } = useXpRules()
  const rules = data?.rules ?? []
  const rows = ROWS.map((row) => ({
    ...row,
    amount: rules.find((rule) => rule.event === row.event)?.amount ?? null,
  })).filter((row) => row.amount !== null)

  if (rows.length === 0) return null

  return (
    <aside
      data-testid="how-to-earn-points"
      className="flex flex-col gap-md rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg"
    >
      <h2 className="flex items-center gap-sm font-headline text-body-lg font-semibold text-on-surface">
        <Icon name="stars" className="text-[20px] text-primary" />
        Como ganhar pontos
      </h2>

      <ul className="flex flex-col gap-sm">
        {rows.map((row) => (
          <li key={row.event} className="flex items-center gap-sm text-body-sm text-on-surface-variant">
            <Icon name={row.icon} className="text-[18px] text-primary" />
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span className="shrink-0 font-label text-label-md font-bold text-on-surface">+{row.amount}</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
