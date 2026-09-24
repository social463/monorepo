import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PublicUser } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'

/**
 * Teto da lista aberta. Era 8, e isso escondia gente: com o filtro por setor
 * ligado, a lista mostrava só os 8 primeiros nomes em ordem alfabética e o
 * resto do setor parecia não existir — quem procurava "Karina" só a encontrava
 * digitando. 50 cobre um setor inteiro; acima disso a busca é o caminho, e a
 * lista diz que truncou em vez de mentir por omissão.
 */
const MAX_RESULTS = 50

/** Descrição secundária da pessoa na lista: cargo/squad quando houver, senão o setor. */
function subtitle(user: PublicUser): string {
  const parts = [user.position, user.squad].filter(Boolean) as string[]
  if (parts.length > 0) return parts.join(' • ')
  return user.sectorName ?? ''
}

/**
 * Escolha do destinatário do feedback, entre os colegas da empresa inteira
 * (`/users/company`) — a mesma rota e a mesma query da busca do topo.
 */
export function TargetPicker({
  value,
  onChange,
  sectorId,
  excludeIds,
  scope = 'feedback',
  placeholder = 'Procurar colega na empresa…',
  ariaLabel = 'Para quem é o feedback',
}: {
  value: PublicUser | null
  onChange: (user: PublicUser | null) => void
  /** Recorta a lista a um setor — o "filtrar por setor" que a G&G pediu. */
  sectorId?: string
  /** Quem já foi escolhido no reconhecimento grupal não reaparece na busca. */
  excludeIds?: string[]
  /**
   * Quem entra na lista. `feedback` (padrão) é a de destinatários: sem você mesmo,
   * sem admins. `all` é a de pessoas da empresa, para campos que escolhem alguém
   * qualquer — dono de projeto, participante — onde essas duas exclusões só escondem
   * gente que devia aparecer.
   */
  scope?: 'feedback' | 'all'
  placeholder?: string
  /** Rótulo de acessibilidade do campo de busca — outros usos (fora do feedback) devem sobrescrever o padrão. */
  ariaLabel?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // A chave do escopo `feedback` continua sendo `['users','company']` crua: é a mesma
  // que meia dúzia de telas usa (convidados de reunião, calendário, 1:1…) e trocá-la
  // faria cada uma buscar a lista de novo, por conta própria.
  const { data, isLoading } = useQuery({
    queryKey: scope === 'all' ? ['users', 'company', 'all'] : ['users', 'company'],
    queryFn: () =>
      apiFetch<{ users: PublicUser[] }>(scope === 'all' ? '/users/company?scope=all' : '/users/company'),
  })
  const users = useMemo(() => {
    const all = data?.users ?? []
    const excluded = new Set(excludeIds ?? [])
    return all.filter((u) => !excluded.has(u.id) && (!sectorId || u.sectorId === sectorId))
  }, [data, excludeIds, sectorId])

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return users
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(term) ||
        (u.position ?? '').toLowerCase().includes(term) ||
        (u.squad ?? '').toLowerCase().includes(term) ||
        (u.sectorName ?? '').toLowerCase().includes(term),
    )
  }, [users, query])
  const results = useMemo(() => matches.slice(0, MAX_RESULTS), [matches])

  // Fecha a lista ao clicar fora.
  useEffect(() => {
    if (!open) return
    function handlePointer(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    return () => document.removeEventListener('mousedown', handlePointer)
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  function select(user: PublicUser) {
    onChange(user)
    setQuery('')
    setOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!results.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((i) => (i + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => (i - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const chosen = results[activeIndex] ?? results[0]
      if (chosen) select(chosen)
    }
  }

  if (value) {
    return (
      <div className="flex items-center gap-sm rounded-md border border-primary/40 bg-primary/5 px-md py-sm">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest">
          <Avatar user={value} />
        </span>
        <div className="min-w-0 flex-grow">
          <p className="truncate font-label text-label-md text-on-surface">{value.name}</p>
          <p className="truncate text-body-sm text-on-surface-variant">{subtitle(value)}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Trocar destinatário"
          className="shrink-0 rounded-md border border-outline-variant/60 p-1 text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
        >
          <Icon name="close" className="text-[18px]" />
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="group relative block">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-on-surface-variant transition-colors group-focus-within:text-primary">
          <Icon name="search" className="text-[20px]" />
        </span>
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls="feedback-target-list"
          aria-autocomplete="list"
          aria-label={ariaLabel}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full rounded-md border border-outline-variant/60 bg-surface-container-highest py-2 pl-10 pr-4 text-body-sm text-on-surface outline-none placeholder:text-on-surface-variant focus:border-primary"
        />
      </label>

      {open && (
        <ul
          id="feedback-target-list"
          role="listbox"
          className="absolute left-0 top-full z-50 mt-sm max-h-72 w-full overflow-y-auto rounded-xl border border-outline-variant/40 bg-surface-container py-1 shadow-lg"
        >
          {isLoading ? (
            <li className="px-lg py-md text-body-sm text-on-surface-variant">Carregando colegas…</li>
          ) : results.length === 0 ? (
            <li className="px-lg py-md text-body-sm text-on-surface-variant">Nenhum colega encontrado.</li>
          ) : (
            results.map((user, index) => (
              <li key={user.id} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  onClick={() => select(user)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex w-full items-center gap-sm px-md py-sm text-left transition-colors ${
                    index === activeIndex ? 'bg-surface-container-highest' : 'hover:bg-surface-container-highest'
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest">
                    <Avatar user={user} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-label text-label-md text-on-surface">{user.name}</span>
                    <span className="block truncate text-body-sm text-on-surface-variant">{subtitle(user)}</span>
                  </span>
                </button>
              </li>
            ))
          )}
          {matches.length > results.length && (
            <li className="border-t border-outline-variant/40 px-md py-sm text-label-sm text-on-surface-variant">
              Mostrando {results.length} de {matches.length} colegas — busque pelo nome para achar o resto.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
