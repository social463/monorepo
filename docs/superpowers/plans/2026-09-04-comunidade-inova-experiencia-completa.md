# Comunidade INOVA — Experiência Completa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar o módulo INOVA (hoje só o kanban de projetos) à experiência completa do original: landing "Início", navegação em abas, painel de ranking por setor, cards de projeto ricos, formulário de criação com 12 campos, e as páginas Recursos/Como usar.

**Architecture:** `InovaLayout` novo (abas: Início/Projetos/Criar projeto/Recursos/Como usar) envolve as 5 rotas de topo; detalhe/edição de projeto ficam fora do layout de abas. `priority`/`leadershipChallenge` migram de `String?` para `Boolean`. "Evolução das Áreas" é cálculo client-side sobre a lista de projetos já carregada — sem endpoint novo. Toggle de prioridade no card reaproveita o `PATCH /inova/projects/:id` existente.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Zod, Vite/React 18, TanStack Query, Tailwind, React Router 6.

**Spec:** `docs/superpowers/specs/2026-09-04-comunidade-inova-experiencia-completa-design.md`

## Global Constraints

- `priority` e `leadershipChallenge` são `Boolean @default(false)` no schema (eram `String?`).
- Novo campo `estimatedDeadline String?` no schema (distinto do `deadline DateTime?` que já existe e continua sem uso nesta leva).
- Sem editor de texto rico, sem combobox de colaborador, sem lightbox, sem vídeo embutido, sem página `/ranking` própria, sem aba "Impacto" — ver "Fora de escopo" do spec.
- Assets já copiados: `apps/web/public/inova/inova-emr-logo.png`, `apps/web/public/inova/inova-2025-linkedin.png`, `apps/web/public/inova/festival-inova.jpg`.
- Nova estrutura de rotas: `/comunidade-inova` (Início), `/comunidade-inova/projetos` (kanban), `/comunidade-inova/novo` (criar), `/comunidade-inova/recursos`, `/comunidade-inova/como-usar` — todas dentro de `InovaLayout`. `/comunidade-inova/projetos/:id` e `/comunidade-inova/projetos/:id/editar` ficam **fora** do layout de abas.
- Mensagens de erro e toda UI em português, mesma paleta/tokens Tailwind já usados no módulo (`text-on-surface`, `bg-primary`, `rounded-2xl`, etc.).
- Todo texto das páginas Início/Recursos/Como usar é **literal** do original (copiado nos steps abaixo) — não parafrasear.

---

### Task 1: Schema Prisma — priority/leadershipChallenge booleanos + estimatedDeadline

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: migration via `pnpm db:migrate` (nome sugerido: `inova_prioridade_e_prazo_estimado`)

- [ ] **Step 1: Editar o model `InovaProject`**

Em `apps/api/prisma/schema.prisma`, no `model InovaProject`, troque:

```prisma
  priority             String?
  leadershipChallenge  String?
```

por:

```prisma
  priority             Boolean           @default(false)
  leadershipChallenge  Boolean           @default(false)
  estimatedDeadline    String?
```

(mantenha a ordem dos demais campos como está; `estimatedDeadline` entra logo depois de `leadershipChallenge`).

- [ ] **Step 2: Gerar e aplicar a migration**

Run: `pnpm db:up && pnpm db:migrate` (nomeie `inova_prioridade_e_prazo_estimado` quando solicitado)
Expected: migration criada e aplicada sem erro. **Confira o SQL gerado antes de aceitar**: deve conter só `ALTER TABLE "InovaProject"` (troca de tipo das duas colunas + coluna nova) — nada de outras tabelas. Se aparecer DDL de outra tabela, é drift (já aconteceu antes nesta feature) — pare e avise.

- [ ] **Step 3: Regenerar o Prisma Client**

Run: `pnpm db:generate`
Expected: sem erros de tipo.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(inova): priority e leadershipChallenge viram booleanos, novo campo estimatedDeadline"
```

---

### Task 2: Contrato compartilhado — DTOs booleanos + constantes novas

**Files:**
- Modify: `packages/shared/src/inova.ts`
- Modify: `packages/shared/src/inova.test.ts`

**Interfaces:**
- Produces: `InovaProjectDTO.priority: boolean`, `InovaProjectDTO.leadershipChallenge: boolean`, `InovaProjectDTO.estimatedDeadline: string | null`; `INOVA_PHASE_POINTS: Record<InovaProjectPhase, number>`; `INOVA_PROJECT_CATEGORIES: { value: string; icon: string }[]`.

- [ ] **Step 1: Editar `InovaProjectDTO`**

Em `packages/shared/src/inova.ts`, troque:

```ts
  priority: string | null
  leadershipChallenge: string | null
```

por:

```ts
  priority: boolean
  leadershipChallenge: boolean
  estimatedDeadline: string | null
```

(insira `estimatedDeadline` logo após `leadershipChallenge`, mantendo o resto da interface como está).

- [ ] **Step 2: Adicionar `INOVA_PHASE_POINTS`**

Logo abaixo de `INOVA_PROJECT_PHASES`, adicione:

```ts
/**
 * Peso de cada fase para o painel "Evolução das Áreas" — soma dos pontos de
 * todos os projetos não arquivados de um setor. Mesma escala do projeto
 * original: quanto mais avançada a fase, mais pontos.
 */
export const INOVA_PHASE_POINTS: Record<InovaProjectPhase, number> = {
  IDEA: 1,
  EXPLORING_SOLUTION: 2,
  TESTING_SOLUTION: 3,
  ROUTINE_USE: 4,
  EXPANDING: 5,
  COMPLETED: 6,
}
```

- [ ] **Step 3: Adicionar `INOVA_PROJECT_CATEGORIES`**

Logo abaixo de `INOVA_SUGGESTED_SECTORS`, adicione:

```ts
/**
 * Sugestão de categoria no formulário de projeto — texto livre, não é enum
 * fechado no backend (mesmo critério de `INOVA_SUGGESTED_SECTORS`). O emoji
 * é só apresentação (badge do card), não é usado como identificador.
 */
export const INOVA_PROJECT_CATEGORIES: { value: string; icon: string }[] = [
  { value: 'Automação de processos', icon: '⚡' },
  { value: 'Experiência do cliente', icon: '💬' },
  { value: 'Análise de dados', icon: '📊' },
  { value: 'Marketing / conteúdo', icon: '📢' },
  { value: 'Educação / ensino', icon: '🎓' },
  { value: 'Produtividade interna', icon: '🚀' },
  { value: 'Outro', icon: '💡' },
]

/** Emoji de categoria para o card do kanban; categoria sem match usa o de "Outro". */
export function inovaCategoryIcon(category: string): string {
  return INOVA_PROJECT_CATEGORIES.find((c) => c.value === category)?.icon ?? '💡'
}
```

- [ ] **Step 4: Teste**

Acrescente ao `packages/shared/src/inova.test.ts`:

```ts
import { INOVA_PHASE_POINTS, INOVA_PROJECT_CATEGORIES, INOVA_PROJECT_PHASES, inovaCategoryIcon } from './inova'

