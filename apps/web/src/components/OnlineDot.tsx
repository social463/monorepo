/**
 * Bolinha de presença sobreposta ao avatar: verde para quem está on-line na
 * plataforma, cinza para quem não está.
 *
 * O cinza é desenhado, e não omitido: a regra do bloco pede os dois estados, e
 * uma bolinha ausente se confunde com "o card não sabe" — que é diferente de
 * "está fora".
 *
 * A cor é fixa (verde/cinza), e não um token da marca. `primary` muda por
 * empresa, e num tenant de marca vermelha o verde de "on-line" viraria vermelho
 * — o oposto do que a convenção universal de presença diz.
 *
 * Precisa de um pai com `position: relative`.
 */
export function OnlineDot({ online, label }: { online: boolean; label?: string }) {
  const title = online ? 'On-line na plataforma' : 'Inativo'
  return (
    <span
      className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center"
      title={label ? `${label} — ${title}` : title}
      aria-label={title}
      role="img"
    >
      {online && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      )}
      <span
        className={`relative inline-flex h-3 w-3 rounded-full ring-2 ring-surface-container-low ${
          online ? 'bg-emerald-500' : 'bg-outline-variant'
        }`}
      />
    </span>
  )
}
