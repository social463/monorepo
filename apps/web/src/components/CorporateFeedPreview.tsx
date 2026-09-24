import { Link } from 'react-router-dom'
import { useCorporateMuralFeed } from '../lib/use-corporate-mural'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { NewBadge } from './NewBadge'

/** Quantos comunicados aparecem na prévia da Home. */
const PREVIEW = 3

/**
 * Feed Corporativo no topo da Home: **chamadas**, não os comunicados inteiros.
 *
 * Antes a prévia jogava o post inteiro na Home, e a primeira linha do texto
 * fazia as vezes de título. Isso caiu por dois motivos: o comunicado agora tem
 * campo de título próprio, e post escrito num parágrafo só (o caso do texto
 * colado de fora) virava um bloco inteiro em negrito ocupando a Home. Aqui
 * entra o que identifica o comunicado — título, autor, duas linhas de resumo e
 * a miniatura da imagem —; ler é na página do mural.
 */
function resumo(post: { title: string | null; content: string }): { titulo: string; corpo: string } {
  const linhas = post.content
    .split('\n')
    .map((linha) => linha.trim())
    .filter(Boolean)
  // Sem título gravado (posts antigos), a primeira linha ainda é o melhor
  // candidato — e aí ela sai do corpo para não aparecer duas vezes.
  if (post.title?.trim()) return { titulo: post.title.trim(), corpo: linhas.join(' ') }
  return { titulo: linhas[0] ?? '', corpo: linhas.slice(1).join(' ') }
}

export function CorporateFeedPreview() {
  const feed = useCorporateMuralFeed()
  const posts = (feed.data?.pages.flatMap((page) => page.items) ?? []).slice(0, PREVIEW)

  return (
    <section
      data-testid="corporate-feed-preview"
      className="min-w-0 rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg"
    >
      <div className="mb-md flex items-center justify-between gap-md">
        <h2 className="flex items-center gap-sm font-headline text-body-lg font-semibold text-on-surface">
          <Icon name="campaign" className="text-[20px] text-primary" />
          Feed Corporativo
        </h2>
        <Link to="/mural-corporativo" className="group flex items-center gap-1 font-label text-label-md text-primary">
          <span className="group-hover:underline">Ver tudo</span>
          <Icon name="arrow_forward" className="text-[16px] transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      {feed.isLoading ? (
        <div className="h-20 animate-pulse rounded-xl bg-surface-container" />
      ) : posts.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">Nenhum comunicado por aqui ainda.</p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {posts.map((post) => {
            const { titulo, corpo } = resumo(post)
            const miniatura =
              post.image?.url ?? post.attachments.find((att) => att.kind === 'IMAGE')?.url ?? null
            return (
              <li key={post.id} className="relative">
                {/* Quem já leu o comunicado é o próprio servidor que diz
                    (`CorporatePostRead`, gravado ao abrir o post) — a Home não
                    inventa nem guarda estado. */}
                {!post.viewerRead && <NewBadge />}
                <Link
                  to={`/mural-corporativo#${post.id}`}
                  className={`flex flex-col gap-sm rounded-xl border p-md transition-colors hover:border-primary/40 ${
                    post.pinnedAt ? 'border-primary/40 bg-surface-container' : 'border-outline-variant/40'
                  }`}
                >
                  <div className="flex items-start gap-md">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/50 bg-surface-container-highest">
                      <Avatar user={post.author} />
                    </div>
                    <div className="min-w-0 flex-1 pr-12">
                      <p className="flex items-center gap-sm truncate font-label text-label-sm text-on-surface-variant">
                        {post.author.name}
                        {post.pinnedAt && (
                          <span className="rounded bg-primary-container px-1 py-0.5 font-label text-label-sm uppercase text-on-primary-container">
                            Fixado
                          </span>
                        )}
                      </p>
                      {titulo && (
                        <p className="truncate font-label text-label-md font-semibold text-on-surface">{titulo}</p>
                      )}
                      {/* Duas linhas e para: a prévia é chamada, e o texto todo
                          em negrito ocupando a Home é justamente o que se quer
                          evitar. `break-words` porque link colado sem espaço não
                          quebra sozinho e estouraria a coluna. */}
                      {corpo && (
                        <p className="line-clamp-2 break-words text-body-sm text-on-surface-variant">{corpo}</p>
                      )}
                    </div>
                    {miniatura && (
                      <img
                        src={miniatura}
                        alt=""
                        loading="lazy"
                        className="h-16 w-16 shrink-0 rounded-lg border border-outline-variant/40 object-cover"
                      />
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
