# Ofensiva (streak de boosts) — Design Spec (fase 1)

**Data:** 2026-06-23
**Status:** aprovado para implementação
**Slug:** ofensiva-streak

## Contexto

Plataforma interna de reconhecimento entre pares (Legends). Já temos o **Humor do Dia**:
cada pessoa registra, uma vez por dia, como está se sentindo (`MoodEntry`, 1 registro por
usuário por dia, em `America/Sao_Paulo`). O spec do Humor do Dia já previa, como fase futura,
um **selo/contador de "acessos diários" (ofensiva)** derivado desse histórico.

Esta entrega traz a **ofensiva**: uma camada de gamificação leve em cima do registro diário
de humor, no modelo do app de estudos usado como referência (painel "Boosts" com chama,
calendário do mês e cards de streak).

## Escopo da fase 1

- **Boost = um dia com Humor do Dia registrado.** Não há tabela nova de boost; tudo é
  **derivado da `MoodEntry`** existente (fonte única de verdade, funciona retroativamente
  com o histórico já gravado).
- Indicador de **🔥 com o número do streak atual** no header (sempre visível enquanto logado).
- Ao clicar no 🔥, abre um **painel** com:
  - **Calendário do mês**: marca os dias com boost, destaca o dia de hoje, navega entre meses.
  - **3 cards de streak**: Streak atual, Melhor streak, Boosts no mês (do mês exibido).
- Tudo em **`America/Sao_Paulo`**, reusando a lógica de data civil do Humor do Dia.

### Fora de escopo nesta fase

Meta semanal configurável e botão "Alterar meta", gráfico de barras por semana (S1–S5),
countdown "tempo para receber o boost de hoje", selo de ofensiva, leitura por leads. Ficam
para fases futuras.

## Mecânica (regras de cálculo)

Todas as datas são **datas civis** em `America/Sao_Paulo`, representadas como strings
`YYYY-MM-DD`. Comparações e aritmética de "dia anterior" usam meia-noite UTC do dia civil
(igual ao Humor do Dia, onde `MoodEntry.day` é gravado como `Date` em UTC midnight).

- **Conjunto de dias com boost** = todos os `MoodEntry.day` do usuário (já únicos por dia).
- **`registeredToday`** = hoje (SP) está no conjunto.
- **Streak atual** (regra de graça):
  - Se **hoje** está no conjunto: conta hoje e caminha para trás enquanto o dia anterior
    estiver no conjunto.
  - Se **hoje não** está no conjunto mas **ontem** está: conta a partir de ontem para trás
    (o streak ainda **não quebrou** — só quebra quando um dia inteiro passa sem registro).
  - Caso contrário: streak atual = 0.
- **Melhor streak** = maior sequência de dias consecutivos de todos os tempos (varredura
  dos dias ordenados, contando runs onde a diferença é exatamente 1 dia).
- **Boosts no mês** = quantidade de dias com boost dentro do mês de referência exibido
  no calendário.

## Arquitetura — backend (`apps/api`)

Fluxo padrão do repo: **route → service → Prisma**, camadas finas.

### Lib de data

Extrair `todayInSaoPaulo()` (hoje em `mood-service.ts`) para **`src/lib/sao-paulo-date.ts`**,
junto com helpers de data civil necessários ao streak:
- `todayInSaoPaulo(): { ymd: string; day: Date }` (movido; comportamento inalterado).
- `ymdOf(day: Date): string` — `Date` (UTC midnight) → `YYYY-MM-DD`.
- `dayFromYmd(ymd: string): Date` — `YYYY-MM-DD` → `Date` em UTC midnight.
- `addDays(ymd: string, n: number): string` — aritmética de dia civil.
- `monthRefOf(ymd: string): string` e bounds do mês (`monthStart`/`monthEnd` como `Date`).

`mood-service.ts` passa a **importar** `todayInSaoPaulo` desse lib (sem mudança de comportamento).

### Service (`src/services/streak-service.ts`)

- `getStreakSummary(userId): Promise<{ currentStreak: number; bestStreak: number; today: string; registeredToday: boolean }>`
  - Carrega `select: { day: true }` de `MoodEntry` do usuário, ordenado por `day`.
  - Calcula streak atual, melhor streak e `registeredToday` a partir do conjunto/ordem.
- `getStreakCalendar(userId, monthRef): Promise<{ ref: string; days: string[]; count: number }>`
  - Query `MoodEntry` onde `day` ∈ [início, fim] do `monthRef`, `select: { day: true }`.
  - `days` = lista de `YYYY-MM-DD`; `count = days.length`.

