import { Link } from 'react-router-dom'
import type { CalendarCampaignPostDTO } from '@legends/shared'
import { Icon } from '../../components/Icon'

function quando(iso: string): string {
  const data = new Date(iso)
  return `${data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} · ${data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * O calendário editorial de Campanhas na janela em exibição (Documento 4,
 * seção 13.2) — a "visão sistêmica" que a G&G pediu.
 *
 * **Faixa acima da grade, e não barra dentro dela.** Item de campanha é um
 * comunicado agendado, não um evento que ocupa o dia: ele não tem duração, não
 * tem local e ninguém é convidado. Disputar a célula do dia com os eventos
 * daria a entender que são a mesma coisa — e obrigaria a inventar uma barra
 * para as três visões (mês, semana, dia), cada uma com um desenho diferente.
 * Assim a faixa é a mesma nas três.
 *
 * **Somente leitura.** Quem edita item de campanha edita em Administração ›
 * Campanhas, que é para onde o link leva. Duplicar a edição aqui criaria a
 * segunda fonte que a seção 13.2 já custou caro uma vez.
 *
 * Só aparece para quem enxerga: o servidor devolve a lista vazia para quem não
 * é admin nem do bloco de Gente e Gestão.
 */
export function CampaignPostsStrip({ posts }: { posts: readonly CalendarCampaignPostDTO[] }) {
  if (posts.length === 0) return null

  return (
    <section
      aria-label="Calendário editorial"
      className="rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-low p-md"
    >
      <div className="mb-sm flex flex-wrap items-center gap-sm">
        <Icon name="campaign" className="text-[18px] text-primary" />
        <h2 className="font-label text-label-md text-on-surface">Calendário editorial</h2>
        <span className="font-label text-label-sm text-on-surface-variant">
          {posts.length} {posts.length === 1 ? 'comunicado' : 'comunicados'} nesta janela
        </span>
        <Link
          to="/admin/campanhas"
          className="ml-auto font-label text-label-sm text-primary hover:underline"
        >
          Gerenciar em Campanhas
        </Link>
      </div>

      <ul className="flex flex-col gap-1">
        {posts.map((post) => (
          <li key={post.id} className="flex flex-wrap items-baseline gap-sm text-body-sm">
            <span className="font-label text-label-sm text-on-surface-variant">{quando(post.scheduledFor)}</span>
            <span className="text-on-surface">{post.title}</span>
            <span className="text-on-surface-variant">
              {post.campaignTheme ? `${post.campaignTheme} · ` : ''}
              {post.channelLabel}
            </span>
            {post.status === 'PUBLISHED' && (
              <span className="rounded-full bg-primary/10 px-sm font-label text-label-sm text-primary">
                Publicado
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
