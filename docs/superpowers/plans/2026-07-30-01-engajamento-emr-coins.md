# Plano — Engajamento (EMR Coins + galeria filtrável + hub)

- **Spec:** `docs/superpowers/specs/2026-07-30-engajamento-emr-coins-design.md`
- **Card:** PBI 22236 · tasks 22237 (galeria), 22254 (coins), hub
- **Branch:** `feat/22236-engajamento` (de `origin/main`)

Sete fases, cada uma terminando verde (typecheck + testes dos arquivos tocados). Suíte completa só no
fim. Postgres de pé (`pnpm db:up`) para qualquer teste de API.

## Fase 1 — Contrato (`packages/shared`)

- `src/coin.ts` (novo): `COIN_EVENTS` + labels/descrições, `COIN_CAP_WINDOWS` + labels,
  `COIN_TRANSACTION_KINDS` + labels, constantes (`COIN_CURRENCY_LABEL`, limites de valor e de
  justificativa, `COIN_LEDGER_PAGE_SIZE`), DTOs (`CoinRuleDTO`, `CoinRulePublicDTO`,
  `CoinTransactionDTO`, `CoinBalanceDTO`, `CoinLedgerResponse`, `CoinReportDTO`) e payloads.
- `src/index.ts`: barril. `src/third-party.ts`: `'coins'` em `FEATURE_KEYS` + `FEATURE_LABELS`.
- `src/enums.ts`: `BADGE_KIND_LABELS` (rótulos curtos dos 7 kinds, **incluindo `HIGHLIGHT`**) — o
  `BADGE_KINDS` do admin (`pages/admin/BadgesSection.tsx`) é outra coisa: o subconjunto criável.
- Testes: `coin.test.ts`, `enums.test.ts`.

✅ `pnpm --filter @legends/shared test`

## Fase 2 — Dados (`apps/api`)

- `prisma/schema.prisma`: enums `CoinEvent`/`CoinCapWindow`/`CoinTransactionKind`, models `CoinRule`
  e `CoinTransaction` (ver spec), relações em `User` e `Company`.
- `pnpm db:migrate --name add_emr_coins` — migration **gerada**; conferir que o timestamp é maior que
  `20260730120500_...` (o repo já tem uma colisão de timestamp).
- `src/lib/tenant-scope.ts`: `'CoinRule'` e `'CoinTransaction'` em `TENANT_SCOPED_MODELS`.
- `test/setup.ts`: `coinTransaction` e `coinRule` no truncate, antes de `user`.
- `src/lib/sao-paulo-date.ts`: `startOfWeekYmd(ymd)` (semana segunda→domingo) + teste.
- `prisma/seed.ts`: as 4 regras (dev).

✅ `pnpm db:generate`, `tsc --noEmit`, testes de `sao-paulo-date` e `tenant-scope`.

## Fase 3 — Motor e services (`apps/api/src/services`)

- `coin-service.ts`: `awardCoins`, `getCoinBalance`, `listCoinTransactions`, `listActiveCoinRules`.
- `coin-admin-service.ts`: `CoinAdminError`, CRUD de regra (evento não editável), `adjustCoinsManually`
  (valida saldo, audita), `getCoinReport` (`groupBy` no client escopado — nunca `$queryRaw`).
- `src/lib/serialize.ts`: `toCoinRuleDTO`, `toCoinRulePublicDTO`, `toCoinTransactionDTO`.
- Testes: `coin-service.test.ts` (idempotência, tetos DAY/WEEK/MONTH, sem crédito parcial, ajuste não
  consome teto, **isolamento multi-empresa**), `coin-admin-service.test.ts` (auditoria, 409 de regra
  duplicada, validações de teto, delete preserva lançamentos, débito além do saldo, relatório).

✅ `tsc --noEmit` + testes dos services + `serialize.test.ts`.

## Fase 4 — Rotas e integração (`apps/api`)

- `src/routes/coins.ts` (novo) + registro em `app.ts`.
- Blocos best-effort (`try/catch` próprio, `request.log.error`): `routes/votes.ts`,
  `routes/feedback.ts` (POST de feedback e **dentro do `if (myReaction)`** do toggle),
  `routes/mood.ts` (o `ymd` já está em escopo).
- `services/notification-service.ts`: link do selo `'/selos'` → `'/engajamento'`.
- Testes: `routes/coins.test.ts` (403 sem feature, 403 para SUBADMIN, CRUD, ajuste 201/409),
  ajustes em `votes.test.ts`, `feedback.test.ts`, `mood.test.ts`, `feature-gate.test.ts`.

✅ `tsc --noEmit` + `pnpm --filter @legends/api test`.

## Fase 5 — Front: hub e galeria (`apps/web`)

- `components/BadgesGallery.tsx` (novo, extraído de `BadgesPage.tsx`, que sai) com filtro por kind.
- `pages/EngagementPage.tsx` (novo): abas por `?tab=`, aba padrão = primeira disponível.
- `App.tsx`: `AnyFeatureGate`, rota `/engajamento`, `/selos` → `<Navigate replace>`, rota admin.
- `components/nav-items.ts`: `anyOfFeatures?: FeatureKey[]` + item "Engajamento".
- `components/Skeleton.tsx` (ramo `/engajamento`), `components/MyStatsCard.tsx` (link).
- Testes: `BadgesGallery.test.tsx` (migrado), `EngagementPage.test.tsx` (novo), `nav-items.test.ts`
  e `MyStatsCard.test.tsx` (quebram e são ajustados).

✅ typecheck web + testes dos arquivos tocados.

## Fase 6 — Front: coins do colaborador

- `lib/use-coins.ts` (`useCoinBalance`, `useCoinLedger`, `useCoinRules`, `invalidateCoins`,
  `useHasCoins(): boolean`).
- `components/CoinIndicator.tsx` + `components/CoinPanel.tsx` (molde do `StreakIndicator`),
  `components/CoinsTab.tsx` (extrato paginado no molde do `AdminAuditLogPage`).
- `components/AppLayout.tsx`: chip depois da ofensiva.
- `invalidateCoins` nos call sites que geram crédito (voto, feedback, reação, humor).

✅ typecheck web + testes novos.

## Fase 7 — Front admin e fechamento

- `pages/admin/CoinsSection.tsx` (regras, saldo/extrato, ajuste manual, relatório) + `AdminSidebar`.
- Testes da seção; ajustes em `AdminSidebar.test.tsx`.

✅ `pnpm build` + `pnpm test`.

## Armadilhas

- `scopedPrisma` lança em `upsert` — o motor usa `create` + `P2002`.
- `TENANT_SCOPED_MODELS` é manual e o esquecimento é silencioso; o teste de isolamento é a rede.
- Teste de web que estoura memória: `kinds`/`visible`/`available` e o `Set` de `effectiveFeatures` só
  no JSX — nunca em dep array nem em `setState`.
- Janela e relatório sempre em `day`; ordenação em `createdAt`. Serializar `day` com `ymdOf`.
