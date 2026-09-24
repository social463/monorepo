import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Icon } from '../../../components/Icon'
import { GuiaGlobalSearch } from './components/GuiaGlobalSearch'
import { GUIA_BASE } from './content/search'
import { cx } from './lib/cx'

interface GuiaSection {
  to: string
  label: string
  end?: boolean
}

interface GuiaGroup {
  title: string
  sections: GuiaSection[]
}

/**
 * As 11 seções do guia em três grupos. A ordem aqui é a da leitura sugerida —
 * entender (Fundamentos), aplicar (Mão na massa), governar (Governança) — e
 * não a ordem em que as telas foram escritas.
 */
const GROUPS: GuiaGroup[] = [
  {
    title: 'Fundamentos',
    sections: [
      { to: '.', label: 'Início', end: true },
      { to: 'bussola', label: 'Bússola' },
      { to: 'maturidade', label: 'Maturidade' },
    ],
  },
  {
    title: 'Mão na massa',
    sections: [
      { to: 'na-pratica', label: 'Na prática' },
      { to: 'situacoes', label: 'Situações' },
      { to: 'prompts', label: 'Prompts' },
      { to: 'videos', label: 'Vídeos' },
      { to: 'cases', label: 'Casos' },
    ],
  },
  {
    title: 'Governança',
    sections: [
      { to: 'seguranca', label: 'Segurança' },
      { to: 'lideranca', label: 'Liderança' },
      { to: 'completo', label: 'Guia completo' },
    ],
  },
]

const ALL_SECTIONS = GROUPS.flatMap((group) => group.sections)

const itemCls = ({ isActive }: { isActive: boolean }) =>
  cx(
    'block border-l-2 py-xs pl-md pr-sm font-label text-label-md transition-colors',
    isActive
      ? 'border-primary bg-primary/10 font-bold text-primary'
      : 'border-transparent text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
  )

/** Colunas do rodapé — os mesmos destinos do menu, agrupados pelo que a pessoa quer fazer. */
const FOOTER_COLUMNS = [
  {
    title: 'Decidir',
    links: [
      { to: `${GUIA_BASE}/bussola`, label: 'Bússola de Decisão' },
      { to: `${GUIA_BASE}/situacoes`, label: 'Situações do dia a dia' },
      { to: `${GUIA_BASE}/seguranca`, label: 'Segurança e limites' },
    ],
  },
  {
    title: 'Praticar',
    links: [
      { to: `${GUIA_BASE}/cases`, label: 'AI First na INOVA' },
      { to: `${GUIA_BASE}/prompts`, label: 'Prompt Lab' },
      { to: `${GUIA_BASE}/maturidade`, label: 'Autodiagnóstico' },
    ],
  },
  {
    title: 'Compartilhar',
    links: [
      { to: `${GUIA_BASE}/videos`, label: 'Vídeos' },
      { to: `${GUIA_BASE}/lideranca`, label: 'Liderança AI First' },
      { to: `${GUIA_BASE}/completo`, label: 'Guia completo' },
    ],
  },
] as const

// Só a dica visual muda: o atalho aceita Cmd e Ctrl nos dois sistemas.
const SHORTCUT_HINT =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'

/** Rótulo da seção aberta, para o botão do menu no mobile. */
function currentLabel(pathname: string): string {
  const rest = pathname.split('/comunidade-inova/guia')[1]?.replace(/^\/+|\/+$/g, '') ?? ''
  return ALL_SECTIONS.find((section) => section.to === rest)?.label ?? 'Início'
}

/**
 * Sub-navegação do Guia AI First, dentro de `/comunidade-inova/guia`. A trava
 * de módulo/empresa já aconteceu no `InovaLayout` pai — aqui é só o conteúdo.
 *
 * São 11 seções: em pílulas na horizontal elas quebravam em duas linhas e
 * viravam uma lista sem hierarquia, então o terceiro nível é um menu lateral
 * agrupado. No mobile o mesmo menu recolhe atrás de um botão — a MESMA
 * marcação, e não uma segunda cópia dos links, para cada seção não aparecer
 * duas vezes na árvore de acessibilidade.
 */
