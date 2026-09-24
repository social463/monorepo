import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { PublicUser } from "@legends/shared";
import { apiFetch } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useDevelopmentSettings } from "../lib/use-development-settings";
import { buildNavGroups, type BuildNavArgs, type NavItem } from "./nav-items";
import { Icon } from "./Icon";
import { Avatar } from "./Avatar";

const MAX_PEOPLE = 5;
const MAX_DESTINATIONS = 5;

/** Sem acento e em minúsculas — "ferias" precisa achar "Férias do Mês". */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

interface Destination {
  to: string;
  label: string;
  icon: string;
  external: boolean;
  /** Rótulo + sinônimos, já sem acento, para o casamento do termo. */
  haystack: string;
}

function toDestination(item: NavItem, group: string | undefined): Destination {
  return {
    to: item.to,
    label: item.label,
    icon: item.icon,
    external: Boolean(item.external),
    haystack: fold([item.label, group ?? "", ...(item.keywords ?? [])].join(" ")),
  };
}

/**
 * Busca global do topo do app: acha **colegas e destinos** (páginas, recursos e
 * ferramentas) por palavra-chave.
 *
 * Os dois lados têm alcances diferentes de propósito: **pessoa é da empresa
 * inteira**, porque procurar um colega de outra área é o caso normal; **destino
 * é o que a pessoa pode abrir**, porque oferecer uma tela que ela não acessa
 * seria um beco sem saída.
 *
 * O catálogo de destinos sai da própria navegação (`buildNavItems`), e não de
 * uma lista à parte: item novo no menu já nasce buscável, e o filtro por
 * feature vem de graça — a busca nunca oferece um destino que a pessoa não
 * poderia abrir.
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // `/users/company`, não `/users`: pessoa se busca na EMPRESA inteira. `/users`
  // devolve só o próprio setor — recorte que faz sentido para votar e para o
  // escritório, e nenhum para procurar um colega de outra área. É a mesma rota e
  // a mesma query do TargetPicker do Mural, então o cache é compartilhado, e ela
  // traz `sectorName` resolvido, que é o que o resultado mostra quando a pessoa
  // não tem cargo. Terceirizado continua restrito ao setor dele — o recorte é da rota.
  const { data } = useQuery({
    queryKey: ["users", "company"],
    queryFn: () => apiFetch<{ users: PublicUser[] }>("/users/company"),
  });
  const users = data?.users ?? [];
  const { data: developmentSettings } = useDevelopmentSettings();

  const destinations = useMemo(() => {
    const isAdmin = user?.role === "ADMIN" || user?.role === "SUBADMIN";
    return listDestinations({
      isAdmin,
      adminAccess: user?.adminAccess,
      role: user?.role,
      enabledFeatures: user?.enabledFeatures,
      sectorFeatures: user?.sectorFeatures,
      impulseUpUrl: developmentSettings?.settings?.impulseUpUrl,
      inovaModuleEnabled: developmentSettings?.settings?.inovaModuleEnabled,
    });
  }, [user, developmentSettings]);

  const term = fold(query.trim());

  const people = useMemo(() => {
    if (!term) return [];
    return users
      .filter(
        (u) =>
          fold(u.name).includes(term) ||
          fold(u.position ?? "").includes(term) ||
          fold(u.squad ?? "").includes(term),
      )
      .slice(0, MAX_PEOPLE);
  }, [users, term]);

  const places = useMemo(() => {
    if (!term) return [];
    return destinations.filter((d) => d.haystack.includes(term)).slice(0, MAX_DESTINATIONS);
  }, [destinations, term]);

  // Uma lista só para o teclado: os destinos vêm primeiro porque uma palavra
  // como "férias" quase sempre quer a tela, não uma pessoa.
  const flat = useMemo(
    () => [
      ...places.map((place) => ({ kind: "place" as const, place })),
      ...people.map((person) => ({ kind: "person" as const, person })),
    ],
    [places, people],
  );

  // Fecha o dropdown ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open]);

  // Mantém o índice ativo dentro dos limites quando os resultados mudam.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function choose(entry: (typeof flat)[number]) {
    if (entry.kind === "person") {
      navigate(`/perfil/${entry.person.id}`);
    } else if (entry.place.external) {
      window.open(entry.place.to, "_blank", "noopener,noreferrer");
    } else {
      navigate(entry.place.to);
    }
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!flat.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + 1) % flat.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + flat.length) % flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = flat[activeIndex] ?? flat[0];
      if (chosen) choose(chosen);
    }
  }

  const showDropdown = open && query.trim().length > 0;

  return (
    <div ref={containerRef} className="relative hidden sm:block">
      <label className="group relative block">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-on-surface-variant transition-colors group-focus-within:text-primary">
          <Icon name="search" className="text-[20px]" />
        </span>
        <input
          type="search"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="global-search-list"
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar pessoas e páginas…"
          className="w-48 rounded-full border border-outline-variant/60 bg-surface-container-highest py-2 pl-10 pr-4 text-body-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant focus:border-primary focus:ring-2 focus:ring-primary/30 lg:w-64"
        />
      </label>

      {showDropdown && (
        <ul
          id="global-search-list"
          role="listbox"
          // Centrado sob o campo (`left-1/2 -translate-x-1/2`), e não ancorado à
          // direita: a busca deixou de morar no canto do header e passou para o
          // meio da barra — preso à direita, o painel abria deslocado do campo.
          className="absolute left-1/2 top-full z-50 mt-sm max-h-96 w-[22rem] -translate-x-1/2 overflow-y-auto rounded-xl border border-outline-variant/40 bg-surface-container py-1 shadow-lg"
        >
          {flat.length === 0 ? (
            <li className="px-lg py-md text-body-sm text-on-surface-variant">Nada encontrado.</li>
          ) : (
            <>
              {places.length > 0 && <SectionLabel>Páginas e recursos</SectionLabel>}
              {places.map((place, index) => (
                <li key={place.to} role="option" aria-selected={index === activeIndex}>
                  <button
                    type="button"
                    onClick={() => choose({ kind: "place", place })}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`flex w-full items-center gap-sm px-md py-sm text-left transition-colors ${
                      index === activeIndex ? "bg-surface-container-highest" : "hover:bg-surface-container-highest"
                    }`}
                  >
                    <Icon name={place.icon} className="text-[20px] text-primary" />
                    <span className="min-w-0 flex-1 truncate font-label text-label-md text-on-surface">
                      {place.label}
                    </span>
                    {place.external && <Icon name="open_in_new" className="text-[16px] text-on-surface-variant" />}
                  </button>
                </li>
              ))}

              {people.length > 0 && <SectionLabel>Pessoas</SectionLabel>}
              {people.map((person, index) => {
                const flatIndex = places.length + index;
                return (
                  <li key={person.id} role="option" aria-selected={flatIndex === activeIndex}>
                    <button
                      type="button"
                      onClick={() => choose({ kind: "person", person })}
                      onMouseEnter={() => setActiveIndex(flatIndex)}
                      className={`flex w-full items-center gap-sm px-md py-sm text-left transition-colors ${
                        flatIndex === activeIndex
                          ? "bg-surface-container-highest"
                          : "hover:bg-surface-container-highest"
                      }`}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest">
                        <Avatar user={person} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-label text-label-md text-on-surface">{person.name}</p>
                        <p className="truncate text-body-sm text-on-surface-variant">
                          {person.position ?? person.sectorName ?? ""}
                          {person.squad ? ` • ${person.squad}` : ""}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </>
          )}
        </ul>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <li
      aria-hidden
      className="px-md pb-1 pt-sm font-label text-label-sm uppercase tracking-wide text-on-surface-variant"
    >
      {children}
    </li>
  );
}

/**
 * Destinos buscáveis: os mesmos itens do menu, achatados, com o nome do grupo
 * dobrado no termo — assim "comunicação" encontra Feed Corporativo e Férias.
 *
 * Reaproveitar `buildNavGroups` é o que herda o filtro de feature: nada aparece
 * na busca que não apareceria no menu.
 */
function listDestinations(args: BuildNavArgs): Destination[] {
  return buildNavGroups(args).flatMap((group) =>
    group.items.map((item) => toDestination(item, group.label)),
  );
}
