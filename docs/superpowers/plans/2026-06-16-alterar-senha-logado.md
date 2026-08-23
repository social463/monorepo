# Alterar Senha Após Login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um usuário autenticado altere a própria senha (informando a atual) sem fazer logout, revogando as demais sessões.

**Architecture:** Novo endpoint `POST /auth/change-password` protegido por JWT. O service de auth verifica a senha atual e grava o novo hash; o service de refresh token ganha `revokeAllForUser`. Após trocar, revoga todos os refresh tokens e emite um novo para a sessão corrente (mantém logado). No web, uma seção "Segurança" com formulário inline na própria `ProfilePage`.

**Tech Stack:** Fastify, Prisma, Postgres, @fastify/jwt, bcryptjs, Zod (API); Vite, React, React Query, Tailwind (web); Vitest (testes API).

## Global Constraints

- Senha nova: mínimo 8 caracteres (espelha `registerSchema`).
- Hashing: bcryptjs via `hashPassword`/`verifyPassword` em `apps/api/src/lib/password.ts`.
- Cookie de refresh: nome `legends.refresh`, opções via helpers `refreshCookieOptions`/`clearRefreshCookieOptions` em `apps/api/src/routes/auth.ts`.
- Erros e mensagens em português, no padrão existente (`{ message: '...' }`).
- Web: alertas via `<p role="alert">`; chamadas via `apiFetch` de `apps/web/src/lib/api.ts`.

---

### Task 1: `revokeAllForUser` no refresh-token-service

**Files:**
- Modify: `apps/api/src/services/refresh-token-service.ts`
- Test: `apps/api/test/refresh-token-service.test.ts` (criar se não existir; caso já exista, adicionar o teste)

**Interfaces:**
- Consumes: `prisma` de `../lib/prisma`.
- Produces: `export async function revokeAllForUser(userId: string): Promise<void>`

- [ ] **Step 1: Verificar a infra de teste existente**

Run: `ls apps/api/test`
Expected: listar arquivos `*.test.ts` existentes (para seguir o padrão de setup do banco de teste). Se houver `refresh-token-service.test.ts`, abra-o e adicione o caso novo seguindo o padrão; senão crie um novo arquivo replicando o `beforeEach`/`afterEach` de outro teste de service do diretório.

- [ ] **Step 2: Escrever o teste que falha**

Adicione em `apps/api/test/refresh-token-service.test.ts` (ajuste imports/setup ao padrão local):

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '../src/lib/prisma'
import {
  issueRefreshTokenForLogin,
  revokeAllForUser,
} from '../src/services/refresh-token-service'

describe('revokeAllForUser', () => {
  it('revoga todos os refresh tokens ativos do usuário', async () => {
    const user = await prisma.user.create({
      data: { name: 'Teste', email: `revoke-${Date.now()}@x.com`, passwordHash: 'x' },
    })
    await issueRefreshTokenForLogin(user.id, false)
    await issueRefreshTokenForLogin(user.id, true)

    await revokeAllForUser(user.id)

    const active = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    })
    expect(active).toBe(0)
  })
})
```

- [ ] **Step 3: Rodar o teste e confirmar a falha**

Run: `pnpm --filter @legends/api test -- refresh-token-service`
Expected: FAIL — `revokeAllForUser is not a function` (ou import inexistente).

- [ ] **Step 4: Implementar `revokeAllForUser`**

Adicione em `apps/api/src/services/refresh-token-service.ts`, após `revokeByRawToken`:

```ts
export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/api test -- refresh-token-service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/refresh-token-service.ts apps/api/test/refresh-token-service.test.ts
git commit -m "feat(api): revokeAllForUser no refresh-token-service"
```

---

### Task 2: `changePassword` no auth-service

**Files:**
- Modify: `apps/api/src/services/auth-service.ts`
- Test: `apps/api/test/auth-service.test.ts` (criar se não existir; senão adicionar)

**Interfaces:**
- Consumes: `prisma`, `hashPassword`/`verifyPassword` de `../lib/password`, `AuthError` (já exportado neste arquivo).
- Produces: `export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>`

- [ ] **Step 1: Escrever os testes que falham**

Adicione em `apps/api/test/auth-service.test.ts` (siga o setup de banco do diretório):

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../src/lib/prisma'
import { hashPassword, verifyPassword } from '../src/lib/password'
import { changePassword, AuthError } from '../src/services/auth-service'

async function makeUser(password: string) {
  return prisma.user.create({
    data: {
      name: 'Teste',
      email: `chg-${Date.now()}-${Math.round(Math.random() * 1e6)}@x.com`,
      passwordHash: await hashPassword(password),
    },
  })
}

describe('changePassword', () => {
  it('troca o hash quando a senha atual está correta', async () => {
    const user = await makeUser('senha-atual-1')
    await changePassword(user.id, 'senha-atual-1', 'nova-senha-2')
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(await verifyPassword('nova-senha-2', updated.passwordHash)).toBe(true)
  })

  it('rejeita quando a senha atual está incorreta', async () => {
    const user = await makeUser('senha-atual-1')
    await expect(changePassword(user.id, 'errada', 'nova-senha-2')).rejects.toBeInstanceOf(AuthError)
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(await verifyPassword('senha-atual-1', updated.passwordHash)).toBe(true)
  })

  it('rejeita quando a nova senha é igual à atual', async () => {
    const user = await makeUser('senha-atual-1')
    await expect(changePassword(user.id, 'senha-atual-1', 'senha-atual-1')).rejects.toBeInstanceOf(AuthError)
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @legends/api test -- auth-service`
Expected: FAIL — `changePassword is not a function`.