export function InovaGuiaLayout() {
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const closeSearch = useCallback(() => setSearchOpen(false), [])

  // No mobile o menu cobre o conteúdo; navegar tem de fechá-lo.
  useEffect(() => setMenuOpen(false), [pathname])

  // Cmd/Ctrl+K abre a busca de qualquer tela do guia. O atalho só existe
  // enquanto o guia está montado — fora dele o Ctrl+K volta a ser do navegador.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center justify-end gap-sm">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-keyshortcuts="Meta+K Control+K"
          className="inline-flex min-h-9 items-center gap-xs rounded-full border border-outline-variant/60 px-md font-label text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-on-surface"
        >
          <Icon name="search" className="text-[18px]" />
          Buscar no guia
          <kbd className="hidden rounded border border-outline-variant/60 px-xs font-sans text-[11px] text-on-surface-variant sm:inline">
            {SHORTCUT_HINT}
          </kbd>
        </button>
        {/* Case do guia é projeto da comunidade: registra-se no mesmo
            formulário, e não num formulário externo como no site original. */}
        <Link
          to="/comunidade-inova/novo"
          className="inline-flex min-h-9 items-center rounded-full bg-primary px-md font-label text-label-md font-bold text-on-primary transition-opacity hover:opacity-90"
        >
          Registrar um case
        </Link>
      </div>

      <div className="flex flex-col gap-lg md:flex-row md:gap-xl">
        <aside className="shrink-0 md:sticky md:top-lg md:w-56 md:self-start md:border-r md:border-outline-variant/40 md:pr-lg">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            className="flex w-full items-center justify-between rounded-md border border-outline-variant/40 px-md py-sm font-label text-label-md font-bold text-on-surface md:hidden"
          >
            Seções do guia · {currentLabel(pathname)}
            <span aria-hidden="true">{menuOpen ? '▲' : '▼'}</span>
          </button>

          <nav
            aria-label="Seções do Guia AI First"
            className={cx('flex-col gap-lg md:flex', menuOpen ? 'flex pt-md md:pt-0' : 'hidden')}
          >
            {GROUPS.map((group) => (
              <div key={group.title} className="flex flex-col gap-xs">
                <p className="px-md font-label text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface-variant">
                  {group.title}
                </p>
                {group.sections.map((section) => (
                  <NavLink key={section.label} to={section.to} end={section.end} className={itemCls}>
                    {section.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>

      <footer className="mt-xl border-t border-outline-variant/40 pt-lg">
        <div className="grid gap-lg md:grid-cols-[1.2fr_2fr]">
          <div>
            <p className="font-label text-label-md font-bold uppercase tracking-wide text-on-surface">Guia AI First</p>
            <p className="mt-sm max-w-xs text-body-sm text-on-surface-variant">
              Bússola AI First · Uma iniciativa de Cultura e Pessoas para transformar orientação em prática.
            </p>
          </div>
          <div className="grid gap-lg sm:grid-cols-3">
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.title}>
                <p className="font-label text-label-sm font-bold uppercase tracking-wide text-primary">{column.title}</p>
                <ul className="mt-sm space-y-xs">
                  {column.links.map((link) => (
                    <li key={link.to}>
                      <Link to={link.to} className="text-body-sm text-on-surface-variant hover:text-on-surface">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-lg flex flex-col gap-xs border-t border-outline-variant/40 pt-md text-body-sm text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
          <p>Dúvidas sobre a rotina: liderança ou Gente &amp; Gestão. Ferramentas e dados: Tecnologia/Engenharia.</p>
          <p>Suas preferências ficam apenas neste navegador.</p>
        </div>
      </footer>

      <GuiaGlobalSearch open={searchOpen} onClose={closeSearch} />
    </div>
  )
}
