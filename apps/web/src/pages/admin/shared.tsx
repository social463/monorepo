import { useId, useState, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { ApiError } from '../../lib/api'

export const inputCls =
  'w-full rounded-md border border-outline-variant/60 bg-surface-container-highest px-3 py-2 text-body-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant focus:border-primary focus:ring-2 focus:ring-primary/30'

/** Mensagem de erro pro banner `role="alert"`: usa a do servidor quando é um erro de domínio (`ApiError`), senão cai no fallback local. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * `datetime-local` fala horário local; o contrato fala ISO com fuso (sempre
 * UTC). Usa os getters locais (não `slice`/regex na string ISO) para que o
 * fuso de exibição seja o do navegador do admin, não UTC — as duas abas de
 * campanhas (`CampaignCalendar`, `CampaignGenerator`) compartilham essa
 * conversão porque um `datetime-local` alimentado com dígitos UTC crus mostra
 * hora errada (grade nasce às 09:00 de São Paulo = `T12:00:00.000Z`).
 */
export function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
      <div className="mb-lg flex flex-wrap items-center justify-between gap-md">
        <h3 className="font-headline text-headline-md text-on-surface">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

// ----- Agrupamento por setor, com acordeão (recolhido por padrão) -----

export interface SectorGroup<T> {
  key: string
  name: string
  items: T[]
}

/**
 * Agrupa itens com `sectorId` pelos setores já carregados (mesma ordem
 * alfabética que a API retorna). Um sectorId que não bate com nenhum setor
 * conhecido cai num grupo "Sem setor" à parte, em vez de sumir da lista.
 */
export function groupBySector<T extends { sectorId?: string | null }>(
  items: T[],
  sectors: { id: string; name: string }[],
): SectorGroup<T>[] {
  const bySectorId = new Map<string, T[]>()
  for (const item of items) {
    const key = item.sectorId ?? ''
    const bucket = bySectorId.get(key)
    if (bucket) bucket.push(item)
    else bySectorId.set(key, [item])
  }

  const groups = sectors
    .map((sector) => ({ key: sector.id, name: sector.name, items: bySectorId.get(sector.id) ?? [] }))
    .filter((group) => group.items.length > 0)

  const knownSectorIds = new Set(sectors.map((s) => s.id))
  const orphaned = items.filter((item) => !knownSectorIds.has(item.sectorId ?? ''))
  if (orphaned.length > 0) groups.push({ key: '__sem-setor__', name: 'Sem setor', items: orphaned })

  return groups
}

export function SectorAccordion({
  name,
  count,
  forceOpen = false,
  children,
}: {
  name: string
  count: number
  /**
   * Mantém o grupo aberto independentemente do clique. Serve para busca/filtro:
   * um resultado escondido dentro de um acordeão fechado parece "não achou".
   */
  forceOpen?: boolean
  children: ReactNode
}) {
  const [manualOpen, setManualOpen] = useState(false)
  const open = forceOpen || manualOpen
  const contentId = useId()

  return (
    <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low">
      <button
        type="button"
        onClick={() => setManualOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-center justify-between gap-sm px-md py-sm text-left"
      >
        <span className="font-label text-label-md uppercase tracking-wide text-on-surface-variant">
          {name} <span className="normal-case text-on-surface-variant">({count})</span>
        </span>
        <Icon
          name="expand_more"
          className={`shrink-0 text-[20px] text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div id={contentId} className="border-t border-outline-variant/20 p-md">
          {children}
        </div>
      )}
    </div>
  )
}

// ----- Agrupamento multi-setor (Categorias/Selos: global OU um-ou-mais setores) -----

/**
 * Como groupBySector, mas pra itens que podem ser globais OU específicos de
 * MAIS DE UM setor ao mesmo tempo (não pertencem a exatamente um). Sempre
 * devolve o grupo "Global" primeiro (se houver algum item global); depois um
 * grupo por setor com pelo menos um item específico associado — um item de
 * dois setores aparece nos dois grupos correspondentes. Por fim, um item
 * rascunho (`!global` e sem nenhum setor selecionado ainda) cai no grupo
 * "Sem setor", por último — sem isso o item some da tela de administração.
 */
export function groupBySectorMulti<T extends { global: boolean; sectorIds: string[] }>(
  items: T[],
  sectors: { id: string; name: string }[],
): SectorGroup<T>[] {
  const groups: SectorGroup<T>[] = []

  const globalItems = items.filter((item) => item.global)
  if (globalItems.length > 0) {
    groups.push({ key: '__global__', name: 'Global', items: globalItems })
  }

  for (const sector of sectors) {
    const matched = items.filter((item) => !item.global && item.sectorIds.includes(sector.id))
    if (matched.length > 0) {
      groups.push({ key: sector.id, name: sector.name, items: matched })
    }
  }

  const unassigned = items.filter((item) => !item.global && item.sectorIds.length === 0)
  if (unassigned.length > 0) {
    groups.push({ key: '__sem-setor__', name: 'Sem setor', items: unassigned })
  }

  return groups
}

export function SectorChecklist({
  sectors,
  selected,
  onToggle,
}: {
  sectors: { id: string; name: string }[]
  selected: Set<string>
  onToggle: (sectorId: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-sm sm:grid-cols-3">
      {sectors.map((sector) => (
        <label key={sector.id} className="flex items-center gap-xs font-label text-label-sm text-on-surface">
          <input
            type="checkbox"
            aria-label={sector.name}
            checked={selected.has(sector.id)}
            onChange={() => onToggle(sector.id)}
          />
          {sector.name}
        </label>
      ))}
    </div>
  )
}
