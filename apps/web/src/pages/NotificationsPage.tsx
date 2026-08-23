import { Link } from "react-router-dom";
import { useState } from "react";
import {
  useNotifications,
  useMarkAllRead,
  useMarkRead,
  useClearRead,
  useUnreadCount,
  type NotificationFilter,
} from "../lib/use-notifications";
import { Icon } from "../components/Icon";

function iconFor(type: string): string {
  switch (type) {
    case "FEEDBACK_RECEIVED":
      return "chat";
    case "FEEDBACK_REACTION":
      return "add_reaction";
    case "BADGE_EARNED":
      return "workspace_premium";
    case "HIGHLIGHT_PUBLISHED":
      return "trophy";
    case "DEVELOPMENT_THURSDAY_EVENT":
      return "school";
    case "MEETING_INVITED":
    case "MEETING_UPDATED":
    case "MEETING_CANCELED":
    case "MEETING_REMINDER":
      return "calendar_month";
    case "ONE_ON_ONE_INVITED":
    case "ONE_ON_ONE_ACTION_ASSIGNED":
    case "ONE_ON_ONE_REMINDER":
      return "forum";
    case "PDI_ACTION_AWAITING_REVIEW":
      return "pending_actions";
    case "PDI_ACTION_APPROVED":
      return "task_alt";
    case "PDI_ACTION_CHANGES_REQUESTED":
      return "edit_note";
    case "MANDATORY_COURSE_ASSIGNED":
      return "menu_book";
    case "REVIEW_POLL_PUBLISHED":
      return "poll";
    default:
      return "how_to_vote";
  }
}

type Tab = Extract<NotificationFilter, "unread" | "read">;

const EMPTY: Record<Tab, { message: string }> = {
  unread: { message: "Tudo em dia! Você não tem notificações não lidas." },
  read: { message: "Nenhuma notificação lida ainda." },
};

export function NotificationsPage() {
  const [tab, setTab] = useState<Tab>("unread");
  const list = useNotifications(tab);
  const unread = useUnreadCount();
  const markAllRead = useMarkAllRead();
  const markRead = useMarkRead();
  const clearRead = useClearRead();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unreadCount = unread.data?.unreadCount ?? 0;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "unread", label: "Não lidas", count: unreadCount },
    { id: "read", label: "Lidas" },
  ];

  return (
    <section className="mx-auto max-w-page p-lg md:p-xl">
      <header className="mb-xl">
        <div className="flex items-center gap-sm text-primary">
          <Icon name="notifications" className="text-[20px]" />
          <span className="font-label text-label-md uppercase tracking-[0.18em]">
            Atualizações
          </span>
        </div>
        <h1 className="mt-2 font-headline text-headline-xl text-on-surface">
          Notificações
        </h1>
        <p className="mt-2 max-w-xl text-body-md text-on-surface-variant">
          Reações, feedbacks, selos e destaques — tudo o que aconteceu por aqui.
        </p>
      </header>

      <div className="mb-lg flex items-end justify-between gap-md border-b border-outline-variant/40">
        <div role="tablist" className="flex gap-1">
          {tabs.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`flex shrink-0 items-center gap-xs border-b-2 px-lg py-sm font-label text-label-md transition-colors ${
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {t.label}
                {t.count != null && t.count > 0 && (
                  <span className="flex min-w-[18px] items-center justify-center rounded-full bg-error px-1 font-label text-[10px] font-bold text-on-error">
                    {t.count > 9 ? "9+" : t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {tab === "unread" && unreadCount > 0 && (
          <button
            type="button"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="mb-1 shrink-0 font-label text-label-md text-primary transition-colors hover:text-primary disabled:opacity-50"
          >
            Marcar todas como lidas
          </button>
        )}

        {tab === "read" && items.length > 0 && (
          <button
            type="button"
            onClick={() => clearRead.mutate()}
            disabled={clearRead.isPending}
            className="mb-1 shrink-0 font-label text-label-md text-on-surface-variant transition-colors hover:text-error disabled:opacity-50"
          >
            Limpar
          </button>
        )}
      </div>

      {list.isLoading ? (
        <p className="py-2xl text-center text-body-md text-on-surface-variant">
          Carregando…
        </p>
      ) : items.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center text-center text-on-surface-variant">
          <img
            src="/illustration/empty_notification.png"
            alt=""
            className="h-80 w-80 object-contain opacity-90"
          />
          <p className="text-body-md">{EMPTY[tab].message}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-sm">
          {items.map((n) => {
            const inner = (
              <div
                className={`flex items-start gap-md rounded-xl border border-outline-variant/30 bg-surface-container px-lg py-md transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10 ${
                  n.read ? "opacity-70" : ""
                }`}
              >
                <Icon
                  name={iconFor(n.type)}
                  className="mt-0.5 text-[22px] text-primary"
                />
                <p
                  className={`text-body-md ${n.read ? "text-on-surface-variant" : "font-bold text-on-surface"}`}
                >
                  {n.title}
                </p>
              </div>
            );
            const onActivate = () => {
              if (!n.read) markRead.mutate(n.id);
            };
            return (
              <li key={n.id}>
                {n.link ? (
                  <Link to={n.link} onClick={onActivate} className="block">
                    {inner}
                  </Link>
                ) : !n.read ? (
                  <button
                    type="button"
                    onClick={onActivate}
                    className="block w-full text-left"
                  >
                    {inner}
                  </button>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}

      {list.hasNextPage && (
        <button
          type="button"
          onClick={() => list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
          className="mt-lg w-full rounded-md border border-outline-variant/40 py-md font-label text-label-md text-on-surface-variant transition-colors hover:bg-surface-container"
        >
          {list.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
        </button>
      )}
    </section>
  );
}
