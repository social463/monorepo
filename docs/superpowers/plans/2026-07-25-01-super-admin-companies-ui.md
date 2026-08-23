# Editar/ativar-desativar empresa (Super Admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao Super Admin um jeito de renomear e ativar/desativar uma empresa
pela `SuperAdminPage` já existente (hoje a lista é só leitura).

**Architecture:** Novo `PATCH /super-admin/companies/:id` na API (inline em
`super-admin.ts`, sem service próprio — mesmo padrão do arquivo). No frontend,
a lista de empresas ganha um componente de linha com edição inline
(`CompanyRow`), mesmo padrão de `AdministratorRow` em
`pages/admin/AdministratorsSection.tsx`: modo leitura com botões
"Editar"/"Ativar"-"Desativar", modo edição com campo de nome + toggle + Salvar/
Cancelar.

**Tech Stack:** Fastify + Zod + Prisma (API), React + React Query + Tailwind (web).

## Global Constraints

- `PATCH /super-admin/companies/:id` exige pelo menos um campo (`name` ou
  `active`) no body — corpo vazio é 400.
- Renomear recalcula o `slug` via `slugify(name)` (`apps/api/src/lib/slug.ts`),
  igual ao `POST` já existente.
- 404 se a empresa não existir (`Prisma.PrismaClientKnownRequestError` código
  `P2025`); 409 se o novo nome colidir com o slug de outra empresa (código
  `P2002`).
- `active` continua puramente informativo nesta fatia — nenhuma rota de login/
  acesso é alterada para checar `company.active` (fora de escopo, ver spec).
- Guard: `superAdminOnly` (já definido em `superAdminRoutes`, primeira linha do
  arquivo) — mesmo gate do `GET`/`POST` existentes.
- Mensagens ao usuário em português, mesmo estilo das rotas vizinhas
  (`'Dados inválidos'`, `'Empresa não encontrada.'`, etc.).

---

### Task 1: `PATCH /super-admin/companies/:id`

**Files:**
- Modify: `apps/api/src/routes/super-admin.ts`
- Test: `apps/api/src/routes/super-admin.test.ts`

**Interfaces:**
- Consumes: `superAdminOnly` (onRequest guard, já definido na linha 19 do
  arquivo), `slugify` (`../lib/slug`), `prisma` (`../lib/prisma`), `Prisma`
  (`@prisma/client`, já importado).
- Produces: endpoint HTTP `PATCH /super-admin/companies/:id`, body
  `{ name?: string, active?: boolean }`, resposta `{ company: Company }` (200),
  usado pela `SuperAdminPage.tsx` na Task 2.

- [ ] **Step 1: Escrever os testes falhando**

O arquivo `apps/api/src/routes/super-admin.test.ts` já existe com um helper
`superAdminToken(app)` e `adminToken(app)` — reaproveite os dois, não recrie.
Adicione estes 5 casos dentro do `describe('super-admin routes', ...)` já
existente, logo depois do teste `'rejeita ADMIN comum (403) e requisição sem
token (401)'` (último do arquivo hoje):

