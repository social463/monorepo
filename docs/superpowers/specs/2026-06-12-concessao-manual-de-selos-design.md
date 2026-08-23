# Concessão manual de selos pelo admin

**Data:** 2026-06-12
**Status:** Aprovado para implementação

## Objetivo

Permitir que um administrador conceda qualquer selo a qualquer membro, sem
depender de votação ou de atingir limiares. As concessões manuais são revogáveis
e rastreáveis (registra-se quem concedeu e que a origem foi manual).

## Contexto atual

- `Badge` tem `kind`: `CATEGORY`, `RECURRENCE`, `IMPACT`, `HIGHLIGHT`.
- `UserBadge` liga `Badge` a `User` com `periodId` opcional e unique
  `[userId, badgeId, periodId]`.
- Concessão automática hoje:
  - `evaluateBadgesForUser` (badge-service) concede selos por threshold de votos
    (CATEGORY/IMPACT/RECURRENCE) com `periodId: null`.
  - `publishHighlight` (highlight-service) concede `destaque-do-mes` ao vencedor
    do período (com `periodId` do período).
- Admin já faz CRUD de **definições** de selo (`/admin/badges`), mas **não há**
  forma de conceder um selo específico a um membro específico. Essa é a lacuna.

## Decisões (do brainstorming)

1. **Escopo:** qualquer selo pode ser concedido manualmente (inclui
   `destaque-do-mes`).
2. **Revogação:** o admin pode revogar concessões — **apenas as manuais**.
3. **Rastreabilidade:** registra-se origem (`AUTO`/`MANUAL`) e qual admin
   concedeu.

## Modelo de dados

Novo enum e campos em `UserBadge` (`apps/api/prisma/schema.prisma`):

```prisma
enum BadgeAwardSource {
  AUTO    // concedido por voto/threshold ou eleição de destaque
  MANUAL  // concedido manualmente por um admin
}

model UserBadge {
  // ...campos atuais...
  source      BadgeAwardSource @default(AUTO)
  awardedById String?
  awardedBy   User?            @relation("BadgesAwarded", fields: [awardedById], references: [id])
}
```

Em `User`, relação inversa:

```prisma
badgesAwarded UserBadge[] @relation("BadgesAwarded")
```

- Migration nova marca todos os registros existentes como `AUTO` (default cobre
  isso; `awardedById` fica `null`).
- A unique key `[userId, badgeId, periodId]` permanece.
- Concessão manual usa `periodId: null`. Logo, se o membro já tem o selo (auto ou
  manual) com `periodId null`, conceder de novo é bloqueado pela unique → 409.
- Concessões automáticas existentes (`evaluateBadgesForUser`,
  `publishHighlight`) continuam criando `UserBadge` com `source` default `AUTO` —
  nenhuma alteração de comportamento nelas.

## Serviço (badge-service.ts)

Duas funções novas, mantendo as rotas finas:

- `grantBadgeManually(userId, badgeId, awardedById)`: cria `UserBadge` com
  `source: MANUAL`, `awardedById`, `periodId: null`. Propaga `P2002` para a rota
  tratar como 409. Retorna o registro com `badge` e `awardedBy` incluídos.
- `revokeManualBadge(userId, userBadgeId)`: busca o `UserBadge`; se não existir
  ou não pertencer ao `userId` → erro "não encontrado"; se `source !== MANUAL` →
  erro "não revogável". Caso ok, deleta.

`listBadgesForUser` passa a incluir `awardedBy` além de `badge`.

## API (rotas admin — `apps/api/src/routes/admin.ts`)

Todas sob `adminOnly` (`authenticate` + `requireAdmin`).

```
GET    /admin/users/:userId/badges                  → { badges: AwardedBadgeDTO[] }
POST   /admin/users/:userId/badges    { badgeId }   → 201 { badge: AwardedBadgeDTO }
DELETE /admin/users/:userId/badges/:userBadgeId     → 204
```

