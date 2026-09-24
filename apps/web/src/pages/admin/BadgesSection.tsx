import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BADGE_KIND_LABELS } from "@legends/shared";
import type {
  AwardedBadgeDTO,
  BadgeCategoryDTO,
  BadgeDTO,
  RecognitionCategoryDTO,
  PublicUser,
  SectorDTO,
} from "@legends/shared";
import { ApiError, apiFetch } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { BadgeEmblem } from "../../components/BadgeEmblem";
import { BadgeArtPicker } from "../../components/BadgeArtPicker";
import { DEFAULT_ART_KEY } from "../../lib/badge-art";
import { Panel, inputCls, SectorAccordion, SectorChecklist } from "./shared";
import { Select } from "../../components/Select";
import { useAuth } from "../../auth/AuthContext";
import { BadgeCategoriesPanel } from "./BadgeCategoriesPanel";
import { BadgeClaimsQueue } from "./BadgeClaimsQueue";
import { BadgeImportPanel } from "./BadgeImportPanel";

type BadgeKind = BadgeDTO["kind"];

/**
 * Agrupa o catálogo por TEMA (Documento 4, seção 11.3), com contador.
 *
 * Substitui o agrupamento por setor: com ele, a pergunta "quantos selos de
 * Cultura existem" não tinha resposta na tela. O escopo por setor continua
 * visível, como etiqueta do item.
 *
 * Selo sem tema cai numa gaveta "Sem categoria" no fim — e não some, que é o
 * que aconteceria se o agrupamento fosse um `filter` por tema existente.
 */
export function groupByBadgeCategory(
  badges: BadgeDTO[],
  categories: BadgeCategoryDTO[],
): { key: string; name: string; items: BadgeDTO[] }[] {
  const grupos = categories.map((category) => ({
    key: category.id,
    name: category.name,
    items: badges.filter((badge) => badge.badgeCategoryId === category.id),
  }));
  const semTema = badges.filter(
    (badge) => !badge.badgeCategoryId || !categories.some((c) => c.id === badge.badgeCategoryId),
  );
  if (semTema.length > 0) {
    grupos.push({ key: "sem-categoria", name: "Sem categoria", items: semTema });
  }
  // Gaveta vazia não vira cabeçalho: contador zero não informa nada.
  return grupos.filter((grupo) => grupo.items.length > 0);
}

/** Etiqueta do escopo por setor de um selo não global. */
function sectorLabel(badge: BadgeDTO, sectors: SectorDTO[]): string {
  const nomes = badge.sectorIds
    .map((id) => sectors.find((sector) => sector.id === id)?.name)
    .filter(Boolean);
  return nomes.length > 0 ? nomes.join(", ") : "setor específico";
}

export const BADGE_KINDS: { value: BadgeKind; label: string }[] = [
  { value: "CATEGORY", label: "Por categoria" },
  { value: "IMPACT", label: "Por impacto (total de votos)" },
  { value: "RECURRENCE", label: "Recorrência (meses distintos)" },
  { value: "FEEDBACK", label: "Feedback (total de feedbacks feitos)" },
  { value: "TENURE", label: "Tempo de casa (anos)" },
  { value: "STREAK", label: "Ofensiva (dias úteis consecutivos)" },
  { value: "COURSE", label: "Aprendizado (cursos concluídos)" },
  { value: "PDI", label: "PDI (ações concluídas)" },
];

