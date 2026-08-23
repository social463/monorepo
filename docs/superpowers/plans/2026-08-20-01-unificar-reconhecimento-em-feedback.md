# Plan — Unificar reconhecimento em feedback

Spec: `docs/superpowers/specs/2026-08-20-unificar-reconhecimento-em-feedback-design.md`

## 1. Contrato (`@legends/shared`)

- [x] `RecognitionCategoryDTO` ganha `slug` e `description`; vira o DTO único de
      categoria (voto e feedback).
- [x] `VoteCategoryRef` ganha `slug`; `CategoryDTO`/`categories.ts` (seed morto
      das 10 categorias de voto) são removidos.
- [x] `ProfileDTO`: `totalVotesReceived` → `totalFeedbacksReceived`,
      `monthsRecognized` → `monthsWithFeedback`.
- [x] `ShowcaseEntry.recognitions` → `feedbacksReceived`.

## 2. Banco (`apps/api/prisma`)

- [x] `RecognitionCategory`: `slug String`, `description String?`,
      `@@unique([companyId, slug])`.
- [x] `Feedback.voteId String? @unique` + relação com `Vote`.
- [x] `VoteCategory.categoryId` → FK para `RecognitionCategory`.
- [x] Migration SQL escrita à mão (o banco de dev tem drift): backfill de slug,
      fusão dos catálogos, repontar `VoteCategory`, materializar feedback dos
      votos publicados, `DROP TABLE CategorySector, Category`.

## 3. API

- [x] `category-service.ts` passa a ser o CRUD do catálogo unificado
      (era `recognition-category-service.ts`); `provisionCategories` no
      onboarding de empresa.
- [x] `GET /categories` serve o catálogo unificado; `/recognition-categories`
      deixa de existir (front passa a usar `/categories`).
- [x] `voting-service`: valida `categoryIds` no catálogo unificado.
- [x] `vote-feedback-service` (novo): `materializeVoteFeedbacks(periodId)`,
      idempotente por `voteId`; chamado na publicação do destaque.
- [x] `badge-service`: `CATEGORY`/`IMPACT`/`RECURRENCE` contam feedback recebido.
- [x] `feedback-service.createFeedback`: avalia selos dos destinatários.
- [x] `profile-service`: stats e breakdown por feedback recebido;
      `listVotesReceived` e `GET /users/:id/votes` saem.

## 4. Web

- [x] `VotePage`: copy de feedback, passo 3 "Seu feedback", catálogo unificado.
- [x] `ProfilePage`: sem `ViewToggle` e sem histórico de votos; "Impacto
      acumulado" e "Categorias dos feedbacks" por feedback.
- [x] Pickers de categoria (`CategoryPicker`, `NewFeedbackForm`,
      `FeedbackSection`) passam a `/categories`.
- [x] Administração: entrada "Reconhecimento" sai; "Categorias" passa a ser o
      catálogo unificado (`RecognitionCategoriesSection` substitui
      `CategoriesSection`).
- [x] Varredura de copy: `AppLayout`, `MobileNav`, `TeamPage`, `LegendCard`,
      `Skeleton`, `MuralBanner`, `HighlightsPage`, `LeadershipPage`,
      `PeopleAnalyticsSection`, `LoginPage`, `GameManualPage`.

## 5. Testes

- [x] API: `badge-service`, `profile-service`, `voting-service`, `feedback*`,
      `users`, `super-admin`, `monthly-highlights` (materialização).
- [x] Web: `ProfilePage`, `VotePage`, admin de categorias, pickers.
- [x] Novo: materialização idempotente na publicação do destaque.
