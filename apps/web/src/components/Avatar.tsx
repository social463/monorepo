import { useCharacterPortrait, type CharacterSource } from '../hooks/useCharacterPortrait'

export interface AvatarSource extends CharacterSource {
  photoUrl?: string | null
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()
}

/**
 * Inner avatar content (image or initials). Callers provide their own wrapper
 * element for sizing/borders. Resolução: **photoUrl → personagem LPC → iniciais**.
 *
 * A foto vem primeiro de propósito: quem identifica a pessoa na plataforma é a
 * foto do cadastro, e o personagem LPC é do jogo.
 *
 * `preferCharacter` inverte isso e **nunca** cai para a foto: é o Escritório
 * Virtual, onde a identidade é o boneco. O mapa em si nem passa por aqui (o
 * Phaser desenha direto), mas a barra de mídia, a lista de pessoas e os ladrilhos
 * de câmera passam — e com a foto neles a pessoa aparecia de dois jeitos na
 * mesma tela. A exceção é o card de resumo, que abre ao clicar no personagem:
 * ali a foto é justamente o que se quer ver.
 */
export function Avatar({
  user,
  initialsClassName = 'font-label text-label-sm font-bold text-primary',
  imgClassName = '',
  preferCharacter = false,
}: {
  user: AvatarSource
  initialsClassName?: string
  imgClassName?: string
  preferCharacter?: boolean
}) {
  const portrait = useCharacterPortrait(user)
  const src = preferCharacter ? portrait : (user.photoUrl ?? portrait ?? null)

  if (src) {
    return <img src={src} alt={user.name} className={`h-full w-full object-cover ${imgClassName}`.trim()} />
  }
  return <span className={initialsClassName}>{initials(user.name)}</span>
}
