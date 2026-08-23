# Mural Corporativo Implementation Plan

**Goal:** Trocar a seção "Resenha do time" da Home pelo **Mural corporativo** — o feed da empresa inteira, onde só liderança publica e todo mundo reage/comenta —, mantendo a Resenha (isolada por setor) na rota `/resenha`.

**Architecture:** Espelha a Resenha: models Prisma dedicados → service (regra + erro tipado) → routes finas (Zod + serialize) → contrato em `@legends/shared`; hooks React Query + WebSocket no front. Diferenças: sem `sectorId` (isolamento só por empresa, via `TENANT_SCOPED_MODELS`), gate de papel para publicar e sem compartilhamento.

**Tech Stack:** Fastify 4, Prisma 5 + PostgreSQL, Zod, Vitest (+ Postgres real), React 18 + React Query + React Router 6, Tailwind 3, TypeScript ESM.

Spec: `docs/superpowers/specs/2026-07-30-mural-corporativo-design.md`.

## Global Constraints

- Limite de conteúdo: **280 caracteres** (`CORPORATE_POST_MAX_LENGTH`), após `trim`, mínimo 1 — ou um anexo (GIF/imagem).
- Publicar: só `LEAD`, `MANAGER`, `HEAD`, `SUBADMIN`, `ADMIN` (`canPublishCorporatePost`). Validação no **service** (403); a web só esconde a UI.
- **Nada de `sectorId`** nos models/queries do mural — o isolamento é por empresa, via `scopedPrisma`.
- Erros de domínio via `CorporateMuralError` com `status`; route faz `instanceof`.
- Notificações **best-effort** (falha logada, nunca derruba a ação); nunca notificar a si mesmo.
- Mensagens ao usuário em **português**.
- Nunca editar migration já aplicada.

---

## File Structure

**Shared (`packages/shared`)**
- `src/corporate-mural.ts` — **novo**: constantes, papéis que publicam, DTOs, eventos. (Task 1)
- `src/index.ts`, `src/third-party.ts` (feature key + label), `src/notification.ts` (+4 tipos). (Task 1)

**Backend (`apps/api`)**
- `prisma/schema.prisma` — +6 models `CorporatePost*`, +4 valores em `NotificationType`, back-relations em `User`/`Company`. (Task 2)
- `prisma/migrations/20260730120000_add_corporate_mural/` — DDL. (Task 2)
- `prisma/migrations/20260730120500_enable_corporate_mural_where_resenha/` — habilita a feature onde já havia `resenha`. (Task 2)
- `src/lib/tenant-scope.ts` — registra os 6 models. (Task 2)
- `src/services/corporate-mural-service.ts` — **novo**. (Task 3)
- `src/lib/serialize.ts` — `toCorporatePostDTO`, `toCorporatePostCommentDTO`. (Task 3)
- `src/services/notification-service.ts` — +4 funções. (Task 4)
- `src/routes/corporate-mural.ts`, `src/routes/corporate-mural-ws.ts`, `src/lib/corporate-mural-hub.ts` — **novos**; registrados em `src/app.ts`. (Task 4)
- `src/routes/users.ts` — `?scope=company` para as menções. (Task 4)
- `test/setup.ts` — trunca as novas tabelas. (Task 2)

**Frontend (`apps/web`)**
- `src/lib/use-corporate-mural.ts`, `src/lib/useCorporateMuralSocket.ts` — **novos**. (Task 6)
- `src/lib/use-colleagues.ts` — parâmetro `scope`. (Task 6)
- `src/pages/mural-corporativo/{MuralCorporativoPage,MuralCorporativoFeed,CorporatePostCard,CorporatePostComposer,CorporatePostComments}.tsx` — **novos**. (Task 7)
- `src/App.tsx` (rota), `src/components/nav-items.ts` (menu), `src/pages/HomePage.tsx` (seção). (Task 8)

---

## Tasks

- [x] **Task 1 — Contrato compartilhado.** `corporate-mural.ts` com `CORPORATE_POST_MAX_LENGTH`, `MAX_CORPORATE_POST_MENTIONS`, `CORPORATE_POST_REACTIONS`, `CORPORATE_POST_PUBLISHER_ROLES`, `canPublishCorporatePost` e os DTOs; feature key `mural-corporativo` + label; 4 tipos novos de notificação; barril.
- [x] **Task 2 — Banco.** 6 models sem `sectorId`, back-relations, enum de notificação, migration DDL + migration de dados que liga a feature onde já havia `resenha`; registrar em `TENANT_SCOPED_MODELS` e no `test/setup.ts`.
- [x] **Task 3 — Service + serialize.** `createPost` (com gate de papel), `listFeed` (cursor), `getPost`, `deletePost`, `listComments`, `createComment` (reply recipients), `deleteComment`, `togglePostReaction`, `toggleCommentReaction`; menções sem recorte de setor; DTOs.
- [x] **Task 4 — Rotas + notificações + tempo real.** `corporateMuralRoutes` sob `requireFeature('mural-corporativo')` (feed devolve `canPublish`), hub e rota WS, 4 notificações com link `/mural-corporativo#<id>`, `GET /users?scope=company`.
- [x] **Task 5 — Testes de API.** `corporate-mural-service.test.ts` (25 casos com os de rota): papéis, sem setorização, escopo por empresa, exclusão, reações, cursor; `corporate-mural.test.ts`: 201/403, `canPublish`, notificações, gate de feature.
- [x] **Task 6 — Hooks + socket.** `use-corporate-mural.ts` (feed infinito, criar/excluir, reação otimista reusando `applyReactionToggle`, comentários), `useCorporateMuralSocket.ts`, `useColleagues('company')`.
- [x] **Task 7 — Componentes.** Feed (composer condicional, scroll infinito, deep-link), card (com selo de papel do autor), composer, comentários.
- [x] **Task 8 — Rota, menu e Home.** `/mural-corporativo` sob `FeatureGate`; item "Mural corporativo" no menu (admin e não-admin); Home troca a seção "Resenha do time" pelo mural, com "Ver tudo" para `/mural-corporativo`.
- [x] **Task 9 — Testes de web + suíte completa.** `MuralCorporativoFeed.test.tsx`; atualizar `HomePage.test.tsx`, `App.home-route.test.tsx` e `nav-items.test.ts`; rodar `pnpm test`.
