import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useCurrentPeriod } from "../lib/use-current-period";
import { Icon } from "./Icon";
import { Avatar } from "./Avatar";
import { BrandLogo } from "./BrandLogo";
import { SchemeToggle } from "./SchemeToggle";
import { buildNavGroups, isNavItemActive, type NavGroup, type NavItem } from "./nav-items";
import { buildAdminNavGroups } from "./admin-nav-items";
import { MobileNav } from "./MobileNav";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationBell } from "./NotificationBell";
import { StreakIndicator } from "./StreakIndicator";
import { CoinIndicator } from "./CoinIndicator";
import { useHasCoins } from "../lib/use-coins";
import { useDevelopmentSettings } from "../lib/use-development-settings";
import { useOfficeSession } from "../office/session/OfficeSessionContext";
import { useAccessLogPing } from "../hooks/useAccessLogPing";
import { usePresenceHeartbeat } from "../hooks/usePresenceHeartbeat";
import { AssistantWidget } from "./assistant/AssistantWidget";
import { CorporatePostToasts } from "./CorporatePostToasts";

/**
 * Casca do app: barra superior fixa + conteúdo.
 *
 * A navegação é **horizontal**, e não uma sidebar: os 256px que a lateral comia
 * eram permanentes, e a Home passou a ter três colunas de conteúdo. Com o menu
 * no topo, cada grupo de assunto vira um dropdown que só ocupa espaço enquanto
 * está aberto.
 *
 * Dentro de `/admin` a mesma segunda linha passa a mostrar os grupos do console
 * (`buildAdminNavGroups`), em vez de sumir para dar lugar a uma sidebar fixa. O
 * admin era o único canto do app com padrão de navegação próprio, e a lateral
 * comia 16rem justamente nas telas mais largas do produto — tabelas de
 * colaboradores, painéis de RH, editor de mapas.
 */
