import { render, screen, waitFor, within } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import type { ReactNode } from "react";
import { App } from "./App";
import { apiFetch } from "./lib/api";

const adminUser: {
  id: string;
  name: string;
  role: string;
  position: string;
  photoUrl: string | null;
  sectorId: string;
  adminAccess?: boolean;
  sectorFeatures?: string[];
  enabledFeatures?: string[];
} = {
  id: "a1",
  name: "Admin",
  role: "ADMIN",
  position: "Gestão",
  photoUrl: null,
  sectorId: "sector-a",
};

vi.mock("./auth/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: adminUser,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  }),
}));

vi.mock("./lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/api")>();
  return { ...actual, apiFetch: vi.fn() };
});

// A tela /personagem monta preview e miniaturas reais (canvas + imagens do
// catálogo LPC); mockamos como nos outros testes do editor para manter o
// teste de rota rápido e sem ruído de assets ausentes no jsdom.
vi.mock("./components/character-editor/LayerThumb", () => ({
  LayerThumb: () => <div />,
}));
vi.mock("./components/CharacterPreview", () => ({
  CharacterPreview: () => <div data-testid="preview" />,
}));
vi.mock("./hooks/useCharacterPortrait", async (orig) => ({
  ...(await orig()),
  useCharacterPortrait: () => "data:image/png;base64,x",
}));

const mockApiFetch = apiFetch as unknown as Mock;

describe("App — navegação do admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminUser.role = "ADMIN";
    mockApiFetch.mockResolvedValue({
      users: [],
      votes: [],
      periods: [],
      badges: [],
      period: null,
      company: { id: "company-a", name: "Empresa Teste" },
      roots: [],
      totalPeople: 0,
    });
    window.history.pushState({}, "", "/");
  });

  it("admin cai no painel Admin por padrão, com a barra mostrando os grupos do console", async () => {
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /dashboard/i }),
    ).toBeInTheDocument();
    // Mesma barra do resto do app, com outro conteúdo — não há mais sidebar
    // dedicada ao console.
    const nav = screen.getByRole("navigation", { name: /navegação principal/i });
    expect(within(nav).getByRole("button", { name: /organização/i })).toBeInTheDocument();
  });

  it("admin acessando /time diretamente vê a página com a navegação lateral principal", async () => {
    window.history.pushState({}, "", "/time");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Organograma" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: /navegação principal/i }),
    ).toBeInTheDocument();
  });

  it("usuário autenticado navegando para /personagem renderiza a tela de edição", async () => {
    window.history.pushState({}, "", "/personagem");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Editar personagem" }),
    ).toBeInTheDocument();
  });

  // O link antigo passou a levar à tela própria de aniversariantes, que é onde
  // a pergunta "de quem é o mês" é respondida — o calendário responde outra.
  it("/ranking abre a tela de ranking sem exigir feature nenhuma", async () => {
    window.history.pushState({}, "", "/ranking");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Ranking" })).toBeInTheDocument();
  });

  it("/admin/engajamento abre a leitura da economia de XP", async () => {
    mockApiFetch.mockResolvedValue({
      overview: {
        monthRef: "2026-08",
        people: 3,
        scored: 2,
        activeThisMonth: 1,
        totalPoints: 100,
        pointsThisMonth: 40,
        byEvent: [],
        bySector: [],
        idle: [],
        top: [],
      },
    });
    window.history.pushState({}, "", "/admin/engajamento");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Engajamento" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Pessoas no ranking")).toBeInTheDocument();
  });

  it("/aniversarios redireciona para a tela de aniversariantes", async () => {
    window.history.pushState({}, "", "/aniversarios");
    render(<App />);

    // A tela precisa ter renderizado de fato (não só a URL ter mudado).
    expect(
      await screen.findByRole("heading", { name: /^aniversariantes$/i }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/aniversariantes");
  });
});

