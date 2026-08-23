import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type {
  LedSquadMoodsDTO,
  MoodHistoryPageDTO,
  MoodLevel,
  SquadMemberMoodDTO,
} from "@legends/shared";
import { MOOD_OPTIONS } from "@legends/shared";
import { apiFetch } from "../../lib/api";
import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";

const MOOD_BY_VALUE = Object.fromEntries(
  MOOD_OPTIONS.map((o) => [o.value, { emoji: o.emoji, label: o.label }]),
) as Record<MoodLevel, { emoji: string; label: string }>;

function formatDay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
}

export function SquadMoodPanel() {
  const squadsQuery = useQuery({
    queryKey: ["led-squads-moods"],
    queryFn: () =>
      apiFetch<{ squads: LedSquadMoodsDTO[] }>("/me/led-squads/moods"),
  });

  const squads = squadsQuery.data?.squads ?? [];
  // Não tem liderado direto (ou ainda carregando) → não ocupa espaço.
  if (squads.length === 0) return null;

  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
      <h3 className="mb-lg font-headline text-headline-md text-on-surface">
        Humor do time
      </h3>
      <div className="flex flex-col gap-lg">
        {squads.map((squad) => (
          <div key={squad.squadId}>
            {/* Grupo único ("Meu time") repetiria o título do painel logo acima. */}
            {squads.length > 1 && (
              <h4 className="mb-sm font-label text-label-md uppercase tracking-wide text-on-surface-variant">
                {squad.squadName}
              </h4>
            )}
            {squad.members.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant">
                Sem integrantes.
              </p>
            ) : (
              <ul className="flex flex-col gap-sm">
                {squad.members.map((member) => (
                  <MemberRow key={member.id} member={member} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MemberRow({ member }: { member: SquadMemberMoodDTO }) {
  const [open, setOpen] = useState(false);
  const current = member.currentMood;
  const meta = current ? MOOD_BY_VALUE[current.mood] : null;

  return (
    <li className="overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container-low">
      <button
        type="button"
        aria-label={member.name}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-md p-md text-left transition-colors hover:bg-surface-container-high"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-container/20">
          <Avatar user={member} />
        </span>
        <span className="flex-grow font-label text-label-md text-on-surface">
          {member.name}
        </span>
        <span className="shrink-0 font-body text-body-sm text-on-surface-variant">
          {meta ? (
            <>
              <span aria-hidden>{meta.emoji}</span> {meta.label} ·{" "}
              {formatDay(current!.day)}
            </>
          ) : (
            "Sem registro"
          )}
        </span>
        <Icon
          name={open ? "expand_less" : "expand_more"}
          className="shrink-0 text-[20px] text-on-surface-variant"
        />
      </button>
      {open && <MemberHistory memberId={member.id} />}
    </li>
  );
}

function MemberHistory({ memberId }: { memberId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["mood-history", memberId],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("limit", "10");
      if (pageParam) params.set("cursor", pageParam);
      return apiFetch<MoodHistoryPageDTO>(
        `/users/${memberId}/mood-history?${params.toString()}`,
      );
    },
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const el = sentinelRef.current;
    const root = containerRef.current;
    if (!el || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { root },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const entries = query.data?.pages.flatMap((p) => p.entries) ?? [];

  if (query.isError) {
    return (
      <p className="px-md pb-md text-body-sm text-on-surface-variant">
        Erro ao carregar o histórico.
      </p>
    );
  }
  if (query.isLoading) {
    return (
      <p className="px-md pb-md text-body-sm text-on-surface-variant">
        Carregando…
      </p>
    );
  }
  if (entries.length === 0) {
    return (
      <p className="px-md pb-md text-body-sm text-on-surface-variant">
        Sem histórico.
      </p>
    );
  }

  return (
    <div ref={containerRef} className="max-h-72 overflow-y-auto px-md pb-xs pt-sm">
      <ul className="flex flex-col gap-xs">
        {entries.map((e) => {
          const meta = MOOD_BY_VALUE[e.mood];
          return (
            <li
              key={e.day}
              className="flex items-start gap-sm border-t border-outline-variant/10 pt-xs first:border-t-0 first:pt-0"
            >
              <span aria-hidden className="text-[18px] leading-none">
                {meta.emoji}
              </span>
              <div className="flex-grow">
                <div className="flex items-center justify-between gap-sm">
                  <span className="font-label text-label-sm text-on-surface">
                    {meta.label}
                  </span>
                  <span className="font-label text-label-sm text-on-surface-variant">
                    {formatDay(e.day)}
                  </span>
                </div>
                {e.note && (
                  <p className="mt-0.5 text-body-sm text-on-surface-variant">
                    {e.note}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div ref={sentinelRef} className="h-4" />
      {isFetchingNextPage && (
        <p className="pt-sm text-center text-body-sm text-on-surface-variant">
          Carregando…
        </p>
      )}
    </div>
  );
}
