# Ofensiva em dias úteis — Design Spec

**Data:** 2026-06-23
**Status:** aprovado para implementação
**Slug:** ofensiva-dias-uteis

## Contexto

A **Ofensiva** (streak) já existe, derivada da `MoodEntry` (um boost = um dia com Humor do
Dia registrado). Hoje ela conta **dias corridos**: a regra de graça perdoa apenas o dia de
hoje e o fim de semana **quebra** a sequência. Num produto de trabalho isso é injusto —
quem não registra sábado/domingo perde o streak toda semana.

Esta entrega reescreve o **motor de cálculo** para contar **somente dias úteis** (seg–sex),
tratando o fim de semana como ponte. É **pré-requisito** dos selos de ofensiva (que serão
desenhados em spec próprio e cujas metas passarão a significar "dias úteis").

Feature relacionada: ofensiva original em
[2026-06-23-ofensiva-streak-design.md](2026-06-23-ofensiva-streak-design.md).

## Escopo

- Recalcular **streak atual**, **melhor streak** e **boosts no mês** considerando só dias úteis.
- Esmaecer os dias de fim de semana no calendário do painel.
- **Sem** mudança de schema, migration ou contrato (`@legends/shared` intacto). Apenas a
  semântica dos números muda.

### Fora de escopo

- **Feriados**: não há calendário de feriados; "dia útil" é puramente seg–sex pelo dia da
  semana. Feriados contam como dias úteis (podem quebrar o streak) — aceito nesta fase.
- Selos de ofensiva (spec separado).
- Mudança visual além do esmaecimento de fim de semana.

## Mecânica (dias úteis)

Datas continuam sendo **datas civis** em `America/Sao_Paulo`, strings `YYYY-MM-DD`, com
aritmética em UTC (igual ao motor atual). "Dia útil" = `getUTCDay()` ∈ {1,2,3,4,5} (seg–sex).

- **Conjunto de boosts** = `MoodEntry.day` do usuário (como hoje).
- **Fim de semana é ponte**: sáb/dom não exigem boost e não quebram a sequência. Dois dias
  úteis são consecutivos se um é o **dia útil imediatamente anterior** do outro
  (`prevBusinessDay`/`nextBusinessDay` pulam o fim de semana). Ex.: sex → seg é consecutivo.
- **Registro em fim de semana**: permitido (o Humor do Dia segue aparecendo todo dia), mas
  **neutro** — não conta como boost para streak/recorde/mês e não recebe chama no calendário.
- **Streak atual** (regra de graça por dia útil):
  - `lastBiz` = hoje se hoje é dia útil; senão o último dia útil antes de hoje (sex, no fim
    de semana).
  - Se `lastBiz` tem boost: conta `lastBiz` e caminha para trás por dias úteis enquanto
    houver boost.
  - Se `lastBiz` **não** tem boost (graça): começa a contar a partir de `prevBusinessDay(lastBiz)`;
    se esse tiver boost, conta dele para trás; senão streak = 0.
  - Efeito: no fim de semana e na manhã de segunda (antes de registrar) o streak **segura**
    no valor de sexta; só zera quando um dia útil inteiro passa sem boost.
- **Melhor streak**: maior sequência de **dias úteis consecutivos** (com fim de semana
  pontado) cada um com boost; entradas de fim de semana são ignoradas.
- **Boosts no mês**: nº de **dias úteis** com boost no mês de referência.

## Arquitetura — backend (`apps/api`)

### `src/lib/sao-paulo-date.ts` (helpers novos, puros)

- `isBusinessDay(ymd: string): boolean` — `dayFromYmd(ymd).getUTCDay()` ∈ {1..5}.
- `prevBusinessDay(ymd: string): string` — `addDays(-1)` repetido até cair em dia útil.
- `nextBusinessDay(ymd: string): string` — `addDays(+1)` repetido até cair em dia útil.

Os helpers existentes (`todayInSaoPaulo`, `ymdOf`, `dayFromYmd`, `addDays`, `monthRefOf`,
`monthBounds`) permanecem inalterados.

### `src/services/streak-service.ts` (reescrita do cálculo)

- `getStreakSummary(userId: string, todayYmd?: string): Promise<StreakSummaryDTO>`
  - Ganha o parâmetro **opcional** `todayYmd` (default `todayInSaoPaulo().ymd`) para tornar
    os testes determinísticos — mesmo padrão de `completedYears(joinedAt, now)`.
  - Filtra/considera apenas boosts em dias úteis ao computar streak atual e melhor streak,
    usando `prevBusinessDay`/`isBusinessDay`.
  - `registeredToday` = o conjunto contém `todayYmd` (mantido por compatibilidade do DTO).
- `getStreakCalendar(userId, monthRef): Promise<StreakCalendarDTO>`
  - `days` = apenas dias **úteis** com boost no mês; `count = days.length`.

Contrato (`StreakSummaryDTO`, `StreakCalendarDTO`) **inalterado**.

## Arquitetura — frontend (`apps/web`)

- **`src/lib/streak-calendar.ts`**: novo helper puro `isWeekendYmd(ymd: string): boolean`
  (`new Date(`${ymd}T00:00:00.000Z`).getUTCDay()` ∈ {0,6}). `buildMonthGrid`/`shiftMonth`/
  `todaySaoPaulo` permanecem como estão.
- **`src/components/StreakPanel.tsx`**: células de fim de semana ficam **esmaecidas/neutras**
  e nunca recebem chama (os `days` da API já excluem fim de semana, mas o estilo dim vale para
  qualquer célula de fim de semana, dentro ou fora do mês). O destaque de "hoje" no fim de
  semana fica neutro. Cards (Streak atual / Melhor streak / Boosts no mês) e hooks intactos.

## Tratamento de erros

Sem novas superfícies de erro. Rotas e DTOs inalterados.

## Testes

- **API (Postgres real):** `getStreakSummary(userId, todayYmd)` com `todayYmd` fixo em datas
  úteis conhecidas:
  - ponte de fim de semana: boost em sexta + segunda → streak 2;
  - graça segura no fim de semana (hoje = sábado, sexta com boost → streak ≥ 1) e na manhã de
    segunda (hoje = segunda sem boost, sexta com boost → streak segura);
  - falta de um dia útil quebra a sequência;
  - entrada de fim de semana é ignorada no melhor streak;
  - `getStreakCalendar`: `count`/`days` excluem dias de fim de semana.
  - Helpers `isBusinessDay`/`prevBusinessDay`/`nextBusinessDay` com testes unitários puros
    (incluindo travessia de fim de semana e de virada de mês/ano).
- **Web (jsdom):** o calendário do `StreakPanel` esmaece células de fim de semana e não marca
  chama nesses dias.

## Nomenclatura

Mantém **"Ofensiva"** e os rótulos já existentes (Streak atual / Melhor streak / Boosts no
mês). Mensagens ao usuário em português.