describe("App — navegação do subadmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({
      users: [],
      votes: [],
      periods: [],
      badges: [],
      period: null,
      company: { id: "company-a", name: "Empresa Teste" },
      roots: [],
      totalPeople: 0,
    });
  });

  it("redireciona subadmin para o Dashboard ao tentar abrir /admin/setores diretamente", async () => {
    adminUser.role = "SUBADMIN";
    window.history.pushState({}, "", "/admin/setores");
    render(<App />);
    expect(await screen.findByRole("heading", { name: /dashboard/i })).toBeInTheDocument();
  });

  it("redireciona subadmin para o Dashboard ao tentar abrir /admin/administradores diretamente", async () => {
    adminUser.role = "SUBADMIN";
    window.history.pushState({}, "", "/admin/administradores");
    render(<App />);
    expect(await screen.findByRole("heading", { name: /dashboard/i })).toBeInTheDocument();
  });

  it("subadmin cai no painel Admin ao acessar a raiz (/)", async () => {
    adminUser.role = "SUBADMIN";
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(await screen.findByRole("heading", { name: /dashboard/i })).toBeInTheDocument();
  });

  it("subadmin é redirecionado para o Admin ao tentar abrir /votar (DevOnly)", async () => {
    adminUser.role = "SUBADMIN";
    window.history.pushState({}, "", "/votar");
    render(<App />);
    expect(await screen.findByRole("heading", { name: /dashboard/i })).toBeInTheDocument();
  });

  it("subadmin acessando /time diretamente vê a página, mesmo sem a feature habilitada no setor (bypassa o FeatureGate como o admin)", async () => {
    adminUser.role = "SUBADMIN";
    window.history.pushState({}, "", "/time");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Organograma" }),
    ).toBeInTheDocument();
  });
});

// Acesso administrativo delegado — o painel aberto para uma conta específica,
// sem trocar a `role`. Spec: docs/superpowers/specs/2026-08-15-acesso-admin-delegado-design.md
describe("App — acesso administrativo delegado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminUser.role = "LEGEND";
    adminUser.adminAccess = true;
    adminUser.sectorFeatures = ["time"];
    adminUser.enabledFeatures = [];
    mockApiFetch.mockResolvedValue({
      users: [],
      votes: [],
      periods: [],
      badges: [],
      period: null,
      company: { id: "company-a", name: "Empresa Teste" },
      roots: [],
      totalPeople: 0,
    });
  });

  afterEach(() => {
    adminUser.adminAccess = false;
  });

  it("abre o painel de admin mesmo sendo LEGEND", async () => {
    window.history.pushState({}, "", "/admin");
    render(<App />);
    expect(await screen.findByRole("heading", { name: /dashboard/i })).toBeInTheDocument();
  });

  // O poder delegado é PLENO: onde o subadmin é barrado, o delegado entra.
  it("entra nas telas de ADMIN pleno, onde o subadmin é redirecionado", async () => {
    window.history.pushState({}, "", "/admin/setores");
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: /navegação principal/i });
    // O grupo Sistema só existe para quem é admin pleno.
    expect(within(nav).getByRole("button", { name: /sistema/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /dashboard/i })).not.toBeInTheDocument();
  });

  // Dentro do console, a volta para o lado de colaborador vive na topbar.
  it("oferece a volta para a Home na barra, dentro do /admin", async () => {
    window.history.pushState({}, "", "/admin");
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: /navegação principal/i });
    expect(within(nav).getByRole("link", { name: /voltar para a home/i })).toHaveAttribute("href", "/");
  });

  // O ponto do mecanismo: fora do /admin ela continua sendo colaboradora, com a
  // navegação de sempre — e o Admin entra como mais um destino.
  it("mantém a navegação de colaborador, com o item Admin somado a ela", async () => {
    window.history.pushState({}, "", "/time");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Organograma" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: /navegação principal/i });
    expect(within(nav).getByRole("link", { name: /^admin$/i })).toBeInTheDocument();
  });
});

// Entrada da Liderança para o organograma: `/lideranca/organograma` mostra só
// os liderados diretos. A visão completa da empresa continua em `/time`.
describe("App — organograma pela área de Liderança", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminUser.role = "MANAGER";
    adminUser.adminAccess = false;
    adminUser.sectorFeatures = ["time"];
    adminUser.enabledFeatures = [];
    mockApiFetch.mockResolvedValue({
      company: { id: "company-a", name: "Empresa Teste" },
      roots: [],
      totalPeople: 0,
    });
  });

  afterEach(() => {
    adminUser.sectorFeatures = undefined;
  });

  it("líder abre o recorte do próprio time, e não o da empresa", async () => {
    window.history.pushState({}, "", "/lideranca/organograma");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Organograma do meu time" }),
    ).toBeInTheDocument();
    expect(mockApiFetch).toHaveBeenCalledWith("/organization/direct-reports");
  });

  it("colaborador sem liderança é barrado, como no resto da área de Liderança", async () => {
    adminUser.role = "LEGEND";
    window.history.pushState({}, "", "/lideranca/organograma");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(
      screen.queryByRole("heading", { name: "Organograma do meu time" }),
    ).not.toBeInTheDocument();
  });
});
