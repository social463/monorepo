import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { MentionDTO } from '@legends/shared'

/** Escapa metacaracteres de regex. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Quebra o conteúdo e transforma as ocorrências de "@<name>" (apenas dos usuários
 * em `mentions`) em links para o perfil. O restante do texto fica intacto.
 */
export function renderWithMentions(content: string, mentions: MentionDTO[]): ReactNode[] {
  if (mentions.length === 0) return [content]
  const byToken = new Map<string, string>()
  for (const m of mentions) byToken.set(`@${m.name}`, m.userId)
  // Tokens ordenados por comprimento desc para casar o nome mais longo primeiro.
  const tokens = [...byToken.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp)
  const re = new RegExp(`(${tokens.join('|')})`, 'g')
  return content.split(re).map((part, i) => {
    const userId = byToken.get(part)
    if (userId) {
      return (
        <Link key={i} to={`/perfil/${userId}`} className="font-label text-primary hover:underline">
          {part}
        </Link>
      )
    }
    return <span key={i}>{part}</span>
  })
}
