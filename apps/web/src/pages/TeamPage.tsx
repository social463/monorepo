import {
  Children,
  useMemo,
  useRef,
  useState,
  useEffect,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { USER_ROLE_LABELS, type OrganizationChartDTO, type OrganizationNodeDTO } from '@legends/shared'
import { apiFetch } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { Icon } from '../components/Icon'
import { Avatar } from '../components/Avatar'
import { OrganizationSkeleton } from '../components/Skeleton'

const MIN_ZOOM = 60
const MAX_ZOOM = 140
const ZOOM_STEP = 10
/**
 * O card acompanha o próprio conteúdo em vez de cortá-lo: `w-max` mede pelo
 * texto mais largo — na prática o nome do setor, que é a única linha de uma
 * linha só — e o `truncate` de cada linha vira rede de segurança, só entrando
 * em ação se o texto passar do teto.
 *
 * Os dois limites existem porque a árvore ainda precisa crescer em
 * profundidade, não em largura: `min-w` mantém os cards curtos todos do mesmo
 * tamanho (sem ele, "Ensino" ficaria bem menor que "Desenvolvimento de
 * Produto" e a fileira viraria um serrilhado), e `max-w` impede que um cargo
 * comprido estique a árvore inteira — 14rem cobre com folga os nomes de setor
 * reais, que são o que motiva a largura variável.
 */
const CARD_WIDTH = 'w-max min-w-[9rem] max-w-[14rem]'
/** Metade do avatar (2.75rem) — o quanto ele invade o topo do card. */
const AVATAR_OVERLAP = '-mt-[1.375rem]'

type CanvasPoint = {
  x: number
  y: number
}

function normalized(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
}

function personMatches(node: OrganizationNodeDTO, query: string): boolean {
  return [node.name, node.position, node.sectorName, USER_ROLE_LABELS[node.role]]
    .some((value) => normalized(value).includes(query))
}

/**
 * Mantém quem casa com a busca **e os líderes acima** — sem a linha de comando
 * inteira, o resultado apareceria solto e não daria para situar a pessoa.
 * `reportsCount` é recontado porque a subárvore visível encolheu.
 */
function filterTree(nodes: OrganizationNodeDTO[], query: string): OrganizationNodeDTO[] {
  return nodes.flatMap((node) => {
    const reports = filterTree(node.reports, query)
    if (reports.length === 0 && !personMatches(node, query)) return []
    const reportsCount = reports.reduce((total, report) => total + report.reportsCount + 1, 0)
    return [{ ...node, reports, reportsCount }]
  })
}

function countNodes(nodes: OrganizationNodeDTO[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.reports), 0)
}

function collectIdsWithReports(nodes: OrganizationNodeDTO[], into: Set<string>): Set<string> {
  for (const node of nodes) {
    if (node.reports.length > 0) into.add(node.id)
    collectIdsWithReports(node.reports, into)
  }
  return into
}

/** Traço vertical que liga um nó ao que vem logo abaixo dele. */
function TreeStem({ height = 'h-lg' }: { height?: string }) {
  return <span className={`mx-auto block w-px bg-outline-variant/60 ${height}`} aria-hidden />
}

/**
 * Faixa de filhos com conectores completos: barra horizontal ligando os irmãos e
 * um traço descendo em cada um. `wrap` quebra em grade — usado quando todos os
 * filhos são folhas, para um time grande não empurrar a árvore para a direita.
 *
 * A barra é montada em meias-barras por filho (cada uma cobrindo também o gap,
 * daí o `-1.5rem` = `gap-lg`), e não como uma barra absoluta única: assim ela
 * começa e termina no centro do primeiro e do último card, sem sobrar nas pontas,
 * seja qual for a largura de cada filho.
 */
function TreeBranches({ children, wrap = false }: { children: ReactNode; wrap?: boolean }) {
  const branches = Children.toArray(children)
  if (branches.length === 0) return null

  return (
    <div className={`flex items-start justify-center gap-lg ${wrap ? 'flex-wrap gap-y-md' : ''}`}>
      {branches.map((branch, index) => (
        <div key={index} className="relative flex flex-col items-center pt-lg">
          {index > 0 && (
            <span className="absolute left-[-1.5rem] right-1/2 top-0 h-px bg-outline-variant/60" aria-hidden />
          )}
          {index < branches.length - 1 && (
            <span className="absolute left-1/2 right-[-1.5rem] top-0 h-px bg-outline-variant/60" aria-hidden />
          )}
          <span className="absolute left-1/2 top-0 h-lg w-px -translate-x-1/2 bg-outline-variant/60" aria-hidden />
          {branch}
        </div>
      ))}
    </div>
  )
}

