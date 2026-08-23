# Integração de calendário — Fase 2: leitura (presença, painel, aviso)

**Data:** 2026-07-29
**Depende de:** `2026-07-29-calendario-conexao-design.md` (fase 1).
**Irmã:** `2026-07-29-calendario-publicacao-design.md` (fase 3) — independente desta.

## Problema

Com a conexão da fase 1 no lugar, o Legends pode enxergar a agenda de quem
conectou. Três coisas saem daí, todas no espírito do Gather/SoWork:

1. **Colegas sabem que você está ocupado** — o avatar no escritório mostra "em
   reunião até 15:30" sem ninguém precisar avisar no chat.
2. **Você vê sua própria agenda de dentro do produto** — painel no escritório e
   card na home, com botão de entrar na chamada.
3. **Você não perde a reunião** — aviso alguns minutos antes, com o link.

## Decisão de privacidade (a mais importante)

**Colegas veem apenas que você está em reunião e até quando. Nunca o título,
participantes ou link.** O título e o `joinUrl` só aparecem para a própria pessoa,
por uma rota que serve exclusivamente a agenda de quem pediu.

Isso não é só regra de UI — é estrutural: o broadcast do escritório **não carrega
título**. O payload que vai para os outros clientes contém `endsAt` e nada mais.
Um bug de front não consegue vazar o que o servidor nunca mandou.

## Contexto do repo

- `apps/api/src/lib/office-hub.ts` (~1.280 linhas) tem uma instância de `OfficeHub`
  por empresa (`getOfficeHub(companyId)`), estado de presença em memória e
  `this.broadcast(...)` para os sockets. Já existe precedente de o **servidor**
  mudar status sozinho e avisar: o auto-away em `office-hub.ts:388` faz
  `broadcast({ type: 'status-changed', userId, status: 'away' })`.
- `packages/shared/src/office.ts:136` define
  `OfficeUserStatus = "online" | "away" | "brb"`, com o comentário explícito de que
  é escolhido manualmente, "sem detecção".
- `apps/api/src/scheduler/nudges.ts` estabelece o padrão de tick: `runXTick(now)`
  com `now` injetado (testável sem timers), idempotente, `try/catch` por usuário,
  e `startNudgeScheduler()` que não sobe em teste.
- `apps/api/src/services/notification-service.ts` cria notificação in-app e
  espelha no Teams quando `user.teamsWebhookUrl` existe.
- `apps/web/src/office/nav/OfficeNavRail.tsx` monta a rail a partir de
  `OFFICE_NAV_ITEMS` e já sabe desenhar badge de contagem sobre o botão.

## Arquitetura

```
provedor → calendar-sync tick (5 min) → CalendarEventCache
                                              │
                    ┌─────────────────────────┼──────────────────────────┐
                    ▼                         ▼                          ▼
        meeting-presence tick (1 min)   GET /calendar/agenda    calendar-alerts tick (1 min)
                    │                    (só do próprio)                 │
                    ▼                         ▼                          ▼
        OfficeHub.broadcast          painel + card + balão        notificação + Teams
        (só endsAt)
```

**Por que cache local e polling, e não webhook do provedor.** Push (Google watch
channels / Graph subscriptions) daria latência de segundos, mas custa: endpoint
HTTPS público recebendo callback do provedor, renovação de subscription a cada 3–7
dias, validação de assinatura, e **polling de fallback de qualquer forma** para
cobrir subscription morta. É muita peça móvel para ganhar ~5 minutos. Sem cache,
por outro lado, nada disso funciona: a presença precisa ser derivada no servidor
mesmo com o navegador da pessoa fechado, e o aviso "5 min antes" também.

## Modelo de dados

```prisma
model CalendarEventCache {
  id              String   @id @default(cuid())
  connectionId    String
  userId          String
  companyId       String
  providerEventId String
  title           String
  startsAt        DateTime
  endsAt          DateTime
  isAllDay        Boolean  @default(false)
  joinUrl         String?
  /** accepted | tentative | needsAction | declined — declined nunca conta. */
  responseStatus  String
  /** Marca de que o aviso "começa em X min" já saiu; idempotência do alerta. */
  notifiedSoonAt  DateTime?
  updatedAt       DateTime @updatedAt

  connection CalendarConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@unique([connectionId, providerEventId])
  @@index([userId, startsAt])
  @@index([companyId])
}
```

