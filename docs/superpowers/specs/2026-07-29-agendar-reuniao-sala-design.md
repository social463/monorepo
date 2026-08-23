# Agendar reunião em uma sala do escritório (Google Calendar e Teams)

**Data:** 2026-07-29
**Status:** proposto

## Contexto

O escritório virtual já tem salas de reunião (`meeting-room` no documento do
mapa, materializadas em `OfficeRoom`) com voz, chat, cadeado e allowlist. O que
não existe é **combinar antes**: hoje a única forma de reunir gente numa sala é
chamar no momento (convite/toast) ou marcar por fora, no Google Calendar ou no
Teams, e torcer para todo mundo lembrar de abrir o Legends na hora.

O que o repo já oferece e este desenho reaproveita:

- **Notificações espelhadas no Teams.** `createNotification`
  (`notification-service.ts`) grava a notificação in-app e, quando a pessoa tem
  `teamsWebhookUrl`, posta um Adaptive Card na DM dela via fluxo Power Automate
  (`teams-client.ts`). Não há Microsoft Graph nem app registration envolvidos.
- **Scheduler in-process.** `apps/api/src/scheduler/nudges.ts` roda um tick por
  hora via `setInterval`, com a função de tick exportada e testável (recebe
  `now` injetado) e o start desligado em testes.
- **Sem infraestrutura de e-mail.** Nada de nodemailer/SES no backend. Convidado
  externo continua entrando pelo link de convidado (`OfficeGuestInvite`).

### A identidade estável de uma sala é `externalKey`, não o id

`publishMap` **recria** as linhas de `OfficeRoom` a cada publicação, com
`randomUUID()` novo, carregando o estado da publicação anterior por
`externalKey` (`office-map-service.ts:735-821`). Uma FK para `OfficeRoom.id`
seria apagada em cascata no próximo publish do mapa. Por isso a reunião guarda
`(companyId, roomExternalKey)` — o mesmo par que o próprio runtime do mapa usa
como identidade de sala.

## Objetivo

Marcar, de dentro da sala no escritório, uma reunião com hora, pauta e
convidados; e fazer esse compromisso chegar ao Google Calendar e ao
Outlook/Teams de quem foi convidado, com um link que abre o escritório já
andando até a sala.

## Fora de escopo

- **Recorrência (RRULE).** Nada de daily/planning semanal no MVP; complica o
  modelo e o `.ics` sem necessidade imediata.
- **OAuth real (Google Calendar API / Microsoft Graph).** Exigiria app
  registration nos dois lados, consentimento do admin do tenant e guarda de
  tokens por usuário. O ganho — o evento cair sozinho na agenda — não paga esse
  custo agora; o clique único em "adicionar à agenda" resolve.
- **Página dedicada de reuniões.** A agenda vive na sala. Se depois fizer falta
  uma visão "minhas reuniões", ela se apoia nos mesmos endpoints.
- **Convite para e-mail externo.** Sem infra de e-mail; segue pelo link de
  convidado que já existe.
- **Reserva forte.** A sala nunca é trancada nem vira allowlist por causa de um
  agendamento (ver "Conflito" abaixo).

## Desenho

### Dados

```prisma
model OfficeMeeting {
  id              String    @id @default(cuid())
  companyId       String    @default("company-emr")
  roomExternalKey String
  roomName        String    // snapshot: o .ics já enviado não muda se renomearem a sala
  title           String
  agenda          String?
  startsAt        DateTime
  endsAt          DateTime
  organizerId     String
  canceledAt      DateTime?
  sequence        Int       @default(0)
  remindedAt      DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  organizer    User                       @relation(fields: [organizerId], references: [id])
  company      Company                    @relation(fields: [companyId], references: [id])
  participants OfficeMeetingParticipant[]

  @@index([companyId, roomExternalKey, startsAt])
  @@index([organizerId])
  @@index([startsAt])
}

model OfficeMeetingParticipant {
  meetingId String
  userId    String
  createdAt DateTime @default(now())

  meeting OfficeMeeting @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  user    User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([meetingId, userId])
  @@index([userId])
}
```

`sequence` existe porque Outlook e Google só atualizam um evento já importado se
o `SEQUENCE` do `.ics` for maior que o anterior — sobe 1 a cada edição e no
cancelamento. `canceledAt` é soft delete: o convidado precisa continuar vendo
que a reunião caiu.

### Conflito: reserva leve