- [ ] **Step 3: Implementar `changePassword`**

Adicione em `apps/api/src/services/auth-service.ts` (verifique que `prisma`, `hashPassword`, `verifyPassword` e `AuthError` estão importados/exportados; o arquivo já usa `verifyPassword` e `hashPassword`):

```ts
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    throw new AuthError('Usuário não encontrado')
  }
  const ok = await verifyPassword(currentPassword, user.passwordHash)
  if (!ok) {
    throw new AuthError('Senha atual incorreta')
  }
  if (currentPassword === newPassword) {
    throw new AuthError('A nova senha deve ser diferente da atual')
  }
  const passwordHash = await hashPassword(newPassword)
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } })
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api test -- auth-service`
Expected: PASS (3 casos).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/auth-service.ts apps/api/test/auth-service.test.ts
git commit -m "feat(api): changePassword no auth-service"
```

---

### Task 3: Endpoint `POST /auth/change-password`

**Files:**
- Modify: `apps/api/src/routes/auth.ts`
- Test: `apps/api/test/auth-routes.test.ts` (criar se não existir; senão adicionar)

**Interfaces:**
- Consumes: `changePassword`, `AuthError` de `../services/auth-service`; `revokeAllForUser`, `issueRefreshTokenForLogin`, `hashToken` de `../services/refresh-token-service`; `prisma`; helpers locais `REFRESH_COOKIE`, `refreshCookieOptions`; `app.authenticate`.
- Produces: rota `POST /auth/change-password` → `204` em sucesso.

- [ ] **Step 1: Escrever o teste de integração que falha**

Adicione em `apps/api/test/auth-routes.test.ts` (use `buildApp()` e `app.inject`, seguindo o padrão de testes de rota existentes; faça login para obter o `accessToken` e o cookie):

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import { hashPassword } from '../src/lib/password'

async function setup() {
  const app = buildApp()
  await app.ready()
  const email = `route-${Date.now()}@x.com`
  await prisma.user.create({
    data: { name: 'Teste', email, passwordHash: await hashPassword('senha-atual-1') },
  })
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: 'senha-atual-1' },
  })
  const token = login.json().accessToken as string
  const cookie = login.cookies.find((c) => c.name === 'legends.refresh')!
  return { app, email, token, cookie }
}

describe('POST /auth/change-password', () => {
  it('exige autenticação', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      payload: { currentPassword: 'x', newPassword: 'novasenha8' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('troca a senha e revoga sessões antigas', async () => {
    const { app, email, token } = await setup()
    // segunda sessão (deve ser revogada)
    await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'senha-atual-1' } })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: 'senha-atual-1', newPassword: 'nova-senha-2' },
    })
    expect(res.statusCode).toBe(204)
    expect(res.cookies.find((c) => c.name === 'legends.refresh')).toBeDefined()

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    // exatamente 1 refresh token ativo (a sessão atual, recém-emitida)
    const active = await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })
    expect(active).toBe(1)

    const relogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'nova-senha-2' } })
    expect(relogin.statusCode).toBe(200)
    await app.close()
  })

  it('rejeita senha atual incorreta com 400', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: 'errada', newPassword: 'nova-senha-2' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @legends/api test -- auth-routes`
