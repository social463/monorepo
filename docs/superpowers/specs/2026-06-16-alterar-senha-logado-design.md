# Alterar senha após login

## Objetivo

Permitir que um usuário autenticado altere a própria senha sem precisar fazer
logout. A troca exige a senha atual e revoga as demais sessões ativas por
segurança, mantendo apenas a sessão corrente válida.

## Decisões

- **Local na UI:** seção "Segurança" na própria `ProfilePage` (apenas quando o
  usuário visualiza o próprio perfil), com formulário **inline** (sem modal).
- **Sessões:** ao trocar a senha, revoga todos os refresh tokens do usuário e
  emite um novo para a sessão atual — desconecta dispositivos antigos no próximo
  refresh, mas mantém o usuário logado no dispositivo onde fez a troca.

## API

### Endpoint `POST /auth/change-password`

Em [auth.ts](../../../apps/api/src/routes/auth.ts), protegido por
`{ onRequest: [app.authenticate] }`.

Schema Zod:

```ts
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
})
```

Fluxo do handler:

1. Valida o corpo; inválido → `400 { message: 'Dados inválidos' }`.
2. Chama `changePassword(request.user.sub, currentPassword, newPassword)` no
   auth-service.
3. Em `AuthError` (senha atual incorreta) → `400 { message: 'Senha atual incorreta' }`.
4. Se `newPassword === currentPassword`, o service lança `AuthError`
   (`'A nova senha deve ser diferente da atual'`) → `400`.
5. Sucesso:
   - Lê `persistent` do refresh token atual (pelo cookie `legends.refresh`,
     via lookup do hash); se não houver, usa `false`.
   - `revokeAllForUser(userId)`.
   - `issueRefreshTokenForLogin(userId, persistent)` e `reply.setCookie` do
     `legends.refresh` com `refreshCookieOptions(persistent, expiresAt)`.
   - Retorna `204`.

### Service — auth-service

Em [auth-service.ts](../../../apps/api/src/services/auth-service.ts):

```ts
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AuthError('Usuário não encontrado')
  const ok = await verifyPassword(currentPassword, user.passwordHash)
  if (!ok) throw new AuthError('Senha atual incorreta')
  if (currentPassword === newPassword) {
    throw new AuthError('A nova senha deve ser diferente da atual')
  }
  const passwordHash = await hashPassword(newPassword)
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } })
}
```

### Service — refresh-token-service

Em [refresh-token-service.ts](../../../apps/api/src/services/refresh-token-service.ts):

```ts
export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}
```

A ordem importa: revogar **antes** de emitir o novo token, para que o token
recém-criado não seja revogado junto.

## Web

### Componente `ChangePasswordForm`

Novo componente seguindo o padrão de formulário de
[VotePage.tsx](../../../apps/web/src/pages/VotePage.tsx) e
[LoginPage.tsx](../../../apps/web/src/pages/LoginPage.tsx):

- Três campos: `currentPassword`, `newPassword`, `confirmPassword`, todos com
  toggle mostrar/ocultar (reaproveita o padrão do LoginPage).
- Validação client-side: nova senha mín. 8 chars; `newPassword === confirmPassword`.
- `useMutation` → `apiFetch('/auth/change-password', { method: 'POST', body })`.
- Estados `error`/`success` exibidos como `<p role="alert">` (padrão do projeto).
- Em sucesso: limpa os três campos e mostra mensagem de sucesso. O access token
  em memória continua válido até expirar (15 min); o auto-refresh do
  [api.ts](../../../apps/web/src/lib/api.ts) usará o novo cookie quando
  necessário — sem logout forçado.

### Integração na ProfilePage

Em [ProfilePage.tsx](../../../apps/web/src/pages/ProfilePage.tsx), quando
`isOwnProfile`, renderiza uma seção "Segurança" contendo o `ChangePasswordForm`
inline.

## Validação / Migrations

- Sem migrations: o schema Prisma já possui `passwordHash`.
- Regra de tamanho (`min(8)`) espelha a do `registerSchema`.

## Testes (API)

- Sem autenticação → `401`.
- Senha atual incorreta → `400` e hash inalterado.
- Nova senha igual à atual → `400`.
- Sucesso: `passwordHash` muda; refresh tokens antigos do usuário ficam
  revogados; um novo refresh token é emitido (cookie setado).
