import { Link } from 'react-router-dom'
import type { CorporatePostReactorDTO } from '@legends/shared'
import { Avatar } from './Avatar'

/**
 * Lista nominal de quem reagiu: foto, nome, setor e o emoji que a pessoa
 * escolheu. Fonte única das duas telas que mostram isso — o "N reações" do card
 * do feed e o painel de alcance da moderação —, para a mesma informação não
 * aparecer de dois jeitos.
 *
 * Uma linha por (pessoa, emoji): quem reagiu com 💚 e 🎉 aparece duas vezes,
 * porque é assim que o total é contado nos dois lugares.
 *
 * O instante da reação não é exibido: a pergunta aqui é "quem", e o horário
 * (que o DTO traz e o servidor usa para ordenar) só competia com o nome. A
 * ordem da lista já diz o que ele diria — mais recentes primeiro.
 */
export function ReactorsList({ items, total }: { items: CorporatePostReactorDTO[]; total: number }) {
  if (items.length === 0) {
    return <p className="text-body-sm text-on-surface-variant">Ninguém reagiu a este comunicado ainda.</p>
  }

  return (
    <>
      <ul className="flex flex-col divide-y divide-outline-variant/20">
        {items.map((item) => (
          <li key={`${item.user.id}-${item.emoji}`} className="flex items-center gap-sm py-sm">
            <Link
              to={`/perfil/${item.user.id}`}
              className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest"
            >
              <Avatar user={item.user} />
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                to={`/perfil/${item.user.id}`}
                className="block truncate font-label text-label-md text-on-surface hover:underline"
              >
                {item.user.name}
              </Link>
              <span className="font-label text-label-sm text-on-surface-variant">
                {item.sectorName ?? 'Sem setor'}
              </span>
            </div>
            <span aria-hidden className="shrink-0 text-title-md">
              {item.emoji}
            </span>
          </li>
        ))}
      </ul>
      {/* A lista tem teto no servidor; sem este aviso, "200 de 340" passaria por
          lista completa e quem lê contaria gente a menos. */}
      {total > items.length && (
        <p className="pt-sm text-body-sm text-on-surface-variant">
          Mostrando as {items.length} reações mais recentes de {total}.
        </p>
      )}
    </>
  )
}
