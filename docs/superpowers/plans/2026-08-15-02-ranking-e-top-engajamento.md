# Plan — Ranking e Top 5 engajamento

Spec: `docs/superpowers/specs/2026-08-15-ranking-e-top-engajamento-design.md`

## 1. Contrato (`packages/shared`)

- `src/ranking.ts` novo: `RankingEntryDTO`, `RankingResponse`,
  `StreakRankingEntryDTO`, `StreakRankingResponse`, `RankingOverviewDTO` (+
  `RankingSectorRowDTO`, `RankingEventRowDTO`, `RankingIdlePersonDTO`) e as
  constantes `PRESENCE_ONLINE_WINDOW_MINUTES`, `PRESENCE_HEARTBEAT_INTERVAL_MS`,
  `RANKING_TOP_LIMIT`, `RANKING_MAX_ENTRIES`, `RANKING_PAGE_SIZES`,
  `RANKING_IDLE_LIMIT`.
- Exportar no barril `index.ts`.
- Nome `RankingOverviewDTO`, e não `EngagementOverviewDTO`: esse já é de
  `people-analytics.ts` e mede outra coisa.

## 2. Banco (`apps/api/prisma`)

- `User.lastSeenAt DateTime?` + `@@index([companyId, lastSeenAt])`.
- Migration `20260815160000_user_last_seen_at`.

## 3. API — presença

- `services/presence-service.ts` novo: `touchPresence`, `onlineUserIds`,
  `onlineSince`. `updateMany` no touch — é best-effort e não pode estourar
  `RecordNotFound` numa rota de telemetria.
- `routes/people-analytics.ts`: `POST /access-logs` passa a carimbar presença
  junto do `AccessLog`; `POST /me/presence` novo (204, best-effort, **sem**
  `AccessLog`).

## 4. API — ranking

- `services/ranking-service.ts` novo: `getRanking`, `getStreakRanking`,
  `getRankingOverview`, mais `streaksFromDays` (a regra de `getStreakSummary`
  aplicada em lote, para não fazer uma query por pessoa).
- `RANKING_AUDIENCE` = mesmo recorte de `celebration-service`.
- `routes/ranking.ts` novo: `GET /ranking`, `GET /ranking/streaks`,
  `GET /admin/ranking/overview` (`requireAdmin`). Registrar em `app.ts`.
- Sem `requireFeature` em nenhuma das duas rotas de colaborador.

## 5. Web — presença e bloco da Home

- `hooks/usePresenceHeartbeat.ts`: bate a cada `PRESENCE_HEARTBEAT_INTERVAL_MS`
  só com a aba visível, e na volta ao primeiro plano. Ligar no `AppLayout`, ao
  lado do `useAccessLogPing`.
- `components/OnlineDot.tsx`: verde/cinza fixos, não tokens da marca.
- `lib/use-ranking.ts`: `useRanking`, `useStreakRanking`, `useRankingOverview`,
  com `refetchInterval` de metade da janela de presença.
- `components/TopEngagementCard.tsx`: último bloco da coluna direita da
  `HomePage`.

## 6. Web — tela `/ranking`

- `pages/RankingPage.tsx`: abas geral/consistência em `?aba=`, pódio, busca,
  tabela paginada no cliente.
- Rota em `App.tsx` sem `FeatureGate`.
- `components/nav-items.ts`: item Ranking no grupo Engajamento das **duas**
  árvores (admin e colaborador), sem `feature`.

## 7. Web — Administração › Engajamento

- `pages/admin/EngagementSection.tsx`: resumo, por evento, por setor, ranking e
  "sem pontuar no mês".
- Rota `admin/engajamento` sob `StrictAdminOnly`; item em
  `components/admin-nav-items.ts` no grupo Reconhecimento, `adminOnly: true`.

## 8. Testes

- `apps/api/src/routes/ranking.test.ts`: ordenação e empate, recorte de quem
  disputa, janela de presença, `limit` sem mexer em `total`/`me`, nível junto,
  streaks, panorama do admin (adesão do mês vs. acumulado, ociosos), 401/403,
  e os dois caminhos que carimbam `lastSeenAt`.
- `apps/web`: `TopEngagementCard.test.tsx`, `RankingPage.test.tsx`,
  `usePresenceHeartbeat.test.tsx`, `admin/EngagementSection.test.tsx`; casos
  novos em `nav-items.test.ts`, `admin-nav-items.test.ts` e
  `App.routing.test.tsx`.
- `HomePage.test.tsx`: o caso "não traz ranking de engajamento" vira o caso que
  exige o bloco (o spec da Home v2 o tinha deixado fora de escopo).
