# Destaques — seletor de setor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tela de Destaques (`/destaques`) ganha o mesmo seletor de setor da tela Lendas (PR
#10616): padrão o próprio setor do usuário, com opção "Todos os setores"; `THIRD_PARTY` nunca
troca (backend ignora o parâmetro).

**Architecture:** Sem migration. Reaproveita `GET /sectors` e o componente `Select`, já existentes
neste branch (empilhado sobre `feat/lendas-seletor-setor`). `listPublishedHighlights` já aceita
`sectorId` opcional — só a rota `GET /highlights` precisa expor o parâmetro, espelhando
exatamente a lógica de `GET /users/showcase`.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Vitest, React 18, TypeScript strict/ESM.

## Global Constraints

- Sem migration nesta feature.
- `pnpm db:up` precisa estar de pé antes de rodar testes da API.
- Mensagens ao usuário em pt-BR; identificadores em inglês.
- `THIRD_PARTY` nunca escolhe setor — enforcement no BACKEND (rota ignora o parâmetro pra esse
  papel), mesmo padrão de `GET /users/showcase`.
- Seletor é só na tela `/destaques` — nenhum outro componente (Home etc.) muda.
- Rode só o(s) arquivo(s) de teste alterado(s) durante a implementação; `pnpm test` completo só
  entra na verificação final (Task 3).

---

### Task 1: `GET /highlights` aceita `sectorId`

**Files:**
- Modify: `apps/api/src/routes/highlights.ts`
- Test: `apps/api/src/routes/highlights.test.ts`

**Interfaces:**
- Consumes: `listPublishedHighlights(sectorId?: string)` — **já existe e não muda**
  (`apps/api/src/services/highlight-service.ts:206`).
- Produces: `GET /highlights?sectorId=<id>|all`, consumido pela Task 2 (frontend).

- [ ] **Step 1: Escrever os testes (falhando)**

Modify `apps/api/src/routes/highlights.test.ts` — adicionar dentro de `describe('GET /highlights', ...)`,
depois do teste `'mostra só os destaques do próprio setor do usuário logado'`:

