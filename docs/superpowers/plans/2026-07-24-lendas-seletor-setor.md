# Lendas — seletor de setor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A galeria "Lendas" continua com o setor do próprio usuário como padrão, mas ganha um
seletor pra ver outro setor específico ou "Todos os setores" — restrito a papéis internos
(THIRD_PARTY nunca troca, nem via UI nem via API direta).

**Architecture:** Sem migration. Nova rota enxuta `GET /sectors` (não-admin, só `{id, name}`) pra
popular o seletor. `GET /users/showcase` ganha `?sectorId=` opcional, repassado pro `listShowcase`
que já aceita esse filtro opcionalmente hoje. `LegendsPage.tsx` ganha um `Select` (componente já
existente) que entra na `queryKey` da busca.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Vitest, React 18, TypeScript strict/ESM.

## Global Constraints

- Sem migration nesta feature.
- `pnpm db:up` precisa estar de pé antes de rodar testes da API.
- Mensagens ao usuário em pt-BR; identificadores em inglês.
- `THIRD_PARTY` nunca escolhe setor — enforcement no BACKEND (rota ignora o parâmetro pra esse
  papel), não só escondendo o seletor na UI.
- Rode só o(s) arquivo(s) de teste alterado(s) durante a implementação; `pnpm test` completo só
  entra na verificação final (Task 4).

---

### Task 1: `GET /sectors` — lista enxuta de setores

**Files:**
- Create: `apps/api/src/routes/sectors.ts`
- Modify: `apps/api/src/app.ts` (registrar a rota)
- Modify: `packages/shared/src/sector.ts` (novo tipo `SectorOptionDTO`)
- Modify: `packages/shared/src/index.ts` — **nenhuma mudança necessária**: `packages/shared/src/index.ts:33`
  já tem `export * from './sector'`, então `SectorOptionDTO` fica exportado automaticamente.
- Test: `apps/api/src/routes/sectors.test.ts`

**Interfaces:**
- Produces: `GET /sectors` → `{ sectors: SectorOptionDTO[] }`, consumido pela Task 3 (frontend).
- Produces: `SectorOptionDTO { id: string; name: string }` em `@legends/shared`.

- [ ] **Step 1: Escrever o teste (falhando)**

Create `apps/api/src/routes/sectors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { createSector } from '../services/sector-service'

async function registerAndToken(app: ReturnType<typeof buildApp>, email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: email.split('@')[0], email, password: 'changeme123' },
  })
  return res.json().accessToken as string
}

describe('GET /sectors', () => {
  it('lista setores ativos com só id e name (sem enabledFeatures/roles)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'sectors-list@empresa.com')
    const admin = await prisma.user.create({ data: { name: 'Admin', email: 'admin-sectors-list@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const extra = await createSector({ name: 'Setor Extra Listagem', enabledFeatures: ['votar'], roles: ['LEGEND'] }, admin.id, DEFAULT_COMPANY_ID)

    const res = await app.inject({ method: 'GET', url: '/sectors', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const sectors = res.json().sectors as Array<{ id: string; name: string }>
    const names = sectors.map((s) => s.name)
    expect(names).toContain('Setor Extra Listagem')
    expect(names).toContain('Desenvolvimento de Produto')
    const found = sectors.find((s) => s.id === extra.id)
    expect(found).toEqual({ id: extra.id, name: 'Setor Extra Listagem' })
    await app.close()
  })

  it('não lista setor inativo', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'sectors-inactive@empresa.com')
    const admin = await prisma.user.create({ data: { name: 'Admin', email: 'admin-sectors-inactive@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const inativo = await createSector({ name: 'Setor Desativado', enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
    await prisma.sector.update({ where: { id: inativo.id }, data: { active: false } })

    const res = await app.inject({ method: 'GET', url: '/sectors', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const names = (res.json().sectors as Array<{ name: string }>).map((s) => s.name)
    expect(names).not.toContain('Setor Desativado')
    await app.close()
  })

  it('rejeita requisição sem autenticação (401)', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/sectors' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/sectors.test.ts`
Expected: FAIL — `Cannot find module '../routes/sectors'` (a rota ainda não existe, `buildApp` nem
sabe da URL `/sectors`, então o teste de listagem falha por 404)

- [ ] **Step 3: Criar a rota**

Create `apps/api/src/routes/sectors.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'

export async function sectorRoutes(app: FastifyInstance) {
  app.get('/sectors', { onRequest: [app.authenticate] }, async (_request, reply) => {
    const sectors = await prisma.sector.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    return reply.send({ sectors })
  })
}
```

