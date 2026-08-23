import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SectorOptionDTO, ShowcaseEntry } from "@legends/shared";
import { apiFetch } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/Icon";
import { Select } from "../components/Select";
import { LegendsSkeleton } from "../components/Skeleton";
import { LegendCard } from "../components/LegendCard";

const ALL_SECTORS = "all";

export function LegendsPage() {
  const { user } = useAuth();
  const isThirdParty = user?.role === "THIRD_PARTY";
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"ativas" | "ex">("ativas");
  const [sectorId, setSectorId] = useState<string>(user?.sectorId ?? ALL_SECTORS);
  const isFormer = tab === "ex";

  const sectorsQuery = useQuery({
    queryKey: ["sectors"],
    queryFn: () => apiFetch<{ sectors: SectorOptionDTO[] }>("/sectors"),
    enabled: !isThirdParty,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["showcase", tab, sectorId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (isFormer) params.set("former", "1");
      if (!isThirdParty) params.set("sectorId", sectorId);
      const qs = params.toString();
      return apiFetch<{ entries: ShowcaseEntry[] }>(`/users/showcase${qs ? `?${qs}` : ""}`);
    },
  });

  const entries = data?.entries ?? [];
  // Só aparecem na galeria quem já tem selo(s) e/ou feedback(s).
  const recognized = useMemo(
    () => entries.filter((e) => e.feedbacksReceived > 0 || e.badges.length > 0),
    [entries],
  );
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return recognized;
    return recognized.filter(
      (e) =>
        e.user.name.toLowerCase().includes(term) ||
        (e.user.position ?? "").toLowerCase().includes(term),
    );
  }, [recognized, query]);

  const sectorOptions = [
    { value: ALL_SECTORS, label: "Todos os setores" },
    ...(sectorsQuery.data?.sectors ?? []).map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <section className="mx-auto max-w-page p-lg md:p-xl">
      <header className="mb-xl flex flex-col justify-between gap-lg md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-sm text-primary">
            <Icon name="diversity_3" className="text-[20px]" />
            <span className="font-label text-label-md uppercase tracking-[0.18em]">
              Comunidade &amp; legado
            </span>
          </div>
          <h1 className="mt-2 font-headline text-headline-xl text-on-surface">
            Nosso time de lendas
          </h1>
          <p className="mt-2 max-w-xl text-body-md text-on-surface-variant">
            Conheça as lendas por trás da plataforma e as conquistas que marcam
            a excelência técnica do time.
          </p>
        </div>
        <div className="flex w-full flex-col gap-sm md:w-96">
          {!isThirdParty && (
            <Select
              ariaLabel="Setor"
              value={sectorId}
              onChange={setSectorId}
              options={sectorOptions}
            />
          )}
          <label className="group relative block w-full">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-on-surface-variant transition-colors group-focus-within:text-primary">
              <Icon name="search" className="text-[20px]" />
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrar por nome ou cargo…"
              className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low py-md pl-10 pr-md text-body-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </div>
      </header>

      <div role="tablist" className="mb-lg flex gap-sm">
        <button
          role="tab"
          aria-selected={!isFormer}
          onClick={() => setTab("ativas")}
          className={`rounded-full px-lg py-sm font-label text-label-md transition-colors ${!isFormer ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"}`}
        >
          Lendas
        </button>
        <button
          role="tab"
          aria-selected={isFormer}
          onClick={() => setTab("ex")}
          className={`rounded-full px-lg py-sm font-label text-label-md transition-colors ${isFormer ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"}`}
        >
          Ex-Lendas
        </button>
      </div>

      {isLoading && <LegendsSkeleton />}

      {isError && (
        <div className="flex items-center gap-sm rounded-lg border border-error/40 bg-error-container/20 p-lg text-on-error-container">
          <Icon name="error" className="text-[20px]" />
          Erro ao carregar a galeria.
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">
          Nenhum colega encontrado.
        </p>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((entry) => (
            <LegendCard key={entry.user.id} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}
