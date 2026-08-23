import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { Mock } from "vitest";
import { HighlightsPage } from "./HighlightsPage";
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

/**
 * A listagem da votação virou a aba "Da votação" quando os Destaques do Mês
 * curados pela G&G entraram ao lado dela — por isso o clique na aba aqui. O
 * conteúdo e o comportamento do seletor de setor não mudaram.
 */
function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("tab", { name: /da votação/i }));
  return result;
}

const SECTORS = [
  { id: "sector-a", name: "Setor A" },
  { id: "sector-b", name: "Setor B" },
];

function highlight(monthRef: string, winnerName: string) {
  return {
    periodId: monthRef,
    monthRef,
    highlightMonthRef: null,
    winner: { id: monthRef, name: winnerName },
    winnerVotes: 1,
    text: null,
    imageUrl: null,
  };
}

describe("HighlightsPage — seletor de setor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockImplementation((path: string) => {
      if (path === "/sectors") return Promise.resolve({ sectors: SECTORS });
      // A aba de destaques curados monta junto com a página; devolver vazio
      // mantém estes casos falando só do seletor de setor da votação.
      if (path.startsWith("/monthly-highlights")) {
        return Promise.resolve({ monthRef: "2026-08", groups: [], total: 0, canManage: false });
      }
      if (path.startsWith("/highlights")) {
        const url = new URL(`http://x${path}`);
        const sectorId = url.searchParams.get("sectorId");
        if (sectorId === "sector-b") return Promise.resolve({ highlights: [highlight("2026-06", "Legend B")] });
        if (sectorId === "all") return Promise.resolve({ highlights: [highlight("2026-06", "Legend A"), highlight("2026-05", "Legend B")] });
        return Promise.resolve({ highlights: [highlight("2026-06", "Legend A")] });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
  });

  it("mostra o seletor pré-selecionado no setor do usuário, pra papel interno", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1", role: "LEGEND", sectorId: "sector-a" } });
    wrap(<HighlightsPage />);

    expect(await screen.findByText("Legend A")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /setor/i })).toHaveTextContent("Setor A");
  });

  it("trocar o setor no seletor refaz a busca com o novo sectorId", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1", role: "LEGEND", sectorId: "sector-a" } });
    wrap(<HighlightsPage />);
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
    wrap(<HighlightsPage />);
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
    wrap(<HighlightsPage />);

    expect(await screen.findByText("Legend A")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /setor/i })).not.toBeInTheDocument();
    expect(mockApiFetch).not.toHaveBeenCalledWith("/sectors");
  });

  it("lista destaques ordenados e mostra o vencedor de cada mês", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1", role: "LEGEND", sectorId: "sector-a" } });
    wrap(<HighlightsPage />);
    expect(await screen.findByText("Legend A")).toBeInTheDocument();
    expect(screen.getByText(/jun 2026/i)).toBeInTheDocument();
  });
});
