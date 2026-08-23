# Refresh token rotativo com detecção de reúso

**Data:** 2026-06-11
**Status:** Aprovado para implementação

## Objetivo

Substituir o esquema atual (JWT único de 7 dias persistido em `localStorage`/`sessionStorage`)
por uma estratégia de access token curto + refresh token rotativo, seguindo o padrão-ouro
OWASP: rotação a cada uso e detecção de reúso com revogação em cascata por família.

## Contexto atual

- API Fastify + `@fastify/jwt`, token assinado com `expiresIn: '7d'`, payload `{ sub, role }`.
- Web (Vite/React) guarda o token em `localStorage` (persistente) ou `sessionStorage`
  (sessão), conforme o checkbox "Manter conectado" adicionado recentemente.
- `apiFetch` anexa `Authorization: Bearer <token>` lendo do storage.
- **Mesma origem**: em produção a API serve o front via `@fastify/static`; em dev o Vite
  faz proxy de `/api` → `localhost:3333`. Permite cookie httpOnly sem complicação de CORS.
- Postgres + Prisma disponíveis para persistir refresh tokens.

## Modelo de tokens

| Token | Formato | Onde vive | Validade |
|---|---|---|---|
| **Access** | JWT (`{ sub, role }`), como hoje | só em memória no front (state/ref no `AuthContext`) | 15 min |
| **Refresh** | string opaca aleatória (`crypto.randomBytes(32)` em hex) | cookie httpOnly, Secure, SameSite=Strict, path `/api/auth` | 30 dias se "manter conectado"; cookie de sessão caso contrário |

O refresh é opaco (não-JWT) para ser revogável; a verdade fica no banco. O valor em claro
**nunca** é armazenado — guarda-se apenas o hash SHA-256.

## Banco (Prisma)

Nova tabela `RefreshToken`:

```prisma
model RefreshToken {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique // sha256 do valor opaco
  familyId   String              // mesma família = mesma sessão de login
  expiresAt  DateTime
  revokedAt  DateTime?
  replacedBy String?             // id do token sucessor (cadeia de rotação)
  createdAt  DateTime  @default(now())

  @@index([userId])
  @@index([familyId])
}
```

Adicionar a relação inversa `refreshTokens RefreshToken[]` no model `User`.

**Rotação:** cada `POST /auth/refresh` marca o token atual com `revokedAt` + `replacedBy`
e emite um novo token na mesma `familyId`.

**Detecção de reúso:** se chegar um refresh cujo hash existe mas **já está revogado**
(`revokedAt`/`replacedBy` preenchidos), é sinal de replay/roubo → revoga **toda a família**
(`familyId`) e responde 401, forçando re-login.

## Endpoints (API)

Registrar `@fastify/cookie`.

- `POST /auth/login`
  - Valida e-mail/senha (fluxo atual via `authenticateUser`).
  - Recebe `remember: boolean` no corpo.
  - Cria nova `familyId`, gera refresh opaco, grava o hash com `expiresAt`.
  - Seta cookie de refresh (persistente com `Max-Age` de 30d se `remember`, senão cookie de sessão).
  - Responde `{ accessToken, user }`.
- `POST /auth/refresh`
  - Lê o cookie de refresh; valida hash + expiração.
  - Token válido e ativo → rotaciona (revoga atual, emite novo na mesma família), seta novo cookie, responde `{ accessToken }`.
  - Token válido mas já revogado → detecção de reúso: revoga a família inteira, limpa cookie, 401.
  - Ausente/expirado/inexistente → 401.
- `POST /auth/logout`
  - Revoga a família do refresh atual e limpa o cookie. Responde 204.
- `GET /auth/me` — inalterado, protegido pelo access token.

O cookie persistente herda o `expiresAt` do refresh; a cada rotação o prazo desliza
(sliding expiration de 30d por uso). Sem cap absoluto no MVP (extensão futura possível).

## Cliente (web)

- `AuthContext` guarda o access token apenas em memória (não em storage).
- **Bootstrap no load:** chama `POST /auth/refresh`. Sucesso → restaura sessão silenciosamente;
  falha → estado deslogado (redireciona pro login via `ProtectedRoute`).
- **`apiFetch` com single-flight refresh:** ao receber `401`, dispara **um único** `/auth/refresh`
  (chamadas concorrentes aguardam a mesma Promise) e re-tenta a requisição original com o novo
  access. Se o refresh falhar → logout (limpa estado em memória).
- `login(email, password, remember)` envia `remember` no corpo do `/auth/login`.
- `logout()` chama `POST /auth/logout`.
- **Remover** os helpers `getToken`/`setToken`/`clearToken` baseados em `localStorage`/`sessionStorage`;
  o "Manter conectado" deixa de controlar storage no cliente e passa a governar só a persistência
  do cookie de refresh no servidor.

## Segurança / CSRF

- Único endpoint autenticado por cookie é `/auth/refresh`. Cookie `SameSite=Strict` em mesma
  origem cobre o vetor de CSRF sem necessidade de token anti-CSRF dedicado.
- Demais rotas continuam autenticadas por `Authorization: Bearer` (header), imunes a CSRF.
- Refresh sempre armazenado como hash; valor em claro só existe na resposta/cookie.
- `Secure` no cookie (HTTPS em produção). Em dev local pode-se relaxar conforme ambiente.

## Testes

**API**
- Login emite access + grava refresh hash e seta cookie.
- Refresh rotaciona: emite novo token e revoga o anterior (`replacedBy` preenchido).
- Reúso de refresh já revogado revoga a família inteira e responde 401.
- Refresh expirado/inválido/ausente → 401.
- Logout revoga a família e limpa o cookie.
- `remember=true` gera cookie persistente; `false` gera cookie de sessão.

**Web**
- Bootstrap silencioso restaura sessão a partir do cookie.
- Fila single-flight: múltiplos 401 concorrentes disparam um só refresh e re-tentam.
- Refresh falho leva a logout/limpa estado.

## Migração

- Migration Prisma para criar `RefreshToken`.
- Tokens JWT de 7d existentes em storage deixam de ser lidos no bootstrap (usuários farão
  login novamente uma vez). Aceitável para o MVP.