Ao criar ou editar, o service procura reuniões não canceladas na mesma
`(companyId, roomExternalKey)` que se sobrepõem à janela nova
(`startsAt < novoFim AND endsAt > novoInício`). Havendo alguma, responde `409`
com `{ message, conflicts: OfficeMeetingDTO[] }`. O front mostra quais são e
oferece "marcar mesmo assim", que reenvia com `force: true` e pula a checagem.

O `accessPolicy` e o `status` da sala **não** são tocados em nenhum momento —
ninguém é barrado na porta por causa de um agendamento.

### API

Rotas em `apps/api/src/routes/office-meetings.ts` (finas, Zod `safeParse` →
`400 { message, issues }`), lógica em
`apps/api/src/services/office-meeting-service.ts`, erros de domínio na classe
`OfficeMeetingError` com `status` HTTP (padrão do `VoteError`). Escopo de
empresa por `scopedPrisma`, como no resto do office. Todas exigem
`onRequest: [app.authenticate]`; `role: 'GUEST'` recebe `403`.

| método | rota | quem | efeito |
|---|---|---|---|
| `POST` | `/api/office/meetings` | logado não-convidado | cria; `409` em conflito sem `force` |
| `GET` | `/api/office/meetings?room=<key>&from&to` | logado | agenda da sala (default: próximos 7 dias) |
| `PATCH` | `/api/office/meetings/:id` | só organizador | edita, `sequence+1`, notifica participantes |
| `DELETE` | `/api/office/meetings/:id` | só organizador | grava `canceledAt`, `sequence+1`, notifica |
| `GET` | `/api/office/meetings/:id/ics` | organizador ou participante | `text/calendar` |

Body do `POST`: `roomExternalKey`, `title`, `agenda?`, `startsAt`,
`durationMinutes` (15/30/45/60/90 — `endsAt` é derivado), `participantIds[]`,
`force?`. Participantes precisam ser usuários da mesma empresa; id de fora
responde `400`.

Contrato em `packages/shared/src/office-meeting.ts` (`OfficeMeetingDTO`,
`MEETING_DURATIONS`, `MEETING_REMINDER_MINUTES`), exportado no barril;
serialização em `lib/serialize.ts` (`toOfficeMeetingDTO`). O DTO carrega
`googleCalendarUrl`, `outlookCalendarUrl` e `icsPath` já prontos, para o front
não montar URL de calendário.

### Exportação para as agendas

`apps/api/src/lib/calendar-export.ts`, funções puras (única fonte de verdade do
formato dos três destinos):

- `buildGoogleCalendarUrl(meeting)` —
  `calendar.google.com/calendar/render?action=TEMPLATE` com `text`, `dates`
  (`YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ`), `details` (pauta + deep link) e
  `location`.
- `buildOutlookCalendarUrl(meeting)` — deeplink
  `outlook.office.com/calendar/0/deeplink/compose`, mesmos dados. Sai de graça
  na mesma função e cobre quem vive no Outlook Web.
