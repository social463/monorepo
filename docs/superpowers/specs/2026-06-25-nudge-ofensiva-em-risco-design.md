# Design — Nudge "Ofensiva em risco" (in-app + Teams)

- **Data:** 2026-06-25
- **Status:** Design aprovado, pronto para plano
- **Escopo:** Lembrete automático para quem está prestes a perder a ofensiva (streak)
  de humor, entregue no sino in-app **e** como DM no Teams via Power Automate.

## Contexto e motivação

O ciclo principal de reconhecimento é mensal (`VotingPeriod`), um loop longo demais
para trazer a pessoa de volta ao produto. A ofensiva de humor (`MoodEntry` + selos
`STREAK`) já cria um hábito diário, mas hoje **nada lembra** quem esqueceu de registrar.
Este é o primeiro de uma série de nudges; foi escolhido por criar hábito diário e por
reusar quase toda a infraestrutura existente (`notification-service`, `streak-service`,
`sao-paulo-date`).

Fora de escopo nesta versão (YAGNI): nudge de voto pendente, nudge de ações de retro,
e-mail/push, opt-out por usuário, DM via Microsoft Graph API.

## Decisões tomadas

| Decisão | Escolha |
|---|---|
| Disparo periódico | Scheduler **in-process** (setInterval), sobe no `server.ts` após `.listen()` |
| Janela de disparo | Hora São Paulo **== 16h**, somente **dia útil** |
| Público-alvo | Usuários ativos com `currentStreak >= 1` e `registeredToday == false` |
| Canais | **In-app (sino) + Teams** (redundância proposital) |
| Entrega Teams | **Power Automate (Workflows)**: HTTP POST numa URL de trigger **por pessoa** |
| Mapa usuário→URL Teams | Coluna **`User.teamsWebhookUrl`** (nullable), editável no admin |
| Idempotência | A notificação in-app do dia é a chave: 1 `STREAK_AT_RISK` por usuário por dia SP |
| Falha no Teams | **Best-effort** — logada e engolida; não derruba o tick nem o in-app |

## Arquitetura

Fluxo de um tick:

```
setInterval(1h) → runNudgeTick(now)
  ├─ é dia útil em SP e hora == 16? senão, retorna
  ├─ carrega usuários ativos
  ├─ para cada usuário:
  │    ├─ getStreakSummary(user) → currentStreak >= 1 && !registeredToday ?
  │    ├─ já existe STREAK_AT_RISK hoje (SP) para o usuário? → pula (dedup)
  │    ├─ createNotification(STREAK_AT_RISK)            [in-app]
  │    └─ se user.teamsWebhookUrl: postTeamsNudge(...)  [best-effort]
```

`runNudgeTick(now: Date)` é a unidade testável: recebe o "agora" injetado, não usa
timers, e concentra toda a orquestração. O `setInterval` é só a casca que a chama com
`new Date()`.

### Componentes

#### 1. `apps/api/src/scheduler/nudges.ts` (novo)

- `export async function runNudgeTick(now: Date): Promise<void>`
  - Deriva o dia (`ymd`) e a hora civil em São Paulo a partir do `now` **injetado**
    (ver "Helpers de data" abaixo) e `isBusinessDay(ymd)` (já existe).
  - Guarda: se não for dia útil **ou** a hora SP != 16, retorna sem efeito.
  - Busca `prisma.user.findMany({ where: { active: true } })`.
  - Para cada usuário: `getStreakSummary(user.id, ymd)` — a função **já aceita** o
    `todayYmd` como 2º argumento; segue só se `currentStreak >= 1 && !registeredToday`.
  - Dedup: `prisma.notification.findFirst` por `userId` + `type: 'STREAK_AT_RISK'` +
    `createdAt >= dayFromYmd(ymd)` (00:00 UTC do dia civil SP). Como o nudge só dispara
    às 16h SP (= 19h UTC), o nudge de ontem (19h UTC de D-1) cai **antes** desse corte e
    o de hoje **depois** — separação limpa de dias sem cálculo de offset. Se já existe, pula.
  - Cria notificação in-app e, se houver `teamsWebhookUrl`, dispara o Teams.
- `export function startNudgeScheduler(): void`
  - `setInterval(() => { runNudgeTick(new Date()).catch(logError) }, 60*60*1000)`.
  - **Não** inicia se `process.env.NODE_ENV === 'test'`.

#### 2. `apps/api/src/lib/teams-client.ts` (novo)

- `export async function postTeamsNudge(url: string, payload: TeamsNudgePayload): Promise<void>`
  - `fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })`
    com timeout (AbortSignal, ~5s).
  - Best-effort: qualquer erro (rede, timeout, status != 2xx) é **logado e engolido**.
    Segue o mesmo padrão da avaliação de selos pós-voto.
- **Payload** (contrato que o fluxo Power Automate deve esperar):
  ```json
  {
    "kind": "streak_at_risk",
    "name": "Fulano",
    "streakDays": 7,
    "message": "Não perca sua ofensiva de 7 dias — registre seu humor de hoje 🔥",
    "link": "https://<app>/<rota-humor>"
  }
  ```
  O recipiente **não** vai no payload: cada URL de fluxo já posta a DM da pessoa dona
  daquela URL. O fluxo usa `message` (e opcionalmente `name`/`link`/`streakDays`) para
  montar o cartão da DM.

