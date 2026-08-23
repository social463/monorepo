# Favoritar personagem criado — Implementation Plan

**Goal:** Implementar 5 slots fixos de visuais do personagem na tela `/personagem`.

**Spec:** `docs/superpowers/specs/2026-07-17-favoritar-personagem-design.md`
**Task:** 21871
**Branch:** `task/21871-favoritar-personagem`
**Status:** Done

## Assumptions

- Slots sao indices fixos `1..5`.
- Slot nao tem nome editavel; mostra numero/posicao, preview e acoes.
- "Usar" slot preenchido pede confirmacao e salva direto como personagem atual.
- DELETE de slot vazio sera idempotente (`204`) para simplificar o cliente.

## Success Criteria

- API permite listar, salvar/substituir e limpar slots do usuario autenticado.
- UI mostra sempre 5 slots, com estado vazio/preenchido.
- Salvar em slot vazio nao pede confirmacao; substituir e usar pedem confirmacao.
- Usar slot chama `PATCH /auth/me` somente apos confirmacao.
- Testes focados de shared/API/web passam; `pnpm test` roda se o Postgres estiver de pe.

## Atomic Tasks

### T1: Shared contract and Prisma model

**Files:** `packages/shared/src/character-favorite.ts`, `packages/shared/src/index.ts`, `apps/api/prisma/schema.prisma`, new Prisma migration.

**Done when:**
- `CharacterFavoriteDTO`, slots e constantes estao exportados.
- Prisma tem `CharacterFavorite` com unique `(userId, slot)`.
- Migration existe.

### T2: API service, route and serializer

**Files:** `apps/api/src/services/character-favorite-service.ts`, `apps/api/src/routes/character-favorites.ts`, `apps/api/src/app.ts`, `apps/api/src/lib/serialize.ts`.

**Done when:**
- `GET /character-favorites` lista slots do usuario.
- `PUT /character-favorites/:slot` cria/substitui slot 1-5.
- `DELETE /character-favorites/:slot` limpa slot do usuario.

### T3: API tests

**Files:** `apps/api/src/routes/character-favorites.test.ts`.

**Done when:**
- Cobre criar, substituir, slot invalido, payload invalido, ownership e delete.

### T4: Web client and slots panel

**Files:** `apps/web/src/lib/characterFavorites.ts`, `apps/web/src/components/character-editor/CharacterSlotsPanel.tsx`, tests for the component if useful.

**Done when:**
- Painel renderiza 5 slots, preview/placeholder e acoes.

### T5: Integrate slots in CharacterEditorPage

**Files:** `apps/web/src/pages/CharacterEditorPage.tsx`, `apps/web/src/pages/CharacterEditorPage.test.tsx`.

**Done when:**
- Tela carrega slots, salva/substitui/limpa e usa slot com confirmacao.
- Testes web focados passam.

### T6: Verification

**Files:** none expected.

**Done when:**
- Suites focadas passam.
- `pnpm test` executado ou bloqueio registrado.
