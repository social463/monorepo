import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PublicUser } from '@legends/shared'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { foldText } from '../../lib/text'
import { fetchCompanyUsers } from '../../office/meetings/api'

const SEM_SETOR = 'Sem setor'

interface GrupoDeSetor {
  name: string
  people: PublicUser[]
}

/**
 * Pessoas por setor, alfabético nos dois níveis — a API já devolve a lista
 * ordenada por nome, então só os setores precisam de ordenação aqui. Mesmo
 * agrupamento do seletor de convidados da reunião (`MeetingForm`).
 */
function agruparPorSetor(people: PublicUser[]): GrupoDeSetor[] {
  const porSetor = new Map<string, PublicUser[]>()
  for (const person of people) {
    const nome = person.sectorName?.trim() || SEM_SETOR
    const atual = porSetor.get(nome)
    if (atual) atual.push(person)
    else porSetor.set(nome, [person])
  }
  return [...porSetor.entries()]
    .map(([name, pessoas]) => ({ name, people: pessoas }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

/**
 * Escolha de UMA pessoa para o 1:1 — diferente do seletor de convidados da
 * reunião, que é múltiplo. A lista é a empresa inteira (`/users/company`, que
 * já resolve `sectorName` e já exclui ADMIN e SUBADMIN), agrupada por setor e
 * filtrável por nome ou cargo.
 *
 * A busca dobra o texto (`foldText`) porque procurar "jose" precisa achar
 * "José" — é o mesmo tratamento das outras buscas de pessoa do produto.
 */
export function PersonPicker({
  value,
  onChange,
}: {
  value: PublicUser | null
  onChange: (person: PublicUser | null) => void
}) {
  const [filtro, setFiltro] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['users', 'company'],
    queryFn: fetchCompanyUsers,
    staleTime: 60_000,
  })

  const pessoas = data?.users ?? []
  const grupos = useMemo(() => agruparPorSetor(pessoas), [pessoas])

  const visiveis = useMemo(() => {
    const termo = foldText(filtro.trim())
    if (!termo) return grupos
    return grupos
      .map((grupo) => ({
        ...grupo,
        people: grupo.people.filter(
          (p) => foldText(p.name).includes(termo) || foldText(p.position ?? '').includes(termo),
        ),
      }))
      .filter((grupo) => grupo.people.length > 0)
  }, [grupos, filtro])

  if (value) {
    return (
      <div className="flex items-center gap-sm rounded-md border border-outline-variant/40 bg-surface-container-low p-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-highest">
          <Avatar user={value} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-label text-label-lg text-on-surface">{value.name}</span>
          {value.position && (
            <span className="block truncate text-body-sm text-on-surface-variant">{value.position}</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={`Trocar ${value.name}`}
          className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
        >
          <Icon name="close" className="text-[18px]" />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-xs">
      <input
        type="search"
        value={filtro}
        onChange={(event) => setFiltro(event.target.value)}
        aria-label="Procurar pessoa"
        placeholder="Procurar por nome ou cargo…"
        className="w-full rounded-md border border-outline-variant/40 bg-surface-container-low px-sm py-xs text-body-sm text-on-surface placeholder:text-on-surface-variant"
      />

      <div className="max-h-64 space-y-xs overflow-y-auto rounded-md border border-outline-variant/40 p-xs">
        {isLoading && <p className="p-xs text-body-sm text-on-surface-variant">Carregando pessoas…</p>}

        {!isLoading && visiveis.length === 0 && (
          <p className="p-xs text-body-sm text-on-surface-variant">Ninguém encontrado.</p>
        )}

        {visiveis.map((grupo) => (
          <div key={grupo.name}>
            <p className="px-xs py-[2px] font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
              {grupo.name}
            </p>
            <ul>
              {grupo.people.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => onChange(person)}
                    className="flex w-full items-center gap-sm rounded-md px-xs py-xs text-left hover:bg-surface-container-highest"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-highest">
                      <Avatar user={person} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-label text-label-md text-on-surface">{person.name}</span>
                      {person.position && (
                        <span className="block truncate text-body-sm text-on-surface-variant">{person.position}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
