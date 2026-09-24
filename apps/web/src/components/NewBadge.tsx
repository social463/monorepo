/**
 * Marcação "Novo" dos blocos da Home: retângulo verde no canto superior direito
 * do item, como a G&G pediu (Documento 3, seção 9.3).
 *
 * `absolute` de propósito — no fluxo, o selo empurrava o título e provocava a
 * quebra de linha que a prévia acabou de deixar de ter. Quem usa precisa ser
 * `relative`.
 *
 * Verde de MARCA (`surface-tint`), e não `primary`: aqui a cor é preenchimento
 * de um retângulo, não texto — é exatamente o caso em que a cor institucional
 * crua vale, com `on-primary` por cima para o contraste (ver `AGENTS.md`).
 */
export function NewBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`absolute right-2 top-2 z-10 rounded bg-surface-tint px-1.5 py-0.5 font-label text-label-sm font-bold uppercase leading-none tracking-wide text-on-primary ${className}`}
    >
      Novo
    </span>
  )
}