O cache é descartável por construção: apagar a tabela só causa um sync a mais.
Nada de estado de produto vive aqui além de `notifiedSoonAt`.

## Sincronização

`apps/api/src/scheduler/calendar-sync.ts`, no formato dos ticks existentes:

```ts
export async function runCalendarSyncTick(now: Date): Promise<void>
```

- Roda a cada **5 min**. Latência máxima de 5 min para "entrou em reunião" — o
  suficiente para presença; o aviso pré-reunião não depende disso, porque o evento
  já está no cache muito antes de começar.
- Itera conexões `ACTIVE`, sequencialmente, com `try/catch` por conexão: uma conta
  quebrada não impede as outras (padrão `nudges.ts`).
- Janela `[now - 1h, now + 36h]`. A hora para trás cobre reunião em curso; 36h à
  frente cobre "amanhã cedo" para o painel.
- Incremental por `syncCursor` (`syncToken` no Google, `deltaLink` no Graph).
  Cursor inválido → full sync da janela e cursor novo. Full sync também quando
  `lastSyncAt` é nulo ou muito antigo.
- Evento `cancelled` no provedor é **apagado** do cache — deixou de existir.
  Evento `declined` continua no cache e é filtrado na derivação: o cache é espelho
  do provedor, a regra de "o que conta como reunião" mora no service. Sem isso, a
  função de derivação teria um filtro que nunca dispara.
- `isAllDay` é gravado mas **nunca conta como reunião** — "Férias" o dia inteiro
  não deixa ninguém ocupado. Aparece no painel, não na presença.
- Falha de refresh por consentimento revogado → `status = NEEDS_REAUTH` e
  `lastSyncError`; a pessoa vê "reconectar" no perfil (fase 1). Falha transitória
  grava `lastSyncError` e tenta no próximo tick.

`listEvents` entra na interface `CalendarProviderAdapter` da fase 1, normalizando
os dois formatos para uma forma só. Google e Microsoft entregam o link de chamada
em campos diferentes (`hangoutLink`/`conferenceData` e `onlineMeeting.joinUrl`);
essa tradução mora dentro de cada adapter e não escapa dele.

## Presença "em reunião"

**`meeting` é ortogonal ao `OfficeUserStatus`, não um quarto valor.** São eixos
independentes: `away`/`brb` continua sendo escolha manual da pessoa, e "em reunião"
é derivado da agenda. Uma pessoa pode estar `brb` e em reunião ao mesmo tempo, e
misturar os dois num enum só significaria escolher qual informação perder.

Em `packages/shared/src/office.ts`:

```ts
export interface OfficeMeetingState {
  /** ISO. Único dado de reunião que colegas recebem. */
  endsAt: string
}

// em OfficeParticipant:
  /** Derivado da agenda conectada; ausente = não está em reunião. */
  meeting?: OfficeMeetingState

// novo evento de servidor:
  | { type: "meeting-changed"; userId: string; meeting: OfficeMeetingState | null }
```

`apps/api/src/lib/office-hub.ts` ganha um tick de **1 min** que, para os usuários
presentes naquela empresa, consulta o estado de reunião e faz broadcast só para
quem mudou — mesmo formato do auto-away que já existe ali. Presença nova (join)
já vem com `meeting` preenchido no snapshot inicial.

O cálculo (`services/calendar-meeting-service.ts`) é uma função pura sobre o
cache: evento não all-day, `responseStatus != declined`, `startsAt <= now < endsAt`
→ ocupado; `endsAt` é o maior fim entre eventos sobrepostos, para reuniões
encavaladas não fazerem o badge piscar.

No cliente (Phaser), o avatar de quem está em reunião ganha um ícone discreto, e o
rótulo mostra "em reunião até 15:30". Sem título, para ninguém.

## A própria agenda

`GET /calendar/agenda` (autenticada, sempre do `request.user.sub` — nunca aceita
`userId` por parâmetro) devolve os eventos das próximas 36h **do próprio usuário**,
com título e `joinUrl`. É a única rota que expõe conteúdo de agenda.

```ts
// packages/shared/src/calendar.ts
export interface CalendarAgendaEntryDTO {
  id: string
  title: string
  startsAt: string
  endsAt: string
  isAllDay: boolean
  joinUrl: string | null
  provider: CalendarProviderKey
}
```

As três superfícies consomem essa mesma rota, via React Query com refetch de 1 min
(a UI não precisa de socket para isso — a agenda muda em minutos, não em segundos):