// ----- Selos por membro (concessão e revogação manual) -----
function MemberBadgesPanel({
  members,
  badges,
}: {
  members: PublicUser[];
  badges: BadgeDTO[];
}) {
  const queryClient = useQueryClient();
  const [memberId, setMemberId] = useState("");
  const [badgeId, setBadgeId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const userBadgesQuery = useQuery({
    queryKey: ["admin", "userBadges", memberId],
    queryFn: () =>
      apiFetch<{ badges: AwardedBadgeDTO[] }>(
        `/admin/users/${memberId}/badges`,
      ),
    enabled: Boolean(memberId),
  });

  const grant = useMutation({
    mutationFn: () =>
      apiFetch<{ badge: AwardedBadgeDTO }>(`/admin/users/${memberId}/badges`, {
        method: "POST",
        body: JSON.stringify({ badgeId }),
      }),
    onSuccess: () => {
      setError(null);
      setBadgeId("");
      queryClient.invalidateQueries({
        queryKey: ["admin", "userBadges", memberId],
      });
    },
    onError: (err) =>
      setError(
        err instanceof ApiError ? err.message : "Erro ao conceder selo.",
      ),
  });
  const revoke = useMutation({
    mutationFn: (userBadgeId: string) =>
      apiFetch<unknown>(`/admin/users/${memberId}/badges/${userBadgeId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({
        queryKey: ["admin", "userBadges", memberId],
      });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Erro ao revogar selo."),
  });

  const awarded = userBadgesQuery.data?.badges ?? [];

  return (
    <Panel title="Atribuir selo manualmente">
      <Select
        ariaLabel="Selecionar membro"
        placeholder="Selecione uma lenda..."
        className="mb-lg"
        value={memberId}
        options={members.map((member) => ({ value: member.id, label: member.name }))}
        onChange={(next) => {
          setMemberId(next);
          setBadgeId("");
          setError(null);
        }}
      />

      {memberId && (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (badgeId) grant.mutate();
            }}
            className="mb-lg flex flex-col gap-sm sm:flex-row"
          >
            <Select
              ariaLabel="Selecionar selo"
              placeholder="Selecione um selo…"
              className="sm:flex-1"
              value={badgeId}
              options={badges.map((badge) => ({ value: badge.id, label: badge.name }))}
              onChange={(next) => setBadgeId(next)}
            />
            <button
              type="submit"
              disabled={!badgeId || grant.isPending}
              className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              Conceder
            </button>
          </form>

          {error && (
            <p
              role="alert"
              className="mb-md flex items-center gap-sm text-body-sm text-error"
            >
              <Icon name="error" className="text-[16px]" />
              {error}
            </p>
          )}

          {awarded.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">
              Este membro ainda não tem selos.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {awarded.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-start gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md"
                >
                  <BadgeEmblem badge={entry.badge} size={40} />
                  <div className="min-w-0 flex-grow">
                    <p className="font-label text-label-md text-on-surface">
                      {entry.badge.name}
                    </p>
                    <p className="mt-1 font-label text-label-sm text-on-surface-variant">
                      {entry.source === "MANUAL" ? "Manual" : "Automático"}
                      {entry.awardedBy ? ` · por ${entry.awardedBy.name}` : ""}
                    </p>
                  </div>
                  {entry.source === "MANUAL" && (
                    <button
                      onClick={() => revoke.mutate(entry.id)}
                      aria-label={`Revogar selo ${entry.badge.name}`}
                      disabled={revoke.isPending}
                      className="shrink-0 rounded-md border border-error/40 p-1 text-error transition-colors hover:border-error disabled:opacity-50"
                    >
                      <Icon name="delete" className="text-[18px]" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

export function BadgesSection() {
  const { user } = useAuth();
  const isSubadmin = user?.role === "SUBADMIN";
  const queryClient = useQueryClient();
  const emptyBadge = {
    name: "",
    description: "",
    kind: "IMPACT" as BadgeKind,
    iconKey: DEFAULT_ART_KEY,
    threshold: 5,
    categorySlug: "",
    badgeCategoryId: "",
    // String vazia = "não concede". O campo numérico precisa poder ficar vazio,
    // e `0` digitado parece valor escolhido (Documento 4, seção 11.4).
    rewardPoints: "",
    rewardCoins: "",
    global: true,
    sectorIds: [] as string[],
  };
  const [badgeForm, setBadgeForm] = useState(emptyBadge);
  const [editingBadgeId, setEditingBadgeId] = useState<string | null>(null);
  const [badgeError, setBadgeError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [assigningBadge, setAssigningBadge] = useState<BadgeDTO | null>(null);

  const badgesQuery = useQuery({
    queryKey: ["admin", "badges"],
    queryFn: () => apiFetch<{ badges: BadgeDTO[] }>("/admin/badges"),
  });
  const sectorsQuery = useQuery({
    queryKey: ["admin", "sectors"],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>("/admin/sectors"),
  });
  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => apiFetch<{ users: PublicUser[] }>("/admin/users"),
  });
  const categoriesQuery = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => apiFetch<{ categories: RecognitionCategoryDTO[] }>("/admin/categories"),
  });
  // Temas do catálogo — outra lista, outro conceito (ver BadgeCategoriesPanel).
  const badgeCategoriesQuery = useQuery({
    queryKey: ["admin", "badgeCategories"],
    queryFn: () => apiFetch<{ categories: BadgeCategoryDTO[] }>("/admin/badge-categories"),
  });

  const createBadge = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ badge: BadgeDTO }>("/admin/badges", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setBadgeForm(emptyBadge);
      setEditingBadgeId(null);
      setBadgeError(null);
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["admin", "badges"] });
    },
    onError: (err) =>
      setBadgeError(
        err instanceof ApiError ? err.message : "Erro ao salvar selo.",
      ),
  });
  const updateBadge = useMutation({
    mutationFn: (vars: { id: string; data: Record<string, unknown> }) =>
      apiFetch<{ badge: BadgeDTO }>(`/admin/badges/${vars.id}`, {
        method: "PATCH",
        body: JSON.stringify(vars.data),
      }),
    onSuccess: () => {
      setBadgeForm(emptyBadge);
      setEditingBadgeId(null);
      setBadgeError(null);
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["admin", "badges"] });
    },
    onError: (err) =>
      setBadgeError(
        err instanceof ApiError ? err.message : "Erro ao salvar selo.",
      ),
  });
  const deleteBadge = useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/admin/badges/${id}`, { method: "DELETE" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["admin", "badges"] }),
  });

  const badges = badgesQuery.data?.badges ?? [];
  const categories = categoriesQuery.data?.categories ?? [];
  const badgeCategories = badgeCategoriesQuery.data?.categories ?? [];
  const sectors = sectorsQuery.data?.sectors ?? [];

  function startBadgeEdit(badge: BadgeDTO) {
    setEditingBadgeId(badge.id);
    setBadgeError(null);
    setShowForm(true);
    setBadgeForm({
      name: badge.name,
      description: badge.description,
      kind: badge.kind,
      iconKey: badge.iconKey,
      threshold: badge.threshold,
      categorySlug: badge.categorySlug ?? "",
      badgeCategoryId: badge.badgeCategoryId ?? "",
      rewardPoints: badge.rewardPoints == null ? "" : String(badge.rewardPoints),
      rewardCoins: badge.rewardCoins == null ? "" : String(badge.rewardCoins),
      global: badge.global,
      sectorIds: badge.sectorIds,
    });
  }

  function handleSubmitBadge(event: FormEvent) {
    event.preventDefault();
    if (
      !badgeForm.name.trim() ||
      !badgeForm.description.trim() ||
      !badgeForm.iconKey.trim()
    ) {
      setBadgeError("Nome, descrição e ícone são obrigatórios.");
      return;
    }
    const payload = {
      name: badgeForm.name.trim(),
      description: badgeForm.description.trim(),
      kind: badgeForm.kind,
      iconKey: badgeForm.iconKey.trim(),
      threshold: Number(badgeForm.threshold) || 0,
      categorySlug:
        badgeForm.kind === "CATEGORY" ? badgeForm.categorySlug || null : null,
      badgeCategoryId: badgeForm.badgeCategoryId || null,
      // Campo vazio vira `null`: não concede. `Number("")` é 0, e 0 seria
      // "configurado como zero" — que é outra coisa.
      rewardPoints: badgeForm.rewardPoints === "" ? null : Number(badgeForm.rewardPoints),
      rewardCoins: badgeForm.rewardCoins === "" ? null : Number(badgeForm.rewardCoins),
      global: badgeForm.global,
      sectorIds: badgeForm.global ? undefined : badgeForm.sectorIds,
    };
    if (editingBadgeId) {
      updateBadge.mutate({ id: editingBadgeId, data: payload });
    } else {
      createBadge.mutate(payload);
    }
  }

  return (
    <div className="flex flex-col gap-lg">
      {/* A fila vem primeiro: é a única parte da tela com alguém esperando do
          outro lado. */}
      <BadgeClaimsQueue />

      <Panel
        title="Catálogo de selos"
        action={
          <button
            type="button"
            onClick={() => {
              if (showForm) {
                setEditingBadgeId(null);
                setBadgeForm(emptyBadge);
                setBadgeError(null);
                setShowForm(false);
              } else {
                setShowForm(true);
              }
            }}
            className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
          >
            {showForm ? "Cancelar" : "+ Adicionar selo"}
          </button>
        }
      >
        {showForm && (
          <form
            onSubmit={handleSubmitBadge}
            className="mb-lg flex flex-col gap-sm rounded-lg border border-outline-variant/30 bg-surface-container-low p-md"
          >
            <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
              {editingBadgeId ? "Editar selo" : "Adicionar selo"}
            </p>
            <div className="grid gap-sm sm:grid-cols-2">
              <input
                className={inputCls}
                value={badgeForm.name}
                onChange={(e) =>
                  setBadgeForm({ ...badgeForm, name: e.target.value })
                }
                aria-label="Nome do selo"
                placeholder="Nome do selo"
              />
              <input
                className={`${inputCls} sm:col-span-2`}
                value={badgeForm.description}
                onChange={(e) =>
                  setBadgeForm({ ...badgeForm, description: e.target.value })
                }
                aria-label="Descrição do selo"
                placeholder="Descrição / critério"
              />
              <Select
                ariaLabel="Tipo do selo"
                value={badgeForm.kind}
                options={BADGE_KINDS.map((k) => ({ value: k.value, label: k.label }))}
                onChange={(next) =>
                  setBadgeForm({ ...badgeForm, kind: next as BadgeKind })
                }
              />
              <input
                className={inputCls}
                value={badgeForm.threshold}
                onChange={(e) =>
                  setBadgeForm({
                    ...badgeForm,
                    threshold: Number(e.target.value),
                  })
                }
                aria-label="Limiar (threshold)"
                placeholder={
                  badgeForm.kind === "TENURE"
                    ? "Limiar (nº de anos)"
                    : "Limiar (nº de votos/meses)"
                }
                type="number"
                min={0}
              />
              {badgeForm.kind === "CATEGORY" && (
                <Select
                  ariaLabel="Categoria do selo"
                  placeholder="Selecione a categoria…"
                  className="sm:col-span-2"
                  value={badgeForm.categorySlug}
                  options={categories.map((c) => ({ value: c.slug, label: c.name }))}
                  onChange={(next) =>
                    setBadgeForm({ ...badgeForm, categorySlug: next })
                  }
                />
              )}
              {/* Tema do catálogo: a gaveta em que o selo aparece. Não é a
                  categoria de reconhecimento do campo acima. */}
              <Select
                ariaLabel="Tema do catálogo"
                placeholder="Sem categoria"
                className="sm:col-span-2"
                value={badgeForm.badgeCategoryId}
                options={[
                  { value: "", label: "Sem categoria" },
                  ...badgeCategories
                    .filter((c) => c.active)
                    .map((c) => ({ value: c.id, label: c.name })),
                ]}
                onChange={(next) =>
                  setBadgeForm({ ...badgeForm, badgeCategoryId: next })
                }
              />
              <input
                className={inputCls}
                value={badgeForm.rewardPoints}
                onChange={(e) =>
                  setBadgeForm({ ...badgeForm, rewardPoints: e.target.value })
                }
                aria-label="Recompensa em Pontos"
                placeholder="Pontos ao conquistar (opcional)"
                type="number"
                min={0}
              />
              <input
                className={inputCls}
                value={badgeForm.rewardCoins}
                onChange={(e) =>
                  setBadgeForm({ ...badgeForm, rewardCoins: e.target.value })
                }
                aria-label="Recompensa em EMR Coins"
                placeholder="EMR Coins ao conquistar (opcional)"
                type="number"
                min={0}
              />
            </div>
            {!isSubadmin && (
            <label className="flex items-center gap-xs font-label text-label-sm text-on-surface">
              <input
                type="checkbox"
                aria-label="Global"
                checked={badgeForm.global}
                onChange={() => setBadgeForm({ ...badgeForm, global: !badgeForm.global })}
              />
              Global
            </label>
            )}
            {!isSubadmin && !badgeForm.global && (
              <SectorChecklist
                sectors={sectors}
                selected={new Set(badgeForm.sectorIds)}
                onToggle={(sectorId) => {
                  const next = new Set(badgeForm.sectorIds);
                  if (next.has(sectorId)) next.delete(sectorId);
                  else next.add(sectorId);
                  setBadgeForm({ ...badgeForm, sectorIds: [...next] });
                }}
              />
            )}
            <div className="flex flex-col gap-sm">
              <span className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
                Ilustração do centro
              </span>
              <div className="flex items-start gap-md">
                {/* prévia flutuante: acompanha o scroll ao percorrer a grade */}
                <div className="sticky top-20 z-10 flex shrink-0 flex-col items-center gap-xs">
                  <BadgeEmblem badge={badgeForm} size={112} />
                  <span className="max-w-[112px] truncate text-center font-label text-label-sm text-on-surface-variant">
                    {badgeForm.name.trim() || "Prévia"}
                  </span>
                </div>
                <div className="flex-grow">
                  <BadgeArtPicker
                    value={badgeForm.iconKey}
                    title={badgeForm.name}
                    onChange={(key) =>
                      setBadgeForm({ ...badgeForm, iconKey: key })
                    }
                  />
                </div>
              </div>
            </div>
            {badgeError && (
              <p
                role="alert"
                className="flex items-center gap-sm text-body-sm text-error"
              >
                <Icon name="error" className="text-[16px]" />
                {badgeError}
              </p>
            )}
            <div className="flex gap-sm">
              <button
                type="submit"
                className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
              >
                {editingBadgeId ? "Salvar selo" : "Criar selo"}
              </button>
              {editingBadgeId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingBadgeId(null);
                    setBadgeForm(emptyBadge);
                    setBadgeError(null);
                    setShowForm(false);
                  }}
                  className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface"
                >
                  Cancelar edição
                </button>
              )}
            </div>
          </form>
        )}

        <div className="flex flex-col gap-sm">
          {groupByBadgeCategory(badges, badgeCategories).map((group) => (
            <SectorAccordion key={group.key} name={group.name} count={group.items.length}>
              <ul className="grid gap-2 sm:grid-cols-2">
                {group.items.map((badge) => (
                  <li
                    key={badge.id}
                    className="flex items-start gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md"
                  >
                    <BadgeEmblem badge={badge} size={40} />
                    <div className="min-w-0 flex-grow">
                      <p className="font-label text-label-md text-on-surface">
                        {badge.name}
                      </p>
                      <p className="truncate text-body-sm text-on-surface-variant">
                        {badge.description}
                      </p>
                      <p className="mt-1 font-label text-label-sm text-on-surface-variant">
                        {BADGE_KIND_LABELS[badge.kind]} · limiar {badge.threshold}
                        {badge.categorySlug ? ` · ${badge.categorySlug}` : ""}
                        {/* O escopo por setor deixou de ser o eixo do
                            agrupamento, mas continua sendo regra de verdade:
                            vira etiqueta no item. */}
                        {!badge.global ? ` · ${sectorLabel(badge, sectors)}` : ""}
                      </p>
                      {(badge.rewardPoints != null || badge.rewardCoins != null) && (
                        <p className="mt-1 font-label text-label-sm text-primary">
                          {[
                            badge.rewardPoints != null ? `${badge.rewardPoints} pts` : null,
                            badge.rewardCoins != null ? `${badge.rewardCoins} coins` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-sm">
                      <button
                        onClick={() => setAssigningBadge(badge)}
                        aria-label={`Atribuir selo ${badge.name}`}
                        className="rounded-md border border-outline-variant/60 p-1 text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                      >
                        <Icon name="person_add" className="text-[18px]" />
                      </button>
                      <button
                        onClick={() => startBadgeEdit(badge)}
                        aria-label={`Editar selo ${badge.name}`}
                        className="rounded-md border border-outline-variant/60 p-1 text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                      >
                        <Icon name="edit" className="text-[18px]" />
                      </button>
                      <button
                        onClick={() => deleteBadge.mutate(badge.id)}
                        aria-label={`Excluir selo ${badge.name}`}
                        className="rounded-md border border-error/40 p-1 text-error transition-colors hover:border-error"
                      >
                        <Icon name="delete" className="text-[18px]" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </SectorAccordion>
          ))}
        </div>
      </Panel>

      {assigningBadge && (
        <AssignBadgePanel
          badge={assigningBadge}
          members={usersQuery.data?.users ?? []}
          onClose={() => setAssigningBadge(null)}
        />
      )}

      <BadgeCategoriesPanel />

      <BadgeImportPanel />

      <MemberBadgesPanel
        members={usersQuery.data?.users ?? []}
        badges={badges}
      />
    </div>
  );
}

/**
 * Concede UM selo a uma pessoa — a ação "Atribuir" do item do catálogo
 * (Documento 4, seção 11.3).
 *
 * Existe ao lado do `MemberBadgesPanel` porque as duas telas respondem a
 * perguntas opostas: lá se parte da pessoa ("que selos o fulano tem"), aqui se
 * parte do selo, que é a pergunta de quem está olhando um item do catálogo.
 * Fazer isso pelo painel de baixo obrigava a escolher a pessoa e reencontrar o
 * selo numa lista de todos.
 */
function AssignBadgePanel({
  badge,
  members,
  onClose,
}: {
  badge: BadgeDTO;
  members: PublicUser[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [memberId, setMemberId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const grant = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(`/admin/users/${memberId}/badges`, {
        method: "POST",
        body: JSON.stringify({ badgeId: badge.id }),
      }),
    onSuccess: () => {
      setError(null);
      setDone(members.find((m) => m.id === memberId)?.name ?? "a pessoa");
      setMemberId("");
      queryClient.invalidateQueries({ queryKey: ["admin", "userBadges"] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Erro ao conceder selo."),
  });

  return (
    <Panel
      title={`Atribuir "${badge.name}"`}
      action={
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
        >
          Fechar
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-sm">
        <Select
          ariaLabel="Pessoa que recebe o selo"
          placeholder="Selecione a pessoa…"
          className="min-w-[16rem] flex-grow"
          value={memberId}
          options={members.map((member) => ({ value: member.id, label: member.name }))}
          onChange={setMemberId}
        />
        <button
          type="button"
          disabled={!memberId || grant.isPending}
          onClick={() => grant.mutate()}
          className="rounded-md bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          Atribuir
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-sm flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {error}
        </p>
      )}
      {done && !error && (
        <p role="status" className="mt-sm text-body-sm text-primary">
          Selo concedido a {done}.
        </p>
      )}
    </Panel>
  );
}
