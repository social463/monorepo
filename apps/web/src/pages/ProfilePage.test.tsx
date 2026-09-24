import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, type Mock } from "vitest";
import { ProfilePage } from "./ProfilePage";
import { apiFetch } from "../lib/api";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, apiFetch: vi.fn() };
});

const setUser = vi.fn();
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Bruno Lima" }, setUser }),
}));

const mockApiFetch = apiFetch as unknown as Mock;

function setupFetch() {
  mockApiFetch.mockImplementation((path: string) => {
    if (path === "/me/featured-badges") {
      return Promise.resolve({ badges: [] });
    }
    if (path === "/users/u1/profile") {
      return Promise.resolve({
        user: {
          id: "u1",
          name: "Bruno Lima",
          email: "b@e.com",
          role: "LEGEND",
          position: "Backend",
          squad: "Core",
          photoUrl: null,
          active: true,
          sectorName: "Desenvolvimento de Produto",
          joinedAt: "2026-01-01T00:00:00.000Z",
        },
        stats: { totalFeedbacksReceived: 3, monthsWithFeedback: 2 },
        xp: {
          points: 1200,
          level: {
            name: "Prata",
            color: "#5F6B7A",
            next: "Ouro",
            min: 500,
            nextMin: 1500,
            remaining: 300,
            progress: 70,
          },
        },
        categoryBreakdown: [
          {
            categorySlug: "colaboracao", badgeCategoryId: null, badgeCategoryName: null, rewardPoints: null, rewardCoins: null,
            categoryName: "Colaboração",
            count: 2,
          },
        ],
        months: ["2026-06", "2026-05"],
        badges: [
          {
            id: "ub1",
            awardedAt: "2026-06-01T00:00:00.000Z",
            badge: {
              id: "b1",
              slug: "conector",
              name: "Conector do Time",
              description: "d",
              kind: "CATEGORY",
              iconKey: "link",
              threshold: 5,
              categorySlug: "colaboracao", badgeCategoryId: null, badgeCategoryName: null, rewardPoints: null, rewardCoins: null,
            },
          },
        ],
        actions: [
          {
            id: "a1",
            plan: "Documentar deploy",
            problem: "Daily foi cancelada sem aviso",
            note: null,
            dueDate: "2026-07-01",
            done: false,
            doneAt: null,
            sprint: 5,
            squad: "Core",
            roomId: "r1",
            auditStatus: null,
          },
        ],
        votingEnabled: true,
      });
    }
    if (path.startsWith("/users/u1/feedbacks")) {
      return Promise.resolve({
        feedbacks: [
          {
            id: "f1",
            author: {
              id: "u2",
              name: "Carla",
              email: "c@e.com",
              role: "LEGEND",
              position: null,
              squad: null,
              photoUrl: null,
              active: true,
              joinedAt: "2026-01-01T00:00:00.000Z",
            },
            message: "Ajudou no incidente.",
            category: "ELOGIO",
            categories: [{ id: "c1", name: "Colaboração" }],
            customCategory: null,
            createdAt: "2026-06-02T00:00:00.000Z",
            updatedAt: "2026-06-02T00:00:00.000Z",
            sharedAt: null,
            reactions: [],
            commentCount: 0,
          },
        ],
        hasMore: false,
      });
    }
    if (path === "/categories") {
      return Promise.resolve({ categories: [] });
    }
    if (path === "/celebrations") {
      return Promise.resolve({
        referenceDay: "2026-01-01",
        birthdays: { month: [], upcoming: [] },
        workAnniversaries: { month: [], upcoming: [] },
      });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/perfil/u1"]}>
        <Routes>
          <Route path="/perfil/:id" element={<ProfilePage />} />
          <Route path="/personagem" element={<div data-testid="editor-page" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFetch();
  });

  it("renderiza perfil, selos, categorias e os feedbacks recebidos", async () => {
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Bruno Lima" }),
    ).toBeInTheDocument();
    // O contador de feedbacks recebidos saiu junto com o "Impacto acumulado";
    // quem conta agora é o total no cabeçalho da lista.
    expect(screen.queryByText("Impacto acumulado")).not.toBeInTheDocument();
    expect(screen.getAllByText("Conector do Time").length).toBeGreaterThan(0);
    expect(await screen.findByText(/Ajudou no incidente/)).toBeInTheDocument();
    expect(screen.getAllByText("Colaboração").length).toBeGreaterThan(0);
  });

  it("mostra o chip com o nome do setor do dono do perfil", async () => {
    renderPage();
    expect(await screen.findByText("Desenvolvimento de Produto")).toBeInTheDocument();
  });

  it("mostra o nível do dono do perfil, com os pontos dele", async () => {
    renderPage();
    expect(await screen.findByText(/Prata · 1\.200 pontos/)).toBeInTheDocument();
  });

  it("sem nenhum ponto, não afirma nível nenhum", async () => {
    const base = mockApiFetch.getMockImplementation()!;
    mockApiFetch.mockImplementation(async (path: string, ...rest: unknown[]) => {
      const data = await base(path, ...rest);
      if (path !== "/users/u1/profile") return data;
      return {
        ...data,
        xp: {
          points: 0,
          level: { name: "Bronze", color: "#8C5A2B", next: "Prata", min: 0, nextMin: 500, remaining: 500, progress: 0 },
        },
      };
    });

    renderPage();

    await screen.findByRole("heading", { name: "Bruno Lima" });
    expect(screen.queryByText(/Bronze/)).not.toBeInTheDocument();
  });

  it("mostra galeria de selos e área de feedback no perfil de uma liderança (LEAD)", async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === "/users/u1/profile") {
        return Promise.resolve({
          user: {
            id: "u1",
            name: "Lucca Secco",
            email: "l@e.com",
            role: "LEAD",
            position: "Tech Lead",
            squad: "Liderança",
            photoUrl: null,
            active: true,
            joinedAt: "2026-01-01T00:00:00.000Z",
          },
          stats: { totalVotesReceived: 0, monthsRecognized: 0 },
          categoryBreakdown: [],
          months: [],
          votingEnabled: true,
          badges: [
            {
              id: "ub1",
              awardedAt: "2026-06-01T00:00:00.000Z",
              badge: {
                id: "b1",
                slug: "mentor",
                name: "Mentor",
                description: "d",
                kind: "CATEGORY",
                iconKey: "link",
                threshold: 0,
                categorySlug: null, badgeCategoryId: null, badgeCategoryName: null, rewardPoints: null, rewardCoins: null,
              },
            },
          ],
        });
      }
      if (path.startsWith("/users/u1/feedbacks"))
        return Promise.resolve({ feedbacks: [], hasMore: false });
      if (path.startsWith("/users/u1/votes"))
        return Promise.resolve({ votes: [], hasMore: false });
      if (path === "/me/team/vacations")
        return Promise.resolve({ groups: [] });
      if (path === "/celebrations") {
        return Promise.resolve({
          referenceDay: "2026-01-01",
          birthdays: { month: [], upcoming: [] },
          workAnniversaries: { month: [], upcoming: [] },
        });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Lucca Secco" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Galeria de selos")).toBeInTheDocument();
    expect(screen.getAllByText("Mentor").length).toBeGreaterThan(0);
    expect(await screen.findByText("Feedbacks")).toBeInTheDocument();
    expect(screen.queryByText("Impacto acumulado")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Histórico de reconhecimento"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Categorias reconhecidas"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Reconhecer/ }),
    ).not.toBeInTheDocument();
  });

  it("não há mais alternância: selos e feedbacks aparecem juntos", async () => {
    // A aba "Reconhecimentos" (histórico de votos) deixou de existir — o texto
    // do voto vira feedback quando o destaque do mês publica.
    renderPage();
    expect(await screen.findByRole("heading", { name: "Feedbacks" })).toBeInTheDocument();
    expect(screen.getByText("Galeria de selos")).toBeInTheDocument();
    // O resumo por categoria (barras) saiu do perfil: o que a pessoa recebeu
    // já aparece como chip em cada feedback da lista.
    expect(screen.queryByText("Categorias dos feedbacks")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconhecimentos" })).not.toBeInTheDocument();
    expect(screen.queryByText("Histórico de reconhecimento")).not.toBeInTheDocument();
  });

  // O perfil não é a porta da votação — quem vota chega pela navegação. O
  // mock deste describe tem votingEnabled: true de propósito: o atalho sumiu
  // para todo mundo, não só para setor sem votação.
  it("não tem atalho para a votação, mesmo com a votação ligada", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Bruno Lima" });
    expect(
      screen.queryByRole("link", { name: /Votar no Destaque/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the edit-avatar button on your own profile", async () => {
    renderPage();
    expect(
      await screen.findByRole("button", { name: "Editar avatar" }),
    ).toBeInTheDocument();
  });

  it("botão Editar avatar navega para a tela de personagem", async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Editar avatar" }),
    );
    expect(screen.getByTestId("editor-page")).toBeInTheDocument();
  });

  it("permite o próprio usuário escolher destaques", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Bruno Lima" });
    await userEvent.click(
      await screen.findByRole("button", { name: /escolher destaques/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Conector do Time/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /salvar/i }));

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/me/featured-badges",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ badgeIds: ["ub1"] }),
        }),
      ),
    );
  });

  it("mostra selo de ex-lenda com a data de saída no perfil", async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === "/users/u1/profile") {
        return Promise.resolve({
          user: {
            id: "u1",
            name: "Bruno Lima",
            email: "b@e.com",
            role: "LEGEND",
            position: "Backend",
            squad: "Core",
            photoUrl: null,
            active: false,
            joinedAt: "2026-01-01T00:00:00.000Z",
            leftAt: "2026-07-10T00:00:00.000Z",
          },
          stats: { totalVotesReceived: 0, monthsRecognized: 0 },
          categoryBreakdown: [],
          months: [],
          badges: [],
        });
      }
      if (path.startsWith("/users/u1/feedbacks"))
        return Promise.resolve({ feedbacks: [], hasMore: false });
      if (path.startsWith("/users/u1/votes"))
        return Promise.resolve({ votes: [], hasMore: false });
      if (path === "/celebrations") {
        return Promise.resolve({
          referenceDay: "2026-01-01",
          birthdays: { month: [], upcoming: [] },
          workAnniversaries: { month: [], upcoming: [] },
        });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Bruno Lima" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/ex-lenda/i)).toBeInTheDocument();
    expect(
      screen.getByText(/jul\.?\/2026|jul\.? de 2026|julho de 2026/i),
    ).toBeInTheDocument();
  });

  it("mostra problema, ação, squad e salva observação no próprio perfil", async () => {
    renderPage();
    expect(await screen.findByText("Ações de Retrospectivas")).toBeInTheDocument();
    expect(screen.getByText("Daily foi cancelada sem aviso")).toBeInTheDocument();
    expect(screen.getByText(/Ação:/)).toBeInTheDocument();
    expect(screen.getByText(/Documentar deploy/)).toBeInTheDocument();
    expect(screen.getByText("Core")).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText("Adicionar observação…");
    await userEvent.type(textarea, "Tratei com o time");
    fireEvent.blur(textarea);
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/retro/actions/a1",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );

    const checkbox = screen.getByRole("checkbox", { name: /concluída/i });
    expect(checkbox).not.toBeDisabled();
  });

  it("comemora com confete ao abrir o perfil de quem faz aniversário hoje", async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === "/celebrations") {
        return Promise.resolve({
          referenceDay: "2026-01-01",
          birthdays: {
            month: [],
            upcoming: [
              {
                user: { id: "u1", name: "Bruno Lima" },
                day: 1,
                month: 1,
                daysUntil: 0,
                observedDate: "2026-01-01",
              },
            ],
          },
          workAnniversaries: { month: [], upcoming: [] },
        });
      }
      if (path === "/me/featured-badges") return Promise.resolve({ badges: [] });
      if (path === "/users/u1/profile") {
        return Promise.resolve({
          user: {
            id: "u1",
            name: "Bruno Lima",
            email: "b@e.com",
            role: "LEGEND",
            position: "Backend",
            squad: "Core",
            photoUrl: null,
            active: true,
            joinedAt: "2026-01-01T00:00:00.000Z",
          },
          stats: { totalVotesReceived: 0, monthsRecognized: 0 },
          categoryBreakdown: [],
          months: [],
          badges: [],
          actions: [],
          votingEnabled: true,
        });
      }
      if (path.startsWith("/users/u1/feedbacks")) return Promise.resolve({ feedbacks: [], hasMore: false });
      if (path === "/categories") return Promise.resolve({ categories: [] });
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    renderPage();

    expect(await screen.findByTestId("birthday-confetti")).toBeInTheDocument();
  });
});