```ts
  it('PATCH renomeia a empresa e recalcula o slug', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Original', admin: { name: 'A', email: 'a@original.com', password: 'changeme123' } },
    })
    const companyId = created.json().company.id as string

    const res = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${companyId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Renomeada' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().company.name).toBe('Empresa Renomeada')
    expect(res.json().company.slug).toBe('empresa-renomeada')
    await app.close()
  })

  it('PATCH ativa/desativa a empresa', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Toggle', admin: { name: 'A', email: 'a@toggle.com', password: 'changeme123' } },
    })
    const companyId = created.json().company.id as string

    const off = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${companyId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { active: false },
    })
    expect(off.statusCode).toBe(200)
    expect(off.json().company.active).toBe(false)

    const on = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${companyId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { active: true },
    })
    expect(on.json().company.active).toBe(true)
    await app.close()
  })

  it('PATCH em empresa inexistente devolve 404', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const res = await app.inject({
      method: 'PATCH', url: '/super-admin/companies/nao-existe',
      headers: { authorization: `Bearer ${token}` },
      payload: { active: false },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('PATCH rejeita nome colidindo com slug de outra empresa (409)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Alvo', admin: { name: 'A', email: 'a@alvo.com', password: 'changeme123' } },
    })
    const other = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Outra', admin: { name: 'B', email: 'b@outra.com', password: 'changeme123' } },
    })
    const otherId = other.json().company.id as string

    const res = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${otherId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Alvo' },
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('PATCH rejeita corpo vazio (400) e ADMIN comum (403)', async () => {
    const app = buildApp()
    await app.ready()
    const superToken = await superAdminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${superToken}` },
      payload: { name: 'Empresa Guard', admin: { name: 'A', email: 'a@guard.com', password: 'changeme123' } },
    })
    const companyId = created.json().company.id as string

    const emptyBody = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${companyId}`,
      headers: { authorization: `Bearer ${superToken}` },
      payload: {},
    })
    expect(emptyBody.statusCode).toBe(400)

    const adminTk = await adminToken(app)
    const forbidden = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${companyId}`,
      headers: { authorization: `Bearer ${adminTk}` },
      payload: { active: false },
    })
    expect(forbidden.statusCode).toBe(403)
    await app.close()
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/super-admin.test.ts`
Expected: FAIL — `PATCH /super-admin/companies/:id` ainda não existe, Fastify
devolve 404 de rota não encontrada pra todo o bloco novo.

- [ ] **Step 3: Implementar o endpoint**

Modify `apps/api/src/routes/super-admin.ts` — adicionar, logo abaixo de
`createCompanySchema`:

```ts
const updateCompanySchema = z
  .object({
    name: z.string().min(1).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => d.name !== undefined || d.active !== undefined, { message: 'Informe ao menos um campo.' })
```

E, dentro de `superAdminRoutes`, logo após o `app.post('/super-admin/companies', ...)` existente (antes do fechamento da função):

```ts
  app.patch('/super-admin/companies/:id', superAdminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateCompanySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const data: Prisma.CompanyUpdateInput = {}
    if (parsed.data.name !== undefined) {
      data.name = parsed.data.name
      data.slug = slugify(parsed.data.name)
    }
    if (parsed.data.active !== undefined) data.active = parsed.data.active
    try {
      const company = await prisma.company.update({ where: { id }, data })
      return reply.send({ company })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return reply.code(404).send({ message: 'Empresa não encontrada.' })
        if (err.code === 'P2002') return reply.code(409).send({ message: 'Já existe uma empresa com esse nome.' })
      }
      throw err
    }
  })
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/routes/super-admin.test.ts`
Expected: PASS em todos os 9 testes do arquivo (4 já existentes + 5 novos).

- [ ] **Step 5: tsc**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros novos relacionados a `super-admin.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/super-admin.ts apps/api/src/routes/super-admin.test.ts
git commit -m "feat: adiciona PATCH /super-admin/companies/:id (renomear + ativar/desativar)"
```

---

### Task 2: Edição inline na `SuperAdminPage`

**Files:**
- Modify: `packages/shared/src/company.ts`
- Modify: `apps/web/src/pages/SuperAdminPage.tsx`
- Test: `apps/web/src/pages/SuperAdminPage.test.tsx`

**Interfaces:**
- Consumes: `PATCH /super-admin/companies/:id` (Task 1), `CompanyDTO`
  (`@legends/shared`, já importado em `SuperAdminPage.tsx`), `Panel`/`inputCls`
  (`./admin/shared`, já importados), `Icon` (`../components/Icon`, já
  importado), `ApiError`/`apiFetch` (`../lib/api`, já importados).
- Produces: `UpdateCompanyRequest` (novo tipo em `@legends/shared`), componente
  `CompanyRow` (interno a `SuperAdminPage.tsx`, não exportado).

- [ ] **Step 1: Adicionar o tipo compartilhado**

Modify `packages/shared/src/company.ts` — arquivo inteiro fica:

```ts
/** IDs fixos criados pela migration de backfill (não são cuids gerados). */
export const DEFAULT_COMPANY_ID = 'company-emr'
export const INTERNAL_COMPANY_ID = 'company-legends-internal'

export interface CompanyDTO {
  id: string
  name: string
  slug: string
  active: boolean
}

