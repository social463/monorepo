import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ProfileDTO,
  UpdateFeaturedBadgesPayload,
  VoteDTO,
} from "@legends/shared";
import { isLeaderRole, XP_CURRENCY_LABEL, XP_LEVEL_ON_COLOR } from "@legends/shared";
import { apiFetch } from "../lib/api";
import { Icon } from "../components/Icon";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "../components/Avatar";
import { BirthdayConfetti } from "../components/BirthdayConfetti";
import { FeedbackSection } from "./profile/FeedbackSection";
import { FeedbackComposer } from "./profile/FeedbackComposer";
import { BadgeGallery } from "./profile/BadgeGallery";
import { MoodOfDay } from "./profile/MoodOfDay";
import { RetroActionsSection } from "./profile/RetroActionsSection";
import { ProfileSkeleton } from "../components/Skeleton";

function joinedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}


export function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  // Deep-link do mural: ?feedback=<id> destaca um feedback (abre a aba Feedbacks); ?badge=<id> destaca um selo.
  const highlightFeedbackId = searchParams.get("feedback");
  const highlightBadgeId = searchParams.get("badge");
  const { user: authUser } = useAuth();
  const navigate = useNavigate();
  const isOwnProfile = authUser?.id === id;

  const queryClient = useQueryClient();

  async function saveFeatured(badgeIds: string[]) {
    const body: UpdateFeaturedBadgesPayload = { badgeIds };
    await apiFetch(`/me/featured-badges`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["profile", id] }),
      queryClient.invalidateQueries({ queryKey: ["showcase"] }),
    ]);
  }

  const profileQuery = useQuery({
    queryKey: ["profile", id],
    queryFn: () => apiFetch<ProfileDTO>(`/users/${id}/profile`),
    enabled: Boolean(id),
  });
  if (profileQuery.isLoading) {
    return <ProfileSkeleton />;
  }
  if (profileQuery.isError || !profileQuery.data) {
    return (
      <div className="m-xl flex items-center gap-sm rounded-lg border border-error/40 bg-error-container/20 p-lg text-on-error-container">
        <Icon name="error" className="text-[20px]" />
        Perfil não encontrado.
      </div>
    );
  }

  const profile = profileQuery.data;
  const { user, badges, months } = profile;
  // Lideranças (LEAD, MANAGER, HEAD) fazem parte do time e têm perfil/avatar,
  // mas nunca recebem voto — só selo atribuído, daí a outra mensagem de vazio
  // na galeria.
  const isLead = isLeaderRole(user.role);
  const actions = profile.actions ?? [];
  const hasActions = actions.length > 0;
  const arquivadas = profile.archivedActionCount ?? 0;

  return (
    <section className="mx-auto max-w-page p-lg md:p-xl">
      <BirthdayConfetti targetUserId={id} once={false} />
      <div>
        <div className="min-w-0">
          {/* Hero — só a identidade desde que o resumo "Impacto acumulado"
              saiu; o que ele contava aparece na lista e na galeria. */}
          <div className="mb-lg">
            <div className="flex flex-col items-center gap-xl rounded-xl border border-outline-variant/40 bg-surface-container p-lg md:flex-row">
              <div className="relative shrink-0">
                <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-full border-4 border-primary bg-surface-container-highest md:h-36 md:w-36">
                  <Avatar
                    user={user}
                    initialsClassName="font-headline text-headline-xl font-bold text-primary"
                  />
                </div>
                {isOwnProfile && (
                  <button
                    type="button"
                    aria-label="Editar avatar"
                    onClick={() => navigate("/personagem")}
                    className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-surface bg-primary text-on-primary transition-transform hover:scale-110"
                  >
                    <Icon name="edit" className="text-[18px]" />
                  </button>
                )}
                {user.role === "ADMIN" && !isOwnProfile && (
                  <span className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-primary">
                    <Icon
                      name="verified"
                      filled
                      className="text-[16px] text-on-primary"
                    />
                  </span>
                )}
              </div>

              <div className="flex-grow text-center md:text-left">
                <h1 className="font-headline text-headline-xl text-on-surface">
                  {user.name}
                </h1>
                <p className="mb-md mt-1 font-body text-body-lg font-medium text-primary">
                  {user.position ?? "Desenvolvimento de Produto"}
                  {user.squad ? ` • ${user.squad}` : ""}
                </p>
                {/* Sem margem embaixo: os chips são o último elemento da
                    identidade desde que o atalho da votação saiu daqui. */}
                <div className="flex flex-wrap justify-center gap-sm md:justify-start">
                  {/* O nível vem primeiro entre os chips: é o que a pessoa
                      procura ao abrir o perfil de um colega. Some com zero
                      ponto, mesma regra do card da Home — "Bronze 0%" não é
                      progressão, é um lembrete de que nada aconteceu. */}
                  {profile.xp && profile.xp.points > 0 && (
                    <span
                      className="inline-flex items-center gap-xs rounded-full px-md py-xs font-label text-label-sm font-bold"
                      // A cor é do METAL, não da marca (ver XP_LEVELS): bronze é
                      // bronze em qualquer tenant, por isso vai em `style`.
                      style={{
                        backgroundColor: profile.xp.level.color,
                        color: XP_LEVEL_ON_COLOR,
                      }}
                      title={`${profile.xp.points.toLocaleString("pt-BR")} ${XP_CURRENCY_LABEL.toLowerCase()}`}
                    >
                      <Icon name="workspace_premium" className="text-[16px]" />
                      {profile.xp.level.name} ·{" "}
                      {profile.xp.points.toLocaleString("pt-BR")}{" "}
                      {XP_CURRENCY_LABEL.toLowerCase()}
                    </span>
                  )}
                  {user.sectorName && (
                    <span className="rounded-full border border-outline-variant/50 bg-surface-container-high px-md py-xs font-label text-label-sm text-on-surface-variant">
                      {user.sectorName}
                    </span>
                  )}
                  {user.squad && (
                    <span className="rounded-full border border-outline-variant/50 bg-surface-container-high px-md py-xs font-label text-label-sm text-on-surface">
                      {user.squad}
                    </span>
                  )}
                  <span className="rounded-full border border-outline-variant/50 bg-surface-container-high px-md py-xs font-label text-label-sm text-on-surface-variant">
                    Na equipe desde {joinedLabel(user.joinedAt)}
                  </span>
                  {user.leftAt && (
                    <span className="inline-flex items-center gap-xs rounded-full bg-surface-container-highest px-md py-xs font-label text-label-sm text-on-surface-variant">
                      <Icon name="workspace_premium" className="text-[16px]" />
                      Ex-Lenda · saiu em {joinedLabel(user.leftAt)}
                    </span>
                  )}
                </div>
              </div>
            </div>

          </div>

          {/* O espaçamento é do call site, e não do `MoodOfDay`: na Home ele
              vive dentro de um container com `gap`, e uma margem própria
              descolaria o termômetro de lá. Aqui as seções se empilham por
              margem — sem esta, o card de humor fica colado no que vem depois. */}
          {isOwnProfile && (
            <div className="mb-lg">
              <MoodOfDay />
            </div>
          )}

          {(hasActions || (isOwnProfile && arquivadas > 0)) && (
            <RetroActionsSection
              actions={actions}
              archivedCount={arquivadas}
              isOwnProfile={isOwnProfile}
              profileId={id ?? ""}
            />
          )}

          {/* Corpo bento: à esquerda o formulário de escrever feedback e,
              embaixo dele, a galeria de selos; à direita a lista do que a
              pessoa recebeu. Escrever e ler são tarefas diferentes — com o
              formulário no topo da lista, quem só queria ler rolava o
              formulário inteiro antes do primeiro feedback. A aba
              "Reconhecimentos" (histórico de votos) deixou de existir: o texto
              do voto vira feedback, então há uma lista só. */}
          <div className="grid grid-cols-12 items-start gap-lg">
            <div className="col-span-12 flex flex-col gap-lg lg:col-span-5">
              {/* Some sozinho para ADMIN e no próprio perfil — aí a galeria
                  volta a ser o primeiro card da coluna. */}
              <FeedbackComposer targetId={user.id} />

              <BadgeGallery
                badges={badges}
                emptyLabel={
                  isLead ? "Nenhum selo atribuído ainda." : "Nenhum selo conquistado ainda."
                }
                highlightId={highlightBadgeId}
                editable={isOwnProfile}
                onSaveFeatured={saveFeatured}
              />
            </div>

            {/* FeedbackSection já aplica col-span-12 lg:col-span-7 no seu root */}
            <FeedbackSection targetId={user.id} highlightId={highlightFeedbackId} />
          </div>
        </div>
      </div>
    </section>
  );
}
