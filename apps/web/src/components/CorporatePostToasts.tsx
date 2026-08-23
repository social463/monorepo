import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useCorporateMuralSocket } from '../lib/useCorporateMuralSocket'
import { Icon } from './Icon'

/**
 * Toast de comunicado novo, montado no `AppLayout` — quem está com a
 * plataforma aberta vê o aviso onde quer que esteja, não só no feed.
 *
 * O WebSocket manda **só o id** (`post:published`): o hub é canal único e
 * global, então título ou trecho no broadcast vazaria comunicado de uma empresa
 * para conexão de outra. O conteúdo vem de `GET /corporate-posts/:id`, que é
 * escopado por empresa **e** por público-alvo — quem não deve ver leva 404 e
 * nenhum toast aparece.
 */

interface ToastItem {
  postId: string
  title: string
  author: string
}

const TOAST_MS = 8000

export function CorporatePostToasts() {
  const [items, setItems] = useState<ToastItem[]>([])

  // A conexão é a MESMA que mantém o feed ao vivo (`useCorporateMuralSocket`):
  // este componente mora no `AppLayout`, então o feed e a prévia da Home
  // atualizam sozinhos em qualquer tela, sem uma segunda conexão só do toast.
  useCorporateMuralSocket((event) => {
    if (event.type !== 'post:published') return
    void apiFetch<{ post: { id: string; title: string | null; content: string; author: { name: string } } }>(
      `/corporate-posts/${event.postId}`,
    )
      .then(({ post }) => {
        setItems((prev) =>
          prev.some((t) => t.postId === post.id)
            ? prev
            : [...prev, { postId: post.id, title: post.title ?? post.content.slice(0, 80), author: post.author.name }],
        )
      })
      // 404 aqui é o caso normal de quem está fora do público-alvo.
      .catch(() => undefined)
  })

  // Um timer por toast: some sozinho, e o clique em fechar tira antes.
  useEffect(() => {
    if (items.length === 0) return
    const timer = setTimeout(() => setItems((prev) => prev.slice(1)), TOAST_MS)
    return () => clearTimeout(timer)
  }, [items])

  if (items.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-lg right-lg z-50 flex flex-col gap-sm">
      {items.map((item) => (
        <div
          key={item.postId}
          role="status"
          className="pointer-events-auto flex max-w-sm items-start gap-sm rounded-xl border border-outline-variant/40 bg-surface-container-high px-md py-sm shadow-lg"
        >
          <Icon name="campaign" className="mt-0.5 text-[20px] text-primary" />
          <div className="min-w-0 flex-1">
            <p className="font-label text-label-md font-bold text-on-surface">Novo comunicado</p>
            <p className="truncate text-body-sm text-on-surface-variant">{item.title}</p>
            <p className="text-label-sm text-on-surface-variant">por {item.author}</p>
            <Link
              to={`/mural-corporativo#${item.postId}`}
              onClick={() => setItems((prev) => prev.filter((t) => t.postId !== item.postId))}
              className="font-label text-label-sm text-primary hover:underline"
            >
              Abrir
            </Link>
          </div>
          <button
            type="button"
            aria-label="Fechar aviso"
            onClick={() => setItems((prev) => prev.filter((t) => t.postId !== item.postId))}
            className="flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest"
          >
            <Icon name="close" className="text-[16px]" />
          </button>
        </div>
      ))}
    </div>
  )
}