- [ ] **Step 4: Registrar a rota em `app.ts`**

Modify `apps/api/src/app.ts` — adicionar o import junto aos demais (logo depois da linha do
`import { categoryRoutes } from './routes/categories'`, linha 13):

```ts
import { categoryRoutes } from './routes/categories'
import { sectorRoutes } from './routes/sectors'
```

E o registro junto aos demais `app.register(...)` (logo depois de `app.register(categoryRoutes)`,
linha 91):

```ts
  app.register(categoryRoutes)
  app.register(sectorRoutes)
```

- [ ] **Step 5: Adicionar `SectorOptionDTO` ao pacote compartilhado**

Modify `packages/shared/src/sector.ts` — adicionar ao final do arquivo:

```ts
/** Versão enxuta de SectorDTO pra popular seletores — sem enabledFeatures/roles (dado de admin). */
export interface SectorOptionDTO {
  id: string
  name: string
}
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api exec vitest run src/routes/sectors.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/sectors.ts apps/api/src/routes/sectors.test.ts apps/api/src/app.ts packages/shared/src/sector.ts
git commit -m "feat(api): rota GET /sectors (lista enxuta pra seletor, sem dado de admin)"
```

---

### Task 2: `GET /users/showcase` aceita `sectorId` (com bloqueio pra THIRD_PARTY)

**Files:**
- Modify: `apps/api/src/routes/users.ts`
- Test: `apps/api/src/routes/users.test.ts`

**Interfaces:**
- Consumes: `listShowcase(opts: { former?: boolean; sectorId?: string })` — **já existe e não
  muda** (`apps/api/src/services/profile-service.ts:26`).
- Produces: `GET /users/showcase?sectorId=<id>|all` — consumido pela Task 3 (frontend).

- [ ] **Step 1: Escrever os testes (falhando)**

Modify `apps/api/src/routes/users.test.ts` — dentro de `describe('GET /users/showcase', ...)`,
depois do teste `'mostra só a galeria do próprio setor do usuário logado'`, adicionar:

