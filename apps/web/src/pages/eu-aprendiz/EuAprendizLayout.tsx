import { NavLink, Outlet } from 'react-router-dom'
import { isApprentice } from '@legends/shared'
import { useAuth } from '../../auth/AuthContext'
import { useBrandContext } from '../../brand/BrandContext'
import { BrandName } from '../../components/BrandLogo'
import { APPRENTICE_PROGRAM_FONT_HREF, APPRENTICE_PROGRAM_LOGOS, APPRENTICE_PROGRAM_STYLES } from './program-theme'
import { useApprenticeFacilitator } from './use-apprentice-facilitator'

const tabCls = ({ isActive }: { isActive: boolean }) =>
  `shrink-0 rounded-lg px-md py-sm font-label text-label-lg font-medium transition-colors ${
    isActive ? 'bg-on-surface text-surface' : 'text-on-surface-variant hover:bg-surface-container'
  }`

/**
 * Sub-navegação da área Eu Aprendiz, no formato do INOVA. O Painel só aparece
 * para o facilitador (Gente e Gestão) — a trava de verdade é a rota na API, esta
 * é só para não oferecer o que a pessoa não pode abrir.
 *
 * A disposição é a das demais áreas — sem moldura, sobre o fundo do app. O que
 * muda são as cores: o contêiner redefine as variáveis da marca com as do
 * programa (ver `program-theme.ts`), no esquema que a pessoa escolheu.
 */
export function EuAprendizLayout() {
  const { user } = useAuth()
  const isFacilitator = useApprenticeFacilitator()
  const { scheme } = useBrandContext()

  return (
    <div
      style={APPRENTICE_PROGRAM_STYLES[scheme]}
      className="mx-auto flex max-w-page flex-col gap-lg p-lg font-body text-on-surface md:p-xl"
    >
      {APPRENTICE_PROGRAM_FONT_HREF && <link rel="stylesheet" href={APPRENTICE_PROGRAM_FONT_HREF} />}
      <header className="flex flex-wrap items-end justify-between gap-sm">
        <div>
          <p className="font-label text-label-sm font-semibold uppercase tracking-[0.18em] text-on-primary-container">
            Programa Jovem Aprendiz
          </p>
          {/* Assinatura horizontal do manual: principal no claro, negativa no
              escuro. O PNG tem a área de proteção embutida (margem
              transparente), por isso `h-14`: o desenho em si fica bem acima
              do mínimo de 90px do manual. */}
          <h1 className="-ml-sm">
            <img src={APPRENTICE_PROGRAM_LOGOS[scheme]} alt="Eu Aprendiz" className="h-14 w-auto" />
          </h1>
          <p className="font-body text-body-sm text-on-surface-variant">
            Do que eu faço ao que eu levo — a trilha do ciclo na <BrandName />.
          </p>
        </div>
        {isApprentice(user) && (
          <span className="rounded-lg bg-surface-container px-md py-sm font-label text-label-md text-on-surface">
            {user?.name}
          </span>
        )}
      </header>

      <nav
        className="flex flex-wrap gap-sm border-b border-outline-variant/40 pb-sm"
        aria-label="Navegação do Eu Aprendiz"
      >
        <NavLink to="/eu-aprendiz" end className={tabCls}>
          Trilha
        </NavLink>
        <NavLink to="/eu-aprendiz/mural" className={tabCls}>
          Mural
        </NavLink>
        <NavLink to="/eu-aprendiz/contrato" className={tabCls}>
          Contrato
        </NavLink>
        <NavLink to="/eu-aprendiz/portfolio" className={tabCls}>
          Portfólio
        </NavLink>
        {isFacilitator && (
          <NavLink to="/eu-aprendiz/painel" className={tabCls}>
            Painel
          </NavLink>
        )}
      </nav>

      <Outlet />
    </div>
  )
}