- **Painel na nav rail** (`apps/web/src/office/nav/`): novo item em
  `OFFICE_NAV_ITEMS` com badge de "quantos eventos faltam hoje" (a rail já desenha
  badge de contagem), abrindo um flyout com hora, título e botão "Entrar" quando há
  `joinUrl`.
- **Card na home** (`apps/web/src/pages/HomePage.tsx`): "Sua agenda de hoje", com
  os próximos eventos e o mesmo botão. Some quando não há conexão nem eventos —
  não vira placeholder morto na home de quem não usa.
- **Balão no avatar**: o cliente já tem a própria agenda em mãos; quando o próximo
  evento está a ≤5 min, mostra "reunião em 5 min" sobre o **próprio** personagem.
  Derivado no cliente, sem tráfego novo e sem risco de vazar para os outros.

## Aviso antes da reunião

`apps/api/src/scheduler/calendar-alerts.ts`, tick de **1 min**:

```ts
export async function runCalendarAlertTick(now: Date): Promise<void>
```

Para cada evento em cache com `startsAt` em `[now, now + 5min]`, não all-day, não
`declined` e com `notifiedSoonAt` nulo: cria notificação e grava `notifiedSoonAt`.
Idempotência vem da coluna, não de janela de tempo — restart do processo não
duplica aviso.

- Novo `NotificationType.CALENDAR_EVENT_SOON` no enum do Prisma.
- `createNotification({ ... })` do `notification-service.ts` já espelha no Teams
  quando existe `teamsWebhookUrl` — o DM sai de graça, sem código novo de Teams.
- Título: `Sua reunião "<título>" começa às 15:00`. Aqui o título aparece porque a
  notificação é da própria pessoa (in-app e DM privada).
- `link` aponta para o `joinUrl` quando existe; senão para o escritório.

Reunião criada com menos de 5 min de antecedência pode nascer já dentro da janela e
ser avisada no primeiro tick após o sync — aceitável, e melhor que silêncio.

## Erros

| Situação | Comportamento |
| --- | --- |
| Sync falha para uma conexão | grava `lastSyncError`, segue para as outras, tenta no próximo tick |
| Consentimento revogado | `NEEDS_REAUTH`; presença e painel voltam a ficar vazios (sem erro na cara do usuário no escritório) |
| Cursor de delta inválido | full sync da janela |
| Cache vazio ou sem conexão | painel mostra estado vazio com link para conectar; presença simplesmente não tem `meeting` |
| Notificação falha | logado, `notifiedSoonAt` **não** é gravado — tenta no próximo tick |

## Testes

- `services/calendar-meeting-service.test.ts` (função pura, sem banco): evento em
  curso → ocupado; all-day → não; `declined` → não; sobrepostos → `endsAt` maior;
  fronteiras exatas de início/fim.
- `scheduler/calendar-sync.test.ts`: `now` injetado; evento novo entra, atualizado
  muda, `cancelled` sai; conexão que lança não impede a seguinte; `invalid_grant`
  marca `NEEDS_REAUTH`; segundo tick usa o cursor gravado.
- `scheduler/calendar-alerts.test.ts`: cria uma notificação e só uma (segundo tick
  não repete); all-day e `declined` não geram; evento fora da janela não gera.
- `routes/calendar.test.ts` (estendido): `GET /calendar/agenda` só devolve eventos
  do usuário autenticado — teste com dois usuários, um deles não vê nada do outro.
- `lib/office-hub.test.ts` (estendido): broadcast de `meeting-changed` sai quando o
  estado muda e **não** sai quando não muda; o payload não contém título (asserção
  explícita); snapshot de join inclui `meeting`.
- Web: painel renderiza eventos, estado vazio e botão "Entrar" só com `joinUrl`;
  card da home desaparece sem conexão; balão aparece a ≤5 min do início.

## Fora de escopo

- Escrever qualquer coisa na agenda (fase 3).
- Webhooks/push do provedor (decisão registrada acima; pode virar evolução depois
  sem mudar nada do que está aqui, porque só troca o gatilho do sync).
- Ver a agenda de colegas, mesmo com permissão do provedor.
- Presença via Microsoft Graph `/me/presence` (`InAMeeting`): daria estado mais
  fiel para quem usa Teams, mas exige escopo novo, só cobre um dos dois provedores
  e traria duas fontes de verdade para a mesma informação.
- Bloquear chamadas do escritório para quem está em reunião — o badge informa, a
  decisão continua sendo das pessoas.