describe("ProfilePage — votar desligado no setor do perfil", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockImplementation((path: string) => {
      if (path === "/me/featured-badges") return Promise.resolve({ badges: [] });
      if (path === "/users/u1/profile") {
        return Promise.resolve({
          user: {
            id: "u1",
            name: "Bruno Lima",
            email: "b@e.com",
            role: "LEGEND",
            position: "Backend",
            squad: "Core",
            photoUrl: null,
            active: true,
            joinedAt: "2026-01-01T00:00:00.000Z",
          },
          stats: { totalFeedbacksReceived: 3, monthsWithFeedback: 2 },
          categoryBreakdown: [
            { categorySlug: "colaboracao", badgeCategoryId: null, badgeCategoryName: null, rewardPoints: null, rewardCoins: null, categoryName: "Colaboração", count: 2 },
          ],
          months: ["2026-06"],
          badges: [],
          actions: [],
          votingEnabled: false,
        });
      }
      if (path.startsWith("/users/u1/feedbacks")) return Promise.resolve({ feedbacks: [], hasMore: false });
      if (path === "/categories") return Promise.resolve({ categories: [] });
      if (path === "/celebrations") {
        return Promise.resolve({
          referenceDay: "2026-01-01",
          birthdays: { month: [], upcoming: [] },
          workAnniversaries: { month: [], upcoming: [] },
        });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
  });

  it("setor sem votação: Selos, Feedbacks e o resumo por feedback seguem de pé", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Bruno Lima" })).toBeInTheDocument();
    expect(screen.getByText("Galeria de selos")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Feedbacks" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Votar no Destaque/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconhecimentos" })).not.toBeInTheDocument();
    expect(screen.queryByText("Histórico de reconhecimento")).not.toBeInTheDocument();
  });
});
