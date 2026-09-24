import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  INOVA_PHASE_POINTS,
  INOVA_PROJECT_PHASES,
  canAdminister,
  canManageInovaProject,
  inovaCategoryIcon,
  inovaProjectOwnershipOf,
  type InovaProjectDTO,
  type InovaProjectPhase,
} from '@legends/shared'
import { Avatar } from '../components/Avatar'
import { Icon } from '../components/Icon'
import { inovaPlainText } from '../components/inova/InovaRichText'
import { useAuth } from '../auth/AuthContext'
import { listInovaProjects, updateInovaProject } from '../lib/inova-api'

/**
 * Comunidade INOVA — kanban de projetos (aba "Projetos" de `InovaLayout`).
 * Ver docs/superpowers/specs/2026-09-04-comunidade-inova-experiencia-completa-design.md.
 *
 * Visual segue o projeto original (Lovable): cartão com faixa esquerda e fundo em
 * degradê que ficam mais "cheios" conforme a fase avança, prioridade em vermelho
 * (papel `error`) e colunas do kanban sem moldura — só cabeçalho + cartões soltos.
 */
const PHASE_VISUALS: Record<InovaProjectPhase, { border: string; bg: string; dot: string; dark?: boolean }> = {
  IDEA: { border: 'border-l-primary/30', bg: 'bg-primary/5', dot: 'bg-primary/50' },
  EXPLORING_SOLUTION: { border: 'border-l-primary/50', bg: 'bg-primary/10', dot: 'bg-primary/70' },
  TESTING_SOLUTION: { border: 'border-l-primary/70', bg: 'bg-primary/20', dot: 'bg-primary' },
  ROUTINE_USE: { border: 'border-l-primary', bg: 'bg-primary/35', dot: 'bg-primary' },
  EXPANDING: { border: 'border-l-primary', bg: 'bg-primary/80', dot: 'bg-on-primary', dark: true },
  COMPLETED: { border: 'border-l-primary', bg: 'bg-primary', dot: 'bg-on-primary', dark: true },
}

const PODIUM_STYLES = [
  {
    width: 'sm:w-56',
    minH: 'min-h-[220px]',
    bg: 'bg-primary-container',
    text: 'text-on-primary-container',
    barTrack: 'bg-on-primary-container/15',
    bar: 'bg-on-primary-container',
    medalSize: 'text-[32px]',
  },
  {
    width: 'sm:w-48',
    minH: 'min-h-[190px]',
    bg: 'bg-surface-container-high',
    text: 'text-on-surface',
    barTrack: 'bg-surface-container-highest',
    bar: 'bg-on-surface-variant',
    medalSize: 'text-[24px]',
  },
  {
    width: 'sm:w-44',
    minH: 'min-h-[170px]',
    bg: 'bg-tertiary-container',
    text: 'text-on-tertiary-container',
    barTrack: 'bg-on-tertiary-container/15',
    bar: 'bg-on-tertiary-container',
    medalSize: 'text-[24px]',
  },
]

/** Valor de "sem recorte" nos selects — mesmo sentinela do app original. */
const TODOS = 'all'

const FILTRO_PREFIXO = 'comunidade-inova:'

function lerFiltro(chave: string, padrao: string): string {
  try {
    return sessionStorage.getItem(`${FILTRO_PREFIXO}${chave}`) ?? padrao
  } catch {
    return padrao
  }
}

function gravarFiltro(chave: string, valor: string): void {
  try {
    sessionStorage.setItem(`${FILTRO_PREFIXO}${chave}`, valor)
  } catch {
    // Aba anônima ou storage bloqueado: o filtro só não sobrevive à navegação.
  }
}

/**
 * Filtro do kanban guardado na sessão. O caminho mais comum daqui é abrir um
 * projeto e voltar — sem isso, quem recorta por setor refaz o recorte a cada
 * ida e volta. É `session`, e não `local`, de propósito: recorte é do momento,
 * não preferência que deva atravessar dias.
 */
