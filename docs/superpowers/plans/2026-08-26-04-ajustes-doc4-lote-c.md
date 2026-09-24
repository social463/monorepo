# Plan — Ajustes do Documento 4, Lote C (Analytics de T&D)

Spec: `docs/superpowers/specs/2026-08-26-ajustes-doc4-lote-c-design.md`

Branch empilhada sobre `feat/ajustes-doc4-lote-e` — cadeia A → D → E → C.

## 1. Contrato

- [x] `packages/shared/src/training-analytics.ts`: `TrainingOverviewDTO` com os
      três cards, `completionsBySector` e `topCourses`; `positions` (catálogo do
      filtro de cargo).
- [x] Barril.

## 2. Service

- [x] `apps/api/src/services/training-analytics-service.ts`:
      `getTrainingOverview({ companyId, sectorId, position, window })`.
- [x] Conclusões datadas por `completedAt`, recortadas por janela + setor +
      cargo da PESSOA.
- [x] Treinamentos cadastrados e % de obrigatórios ignoram a janela (são
      estoque/estado, não fluxo) — registrar o porquê no código.
- [x] Divisão por zero devolve `0`.
- [x] `listPositions(companyId)`: valores distintos de `User.position` em uso.
- [x] Teste: `training-analytics-service.test.ts`.

## 3. Rota

- [x] `analyticsQuerySchema` ganha `position`.
- [x] `GET /admin/people/training` no mesmo gate (`gente-gestao`), com
      `resolveSectorId` — subadmin continua preso ao próprio setor.
- [x] Teste em `people-analytics.test.ts`: gate, filtro de cargo, subadmin
      preso ao próprio setor e janela personalizada incompleta.

## 4. Tela

- [x] `TrainingAnalyticsTab.tsx`: três `StatCard`, `DistributionBars` por setor
      e tabela de cursos, com os primitivos que os outros painéis já usam.
- [x] Filtro de **Cargo** ao lado do de setor, só nesta aba.
- [x] `PeopleAnalyticsSection.tsx`: aba **Treinamentos**.
- [x] Teste: `TrainingAnalyticsTab.test.tsx`.

## Fechamento

- [ ] `pnpm test` completo, lendo a SAÍDA e o exit code do `vitest`/`tsc`.
- [ ] Commit único e PR alvo `feat/ajustes-doc4-lote-e`.