describe('pontos de fase e categorias do INOVA', () => {
  it('tem peso crescente para cada fase, na mesma ordem do kanban', () => {
    const pesos = INOVA_PROJECT_PHASES.map((p) => INOVA_PHASE_POINTS[p.value])
    expect(pesos).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('categorias têm ícone e valor não vazios, sem duplicata', () => {
    expect(INOVA_PROJECT_CATEGORIES.length).toBeGreaterThan(0)
    const valores = INOVA_PROJECT_CATEGORIES.map((c) => c.value)
    expect(new Set(valores).size).toBe(valores.length)
  })

  it('inovaCategoryIcon devolve o emoji certo, e "Outro" para categoria desconhecida', () => {
    expect(inovaCategoryIcon('Análise de dados')).toBe('📊')
    expect(inovaCategoryIcon('categoria que não existe')).toBe('💡')
  })
})
```

Run: `pnpm --filter @legends/shared exec vitest run src/inova.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/inova.ts packages/shared/src/inova.test.ts
git commit -m "feat(inova): DTO com priority/leadershipChallenge booleanos, pontos de fase e categorias com ícone"
```

---

### Task 3: Backend — service, serialize e rotas para os campos novos

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`
- Modify: `apps/api/src/services/inova-service.ts`
- Modify: `apps/api/src/routes/inova.ts`
- Modify: `apps/api/src/services/inova-service.test.ts`
- Modify: `apps/api/src/routes/inova.test.ts`

**Interfaces:**
- Consumes: `InovaProjectDTO` atualizado (Task 2).
- Produces: `GET /inova/projects?archived=true` filtra arquivados; `CreateInovaProjectInput`/`UpdateInovaProjectInput` com `priority?: boolean`, `leadershipChallenge?: boolean`, `estimatedDeadline?: string | null`.

- [ ] **Step 1: `serialize.ts` — `toInovaProjectDTO`**

Em `apps/api/src/lib/serialize.ts`, na função `toInovaProjectDTO`, troque:

```ts
    priority: project.priority,
    leadershipChallenge: project.leadershipChallenge,
```

por:

```ts
    priority: project.priority,
    leadershipChallenge: project.leadershipChallenge,
    estimatedDeadline: project.estimatedDeadline,
```

(os dois primeiros campos já viram boolean automaticamente — o tipo do Prisma Client já é `boolean` depois da Task 1; só o `estimatedDeadline` é linha nova).

- [ ] **Step 2: `inova-service.ts` — inputs e filtro de arquivados**

Em `CreateInovaProjectInput`, troque:

```ts
  priority?: string | null
  leadershipChallenge?: string | null
```

por:

```ts
  priority?: boolean
  leadershipChallenge?: boolean
  estimatedDeadline?: string | null
```

No corpo de `createInovaProject`, troque:

```ts
        priority: input.priority ?? null,
        leadershipChallenge: input.leadershipChallenge ?? null,
```

por:

```ts
        priority: input.priority ?? false,
        leadershipChallenge: input.leadershipChallenge ?? false,
        estimatedDeadline: input.estimatedDeadline ?? null,
```

Em `updateInovaProject`, na lista de chaves do loop `for (const key of [...])`, adicione `'estimatedDeadline'` à lista (ao lado de `'priority'`/`'leadershipChallenge'`, que já estão lá e continuam funcionando sem alteração — o loop copia qualquer chave presente em `input`).

Em `listInovaProjects`, troque a assinatura e o `where`:

```ts
export async function listInovaProjects(
  companyId: string,
  options: { archived?: boolean } = {},
): Promise<ReturnType<typeof toInovaProjectDTO>[]> {
  if (!(await isInovaModuleEnabled(companyId))) return []
  const projects = await scopedPrisma(companyId).inovaProject.findMany({
    where: { archived: options.archived ?? false },
    include: { createdBy: true },
    orderBy: { createdAt: 'desc' },
  })
  return projects.map(toInovaProjectDTO)
}
```

(já está assim — confirme que não precisa mudar nada aqui; a mudança real é na ROTA, no Step 3, que hoje não repassa `options`).

- [ ] **Step 3: `routes/inova.ts` — schema, query de arquivados**

Troque:

```ts
  priority: z.string().nullable().optional(),
  leadershipChallenge: z.string().nullable().optional(),
```

por:

```ts
  priority: z.boolean().optional(),
  leadershipChallenge: z.boolean().optional(),
  estimatedDeadline: z.string().nullable().optional(),
```

(dentro de `projectInputSchema` — `updateProjectSchema` herda via `.partial()`, sem mudança adicional).

Troque a rota `GET /inova/projects` para aceitar `?archived=true`:

```ts
  app.get('/inova/projects', { onRequest: [app.authenticate] }, async (request, reply) => {
    const archived = (request.query as { archived?: string }).archived === 'true'
    const projects = await listInovaProjects(request.user.companyId, { archived })
    return reply.send({ projects })
  })
```

- [ ] **Step 4: Testes — service**

No `apps/api/src/services/inova-service.test.ts`, ajuste QUALQUER teste que hoje passe `priority`/`leadershipChallenge` como string (não deve haver nenhum ainda, já que esses campos não eram exercitados) — confirme com `grep -n "priority\|leadershipChallenge" apps/api/src/services/inova-service.test.ts` antes de editar. Acrescente um teste cobrindo o filtro de arquivados:

```ts
describe('listInovaProjects com arquivados', () => {
  it('lista só não-arquivados por padrão, e só arquivados quando pedido', async () => {
    const admin = await createAdmin(DEFAULT_COMPANY_ID)
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    const project = await createInovaProject({
      companyId: DEFAULT_COMPANY_ID,
      actorId: admin.id,
      title: 'Projeto arquivável',
      category: 'IA',
      sector: 'Ensino',
      description: 'Descrição',
    })
    await updateInovaProject({ id: project.id, companyId: DEFAULT_COMPANY_ID, actorId: admin.id, archived: true })

    const ativos = await listInovaProjects(DEFAULT_COMPANY_ID)
    expect(ativos.map((p) => p.id)).not.toContain(project.id)

    const arquivados = await listInovaProjects(DEFAULT_COMPANY_ID, { archived: true })
    expect(arquivados.map((p) => p.id)).toContain(project.id)
  })
})
```

(confirme que `updateInovaProject` aceita `archived` no `UpdateInovaProjectInput` — se não aceitar ainda, adicione `archived?: boolean` à interface e à lista de chaves copiadas no loop de `updateInovaProject`, do mesmo jeito que os outros campos opcionais).

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/inova-service.test.ts`
Expected: PASS

- [ ] **Step 5: Testes — rota**

No `apps/api/src/routes/inova.test.ts`, acrescente um teste para `?archived=true` e para criar projeto com `priority: true`:

```ts
it('cria projeto com priority/leadershipChallenge booleanos e filtra arquivados por query', async () => {
  const app = await buildApp()
  const sector = await prisma.sector.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID } })
  const admin = await prisma.user.create({
    data: {
      email: `admin2-${Math.random()}@teste.com`,
      passwordHash: 'x',
      name: 'Admin',
      role: 'ADMIN',
      companyId: DEFAULT_COMPANY_ID,
      sectorId: sector.id,
    },
  })
  await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
  const tokenAdmin = app.jwt.sign({ sub: admin.id, role: 'ADMIN', sectorId: sector.id, companyId: DEFAULT_COMPANY_ID })

  const criado = await app.inject({
    method: 'POST',
    url: '/inova/projects',
    headers: auth(tokenAdmin),
    payload: { title: 'Projeto prioritário', category: 'IA', sector: 'Ensino', description: 'Descrição', priority: true, leadershipChallenge: true, estimatedDeadline: '3 meses' },
  })
  expect(criado.statusCode).toBe(200)
  expect(criado.json().project.priority).toBe(true)
  expect(criado.json().project.leadershipChallenge).toBe(true)
  expect(criado.json().project.estimatedDeadline).toBe('3 meses')

  await app.inject({
    method: 'PATCH',
    url: `/inova/projects/${criado.json().project.id}`,
    headers: auth(tokenAdmin),
    payload: { archived: true },
  })

  const semArquivados = await app.inject({ method: 'GET', url: '/inova/projects', headers: auth(tokenAdmin) })
  expect(semArquivados.json().projects.map((p: { id: string }) => p.id)).not.toContain(criado.json().project.id)

  const comArquivados = await app.inject({ method: 'GET', url: '/inova/projects?archived=true', headers: auth(tokenAdmin) })
  expect(comArquivados.json().projects.map((p: { id: string }) => p.id)).toContain(criado.json().project.id)

  await app.close()
})
```

(reaproveite os imports/helpers `auth`, `buildApp`, `DEFAULT_COMPANY_ID`, `updateDevelopmentSettings` já presentes no arquivo — confirme os nomes exatos lendo o topo do arquivo antes de colar).

Se `archived` ainda não estiver no `updateProjectSchema`/`UpdateInovaProjectInput` (ele é um campo do model, mas confira se já está exposto na rota PATCH — se não estiver, adicione `archived: z.boolean().optional()` ao `updateProjectSchema` e repasse no handler da rota `PATCH /inova/projects/:id`, do mesmo jeito que os outros campos).

Run: `pnpm --filter @legends/api exec vitest run src/routes/inova.test.ts`
Expected: PASS

- [ ] **Step 6: `tsc` e commit**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/services/inova-service.ts apps/api/src/routes/inova.ts apps/api/src/services/inova-service.test.ts apps/api/src/routes/inova.test.ts
git commit -m "feat(inova): priority/leadershipChallenge booleanos, estimatedDeadline e filtro de arquivados na listagem"
```

---

### Task 4: `InovaLayout` — abas de navegação interna + reestruturação de rotas

**Files:**
- Create: `apps/web/src/pages/inova/InovaLayout.tsx`
- Create: `apps/web/src/pages/inova/InovaLayout.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `canAdminister` (`@legends/shared`), `useAuth` (`../../auth/AuthContext`).
- Produces: `export function InovaLayout()` — `<Outlet/>` + tira de 5 abas (Início/Projetos/Criar projeto/Recursos/Como usar), "Criar projeto" só visível para quem administra.

- [ ] **Step 1: Escrever o teste**

```tsx
// apps/web/src/pages/inova/InovaLayout.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { InovaLayout } from './InovaLayout'
import * as authModule from '../../auth/AuthContext'

vi.mock('../../auth/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/AuthContext')>()),
  useAuth: vi.fn(),
}))