- **POST**
  - Valida body com zod (`badgeId: string min 1`).
  - Verifica que o membro existe e que o selo existe → 404 com mensagem
    específica se faltar.
  - Cria via `grantBadgeManually(userId, badgeId, request.user.sub)`.
  - `P2002` → 409 `"Este membro já possui esse selo."`
  - Retorna `AwardedBadgeDTO`.
- **DELETE**
  - `revokeManualBadge`. Não encontrado → 404
    `"Concessão não encontrada."`; selo automático → 409
    `"Selos automáticos não podem ser revogados manualmente."`; ok → 204.
- **GET**
  - Reusa `listBadgesForUser(userId)`, mapeia com `toAwardedBadgeDTO`.

## Serialização / tipos compartilhados

`AwardedBadgeDTO` (`packages/shared/src/badge.ts`) ganha:

```ts
source: 'AUTO' | 'MANUAL'
awardedBy: { id: string; name: string } | null
```

`toAwardedBadgeDTO` (`apps/api/src/lib/serialize.ts`):
- Tipo do payload passa a incluir `{ badge: true; awardedBy: true }`.
- Mapeia `source` e `awardedBy` (`null` quando não houver).

Como `AwardedBadgeDTO` já é consumido por `BadgesPage`/perfil, os novos campos
são aditivos e opcionais de uso — nenhuma quebra.

## UI — painel "Selos por membro" (`apps/web/src/pages/AdminPage.tsx`)

Novo `Panel` próximo ao painel de "Selos":

- **Dropdown de membro** — reusa a query `admin/users` já presente na página.
- Ao escolher um membro: query `['admin','userBadges', userId]` →
  `GET /admin/users/:userId/badges`. Lista os selos em cards com `BadgeEmblem`,
  cada um com etiqueta **Automático** / **Manual**.
  - Selos `MANUAL`: botão de revogar (ícone `delete`).
  - Selos `AUTO`: sem botão de revogar.
- **Dropdown de selo + botão "Conceder"** — reusa a query `badges`. Concede via
  `POST`. 
- Erros (409, 404) exibidos inline no padrão dos outros painéis
  (`role="alert"` + ícone `error`).
- Mutations de conceder/revogar invalidam `['admin','userBadges', userId]`.
- Textos em pt-BR no tom existente.

## Tratamento de erros

| Situação | Resposta |
|---|---|
| Body inválido (sem badgeId) | 400 `"Dados inválidos"` |
| Membro inexistente | 404 `"Usuário não encontrado"` |
| Selo inexistente | 404 `"Selo não encontrado"` |
| Membro já tem o selo | 409 `"Este membro já possui esse selo."` |
| Revogar concessão inexistente | 404 `"Concessão não encontrada."` |
| Revogar selo automático | 409 `"Selos automáticos não podem ser revogados manualmente."` |
| Não-admin | 403 (via `requireAdmin`) |

## Testes (TDD, vitest)

- **`badge-service.test.ts`**
  - `grantBadgeManually` cria com `source: MANUAL` e `awardedById` corretos.
  - Conceder duplicado propaga `P2002`.
  - `revokeManualBadge` remove um `MANUAL`.
  - `revokeManualBadge` recusa um `AUTO` (erro não-revogável).
  - `revokeManualBadge` erro quando a concessão não existe / não é do usuário.
- **`admin.test.ts`** (rotas)
  - POST 201 + shape do `AwardedBadgeDTO` (inclui `source` e `awardedBy`).
  - POST duplicado → 409.
  - POST com selo/usuário inexistente → 404.
  - DELETE de concessão `MANUAL` → 204.
  - DELETE de concessão `AUTO` → 409.
  - DELETE inexistente → 404.
  - Todas exigem ADMIN (não-admin → 403).
- **`AdminPage.test.tsx`**
  - Selecionar membro lista seus selos.
  - Conceder chama POST e atualiza a lista.
  - Botão revogar aparece só em selos manuais.

## Fora de escopo (YAGNI)

- Nota/justificativa textual da concessão manual.
- Revogação de selos automáticos.
- Concessão em lote (vários membros de uma vez).
- Histórico/auditoria além de `source` + `awardedById`.