export interface UpdateCompanyRequest {
  name?: string
  active?: boolean
}
```

- [ ] **Step 2: Escrever os testes falhando**

Modify `apps/web/src/pages/SuperAdminPage.test.tsx` — trocar `setupFetch` (a
única função que precisa mudar) e adicionar 2 testes novos ao final do
`describe('SuperAdminPage', ...)`:

```ts
function setupFetch() {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/super-admin/companies' && !method) {
      return Promise.resolve({
        companies: [{ id: 'c1', name: 'EMR', slug: 'emr', active: true }],
      })
    }
    if (path === '/super-admin/companies' && method === 'POST') {
      return Promise.resolve({
        company: { id: 'c2', name: 'Empresa Nova', slug: 'empresa-nova', active: true },
        admin: { id: 'u2', name: 'Admin Nova', role: 'ADMIN' },
      })
    }
    if (path === '/super-admin/companies/c1' && method === 'PATCH') {
      return Promise.resolve({
        company: { id: 'c1', name: 'EMR Renomeada', slug: 'emr-renomeada', active: true },
      })
    }
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
}
```

Adicionar ao final do arquivo, dentro do `describe`:

```ts
  it('edita o nome de uma empresa via PATCH', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Nome da empresa'), { target: { value: 'EMR Renomeada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/super-admin/companies/c1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'EMR Renomeada', active: true }),
        }),
      ),
    )
  })

  it('ativa/desativa uma empresa direto pelo atalho', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Desativar' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/super-admin/companies/c1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ active: false }),
        }),
      ),
    )
  })
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/SuperAdminPage.test.tsx`
Expected: FAIL — os testes novos não encontram botão "Editar"/"Desativar"
(a lista hoje é só leitura, sem esses botões).

- [ ] **Step 4: Implementar a edição inline**

Modify `apps/web/src/pages/SuperAdminPage.tsx` — arquivo inteiro fica:

```tsx
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CompanyDTO, PublicUser, UpdateCompanyRequest } from '@legends/shared'
import { ApiError, apiFetch } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { Icon } from '../components/Icon'
import { Panel, inputCls } from './admin/shared'

interface CreateCompanyForm {
  name: string
  adminName: string
  adminEmail: string
  adminPassword: string
}

const emptyForm: CreateCompanyForm = { name: '', adminName: '', adminEmail: '', adminPassword: '' }