export function AppLayout() {
  const { user, logout } = useAuth();
  // Telemetria de adoção (People Analytics). Só para quem está autenticado —
  // o convidado do escritório não tem usuário para associar.
  useAccessLogPing(Boolean(user));
  // Presença "on-line na plataforma" (bolinha do ranking). Vizinho do ping de
  // navegação, e separado dele: este bate com a aba parada, aquele só na troca
  // de rota.
  usePresenceHeartbeat(Boolean(user));
  const { exitOffice } = useOfficeSession();
  const navigate = useNavigate();
  const location = useLocation();
  const { votingOpen } = useCurrentPeriod();
  const logoutAndExitOffice = () => {
    exitOffice();
    logout();
  };

  const isAdmin = user?.role === "ADMIN" || user?.role === "SUBADMIN";
  const hasCoins = useHasCoins();
  const { data: developmentSettings } = useDevelopmentSettings();
  const inAdminSection = location.pathname.startsWith("/admin");

  // Menu da conta acionado pelo avatar.
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountMenuOpen) return;
    function handlePointer(event: MouseEvent) {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(event.target as Node)
      ) {
        setAccountMenuOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setAccountMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [accountMenuOpen]);

  // Qual item fica destacado. Numa rota de perfil (/perfil/:id) não há item
  // próprio, então herdamos a "origem": ?from=lendas mantém Lendas ativo;
  // demais perfis (inclusive o próprio) não destacam nada.
  let activeTo = location.pathname;
  if (location.pathname.startsWith("/perfil")) {
    const from = new URLSearchParams(location.search).get("from");
    activeTo = from === "lendas" ? "/lendas" : "";
  }

  const collaboratorNavGroups = buildNavGroups({
    isAdmin,
    adminAccess: user?.adminAccess,
    role: user?.role,
    enabledFeatures: user?.enabledFeatures,
    sectorFeatures: user?.sectorFeatures,
    impulseUpUrl: developmentSettings?.settings?.impulseUpUrl,
    inovaCommunityUrl: developmentSettings?.settings?.inovaCommunityUrl,
  });
  // Dentro de /admin a barra troca de conteúdo, não de forma: os mesmos
  // dropdowns, com os grupos do console.
  const navGroups = inAdminSection ? buildAdminNavGroups(user) : collaboratorNavGroups;
  // Quem administra sem ser conta de administração — o acesso delegado — tem
  // produto do outro lado e precisa de caminho de volta. Para ADMIN/SUBADMIN a
  // raiz devolve ao /admin (ver `HomeRoute`), então o botão seria um laço.
  const canLeaveAdmin = inAdminSection && Boolean(user) && !isAdmin;

  // Um dropdown aberto por vez. Começa fechado — ao contrário do acordeão da
  // sidebar antiga, um menu que abre sozinho ao carregar a página cobriria o
  // conteúdo sem ninguém ter pedido.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // Navegou (inclusive entre abas de Cultura, que mudam só a query) → fecha.
  useEffect(() => {
    setOpenMenu(null);
  }, [location.pathname, location.search]);

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <header className="sticky top-0 z-40 border-b border-outline-variant/40 bg-surface-container/90 backdrop-blur-md">
        {/* Linha 1: marca, busca e ações da conta. */}
        <div className="flex items-center gap-md px-md py-sm md:px-xl">
          <div className="md:hidden">
            <MobileNav
              groups={navGroups}
              activeTo={activeTo}
              votingOpen={votingOpen}
              isAdmin={isAdmin}
              onLogout={logoutAndExitOffice}
            />
          </div>

          <Link to="/" aria-label="Ir para a Home" className="shrink-0">
            <BrandLogo className="hidden h-9 w-auto object-contain md:block" />
            <BrandLogo variant="mark" className="h-9 w-9 object-contain md:hidden" />
          </Link>

          {/* A busca puxa o espaço sobrando e fica centrada, como no portal. */}
          <div className="flex flex-1 justify-center">
            <GlobalSearch />
          </div>

          <div className="flex shrink-0 items-center gap-sm md:gap-md">
            {!isAdmin && <StreakIndicator />}
            {!isAdmin && hasCoins && <CoinIndicator />}
            <SchemeToggle />
            <NotificationBell />
            <div className="relative" ref={accountMenuRef}>
              <button
                type="button"
                onClick={() => setAccountMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                aria-label="Abrir menu da conta"
                className="flex items-center gap-sm rounded-full p-1 transition-colors hover:bg-surface-container-highest focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 border-primary/30 bg-surface-container-highest">
                  {user ? (
                    <Avatar user={user} />
                  ) : (
                    <span className="font-label text-label-sm font-bold text-primary">—</span>
                  )}
                </div>
                {/* Nome e cargo só no desktop largo: na linha do topo eles
                    disputam espaço com a busca, que é mais usada. */}
                <div className="hidden leading-tight lg:block">
                  <p className="text-left font-label text-label-md text-on-surface">{user?.name}</p>
                  <p className="text-left text-[11px] text-on-surface-variant">
                    {user?.position ?? "Desenvolvimento de Produto"}
                  </p>
                </div>
                <Icon
                  name="expand_more"
                  className={`hidden text-[20px] text-on-surface-variant transition-transform lg:block ${
                    accountMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {accountMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-sm w-56 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container py-1 shadow-lg"
                >
                  {user && (
                    <div className="border-b border-outline-variant/40 px-lg py-md lg:hidden">
                      <p className="font-label text-label-md text-on-surface">{user.name}</p>
                      <p className="text-[11px] text-on-surface-variant">
                        {user.position ?? "Desenvolvimento de Produto"}
                      </p>
                    </div>
                  )}
                  {user?.companyName && (
                    <p className="px-lg pb-1 pt-sm text-[10px] uppercase tracking-wide text-on-surface-variant">
                      {user.companyName}
                    </p>
                  )}
                  {/* "Meu perfil" não está no menu de navegação: o avatar já é o
                      gesto natural para chegar no próprio perfil. */}
                  {!isAdmin && user && (
                    <AccountMenuItem
                      icon="person"
                      label="Meu perfil"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        navigate(`/perfil/${user.id}`);
                      }}
                    />
                  )}
                  <AccountMenuItem
                    icon="lock_reset"
                    label="Alterar senha"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      navigate("/alterar-senha");
                    }}
                  />
                  <AccountMenuItem
                    icon="logout"
                    label="Sair"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      logoutAndExitOffice();
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Linha 2: navegação por assunto — do produto, ou do console em /admin. */}
        {navGroups.length > 0 && (
          // Grade de três colunas em vez de um flex simples: as duas laterais
          // são espaçadores iguais, então os grupos ficam centrados na barra
          // independentemente de o CTA da votação estar lá ou não —
          // com `ml-auto` no CTA, o menu deslocava para a esquerda quando a
          // votação abria.
          <nav
            aria-label="Navegação principal"
            className="hidden grid-cols-[1fr_auto_1fr] items-center border-t border-outline-variant/30 px-md py-1 md:grid md:px-xl"
          >
            {/* `flex-wrap`, e nunca `overflow-x-auto`: overflow no eixo X
                também recorta o eixo Y, e o painel do dropdown — que é
                absoluto e sai para baixo da barra — virava uma tira com barra
                de rolagem. Em tela estreita os grupos quebram para a linha
                seguinte, que é aceitável; abaixo de `md` quem manda é o
                MobileNav. */}
            <div className="flex min-w-0 flex-wrap items-center justify-center gap-xs [grid-column:2]">
            {navGroups.map((group, index) =>
              group.label ? (
                <NavGroupMenu
                  key={group.label}
                  group={group}
                  activeTo={activeTo}
                  search={location.search}
                  votingOpen={votingOpen}
                  open={openMenu === group.label}
                  onToggle={() =>
                    setOpenMenu((current) => (current === group.label ? null : group.label!))
                  }
                  onClose={() => setOpenMenu(null)}
                />
              ) : (
                // Grupo sem rótulo (Home, Escritório, Liderança): item solto.
                group.items.map((item) => (
                  <NavLeafLink
                    key={item.to}
                    item={item}
                    active={isNavItemActive(item, activeTo, location.search)}
                    votingOpen={votingOpen}
                    className="rounded-md px-md py-sm font-label text-label-md"
                  />
                ))
              ),
            )}
            </div>

            {/* Volta para o lado de colaborador. Ocupa a mesma coluna do CTA de
                votação — os dois nunca aparecem juntos, porque um é de
                dentro do /admin e o outro é de fora. */}
            {canLeaveAdmin && (
              <Link
                to="/"
                className="flex shrink-0 items-center gap-sm justify-self-end rounded-md px-md py-sm font-label text-label-md text-tertiary transition-colors hover:bg-tertiary-container hover:text-on-tertiary-container [grid-column:3]"
              >
                <Icon name="arrow_back" className="text-[18px]" />
                Voltar para a Home
              </Link>
            )}

            {!inAdminSection && !isAdmin && votingOpen && (
              <button
                type="button"
                onClick={() => navigate("/votar")}
                className="flex shrink-0 items-center gap-sm justify-self-end rounded-md bg-primary px-md py-sm font-label text-label-md font-bold text-on-primary transition-all hover:bg-primary-container hover:text-on-primary-container active:scale-[0.98] [grid-column:3]"
              >
                <Icon name="add" className="text-[18px]" />
                Votar no Destaque
              </button>
            )}
          </nav>
        )}
      </header>

      {/* Sem sidebar fixa em lugar nenhum: o conteúdo usa a largura inteira em
          todas as telas, que é o ponto de ter trocado a lateral pelo topo. */}
      <main>
        <Outlet />
      </main>
      {/* Comunicado novo avisa em qualquer tela, não só no feed. */}
      <CorporatePostToasts />
      <AssistantWidget />
    </div>
  );
}

function AccountMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-sm px-lg py-md text-left font-label text-label-md text-on-surface transition-colors hover:bg-surface-container-highest"
    >
      <Icon name={icon} className="text-[20px] text-on-surface-variant" />
      {label}
    </button>
  );
}

/** Selo pulsante "Aberta" ao lado de Votar enquanto a votação está aberta. */
function OpenBadge() {
  return (
    <span className="ml-auto flex items-center gap-1 rounded-full bg-primary/15 py-0.5 pl-1.5 pr-2 font-label text-[10px] font-bold uppercase tracking-wide text-primary">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
      </span>
      Aberta
    </span>
  );
}

/**
 * Um destino do menu. Concentra os três jeitos de sair daqui — rota normal,
 * rota em aba nomeada e link externo — para o dropdown e a linha do topo não
 * repetirem a decisão.
 */
function NavLeafLink({
  item,
  active,
  votingOpen,
  className,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  votingOpen: boolean;
  className: string;
  onNavigate?: () => void;
}) {
  // Liderança e Admin (acesso delegado) usam o terciário da marca: são as abas
  // que só parte do time enxerga e precisam se distinguir à primeira vista.
  const tone = item.accent
    ? active
      ? "bg-tertiary/10 font-bold text-tertiary"
      : "text-tertiary hover:bg-tertiary-container hover:text-on-tertiary-container"
    : active
      ? "bg-primary/10 font-bold text-primary"
      : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface";
  const cls = `flex items-center gap-sm transition-colors ${className} ${tone}`;

  /*
   * Rota interna em aba própria: `<a>` com alvo NOMEADO, e não `<Link>`.
   * Clicar de novo leva para a aba que já existe, em vez de abrir outra —
   * `_blank` empilharia uma cópia por clique, cada uma com a própria sessão de
   * áudio e vídeo.
   *
   * **Sem `rel="noopener"`**, e isso é deliberado: ele corta o vínculo com o
   * contexto nomeado, e aí o nome deixa de reaproveitar — cada clique abre uma
   * aba nova (verificado no navegador). `noopener` existe contra tabnabbing de
   * destino não confiável; aqui o destino é a mesma origem.
   */
  if (item.newTab) {
    return (
      <a href={item.to} target="legends-escritorio" title={item.label} className={cls} onClick={onNavigate}>
        <Icon name={item.icon} className="text-[20px]" />
        {item.label}
      </a>
    );
  }

  // Item externo (ex.: Avaliações e Pesquisas no ImpulseUP) sai do app: âncora
  // de verdade, em nova aba e sem passar referrer/opener.
  if (item.external) {
    return (
      <a
        href={item.to}
        target="_blank"
        rel="noopener noreferrer"
        title={item.label}
        className={cls}
        onClick={onNavigate}
      >
        <Icon name={item.icon} className="text-[20px]" />
        {item.label}
      </a>
    );
  }

  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={cls}
      onClick={onNavigate}
    >
      <Icon name={item.icon} filled={active} className="text-[20px]" />
      {item.label}
      {item.showOpenBadge && votingOpen && <OpenBadge />}
    </Link>
  );
}

/** Um grupo de assunto da barra: botão + painel com os destinos. */
function NavGroupMenu({
  group,
  activeTo,
  search,
  votingOpen,
  open,
  onToggle,
  onClose,
}: {
  group: NavGroup;
  activeTo: string;
  search: string;
  votingOpen: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hasActive = group.items.some((item) => isNavItemActive(item, activeTo, search));

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="menu"
        // `aria-current` no grupo que contém a rota aberta: sem o acordeão da
        // sidebar, é o que diz "você está aqui dentro" com o menu fechado.
        aria-current={hasActive ? "true" : undefined}
        className={`flex items-center gap-1 rounded-md px-md py-sm font-label text-label-md transition-colors ${
          hasActive
            ? "font-bold text-primary"
            : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
        }`}
      >
        {group.label}
        <Icon name="expand_more" className={`text-[18px] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container py-1 shadow-lg"
        >
          {group.items.map((item) => (
            <NavLeafLink
              key={item.to}
              item={item}
              active={isNavItemActive(item, activeTo, search)}
              votingOpen={votingOpen}
              className="w-full px-lg py-sm font-label text-label-md"
              onNavigate={onClose}
            />
          ))}
        </div>
      )}
    </div>
  );
}