function PersonCard({
  node,
  collapsed,
  onToggle,
}: {
  node: OrganizationNodeDTO
  collapsed: boolean
  onToggle: () => void
}) {
  const directReports = node.reports.length
  const hasReports = directReports > 0

  return (
    <div className={`group relative flex ${CARD_WIDTH} flex-col items-center`}>
      <div className="relative z-10">
        <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 border-surface bg-surface-container-highest shadow-sm">
          <Avatar user={node} initialsClassName="font-label text-label-sm font-bold text-primary" />
        </span>
        {hasReports && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expandir' : 'Recolher'} equipe de ${node.name}`}
            title={collapsed ? `Expandir (${node.reportsCount})` : 'Recolher'}
            className="absolute -bottom-0.5 -right-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border-2 border-surface bg-on-surface px-1 font-label text-[10px] font-bold text-surface transition-transform hover:scale-110"
          >
            {collapsed ? `+${node.reportsCount}` : directReports}
          </button>
        )}
      </div>

      <Link
        to={`/perfil/${node.id}`}
        // `px-sm` (e não `px-xs`): com o card colado no texto, 4px deixavam o
        // nome do setor encostando na borda.
        className={`${AVATAR_OVERLAP} w-full rounded-xl border border-outline-variant/40 bg-surface-container-low px-sm pb-sm pt-7 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md`}
      >
        <span className="block truncate font-headline text-body-sm font-bold text-on-surface">{node.name}</span>
        <span className="mt-0.5 line-clamp-2 block text-[10px] leading-snug text-on-surface-variant">
          {node.position ?? USER_ROLE_LABELS[node.role]}
        </span>
        <span className="mt-1 block truncate font-label text-[9px] uppercase tracking-[0.08em] text-on-surface-variant">
          {node.sectorName}
        </span>
      </Link>
    </div>
  )
}

function TreeNode({
  node,
  collapsedIds,
  forceExpanded,
  onToggle,
}: {
  node: OrganizationNodeDTO
  collapsedIds: Set<string>
  forceExpanded: boolean
  onToggle: (id: string) => void
}) {
  const collapsed = !forceExpanded && collapsedIds.has(node.id)
  const showReports = node.reports.length > 0 && !collapsed
  // Time de folhas quebra em grade; se houver neto, mantém a linha para os
  // ramos não se cruzarem.
  const allLeaves = showReports && node.reports.every((report) => report.reports.length === 0)

  return (
    <div className="flex flex-col items-center">
      <PersonCard node={node} collapsed={collapsed} onToggle={() => onToggle(node.id)} />
      {showReports && (
        <>
          <TreeStem />
          <TreeBranches wrap={allLeaves}>
            {node.reports.map((report) => (
              <TreeNode
                key={report.id}
                node={report}
                collapsedIds={collapsedIds}
                forceExpanded={forceExpanded}
                onToggle={onToggle}
              />
            ))}
          </TreeBranches>
        </>
      )}
    </div>
  )
}

/**
 * `company` é o organograma inteiro, em `/time`. `direct-reports` é a entrada da
 * área de Liderança: o líder no topo e só quem responde diretamente a ele.
 * Mesma tela, mesmo canvas — o recorte é do endpoint, não do desenho.
 */
export type OrganizationScope = 'company' | 'direct-reports'