function useFiltroDeSessao(chave: string, padrao = TODOS): [string, (valor: string) => void] {
  const [valor, setValor] = useState(() => lerFiltro(chave, padrao))
  const definir = useCallback(
    (novo: string) => {
      setValor(novo)
      gravarFiltro(chave, novo)
    },
    [chave],
  )
  return [valor, definir]
}

function useAlternadorDeSessao(chave: string): [boolean, (valor: boolean) => void] {
  const [valor, definir] = useFiltroDeSessao(chave, 'false')
  const alternar = useCallback((novo: boolean) => definir(String(novo)), [definir])
  return [valor === 'true', alternar]
}

/**
 * Opções de um select derivadas dos projetos carregados — e não de uma lista
 * fixa: setor e categoria são texto livre no backend, então uma constante
 * esconderia o valor que alguém digitou fora do catálogo. O valor selecionado
 * entra mesmo que não apareça na lista atual (acontece ao alternar
 * "Ver arquivados"), senão o select ficaria em branco filtrando por algo.
 */
function opcoesDe(valores: (string | null | undefined)[], selecionado: string): string[] {
  const unicos = [...new Set(valores.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  return selecionado !== TODOS && !unicos.includes(selecionado) ? [...unicos, selecionado] : unicos
}

/**
 * Trilho horizontal do kanban com setas ←/→, como no INOVA original: seis
 * colunas não cabem na tela, e quem usa mouse sem rolagem lateral não
 * descobria que havia "Usando na Rotina" e "Concluído" mais à direita.
 */
function KanbanScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      setCanLeft(el.scrollLeft > 4)
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  const scrollBy = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * 340, behavior: 'smooth' })
  const arrow =
    'absolute top-[120px] z-10 hidden h-11 w-11 items-center justify-center rounded-full border border-outline-variant/60 bg-surface-container-high text-on-surface shadow-lg hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-30 md:flex'

  return (
    <div className="relative">
      <div ref={ref} className="-mx-lg flex gap-lg overflow-x-auto scroll-smooth px-lg pb-sm md:mx-0 md:px-14">
        {children}
      </div>
      <button type="button" onClick={() => scrollBy(-1)} disabled={!canLeft} aria-label="Rolar para a esquerda" className={`${arrow} left-0`}>
        <Icon name="chevron_left" className="text-[22px]" />
      </button>
      <button type="button" onClick={() => scrollBy(1)} disabled={!canRight} aria-label="Rolar para a direita" className={`${arrow} right-0`}>
        <Icon name="chevron_right" className="text-[22px]" />
      </button>
    </div>
  )
}

