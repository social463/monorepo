# Design — G&G People Analytics

**Data:** 2026-07-31
**PBI:** 22270
**Branch:** `feat/22270-people-analytics`
**Status:** Implemented

## Problema

Hoje `/admin` abre no `AdminDashboardPage`, que só mostra um card por setor
(ativos, período corrente, destaque pendente — `admin-dashboard-service.ts`).
Não existe nenhuma leitura de **adoção**: ninguém sabe quantas pessoas de fato
entram na plataforma, quais telas usam, se o engajamento sobe ou cai. Pior: o
dado nem é coletado — não há registro de acesso.

O portal EMR resolve isso em `/app/admin/people` (`app.admin.people.tsx`), uma
casca com três abas sobre `access_logs`, feed e clima. A referência serve de
guia de *conteúdo*; a implementação lá puxa `select *` e agrega no cliente, o
que não escala e não será copiado.

## Objetivos

- Coletar acesso por navegação autenticada, best-effort, sem afetar a UI.
- Entregar `/admin/pessoas` com três abas: Visão geral, Ficha & Perfil,
  Clima & Engajamento.
- Filtros de período (7/30/90 dias) e de setor aplicados à página inteira.
- Restringir a leitura a `ADMIN` (global) e `SUBADMIN` (só o próprio setor).

## Fora de Escopo

| Item | Motivo |
| --- | --- |
| Exportação agendada / e-mail de resumo | Explicitamente fora no PBI. |
| Embed de BI externo | É o PBI "Dashboards de RH". |
| Views por post do Mural | Não há telemetria por post; ver "Decisões". |

## Decisões

### 1. Gráficos: SVG próprio, sem nova dependência

O `apps/web` não tem lib de chart (deps: react, react-query, phaser, livekit,
node-emoji). O portal usa `recharts`.

**Decisão: desenhar SVG simples**, em `components/analytics/`. Motivos:

- O conjunto de formas é pequeno: uma série temporal (área/linha) e listas de
  distribuição com barra proporcional. Não há pizza, eixo duplo, brush nem
  tooltip complexo.
- `recharts` traz `d3-*` junto (~500 KB não-gzip) para uma única tela de admin,
  num bundle que já carrega Phaser e LiveKit.
- Os componentes SVG usam os tokens do design system (`text-primary`,
  `bg-surface-container`), o que o `recharts` só alcança com tema manual.
- Testável em jsdom sem `ResponsiveContainer` (que mede `getBoundingClientRect`
  e renderiza vazio em teste — dor conhecida do `recharts`).

Se no futuro aparecer demanda por gráficos de verdade (drill-down, zoom), a
decisão pode ser revista sem quebrar o contrato: os DTOs devolvem série pronta.

### 2. `AccessLog` guarda o *pathname* normalizado

Só `{ userId, path, companyId, createdAt }` — sem PII além do `userId` e **sem
query string**. Além disso o service normaliza segmentos que parecem id
(cuid, uuid, numérico) para `:id` **na escrita**: `/perfil/ckv123` vira
`/perfil/:id`.

Sem isso, "telas mais acessadas" viraria uma lista de milhares de caminhos com
contagem 1 cada, e a tabela cresceria com cardinalidade inútil. O agrupamento
por rota é a pergunta real ("qual tela é usada"), não o recurso individual.

### 3. Agregação em SQL, inclusive `$queryRaw`

O PBI é explícito: nunca puxar a tabela para o Node. `groupBy`/`count` do Prisma
resolvem quase tudo, **menos** duas coisas: `COUNT(DISTINCT userId)` por dia e o
`date_trunc` no fuso de São Paulo. Para essas, este é o primeiro `$queryRaw` do
repo.

Consequência importante: **raw query não passa pela extensão `scopedPrisma`**.
Todo raw deste service repete `"companyId" = $1` no `WHERE` à mão, e há teste de
isolamento entre empresas cobrindo exatamente isso.

### 4. "Alcance do Mural" é por post, com ressalva de views

O PBI pede "por post, quantos viram, comentaram e reagiram". **Não existe
telemetria de visualização por post** — o `AccessLog` registra a rota do Mural,
não qual card entrou no viewport. Entregamos:

- por post: comentários, reações e **pessoas distintas que interagiram**
  (união de quem comentou e quem reagiu);
- no cabeçalho do bloco: **visitantes únicos da tela do Mural** no período,
  que é o alcance real que o dado suporta.

A UI rotula os dois separadamente para não sugerir uma métrica que não temos.

