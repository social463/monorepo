import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { Mock } from "vitest";
import { LegendsPage } from "./LegendsPage";
import { apiFetch } from "../lib/api";

const mockUseAuth = vi.fn();
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, apiFetch: vi.fn() };
});
const mockApiFetch = apiFetch as unknown as Mock;

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const SECTORS = [
  { id: "sector-a", name: "Setor A" },
  { id: "sector-b", name: "Setor B" },
];

function entry(id: string, name: string) {
  return {
    user: { id, name, position: null },
    feedbacksReceived: 1,
    badges: [],
  };
}

describe("LegendsPage — seletor de setor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockImplementation((path: string) => {
      if (path === "/sectors") return Promise.resolve({ sectors: SECTORS });
      if (path.startsWith("/users/showcase")) {
        const url = new URL(`http://x${path}`);
        const sectorId = url.searchParams.get("sectorId");
        if (sectorId === "sector-b") return Promise.resolve({ entries: [entry("u2", "Legend B")] });
        if (sectorId === "all") return Promise.resolve({ entries: [entry("u1", "Legend A"), entry("u2", "Legend B")] });
        return Promise.resolve({ entries: [entry("u1", "Legend A")] });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
  });

  it("mostra o seletor pré-selecionado no setor do usuário, pra papel interno", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1", role: "LEGEND", sectorId: "sector-a" } });
    wrap(<LegendsPage />);

    expect(await screen.findByText("Legend A")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /setor/i })).toHaveTextContent("Setor A");
  });

  it("trocar o setor no seletor refaz a busca com o novo sectorId", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1", role: "LEGEND", sectorId: "sector-a" } });
    wrap(<LegendsPage />);
    await screen.findByText("Legend A");

    const combo = screen.getByRole("combobox", { name: /setor/i });
    combo.click();
    const option = await screen.findByRole("option", { name: "Setor B" });
    option.click();

    await waitFor(() => expect(screen.getByText("Legend B")).toBeInTheDocument());
    expect(screen.queryByText("Legend A")).not.toBeInTheDocument();
  });

  it('"Todos os setores" refaz a busca sem filtro de setor', async () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1", role: "LEGEND", sectorId: "sector-a" } });
    wrap(<LegendsPage />);
    await screen.findByText("Legend A");

    const combo = screen.getByRole("combobox", { name: /setor/i });
    combo.click();
    const option = await screen.findByRole("option", { name: "Todos os setores" });
    option.click();

    await waitFor(() => expect(screen.getByText("Legend B")).toBeInTheDocument());
    expect(screen.getByText("Legend A")).toBeInTheDocument();
  });

  it("esconde o seletor pra THIRD_PARTY e não chama /sectors", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "u3", role: "THIRD_PARTY", sectorId: "sector-a" } });
    wrap(<LegendsPage />);

    expect(await screen.findByText("Legend A")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /setor/i })).not.toBeInTheDocument();
    expect(mockApiFetch).not.toHaveBeenCalledWith("/sectors");
  });
});

describe("LegendsPage — comportamento existente (filtro, busca, ex-lendas)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { id: "u1", role: "LEGEND", sectorId: "sector-a" } });
    mockApiFetch.mockImplementation((path: string) => {
      if (path === "/sectors") return Promise.resolve({ sectors: SECTORS });
      if (path.startsWith("/users/showcase") && path.includes("former=1")) {
        return Promise.resolve({
          entries: [
            {
              user: { id: "x", name: "Ex Fulano", position: null },
              feedbacksReceived: 3,
              badges: [],
            },
          ],
        });
      }
      if (path.startsWith("/users/showcase")) {
        return Promise.resolve({
          entries: [
            {
              user: { id: "u1", name: "Ana Souza", position: "Backend" },
              feedbacksReceived: 5,
              badges: [{ id: "ub1", awardedAt: "2026-06-01T00:00:00.000Z", badge: { id: "b1", slug: "reconhecido", name: "Reconhecido", description: "d", kind: "IMPACT", iconKey: "star", threshold: 1, categorySlug: null } }], badgeCategoryId: null, badgeCategoryName: null, rewardPoints: null, rewardCoins: null,
            },
            {
              user: { id: "u2", name: "Bruno Lima", position: "Frontend" },
              feedbacksReceived: 2,
              badges: [],
            },
            {
              user: { id: "u3", name: "Zé Sem Voto", position: "Backend" },
              feedbacksReceived: 0,
              badges: [],
            },
          ],
        });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
  });

  it("lista só quem tem selo e/ou reconhecimento", async () => {
    wrap(<LegendsPage />);
    expect(await screen.findByText("Ana Souza")).toBeInTheDocument();
    expect(screen.getByText("Bruno Lima")).toBeInTheDocument();
    // Sem selo e sem reconhecimento → não aparece
    expect(screen.queryByText("Zé Sem Voto")).not.toBeInTheDocument();
  });

  it("filtra por nome", async () => {
    wrap(<LegendsPage />);
    await screen.findByText("Ana Souza");
    fireEvent.change(screen.getByPlaceholderText(/filtrar por nome/i), { target: { value: "bruno" } });
    expect(screen.queryByText("Ana Souza")).not.toBeInTheDocument();
    expect(screen.getByText("Bruno Lima")).toBeInTheDocument();
  });

  it("mostra ex-lendas ao trocar para a aba Ex-Lendas", async () => {
    wrap(<LegendsPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("tab", { name: /ex-lendas/i }));
    expect(await screen.findByText("Ex Fulano")).toBeInTheDocument();
  });
});
