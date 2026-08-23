import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { HighlightDTO, SectorOptionDTO } from "@legends/shared";
import { apiFetch } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/Icon";
import { Select } from "../components/Select";
import { HighlightsSkeleton } from "../components/Skeleton";
import { MonthlyHighlightsTab } from "./destaques/MonthlyHighlightsTab";
import { MyRecognitionsTab } from "./destaques/MyRecognitionsTab";

const ALL_SECTORS = "all";

const MONTHS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

function monthLabel(monthRef: string) {
  const [y, m] = monthRef.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

function HighlightCard({ h }: { h: HighlightDTO }) {
  const displayMonthRef = h.highlightMonthRef ?? h.monthRef;
  return (
    <article className="flex flex-col rounded-xl border border-outline-variant/30 bg-surface-container p-lg transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10">
      <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
        {monthLabel(displayMonthRef)}
      </p>
      <h3 className="mt-xs font-headline text-headline-md text-on-surface">
        {h.winner?.name ?? "—"}
      </h3>

      {h.imageUrl && (
        <a
          href={h.imageUrl}
          download={`destaque-${displayMonthRef}.png`}
          className="mt-md block"
        >
          <img
            src={h.imageUrl}
            alt={`Destaque ${monthLabel(displayMonthRef)} — ${h.winner?.name}`}
            className="w-full rounded-lg"
          />
        </a>
      )}

      {h.text && (
        <p className="mt-md flex-1 text-body-sm italic text-on-surface-variant">
          {h.text}
        </p>
      )}

      {h.imageUrl && (
        <a
          href={h.imageUrl}
          download={`destaque-${displayMonthRef}.png`}
          className="mt-md inline-flex items-center gap-xs text-body-sm text-primary transition-colors hover:text-primary"
        >
          <Icon name="download" className="text-[18px]" />
          Salvar / compartilhar
        </a>
      )}
    </article>
  );
}

/**
 * Listagem do Destaque do Mês **da votação** — o mecanismo que já existia,
 * preservado inteiro. Virou uma aba quando os Destaques do Mês curados pela G&G
 * entraram ao lado dele (ver a spec 2026-08-17-destaques-do-mes-curados).
 */
function VotingHighlightsTab() {
  const { user } = useAuth();
  const isThirdParty = user?.role === "THIRD_PARTY";
  const [sectorId, setSectorId] = useState<string>(user?.sectorId ?? ALL_SECTORS);

  const sectorsQuery = useQuery({
    queryKey: ["sectors"],
    queryFn: () => apiFetch<{ sectors: SectorOptionDTO[] }>("/sectors"),
    enabled: !isThirdParty,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["highlights", sectorId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (!isThirdParty) params.set("sectorId", sectorId);
      const qs = params.toString();
      return apiFetch<{ highlights: HighlightDTO[] }>(`/highlights${qs ? `?${qs}` : ""}`);
    },
  });
  const highlights = data?.highlights ?? [];

  const sectorOptions = [
    { value: ALL_SECTORS, label: "Todos os setores" },
    ...(sectorsQuery.data?.sectors ?? []).map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <p className="max-w-xl text-body-sm text-on-surface-variant">
          Os vencedores da votação do time, mês a mês.
        </p>
        {!isThirdParty && (
          <div className="w-full md:w-64">
            <Select
              ariaLabel="Setor"
              value={sectorId}
              onChange={setSectorId}
              options={sectorOptions}
            />
          </div>
        )}
      </div>

      {isLoading && <HighlightsSkeleton />}

      {isError && (
        <div className="flex items-center gap-sm rounded-lg border border-error/40 bg-error-container/20 p-lg text-on-error-container">
          <Icon name="error" className="text-[20px]" />
          Erro ao carregar os destaques.
        </div>
      )}

      {!isLoading && !isError && highlights.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">
          Nenhum destaque publicado ainda.
        </p>
      )}

      {!isLoading && !isError && highlights.length > 0 && (
        <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-3">
          {highlights.map((h) => (
            <HighlightCard key={h.periodId} h={h} />
          ))}
        </div>
      )}
    </div>
  );
}

type Tab = "destaques" | "meus" | "votacao";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "destaques", label: "Destaques do mês", icon: "trophy" },
  { id: "meus", label: "Meus destaques", icon: "workspace_premium" },
  { id: "votacao", label: "Da votação", icon: "how_to_vote" },
];

/**
 * Hall da fama em abas: o quadro curado pela G&G, os destaques da própria
 * pessoa e — intacta — a listagem que vem da votação. Rota nova duplicaria o
 * item de menu para a mesma pergunta ("quem foi destaque?"), e é esta URL que
 * já está nos links enviados.
 */
export function HighlightsPage() {
  const [tab, setTab] = useState<Tab>("destaques");

  return (
    <section className="mx-auto max-w-page p-lg md:p-xl">
      <header className="mb-lg">
        <div className="flex items-center gap-sm text-primary">
          <Icon name="trophy" className="text-[20px]" />
          <span className="font-label text-label-md uppercase tracking-[0.18em]">
            Hall da fama
          </span>
        </div>
        <h1 className="mt-2 font-headline text-headline-xl text-on-surface">
          Destaques do mês
        </h1>
        <p className="mt-2 max-w-xl text-body-md text-on-surface-variant">
          Quem brilhou neste mês.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Destaques do mês"
        className="mb-lg flex gap-xs border-b border-outline-variant/40"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px flex items-center gap-xs border-b-2 px-md py-sm font-label text-label-md transition-colors ${
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <Icon name={t.icon} className="text-[18px]" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "destaques" && <MonthlyHighlightsTab />}
      {tab === "meus" && <MyRecognitionsTab />}
      {tab === "votacao" && <VotingHighlightsTab />}
    </section>
  );
}