Expected: FAIL — rota retorna 404 (não existe ainda).

- [ ] **Step 3: Adicionar imports e schema**

Em `apps/api/src/routes/auth.ts`:

- No import de `../services/auth-service`, inclua `changePassword`:
  `import { AuthError, authenticateUser, changePassword, registerUser } from '../services/auth-service'`
- No import de `../services/refresh-token-service`, inclua `revokeAllForUser` e `hashToken`:
  ```ts
  import {
    issueRefreshTokenForLogin,
    rotateRefreshToken,
    revokeByRawToken,
    revokeAllForUser,
    hashToken,
    RefreshError,
  } from '../services/refresh-token-service'
  ```
- Adicione o schema junto aos demais:
  ```ts
  const changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  })
  ```

- [ ] **Step 4: Implementar a rota**

Adicione dentro de `authRoutes`, após a rota `patch('/me', ...)`:

```ts
  app.post('/change-password', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    try {
      await changePassword(request.user.sub, parsed.data.currentPassword, parsed.data.newPassword)
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(400).send({ message: err.message })
      }
      throw err
    }

    // Preserva o flag de persistência da sessão atual (se o cookie existir).
    const raw = request.cookies[REFRESH_COOKIE]
    let persistent = false
    if (raw) {
      const current = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) } })
      if (current) persistent = current.persistent
    }

    // Revoga tudo ANTES de emitir o novo token, para não revogar o recém-criado.
    await revokeAllForUser(request.user.sub)
    const refresh = await issueRefreshTokenForLogin(request.user.sub, persistent)
    reply.setCookie(
      REFRESH_COOKIE,
      refresh.rawToken,
      refreshCookieOptions(refresh.persistent, refresh.expiresAt),
    )
    return reply.code(204).send()
  })
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api test -- auth-routes`
Expected: PASS (3 casos).

- [ ] **Step 6: Type-check da API**

Run: `pnpm --filter @legends/api typecheck` (ou `pnpm --filter @legends/api build` se não houver script `typecheck`)
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/auth.ts apps/api/test/auth-routes.test.ts
git commit -m "feat(api): endpoint POST /auth/change-password"
```

---

### Task 4: Componente `ChangePasswordForm` (web)

**Files:**
- Create: `apps/web/src/components/ChangePasswordForm.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ApiError` de `../lib/api`; `useMutation` de `@tanstack/react-query`; ícones/estilos no padrão do projeto (ver `LoginPage.tsx`).
- Produces: `export function ChangePasswordForm(): JSX.Element` — formulário inline autônomo (sem props).

- [ ] **Step 1: Revisar o padrão de form/inputs existente**

Run: `sed -n '1,80p' apps/web/src/pages/LoginPage.tsx`
Expected: ver o padrão de input de senha com toggle mostrar/ocultar, classes Tailwind e o `<p role="alert">` de erro. Reaproveite essas classes para manter consistência visual.

- [ ] **Step 2: Implementar o componente**

Crie `apps/web/src/components/ChangePasswordForm.tsx`. Ajuste nomes de classes/ícones ao que existe no `LoginPage.tsx` (substitua placeholders de classe pelos reais observados no Step 1):

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../lib/api'

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      apiFetch<void>('/auth/change-password', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setSuccess('Senha alterada com sucesso.')
      setError(null)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    },
    onError: (err) => {
      setSuccess(null)
      setError(err instanceof ApiError ? err.message : 'Erro ao alterar a senha.')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (newPassword.length < 8) {
      setError('A nova senha deve ter ao menos 8 caracteres.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('A confirmação não corresponde à nova senha.')
      return
    }
    mutation.mutate({ currentPassword, newPassword })
  }

  const inputType = show ? 'text' : 'password'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-md">
      <label className="flex flex-col gap-xs">
        <span className="text-body-sm text-secondary">Senha atual</span>
        <input
          type={inputType}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          className="rounded-md border border-border bg-surface px-md py-sm"
        />
      </label>
      <label className="flex flex-col gap-xs">
        <span className="text-body-sm text-secondary">Nova senha</span>
        <input
          type={inputType}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          className="rounded-md border border-border bg-surface px-md py-sm"
        />
      </label>
      <label className="flex flex-col gap-xs">
        <span className="text-body-sm text-secondary">Confirmar nova senha</span>
        <input
          type={inputType}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          className="rounded-md border border-border bg-surface px-md py-sm"
        />
      </label>

      <label className="flex items-center gap-xs text-body-sm text-secondary">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        Mostrar senhas
      </label>

      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
      {success && (
        <p role="alert" className="text-body-sm text-success">
          {success}
        </p>
      )}

      <button
        type="submit"
        disabled={mutation.isPending}
        className="self-start rounded-md bg-primary px-lg py-sm text-on-primary disabled:opacity-60"
      >
        {mutation.isPending ? 'Alterando…' : 'Alterar senha'}
      </button>
    </form>
  )
}
```