```ts
  it('?sectorId=<outro> mostra a galeria daquele setor', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'viewer-cross@empresa.com')
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-users-showcase-cross@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Showcase C (cross)', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    await prisma.user.create({ data: { name: 'Do Outro Setor Cross', email: 'outro-setor-cross@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })

    const res = await app.inject({ method: 'GET', url: `/users/showcase?sectorId=${sectorB.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const entries = res.json().entries as Array<{ user: { name: string } }>
    expect(entries.map((e) => e.user.name)).toContain('Do Outro Setor Cross')
    await app.close()
  })

  it('?sectorId=all mostra a galeria de todos os setores', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'viewer-all@empresa.com')
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-users-showcase-all@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Showcase D (all)', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    await prisma.user.create({ data: { name: 'Do Outro Setor All', email: 'outro-setor-all@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })

    const res = await app.inject({ method: 'GET', url: '/users/showcase?sectorId=all', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const entries = res.json().entries as Array<{ user: { name: string } }>
    expect(entries.map((e) => e.user.name)).toContain('Do Outro Setor All')
    await app.close()
  })

  it('THIRD_PARTY: ?sectorId= é ignorado, sempre vê o próprio setor', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await prisma.user.create({ data: { name: 'Admin', email: 'admin-users-showcase-tp@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Showcase E (tp)', enabledFeatures: ['lendas'], roles: ['THIRD_PARTY'] }, admin.id, DEFAULT_COMPANY_ID)
    await prisma.user.create({ data: { name: 'Do Outro Setor TP', email: 'outro-setor-tp@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })
    const thirdParty = await prisma.user.create({
      data: { name: 'Terceirizado', email: 'terceirizado-showcase@empresa.com', passwordHash: 'x', role: 'THIRD_PARTY', enabledFeatures: ['lendas'] },
    })
    // POST /auth/register sempre cria LEGEND (não dá pra registrar THIRD_PARTY por ali) e
    // /auth/login exige a senha batendo com o hash — geramos o token do mesmo jeito que as
    // rotas fazem, com signAccessToken, sem passar por login HTTP.
    const token = signAccessToken(app, thirdParty, [])

    const res = await app.inject({ method: 'GET', url: `/users/showcase?sectorId=${sectorB.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const entries = res.json().entries as Array<{ user: { name: string } }>
    expect(entries.map((e) => e.user.name)).not.toContain('Do Outro Setor TP')
    await app.close()
  })
```

Adicione `import { signAccessToken } from '../lib/jwt'` ao topo de `users.test.ts` (arquivo já
importa `buildApp`, `prisma`, `createSector`, `DEFAULT_COMPANY_ID` — só falta esse).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/users.test.ts -t "sectorId"`
Expected: FAIL — a rota hoje ignora `?sectorId=` (Zod schema não aceita o campo, sempre cai no
setor do próprio JWT)

- [ ] **Step 3: Implementar o parâmetro na rota**

Modify `apps/api/src/routes/users.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { listShowcase } from '../services/profile-service'
import { toAwardedBadgeDTO, toPublicUser } from '../lib/serialize'

const showcaseQuerySchema = z.object({ former: z.string().optional(), sectorId: z.string().optional() })

export async function userRoutes(app: FastifyInstance) {
  app.get('/users', { onRequest: [app.authenticate] }, async (request, reply) => {
    const users = await prisma.user.findMany({
      // Time: colegas do mesmo setor, menos admins. Inclui lideranças (LEAD), que fazem parte do
      // time e têm perfil, mas não recebem votos (filtradas na tela de votação).
      where: { active: true, role: { notIn: ['ADMIN', 'SUBADMIN'] }, id: { not: request.user.sub }, sectorId: request.user.sectorId },
      orderBy: { name: 'asc' },
    })
    return reply.send({ users: users.map((u) => toPublicUser(u)) })
  })

  // Galeria de conquistas: devs ativos com reconhecimentos e selos agregados.
  // Com ?former=1 (ou true), retorna ex-lendas em vez dos ativos.
  // Com ?sectorId=<id>, mostra outro setor (padrão: o próprio); ?sectorId=all mostra todos.
  // THIRD_PARTY nunca escolhe: o parâmetro é ignorado, sempre vê o próprio setor.
  app.get('/users/showcase', { onRequest: [app.authenticate, app.requireFeature('lendas')] }, async (request, reply) => {
    const parsed = showcaseQuerySchema.safeParse(request.query)
    const former = parsed.success ? parsed.data.former : undefined
    const requestedSectorId = parsed.success ? parsed.data.sectorId : undefined
    const sectorId =
      request.user.role === 'THIRD_PARTY'
        ? request.user.sectorId
        : requestedSectorId === 'all'
          ? undefined
          : (requestedSectorId ?? request.user.sectorId)
    const rows = await listShowcase({
      former: former === '1' || former === 'true',
      sectorId,
    })
    return reply.send({
      entries: rows.map((row) => ({
        user: toPublicUser(row.user),
        recognitions: row.recognitions,
        badges: row.badges.map(toAwardedBadgeDTO),
      })),
    })
  })
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api exec vitest run src/routes/users.test.ts`
Expected: PASS (todos, inclusive os pré-existentes)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/users.ts apps/api/src/routes/users.test.ts
git commit -m "feat(api): GET /users/showcase aceita sectorId (all ou especifico); THIRD_PARTY ignora"
```

---

### Task 3: `LegendsPage.tsx` — seletor de setor

**Files:**
- Modify: `apps/web/src/pages/LegendsPage.tsx`
- Create: `apps/web/src/pages/LegendsPage.test.tsx`

**Interfaces:**
- Consumes: `GET /sectors` → `{ sectors: SectorOptionDTO[] }` (Task 1);
  `GET /users/showcase?sectorId=` (Task 2); `Select` de `apps/web/src/components/Select.tsx`
  (`{ options: { value, label }[], value, onChange, ariaLabel }`, já existe, sem mudança);
  `useAuth()` de `../auth/AuthContext` (já existe, sem mudança) — `user.sectorId` e `user.role`.

- [ ] **Step 1: Escrever o teste (falhando)**

Create `apps/web/src/pages/LegendsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    recognitions: 1,
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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/LegendsPage.test.tsx`
Expected: FAIL — hoje não há seletor de setor nem chamada a `/sectors`, e a busca de showcase não
manda `sectorId` na query string

- [ ] **Step 3: Implementar o seletor em `LegendsPage.tsx`**

Modify `apps/web/src/pages/LegendsPage.tsx` (arquivo completo — é pequeno, 112 linhas hoje):

```tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SectorOptionDTO, ShowcaseEntry } from "@legends/shared";
import { apiFetch } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/Icon";
import { Select } from "../components/Select";
import { LegendsSkeleton } from "../components/Skeleton";
import { LegendCard } from "../components/LegendCard";

const ALL_SECTORS = "all";

export function LegendsPage() {
  const { user } = useAuth();
  const isThirdParty = user?.role === "THIRD_PARTY";
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"ativas" | "ex">("ativas");
  const [sectorId, setSectorId] = useState<string>(user?.sectorId ?? ALL_SECTORS);
  const isFormer = tab === "ex";

  const sectorsQuery = useQuery({
    queryKey: ["sectors"],
    queryFn: () => apiFetch<{ sectors: SectorOptionDTO[] }>("/sectors"),
    enabled: !isThirdParty,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["showcase", tab, sectorId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (isFormer) params.set("former", "1");
      if (!isThirdParty) params.set("sectorId", sectorId);
      const qs = params.toString();
      return apiFetch<{ entries: ShowcaseEntry[] }>(`/users/showcase${qs ? `?${qs}` : ""}`);
    },
  });

  const entries = data?.entries ?? [];
  // Só aparecem na galeria quem já tem selo(s) e/ou reconhecimento(s).
  const recognized = useMemo(
    () => entries.filter((e) => e.recognitions > 0 || e.badges.length > 0),
    [entries],
  );
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return recognized;
    return recognized.filter(
      (e) =>
        e.user.name.toLowerCase().includes(term) ||
        (e.user.position ?? "").toLowerCase().includes(term),
    );
  }, [recognized, query]);

  const sectorOptions = [
    { value: ALL_SECTORS, label: "Todos os setores" },
    ...(sectorsQuery.data?.sectors ?? []).map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <section className="mx-auto max-w-7xl p-lg md:p-xl">
      <header className="mb-xl flex flex-col justify-between gap-lg md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-sm text-primary">
            <Icon name="diversity_3" className="text-[20px]" />
            <span className="font-label text-label-md uppercase tracking-[0.18em]">
              Comunidade &amp; legado
            </span>
          </div>
          <h2 className="mt-2 font-headline text-headline-xl text-on-surface">
            Nosso time de lendas
          </h2>
          <p className="mt-2 max-w-xl text-body-md text-on-surface-variant">
            Conheça as lendas por trás da plataforma e as conquistas que marcam
            a excelência técnica do time.
          </p>
        </div>
        <div className="flex w-full flex-col gap-sm md:w-96">
          {!isThirdParty && (
            <Select
              ariaLabel="Setor"
              value={sectorId}
              onChange={setSectorId}
              options={sectorOptions}
            />
          )}
          <label className="group relative block w-full">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-on-surface-variant transition-colors group-focus-within:text-primary">
              <Icon name="search" className="text-[20px]" />
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrar por nome ou cargo…"
              className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low py-md pl-10 pr-md text-body-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </div>
      </header>

      <div role="tablist" className="mb-lg flex gap-sm">
        <button
          role="tab"
          aria-selected={!isFormer}
          onClick={() => setTab("ativas")}
          className={`rounded-full px-lg py-sm font-label text-label-md transition-colors ${!isFormer ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"}`}
        >
          Lendas
        </button>
        <button
          role="tab"
          aria-selected={isFormer}
          onClick={() => setTab("ex")}
          className={`rounded-full px-lg py-sm font-label text-label-md transition-colors ${isFormer ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"}`}
        >
          Ex-Lendas
        </button>
      </div>

      {isLoading && <LegendsSkeleton />}

      {isError && (
        <div className="flex items-center gap-sm rounded-lg border border-error/40 bg-error-container/20 p-lg text-on-error-container">
          <Icon name="error" className="text-[20px]" />
          Erro ao carregar a galeria.
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">
          Nenhum colega encontrado.
        </p>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((entry) => (
            <LegendCard key={entry.user.id} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}
```

Nota: o valor inicial de `sectorId` usa `user?.sectorId ?? ALL_SECTORS` — o `??` só entra em jogo
se `user` for `null` (ex.: página renderizada antes do contexto de auth carregar), caso em que
"Todos os setores" é um fallback razoável (não há setor próprio conhecido ainda).

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/pages/LegendsPage.test.tsx`
Expected: PASS (4 testes)

- [ ] **Step 5: Typecheck do workspace web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros (confirma que `SectorOptionDTO` da Task 1 é consumido com o tipo certo)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/LegendsPage.tsx apps/web/src/pages/LegendsPage.test.tsx
git commit -m "feat(web): LegendsPage ganha seletor de setor (padrao o proprio, com opcao todos)"
```

---

### Task 4: Verificação final

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

Suba `pnpm dev`, entre em `/lendas` como usuário interno — confirme que o seletor aparece com o
próprio setor selecionado, que trocar pra outro setor troca a galeria, e que "Todos os setores"
mistura todo mundo. Entre como um `THIRD_PARTY` (ou confira via devtools) e confirme que o seletor
não aparece.