export function ComunidadeInovaPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [soPrioridade, setSoPrioridade] = useAlternadorDeSessao('prioridade')
  const [verArquivados, setVerArquivados] = useAlternadorDeSessao('arquivados')
  const [filtroSetor, setFiltroSetor] = useFiltroDeSessao('setor')
  const [filtroCategoria, setFiltroCategoria] = useFiltroDeSessao('categoria')
  const [filtroFase, setFiltroFase] = useFiltroDeSessao('fase')
  const [filtroResponsavel, setFiltroResponsavel] = useFiltroDeSessao('responsavel')
  const [filtroLideranca, setFiltroLideranca] = useFiltroDeSessao('lideranca')
  const [mostrarFiltros, setMostrarFiltros] = useState(
    () =>
      lerFiltro('setor', TODOS) !== TODOS ||
      lerFiltro('categoria', TODOS) !== TODOS ||
      lerFiltro('fase', TODOS) !== TODOS ||
      lerFiltro('responsavel', TODOS) !== TODOS ||
      lerFiltro('lideranca', TODOS) !== TODOS,
  )
  const [error, setError] = useState<string | null>(null)
  const { data, isPending, isError } = useQuery({
    queryKey: ['inova', 'projects', verArquivados],
    queryFn: () => listInovaProjects({ archived: verArquivados }),
  })
  const { data: rankingData } = useQuery({
    queryKey: ['inova', 'projects', 'ranking'],
    queryFn: () => listInovaProjects({ archived: false }),
  })
  // Curadoria do programa: destacar como prioridade é de quem administra.
  // Cadastrar projeto, não — é de qualquer colaborador.
  const podeCurar = user ? canAdminister(user) : false

  const togglePrioridade = useMutation({
    mutationFn: (project: InovaProjectDTO) => updateInovaProject(project.id, { priority: !project.priority }),
    onSuccess: () => {
      setError(null)
      qc.invalidateQueries({ queryKey: ['inova', 'projects'] })
    },
    onError: () => setError('Não foi possível atualizar a prioridade.'),
  })

  const projetos = useMemo(() => {
    return (data?.projects ?? []).filter((p) => {
      if (soPrioridade && !p.priority) return false
      if (filtroSetor !== TODOS && p.sector !== filtroSetor) return false
      if (filtroCategoria !== TODOS && p.category !== filtroCategoria) return false
      if (filtroFase !== TODOS && p.phase !== filtroFase) return false
      if (
        filtroResponsavel !== TODOS &&
        p.responsible1?.id !== filtroResponsavel &&
        p.responsible2?.id !== filtroResponsavel
      ) {
        return false
      }
      if (filtroLideranca === 'sim' && !p.leadershipChallenge) return false
      if (filtroLideranca === 'nao' && p.leadershipChallenge) return false
      return true
    })
  }, [data, soPrioridade, filtroSetor, filtroCategoria, filtroFase, filtroResponsavel, filtroLideranca])

  const carregados = useMemo(() => data?.projects ?? [], [data])

  const responsaveis = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const p of carregados) {
      if (p.responsible1) mapa.set(p.responsible1.id, p.responsible1.name)
      if (p.responsible2) mapa.set(p.responsible2.id, p.responsible2.name)
    }
    return [...mapa.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [carregados])

  const selecoes = [filtroSetor, filtroCategoria, filtroFase, filtroResponsavel, filtroLideranca]
  const filtrosAtivos = selecoes.filter((v) => v !== TODOS).length
  const temRecorte = filtrosAtivos > 0 || soPrioridade || verArquivados

  const limparFiltros = () => {
    setFiltroSetor(TODOS)
    setFiltroCategoria(TODOS)
    setFiltroFase(TODOS)
    setFiltroResponsavel(TODOS)
    setFiltroLideranca(TODOS)
    setSoPrioridade(false)
    setVerArquivados(false)
  }

  const evolucaoAreas = useMemo(() => {
    const mapa = new Map<string, { pontos: number; contagem: number }>()
    for (const p of rankingData?.projects ?? []) {
      if (p.archived) continue
      const atual = mapa.get(p.sector) ?? { pontos: 0, contagem: 0 }
      atual.pontos += INOVA_PHASE_POINTS[p.phase]
      atual.contagem += 1
      mapa.set(p.sector, atual)
    }
    return [...mapa.entries()].map(([sector, v]) => ({ sector, ...v })).sort((a, b) => b.pontos - a.pontos)
  }, [rankingData])

  if (isError) {
    return <p className="p-lg text-body-md text-error">Não foi possível carregar os projetos.</p>
  }

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex items-center justify-between gap-md">
        <div>
          <p className="font-label text-label-md uppercase tracking-[0.2em] text-primary">Comunidade INOVA</p>
          <h1 className="mt-2 font-headline text-headline-lg text-on-surface">Projetos de inovação</h1>
        </div>
        {/* Cadastrar é de qualquer colaborador — sem gate. */}
        <Link
          to="/comunidade-inova/novo"
          className="inline-flex items-center gap-sm rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
        >
          <Icon name="add" className="text-[18px]" />
          Novo projeto
        </Link>
      </header>

      {error && <p className="text-body-sm text-error">{error}</p>}

      {evolucaoAreas.length > 0 && (
        <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/70 p-md backdrop-blur-sm md:p-lg">
          <div className="flex items-center justify-between gap-md">
            <div className="flex items-center gap-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15">
                <Icon name="emoji_events" className="text-primary" />
              </div>
              <div>
                <h2 className="font-headline text-headline-sm text-on-surface">Evolução das Áreas</h2>
                <p className="text-body-sm text-on-surface-variant">Impacto gerado por cada setor na jornada de inovação</p>
              </div>
            </div>
            <Link
              to="/comunidade-inova/ranking"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-container px-md py-1 font-label text-label-sm text-on-surface-variant hover:bg-primary/10 hover:text-primary"
            >
              <Icon name="help" className="text-[16px]" />
              Como funciona?
            </Link>
          </div>

          {(() => {
            const maxPontos = evolucaoAreas[0]?.pontos || 1
            const top3 = evolucaoAreas.slice(0, 3)
            const resto = evolucaoAreas.slice(3)
            const medalha = ['🥇', '🥈', '🥉']
            const cardOrder = top3.length === 3 ? [1, 0, 2] : top3.map((_, i) => i)
            return (
              <>
                <div className="mt-lg flex flex-col items-center gap-sm sm:flex-row sm:items-end sm:justify-center sm:gap-md">
                  {cardOrder.map((idx) => {
                    const area = top3[idx]
                    if (!area) return null
                    const style = PODIUM_STYLES[idx]
                    const percentual = Math.round((area.pontos / maxPontos) * 100)
                    return (
                      <div
                        key={area.sector}
                        className={`flex w-full flex-col items-center justify-between rounded-2xl p-md text-center ${style.width} ${style.minH} ${style.bg}`}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <span className={style.medalSize}>{medalha[idx]}</span>
                          <span className={`font-label text-[10px] font-bold ${style.text}`}>{idx + 1}º lugar</span>
                        </div>
                        <p className={`mt-sm h-[56px] line-clamp-2 font-headline text-headline-sm font-bold ${style.text}`}>{area.sector}</p>
                        <p className={`mt-1 font-mono text-headline-md font-black ${style.text}`}>{area.pontos} pts</p>
                        <div className="mt-sm w-full space-y-1">
                          <div className={`flex items-center justify-center gap-1 text-label-sm opacity-70 ${style.text}`}>
                            <span>{area.contagem} {area.contagem === 1 ? 'projeto' : 'projetos'}</span>
                            <span>·</span>
                            <span className="font-mono">{percentual}%</span>
                          </div>
                          <div className={`h-1.5 w-full overflow-hidden rounded-full ${style.barTrack}`}>
                            <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${percentual}%` }} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {resto.length > 0 && (
                  <ul className="mt-lg flex flex-col gap-1">
                    {resto.map((area, i) => {
                      const percentual = Math.round((area.pontos / maxPontos) * 100)
                      return (
                        <li
                          key={area.sector}
                          className="flex items-center gap-sm rounded-xl px-md py-sm text-body-sm text-on-surface even:bg-surface-container-low"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container-high font-mono text-label-sm font-bold text-on-surface-variant">
                            {i + 4}º
                          </span>
                          <span className="w-40 shrink-0 truncate font-label font-semibold">{area.sector}</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-container-high">
                            <div className="h-full rounded-full bg-primary/40" style={{ width: `${percentual}%` }} />
                          </div>
                          <span className="shrink-0 font-mono text-label-sm text-on-surface-variant">{area.contagem} proj</span>
                          <span className="shrink-0 font-mono text-label-sm font-bold text-primary">{area.pontos} pts</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )
          })()}
        </section>
      )}

      <div className="flex flex-col gap-sm">
        <div className="flex flex-wrap items-center gap-sm">
          <button
            type="button"
            onClick={() => setMostrarFiltros((v) => !v)}
            aria-expanded={mostrarFiltros}
            aria-controls="inova-filtros"
            className={`inline-flex items-center gap-sm rounded-full border px-md py-1 font-label text-label-sm transition-colors ${
              mostrarFiltros || filtrosAtivos > 0
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-outline-variant/60 text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            <Icon name="filter_list" className="text-[16px]" />
            Filtros
            {filtrosAtivos > 0 && (
              <span className="rounded-full bg-primary px-sm font-mono text-[10px] font-bold text-on-primary">
                {filtrosAtivos}
              </span>
            )}
          </button>
          <Link
            to="/comunidade-inova/como-usar"
            className="inline-flex items-center gap-sm rounded-full border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary/60 hover:text-primary"
          >
            <Icon name="menu_book" className="text-[16px]" />
            Aprenda a editar seus projetos aqui
          </Link>
          <button
            type="button"
            onClick={() => setSoPrioridade(!soPrioridade)}
            className={`inline-flex items-center gap-sm rounded-full border px-md py-1 font-label text-label-sm transition-colors ${
              soPrioridade ? 'border-error bg-error text-on-error' : 'border-error/40 text-error hover:bg-error/10'
            }`}
          >
            <Icon name="local_fire_department" className="text-[16px]" />
            {soPrioridade ? 'Mostrando só prioridades' : 'Só prioridades'}
          </button>
          <button
            type="button"
            onClick={() => setVerArquivados(!verArquivados)}
            className={`inline-flex items-center gap-sm rounded-full border px-md py-1 font-label text-label-sm transition-colors ${
              verArquivados
                ? 'border-on-surface-variant bg-on-surface-variant text-surface'
                : 'border-outline-variant/60 text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            <Icon name="archive" className="text-[16px]" />
            {verArquivados ? 'Mostrando arquivados' : 'Ver arquivados'}
          </button>
          {temRecorte && (
            <button
              type="button"
              onClick={limparFiltros}
              className="inline-flex items-center gap-1 rounded-full px-md py-1 font-label text-label-sm text-on-surface-variant hover:bg-surface-container"
            >
              <Icon name="close" className="text-[16px]" />
              Limpar filtros
            </button>
          )}
        </div>

        {mostrarFiltros && (
          <div
            id="inova-filtros"
            className="grid gap-sm rounded-2xl border border-outline-variant/30 bg-surface-container-low/70 p-md sm:grid-cols-2 lg:grid-cols-5"
          >
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-sm text-on-surface-variant">Setor</span>
              <select
                aria-label="Setor"
                value={filtroSetor}
                onChange={(e) => setFiltroSetor(e.target.value)}
                className="rounded-md border border-outline-variant/60 bg-surface px-sm py-xs text-body-sm text-on-surface"
              >
                <option value={TODOS}>Todos os setores</option>
                {opcoesDe(
                  carregados.map((p) => p.sector),
                  filtroSetor,
                ).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-sm text-on-surface-variant">Categoria</span>
              <select
                aria-label="Categoria"
                value={filtroCategoria}
                onChange={(e) => setFiltroCategoria(e.target.value)}
                className="rounded-md border border-outline-variant/60 bg-surface px-sm py-xs text-body-sm text-on-surface"
              >
                <option value={TODOS}>Todas as categorias</option>
                {opcoesDe(
                  carregados.map((p) => p.category),
                  filtroCategoria,
                ).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-sm text-on-surface-variant">Fase</span>
              <select
                aria-label="Fase"
                value={filtroFase}
                onChange={(e) => setFiltroFase(e.target.value)}
                className="rounded-md border border-outline-variant/60 bg-surface px-sm py-xs text-body-sm text-on-surface"
              >
                <option value={TODOS}>Todas as fases</option>
                {INOVA_PROJECT_PHASES.map((fase) => (
                  <option key={fase.value} value={fase.value}>
                    {fase.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-sm text-on-surface-variant">Responsável</span>
              <select
                aria-label="Responsável"
                value={filtroResponsavel}
                onChange={(e) => setFiltroResponsavel(e.target.value)}
                className="rounded-md border border-outline-variant/60 bg-surface px-sm py-xs text-body-sm text-on-surface"
              >
                <option value={TODOS}>Todos os responsáveis</option>
                {responsaveis.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-sm text-on-surface-variant">Desafio Alta Liderança</span>
              <select
                aria-label="Desafio Alta Liderança"
                value={filtroLideranca}
                onChange={(e) => setFiltroLideranca(e.target.value)}
                className="rounded-md border border-outline-variant/60 bg-surface px-sm py-xs text-body-sm text-on-surface"
              >
                <option value={TODOS}>Todos</option>
                <option value="sim">Somente Desafio Alta Liderança</option>
                <option value="nao">Sem Desafio Alta Liderança</option>
              </select>
            </label>
          </div>
        )}
      </div>

      {isPending && <p className="text-body-md text-on-surface-variant">Carregando…</p>}

      {!isPending && temRecorte && projetos.length === 0 && (
        <p className="text-body-md text-on-surface-variant">Nenhum projeto neste filtro.</p>
      )}

      <KanbanScroller>
        {INOVA_PROJECT_PHASES.map((phase) => {
          // Prioritários primeiro dentro da coluna — mesmo critério do filtro
          // "Só prioridade", só que aqui todo mundo continua visível.
          const projetosDaFase = projetos
            .filter((p) => p.phase === phase.value)
            .sort((a, b) => Number(b.priority) - Number(a.priority))
          return (
            <div key={phase.value} className="w-72 shrink-0">
              <div className="mb-sm flex items-center gap-sm">
                <h2 className="font-label text-label-md font-semibold text-on-surface">{phase.label}</h2>
                <span className="rounded-full bg-primary/15 px-sm py-0.5 font-mono text-label-sm text-primary">
                  {projetosDaFase.length}
                </span>
              </div>
              <div className="flex flex-col gap-sm">
                {projetosDaFase.length === 0 && (
                  <div className="rounded-2xl border-2 border-dashed border-outline-variant/40 p-lg text-center">
                    <p className="text-body-sm text-on-surface-variant">Aqui nasce a próxima grande ideia 💡</p>
                  </div>
                )}
                {projetosDaFase.map((project) => {
                  const visual = PHASE_VISUALS[project.phase]
                  const podeEditar = canManageInovaProject(user, inovaProjectOwnershipOf(project))
                  const abrir = () => navigate(`/comunidade-inova/projetos/${project.id}`)
                  return (
                    // O card inteiro abre o projeto, como no original; o título
                    // continua sendo o link de verdade (teclado e leitor de tela).
                    <div
                      key={project.id}
                      onClick={abrir}
                      className={`group cursor-pointer rounded-2xl border-l-4 p-md shadow-sm transition-shadow hover:shadow-md ${visual.border} ${visual.bg} ${
                        project.priority ? 'ring-2 ring-error/50' : 'ring-1 ring-outline-variant/20'
                      } ${visual.dark ? 'text-on-primary' : ''} ${project.archived ? 'opacity-60 grayscale' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-sm">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-sm py-0.5 font-label text-label-sm ${
                            visual.dark ? 'bg-on-primary/15 text-on-primary' : 'bg-primary/10 text-on-surface'
                          }`}
                        >
                          {inovaCategoryIcon(project.category)} {project.category}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          {project.priority &&
                            (podeCurar ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  togglePrioridade.mutate(project)
                                }}
                                aria-pressed
                                aria-label="Remover prioridade"
                                title="Clique para remover prioridade"
                                className="inline-flex items-center gap-1 rounded-full border border-error/40 bg-error/10 px-sm py-0.5 text-error"
                              >
                                <Icon name="local_fire_department" className="text-[14px]" />
                                <span className="font-label text-[10px] font-bold uppercase tracking-wide">Prioridade</span>
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-error/40 bg-error/10 px-sm py-0.5 text-error">
                                <Icon name="local_fire_department" className="text-[14px]" />
                                <span className="font-label text-[10px] font-bold uppercase tracking-wide">Prioridade</span>
                              </span>
                            ))}
                          {podeCurar && !project.priority && (
                            <button
                              type="button"
                              onClick={(e) => {
                                  e.stopPropagation()
                                  togglePrioridade.mutate(project)
                                }}
                              aria-label="Marcar como prioridade"
                              title="Marcar como prioridade"
                              className={`flex h-6 w-6 items-center justify-center rounded-full hover:bg-error/10 hover:text-error ${
                                visual.dark ? 'text-on-primary' : 'text-on-surface-variant'
                              }`}
                            >
                              <Icon name="local_fire_department" className="text-[14px]" />
                            </button>
                          )}
                          {podeEditar && (
                            <Link
                              to={`/comunidade-inova/projetos/${project.id}/editar`}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Editar ${project.title}`}
                              title="Editar projeto"
                              className={`flex h-6 w-6 items-center justify-center rounded-full opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${
                                visual.dark ? 'text-on-primary hover:bg-on-primary/15' : 'text-on-surface-variant hover:bg-primary/10'
                              }`}
                            >
                              <Icon name="edit" className="text-[14px]" />
                            </Link>
                          )}
                        </div>
                      </div>
                      <Link
                        to={`/comunidade-inova/projetos/${project.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-sm block hover:underline"
                      >
                        <p className={`font-label text-label-md font-semibold ${visual.dark ? 'text-on-primary' : 'text-on-surface'}`}>
                          {project.title}
                        </p>
                      </Link>
                      <p
                        className={`mt-1 line-clamp-2 whitespace-pre-line text-body-sm ${
                          visual.dark ? 'text-on-primary' : 'text-on-surface-variant'
                        }`}
                      >
                        {inovaPlainText(project.description)}
                      </p>
                      {project.results && (
                        <p
                          className={`mt-1 line-clamp-1 whitespace-pre-line text-body-sm ${
                            visual.dark ? 'text-on-primary' : 'text-primary'
                          }`}
                        >
                          ✓ {inovaPlainText(project.results)}
                        </p>
                      )}
                      <div
                        className={`mt-sm flex items-center gap-1 text-body-sm ${
                          visual.dark ? 'text-on-primary' : 'text-on-surface-variant'
                        }`}
                      >
                        <Icon name="apartment" className="text-[14px]" />
                        Setor: {project.sector}
                      </div>
                      {(project.responsible1 || project.responsible2) && (
                        <div
                          className={`mt-1 flex items-center gap-1 text-body-sm ${
                            visual.dark ? 'text-on-primary' : 'text-on-surface-variant'
                          }`}
                        >
                          <div className="flex -space-x-1.5">
                            {[project.responsible1, project.responsible2].filter(Boolean).map((responsible) => (
                              <span
                                key={responsible!.id}
                                className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest"
                              >
                                <Avatar user={responsible!} />
                              </span>
                            ))}
                          </div>
                          <span className="truncate">
                            {[project.responsible1, project.responsible2]
                              .filter((r): r is NonNullable<typeof r> => Boolean(r))
                              .map((r) => r.name)
                              .join(', ')}
                          </span>
                        </div>
                      )}
                      <span
                        className={`mt-sm inline-flex items-center gap-1.5 rounded-full border px-sm py-0.5 font-label text-[10px] font-semibold ${
                          visual.dark ? 'border-on-primary/30 bg-on-primary/10 text-on-primary' : 'border-outline-variant/60 bg-surface/70 text-on-surface'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${visual.dot}`} />
                        {phase.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </KanbanScroller>
    </div>
  )
}