```ts
  it('?sectorId=<outro> mostra o destaque daquele setor', async () => {
    const app = buildApp(); await app.ready()
    const token = await devToken(app)
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-highlights-cross@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Destaques C (cross)', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    const bruno = await prisma.user.create({ data: { name: 'Bruno Cross', email: 'bruno-destaque-cross@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })
    await prisma.votingPeriod.create({
      data: { monthRef: '2026-08', startsAt: new Date('2026-08-01'), endsAt: new Date('2026-08-31'), status: 'CLOSED',
        sectorId: sectorB.id, winnerId: bruno.id, winnerVotes: 3, highlightText: 'oi', highlightImagePath: '/highlights/2026-08.png', highlightStatus: 'PUBLISHED' },
    })

    const res = await app.inject({ method: 'GET', url: `/highlights?sectorId=${sectorB.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const list = res.json().highlights as Array<{ monthRef: string }>
    expect(list.map((h) => h.monthRef)).toContain('2026-08')
    await app.close()
  })

  it('?sectorId=all mostra destaques de todos os setores', async () => {
    const app = buildApp(); await app.ready()
    const token = await devToken(app)
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-highlights-all@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Destaques D (all)', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    const bruno = await prisma.user.create({ data: { name: 'Bruno All', email: 'bruno-destaque-all@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })
    await prisma.votingPeriod.create({
      data: { monthRef: '2026-09', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-09-30'), status: 'CLOSED',
        sectorId: sectorB.id, winnerId: bruno.id, winnerVotes: 3, highlightText: 'oi', highlightImagePath: '/highlights/2026-09.png', highlightStatus: 'PUBLISHED' },
    })

    const res = await app.inject({ method: 'GET', url: '/highlights?sectorId=all', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const list = res.json().highlights as Array<{ monthRef: string }>
    expect(list.map((h) => h.monthRef)).toContain('2026-09')
    await app.close()
  })

  it('THIRD_PARTY: ?sectorId= é ignorado, sempre vê o próprio setor', async () => {
    const app = buildApp(); await app.ready()
    const admin = await prisma.user.create({ data: { name: 'Admin', email: 'admin-highlights-tp@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Destaques E (tp)', enabledFeatures: ['destaques'], roles: ['THIRD_PARTY'] }, admin.id, DEFAULT_COMPANY_ID)
    const bruno = await prisma.user.create({ data: { name: 'Bruno TP', email: 'bruno-destaque-tp@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })
    await prisma.votingPeriod.create({
      data: { monthRef: '2026-10', startsAt: new Date('2026-10-01'), endsAt: new Date('2026-10-31'), status: 'CLOSED',
        sectorId: sectorB.id, winnerId: bruno.id, winnerVotes: 3, highlightText: 'oi', highlightImagePath: '/highlights/2026-10.png', highlightStatus: 'PUBLISHED' },
    })
    const thirdParty = await prisma.user.create({
      data: { name: 'Terceirizado', email: 'terceirizado-destaque@empresa.com', passwordHash: 'x', role: 'THIRD_PARTY', enabledFeatures: ['destaques'] },
    })
    const token = signAccessToken(app, thirdParty, [])

    const res = await app.inject({ method: 'GET', url: `/highlights?sectorId=${sectorB.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const list = res.json().highlights as Array<{ monthRef: string }>
    expect(list.map((h) => h.monthRef)).not.toContain('2026-10')
    await app.close()
  })
```

Adicionar ao topo do arquivo: `import { signAccessToken } from '../lib/jwt'` (o arquivo já
importa `buildApp`, `prisma`, `createSector`, `DEFAULT_COMPANY_ID`).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/highlights.test.ts -t "sectorId"`
Expected: FAIL — a rota hoje ignora `?sectorId=`

- [ ] **Step 3: Implementar o parâmetro na rota**

Modify `apps/api/src/routes/highlights.ts` (arquivo completo):

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { listPublishedHighlights } from '../services/highlight-service'
import { toHighlightDTO } from '../lib/serialize'

const highlightsQuerySchema = z.object({ sectorId: z.string().optional() })

export async function highlightRoutes(app: FastifyInstance) {
  // Com ?sectorId=<id>, mostra outro setor (padrão: o próprio); ?sectorId=all mostra todos.
  // THIRD_PARTY nunca escolhe: o parâmetro é ignorado, sempre vê o próprio setor.
  app.get('/highlights', { onRequest: [app.authenticate, app.requireFeature('destaques')] }, async (request, reply) => {
    const parsed = highlightsQuerySchema.safeParse(request.query)
    const requestedSectorId = parsed.success ? parsed.data.sectorId : undefined
    const sectorId =
      request.user.role === 'THIRD_PARTY'
        ? request.user.sectorId
        : requestedSectorId === 'all'
          ? undefined
          : (requestedSectorId ?? request.user.sectorId)
    const entries = await listPublishedHighlights(sectorId)
    return reply.send({ highlights: entries.map(toHighlightDTO) })
  })
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api exec vitest run src/routes/highlights.test.ts`
Expected: PASS (todos, inclusive os 3 pré-existentes)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/highlights.ts apps/api/src/routes/highlights.test.ts
git commit -m "feat(api): GET /highlights aceita sectorId (all ou especifico); THIRD_PARTY ignora"
```

---

### Task 2: `HighlightsPage.tsx` — seletor de setor

**Files:**
- Modify: `apps/web/src/pages/HighlightsPage.tsx`
- Create: `apps/web/src/pages/HighlightsPage.test.tsx`

**Interfaces:**
- Consumes: `GET /sectors` → `{ sectors: SectorOptionDTO[] }` (já existe, branch base);
  `GET /highlights?sectorId=` (Task 1); `Select` de `apps/web/src/components/Select.tsx` (já
  existe, sem mudança); `useAuth()` de `../auth/AuthContext` (já existe, sem mudança).

- [ ] **Step 1: Escrever o teste (falhando)**

Create `apps/web/src/pages/HighlightsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/HighlightsPage.test.tsx`
Expected: FAIL — hoje não há seletor de setor nem chamada a `/sectors`, e a busca de highlights não
manda `sectorId` na query string

- [ ] **Step 3: Implementar o seletor em `HighlightsPage.tsx`**

Modify `apps/web/src/pages/HighlightsPage.tsx` (arquivo completo):

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { HighlightDTO, SectorOptionDTO } from "@legends/shared";
import { apiFetch } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/Icon";
import { Select } from "../components/Select";
import { HighlightsSkeleton } from "../components/Skeleton";

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
          className="mt-md inline-flex items-center gap-xs text-body-sm text-primary transition-colors hover:text-primary/80"
        >
          <Icon name="download" className="text-[18px]" />
          Salvar / compartilhar
        </a>
      )}
    </article>
  );
}

export function HighlightsPage() {
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
    <section className="mx-auto max-w-7xl p-lg md:p-xl">
      <header className="mb-xl flex flex-col justify-between gap-lg md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-sm text-primary">
            <Icon name="trophy" className="text-[20px]" />
            <span className="font-label text-label-md uppercase tracking-[0.18em]">
              Hall da fama
            </span>
          </div>
          <h2 className="mt-2 font-headline text-headline-xl text-on-surface">
            Destaques do mês
          </h2>
          <p className="mt-2 max-w-xl text-body-md text-on-surface-variant">
            As lendas que mais se destacaram a cada mês — reconhecimentos que
            marcam a excelência do time.
          </p>
        </div>
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
      </header>

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
    </section>
  );
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/pages/HighlightsPage.test.tsx`
Expected: PASS (5 testes)

- [ ] **Step 5: Typecheck do workspace web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/HighlightsPage.tsx apps/web/src/pages/HighlightsPage.test.tsx
git commit -m "feat(web): HighlightsPage ganha seletor de setor (padrao o proprio, com opcao todos)"
```

---

### Task 3: Verificação final

**Files:** nenhum (só execução)

- [ ] **Step 1: Subir o Postgres de teste**

Run: `pnpm db:up` (ou confirme que o container `legends-db` já está de pé)

- [ ] **Step 2: Rodar a suíte completa**

Run: `pnpm test`
Expected: todos os workspaces passam

- [ ] **Step 3: Typecheck de cada workspace**

Run: `pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: sucesso

- [ ] **Step 5: Revisão manual (se o dev server estiver disponível)**

Suba `pnpm dev`, entre em `/destaques` como usuário interno — confirme que o seletor aparece com o
próprio setor selecionado, que trocar pra outro setor troca a lista, e que "Todos os setores"
mistura todo mundo.
