# Plan — Acesso administrativo delegado

Spec: `docs/superpowers/specs/2026-08-15-acesso-admin-delegado-design.md`

## 1. Contrato (`packages/shared`)

- `src/permissions.ts` novo: `canAdminister`, `isFullAdmin`,
  `ADMIN_ACCESS_ELIGIBLE_ROLES`, com teste ao lado.
- `src/auth.ts`: `PublicUser.adminAccess: boolean`.
- Exportar no barril `index.ts`.

## 2. Banco (`apps/api/prisma`)

- `User.adminAccess Boolean @default(false)`.
- Migration nova (`pnpm db:migrate`); não editar migration aplicada.

## 3. API — token e guards

- `lib/jwt.ts`: `adminAccess` no `AccessTokenPayload` e em `signAccessToken`.
- `types/fastify.d.ts`: claim no `payload`/`user`.
- `app.ts`: `requireAdmin`, `requireAdminOrSubadmin`, `requireSectorFeature`,
  `requireFeature` passam a usar os predicados. `requireSuperAdmin` intocado.

## 4. API — checagens "pode administrar" fora dos guards

Trocar `role === 'ADMIN'` por `isFullAdmin(...)` **só** onde a pergunta é "pode
administrar": `routes/event-albums.ts`, `routes/calendar.ts`,
`routes/corporate-mural.ts`, `services/feedback-service.ts` (moderação/visão),
`services/corporate-mural-service.ts`, `services/review-service.ts`,
`services/challenge-service.ts`, `services/challenge-submission-service.ts`,
`services/office-map-service.ts`.

**Não tocar** nas checagens de participação — `voting-service`, `squad-service`,
`retro-service`, `one-on-one-service`, `vacation-service`, os filtros de
`GET /admin/users`, `office-ws` e `super-admin.ts`.

## 5. API — conceder e revogar

- `admin.ts`: `updateUserSchema` ganha `adminAccess`; `PATCH /admin/users/:id`
  recusa o campo de quem não é ADMIN por papel e sobre papel não elegível;
  derruba o flag quando a `role` sai da lista elegível, na mesma transação.
- `GET /admin/administrators` passa a incluir `adminAccess: true`.
- `serialize.ts`: `adminAccess` em `toPublicUser`.

## 6. Web

- `lib/permissions.ts` (ou `features.ts`): helpers a partir do `PublicUser`.
- `App.tsx`: `AdminOnly`, `StrictAdminOnly`, `AdminSectorFeatureOnly`,
  `LeadershipOnly` honram o flag. `DevOnly` e `HomeRoute` **não** (o delegado
  mantém a home e as rotas de colaborador).
- `nav-items.ts`: item **Admin** no grupo solto da Liderança quando há acesso
  delegado; `AppLayout` segue calculando `isAdmin` por `role`.
- `AdminSidebar`: delegado vê a sidebar completa (já é o caso, por não ser
  SUBADMIN) — conferir os `adminOnly`.
- `CollaboratorsSection`: switch "Acesso administrativo", só para ADMIN.
- `AdministratorsSection`: lista dos delegados com ação de revogar.
- `lib/features.ts` `administersBlock` honra o flag.

## 7. Testes

- shared: `permissions.test.ts`.
- api: guards com o flag, `PATCH` (conceder, revogar, recusa de SUBADMIN, papel
  não elegível, queda do flag ao trocar de papel), payload do JWT.
- web: `nav-items.test.ts` (item Admin), roteamento, switch no formulário.
- Fechar com `pnpm test`.
