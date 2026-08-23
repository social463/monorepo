import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MAX_VOTE_CATEGORIES,
  MIN_JUSTIFICATION_LENGTH,
  type PublicUser,
  type RecognitionCategoryDTO,
  type VoteDTO,
  type VotingPeriodDTO,
} from "@legends/shared";
import { ApiError, apiFetch } from "../lib/api";
import { useCurrentPeriod } from "../lib/use-current-period";
import { Icon } from "../components/Icon";
import { categoryIcon } from "../lib/icons";
import { invalidateCoins } from "../lib/use-coins";
import { Avatar } from "../components/Avatar";
import {
  ColleagueListSkeleton,
  CategoryGridSkeleton,
  VoteFormSkeleton,
} from "../components/Skeleton";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function StepHeader({ step, title }: { step: number; title: string }) {
  return (
    <div className="mb-lg flex items-center gap-md">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 font-label text-label-md font-bold text-primary">
        {step}
      </span>
      <h3 className="font-headline text-headline-md text-on-surface">
        {title}
      </h3>
    </div>
  );
}

export function VotePage() {
  const queryClient = useQueryClient();
  const [votedId, setVotedId] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [justification, setJustification] = useState("");
  const [colleagueQuery, setColleagueQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<{ users: PublicUser[] }>("/users"),
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ categories: RecognitionCategoryDTO[] }>("/categories"),
  });
  const { period, votingOpen, isLoading: periodLoading } = useCurrentPeriod();
  const nextPeriodQuery = useQuery({
    queryKey: ["period", "next"],
    queryFn: () =>
      apiFetch<{ period: VotingPeriodDTO | null }>("/periods/next"),
    enabled: !periodLoading && !votingOpen,
  });
  const myVotesQuery = useQuery({
    queryKey: ["votes", "me"],
    queryFn: () => apiFetch<{ votes: VoteDTO[] }>("/votes/me"),
  });

  function toggleCategory(id: string) {
    setCategoryIds((prev) =>
      prev.includes(id)
        ? prev.filter((c) => c !== id)
        : prev.length < MAX_VOTE_CATEGORIES
          ? [...prev, id]
          : prev,
    );
  }

  const mutation = useMutation({
    mutationFn: (body: {
      votedId: string;
      categoryIds: string[];
      justification: string;
    }) =>
      apiFetch<{ vote: VoteDTO }>("/votes", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setSuccess("Voto registrado! Obrigado por valorizar um colega.");
      setError(null);
      setVotedId("");
      setCategoryIds([]);
      setJustification("");
      setColleagueQuery("");
      queryClient.invalidateQueries({ queryKey: ["votes", "me"] });
      invalidateCoins(queryClient);
    },
    onError: (err) => {
      setSuccess(null);
      setError(
        err instanceof ApiError ? err.message : "Erro ao registrar o voto.",
      );
    },
  });

  const nextPeriod = nextPeriodQuery.data?.period ?? null;
  const users = usersQuery.data?.users ?? [];
  const categories = categoriesQuery.data?.categories ?? [];
  const myVotes = myVotesQuery.data?.votes ?? [];
  // Regra: um único voto por pessoa por período. Quando já há um voto
  // registrado no período corrente, o formulário dá lugar a um aviso.
  const alreadyVoted = myVotes.length > 0;

  // Apenas DEV é candidato. Liderança aparece no Time, mas
  // não pode receber voto (regra garantida também no backend). Só colegas do
  // MESMO setor do período atual são candidatos — o período já vem escopado
  // pelo setor do usuário logado (getCurrentOpenPeriod no backend).
  const votableUsers = useMemo(
    () => users.filter((u) => u.role === "LEGEND" && u.sectorId === period?.sectorId),
    [users, period?.sectorId],
  );

  const filteredUsers = useMemo(() => {
    const term = colleagueQuery.trim().toLowerCase();
    if (!term) return votableUsers;
    return votableUsers.filter(
      (u) =>
        u.name.toLowerCase().includes(term) ||
        (u.position ?? "").toLowerCase().includes(term),
    );
  }, [votableUsers, colleagueQuery]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    if (!votedId || categoryIds.length === 0) {
      setError("Escolha um colega e ao menos uma categoria.");
      return;
    }
    if (justification.trim().length < MIN_JUSTIFICATION_LENGTH) {
      setError(
        `O feedback precisa ter pelo menos ${MIN_JUSTIFICATION_LENGTH} caracteres.`,
      );
      return;
    }
    setError(null);
    mutation.mutate({ votedId, categoryIds, justification: justification.trim() });
  }

  return (
    <section className="mx-auto max-w-page p-lg md:p-xl">
      <header className="mb-xl">
        <h1 className="font-headline text-headline-xl text-on-surface">
          Vote no Destaque do Mês
        </h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Um voto por pessoa, por período: escolha o colega que fez a
          diferença e diga por quê. Quem foi o Destaque sai na publicação — o que
          você escrever chega como feedback para ele na hora.
        </p>
      </header>

      {periodLoading ? (
        <VoteFormSkeleton />
      ) : !votingOpen ? (
        <div className="flex flex-col items-center gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-xl text-center">
          <Icon
            name={nextPeriod ? "event_upcoming" : "event_busy"}
            className="text-[44px] text-tertiary"
          />
          <h3 className="font-headline text-headline-md text-on-surface">
            Votação fechada
          </h3>
          {nextPeriod ? (
            <p className="max-w-md text-body-md text-on-surface-variant">
              A próxima votação ({nextPeriod.monthRef}) abre em{" "}
              <span className="font-semibold text-on-surface">
                {formatDate(nextPeriod.startsAt)}
              </span>{" "}
              e vai até {formatDate(nextPeriod.endsAt)}.
            </p>
          ) : (
            <p className="max-w-md text-body-md text-on-surface-variant">
              Nenhum período de votação está aberto no momento. Volte quando a
              administração abrir um novo período.
            </p>
          )}
        </div>
      ) : (
        <>
          {alreadyVoted ? (
            <div className="flex flex-col items-center gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-xl text-center">
              <Icon
                name="how_to_vote"
                filled
                className="text-[44px] text-primary"
              />
              <h3 className="font-headline text-headline-md text-on-surface">
                Você já votou neste período
              </h3>
              <p className="max-w-md text-body-md text-on-surface-variant">
                Cada pessoa pode registrar apenas um voto por período de
                votação. Seu voto deste mês está logo abaixo.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="grid grid-cols-12 gap-lg">
              {/* Coluna esquerda — seleção do colega */}
              <div className="col-span-12 flex flex-col gap-lg lg:col-span-4">
                <fieldset className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
                  <StepHeader step={1} title="Selecionar colega" />

                  <label
                    className="mb-2 block text-body-sm text-on-surface-variant"
                    htmlFor="colleague-search"
                  >
                    Pesquisar por nome ou cargo
                  </label>
                  <div className="relative mb-md">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-on-surface-variant">
                      <Icon name="search" className="text-[18px]" />
                    </span>
                    <input
                      id="colleague-search"
                      type="text"
                      value={colleagueQuery}
                      onChange={(e) => setColleagueQuery(e.target.value)}
                      placeholder="Ex.: Ana Souza…"
                      className="w-full rounded-md border border-outline-variant/60 bg-surface-container-highest py-2 pl-10 pr-3 text-body-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant focus:border-primary focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto pr-1">
                    {usersQuery.isLoading && <ColleagueListSkeleton />}
                    {!usersQuery.isLoading && filteredUsers.length === 0 && (
                      <p className="text-body-sm text-on-surface-variant">
                        Nenhum colega encontrado.
                      </p>
                    )}
                    {filteredUsers.map((member) => {
                      const selected = votedId === member.id;
                      return (
                        <label
                          key={member.id}
                          className="relative block cursor-pointer"
                        >
                          <input
                            type="radio"
                            name="colleague"
                            value={member.id}
                            checked={selected}
                            onChange={() => setVotedId(member.id)}
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                          />
                          <div
                            className={[
                              "flex items-center gap-md rounded-md border p-sm transition-all",
                              selected
                                ? "border-primary bg-primary/10"
                                : "border-outline-variant/30 hover:border-primary/50 hover:bg-surface-container-high",
                            ].join(" ")}
                          >
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest">
                              <Avatar user={member} />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-headline text-body-md font-semibold text-on-surface">
                                {member.name}
                              </p>
                              <p className="truncate text-body-sm text-on-surface-variant">
                                {member.position ??
                                  "Desenvolvimento de Produto"}
                              </p>
                            </div>
                            <Icon
                              name="check_circle"
                              filled
                              className={[
                                "ml-auto text-[20px] text-primary transition-opacity",
                                selected ? "opacity-100" : "opacity-0",
                              ].join(" ")}
                            />
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {/* Card de destaque */}
                <div className="relative overflow-hidden rounded-xl bg-primary-container p-lg">
                  <Icon
                    name="auto_awesome"
                    className="mb-2 text-[36px] text-on-primary-container"
                  />
                  <p className="font-headline text-body-lg font-bold leading-tight text-on-primary-container">
                    Valorize quem impulsiona nossos sistemas.
                  </p>
                </div>
              </div>

              {/* Coluna direita — categoria + feedback */}
              <div className="col-span-12 flex flex-col gap-lg lg:col-span-8">
                <fieldset className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
                  <StepHeader step={2} title="Escolher categorias" />
                  <p className="mb-md text-body-sm text-on-surface-variant">
                    Você pode escolher até {MAX_VOTE_CATEGORIES} categorias para este colega.
                  </p>

                  {categoriesQuery.isLoading && <CategoryGridSkeleton />}
                  <div className="grid grid-cols-2 gap-md sm:grid-cols-3">
                    {categories.map((category) => {
                      const selected = categoryIds.includes(category.id);
                      const atLimit = !selected && categoryIds.length >= MAX_VOTE_CATEGORIES;
                      return (
                        <label
                          key={category.id}
                          className={[
                            "relative block",
                            atLimit ? "cursor-not-allowed opacity-40" : "cursor-pointer",
                          ].join(" ")}
                        >
                          <input
                            type="checkbox"
                            name="category"
                            value={category.id}
                            checked={selected}
                            disabled={atLimit}
                            onChange={() => toggleCategory(category.id)}
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                          />
                          <div
                            className={[
                              "flex h-full flex-col items-center gap-2 rounded-lg border-2 p-md text-center transition-all",
                              selected
                                ? "border-primary bg-primary/10"
                                : "border-outline-variant/30 bg-surface-container-highest hover:border-primary/50",
                            ].join(" ")}
                          >
                            <Icon
                              name={categoryIcon(category.slug)}
                              filled={selected}
                              className={[
                                "text-[32px] transition-colors",
                                selected
                                  ? "text-primary"
                                  : "text-on-surface-variant",
                              ].join(" ")}
                            />
                            <span className="font-label text-label-md font-semibold text-on-surface">
                              {category.name}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
                  <StepHeader step={3} title="Seu feedback" />

                  <textarea
                    aria-label="Seu feedback"
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    rows={4}
                    placeholder="Conte o que esse colega fez que merece destaque…"
                    className="w-full resize-none rounded-lg border border-outline-variant/60 bg-surface-container-highest p-md text-body-md text-on-surface outline-none transition-all placeholder:text-on-surface-variant focus:border-primary focus:ring-2 focus:ring-primary/30"
                  />

                  <div className="mt-md flex flex-wrap items-center justify-between gap-md">
                    <span className="font-label text-label-sm text-on-surface-variant">
                      {justification.trim().length}/{MIN_JUSTIFICATION_LENGTH}{" "}
                      caracteres mínimos
                    </span>
                    <button
                      type="submit"
                      disabled={mutation.isPending}
                      className="flex items-center gap-sm rounded-md bg-primary px-xl py-sm font-label text-label-md font-bold text-on-primary shadow-lg shadow-primary/10 transition-all hover:bg-primary-container hover:text-on-primary-container active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-on-surface-variant"
                    >
                      {mutation.isPending ? "Enviando…" : "Confirmar voto"}
                      <Icon name="send" className="text-[18px]" />
                    </button>
                  </div>

                  {error && (
                    <p
                      role="alert"
                      className="mt-md flex items-center gap-sm text-body-sm text-error"
                    >
                      <Icon name="error" className="text-[18px]" />
                      {error}
                    </p>
                  )}
                  {success && (
                    <p
                      role="status"
                      className="mt-md flex items-center gap-sm text-body-sm text-primary"
                    >
                      <Icon
                        name="check_circle"
                        filled
                        className="text-[18px]"
                      />
                      {success}
                    </p>
                  )}
                </fieldset>
              </div>
            </form>
          )}

          {/* Stats + histórico recente (dados reais) */}
          <div className="mt-xl grid grid-cols-1 gap-lg md:grid-cols-3">
            <div className="rounded-xl border-l-4 border-primary bg-surface-container-high p-lg">
              <p className="text-body-sm font-medium text-on-surface-variant">
                Período atual
              </p>
              <h4 className="mt-1 font-headline text-headline-md text-primary">
                {period?.monthRef ?? "Fechado"}
              </h4>
            </div>
            <div className="rounded-xl border-l-4 border-primary/40 bg-surface-container-high p-lg">
              <p className="text-body-sm font-medium text-on-surface-variant">
                Seus votos
              </p>
              <h4 className="mt-1 font-headline text-headline-md text-on-surface">
                {myVotes.length}
              </h4>
            </div>
            <div className="rounded-xl border-l-4 border-primary/40 bg-surface-container-high p-lg">
              <p className="text-body-sm font-medium text-on-surface-variant">
                Categorias disponíveis
              </p>
              <h4 className="mt-1 font-headline text-headline-md text-on-surface">
                {categories.length}
              </h4>
            </div>
          </div>

          <section className="mt-xl">
            <h3 className="mb-md font-label text-label-sm uppercase tracking-[0.15em] text-on-surface-variant">
              Seu voto deste mês
            </h3>
            {myVotes.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant">
                Você ainda não votou neste mês.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {myVotes.map((vote) => (
                  <li
                    key={vote.id}
                    className="rounded-lg border border-outline-variant/40 bg-surface-container p-md"
                  >
                    <p className="font-headline text-body-md font-semibold text-on-surface">
                      {vote.voted.name}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {vote.categories.map((c) => (
                        <span
                          key={c.id}
                          className="rounded-full bg-primary/10 px-2 py-0.5 font-label text-label-sm text-primary"
                        >
                          {c.name}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1 text-body-sm text-on-surface-variant">
                      {vote.justification}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}