- [ ] **Step 3: Type-check do web**

Run: `pnpm --filter @legends/web typecheck` (ou `pnpm --filter @legends/web build`)
Expected: sem erros. Se alguma classe Tailwind não existir, troque pela equivalente real vista no `LoginPage.tsx`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ChangePasswordForm.tsx
git commit -m "feat(web): componente ChangePasswordForm"
```

---

### Task 5: Seção "Segurança" na ProfilePage

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.tsx`

**Interfaces:**
- Consumes: `ChangePasswordForm` de `../components/ChangePasswordForm`; flag de perfil próprio já existente na página (`isOwnProfile` ou equivalente — confirmar no Step 1).
- Produces: seção renderizada apenas no perfil próprio.

- [ ] **Step 1: Localizar a flag de perfil próprio e o ponto de inserção**

Run: `grep -n "isOwnProfile\|user?.id\|useAuth\|AvatarPicker" apps/web/src/pages/ProfilePage.tsx`
Expected: identificar a variável que indica perfil próprio (usada para mostrar o botão de editar avatar) e uma seção/contêiner onde inserir a nova seção. Use exatamente o mesmo nome de variável encontrado.

- [ ] **Step 2: Importar o componente**

Adicione no topo de `apps/web/src/pages/ProfilePage.tsx`:

```tsx
import { ChangePasswordForm } from '../components/ChangePasswordForm'
```

- [ ] **Step 3: Renderizar a seção no perfil próprio**

Dentro do JSX, em um ponto coerente com o layout (ex.: após a seção de feedbacks), inserir — trocando `isOwnProfile` pelo nome real da flag do Step 1:

```tsx
{isOwnProfile && (
  <section className="flex flex-col gap-md rounded-lg border border-border bg-surface p-lg">
    <h2 className="text-title-sm text-primary">Segurança</h2>
    <p className="text-body-sm text-secondary">Altere sua senha de acesso.</p>
    <ChangePasswordForm />
  </section>
)}
```

- [ ] **Step 4: Type-check do web**

Run: `pnpm --filter @legends/web typecheck` (ou `pnpm --filter @legends/web build`)
Expected: sem erros. Ajuste classes ao padrão real da página se necessário.

- [ ] **Step 5: Verificação manual**

Run: inicie o app (`pnpm --filter @legends/web dev` + API) e acesse o próprio perfil.
Expected: a seção "Segurança" aparece só no perfil próprio; trocar a senha com a atual correta mostra sucesso; senha atual errada mostra erro; após trocar, é possível relogar com a nova senha.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ProfilePage.tsx
git commit -m "feat(web): secao Seguranca com alterar senha no perfil"
```

---

## Self-Review

**Spec coverage:**
- Endpoint `POST /auth/change-password` → Task 3. ✓
- `changePassword` service + regra "nova ≠ atual" → Task 2. ✓
- `revokeAllForUser` + emitir novo token preservando `persistent` → Task 1 + Task 3. ✓
- `ChangePasswordForm` (3 campos, toggle, validação, mutation) → Task 4. ✓
- Seção "Segurança" inline só no perfil próprio → Task 5. ✓
- Sem migrations → confirmado (nenhuma task altera schema.prisma). ✓
- Testes API (401, senha incorreta, nova=atual, sucesso+revogação) → Tasks 1–3. ✓

**Placeholders:** Código completo em cada step. Os pontos marcados para "confirmar no arquivo" (classes Tailwind, nome da flag `isOwnProfile`) têm comando de verificação explícito e instrução de substituição — não são TBDs de implementação.

**Type consistency:** `revokeAllForUser(userId: string)`, `changePassword(userId, currentPassword, newPassword)`, `hashToken(raw)` e `issueRefreshTokenForLogin(userId, persistent)` usados de forma consistente entre tasks. `REFRESH_COOKIE`/`refreshCookieOptions` já existem em `auth.ts`.