### 5. Mapa de calor mostra as 24 horas, não só 6h–23h

O portal recorta o heatmap em 6h–23h e **descarta** silenciosamente o acesso de
madrugada. Aqui a grade vai de 0 a 23: um acesso às 3h é exatamente o tipo de
sinal que o RH quer ver (gente trabalhando fora de hora), não ruído a esconder.

### 6. Tendência do clima quebra a linha em dia sem registro

`MoodTrendPointDTO.average` é `null` no dia em que ninguém respondeu, e o
gráfico corta a linha ali (uma `polyline` por trecho contínuo). Desenhar zero
seria mentira dupla: zero não existe na escala 1–5, e leria como "time
péssimo" onde na verdade não houve resposta. O eixo é fixo em 1–5 pelo mesmo
motivo — escala automática faria 3.9→4.1 parecer um desabamento.

### 7. Clima vem do `MoodEntry`, não do termômetro do PBI irmão

O PBI menciona "embute o termômetro (PBI irmão)". O componente do irmão é o
`SquadMoodPanel`, que é do **líder da squad** (recorte por squad liderada), não
do RH. Em vez de acoplar a esse PBI, a aba calcula do `MoodEntry` direto:
participantes, média da escala e distribuição no período/setor. Quando o
termômetro de RH do irmão existir, entra ao lado sem mexer neste contrato.

## Contrato (`packages/shared/src/people-analytics.ts`)

- `PeopleAnalyticsRange` — `'7d' | '30d' | '90d'` (+ `_DAYS` e `_LABELS`).
- `AccessSeriesPointDTO` — `{ day, accesses, uniqueUsers }`.
- `PeopleOverviewDTO` — ativos, únicos 7/30d, adesão, série de acessos, mapa de
  calor, adesão da votação, feedbacks/reações, distribuição por papel e squad.
- `AccessHeatmapCellDTO` — `{ weekday, hour, accesses }`; só células com acesso.
- `EngagementOverviewDTO` — clima (`MoodEntry`) com distribuição **e**
  tendência diária, alcance do Mural, telas mais acessadas.
- `MoodTrendPointDTO` — `{ day, average, entries }`, `average` null sem registro.

## API

| Rota | Guarda | Notas |
| --- | --- | --- |
| `POST /access-logs` | `authenticate` | `{ path }`, responde `204`. |
| `GET /admin/people/overview` | `authenticate` + `requireAdminOrSubadmin` | query `range`, `sectorId?` |
| `GET /admin/people/engagement` | `authenticate` + `requireAdminOrSubadmin` | idem |

`SUBADMIN` tem o `sectorId` **sobrescrito pelo token** — passar `sectorId` de
outro setor é ignorado, não é erro. `ADMIN` escolhe pelo filtro.

`POST /access-logs` não grava auditoria: `recordAuditLog` é para mutação de
admin, e isto é telemetria de navegação de qualquer usuário — auditá-lo
inundaria a tela de Auditoria.

## Web

- `pages/admin/PeopleAnalyticsSection.tsx` — casca com as três abas e os
  filtros; a aba "Ficha & Perfil" reusa `CollaboratorsSection`.
- `components/analytics/` — `StatCard`, `AccessSeriesChart`, `DistributionBars`,
  `MoodTrendChart`, `AccessHeatmap`, `RateBar`.
- **Busca, filtros e CSV vivem no `CollaboratorsSection`**, não numa cópia na
  aba: `/admin/lendas` e a aba "Ficha & Perfil" são a mesma tela, então os dois
  ganham juntos. O `SectorAccordion` recebeu `forceOpen` — com filtro ativo os
  grupos abrem sozinhos, senão o resultado ficaria escondido num acordeão
  fechado e pareceria "não achou". Exportação é client-side (`lib/csv.ts`): os
  dados já estão na tela, e o CSV sai com BOM para o Excel não corromper acento.
- `hooks/useAccessLogPing.ts` — ping no layout autenticado, com guarda de path
  repetido (o `lastLogged` do portal) para não duplicar em re-render.
- Rota `pessoas` em `App.tsx` sob `/admin`, item no `AdminSidebar.tsx`.

## Riscos

| Risco | Mitigação |
| --- | --- |
| Volume do `AccessLog` | Índices `(companyId, createdAt)` e `(userId, createdAt)`; path normalizado corta cardinalidade. Retenção fica para outro PBI. |
| Raw query furar o isolamento | `companyId` obrigatório na assinatura + teste com duas empresas semeadas. |
| Ping duplicado em re-render | Guarda por path no hook + teste. |