#### 3. Boot — `apps/api/src/server.ts`

Após `.listen()` resolver, chamar `startNudgeScheduler()`. Mantém o scheduler fora dos
testes, que usam só `buildApp()`.

#### 3b. Helpers de data — `apps/api/src/lib/sao-paulo-date.ts`

`todayInSaoPaulo()` usa `new Date()` internamente e **não** aceita `now` — inviável de
testar com tempo controlado. Adicionar dois helpers puros que recebem o instante:

- `export function ymdInSaoPaulo(now: Date): string` — o `YYYY-MM-DD` civil em SP
  (mesmo `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', ... })` já usado).
- `export function hourInSaoPaulo(now: Date): number` — a hora (0–23) civil em SP via
  `Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' })`.

`todayInSaoPaulo()` pode passar a delegar em `ymdInSaoPaulo(new Date())` para evitar
duplicação (refactor opcional, sem mudar comportamento).

#### 4. Persistência — `apps/api/prisma/schema.prisma`

- Adicionar valor `STREAK_AT_RISK` ao `enum NotificationType`.
- Adicionar campo `teamsWebhookUrl String?` ao `model User`.
- `pnpm db:migrate` gera **uma** migration nova (nunca editar migrations aplicadas).

#### 5. Contrato — `packages/shared/src/notification.ts`

- Adicionar `'STREAK_AT_RISK'` a `NOTIFICATION_TYPES` (fonte de verdade do union type).

#### 6. Admin — `apps/api/src/routes/admin.ts` + `apps/web/src/pages/AdminPage.tsx`

- Backend: incluir `teamsWebhookUrl` (opcional, validado por Zod — string URL ou vazio
  → `null`) nos handlers de **criar** e **editar** usuário, gravando em `prisma.user`.
- DTO admin de usuário: expor `teamsWebhookUrl` **apenas** na listagem/edição admin.
  **Não** adicionar a `toPublicUser` (`lib/serialize.ts`) — manter o segredo fora de
  qualquer DTO público.
- Frontend: campo de texto "URL do fluxo Teams (Power Automate)" no formulário de
  criar/editar Lenda, na aba de usuários do admin.

### Segurança

- As URLs de fluxo são **segredos assinados** (`sig=`): quem tiver a URL posta no nome
  da pessoa. Tratamento:
  - Nunca commitar; vivem só no banco (coluna) e no `.env` de quem semeia dados locais.
  - Nunca serializar em DTO público (`toPublicUser` é allowlist — basta não adicionar).
  - Considerar mascarar o valor na UI admin (mostrar "configurado" + opção de
    substituir) em vez de exibir a URL inteira — **opcional na v1**, decidir no plano.
- As URLs já compartilhadas em texto devem ser **regeneradas** nos fluxos.

## Tratamento de erros

- `runNudgeTick`: erros por usuário não devem abortar o lote — capturar por iteração,
  logar e seguir. Erro geral do tick é logado pelo `.catch` do `setInterval`.
- `postTeamsNudge`: best-effort total (ver acima). Ausência de `teamsWebhookUrl` = só
  pula o Teams; o in-app sempre acontece.

## Testes (Vitest + Postgres real)

`runNudgeTick(now)` testado com `now` injetado e `teams-client` mockado (spy no `fetch`
ou no `postTeamsNudge`):

- **Dispara:** usuário ativo com streak ativo e sem humor hoje, num dia útil às 16h SP →
  cria 1 notificação `STREAK_AT_RISK` e chama o Teams (quando `teamsWebhookUrl` setado),
  com o payload esperado.
- **Sem URL Teams:** mesmo cenário sem `teamsWebhookUrl` → cria in-app, **não** chama fetch.
- **Idempotência:** segundo `runNudgeTick` no mesmo dia SP → **não** duplica notificação
  nem reposta no Teams.
- **Sem streak:** `currentStreak == 0` → nada.
- **Já registrou hoje:** `registeredToday == true` → nada.
- **Fim de semana / hora errada:** sábado, ou hora SP != 16 → tick é no-op.
- **Teams falha:** `fetch` rejeita/500 → notificação in-app ainda é criada (best-effort).

## Sequência de implementação (resumo para o plano)

1. Migration: enum `STREAK_AT_RISK` + coluna `User.teamsWebhookUrl`.
2. `packages/shared`: novo tipo em `NOTIFICATION_TYPES`.
3. Helpers `ymdInSaoPaulo`/`hourInSaoPaulo` em `lib/sao-paulo-date.ts` + testes.
4. `lib/teams-client.ts` + testes.
5. `scheduler/nudges.ts` (`runNudgeTick` + `startNudgeScheduler`) + testes.
6. Boot em `server.ts`.
7. Admin (backend + DTO + UI) para editar `teamsWebhookUrl`.
8. `pnpm test` + `tsc --noEmit` por workspace (build ≠ typecheck).
