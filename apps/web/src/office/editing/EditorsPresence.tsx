import type { OfficeOccupant } from '@legends/shared'

interface Props {
  editorUserIds: string[]
  youId: string | null
  occupants: OfficeOccupant[]
}

/**
 * Indicador leve de "quem mais está editando" — só aparece dentro do drawer
 * de edição (`editing.state.active`), e só quando há alguém além de você em
 * `editorUserIds` (espelhado de `welcome.editorUserIds`/`editors-changed`,
 * Task 8). Não bloqueia nada; é só um aviso de presença colaborativa.
 */
export function EditorsPresence({ editorUserIds, youId, occupants }: Props) {
  const nameOf = (id: string) => occupants.find((o) => o.userId === id)?.name ?? 'Alguém'
  const others = editorUserIds.filter((id) => id !== youId)
  if (others.length === 0) return null
  const names = others.map(nameOf)
  const label =
    names.length === 1
      ? `${names[0]} também está editando`
      : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]} também estão editando`
  return (
    <div className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800" role="status">
      {label}
    </div>
  )
}
