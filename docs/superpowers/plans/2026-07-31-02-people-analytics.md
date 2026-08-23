# Plan — G&G People Analytics

**PBI:** 22270 · **Spec:** `../specs/2026-07-31-people-analytics-design.md`
**Branch:** `feat/22270-people-analytics` · **Status:** Concluído

## Tasks

### 1. Contrato em `@legends/shared` ✅
`packages/shared/src/people-analytics.ts` + barril: `PeopleAnalyticsRange`,
`AccessSeriesPointDTO`, `DistributionSliceDTO`, `PeopleOverviewDTO`,
`EngagementOverviewDTO`, `MOOD_SCORES`, `ACCESS_LOG_PATH_MAX_LENGTH`.

**Decisão de gráfico registrada no spec:** SVG próprio, sem `recharts`.

### 2. Prisma: `AccessLog` ✅
Model + relações em `User`/`Company`, índices `(companyId, createdAt)` e
`(userId, createdAt)`, entrada em `TENANT_SCOPED_MODELS`.
Migration `20260731200644_add_access_log`, gerada com
`migrate diff --from-migrations` (o banco de dev tem drift).

### 3. Helper de fuso ✅
`saoPauloMidnightUtc(ymd)` em `lib/sao-paulo-date.ts` — o instante UTC da
meia-noite civil de São Paulo, para recortar colunas `DateTime` sem errar 3h.

### 4. Service ✅
`services/people-analytics-service.ts`: `normalizeAccessPath`, `recordAccess`,
`getPeopleOverview`, `getEngagementOverview`. Uma função por bloco da tela.
Agregação em SQL — `groupBy`/`count` onde dá, `$queryRaw` para
`COUNT(DISTINCT)` e `date_trunc` com fuso.

**Bug pego em teste:** `createdAt` é `timestamp WITHOUT time zone`, então
`AT TIME ZONE 'America/Sao_Paulo'` *interpreta* em vez de converter. Correção:
`AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo'`.

### 5. Rotas ✅
`routes/people-analytics.ts` registrada em `app.ts`:
`POST /access-logs` (204, best-effort), `GET /admin/people/overview` e
`GET /admin/people/engagement` (`requireAdminOrSubadmin`; `sectorId` do
SUBADMIN vem do token e ignora a query).

### 6. Web ✅
`hooks/useAccessLogPing.ts` (guarda de path repetido) no `AppLayout`;
`components/analytics/AnalyticsPrimitives.tsx`;
`pages/admin/PeopleAnalyticsSection.tsx` com as três abas e os filtros;
rota `pessoas` em `App.tsx` e item no `AdminSidebar`.

### 8. Complemento pós-auditoria vs. portal EMR ✅

Auditoria do zip apontou três lacunas reais (as demais eram adaptações
conscientes — níveis por pontos e a assistente "Emily" não existem no Legends):

1. **Busca + filtro (setor/squad/papel) + CSV** na aba Ficha & Perfil — era
   pedido literal do PBI e não tinha sido feito. Entrou no `CollaboratorsSection`
   (beneficia `/admin/lendas` também), com `forceOpen` no `SectorAccordion` e
   `lib/csv.ts` novo.
2. **Tendência do clima** — `MoodSummaryDTO.trend`, linha 1–5 que interrompe em
   dia sem registro.
3. **Mapa de calor dia × hora** — `PeopleOverviewDTO.accessHeatmap`, grade 7×24
   na hora civil de São Paulo.

Bug pego pelo teste do heatmap: a expectativa que escrevi dizia que 02:00Z do
dia 25 cairia em *terça*; o Postgres devolveu quarta — e estava certo, porque
23:00 do dia 24 (quarta) é o horário de São Paulo correspondente. O serviço
estava certo, o teste é que estava errado.

Também faltava `prisma.accessLog.deleteMany()` no `test/setup.ts` — todo model
é limpo explicitamente ali, e o novo tinha ficado de fora.

### 7. Testes ✅
| Arquivo | Testes |
| --- | --- |
| `services/people-analytics-service.test.ts` | 24 |
| `routes/people-analytics.test.ts` | 11 |
| `pages/admin/PeopleAnalyticsSection.test.tsx` | 12 |
| `pages/admin/CollaboratorsSection.test.tsx` (busca/filtro/CSV) | +11 |
| `lib/csv.test.ts` | 4 |
| `hooks/useAccessLogPing.test.tsx` | 4 |
| `lib/sao-paulo-date.test.ts` (+1), `AdminSidebar.test.tsx` (+1) | 2 |

Suíte completa: API 1368 ✅, shared 197 ✅, web 1498 ✅.

Duas falhas **pré-existentes**, verificadas com `git stash` na `origin/main`
sem nenhuma mudança minha: `admin.test.ts > schedules a future voting period`
(depende do horário do relógio) e `coin-service.test.ts > lista o extrato
paginado` (desempate de ordenação no mesmo milissegundo). São flakes de tempo,
não regressão.

## Critérios de aceite do PBI

| Critério | Onde é coberto |
| --- | --- |
| Uma navegação = um `AccessLog`; re-render não duplica; falha não afeta a tela | `useAccessLogPing.test.tsx` (3 testes) |
| `overview` 403 para LEGEND/LEAD/MANAGER, 200 para ADMIN/SUBADMIN | `routes/people-analytics.test.ts` |
| SUBADMIN só vê o próprio setor, mesmo passando `sectorId` de outro | `routes/people-analytics.test.ts` (overview e engagement) |
| Nunca aparece dado de outra empresa | `people-analytics-service.test.ts` — "nunca mistura dados de outra empresa" |
| Trocar o período recalcula todos os blocos | `PeopleAnalyticsSection.test.tsx` — filtro refaz a busca com `range=7d` |
| Base vazia: estado vazio em pt-BR, sem `NaN` | `PeopleAnalyticsSection.test.tsx` (2 testes) + service |

## Fora de escopo entregue como ressalva

"Quantos viram" **por post** não existe: não há telemetria por card do Mural.
Entregue `uniqueViewers` no nível da tela + comentários/reações/pessoas por
post, com o rótulo distinguindo os dois na UI (ver spec, decisão 4).
