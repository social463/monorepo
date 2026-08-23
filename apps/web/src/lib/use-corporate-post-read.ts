import { useEffect, useRef } from 'react'
import { apiFetch } from './api'

/**
 * Ids já marcados nesta sessão. Vive no módulo, não em estado de React: a
 * marcação é efeito colateral puro e **não pode** virar `setState` nem
 * invalidar o feed — `setState` num efeito que roda durante o scroll é
 * exatamente o loop render→setState→render que estoura a heap do worker de
 * teste (ver AGENTS.md, "Gotchas"), e invalidar traria refetch em cascata.
 * Some no reload, que é o recorte desejado: uma vez por post por sessão.
 */
const marked = new Set<string>()

/** Só para teste — zera o cache de sessão entre casos. */
export function __resetCorporatePostReadCache(): void {
  marked.clear()
}

/**
 * Avisa o servidor que a pessoa abriu o **conteúdo completo** do comunicado —
 * é o clique em "Ver conteúdo completo", e é ele que paga XP de leitura.
 *
 * Quem decide se o post é longo o bastante para valer XP é o servidor: mandar
 * `full: true` de um post de uma linha não credita nada. Best-effort, como a
 * marcação de leitura: falhou, ninguém vê erro.
 */
export function markCorporatePostReadFull(postId: string): void {
  marked.add(postId)
  void apiFetch<void>(`/corporate-posts/${postId}/read`, {
    method: 'POST',
    body: JSON.stringify({ full: true }),
  }).catch(() => {
    marked.delete(postId)
  })
}

/**
 * Marca o post como lido quando ele entra na viewport (≥50% visível), uma vez
 * por post por sessão. Devolve o ref que o card cola no `<li>`.
 */
export function useCorporatePostRead(postId: string) {
  const ref = useRef<HTMLLIElement>(null)

  useEffect(() => {
    // Guarda de montagem: se este post já foi marcado (nesta sessão, por uma
    // montagem anterior do card), nem cria o observer.
    if (marked.has(postId)) return
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        // Guarda de corrida: cobre a janela entre o disparo do callback e o
        // `marked.add` abaixo — sem ela, duas interseções quase simultâneas
        // (ou callbacks pendentes de observers antigos) marcariam duas vezes.
        // Não é redundante com a guarda de montagem acima, que só roda uma
        // vez, no efeito.
        if (marked.has(postId)) return
        marked.add(postId)
        observer.disconnect()
        apiFetch<void>(`/corporate-posts/${postId}/read`, { method: 'POST' }).catch(() => {
          // Falhou? Libera para uma próxima tentativa nesta sessão. Marcar
          // leitura é best-effort: nunca deve estourar erro na cara de ninguém.
          marked.delete(postId)
        })
      },
      { threshold: 0.5 },
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [postId])

  return ref
}