### Rotas (`src/routes/streak.ts`) — protegidas por `onRequest: [app.authenticate]`

- `GET /me/streak` → `StreakSummaryDTO`.
- `GET /me/streak/calendar?month=YYYY-MM` → `StreakCalendarDTO`.
  - Zod: `month` opcional, regex `^\d{4}-(0[1-9]|1[0-2])$`; default = mês atual SP.
  - Em falha de validação: `400 { message, issues }` (padrão do repo).
- Registrar em `src/app.ts` (`buildApp`).

### Serialização

DTO builders finos em `src/lib/serialize.ts` (`toStreakSummaryDTO`, `toStreakCalendarDTO`)
ou retorno direto já no formato do contrato — seguindo o padrão da camada vizinha (mood).

## Contrato compartilhado (`packages/shared`)

Novo `src/streak.ts`, exportado no barril `index.ts`:

```ts
export interface StreakSummaryDTO {
  currentStreak: number
  bestStreak: number
  today: string            // YYYY-MM-DD em America/Sao_Paulo
  registeredToday: boolean
}

export interface StreakCalendarDTO {
  ref: string              // "YYYY-MM"
  days: string[]           // YYYY-MM-DD com boost no mês
  count: number            // boosts no mês
}
```

## Arquitetura — frontend (`apps/web`)

### `StreakIndicator` (header)

- Componente no header do `AppLayout`: botão `🔥` + número do **streak atual**.
- `useQuery(['streak'])` → `GET /me/streak`. Se a query falhar, o indicador não renderiza
  (não derruba o header).
- Clique abre/fecha o `StreakPanel` (overlay).

### `StreakPanel` (overlay)

Painel no modelo do print, titulado **"🔥 Ofensiva"**:

- **Esquerda — calendário mensal:**
  - Navegação `‹ JUNHO 2026 ›` (estado `monthRef` local).
  - Cabeçalho de semana **D S T Q Q S S** (semana começa no domingo).
  - Grid 6×7 com dias do mês + dias adjacentes esmaecidos (gerado por aritmética de data
    em **UTC**, independente do fuso do navegador).
  - Dias com boost recebem destaque (chama/preenchido); **hoje** em evidência.
  - Marcação compara **somente strings `YYYY-MM-DD`** contra `days` da API e contra `today`
    do resumo — sem depender do timezone do cliente.
- **Direita — 3 cards:** Streak atual e Melhor streak (do resumo `['streak']`); Boosts no mês
  (do `count` do mês exibido).
- `useQuery(['streak-calendar', monthRef])` → `GET /me/streak/calendar?month=monthRef`.
  Navegar de mês troca `monthRef` e refaz a query.

### Integração entre features

No `MoodOfDay`, após `setMood` com sucesso, **invalidar** `['streak']` e `['streak-calendar']`
para o 🔥 e o calendário refletirem o novo boost imediatamente.

## Fluxo de dados

1. Header monta → `['streak']` → mostra 🔥 + streak atual.
2. Clique no 🔥 → abre o painel.
3. Painel usa `['streak']` (cache) nos cards Streak atual / Melhor streak; e
   `['streak-calendar', monthRef]` para o calendário + Boosts no mês.
4. Navegar de mês → novo `monthRef` → nova query de calendário.
5. Registrar humor (MoodOfDay) → invalida `['streak']` e `['streak-calendar']` → UI atualiza.

## Tratamento de erros

- Rotas: erros inesperados sobem (`throw`); Zod retorna `400 { message, issues }` para
  `month` inválido.
- Front: falha em `['streak']` → 🔥 não aparece; falha no calendário → estado vazio/discreto
  no painel.

## Testes

- **API (Postgres real):**
  - `streak-service`: semear `MoodEntry` e validar streak atual, melhor streak, regra de
    graça (hoje sem registro mas ontem com registro mantém o streak), `registeredToday`,
    `count` do mês e fronteiras de mês.
  - Rotas: exigem auth; default de `month` = mês atual; `400` para `month` inválido.
- **Web (jsdom + Testing Library):**
  - `StreakIndicator` mostra o número do streak.
  - `StreakPanel`: grid do mês monta corretamente e marca os dias com boost / o dia de hoje.

## Nomenclatura

- Feature: **"Ofensiva"** (evita o anglicismo "Boosts").
- Painel titulado **"🔥 Ofensiva"**; o 🔥 do header carrega o número do streak atual.
- Mensagens ao usuário em **português**.