// ----- Linha de empresa (com edição inline) -----
function CompanyRow({
  company,
  onSave,
  onToggle,
}: {
  company: CompanyDTO
  onSave: (id: string, data: UpdateCompanyRequest) => void
  onToggle: (id: string, active: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(company.name)
  const [active, setActive] = useState(company.active)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setEditing(false)
    setName(company.name)
    setActive(company.active)
    setError(null)
  }

  function handleSave() {
    if (!name.trim()) {
      setError('O nome da empresa é obrigatório.')
      return
    }
    onSave(company.id, { name: name.trim(), active })
    setEditing(false)
  }

  if (editing) {
    return (
      <li className="flex flex-col gap-sm rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome da empresa" />
        <label className="flex items-center gap-sm font-label text-label-sm text-on-surface-variant">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Ativa
        </label>
        {error && (
          <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
            <Icon name="error" className="text-[16px]" />
            {error}
          </p>
        )}
        <div className="flex gap-sm">
          <button
            type="button"
            onClick={handleSave}
            className="rounded-md bg-primary px-md py-1 font-label text-label-sm font-bold text-on-primary hover:bg-primary-container"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
          >
            Cancelar
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className="flex items-center justify-between gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
      <span className={company.active ? 'text-on-surface' : 'text-on-surface-variant line-through'}>
        {company.name}
        <span className="ml-2 font-label text-label-sm text-on-surface-variant">{company.slug}</span>
      </span>
      <div className="flex shrink-0 gap-sm">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
        >
          Editar
        </button>
        <button
          type="button"
          onClick={() => onToggle(company.id, !company.active)}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
        >
          {company.active ? 'Desativar' : 'Ativar'}
        </button>
      </div>
    </li>
  )
}

export function SuperAdminPage() {
  const { logout } = useAuth()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CreateCompanyForm>(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)

  const companiesQuery = useQuery({
    queryKey: ['super-admin', 'companies'],
    queryFn: () => apiFetch<{ companies: CompanyDTO[] }>('/super-admin/companies'),
  })
  const invalidateCompanies = () => queryClient.invalidateQueries({ queryKey: ['super-admin', 'companies'] })

  const createCompany = useMutation({
    mutationFn: (body: { name: string; admin: { name: string; email: string; password: string } }) =>
      apiFetch<{ company: CompanyDTO; admin: PublicUser }>('/super-admin/companies', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setForm(emptyForm)
      setShowForm(false)
      setFormError(null)
      invalidateCompanies()
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : 'Erro ao criar empresa.'),
  })

  const updateCompany = useMutation({
    mutationFn: (vars: { id: string; data: UpdateCompanyRequest }) =>
      apiFetch<{ company: CompanyDTO }>(`/super-admin/companies/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify(vars.data),
      }),
    onSuccess: () => {
      setUpdateError(null)
      invalidateCompanies()
    },
    onError: (err) => setUpdateError(err instanceof ApiError ? err.message : 'Erro ao atualizar empresa.'),
  })

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!form.name.trim() || !form.adminName.trim() || !form.adminEmail.trim() || form.adminPassword.length < 8) {
      setFormError('Nome da empresa, nome, e-mail e senha (mín. 8 caracteres) do admin são obrigatórios.')
      return
    }
    createCompany.mutate({
      name: form.name.trim(),
      admin: { name: form.adminName.trim(), email: form.adminEmail.trim(), password: form.adminPassword },
    })
  }

  return (
    <div className="mx-auto min-h-screen max-w-4xl bg-surface p-lg text-on-surface md:p-xl">
      <div className="mb-lg flex items-center justify-between">
        <h1 className="font-headline text-headline-lg text-on-surface">Empresas</h1>
        <button
          type="button"
          onClick={logout}
          className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
        >
          Sair
        </button>
      </div>

      <Panel
        title="Empresas cadastradas"
        action={
          <button
            type="button"
            onClick={() => { setShowForm((v) => !v); setFormError(null) }}
            className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
          >
            {showForm ? 'Cancelar' : '+ Nova empresa'}
          </button>
        }
      >
        {showForm && (
          <form onSubmit={handleCreate} className="mb-lg flex flex-col gap-sm rounded-lg border border-outline-variant/30 bg-surface-container-low p-md">
            <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Nova empresa</p>
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Nome da empresa" placeholder="Nome da empresa" />
            <div className="grid gap-sm sm:grid-cols-2">
              <input className={inputCls} value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} aria-label="Nome do admin" placeholder="Nome do primeiro admin" />
              <input className={inputCls} value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} aria-label="E-mail do admin" placeholder="E-mail do primeiro admin" type="email" />
              <input className={inputCls} value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} aria-label="Senha do admin" placeholder="Senha provisória (mín. 8)" type="password" />
            </div>
            {formError && (
              <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
                <Icon name="error" className="text-[16px]" />
                {formError}
              </p>
            )}
            <div>
              <button type="submit" className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container">
                Criar empresa
              </button>
            </div>
          </form>
        )}

        {updateError && (
          <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
            <Icon name="error" className="text-[16px]" />
            {updateError}
          </p>
        )}

        {companiesQuery.isLoading ? (
          <p className="text-body-sm text-on-surface-variant">Carregando empresas...</p>
        ) : (
          <ul className="flex flex-col gap-sm">
            {(companiesQuery.data?.companies ?? []).map((company) => (
              <CompanyRow
                key={company.id}
                company={company}
                onSave={(id, data) => updateCompany.mutate({ id, data })}
                onToggle={(id, active) => updateCompany.mutate({ id, data: { active } })}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/pages/SuperAdminPage.test.tsx`
Expected: PASS em todos os 5 testes (3 já existentes + 2 novos).

- [ ] **Step 6: tsc do workspace shared + web**

Run: `pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/company.ts apps/web/src/pages/SuperAdminPage.tsx apps/web/src/pages/SuperAdminPage.test.tsx
git commit -m "feat: edição inline (renomear/ativar-desativar empresa) na SuperAdminPage"
```

---

### Task 3: Verificação final

**Files:** nenhum (só execução de comandos)

- [ ] **Step 1: Suíte completa da API**

Run: `pnpm --filter @legends/api test`
Expected: PASS em todos os arquivos (nenhuma regressão fora de `super-admin.test.ts`).

- [ ] **Step 2: Suíte completa do web**

Run: `pnpm --filter @legends/web test`
Expected: PASS em todos os arquivos (nenhuma regressão fora de `SuperAdminPage.test.tsx`).

- [ ] **Step 3: tsc de todos os workspaces**

Run: `pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit && pnpm --filter @legends/shared exec tsc --noEmit`
Expected: zero erros.

- [ ] **Step 4: Teste manual rápido (opcional, se `pnpm dev` estiver disponível)**

Logar como Super Admin, ir em `/super-admin`, clicar "Editar" numa empresa,
mudar o nome, "Salvar", confirmar que a lista atualiza; clicar "Desativar",
confirmar que o nome fica riscado.
