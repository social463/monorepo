import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { BrandName, BrandTagline } from './BrandLogo'
import type { NavGroup } from './nav-items'

interface MobileNavProps {
  groups: NavGroup[]
  activeTo: string
  votingOpen: boolean
  isAdmin: boolean
  onLogout: () => void
}

/**
 * Navegação mobile (< md) em forma de menu hamburguer: um botão no header
 * abre um drawer lateral com os itens de navegação. No desktop/tablet fica
 * oculto (a sidebar assume). Espelha os grupos de `buildNavGroups`, com o
 * mesmo acordeão da sidebar.
 */
export function MobileNav({ groups, activeTo, votingOpen, isAdmin, onLogout }: MobileNavProps) {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  // Acordeão: só o grupo da rota atual aberto; navegar para outro grupo o abre.
  const activeGroup =
    groups.find((group) => group.label && group.items.some((item) => item.to === activeTo))?.label ??
    null
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroup)
  const lastActiveGroup = useRef(activeGroup)
  useEffect(() => {
    if (activeGroup && activeGroup !== lastActiveGroup.current) setOpenGroup(activeGroup)
    lastActiveGroup.current = activeGroup
  }, [activeGroup])

  // Fecha o drawer ao trocar de rota.
  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  // Fecha com Escape e trava o scroll do body enquanto aberto.
  useEffect(() => {
    if (!open) return
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Abrir menu de navegação"
        className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        <Icon name="menu" className="text-[26px]" />
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[60] md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          {/* Drawer */}
          <div
            role="dialog"
            aria-label="Menu de navegação"
            aria-modal="true"
            className="absolute left-0 top-0 flex h-full w-72 max-w-[80vw] flex-col border-r border-outline-variant/40 bg-surface-container-lowest py-lg shadow-2xl"
          >
            <div className="mb-lg flex items-center justify-between px-lg">
              <div>
                <h2 className="font-headline text-headline-md font-bold tracking-tight text-primary">
                  <BrandName />
                </h2>
                <BrandTagline className="mt-0.5 font-label text-[10px] uppercase tracking-[0.2em] text-on-surface-variant" />
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
                className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
              >
                <Icon name="close" className="text-[24px]" />
              </button>
            </div>

            <nav
              aria-label="Navegação principal"
              className="flex flex-1 flex-col gap-1 overflow-y-auto px-sm"
            >
              {groups.map((group, groupIndex) => {
                const groupOpen = !group.label || openGroup === group.label

                return (
                  <div key={group.label ?? `topo-${groupIndex}`} className="contents">
                    {group.label && (
                      <button
                        type="button"
                        onClick={() =>
                          setOpenGroup((current) => (current === group.label ? null : group.label!))
                        }
                        aria-expanded={groupOpen}
                        className="mt-md flex items-center justify-between rounded-md px-md py-1 font-label text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface-variant transition-colors hover:text-on-surface"
                      >
                        {group.label}
                        <Icon
                          name="expand_more"
                          className={`text-[18px] transition-transform ${groupOpen ? '' : '-rotate-90'}`}
                        />
                      </button>
                    )}

                    {groupOpen &&
                      group.items.map((item) => {
                        const isActive = item.to === activeTo
                        const rowClass = [
                          'flex items-center gap-md rounded-md px-md py-sm font-label text-label-md transition-colors',
                          isActive
                            ? 'bg-primary/10 font-bold text-primary'
                            : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
                        ].join(' ')

                        // Rota interna em aba própria (Escritório): alvo
                        // nomeado, então clicar de novo volta para a aba que já
                        // existe em vez de abrir outra sessão.
                        if (item.newTab) {
                          return (
                            <a
                              key={item.to}
                              href={item.to}
                              target="legends-escritorio"
                              onClick={() => setOpen(false)}
                              className={rowClass}
                            >
                              <Icon name={item.icon} className="text-[26px]" />
                              <span>{item.label}</span>
                            </a>
                          )
                        }

                        // Item externo (ImpulseUP) abre em nova aba, sem opener.
                        if (item.external) {
                          return (
                            <a
                              key={item.to}
                              href={item.to}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => setOpen(false)}
                              className={rowClass}
                            >
                              <Icon name={item.icon} className="text-[26px]" />
                              <span>{item.label}</span>
                            </a>
                          )
                        }

                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            aria-current={isActive ? 'page' : undefined}
                            className={rowClass}
                          >
                            <Icon name={item.icon} filled={isActive} className="text-[26px]" />
                            <span>{item.label}</span>
                            {item.showOpenBadge && votingOpen && (
                              <span className="ml-auto flex items-center gap-1 rounded-full bg-primary/15 py-0.5 pl-1.5 pr-2 font-label text-[10px] font-bold uppercase tracking-wide text-primary">
                                <span className="relative flex h-2 w-2">
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                                </span>
                                Aberta
                              </span>
                            )}
                          </Link>
                        )
                      })}
                  </div>
                )
              })}
            </nav>

            <div className="mt-auto px-sm pt-md">
              {!isAdmin && votingOpen && (
                <button
                  type="button"
                  onClick={() => navigate('/votar')}
                  className="mb-md flex w-full items-center justify-center gap-sm rounded-md bg-primary py-md font-label text-label-md font-bold text-on-primary transition-all hover:bg-primary-container hover:text-on-primary-container active:scale-[0.98]"
                >
                  <Icon name="add" className="text-[20px]" />
                  <span>Votar no Destaque</span>
                </button>
              )}
              <div className="border-t border-outline-variant/40 pt-md">
                <button
                  type="button"
                  onClick={onLogout}
                  className="flex w-full items-center gap-md rounded-md px-md py-sm text-body-sm text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
                >
                  <Icon name="logout" className="text-[20px]" />
                  <span>Sair</span>
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