function renderLayout(role: string) {
  vi.mocked(authModule.useAuth).mockReturnValue({ user: { role, adminAccess: false } } as ReturnType<typeof authModule.useAuth>)
  return render(
    <MemoryRouter initialEntries={['/comunidade-inova']}>
      <Routes>
        <Route path="/comunidade-inova" element={<InovaLayout />}>
          <Route index element={<p>início</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('InovaLayout', () => {
  it('mostra as abas Início/Projetos/Recursos/Como usar para qualquer usuário', () => {
    renderLayout('LEGEND')
    expect(screen.getByRole('link', { name: /início/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /projetos/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /recursos/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /como usar/i })).toBeInTheDocument()
  })

  it('esconde "Criar projeto" para quem não administra', () => {
    renderLayout('LEGEND')
    expect(screen.queryByRole('link', { name: /criar projeto/i })).not.toBeInTheDocument()
  })

  it('mostra "Criar projeto" para admin', () => {
    renderLayout('ADMIN')
    expect(screen.getByRole('link', { name: /criar projeto/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/InovaLayout.test.tsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escrever `InovaLayout.tsx`**

```tsx
import { NavLink, Outlet } from 'react-router-dom'
import { canAdminister } from '@legends/shared'
import { useAuth } from '../../auth/AuthContext'

const tabCls = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-lg py-sm font-label text-label-md font-bold transition-colors ${
    isActive ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'
  }`

/**
 * Sub-navegação do módulo INOVA (Início/Projetos/Criar projeto/Recursos/Como
 * usar). Vive só dentro de `/comunidade-inova`; a tela de detalhe/edição de
 * um projeto específico fica fora deste layout — ver spec
 * 2026-09-04-comunidade-inova-experiencia-completa-design.md.
 */
export function InovaLayout() {
  const { user } = useAuth()
  const podeAdministrar = user ? canAdminister(user) : false

  return (
    <div className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <nav className="flex flex-wrap gap-sm border-b border-outline-variant/40 pb-sm" aria-label="Navegação da Comunidade INOVA">
        <NavLink to="/comunidade-inova" end className={tabCls}>
          Início
        </NavLink>
        <NavLink to="/comunidade-inova/projetos" className={tabCls}>
          Projetos
        </NavLink>
        {podeAdministrar && (
          <NavLink to="/comunidade-inova/novo" className={tabCls}>
            Criar projeto
          </NavLink>
        )}
        <NavLink to="/comunidade-inova/recursos" className={tabCls}>
          Recursos
        </NavLink>
        <NavLink to="/comunidade-inova/como-usar" className={tabCls}>
          Como usar
        </NavLink>
      </nav>
      <Outlet />
    </div>
  )
}
```

- [ ] **Step 4: Reestruturar rotas em `App.tsx`**

Em `apps/web/src/App.tsx`, troque as 4 linhas atuais:

```tsx
                    <Route path="/comunidade-inova" element={<ComunidadeInovaPage />} />
                    <Route path="/comunidade-inova/novo" element={<InovaProjectFormPage />} />
                    <Route path="/comunidade-inova/:id/editar" element={<InovaProjectFormPage />} />
                    <Route path="/comunidade-inova/:id" element={<InovaProjectDetailPage />} />
```

por:

```tsx
                    <Route path="/comunidade-inova" element={<InovaLayout />}>
                      <Route index element={<InovaHomePage />} />
                      <Route path="projetos" element={<ComunidadeInovaPage />} />
                      <Route path="novo" element={<InovaProjectFormPage />} />
                      <Route path="recursos" element={<InovaResourcesPage />} />
                      <Route path="como-usar" element={<InovaHowToPage />} />
                    </Route>
                    <Route path="/comunidade-inova/projetos/:id/editar" element={<InovaProjectFormPage />} />
                    <Route path="/comunidade-inova/projetos/:id" element={<InovaProjectDetailPage />} />
```

E adicione os imports (junto dos outros imports de páginas do INOVA já existentes no topo do arquivo):

```tsx
import { InovaLayout } from './pages/inova/InovaLayout'
import { InovaHomePage } from './pages/inova/InovaHomePage'
import { InovaResourcesPage } from './pages/inova/InovaResourcesPage'
import { InovaHowToPage } from './pages/inova/InovaHowToPage'
```

`InovaHomePage`, `InovaResourcesPage`, `InovaHowToPage` ainda não existem — são criados nas Tasks 6, 9 e 10. **Este projeto não vai compilar até essas três tasks estarem prontas.** Isso é esperado: registre no relatório que o build só fecha depois da Task 10. Não pule este step só por causa disso — as importações precisam estar aqui desde já para as próximas tasks não reeditarem `App.tsx` de novo.

- [ ] **Step 5: Rodar e confirmar sucesso do teste do layout**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/InovaLayout.test.tsx`
Expected: PASS (este teste não depende de `App.tsx` compilar — ele testa `InovaLayout` isolado).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/inova/InovaLayout.tsx apps/web/src/pages/inova/InovaLayout.test.tsx apps/web/src/App.tsx
git commit -m "feat(inova): layout de abas do módulo e reestruturação de rotas"
```

---

### Task 5: Atualizar links internos para a nova estrutura de rotas

**Files:**
- Modify: `apps/web/src/pages/ComunidadeInovaPage.tsx`
- Modify: `apps/web/src/pages/inova/InovaProjectFormPage.tsx`
- Modify: `apps/web/src/pages/inova/InovaProjectDetailPage.tsx`

**Interfaces:**
- Nenhuma nova — só troca de string de rota nos `Link`/`navigate` já existentes.

- [ ] **Step 1: `ComunidadeInovaPage.tsx`**

Troque `to={`/comunidade-inova/${project.id}`}` (dentro do `.map` de cards) por `to={`/comunidade-inova/projetos/${project.id}`}`. Troque o `<Link to="/comunidade-inova/novo" ...>` do botão "Novo projeto" — esse continua igual, `novo` não muda.

Remova o gate de `inovaModuleEnabled`/`Navigate` deste arquivo (linhas do `useDevelopmentSettings`/`if (!settings.data?.settings?.inovaModuleEnabled) return <Navigate .../>`) — **esse gate agora pertence ao `InovaLayout`** (Task 6 vai adicioná-lo lá, porque precisa valer para todas as 5 abas, não só o kanban). Deixe só a query de projetos e a renderização do board; remova o `import { useDevelopmentSettings }` e o `import { Navigate }` que ficarem sem uso.

- [ ] **Step 2: `InovaProjectFormPage.tsx`**

Troque `navigate(`/comunidade-inova/${result.project.id}`)` por `navigate(`/comunidade-inova/projetos/${result.project.id}`)`.

- [ ] **Step 3: `InovaProjectDetailPage.tsx`**

Troque `to={`/comunidade-inova/${project.id}/editar`}` (no botão "Editar") por `to={`/comunidade-inova/projetos/${project.id}/editar`}`.

- [ ] **Step 4: Rodar os testes destes 3 arquivos**

Run: `pnpm --filter @legends/web exec vitest run src/pages/ComunidadeInovaPage.test.tsx src/pages/inova/InovaProjectFormPage.test.tsx src/pages/inova/InovaProjectDetailPage.test.tsx`
Expected: pode haver falha em `ComunidadeInovaPage.test.tsx` por causa da remoção do gate — ajuste o teste removendo os casos que testavam `inovaModuleEnabled`/redirecionamento (esse comportamento moveu para `InovaLayout`, que ganha seu próprio teste na Task 6) e mantendo só os casos de renderização do kanban. Os outros dois arquivos devem passar sem mudança de teste (só mudou a URL de destino, que os testes atuais não afirmam literalmente — confirme lendo os testes antes de assumir).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ComunidadeInovaPage.tsx apps/web/src/pages/inova/InovaProjectFormPage.tsx apps/web/src/pages/inova/InovaProjectDetailPage.tsx apps/web/src/pages/ComunidadeInovaPage.test.tsx
git commit -m "feat(inova): atualiza links internos para a rota /comunidade-inova/projetos"
```

---

### Task 6: `InovaHomePage` (Início) + gate do módulo no layout

**Files:**
- Create: `apps/web/src/pages/inova/InovaHomePage.tsx`
- Create: `apps/web/src/pages/inova/InovaHomePage.test.tsx`
- Modify: `apps/web/src/pages/inova/InovaLayout.tsx`
- Modify: `apps/web/src/pages/inova/InovaLayout.test.tsx`

**Interfaces:**
- Consumes: `useDevelopmentSettings` (`../../lib/use-development-settings`).
- Produces: `export function InovaHomePage()`; `InovaLayout` ganha o gate de `inovaModuleEnabled` (movido de `ComunidadeInovaPage`, Task 5).

- [ ] **Step 1: Mover o gate para `InovaLayout.tsx`**

Em `apps/web/src/pages/inova/InovaLayout.tsx`, adicione o gate que existia em `ComunidadeInovaPage.tsx` antes da Task 5 remover:

```tsx
import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { canAdminister } from '@legends/shared'
import { useAuth } from '../../auth/AuthContext'
import { useDevelopmentSettings } from '../../lib/use-development-settings'

// ...(tabCls como já está)...

export function InovaLayout() {
  const { user } = useAuth()
  const settings = useDevelopmentSettings()
  const podeAdministrar = user ? canAdminister(user) : false

  // Enquanto a config ainda não chegou, não redireciona — só depois que ela
  // chegar e o módulo estiver desligado (ou config indisponível).
  if (settings.isPending) return null
  if (!settings.data?.settings?.inovaModuleEnabled) return <Navigate to="/" replace />

  return (
    <div className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      {/* nav e Outlet como já estão */}
    </div>
  )
}
```

- [ ] **Step 2: Ajustar `InovaLayout.test.tsx`**

Os 3 testes existentes vão quebrar porque agora `InovaLayout` chama `useDevelopmentSettings` (React Query) — adicione um mock e um `QueryClientProvider`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as devSettingsModule from '../../lib/use-development-settings'

vi.mock('../../lib/use-development-settings')

function renderLayout(role: string) {
  vi.mocked(authModule.useAuth).mockReturnValue({ user: { role, adminAccess: false } } as ReturnType<typeof authModule.useAuth>)
  vi.mocked(devSettingsModule.useDevelopmentSettings).mockReturnValue({
    isPending: false,
    data: { settings: { inovaModuleEnabled: true } },
  } as ReturnType<typeof devSettingsModule.useDevelopmentSettings>)
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/comunidade-inova']}>
        <Routes>
          <Route path="/comunidade-inova" element={<InovaLayout />}>
            <Route index element={<p>início</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
```

Acrescente um 4º teste:

```tsx
it('redireciona para / quando o módulo está desabilitado', () => {
  vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'LEGEND', adminAccess: false } } as ReturnType<typeof authModule.useAuth>)
  vi.mocked(devSettingsModule.useDevelopmentSettings).mockReturnValue({
    isPending: false,
    data: { settings: { inovaModuleEnabled: false } },
  } as ReturnType<typeof devSettingsModule.useDevelopmentSettings>)
  const qc = new QueryClient()
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/comunidade-inova']}>
        <Routes>
          <Route path="/" element={<p>home</p>} />
          <Route path="/comunidade-inova" element={<InovaLayout />}>
            <Route index element={<p>início</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  expect(screen.getByText('home')).toBeInTheDocument()
})
```

- [ ] **Step 3: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/InovaLayout.test.tsx`
Expected: PASS (4 testes).

- [ ] **Step 4: Escrever o teste de `InovaHomePage`**

```tsx
// apps/web/src/pages/inova/InovaHomePage.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { InovaHomePage } from './InovaHomePage'

describe('InovaHomePage', () => {
  it('mostra o hero e os links de ação', () => {
    render(
      <MemoryRouter>
        <InovaHomePage />
      </MemoryRouter>,
    )
    expect(screen.getByText('Transformando ideias em impacto real')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /explorar projetos da comunidade/i })).toHaveAttribute(
      'href',
      '/comunidade-inova/projetos',
    )
    expect(screen.getByRole('link', { name: /tirar minha ideia do papel/i })).toHaveAttribute('href', '/comunidade-inova/novo')
  })

  it('mostra as seções institucionais (Cultura, Comitê de IA, Memórias, Jornada)', () => {
    render(
      <MemoryRouter>
        <InovaHomePage />
      </MemoryRouter>,
    )
    expect(screen.getByText('O que o INOVA tem a ver com a nossa cultura?')).toBeInTheDocument()
    expect(screen.getByText('Comitê de IA')).toBeInTheDocument()
    expect(screen.getByText('O caminho que já percorremos')).toBeInTheDocument()
    expect(screen.getByText('Sua jornada de transformação')).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/InovaHomePage.test.tsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 6: Escrever `InovaHomePage.tsx`**

Todo o texto abaixo é **literal** do projeto original — copie exatamente, sem parafrasear.

```tsx
import { Link } from 'react-router-dom'
import { Icon } from '../../components/Icon'

const CULTURA_DIZ = [
  'Valorizamos colaboração',
  'Tomamos decisões com base em dados',
  'Buscamos excelência em cada entrega',
  'Incentivamos inovação contínua',
  'Esperamos autonomia e protagonismo das pessoas',
]

const INOVA_TRANSFORMA = [
  'Ideias viram melhorias reais',
  'Testamos soluções em pequena escala',
  'Compartilhamos aprendizados com o time',
  'Evoluímos com base em evidências',
  'Pessoas assumem protagonismo nas mudanças',
]

const COMITE_FLUXO = [
  { titulo: 'Times / Setores', texto: 'Iniciativas surgem dos times' },
  { titulo: 'Encontro de Alinhamento', texto: 'Compartilhamento entre áreas' },
  { titulo: 'Consolidação de insights', texto: 'Resumo das oportunidades' },
  { titulo: 'Comitê Executivo', texto: 'Avaliação e priorização' },
  { titulo: 'Decisões estratégicas', texto: 'Definição do que escalar' },
  { titulo: 'Direcionamento para os times', texto: 'Retorno às áreas com clareza' },
]

const ENCONTRO_ITENS = [
  'Representantes de cada área compartilham projetos',
  'Visibilidade do que está acontecendo na empresa',
  'Identificação de oportunidades de colaboração',
  'Redução de retrabalho entre times',
  'Geração de um resumo consolidado',
]

const COMITE_ITENS = [
  'Avaliação dos projetos levantados',
  'Priorização de iniciativas',
  'Direcionamento de investimentos',
  'Abertura de novas frentes',
]

const IMPACTOS = [
  'Mais eficiência, menos retrabalho',
  'Experiências que fazem diferença',
  'Recursos bem aplicados',
  'Novas formas de gerar valor',
]

const JORNADA = [
  { numero: '01', titulo: 'Faça parte da Comunidade', texto: 'Conecte-se com outros protagonistas e comece sua jornada de transformação.' },
  { numero: '02', titulo: 'Aprenda e colabore', texto: 'Troque experiências no Teams, aprenda com o time e fortaleça suas ideias.' },
  { numero: '03', titulo: 'Tire ideias do papel', texto: 'Desenvolva seu projeto com propósito, método e suporte contínuo da comunidade.' },
  { numero: '04', titulo: 'Mostre seu impacto', texto: 'Apresente seus resultados no evento INOVA e inspire toda a organização.' },
]

const sectionCard = 'rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg md:p-xl'

export function InovaHomePage() {
  return (
    <div className="flex flex-col gap-xl">
      {/* Hero */}
      <section className="flex flex-col items-center gap-md text-center">
        <img src="/inova/inova-emr-logo.png" alt="INOVA EMR" className="w-[220px] md:w-[280px]" />
        <h1 className="max-w-2xl font-headline text-headline-xl text-on-surface">
          Transformando ideias em impacto real
        </h1>
        <p className="max-w-2xl text-body-lg text-on-surface-variant">
          Aqui, cada projeto nasce com propósito e evolui para gerar transformação real. Usamos{' '}
          <strong className="text-on-surface">Inteligência Artificial</strong> como alavanca para inovar com método,
          colaboração e excelência.
        </p>
        <div className="mt-sm flex flex-wrap items-center justify-center gap-md">
          <Link
            to="/comunidade-inova/projetos"
            className="inline-flex items-center gap-sm rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
          >
            Explorar projetos da comunidade
            <Icon name="arrow_forward" className="text-[18px]" />
          </Link>
          <Link
            to="/comunidade-inova/novo"
            className="inline-flex items-center gap-sm rounded-full border border-outline-variant/60 px-lg py-sm font-label text-label-md font-bold text-on-surface hover:border-primary/60 hover:text-primary"
          >
            Tirar minha ideia do papel
          </Link>
        </div>
      </section>

      {/* Cultura */}
      <section className={sectionCard}>
        <p className="font-label text-label-md uppercase tracking-[0.2em] text-primary">Cultura</p>
        <h2 className="mt-2 font-headline text-headline-lg text-on-surface">
          O que o INOVA tem a ver com a nossa cultura?
        </h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          O INOVA é onde nossa cultura deixa de ser discurso e vira prática.
        </p>
        <div className="mt-lg grid grid-cols-1 gap-md md:grid-cols-2">
          <div>
            <h3 className="font-headline text-headline-sm text-on-surface">Nossa cultura diz que:</h3>
            <ul className="mt-sm flex flex-col gap-sm">
              {CULTURA_DIZ.map((item) => (
                <li key={item} className="text-body-md text-on-surface-variant">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-headline text-headline-sm text-on-surface">O INOVA transforma isso em ação:</h3>
            <ul className="mt-sm flex flex-col gap-sm">
              {INOVA_TRANSFORMA.map((item) => (
                <li key={item} className="text-body-md text-on-surface-variant">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-lg rounded-xl border border-outline-variant/40 bg-surface-container p-md text-center">
          <p className="text-body-md text-on-surface">
            No INOVA, cada pessoa deixa de apenas executar e passa a contribuir ativamente para a evolução da EMR.
          </p>
        </div>
        <p className="mt-md text-center text-body-sm italic text-on-surface-variant">
          Cultura forte não se comunica apenas, se constrói no dia a dia.
        </p>
      </section>

      {/* Comitê de IA */}
      <section className={sectionCard}>
        <p className="font-label text-label-md uppercase tracking-[0.2em] text-primary">Governança</p>
        <h2 className="mt-2 font-headline text-headline-lg text-on-surface">Comitê de IA</h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Como transformamos iniciativas em decisões estratégicas
        </p>
        <div className="mt-lg flex flex-wrap gap-sm">
          {COMITE_FLUXO.map((passo) => (
            <div key={passo.titulo} className="min-w-[140px] flex-1 rounded-xl border border-outline-variant/40 p-sm text-center">
              <p className="font-label text-label-md text-on-surface">{passo.titulo}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{passo.texto}</p>
            </div>
          ))}
        </div>
        <div className="mt-lg grid grid-cols-1 gap-md md:grid-cols-2">
          <div>
            <h3 className="font-headline text-headline-sm text-on-surface">Encontro de Alinhamento</h3>
            <ul className="mt-sm flex flex-col gap-sm">
              {ENCONTRO_ITENS.map((item) => (
                <li key={item} className="text-body-md text-on-surface-variant">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-headline text-headline-sm text-on-surface">Comitê Executivo</h3>
            <ul className="mt-sm flex flex-col gap-sm">
              {COMITE_ITENS.map((item) => (
                <li key={item} className="text-body-md text-on-surface-variant">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-lg rounded-xl bg-primary/5 p-md text-center">
          <p className="text-body-md text-on-surface">
            O Comitê de IA conecta o que está sendo feito com o que realmente deve escalar.
          </p>
        </div>
      </section>

      {/* Memórias */}
      <section className={sectionCard}>
        <p className="font-label text-label-md uppercase tracking-[0.2em] text-primary">Memórias</p>
        <h2 className="mt-2 font-headline text-headline-lg text-on-surface">O caminho que já percorremos</h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Cada edição é um passo na nossa evolução. Relembre os momentos que marcaram o INOVA 2025.
        </p>
        <div className="mt-lg grid grid-cols-1 gap-md md:grid-cols-2">
          <a href="/inova/inova-2025-linkedin.png" target="_blank" rel="noreferrer">
            <img
              src="/inova/inova-2025-linkedin.png"
              alt="Ganhadores INOVA EMR 2025"
              className="w-full rounded-xl object-cover"
            />
          </a>
          <a href="/inova/festival-inova.jpg" target="_blank" rel="noreferrer">
            <img
              src="/inova/festival-inova.jpg"
              alt="Festival INOVA EMR 2025"
              className="w-full rounded-xl object-cover"
            />
          </a>
        </div>
      </section>

      {/* Impacto */}
      <section className={sectionCard}>
        <h2 className="text-center font-headline text-headline-lg text-on-surface">
          Inovação que gera resultado de verdade
        </h2>
        <p className="mt-1 text-center text-body-md text-on-surface-variant">
          Cada área com pelo menos <strong className="text-on-surface">2 projetos estratégicos</strong> com IA até{' '}
          <strong className="text-on-surface">junho de 2026</strong>, porque evoluir com propósito é evoluir juntos.
        </p>
        <div className="mt-lg grid grid-cols-1 gap-md sm:grid-cols-2 md:grid-cols-4">
          {IMPACTOS.map((item) => (
            <div key={item} className="rounded-xl border border-outline-variant/40 p-md text-center text-body-md text-on-surface">
              {item}
            </div>
          ))}
        </div>
      </section>

      {/* Jornada */}
      <section className={sectionCard}>
        <h2 className="text-center font-headline text-headline-lg text-on-surface">Sua jornada de transformação</h2>
        <p className="mt-1 text-center text-body-md text-on-surface-variant">
          Cada etapa é uma oportunidade de crescer, aprender e gerar impacto.
        </p>
        <div className="mt-lg grid grid-cols-1 gap-md sm:grid-cols-2 md:grid-cols-4">
          {JORNADA.map((passo) => (
            <div key={passo.numero} className="rounded-xl border border-outline-variant/40 p-md">
              <p className="font-headline text-headline-sm text-primary">{passo.numero}</p>
              <p className="mt-1 font-label text-label-md text-on-surface">{passo.titulo}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{passo.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Top INOVA EMR */}
      <section className={`${sectionCard} text-center`}>
        <h2 className="font-headline text-headline-md text-on-surface">🏆 Projetos de Impacto INOVA EMR</h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          As iniciativas que chegam à etapa final passam por um processo de avaliação e podem ser premiadas por seu
          impacto e evolução com propósito.
        </p>
      </section>

      {/* CTAs finais */}
      <section className="grid grid-cols-1 gap-md md:grid-cols-2">
        <div className={sectionCard}>
          <h2 className="font-headline text-headline-sm text-on-surface">Quer tirar uma ideia do papel?</h2>
          <p className="mt-2 text-body-md text-on-surface-variant">
            Se você tem uma ideia, mas ainda não sabe por onde começar, a gente te ajuda. Fale com o time de{' '}
            <strong className="text-on-surface">Gente &amp; Gestão</strong> para entender como transformar sua ideia
            em um projeto real.
          </p>
          <div className="mt-md rounded-xl border border-outline-variant/40 p-sm">
            <p className="font-label text-label-md text-on-surface">Mariana Venancio</p>
            <p className="text-body-sm text-on-surface-variant">Analista de T&amp;D, EMR</p>
          </div>
          <p className="mt-sm text-body-sm text-on-surface-variant">
            Não precisa ter tudo pronto. O importante é começar, e aqui ninguém constrói sozinho.
          </p>
          <a
            href="https://teams.microsoft.com/l/chat/48:notes/conversations?context=%7B%22contextType%22%3A%22chat%22%7D"
            target="_blank"
            rel="noreferrer"
            className="mt-md inline-flex items-center gap-sm rounded-full border border-outline-variant/60 px-lg py-sm font-label text-label-md text-primary hover:border-primary/60"
          >
            <Icon name="chat" className="text-[18px]" />
            Falar no Teams
          </a>
        </div>
        <div className="rounded-2xl bg-primary p-lg text-on-primary md:p-xl">
          <h2 className="font-headline text-headline-sm">O futuro da EMR é construído por você.</h2>
          <p className="mt-2 text-body-md">Assuma o protagonismo. Lance seu projeto e faça parte da transformação.</p>
          <Link
            to="/comunidade-inova/novo"
            className="mt-md inline-flex items-center gap-sm rounded-full bg-on-primary px-lg py-sm font-label text-label-md font-bold text-primary hover:opacity-90"
          >
            Começar agora
            <Icon name="arrow_forward" className="text-[18px]" />
          </Link>
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 7: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/InovaHomePage.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/inova/InovaHomePage.tsx apps/web/src/pages/inova/InovaHomePage.test.tsx apps/web/src/pages/inova/InovaLayout.tsx apps/web/src/pages/inova/InovaLayout.test.tsx
git commit -m "feat(inova): página Início com o conteúdo institucional do original"
```

---

### Task 7: `ComunidadeInovaPage` (Projetos) — ranking, filtros e cards ricos

**Files:**
- Modify: `apps/web/src/pages/ComunidadeInovaPage.tsx`
- Modify: `apps/web/src/pages/ComunidadeInovaPage.test.tsx`
- Modify: `apps/web/src/lib/inova-api.ts`

**Interfaces:**
- Consumes: `INOVA_PHASE_POINTS`, `inovaCategoryIcon` (`@legends/shared`, Task 2).
- Produces: `listInovaProjects(options?: { archived?: boolean })` em `inova-api.ts` ganha suporte a query string.

- [ ] **Step 1: `inova-api.ts` — suportar `?archived=`**

Troque:

```ts
export function listInovaProjects() {
  return apiFetch<InovaProjectListResponse>('/inova/projects')
}
```

por:

```ts
export function listInovaProjects(options: { archived?: boolean } = {}) {
  const query = options.archived ? '?archived=true' : ''
  return apiFetch<InovaProjectListResponse>(`/inova/projects${query}`)
}
```

- [ ] **Step 2: Escrever/ajustar o teste**

Acrescente ao `ComunidadeInovaPage.test.tsx` (mantendo os testes existentes de renderização por fase e do botão "Novo projeto"):

```tsx
it('mostra o painel "Evolução das Áreas" com pontos somados por setor', async () => {
  vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
  vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
    projects: [
      { ...projetoBase, id: '1', sector: 'Ensino', phase: 'IDEA' }, // 1 ponto
      { ...projetoBase, id: '2', sector: 'Ensino', phase: 'COMPLETED' }, // 6 pontos
      { ...projetoBase, id: '3', sector: 'CX', phase: 'EXPLORING_SOLUTION' }, // 2 pontos
    ],
  })

  renderPage()

  await waitFor(() => expect(screen.getByText('Evolução das Áreas')).toBeInTheDocument())
  expect(screen.getByText('Ensino')).toBeInTheDocument()
  expect(screen.getByText('7 pts')).toBeInTheDocument() // 1+6
})

it('filtro "Só prioridade" esconde projetos sem priority', async () => {
  vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
  vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
    projects: [
      { ...projetoBase, id: '1', title: 'Prioritário', priority: true },
      { ...projetoBase, id: '2', title: 'Normal', priority: false },
    ],
  })

  renderPage()
  await waitFor(() => expect(screen.getByText('Prioritário')).toBeInTheDocument())
  expect(screen.getByText('Normal')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: /só prioridade/i }))
  expect(screen.getByText('Prioritário')).toBeInTheDocument()
  expect(screen.queryByText('Normal')).not.toBeInTheDocument()
})
```

Você vai precisar de um fixture `projetoBase` completo (todos os campos de `InovaProjectDTO`, incluindo os novos `priority: boolean`, `leadershipChallenge: boolean`, `estimatedDeadline: string | null`) — extraia o objeto de fixture já usado no teste existente (o `describe` de "mostra os projetos agrupados por fase") para uma constante `projetoBase` no topo do arquivo, e reaproveite nos 3 testes (existente + os 2 novos), sobrescrevendo só os campos que cada teste precisa via spread. Adicione `import userEvent from '@testing-library/user-event'` se ainda não estiver importado.

- [ ] **Step 3: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/ComunidadeInovaPage.test.tsx`
Expected: FAIL — painel/filtro ainda não existem.

- [ ] **Step 4: Reescrever `ComunidadeInovaPage.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { INOVA_PHASE_POINTS, INOVA_PROJECT_PHASES, canAdminister, inovaCategoryIcon, type InovaProjectDTO } from '@legends/shared'
import { Icon } from '../components/Icon'
import { useAuth } from '../auth/AuthContext'
import { listInovaProjects, updateInovaProject } from '../lib/inova-api'

/**
 * Comunidade INOVA — kanban de projetos (aba "Projetos" de `InovaLayout`).
 * Ver docs/superpowers/specs/2026-09-04-comunidade-inova-experiencia-completa-design.md.
 */
export function ComunidadeInovaPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [soPrioridade, setSoPrioridade] = useState(false)
  const [verArquivados, setVerArquivados] = useState(false)
  const { data, isPending, isError } = useQuery({
    queryKey: ['inova', 'projects', verArquivados],
    queryFn: () => listInovaProjects({ archived: verArquivados }),
  })
  const podeCriar = user ? canAdminister(user) : false

  const togglePrioridade = useMutation({
    mutationFn: (project: InovaProjectDTO) => updateInovaProject(project.id, { priority: !project.priority }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inova', 'projects'] }),
  })

  const projetos = useMemo(() => {
    const lista = data?.projects ?? []
    return soPrioridade ? lista.filter((p) => p.priority) : lista
  }, [data, soPrioridade])

  const evolucaoAreas = useMemo(() => {
    const mapa = new Map<string, { pontos: number; contagem: number }>()
    for (const p of data?.projects ?? []) {
      if (p.archived) continue
      const atual = mapa.get(p.sector) ?? { pontos: 0, contagem: 0 }
      atual.pontos += INOVA_PHASE_POINTS[p.phase]
      atual.contagem += 1
      mapa.set(p.sector, atual)
    }
    return [...mapa.entries()].map(([sector, v]) => ({ sector, ...v })).sort((a, b) => b.pontos - a.pontos)
  }, [data])

  if (isError) {
    return <p className="p-lg text-body-md text-error">Não foi possível carregar os projetos.</p>
  }

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex items-center justify-between gap-md">
        <div>
          <p className="font-label text-label-md uppercase tracking-[0.2em] text-primary">Comunidade INOVA</p>
          <h1 className="mt-2 font-headline text-headline-lg text-on-surface">Projetos de inovação</h1>
        </div>
        {podeCriar && (
          <Link
            to="/comunidade-inova/novo"
            className="inline-flex items-center gap-sm rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
          >
            <Icon name="add" className="text-[18px]" />
            Novo projeto
          </Link>
        )}
      </header>

      {evolucaoAreas.length > 0 && (
        <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-md">
          <h2 className="font-headline text-headline-sm text-on-surface">Evolução das Áreas</h2>
          <p className="text-body-sm text-on-surface-variant">Impacto gerado por cada setor na jornada de inovação</p>
          <ul className="mt-sm flex flex-col gap-sm">
            {evolucaoAreas.map((area) => (
              <li key={area.sector} className="flex items-center justify-between text-body-sm text-on-surface">
                <span>{area.sector}</span>
                <span className="text-on-surface-variant">
                  {area.contagem} proj · {area.pontos} pts
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-sm">
        <button
          type="button"
          onClick={() => setSoPrioridade((v) => !v)}
          className={`inline-flex items-center gap-sm rounded-full border px-md py-1 font-label text-label-sm ${
            soPrioridade ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/60 text-on-surface-variant'
          }`}
        >
          <Icon name="local_fire_department" className="text-[16px]" />
          Só prioridade
        </button>
        <button
          type="button"
          onClick={() => setVerArquivados((v) => !v)}
          className={`inline-flex items-center gap-sm rounded-full border px-md py-1 font-label text-label-sm ${
            verArquivados ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/60 text-on-surface-variant'
          }`}
        >
          <Icon name="archive" className="text-[16px]" />
          Ver arquivados
        </button>
      </div>

      {isPending && <p className="text-body-md text-on-surface-variant">Carregando…</p>}

      <div className="grid grid-cols-1 gap-md md:grid-cols-2 xl:grid-cols-3">
        {INOVA_PROJECT_PHASES.map((phase) => {
          const projetosDaFase = projetos.filter((p) => p.phase === phase.value)
          return (
            <div key={phase.value} className="flex flex-col gap-sm rounded-2xl border border-outline-variant/40 bg-surface-container-low p-md">
              <h2 className="font-headline text-headline-sm text-on-surface">{phase.label}</h2>
              {projetosDaFase.length === 0 && (
                <p className="text-body-sm text-on-surface-variant">Nenhum projeto nesta fase.</p>
              )}
              {projetosDaFase.map((project) => (
                <div key={project.id} className="rounded-xl border border-outline-variant/40 bg-surface-container p-sm">
                  <div className="flex items-start justify-between gap-sm">
                    <span className="font-label text-label-sm text-on-surface-variant">
                      {inovaCategoryIcon(project.category)} {project.category}
                    </span>
                    <button
                      type="button"
                      onClick={() => togglePrioridade.mutate(project)}
                      aria-label={project.priority ? 'Remover prioridade' : 'Marcar como prioridade'}
                      className={project.priority ? 'text-primary' : 'text-on-surface-variant'}
                    >
                      <Icon name="local_fire_department" className="text-[18px]" />
                    </button>
                  </div>
                  <Link to={`/comunidade-inova/projetos/${project.id}`} className="mt-1 block hover:underline">
                    <p className="font-label text-label-md text-on-surface">{project.title}</p>
                  </Link>
                  <p className="mt-1 line-clamp-2 text-body-sm text-on-surface-variant">{project.description}</p>
                  {project.results && <p className="mt-1 line-clamp-1 text-body-sm text-primary">✓ {project.results}</p>}
                  <p className="mt-2 text-body-sm text-on-surface-variant">{project.sector}</p>
                  <p className="text-body-sm text-on-surface-variant">
                    {[project.responsible1, project.responsible2].filter(Boolean).join(', ')}
                  </p>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/ComunidadeInovaPage.test.tsx`
Expected: PASS

- [ ] **Step 6: `tsc` e commit**

Run: `pnpm --filter @legends/web exec tsc --noEmit` (erros restantes devem ser só sobre `InovaResourcesPage`/`InovaHowToPage` ainda não existirem — Tasks 9/10; qualquer outro erro precisa ser corrigido aqui).

```bash
git add apps/web/src/pages/ComunidadeInovaPage.tsx apps/web/src/pages/ComunidadeInovaPage.test.tsx apps/web/src/lib/inova-api.ts
git commit -m "feat(inova): painel de evolução das áreas, cards ricos e filtros no kanban"
```

---

### Task 8: `InovaProjectFormPage` — 12 campos + critérios de elegibilidade

**Files:**
- Modify: `apps/web/src/pages/inova/InovaProjectFormPage.tsx`
- Modify: `apps/web/src/pages/inova/InovaProjectFormPage.test.tsx`
- Modify: `apps/web/src/lib/inova-api.ts`

**Interfaces:**
- Consumes: `INOVA_PROJECT_CATEGORIES` (`@legends/shared`, Task 2).
- Produces: `createInovaProject`/`updateInovaProject` (já existem em `inova-api.ts`) passam a enviar os campos novos.

- [ ] **Step 1: Ajustar o teste existente**

O teste atual (`'cria um projeto novo com título, categoria, setor e descrição'`) só preenche 3 campos e submete — com os novos campos obrigatórios (responsável, problema, prazo, ferramentas, custos, checkbox de critérios) ele vai falhar. Reescreva o teste preenchendo TODOS os campos obrigatórios e marcando o checkbox antes de clicar em "Salvar":

```tsx
it('cria um projeto novo preenchendo todos os campos obrigatórios', async () => {
  vi.mocked(inovaApi.createInovaProject).mockResolvedValue({ project: { id: 'novo-id' } as never })
  const qc = new QueryClient()
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/comunidade-inova/novo']}>
        <Routes>
          <Route path="/comunidade-inova/novo" element={<InovaProjectFormPage />} />
          <Route path="/comunidade-inova/projetos/:id" element={<p>detalhe</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  await userEvent.click(screen.getByLabelText(/li e entendi os critérios/i))
  await userEvent.type(screen.getByLabelText(/título/i), 'Meu projeto')
  await userEvent.type(screen.getByLabelText(/^categoria/i), 'Automação de processos')
  await userEvent.type(screen.getByLabelText(/^setor/i), 'Ensino')
  await userEvent.type(screen.getByLabelText(/responsável pelo projeto/i), 'Fulano de Tal')
  await userEvent.type(screen.getByLabelText(/^descrição do projeto/i), 'Descrição do projeto')
  await userEvent.type(screen.getByLabelText(/qual problema/i), 'Resolve X')
  await userEvent.type(screen.getByLabelText(/qual o prazo/i), '3 meses')
  await userEvent.type(screen.getByLabelText(/quais ferramentas/i), 'ChatGPT')
  await userEvent.type(screen.getByLabelText(/quais custos/i), 'Nenhum')
  await userEvent.click(screen.getByRole('button', { name: /salvar|lançar projeto/i }))

  await waitFor(() => expect(inovaApi.createInovaProject).toHaveBeenCalled())
  await waitFor(() => expect(screen.getByText('detalhe')).toBeInTheDocument())
})

it('não permite submeter sem aceitar os critérios de elegibilidade', async () => {
  const qc = new QueryClient()
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/comunidade-inova/novo']}>
        <Routes>
          <Route path="/comunidade-inova/novo" element={<InovaProjectFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  await userEvent.type(screen.getByLabelText(/título/i), 'Meu projeto')
  await userEvent.click(screen.getByRole('button', { name: /salvar|lançar projeto/i }))

  expect(await screen.findByText(/aceitar os critérios/i)).toBeInTheDocument()
  expect(inovaApi.createInovaProject).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/InovaProjectFormPage.test.tsx`
Expected: FAIL — campos ainda não existem.

- [ ] **Step 3: Ajustar `inova-api.ts`**

Troque a assinatura de `createInovaProject`/`updateInovaProject` para aceitar os campos novos — na prática já aceitam via `Partial<InovaProjectDTO>`, então **nenhuma mudança de assinatura é necessária** aqui; confirme lendo o arquivo. Pule este step se já compilar sem erro.

- [ ] **Step 4: Reescrever `InovaProjectFormPage.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { INOVA_PROJECT_CATEGORIES, INOVA_SUGGESTED_SECTORS } from '@legends/shared'
import { ApiError } from '../../lib/api'
import { createInovaProject, updateInovaProject, getInovaProjectDetail } from '../../lib/inova-api'
import { useQuery } from '@tanstack/react-query'

const inputCls = 'rounded-md border border-outline-variant/60 bg-surface px-md py-sm text-body-md text-on-surface'
const ONBOARDING_KEY = 'inova_onboarding_seen'

const CRITERIOS = [
  {
    titulo: 'O projeto precisa utilizar Inteligência Artificial',
    texto:
      'A solução deve envolver o uso de IA, como automações inteligentes, análise de dados, agentes, chatbots ou outras aplicações de inteligência artificial.',
  },
  {
    titulo: 'O projeto deve automatizar ou melhorar um processo do setor',
    texto: 'O objetivo é resolver um problema real do dia a dia, seja na sua função ou em alguma atividade da equipe.',
  },
  {
    titulo: 'Máximo de duas pessoas responsáveis pelo projeto',
    texto:
      'Cada projeto pode ter até dois responsáveis, que serão os donos da iniciativa e responsáveis por atualizar o andamento.',
  },
  {
    titulo: 'Para apresentar no evento INOVA o projeto precisa estar na fase final',
    texto:
      'Somente projetos que chegarem na etapa "Expandindo para Mais Pessoas" poderão ser apresentados no evento de encerramento do INOVA.',
  },
]

export function InovaProjectFormPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id?: string }>()
  const isEdit = Boolean(id)
  const existing = useQuery({
    queryKey: ['inova', 'project', id],
    queryFn: () => getInovaProjectDetail(id as string),
    enabled: isEdit,
  })

  const [criteriosAceitos, setCriteriosAceitos] = useState(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [sector, setSector] = useState('')
  const [responsible1, setResponsible1] = useState('')
  const [responsible2, setResponsible2] = useState('')
  const [sectorRepresentative, setSectorRepresentative] = useState('')
  const [leadershipChallenge, setLeadershipChallenge] = useState(false)
  const [description, setDescription] = useState('')
  const [problemDescription, setProblemDescription] = useState('')
  const [estimatedDeadline, setEstimatedDeadline] = useState('')
  const [toolsUsed, setToolsUsed] = useState('')
  const [projectCosts, setProjectCosts] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  useEffect(() => {
    if (existing.data) {
      const p = existing.data.project
      setTitle(p.title)
      setCategory(p.category)
      setSector(p.sector)
      setResponsible1(p.responsible1 ?? '')
      setResponsible2(p.responsible2 ?? '')
      setSectorRepresentative(p.sectorRepresentative ?? '')
      setLeadershipChallenge(p.leadershipChallenge)
      setDescription(p.description)
      setProblemDescription(p.problemDescription ?? '')
      setEstimatedDeadline(p.estimatedDeadline ?? '')
      setToolsUsed(p.toolsUsed ?? '')
      setProjectCosts(p.projectCosts ?? '')
    }
  }, [existing.data])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!isEdit && !criteriosAceitos) {
      setError('Você precisa aceitar os critérios para cadastrar o projeto.')
      return
    }
    if (!title.trim() || !sector.trim() || !description.trim()) {
      setError('Preencha todos os campos obrigatórios.')
      return
    }
    if (!responsible1.trim()) {
      setError('Informe um responsável para o projeto.')
      return
    }
    if (!problemDescription.trim()) {
      setError('Este campo é obrigatório para continuar. Descreva qual problema o projeto resolve.')
      return
    }
    if (!estimatedDeadline.trim()) {
      setError('Informe o prazo estimado para finalizar o projeto.')
      return
    }
    if (!toolsUsed.trim()) {
      setError('Informe quais ferramentas você está usando ou usou.')
      return
    }
    if (!projectCosts.trim()) {
      setError('Informe os custos estimados do projeto.')
      return
    }

    setSaving(true)
    const payload = {
      title,
      category,
      sector,
      responsible1,
      responsible2: responsible2 || null,
      sectorRepresentative: sectorRepresentative || null,
      leadershipChallenge,
      description,
      problemDescription,
      estimatedDeadline,
      toolsUsed,
      projectCosts,
    }
    try {
      const result = isEdit
        ? await updateInovaProject(id as string, payload)
        : await createInovaProject(payload)
      if (!isEdit && !localStorage.getItem(ONBOARDING_KEY)) {
        localStorage.setItem(ONBOARDING_KEY, 'true')
        setShowSuccess(true)
        return
      }
      navigate(`/comunidade-inova/projetos/${result.project.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar o projeto.')
    } finally {
      setSaving(false)
    }
  }

  if (showSuccess) {
    return (
      <section className="mx-auto flex max-w-lg flex-col gap-md rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg text-center">
        <h1 className="font-headline text-headline-lg text-on-surface">Projeto cadastrado com sucesso! 🚀</h1>
        <p className="text-body-md text-on-surface-variant">
          Obrigada por cadastrar seu projeto! Ficamos felizes em ver você fazendo parte dessa jornada de inovação com
          a gente.
        </p>
        <p className="text-body-md text-on-surface-variant">
          Você sabia que pode adicionar vídeos, documentos e gerenciar o andamento do seu projeto diretamente pela
          plataforma?
        </p>
        <p className="text-body-md text-on-surface-variant">Para aproveitar tudo isso, acesse nosso guia rápido de uso.</p>
        <div className="mt-sm flex flex-wrap justify-center gap-md">
          <button
            type="button"
            onClick={() => navigate('/comunidade-inova/como-usar')}
            className="rounded-full border border-outline-variant/60 px-lg py-sm font-label text-label-md text-primary hover:border-primary/60"
          >
            Como usar a Plataforma INOVA
          </button>
          <button
            type="button"
            onClick={() => navigate('/comunidade-inova/projetos')}
            className="rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary"
          >
            Ir para os projetos
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-lg">
      <h1 className="font-headline text-headline-lg text-on-surface">
        {isEdit ? 'Editar projeto' : 'Cadastrar Novo Projeto'}
      </h1>

      {!isEdit && (
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
          <h2 className="font-headline text-headline-sm text-on-surface">Critérios para cadastrar um projeto no INOVA</h2>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Antes de cadastrar, confira se o seu projeto atende aos requisitos abaixo:
          </p>
          <ul className="mt-md flex flex-col gap-sm">
            {CRITERIOS.map((c) => (
              <li key={c.titulo} className="rounded-xl border border-outline-variant/40 p-sm">
                <p className="font-label text-label-md text-on-surface">{c.titulo}</p>
                <p className="mt-1 text-body-sm text-on-surface-variant">{c.texto}</p>
              </li>
            ))}
          </ul>
          <label className="mt-md flex items-start gap-sm">
            <input
              type="checkbox"
              checked={criteriosAceitos}
              onChange={(e) => setCriteriosAceitos(e.target.checked)}
              className="mt-1"
            />
            <span className="text-body-md text-on-surface">
              Li e entendi os critérios para cadastro de projetos no INOVA
            </span>
          </label>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-md">
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Título do Projeto *</span>
          <input aria-label="Título do Projeto" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} required />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Setor *</span>
          <input aria-label="Setor" list="inova-setores" value={sector} onChange={(e) => setSector(e.target.value)} className={inputCls} required />
          <datalist id="inova-setores">
            {INOVA_SUGGESTED_SECTORS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>

        <div className="grid grid-cols-1 gap-md md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Responsável pelo Projeto *</span>
            <input
              aria-label="Responsável pelo Projeto"
              value={responsible1}
              onChange={(e) => setResponsible1(e.target.value)}
              className={inputCls}
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Responsável 2 (opcional)</span>
            <input
              aria-label="Responsável 2"
              value={responsible2}
              onChange={(e) => setResponsible2(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Representante do setor (opcional)</span>
          <input
            aria-label="Representante do setor"
            value={sectorRepresentative}
            onChange={(e) => setSectorRepresentative(e.target.value)}
            className={inputCls}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Categoria *</span>
          <input
            aria-label="Categoria"
            list="inova-categorias"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputCls}
            required
          />
          <datalist id="inova-categorias">
            {INOVA_PROJECT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value} />
            ))}
          </datalist>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Projeto Desafio Alta Liderança? *</span>
          <select
            aria-label="Projeto Desafio Alta Liderança?"
            value={leadershipChallenge ? 'sim' : 'nao'}
            onChange={(e) => setLeadershipChallenge(e.target.value === 'sim')}
            className={inputCls}
          >
            <option value="nao">Não</option>
            <option value="sim">Sim</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Descrição do Projeto *</span>
          <textarea
            aria-label="Descrição do Projeto"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
            required
            rows={4}
            placeholder="Descreva o que é o seu projeto, se será uma automação, agente de IA, etc. Inclua também como usará ou usou a IA."
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">
            Qual problema ou operação este projeto resolve? Como ele auxilia no dia a dia? *
          </span>
          <textarea
            aria-label="Qual problema ou operação este projeto resolve? Como ele auxilia no dia a dia?"
            value={problemDescription}
            onChange={(e) => setProblemDescription(e.target.value)}
            className={inputCls}
            required
            rows={4}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Qual o prazo para finalizar o projeto? (estimado) *</span>
          <input
            aria-label="Qual o prazo para finalizar o projeto? (estimado)"
            value={estimatedDeadline}
            onChange={(e) => setEstimatedDeadline(e.target.value)}
            className={inputCls}
            required
            placeholder="Ex: 30/06/2026 ou 3 meses"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">
            Quais ferramentas você está usando ou usou para construir o projeto? *
          </span>
          <textarea
            aria-label="Quais ferramentas você está usando ou usou para construir o projeto?"
            value={toolsUsed}
            onChange={(e) => setToolsUsed(e.target.value)}
            className={inputCls}
            required
            rows={3}
            placeholder="Ex: ChatGPT, n8n, Make, Power BI, Python..."
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Quais custos o projeto tem/teve? (estimado) *</span>
          <textarea
            aria-label="Quais custos o projeto tem/teve? (estimado)"
            value={projectCosts}
            onChange={(e) => setProjectCosts(e.target.value)}
            className={inputCls}
            required
            rows={3}
            placeholder="Ex: R$ 200/mês de assinatura da ferramenta X, R$ 1.500 de implementação..."
          />
        </label>

        {error && <p className="text-body-sm text-error">{error}</p>}

        <button
          type="submit"
          disabled={saving || (!isEdit && !criteriosAceitos)}
          className="inline-flex w-fit items-center rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:opacity-60"
        >
          {isEdit ? (saving ? 'Salvando...' : 'Salvar Alterações') : saving ? 'Lançando...' : 'Lançar Projeto'}
        </button>
      </form>
    </section>
  )
}
```

Nota sobre o teste "não permite submeter sem aceitar os critérios": como `title` sozinho não passa da primeira validação (`!isEdit && !criteriosAceitos`), o teste do Step 1 já cobre isso corretamente — a ordem das validações no `handleSubmit` acima checa `criteriosAceitos` **antes** de checar os outros campos, então a mensagem certa aparece mesmo com só o título preenchido.

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/InovaProjectFormPage.test.tsx`
Expected: PASS

- [ ] **Step 6: `tsc` e commit**

Run: `pnpm --filter @legends/web exec tsc --noEmit`

```bash
git add apps/web/src/pages/inova/InovaProjectFormPage.tsx apps/web/src/pages/inova/InovaProjectFormPage.test.tsx apps/web/src/lib/inova-api.ts
git commit -m "feat(inova): formulário de projeto expandido com os 12 campos e critérios de elegibilidade"
```

---

### Task 9: `InovaResourcesPage` (Recursos)

**Files:**
- Create: `apps/web/src/pages/inova/InovaResourcesPage.tsx`
- Create: `apps/web/src/pages/inova/InovaResourcesPage.test.tsx`

- [ ] **Step 1: Escrever o teste**

```tsx
// apps/web/src/pages/inova/InovaResourcesPage.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InovaResourcesPage } from './InovaResourcesPage'

describe('InovaResourcesPage', () => {
  it('mostra o título e os 4 cards de recursos', () => {
    render(<InovaResourcesPage />)
    expect(screen.getByText('Recursos para evoluir')).toBeInTheDocument()
    expect(screen.getByText('Mentorias da Viver de IA')).toBeInTheDocument()
    expect(screen.getByText('Cursos e trilhas')).toBeInTheDocument()
    expect(screen.getByText('Comunidade de protagonistas')).toBeInTheDocument()
    expect(screen.getByText('Trilha AI First, Impulse UP')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/InovaResourcesPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Escrever `InovaResourcesPage.tsx`**

```tsx
import { Icon } from '../../components/Icon'

const RECURSOS = [
  {
    icone: 'auto_awesome',
    titulo: 'Mentorias da Viver de IA',
    texto:
      'Sessões com especialistas para acelerar seu projeto. Receba orientação sobre estratégia, ferramentas e implementação, porque aprendizado contínuo é parte da nossa cultura.',
  },
  {
    icone: 'menu_book',
    titulo: 'Cursos e trilhas',
    texto:
      'Trilhas estruturadas para desenvolver suas habilidades em IA, automação e análise de dados. Evolua com método e aplique no seu projeto.',
  },
  {
    icone: 'groups',
    titulo: 'Comunidade de protagonistas',
    texto:
      'Conecte-se com outros colaboradores que estão tirando ideias do papel. Troque experiências, aprenda junto e fortaleça a força coletiva.',
  },
]

export function InovaResourcesPage() {
  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h1 className="font-headline text-headline-lg text-on-surface">Recursos para evoluir</h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Ferramentas, conhecimento e pessoas para fortalecer sua jornada de inovação
        </p>
      </header>

      <div className="grid grid-cols-1 gap-md md:grid-cols-2">
        {RECURSOS.map((r) => (
          <div key={r.titulo} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
            <Icon name={r.icone} className="text-[24px] text-primary" />
            <h2 className="mt-2 font-headline text-headline-sm text-on-surface">{r.titulo}</h2>
            <p className="mt-1 text-body-md text-on-surface-variant">{r.texto}</p>
          </div>
        ))}
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
          <Icon name="rocket_launch" className="text-[24px] text-primary" />
          <h2 className="mt-2 font-headline text-headline-sm text-on-surface">Trilha AI First, Impulse UP</h2>
          <p className="mt-1 text-body-md text-on-surface-variant">
            Desenvolva competências estratégicas em Inteligência Artificial na plataforma Impulse UP. Um passo a mais
            na sua evolução profissional.
          </p>
          <a
            href="https://eu-medico-residente.impulseup.com/dashboard/appraisals/competencies/babafbae-e47b-42d8-9876-4f60c8627dde/appraisal-results;type=competencies"
            target="_blank"
            rel="noreferrer"
            className="mt-md inline-flex items-center gap-sm rounded-full border border-outline-variant/60 px-lg py-sm font-label text-label-md text-primary hover:border-primary/60"
          >
            Acessar
            <Icon name="open_in_new" className="text-[16px]" />
          </a>
        </div>
      </div>

      <div className="rounded-2xl bg-primary p-lg text-on-primary md:p-xl">
        <Icon name="school" className="text-[28px]" />
        <h2 className="mt-2 font-headline text-headline-sm">Aprendizado contínuo é parte do nosso DNA</h2>
        <p className="mt-1 text-body-md">Acesse a plataforma Viver de IA e continue evoluindo com propósito.</p>
        <a
          href="https://app.viverdeia.ai/team-management"
          target="_blank"
          rel="noreferrer"
          className="mt-md inline-flex items-center gap-sm rounded-full bg-on-primary px-lg py-sm font-label text-label-md font-bold text-primary hover:opacity-90"
        >
          Acessar Viver de IA
        </a>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/InovaResourcesPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/inova/InovaResourcesPage.tsx apps/web/src/pages/inova/InovaResourcesPage.test.tsx
git commit -m "feat(inova): página Recursos"
```

---

### Task 10: `InovaHowToPage` (Como usar)

**Files:**
- Create: `apps/web/src/pages/inova/InovaHowToPage.tsx`
- Create: `apps/web/src/pages/inova/InovaHowToPage.test.tsx`

- [ ] **Step 1: Escrever o teste**

```tsx
// apps/web/src/pages/inova/InovaHowToPage.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InovaHowToPage } from './InovaHowToPage'

describe('InovaHowToPage', () => {
  it('mostra o título e as seções de passo a passo', () => {
    render(<InovaHowToPage />)
    expect(screen.getByText('Como participar da transformação')).toBeInTheDocument()
    expect(screen.getByText('Como tirar sua ideia do papel')).toBeInTheDocument()
    expect(screen.getByText('Como evoluir seu projeto')).toBeInTheDocument()
    expect(screen.getByText('Registre sua jornada no diário')).toBeInTheDocument()
    expect(screen.getByText('Organize a execução com o Kanban')).toBeInTheDocument()
    expect(screen.getByText('Boas práticas para gerar impacto')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/InovaHowToPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Escrever `InovaHowToPage.tsx`**

```tsx
const IDEIA_PASSOS = [
  'Acesse a aba "Projetos" no menu',
  'Clique em "Criar projeto" e comece',
  'Preencha título, setor e categoria',
  'Descreva o problema que você quer resolver e sua proposta de solução',
  'Salve e dê o primeiro passo',
]

const EVOLUIR_PASSOS = [
  'Acesse seu projeto na lista',
  'Clique em "Editar / Atualizar"',
  'Registre avanços, ajustes e aprendizados',
  'Salve e continue construindo',
]

const DIARIO_PASSOS = ['Acesse o projeto desejado', 'Vá até a seção de diário', 'Adicione atualizações, evidências e links', 'Salve e compartilhe seu progresso']

const KANBAN_PASSOS = [
  'Acesse o projeto desejado',
  'Vá até a seção de tarefas (Kanban)',
  'Crie tarefas com título, responsável e prazo',
  'Mova as tarefas conforme o progresso',
  'Acompanhe o que está evoluindo e o que precisa de atenção',
]

const EVOLUCAO_BLOCOS = [
  {
    titulo: 'Evolução com propósito',
    texto:
      'Cada projeto avança por fases na esteira de inovação. Conforme evolui, os pontos e o status são atualizados, porque progresso se mede por impacto, não só por entrega.',
  },
  {
    titulo: 'Histórico que conta uma história',
    texto:
      'Mudanças de fase e registros do diário criam uma linha do tempo completa, documentando aprendizados e decisões ao longo do caminho.',
  },
  {
    titulo: 'Transparência para toda a organização',
    texto:
      'A liderança acompanha o progresso de cada área, garantindo reconhecimento e visibilidade para quem constrói com consistência.',
  },
]

const BOAS_PRATICAS = [
  { titulo: 'Atualize com constância', texto: 'Projetos que evoluem com frequência refletem execução real e comprometimento.' },
  { titulo: 'Registre o que aprendeu', texto: 'Cada aprendizado compartilhado fortalece toda a comunidade.' },
  { titulo: 'Documente com evidências', texto: 'Prints, vídeos e links transformam percepções em resultados concretos.' },
  { titulo: 'Seja claro e direto', texto: 'Linguagem simples garante que qualquer pessoa entenda e se inspire.' },
]

function ListaPassos({ titulo, passos, intro }: { titulo: string; passos: string[]; intro?: string }) {
  return (
    <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
      <h2 className="font-headline text-headline-sm text-on-surface">{titulo}</h2>
      {intro && <p className="mt-1 text-body-md text-on-surface-variant">{intro}</p>}
      <ol className="mt-md flex flex-col gap-sm">
        {passos.map((passo, index) => (
          <li key={passo} className="flex gap-sm text-body-md text-on-surface">
            <span className="font-label text-label-md text-primary">{index + 1}.</span>
            {passo}
          </li>
        ))}
      </ol>
    </section>
  )
}

export function InovaHowToPage() {
  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h1 className="font-headline text-headline-lg text-on-surface">Como participar da transformação</h1>
        <p className="mt-1 text-body-md text-on-surface-variant">Um guia simples para você usar o site da Comunidade INOVA</p>
      </header>

      <ListaPassos titulo="Como tirar sua ideia do papel" passos={IDEIA_PASSOS} />
      <ListaPassos titulo="Como evoluir seu projeto" passos={EVOLUIR_PASSOS} />
      <ListaPassos
        titulo="Registre sua jornada no diário"
        intro="O diário é o espaço para documentar a evolução do seu projeto, com textos, imagens e links. Cada registro conta a história do que você está construindo."
        passos={DIARIO_PASSOS}
      />
      <ListaPassos
        titulo="Organize a execução com o Kanban"
        intro="Cada projeto tem um quadro Kanban para organizar tarefas de forma visual, porque execução consistente é o que transforma ideias em resultados."
        passos={KANBAN_PASSOS}
      />

      <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <h2 className="font-headline text-headline-sm text-on-surface">Como acompanhamos a evolução</h2>
        <div className="mt-md grid grid-cols-1 gap-md md:grid-cols-3">
          {EVOLUCAO_BLOCOS.map((b) => (
            <div key={b.titulo}>
              <p className="font-label text-label-md text-on-surface">{b.titulo}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{b.texto}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <h2 className="font-headline text-headline-sm text-on-surface">Boas práticas para gerar impacto</h2>
        <div className="mt-md grid grid-cols-1 gap-md md:grid-cols-2">
          {BOAS_PRATICAS.map((b) => (
            <div key={b.titulo}>
              <p className="font-label text-label-md text-on-surface">{b.titulo}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{b.texto}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/InovaHowToPage.test.tsx`
Expected: PASS

- [ ] **Step 5: `tsc`, build e commit**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros — **esta é a primeira vez que `App.tsx` compila desde a Task 4**, porque as 3 páginas que faltavam (`InovaHomePage`, `InovaResourcesPage`, `InovaHowToPage`) agora existem.

```bash
git add apps/web/src/pages/inova/InovaHowToPage.tsx apps/web/src/pages/inova/InovaHowToPage.test.tsx
git commit -m "feat(inova): página Como usar"
```

---

### Task 11: Verificação final

**Files:** nenhum (só execução)

- [ ] **Step 1: Suíte completa**

Run: `pnpm db:up && pnpm --filter @legends/api test`
Run: `pnpm --filter @legends/web test`
Run: `pnpm --filter @legends/shared test`
Expected: todos os testes do INOVA passando. Falhas pré-existentes não relacionadas (já documentadas em execuções anteriores desta feature) não bloqueiam — mas rode `git diff origin/main --stat` sobre qualquer arquivo que falhar para confirmar que esta leva não o tocou, antes de descartar a falha como pré-existente.

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: todos os workspaces buildam sem erro de tipo.

- [ ] **Step 3: Verificação manual (registrar como pendente)**

Sem navegador nesta sessão headless — registre como pendente: subir `pnpm dev`, habilitar `inovaModuleEnabled` para a EMR, e percorrer Início → Projetos (conferir Evolução das Áreas e o toggle de prioridade) → Criar projeto (preencher os 12 campos) → Recursos → Como usar.

- [ ] **Step 4: Commit final se sobrar algo solto**

```bash
git status
```