- `buildMeetingIcs(meeting)` — `VCALENDAR`/`VEVENT` com `METHOD:REQUEST` (ou
  `CANCEL` e `STATUS:CANCELLED` se cancelada), `UID
  <id>@legends.eumedicoresidente.com.br` estável, `SEQUENCE`, `DTSTAMP`,
  `DTSTART`/`DTEND` em UTC, `SUMMARY`, `DESCRIPTION` (pauta + deep link),
  `LOCATION: Sala <nome> — Legends`, `URL`, `ORGANIZER` e um `ATTENDEE` por
  participante. Linhas terminadas em CRLF, folding em 75 octetos, escaping de
  `\`, `;`, `,` e quebra de linha.

O `.ics` é o que faz o evento entrar no calendário do **Outlook/Teams**; a URL
do Google faz o mesmo em um clique no **Google Calendar**.

O download não pode ser uma navegação direta para o endpoint: o access token só
existe em memória (`lib/api.ts`), e o browser não o mandaria. O front baixa via
`apiFetch` → `blob` → `URL.createObjectURL` → `<a download>`. Se o `apiFetch`
atual não devolver resposta não-JSON, ganha um irmão `apiFetchBlob` ao lado.

### Notificações e Teams

Convite, edição, cancelamento e lembrete chamam `createNotification`, que já
grava in-app e espelha o Adaptive Card na DM do Teams de quem tem webhook. Os
tipos novos entram no enum do Prisma e em `emojiForNotificationType`:

| tipo | emoji | quando |
|---|---|---|
| `MEETING_INVITED` | 📅 | você foi convidado |
| `MEETING_UPDATED` | 📅 | horário/pauta mudou |
| `MEETING_CANCELED` | 🚫 | organizador cancelou |
| `MEETING_REMINDER` | ⏰ | 10 min antes |

O `link` de todas é o deep link da sala, então o CTA do card do Teams
("Entrar na sala") leva direto para dentro do escritório.

### Lembrete

`apps/api/src/scheduler/meeting-reminders.ts`, no molde do `nudges.ts`:
`runMeetingReminderTick(now)` exportado (testável sem relógio real) e
`startMeetingReminderScheduler()` chamado em `server.ts`, que não sobe em teste.
Tick de 60 s — a granularidade horária do nudge não serve para um lembrete de 10
minutos.

Cada tick pega as reuniões com `canceledAt` nulo, `remindedAt` nulo e `startsAt`
entre `now` e `now + 10 min`. Antes de notificar, **reivindica** cada uma com um
`updateMany` condicional (`where: { id, remindedAt: null }`); quem receber
`count: 0` perdeu a corrida para outro tick e desiste. A condição no `WHERE` é o
que serializa de fato — ler e só então gravar deixaria passar duplicata, já que
`setInterval` não espera o tick anterior terminar e pode haver mais de um
processo. Reivindicada, notifica organizador e participantes. Falha de
notificação é best-effort e logada, como o resto do office; o lembrete daquela
reunião se perde, o que é preferível a mandar duas vezes.

### Deep link `/escritorio?sala=<externalKey>`

Depois que o mapa carrega e o personagem entra, a `OfficePage` lê o search param
uma vez, acha o objeto `meeting-room` com aquela `externalKey`, escolhe o tile
andável mais central do retângulo (`isMapTileWalkable`, com fallback para o
vizinho andável mais próximo) e chama `walkToTile`. Em seguida limpa o param com
`navigate(replace: true)`, para não reandar a cada re-render. Sala inexistente
no mapa ativo: toast "Sala não encontrada" e a pessoa fica no spawn.

### Front

- **Entrada:** item "Agendar reunião" no `MediaBarMoreMenu`, visível só dentro
  de uma sala de reunião e escondido para convidado — ao lado de Chat, Levantar
  mão e Trancar sala, que já vivem lá.
- **Modal** `apps/web/src/office/meetings/ScheduleMeetingModal.tsx`, em duas
  seções:
  - *Próximas reuniões desta sala* — próximos 7 dias; o organizador vê editar e
    cancelar em cada uma.
  - *Nova reunião* — título, pauta, data/hora, duração, participantes
    (multi-select de usuários da empresa). Conflito vira banner amarelo com as
    reuniões que colidem e o botão "Marcar mesmo assim".
- Criada a reunião, o modal mostra **Adicionar ao Google Calendar**, **Baixar
  .ics (Outlook/Teams)** e **Copiar link da sala**.
- Dados por React Query, chamadas por `lib/api.ts`, como o resto do office.

## Erros e casos de borda

- Sala que não existe na publicação ativa → `404` no `POST`.
- `endsAt <= startsAt` ou duração fora da lista → `400`.
- Reunião no passado → `400` no create; no `PATCH`, mover para o passado também
  é `400`.
- Editar ou cancelar reunião já cancelada → `409`.
- Não-organizador tentando `PATCH`/`DELETE` → `403`.
- Reunião de outra empresa → `404` (nunca `403`, para não vazar existência).
- Renomear a sala no mapa não altera reuniões já criadas: o `.ics` usa
  `roomName` congelado; a agenda da sala continua achando por `externalKey`.

## Testes

- `packages/shared` — schema e tipos do DTO.
- `apps/api`
  - `calendar-export.test.ts`: formato do `.ics`, escaping, folding em 75
    octetos, `CANCEL`/`SEQUENCE`, URLs do Google e do Outlook.
  - `office-meeting-service.test.ts`: detecção de conflito, `force`,
    só-organizador edita/cancela, isolamento por empresa, notificações
    disparadas.
  - `office-meetings.test.ts` (rotas): 400 de validação, 403 de convidado e de
    não-organizador, 404 de outra empresa, 409 de conflito, `content-type` do
    `.ics`.
  - `meeting-reminders.test.ts`: janela de 10 min, idempotência do `remindedAt`,
    cancelada não lembra.
- `apps/web` — `ScheduleMeetingModal.test.tsx` (fluxo de conflito → confirmar,
  botões de exportação) e o deep link levando o personagem até a sala.