export function TeamPage({ scope = 'company' }: { scope?: OrganizationScope } = {}) {
  const { user } = useAuth()
  const isAdministrative = user?.role === 'ADMIN' || user?.role === 'SUBADMIN' || user?.role === 'SUPER_ADMIN'
  // Quem administra ("Admin / G&G") pode precisar da empresa inteira; para o
  // líder, essa saída não existe — é o que separa as duas entradas.
  const canSeeWholeCompany = isAdministrative || (user?.sectorFeatures ?? []).includes('gente-gestao')
  const myTeam = scope === 'direct-reports'
  const [search, setSearch] = useState('')
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [zoom, setZoom] = useState(100)
  const [pan, setPan] = useState<CanvasPoint>({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasAnchorRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(100)
  const panRef = useRef<CanvasPoint>({ x: 0, y: 0 })
  const dragRef = useRef<{
    pointerId: number
    start: CanvasPoint
    initialPan: CanvasPoint
  } | null>(null)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['organization', scope],
    queryFn: () => apiFetch<OrganizationChartDTO>(myTeam ? '/organization/direct-reports' : '/organization'),
  })

  function updatePan(nextPan: CanvasPoint) {
    panRef.current = nextPan
    setPan(nextPan)
  }

  function updateZoom(nextValue: number, focalPoint?: { clientX: number; clientY: number }) {
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextValue))
    const currentZoom = zoomRef.current
    if (nextZoom === currentZoom) return

    const viewport = viewportRef.current
    const canvasAnchor = canvasAnchorRef.current
    if (viewport && canvasAnchor && focalPoint) {
      const rect = viewport.getBoundingClientRect()
      const anchorRect = canvasAnchor.getBoundingClientRect()
      const pointX = focalPoint.clientX - rect.left
      const pointY = focalPoint.clientY - rect.top
      const anchorX = anchorRect.left - rect.left
      const anchorY = anchorRect.top - rect.top
      const ratio = nextZoom / currentZoom
      const currentPan = panRef.current
      updatePan({
        x: pointX - anchorX - ratio * (pointX - anchorX - currentPan.x),
        y: pointY - anchorY - ratio * (pointY - anchorY - currentPan.y),
      })
    }

    zoomRef.current = nextZoom
    setZoom(nextZoom)
  }

  function resetCanvasView() {
    zoomRef.current = 100
    setZoom(100)
    updatePan({ x: 0, y: 0 })
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !data) return

    function handleWheel(event: WheelEvent) {
      event.preventDefault()
      const zoomDelta = Math.max(-ZOOM_STEP, Math.min(ZOOM_STEP, event.deltaY * -0.1))
      updateZoom(
        zoomRef.current + zoomDelta,
        { clientX: event.clientX, clientY: event.clientY },
      )
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [data])

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('a, button, input')) return

    dragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      initialPan: panRef.current,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setIsPanning(true)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    updatePan({
      x: drag.initialPan.x + event.clientX - drag.start.x,
      y: drag.initialPan.y + event.clientY - drag.start.y,
    })
  }

  function finishPanning(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setIsPanning(false)
  }

  function handleLostPointerCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setIsPanning(false)
  }

  const searching = search.trim().length > 0
  const roots = useMemo(() => {
    const all = data?.roots ?? []
    return searching ? filterTree(all, normalized(search.trim())) : all
  }, [data?.roots, search, searching])

  // Ninguém com líder direto: a árvore vira uma fileira só. Melhor dizer isso do
  // que deixar parecer bug. No recorte do meu time a raiz é sempre uma só, então
  // a fileira nunca acontece.
  const hierarchyMissing = Boolean(
    !myTeam && data && data.totalPeople > 1 && data.roots.length === data.totalPeople,
  )
  // Sem liderado direto a API devolve nada — e aí a tela explica em vez de
  // mostrar um canvas vazio.
  const noDirectReports = myTeam && data?.roots.length === 0
  const directReports = myTeam ? Math.max(data ? data.totalPeople - 1 : 0, 0) : 0

  function expandAll() {
    setCollapsedIds(new Set())
  }

  function collapseAll() {
    if (!data) return
    setCollapsedIds(collectIdsWithReports(data.roots, new Set<string>()))
  }

  function toggleNode(id: string) {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="flex h-[calc(100dvh-4.5rem)] min-h-[42rem] w-full flex-col p-lg md:p-xl">
      <header className="mb-lg">
        <div className="mb-xs flex items-center gap-sm text-primary">
          <Icon name="account_tree" className="text-[24px]" />
          <span className="font-label text-label-sm font-bold uppercase tracking-[0.18em]">
            {myTeam ? 'Liderança' : 'Estrutura da empresa'}
          </span>
        </div>
        <h1 className="font-headline text-headline-xl text-on-surface">
          {myTeam ? 'Organograma do meu time' : 'Organograma'}
        </h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          {myTeam
            ? directReports > 0
              ? `${directReports} ${directReports === 1 ? 'pessoa responde' : 'pessoas respondem'} diretamente a você.`
              : 'Quem responde diretamente a você.'
            : data
              ? `${data.company.name} · ${data.totalPeople} ${data.totalPeople === 1 ? 'pessoa' : 'pessoas'}, de quem lidera a quem constrói.`
              : 'Conheça quem lidera quem na empresa.'}
        </p>
        {myTeam && (
          <div className="mt-sm flex flex-wrap items-center gap-md">
            <Link
              to="/lideranca"
              className="flex items-center gap-xs font-label text-label-sm text-primary hover:underline"
            >
              <Icon name="arrow_back" className="text-[18px]" />
              Voltar para Liderança
            </Link>
            {canSeeWholeCompany && (
              <Link
                to="/time"
                className="flex items-center gap-xs font-label text-label-sm text-primary hover:underline"
              >
                <Icon name="account_tree" className="text-[18px]" />
                Ver a empresa inteira
              </Link>
            )}
          </div>
        )}
      </header>

      {isLoading && <OrganizationSkeleton />}

      {isError && (
        <div role="alert" className="flex flex-wrap items-center gap-sm rounded-lg border border-error/40 bg-error-container/20 p-lg text-on-error-container">
          <Icon name="error" className="text-[20px]" />
          <span className="flex-1">Erro ao carregar o organograma.</span>
          <button type="button" onClick={() => refetch()} className="rounded-md border border-error/50 px-md py-sm font-label font-bold hover:bg-error/10">
            Tentar novamente
          </button>
        </div>
      )}

      {!isLoading && !isError && noDirectReports && (
        <div className="mx-auto max-w-md rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-lowest p-xl text-center">
          <Icon name="groups" className="text-[36px] text-on-surface-variant" />
          <h2 className="mt-sm font-headline text-title-md text-on-surface">Ninguém responde diretamente a você</h2>
          <p className="mt-xs text-body-sm text-on-surface-variant">
            {canSeeWholeCompany
              ? 'O líder direto de cada pessoa é definido em Administração › Organização › Lendas.'
              : 'Quando alguém for cadastrado como seu liderado direto, o time aparece aqui.'}
          </p>
        </div>
      )}

      {!isLoading && !isError && data && !noDirectReports && (
        <div
          ref={viewportRef}
          data-testid="organization-viewport"
          data-pan-x={Math.round(pan.x)}
          data-pan-y={Math.round(pan.y)}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPanning}
          onPointerCancel={finishPanning}
          onLostPointerCapture={handleLostPointerCapture}
          role="region"
          aria-label="Canvas interativo do organograma"
          className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest ${
            isPanning ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          style={{
            backgroundImage: 'radial-gradient(circle, rgb(128 128 128 / 18%) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        >
          <div className="absolute left-sm right-sm top-sm z-30 flex flex-col gap-sm rounded-xl border border-outline-variant/40 bg-surface-container/90 p-sm shadow-lg backdrop-blur-md md:flex-row md:items-center">
            <label className="flex min-w-0 flex-1 items-center gap-sm rounded-lg border border-outline-variant/50 bg-surface-container-low px-md py-sm focus-within:border-primary">
              <Icon name="search" className="text-[20px] text-on-surface-variant" />
              <span className="sr-only">Buscar no organograma</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar pessoa, cargo ou setor…"
                className="min-w-0 flex-1 bg-transparent text-body-md text-on-surface outline-none placeholder:text-on-surface-variant"
              />
              {search && (
                <button
                  type="button"
                  aria-label="Limpar busca"
                  onClick={() => setSearch('')}
                  className="rounded-full p-1 text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
                >
                  <Icon name="close" className="text-[18px]" />
                </button>
              )}
            </label>

            <div className="flex flex-wrap items-center gap-xs">
              {/* Um nível só não tem o que expandir: no meu time os botões seriam
                  dois cliques que não mudam nada na tela. */}
              {!myTeam && (
                <>
                  <button type="button" onClick={expandAll} className="rounded-md px-sm py-2 font-label text-label-sm text-primary hover:bg-primary/10">
                    Expandir tudo
                  </button>
                  <button type="button" onClick={collapseAll} className="rounded-md px-sm py-2 font-label text-label-sm text-primary hover:bg-primary/10">
                    Recolher tudo
                  </button>
                </>
              )}
              <span className="mx-xs hidden h-6 w-px bg-outline-variant/50 md:block" aria-hidden />
              <div className="hidden items-center gap-xs md:flex" aria-label="Controles de zoom">
                <button
                  type="button"
                  aria-label="Diminuir zoom"
                  disabled={zoom === MIN_ZOOM}
                  onClick={() => updateZoom(zoomRef.current - ZOOM_STEP)}
                  className="rounded-md p-2 text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-30"
                >
                  <Icon name="remove" className="text-[18px]" />
                </button>
                <button
                  type="button"
                  aria-label="Redefinir visualização"
                  onClick={resetCanvasView}
                  className="min-w-14 rounded-md px-2 py-2 font-label text-label-sm text-on-surface hover:bg-surface-container-highest"
                >
                  {Math.round(zoom)}%
                </button>
                <button
                  type="button"
                  aria-label="Aumentar zoom"
                  disabled={zoom === MAX_ZOOM}
                  onClick={() => updateZoom(zoomRef.current + ZOOM_STEP)}
                  className="rounded-md p-2 text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-30"
                >
                  <Icon name="add" className="text-[18px]" />
                </button>
              </div>
              {!isAdministrative && (
                <Link
                  to="/votar"
                  className="flex items-center gap-xs rounded-md bg-primary px-md py-2 font-label text-label-sm font-bold text-on-primary shadow-sm transition-all hover:bg-primary-container hover:text-on-primary-container active:scale-[0.98]"
                >
                  <Icon name="how_to_vote" className="text-[18px]" />
                  Votar no Destaque
                </Link>
              )}
            </div>
          </div>

          {hierarchyMissing && !searching && (
            <div className="pointer-events-none absolute left-1/2 top-32 z-20 w-max max-w-[90%] -translate-x-1/2 rounded-lg border border-outline-variant/40 bg-surface-container/90 px-md py-sm text-center text-body-sm text-on-surface-variant shadow-md backdrop-blur">
              Ninguém tem líder direto definido ainda, então todo mundo aparece no mesmo nível.
              {isAdministrative && ' Defina em Administração › Organização › Lendas.'}
            </div>
          )}

          <div className="pointer-events-none absolute bottom-sm left-1/2 z-20 hidden -translate-x-1/2 items-center gap-md rounded-full border border-outline-variant/40 bg-surface-container/90 px-md py-xs text-label-sm text-on-surface-variant shadow-md backdrop-blur md:flex">
            <span className="flex items-center gap-xs">
              <Icon name="pan_tool" className="text-[16px]" />
              Arraste para mover
            </span>
            <span className="h-4 w-px bg-outline-variant/50" aria-hidden />
            <span className="flex items-center gap-xs">
              <Icon name="mouse" className="text-[16px]" />
              Roda do mouse para zoom
            </span>
          </div>

          <div ref={canvasAnchorRef} className="absolute left-1/2 top-40 md:top-28">
            <div style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0)` }}>
              <div className="w-max -translate-x-1/2">
                <div
                  data-testid="organization-canvas"
                  data-zoom={zoom}
                  data-people={countNodes(roots)}
                  className="w-max min-w-[20rem] origin-top"
                  style={{ transform: `scale(${zoom / 100})` }}
                >
                  {roots.length > 0 ? (
                    <div className="flex items-start justify-center gap-lg">
                      {roots.map((root) => (
                        <TreeNode
                          key={root.id}
                          node={root}
                          collapsedIds={collapsedIds}
                          forceExpanded={searching}
                          onToggle={toggleNode}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="mx-auto max-w-md rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-lowest p-xl text-center">
                      <Icon name="search_off" className="text-[36px] text-on-surface-variant" />
                      <h2 className="mt-sm font-headline text-title-md text-on-surface">Nenhum resultado encontrado</h2>
                      <p className="mt-xs text-body-sm text-on-surface-variant">Tente buscar por outro nome, cargo ou setor.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
