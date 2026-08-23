# Agendar reunião em sala do escritório — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir marcar, de dentro de uma sala do escritório, uma reunião com hora/pauta/convidados que chega ao Google Calendar e ao Outlook/Teams e cujo link abre o escritório já andando até a sala.

**Architecture:** Nova tabela `OfficeMeeting` chaveada por `(companyId, roomExternalKey)` — nunca por `OfficeRoom.id`, que é recriado a cada publicação de mapa. Backend expõe CRUD em `/api/office/meetings`, gera `.ics` e URLs de calendário por funções puras em `lib/calendar-export.ts`, e notifica por `createNotification` (que já espelha card no Teams). Front acrescenta um item no `MediaBarMoreMenu` que abre um modal com a agenda da sala e o formulário.

**Tech Stack:** Fastify 4 + Prisma 5 + PostgreSQL + Zod (api), React 18 + React Query + Tailwind (web), Vitest nos dois lados, tipos em `@legends/shared`.

**Spec:** `docs/superpowers/specs/2026-07-29-agendar-reuniao-sala-design.md`

## Global Constraints

- Branch de trabalho: `feat/agendar-reuniao-sala` (já criada de `origin/main`).
- TypeScript strict, ESM puro. Mensagens ao usuário em **português**.
- Rota fina → service → Prisma. Zod `safeParse` na rota, devolvendo `400 { message, issues }`. Erro de domínio como classe com `status`; a rota faz `instanceof`.
- Todo model novo com coluna `companyId` **precisa** entrar em `TENANT_SCOPED_MODELS` (`apps/api/src/lib/tenant-scope.ts`). `OfficeMeetingParticipant` **não** tem `companyId` e **não** entra lá.
- Reunião nunca altera `status` nem `accessPolicy` da sala.
- Duração permitida: **15, 30, 45, 60, 90** minutos. Lembrete: **10 minutos** antes.
- Nunca editar migration já aplicada — sempre `pnpm db:migrate` gerando uma nova.
- Testes da API exigem Postgres de pé (`pnpm db:up`).
- **Execução de testes:** por preferência do autor do repo, os testes são **escritos** junto com o código mas **não executados a cada passo**. Cada task traz o comando exato pronto; rode-os quando ele pedir (ou na verificação final, antes de fechar a branch).
- Commits pequenos, um por task, em português, prefixados `feat:`/`test:`/`chore:`.

---

## Estrutura de arquivos

**Criar:**

| arquivo | responsabilidade |
|---|---|
| `packages/shared/src/office-meeting.ts` | DTO, constantes e o helper de deep link — contrato api⇄web |
| `apps/api/src/lib/calendar-export.ts` | funções puras: `.ics`, URL do Google, URL do Outlook |
| `apps/api/src/lib/calendar-export.test.ts` | testes de formato |
| `apps/api/src/services/office-meeting-service.ts` | regra de negócio (conflito, permissão, notificação) |
| `apps/api/src/services/office-meeting-service.test.ts` | testes de serviço |
| `apps/api/src/routes/office-meetings.ts` | endpoints |
| `apps/api/src/routes/office-meetings.test.ts` | testes de rota |
| `apps/api/src/scheduler/meeting-reminders.ts` | tick de lembrete |
| `apps/api/src/scheduler/meeting-reminders.test.ts` | testes do tick |
| `apps/web/src/office/meetings/api.ts` | chamadas HTTP do front |
| `apps/web/src/office/meetings/useRoomMeetings.ts` | hooks React Query |
| `apps/web/src/office/meetings/ScheduleMeetingModal.tsx` | modal (agenda + formulário) |
| `apps/web/src/office/meetings/ScheduleMeetingModal.test.tsx` | teste do modal |

**Modificar:** `apps/api/prisma/schema.prisma`, `apps/api/src/lib/tenant-scope.ts`, `apps/api/src/lib/serialize.ts`, `apps/api/src/services/notification-service.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, `packages/shared/src/index.ts`, `packages/shared/src/office-map-runtime.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/office/media/MediaBar.tsx`, `apps/web/src/office/media/MediaBarMoreMenu.tsx`, `apps/web/src/pages/OfficePage.tsx`.

---

### Task 1: Contrato em `@legends/shared`

**Files:**
- Create: `packages/shared/src/office-meeting.ts`
- Create: `packages/shared/src/office-meeting.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `OfficeMeetingDTO`, `MeetingPersonDTO`, `CreateOfficeMeetingRequest`, `UpdateOfficeMeetingRequest`, `OfficeMeetingConflictResponse`, `MEETING_DURATION_MINUTES`, `MeetingDurationMinutes`, `MEETING_REMINDER_MINUTES`, `MEETING_TITLE_MAX_LENGTH`, `MEETING_AGENDA_MAX_LENGTH`, `MEETING_AGENDA_DAYS_AHEAD`, `officeRoomDeepLinkPath(externalKey)`.

- [ ] **Step 1: Escrever o teste que falha**

`packages/shared/src/office-meeting.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MEETING_DURATION_MINUTES, officeRoomDeepLinkPath } from "./office-meeting";

describe("officeRoomDeepLinkPath", () => {
  it("monta o caminho da sala com a externalKey", () => {
    expect(officeRoomDeepLinkPath("aurora")).toBe("/escritorio?sala=aurora");
  });

  it("escapa caracteres especiais da externalKey", () => {
    expect(officeRoomDeepLinkPath("sala do time a&b")).toBe(
      "/escritorio?sala=sala%20do%20time%20a%26b",
    );
  });
});

describe("MEETING_DURATION_MINUTES", () => {
  it("oferece as durações do produto em ordem crescente", () => {
    expect([...MEETING_DURATION_MINUTES]).toEqual([15, 30, 45, 60, 90]);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Comando: `pnpm --filter @legends/shared exec vitest run src/office-meeting.test.ts`
Esperado: FAIL — `Cannot find module './office-meeting'`.

- [ ] **Step 3: Implementar o contrato**

`packages/shared/src/office-meeting.ts`:

```ts
/** Durações oferecidas ao marcar (minutos). `endsAt` é derivado disto. */
export const MEETING_DURATION_MINUTES = [15, 30, 45, 60, 90] as const;
export type MeetingDurationMinutes = (typeof MEETING_DURATION_MINUTES)[number];

/** Antecedência do lembrete in-app/Teams, em minutos. */
export const MEETING_REMINDER_MINUTES = 10;

export const MEETING_TITLE_MAX_LENGTH = 120;
export const MEETING_AGENDA_MAX_LENGTH = 1000;

/** Janela padrão da agenda mostrada na sala, em dias. */
export const MEETING_AGENDA_DAYS_AHEAD = 7;

export interface MeetingPersonDTO {
  id: string;
  name: string;
}

export interface OfficeMeetingDTO {
  id: string;
  roomExternalKey: string;
  /** Nome congelado na criação — o .ics já enviado não muda se renomearem a sala. */
  roomName: string;
  title: string;
  agenda: string | null;
  startsAt: string;
  endsAt: string;
  canceled: boolean;
  organizer: MeetingPersonDTO;
  participants: MeetingPersonDTO[];
  /** URLs prontas: o front não monta link de calendário. */
  googleCalendarUrl: string;
  outlookCalendarUrl: string;
  /** Caminho relativo do .ics (baixado por apiFetchBlob, não por navegação). */
  icsPath: string;
}

export interface CreateOfficeMeetingRequest {
  roomExternalKey: string;
  title: string;
  agenda?: string;
  /** ISO 8601. */
  startsAt: string;
  durationMinutes: MeetingDurationMinutes;
  participantIds: string[];
  /** true = criar mesmo com conflito de horário na sala. */
  force?: boolean;
}

export interface UpdateOfficeMeetingRequest {
  title?: string;
  agenda?: string | null;
  startsAt?: string;
  durationMinutes?: MeetingDurationMinutes;
  participantIds?: string[];
  force?: boolean;
}

/** Corpo do 409: as reuniões que colidem com a janela pedida. */
export interface OfficeMeetingConflictResponse {
  message: string;
  conflicts: OfficeMeetingDTO[];
}

/**
 * Deep link da sala: abre o escritório e leva o personagem até ela.
 * Usado no .ics, no CTA do card do Teams e no botão "copiar link".
 */
export function officeRoomDeepLinkPath(externalKey: string): string {
  return `/escritorio?sala=${encodeURIComponent(externalKey)}`;
}
```

Acrescentar ao barril `packages/shared/src/index.ts`, logo depois de `export * from './office-media'`:

```ts
export * from './office-meeting'
```

- [ ] **Step 4: Rodar o teste e ver passar**

Comando: `pnpm --filter @legends/shared exec vitest run src/office-meeting.test.ts`
Esperado: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/office-meeting.ts packages/shared/src/office-meeting.test.ts packages/shared/src/index.ts
git commit -m "feat: contrato de reunião de sala em @legends/shared"
```

---

### Task 2: Schema Prisma, migration e tenant scope

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/lib/tenant-scope.ts`
- Create: `apps/api/prisma/migrations/<timestamp>_add_office_meeting/migration.sql` (gerada pelo Prisma)

**Interfaces:**
- Consumes: nada.
- Produces: models `OfficeMeeting` e `OfficeMeetingParticipant`; valores novos do enum `NotificationType`: `MEETING_INVITED`, `MEETING_UPDATED`, `MEETING_CANCELED`, `MEETING_REMINDER`.

- [ ] **Step 1: Acrescentar os models ao schema**

No fim de `apps/api/prisma/schema.prisma`:

```prisma
model OfficeMeeting {
  id              String    @id @default(cuid())
  companyId       String    @default("company-emr")
  roomExternalKey String
  roomName        String
  title           String
  agenda          String?
  startsAt        DateTime
  endsAt          DateTime
  organizerId     String
  canceledAt      DateTime?
  // Outlook/Google só atualizam um evento já importado se o SEQUENCE subir.
  sequence        Int       @default(0)
  remindedAt      DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  organizer    User                       @relation("OfficeMeetingOrganizer", fields: [organizerId], references: [id], onDelete: Cascade)
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
  user    User          @relation("OfficeMeetingParticipant", fields: [userId], references: [id], onDelete: Cascade)

  @@id([meetingId, userId])
  @@index([userId])
}
```

- [ ] **Step 2: Ligar as relações inversas e o enum**

Em `model User`, ao lado de `officeRoomGrants OfficeRoomAccessGrant[]`:

```prisma
  officeMeetingsOrganized OfficeMeeting[]            @relation("OfficeMeetingOrganizer")
  officeMeetingSeats      OfficeMeetingParticipant[] @relation("OfficeMeetingParticipant")
```

Em `model Company`, ao lado de `officeRooms OfficeRoom[]`:

```prisma
  officeMeetings             OfficeMeeting[]
```

Em `enum NotificationType`, depois de `REVIEW_MENTION`:

```prisma
  MEETING_INVITED
  MEETING_UPDATED
  MEETING_CANCELED
  MEETING_REMINDER
```

O contrato compartilhado espelha esse enum e **precisa andar junto**, senão `toNotificationDTO` (`lib/serialize.ts`) deixa de compilar. Em `packages/shared/src/notification.ts`, no fim de `NOTIFICATION_TYPES`:

```ts
  'MEETING_INVITED',
  'MEETING_UPDATED',
  'MEETING_CANCELED',
  'MEETING_REMINDER',
```

- [ ] **Step 3: Registrar o model no isolamento por empresa**

Em `apps/api/src/lib/tenant-scope.ts`, dentro de `TENANT_SCOPED_MODELS`, depois de `'OfficeGuestInvite',`:

```ts
  'OfficeMeeting',
```

`OfficeMeetingParticipant` **não** entra: o conjunto é só de models com coluna `companyId` própria. O isolamento dele vem por cascata do `meetingId`.

- [ ] **Step 4: Gerar migration e client**

```bash
pnpm db:up
pnpm db:migrate --name add_office_meeting
```

Esperado: nova pasta em `apps/api/prisma/migrations/` com `CREATE TABLE "OfficeMeeting"`, `CREATE TABLE "OfficeMeetingParticipant"` e quatro `ALTER TYPE "NotificationType" ADD VALUE`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma apps/api/src/lib/tenant-scope.ts
git commit -m "feat: model OfficeMeeting com participantes e tipos de notificação"
```

---

### Task 3: Exportação para calendário (`.ics`, Google, Outlook)

**Files:**
- Create: `apps/api/src/lib/calendar-export.ts`
- Create: `apps/api/src/lib/calendar-export.test.ts`

**Interfaces:**
- Consumes: `officeRoomDeepLinkPath` (Task 1), `absoluteUrl` de `lib/app-url.ts`.
- Produces: `CalendarMeeting`, `buildGoogleCalendarUrl(m): string`, `buildOutlookCalendarUrl(m): string`, `buildMeetingIcs(m, now?): string`.

- [ ] **Step 1: Escrever os testes que falham**

`apps/api/src/lib/calendar-export.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildGoogleCalendarUrl, buildMeetingIcs, buildOutlookCalendarUrl, type CalendarMeeting } from './calendar-export'

const meeting: CalendarMeeting = {
  id: 'mtg1',
  title: 'Planning do time',
  agenda: 'Fechar escopo; revisar riscos',
  roomName: 'Aurora',
  roomExternalKey: 'aurora',
  startsAt: new Date('2026-07-30T17:00:00.000Z'),
  endsAt: new Date('2026-07-30T18:00:00.000Z'),
  sequence: 0,
  canceled: false,
  organizer: { name: 'Ana', email: 'ana@x.com' },
  participants: [{ name: 'Bruno', email: 'bruno@x.com' }],
}

describe('buildGoogleCalendarUrl', () => {
  it('usa o template do Google com a janela em UTC compacto', () => {
    const url = new URL(buildGoogleCalendarUrl(meeting))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('text')).toBe('Planning do time')
    expect(url.searchParams.get('dates')).toBe('20260730T170000Z/20260730T180000Z')
    expect(url.searchParams.get('location')).toBe('Sala Aurora — Legends')
    expect(url.searchParams.get('details')).toContain('/escritorio?sala=aurora')
  })
})

describe('buildOutlookCalendarUrl', () => {
  it('usa o deeplink de compose do Outlook com datas ISO', () => {
    const url = new URL(buildOutlookCalendarUrl(meeting))
    expect(url.origin + url.pathname).toBe('https://outlook.office.com/calendar/0/deeplink/compose')
    expect(url.searchParams.get('rru')).toBe('addevent')
    expect(url.searchParams.get('subject')).toBe('Planning do time')
    expect(url.searchParams.get('startdt')).toBe('2026-07-30T17:00:00.000Z')
    expect(url.searchParams.get('enddt')).toBe('2026-07-30T18:00:00.000Z')
  })
})

describe('buildMeetingIcs', () => {
  const ics = buildMeetingIcs(meeting, new Date('2026-07-29T12:00:00.000Z'))

  it('emite um VEVENT completo com UID estável e METHOD:REQUEST', () => {
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('METHOD:REQUEST')
    expect(ics).toContain('UID:mtg1@legends.eumedicoresidente.com.br')
    expect(ics).toContain('SEQUENCE:0')
    expect(ics).toContain('DTSTAMP:20260729T120000Z')
    expect(ics).toContain('DTSTART:20260730T170000Z')
    expect(ics).toContain('DTEND:20260730T180000Z')
    expect(ics).toContain('STATUS:CONFIRMED')
    expect(ics).toContain('ORGANIZER;CN=Ana:mailto:ana@x.com')
    expect(ics).toContain('ATTENDEE;CN=Bruno;RSVP=TRUE:mailto:bruno@x.com')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('escapa ponto-e-vírgula e vírgula do texto livre', () => {
    expect(ics).toContain('Fechar escopo\\; revisar riscos')
  })

  it('separa linhas com CRLF e dobra as maiores que 75 octetos', () => {
    const lines = ics.split('\r\n')
    expect(lines.length).toBeGreaterThan(10)
    for (const line of lines) {
      expect(Buffer.from(line, 'utf8').length).toBeLessThanOrEqual(75)
    }
    // Continuação de linha dobrada começa com um espaço.
    expect(ics).toMatch(/\r\n /)
  })

  it('põe entre aspas o CN com vírgula ou ponto-e-vírgula, sem barra invertida', () => {
    const comPontuacao = buildMeetingIcs(
      {
        ...meeting,
        organizer: { name: 'Silva, João', email: 'ana@x.com' },
        participants: [{ name: 'Souza; Maria', email: 'bruno@x.com' }],
      },
      new Date('2026-07-29T12:00:00.000Z'),
    )
    expect(comPontuacao).toContain('ORGANIZER;CN="Silva, João":mailto:ana@x.com')
    expect(comPontuacao).toContain('ATTENDEE;CN="Souza; Maria";RSVP=TRUE:mailto:bruno@x.com')
    expect(comPontuacao).not.toContain('\\,')
  })

  it('cancelada vira METHOD:CANCEL com STATUS:CANCELLED', () => {
    const canceled = buildMeetingIcs({ ...meeting, canceled: true, sequence: 1 }, new Date('2026-07-29T12:00:00.000Z'))
    expect(canceled).toContain('METHOD:CANCEL')
    expect(canceled).toContain('STATUS:CANCELLED')
    expect(canceled).toContain('SEQUENCE:1')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Comando: `pnpm --filter @legends/api exec vitest run src/lib/calendar-export.test.ts`
Esperado: FAIL — `Cannot find module './calendar-export'`.

- [ ] **Step 3: Implementar**

`apps/api/src/lib/calendar-export.ts`:

```ts
/**
 * Exportação de uma reunião para as agendas externas. Três destinos, um
 * formato cada, todos puros (sem I/O, sem Prisma) — é o único lugar do repo
 * que conhece o formato do iCalendar e das URLs de template.
 */
import { officeRoomDeepLinkPath } from '@legends/shared'
import { absoluteUrl } from './app-url'

export interface CalendarMeeting {
  id: string
  title: string
  agenda: string | null
  roomName: string
  roomExternalKey: string
  startsAt: Date
  endsAt: Date
  sequence: number
  canceled: boolean
  organizer: { name: string; email: string }
  participants: Array<{ name: string; email: string }>
}

const CRLF = '\r\n'
const UID_DOMAIN = 'legends.eumedicoresidente.com.br'

/** `2026-07-30T17:00:00.000Z` → `20260730T170000Z`. */
function icsUtc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`
}

/** Escaping de texto livre do RFC 5545: `\`, `;`, `,` e quebra de linha. */
function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/**
 * Valor de PARÂMETRO (ex.: `CN=`) segue outra regra que o texto livre: a
 * RFC 5545 §3.2 não aceita barra invertida em `paramtext` — valor com `,`,
 * `;`, `:` ou aspas precisa vir como quoted-string. Aspas dentro do valor não
 * têm escape possível na RFC, então são removidas antes de envolver.
 */
function icsParameterValue(value: string): string {
  const limpo = value.replace(/"/g, '')
  return /[,;:]/.test(limpo) || limpo !== value ? `"${limpo}"` : limpo
}

/**
 * Folding do RFC 5545: nenhuma linha passa de 75 octetos; a continuação
 * começa com um espaço. Corta em fronteira de code point pra não partir
 * caractere multibyte (acento, emoji) no meio.
 */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let start = 0
  let limit = 75
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1
    parts.push(bytes.subarray(start, end).toString('utf8'))
    start = end
    limit = 74 // as seguintes perdem 1 octeto para o espaço inicial
  }
  return parts.join(`${CRLF} `)
}

/** Endereço público da sala — o que o convite abre. */
function meetingUrl(meeting: CalendarMeeting): string {
  return absoluteUrl(officeRoomDeepLinkPath(meeting.roomExternalKey))
}

function meetingLocation(meeting: CalendarMeeting): string {
  return `Sala ${meeting.roomName} — Legends`
}

/** Corpo em texto: pauta (se houver) + link da sala. */
function meetingDescription(meeting: CalendarMeeting): string {
  const url = meetingUrl(meeting)
  return meeting.agenda ? `${meeting.agenda}\n\nEntrar na sala: ${url}` : `Entrar na sala: ${url}`
}

export function buildGoogleCalendarUrl(meeting: CalendarMeeting): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: meeting.title,
    dates: `${icsUtc(meeting.startsAt)}/${icsUtc(meeting.endsAt)}`,
    details: meetingDescription(meeting),
    location: meetingLocation(meeting),
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function buildOutlookCalendarUrl(meeting: CalendarMeeting): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: meeting.title,
    startdt: meeting.startsAt.toISOString(),
    enddt: meeting.endsAt.toISOString(),
    body: meetingDescription(meeting),
    location: meetingLocation(meeting),
  })
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`
}

/**
 * Arquivo iCalendar da reunião. É o que coloca o evento no Outlook/Teams.
 * O UID é estável por reunião e o SEQUENCE sobe a cada edição — sem isso o
 * cliente de calendário ignora a atualização e o convidado fica com o
 * horário velho.
 */
export function buildMeetingIcs(meeting: CalendarMeeting, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Legends//Escritorio//PT-BR',
    'CALSCALE:GREGORIAN',
    `METHOD:${meeting.canceled ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:${meeting.id}@${UID_DOMAIN}`,
    `SEQUENCE:${meeting.sequence}`,
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsUtc(meeting.startsAt)}`,
    `DTEND:${icsUtc(meeting.endsAt)}`,
    `SUMMARY:${icsEscape(meeting.title)}`,
    `DESCRIPTION:${icsEscape(meetingDescription(meeting))}`,
    `LOCATION:${icsEscape(meetingLocation(meeting))}`,
    `URL:${meetingUrl(meeting)}`,
    `STATUS:${meeting.canceled ? 'CANCELLED' : 'CONFIRMED'}`,
    `ORGANIZER;CN=${icsParameterValue(meeting.organizer.name)}:mailto:${meeting.organizer.email}`,
    ...meeting.participants.map(
      (p) => `ATTENDEE;CN=${icsParameterValue(p.name)};RSVP=TRUE:mailto:${p.email}`,
    ),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${lines.map(foldLine).join(CRLF)}${CRLF}`
}
```

- [ ] **Step 4: Rodar e ver passar**

Comando: `pnpm --filter @legends/api exec vitest run src/lib/calendar-export.test.ts`
Esperado: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/calendar-export.ts apps/api/src/lib/calendar-export.test.ts
git commit -m "feat: exportação de reunião para .ics, Google Calendar e Outlook"
```

---

### Task 4: Serialização do DTO

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`
- Modify: `apps/api/src/lib/serialize.test.ts`

**Interfaces:**
- Consumes: `OfficeMeetingDTO` (Task 1); `buildGoogleCalendarUrl`, `buildOutlookCalendarUrl`, `CalendarMeeting` (Task 3).
- Produces: `MeetingWithPeople` (tipo do payload Prisma) e `toOfficeMeetingDTO(meeting): OfficeMeetingDTO`; `toCalendarMeeting(meeting): CalendarMeeting`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `apps/api/src/lib/serialize.test.ts`:

```ts
describe('toOfficeMeetingDTO', () => {
  const meeting = {
    id: 'mtg1',
    companyId: 'company-emr',
    roomExternalKey: 'aurora',
    roomName: 'Aurora',
    title: 'Planning',
    agenda: null,
    startsAt: new Date('2026-07-30T17:00:00.000Z'),
    endsAt: new Date('2026-07-30T18:00:00.000Z'),
    organizerId: 'u1',
    canceledAt: null,
    sequence: 0,
    remindedAt: null,
    createdAt: new Date('2026-07-29T10:00:00.000Z'),
    updatedAt: new Date('2026-07-29T10:00:00.000Z'),
    organizer: { id: 'u1', name: 'Ana', email: 'ana@x.com' },
    participants: [{ user: { id: 'u2', name: 'Bruno', email: 'bruno@x.com' } }],
  }

  it('devolve datas ISO, pessoas enxutas e links de calendário prontos', () => {
    const dto = toOfficeMeetingDTO(meeting)
    expect(dto.startsAt).toBe('2026-07-30T17:00:00.000Z')
    expect(dto.canceled).toBe(false)
    expect(dto.organizer).toEqual({ id: 'u1', name: 'Ana' })
    expect(dto.participants).toEqual([{ id: 'u2', name: 'Bruno' }])
    expect(dto.googleCalendarUrl).toContain('calendar.google.com')
    expect(dto.outlookCalendarUrl).toContain('outlook.office.com')
    expect(dto.icsPath).toBe('/office/meetings/mtg1/ics')
  })

  it('marca canceled quando há canceledAt', () => {
    expect(toOfficeMeetingDTO({ ...meeting, canceledAt: new Date() }).canceled).toBe(true)
  })
})
```

O import do topo do arquivo ganha `toOfficeMeetingDTO`.

- [ ] **Step 2: Rodar e ver falhar**

Comando: `pnpm --filter @legends/api exec vitest run src/lib/serialize.test.ts`
Esperado: FAIL — `toOfficeMeetingDTO is not exported`.

- [ ] **Step 3: Implementar**

No fim de `apps/api/src/lib/serialize.ts` (e acrescentando `type OfficeMeetingDTO` ao import de `@legends/shared`):

```ts
/** Payload mínimo que o DTO de reunião precisa carregar do Prisma. */
export interface MeetingWithPeople {
  id: string
  roomExternalKey: string
  roomName: string
  title: string
  agenda: string | null
  startsAt: Date
  endsAt: Date
  sequence: number
  canceledAt: Date | null
  organizer: { id: string; name: string; email: string }
  participants: Array<{ user: { id: string; name: string; email: string } }>
}

/** Forma que `lib/calendar-export.ts` consome (precisa dos e-mails). */
export function toCalendarMeeting(meeting: MeetingWithPeople): CalendarMeeting {
  return {
    id: meeting.id,
    title: meeting.title,
    agenda: meeting.agenda,
    roomName: meeting.roomName,
    roomExternalKey: meeting.roomExternalKey,
    startsAt: meeting.startsAt,
    endsAt: meeting.endsAt,
    sequence: meeting.sequence,
    canceled: meeting.canceledAt !== null,
    organizer: { name: meeting.organizer.name, email: meeting.organizer.email },
    participants: meeting.participants.map((p) => ({ name: p.user.name, email: p.user.email })),
  }
}

/** Entidade Prisma → DTO público. E-mail nunca sai daqui. */
export function toOfficeMeetingDTO(meeting: MeetingWithPeople): OfficeMeetingDTO {
  const calendar = toCalendarMeeting(meeting)
  return {
    id: meeting.id,
    roomExternalKey: meeting.roomExternalKey,
    roomName: meeting.roomName,
    title: meeting.title,
    agenda: meeting.agenda,
    startsAt: meeting.startsAt.toISOString(),
    endsAt: meeting.endsAt.toISOString(),
    canceled: meeting.canceledAt !== null,
    organizer: { id: meeting.organizer.id, name: meeting.organizer.name },
    participants: meeting.participants.map((p) => ({ id: p.user.id, name: p.user.name })),
    googleCalendarUrl: buildGoogleCalendarUrl(calendar),
    outlookCalendarUrl: buildOutlookCalendarUrl(calendar),
    icsPath: `/office/meetings/${meeting.id}/ics`,
  }
}
```

Imports novos no topo do arquivo:

```ts
import { buildGoogleCalendarUrl, buildOutlookCalendarUrl, type CalendarMeeting } from './calendar-export'
```

- [ ] **Step 4: Rodar e ver passar**

Comando: `pnpm --filter @legends/api exec vitest run src/lib/serialize.test.ts`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/lib/serialize.test.ts
git commit -m "feat: serialização do DTO de reunião de sala"
```

---

### Task 5: Service — criar, listar e detectar conflito

**Files:**
- Create: `apps/api/src/services/office-meeting-service.ts`
- Create: `apps/api/src/services/office-meeting-service.test.ts`
- Modify: `apps/api/src/services/notification-service.ts` (emojis dos tipos novos)

**Interfaces:**
- Consumes: `scopedPrisma`, `toOfficeMeetingDTO`, `createNotification`, `officeRoomDeepLinkPath`, `getActiveOfficeMap`.
- Produces:
  - `class OfficeMeetingError extends Error { status: number }`
  - `class OfficeMeetingConflictError extends Error { status: 409; conflicts: OfficeMeetingDTO[] }`
  - `createOfficeMeeting(input: CreateMeetingInput): Promise<OfficeMeetingDTO>` com `CreateMeetingInput = { companyId, organizerId, roomExternalKey, title, agenda, startsAt: Date, durationMinutes, participantIds, force }`
  - `listRoomMeetings(companyId, roomExternalKey, from: Date, to: Date): Promise<OfficeMeetingDTO[]>`
  - `MEETING_INCLUDE` (objeto `include` reaproveitado pelas outras tasks)

- [ ] **Step 1: Escrever os testes que falham**

`apps/api/src/services/office-meeting-service.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { DEFAULT_COMPANY_ID, createEmptyMapDocumentV1 } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  OfficeMeetingConflictError,
  OfficeMeetingError,
  createOfficeMeeting,
  listRoomMeetings,
} from './office-meeting-service'

/**
 * Mapa ativo com uma sala 'aurora' — o service valida que a sala existe.
 * `getActiveOfficeMap` lê as salas da **tabela `OfficeRoom`**, não do JSON do
 * documento (quem materializa uma na outra é o `publishMap`, que não roda
 * aqui). Por isso a linha de `officeRoom` é criada à mão, no mesmo padrão do
 * `seedRoomAndDesk` de `office-map-service.test.ts`.
 */
async function seedMapWithRoom() {
  const document = createEmptyMapDocumentV1({ width: 25, height: 18, tileSize: 32 })
  const map = await prisma.officeMap.create({ data: { name: 'Mapa', companyId: DEFAULT_COMPANY_ID } })
  const publication = await prisma.officeMapPublication.create({
    data: {
      mapId: map.id,
      version: 1,
      schemaVersion: document.schemaVersion,
      mapData: document as unknown as Prisma.InputJsonValue,
      companyId: DEFAULT_COMPANY_ID,
    },
  })
  await prisma.officeRoom.create({
    data: {
      mapPublicationId: publication.id,
      name: 'Aurora',
      externalKey: 'aurora',
      companyId: DEFAULT_COMPANY_ID,
    },
  })
  await prisma.officeSetting.create({ data: { companyId: DEFAULT_COMPANY_ID, activeMapPublicationId: publication.id } })
}

async function makeUser(name: string) {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
  })
}

const BASE = {
  roomExternalKey: 'aurora',
  title: 'Planning',
  agenda: null as string | null,
  durationMinutes: 60 as const,
  force: false,
}

beforeEach(seedMapWithRoom)

describe('createOfficeMeeting', () => {
  it('cria a reunião com participantes e notifica cada convidado', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')

    const dto = await createOfficeMeeting({
      ...BASE,
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'),
      participantIds: [bruno.id],
    })

    expect(dto.title).toBe('Planning')
    expect(dto.roomName).toBe('Aurora')
    expect(dto.endsAt).toBe('2099-01-10T15:00:00.000Z')
    expect(dto.participants).toEqual([{ id: bruno.id, name: 'Bruno' }])

    const notifications = await prisma.notification.findMany({ where: { userId: bruno.id } })
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.type).toBe('MEETING_INVITED')
    expect(notifications[0]!.link).toBe('/escritorio?sala=aurora')
  })

  it('recusa sala que não existe no mapa ativo', async () => {
    const ana = await makeUser('Ana')
    await expect(
      createOfficeMeeting({
        ...BASE,
        roomExternalKey: 'inexistente',
        companyId: DEFAULT_COMPANY_ID,
        organizerId: ana.id,
        startsAt: new Date('2099-01-10T14:00:00.000Z'),
        participantIds: [],
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('recusa horário no passado', async () => {
    const ana = await makeUser('Ana')
    await expect(
      createOfficeMeeting({
        ...BASE,
        companyId: DEFAULT_COMPANY_ID,
        organizerId: ana.id,
        startsAt: new Date('2020-01-10T14:00:00.000Z'),
        participantIds: [],
      }),
    ).rejects.toBeInstanceOf(OfficeMeetingError)
  })

  it('recusa participante de outra empresa', async () => {
    const ana = await makeUser('Ana')
    const outra = await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'company-outra' } })
    const forasteiro = await prisma.user.create({
      data: { name: 'Zé', email: 'ze@y.com', passwordHash: 'x', role: 'LEGEND', companyId: outra.id },
    })
    await expect(
      createOfficeMeeting({
        ...BASE,
        companyId: DEFAULT_COMPANY_ID,
        organizerId: ana.id,
        startsAt: new Date('2099-01-10T14:00:00.000Z'),
        participantIds: [forasteiro.id],
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('barra horário sobreposto na mesma sala com 409 e lista o conflito', async () => {
    const ana = await makeUser('Ana')
    await createOfficeMeeting({
      ...BASE,
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'),
      participantIds: [],
    })

    const overlapping = createOfficeMeeting({
      ...BASE,
      title: 'Outra',
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:30:00.000Z'),
      participantIds: [],
    })

    await expect(overlapping).rejects.toBeInstanceOf(OfficeMeetingConflictError)
    await overlapping.catch((err: OfficeMeetingConflictError) => {
      expect(err.conflicts).toHaveLength(1)
      expect(err.conflicts[0]!.title).toBe('Planning')
    })
  })

  it('encostar sem sobrepor não é conflito', async () => {
    const ana = await makeUser('Ana')
    await createOfficeMeeting({
      ...BASE,
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'),
      participantIds: [],
    })
    const encostada = await createOfficeMeeting({
      ...BASE,
      title: 'Logo depois',
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T15:00:00.000Z'),
      participantIds: [],
    })
    expect(encostada.title).toBe('Logo depois')
  })

  it('force ignora o conflito', async () => {
    const ana = await makeUser('Ana')
    await createOfficeMeeting({
      ...BASE,
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'),
      participantIds: [],
    })
    const forcada = await createOfficeMeeting({
      ...BASE,
      title: 'Forçada',
      force: true,
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:30:00.000Z'),
      participantIds: [],
    })
    expect(forcada.title).toBe('Forçada')
  })
})

describe('listRoomMeetings', () => {
  it('devolve só as da sala e da janela pedida, em ordem cronológica', async () => {
    const ana = await makeUser('Ana')
    const dentro = await createOfficeMeeting({
      ...BASE,
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'),
      participantIds: [],
    })
    await createOfficeMeeting({
      ...BASE,
      title: 'Muito depois',
      companyId: DEFAULT_COMPANY_ID,
      organizerId: ana.id,
      startsAt: new Date('2099-03-10T14:00:00.000Z'),
      participantIds: [],
    })

    const lista = await listRoomMeetings(
      DEFAULT_COMPANY_ID,
      'aurora',
      new Date('2099-01-01T00:00:00.000Z'),
      new Date('2099-01-31T00:00:00.000Z'),
    )
    expect(lista.map((m) => m.id)).toEqual([dentro.id])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Comando: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/office-meeting-service.test.ts`
Esperado: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar o service**

`apps/api/src/services/office-meeting-service.ts`:

```ts
/**
 * Reuniões marcadas em salas do escritório. A sala é identificada por
 * `(companyId, roomExternalKey)`, nunca por `OfficeRoom.id`: aquelas linhas são
 * recriadas a cada publicação de mapa (ver office-map-service.publishMap), e uma
 * FK morreria no primeiro publish.
 *
 * Reserva é leve: conflito de horário vira 409 informativo, e o chamador decide
 * marcar mesmo assim com `force`. Nada aqui altera status ou accessPolicy da sala.
 */
import {
  MEETING_AGENDA_MAX_LENGTH,
  MEETING_TITLE_MAX_LENGTH,
  officeRoomDeepLinkPath,
  type MeetingDurationMinutes,
  type OfficeMeetingDTO,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { toOfficeMeetingDTO, type MeetingWithPeople } from '../lib/serialize'
import { createNotification } from './notification-service'
import { getActiveOfficeMap } from './office-map-service'

export class OfficeMeetingError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
    this.name = 'OfficeMeetingError'
  }
}

/** 409 com a lista do que colide — o front oferece "marcar mesmo assim". */
export class OfficeMeetingConflictError extends Error {
  public status = 409
  constructor(public conflicts: OfficeMeetingDTO[]) {
    super('A sala já tem reunião marcada nesse horário')
    this.name = 'OfficeMeetingConflictError'
  }
}

export const MEETING_INCLUDE = {
  organizer: { select: { id: true, name: true, email: true } },
  participants: { include: { user: { select: { id: true, name: true, email: true } } } },
} as const

export interface CreateMeetingInput {
  companyId: string
  organizerId: string
  roomExternalKey: string
  title: string
  agenda: string | null
  startsAt: Date
  durationMinutes: MeetingDurationMinutes
  participantIds: string[]
  force?: boolean
}

function endFrom(startsAt: Date, durationMinutes: number): Date {
  return new Date(startsAt.getTime() + durationMinutes * 60_000)
}

/** Nome da sala no mapa ativo. Sala que não existe lá é 404. */
async function resolveRoomName(companyId: string, roomExternalKey: string): Promise<string> {
  const active = await getActiveOfficeMap(companyId)
  const room = active.rooms.find((r) => r.externalKey === roomExternalKey)
  if (!room) throw new OfficeMeetingError('Sala não encontrada no mapa ativo', 404)
  return room.name
}

function assertTexts(title: string, agenda: string | null): void {
  if (title.trim().length === 0) throw new OfficeMeetingError('Informe um título para a reunião')
  if (title.length > MEETING_TITLE_MAX_LENGTH) throw new OfficeMeetingError('Título muito longo')
  if (agenda && agenda.length > MEETING_AGENDA_MAX_LENGTH) throw new OfficeMeetingError('Pauta muito longa')
}

/** Participantes precisam existir e ser da mesma empresa. */
async function assertParticipants(companyId: string, participantIds: string[]): Promise<void> {
  if (participantIds.length === 0) return
  const db = scopedPrisma(companyId)
  const found = await db.user.findMany({ where: { id: { in: participantIds } }, select: { id: true } })
  if (found.length !== new Set(participantIds).size) {
    throw new OfficeMeetingError('Participante inválido')
  }
}

/**
 * Reuniões não canceladas da sala que se sobrepõem à janela. Sobreposição é
 * estrita (`início < fimNovo && fim > inícioNovo`): reunião que começa
 * exatamente quando a outra acaba não conflita.
 */
async function findConflicts(
  companyId: string,
  roomExternalKey: string,
  startsAt: Date,
  endsAt: Date,
  ignoreMeetingId?: string,
): Promise<OfficeMeetingDTO[]> {
  const db = scopedPrisma(companyId)
  const rows = await db.officeMeeting.findMany({
    where: {
      roomExternalKey,
      canceledAt: null,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(ignoreMeetingId ? { id: { not: ignoreMeetingId } } : {}),
    },
    include: MEETING_INCLUDE,
    orderBy: { startsAt: 'asc' },
  })
  return rows.map((row) => toOfficeMeetingDTO(row as MeetingWithPeople))
}

/** Notifica convidados (e, em update/cancel, também o organizador). */
async function notifyPeople(
  userIds: string[],
  companyId: string,
  actorId: string,
  type: 'MEETING_INVITED' | 'MEETING_UPDATED' | 'MEETING_CANCELED' | 'MEETING_REMINDER',
  title: string,
  roomExternalKey: string,
): Promise<void> {
  for (const userId of userIds) {
    try {
      await createNotification({
        userId,
        type,
        title,
        actorId,
        link: officeRoomDeepLinkPath(roomExternalKey),
        companyId,
      })
    } catch (err) {
      // Best-effort, igual ao resto do office: a reunião já está persistida.
      console.error(`[office-meeting] falha ao notificar ${userId}`, err)
    }
  }
}

function meetingWhen(startsAt: Date): string {
  return startsAt.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export async function createOfficeMeeting(input: CreateMeetingInput): Promise<OfficeMeetingDTO> {
  assertTexts(input.title, input.agenda)
  if (input.startsAt.getTime() <= Date.now()) {
    throw new OfficeMeetingError('Escolha um horário no futuro')
  }
  const roomName = await resolveRoomName(input.companyId, input.roomExternalKey)
  await assertParticipants(input.companyId, input.participantIds)

  const endsAt = endFrom(input.startsAt, input.durationMinutes)
  if (!input.force) {
    const conflicts = await findConflicts(input.companyId, input.roomExternalKey, input.startsAt, endsAt)
    if (conflicts.length > 0) throw new OfficeMeetingConflictError(conflicts)
  }

  const db = scopedPrisma(input.companyId)
  const created = await db.officeMeeting.create({
    data: {
      roomExternalKey: input.roomExternalKey,
      roomName,
      title: input.title.trim(),
      agenda: input.agenda?.trim() || null,
      startsAt: input.startsAt,
      endsAt,
      organizerId: input.organizerId,
      participants: { create: input.participantIds.map((userId) => ({ userId })) },
    },
    include: MEETING_INCLUDE,
  })

  const dto = toOfficeMeetingDTO(created as MeetingWithPeople)
  await notifyPeople(
    input.participantIds,
    input.companyId,
    input.organizerId,
    'MEETING_INVITED',
    `${created.organizer.name} marcou "${dto.title}" na sala ${roomName} em ${meetingWhen(created.startsAt)}`,
    input.roomExternalKey,
  )
  return dto
}

/** Agenda da sala numa janela — inclui canceladas, que o front mostra riscadas. */
export async function listRoomMeetings(
  companyId: string,
  roomExternalKey: string,
  from: Date,
  to: Date,
): Promise<OfficeMeetingDTO[]> {
  const db = scopedPrisma(companyId)
  const rows = await db.officeMeeting.findMany({
    where: { roomExternalKey, startsAt: { gte: from, lt: to } },
    include: MEETING_INCLUDE,
    orderBy: { startsAt: 'asc' },
  })
  return rows.map((row) => toOfficeMeetingDTO(row as MeetingWithPeople))
}
```

- [ ] **Step 4: Registrar os emojis dos tipos novos**

Em `apps/api/src/services/notification-service.ts`, dentro do `map` de `emojiForNotificationType`, depois de `VOTE_REMINDER_CLOSING`:

```ts
    MEETING_INVITED: '📅',
    MEETING_UPDATED: '📅',
    MEETING_CANCELED: '🚫',
    MEETING_REMINDER: '⏰',
```

- [ ] **Step 5: Rodar e ver passar**

Comando: `pnpm --filter @legends/api exec vitest run src/services/office-meeting-service.test.ts`
Esperado: PASS (8 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/office-meeting-service.ts apps/api/src/services/office-meeting-service.test.ts apps/api/src/services/notification-service.ts
git commit -m "feat: service de reunião de sala com detecção de conflito"
```

---

### Task 6: Service — editar, cancelar e gerar o `.ics`

**Files:**
- Modify: `apps/api/src/services/office-meeting-service.ts`
- Modify: `apps/api/src/services/office-meeting-service.test.ts`

**Interfaces:**
- Consumes: `MEETING_INCLUDE`, `OfficeMeetingError`, `OfficeMeetingConflictError`, `findConflicts`, `notifyPeople` (Task 5); `buildMeetingIcs`, `toCalendarMeeting` (Tasks 3–4).
- Produces:
  - `updateOfficeMeeting(meetingId, userId, companyId, patch: UpdateMeetingPatch): Promise<OfficeMeetingDTO>` com `UpdateMeetingPatch = { title?, agenda?, startsAt?: Date, durationMinutes?, participantIds?, force? }`
  - `cancelOfficeMeeting(meetingId, userId, companyId): Promise<OfficeMeetingDTO>`
  - `buildMeetingIcsFor(meetingId, userId, companyId): Promise<{ filename: string; ics: string }>`

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar em `apps/api/src/services/office-meeting-service.test.ts`:

```ts
describe('updateOfficeMeeting', () => {
  it('só o organizador edita', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const dto = await createOfficeMeeting({
      ...BASE, companyId: DEFAULT_COMPANY_ID, organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'), participantIds: [bruno.id],
    })
    await expect(
      updateOfficeMeeting(dto.id, bruno.id, DEFAULT_COMPANY_ID, { title: 'Sequestrada' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('muda o horário, sobe o sequence e notifica os participantes', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const dto = await createOfficeMeeting({
      ...BASE, companyId: DEFAULT_COMPANY_ID, organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'), participantIds: [bruno.id],
    })

    const updated = await updateOfficeMeeting(dto.id, ana.id, DEFAULT_COMPANY_ID, {
      startsAt: new Date('2099-01-10T16:00:00.000Z'),
    })

    expect(updated.startsAt).toBe('2099-01-10T16:00:00.000Z')
    expect(updated.endsAt).toBe('2099-01-10T17:00:00.000Z')
    const row = await prisma.officeMeeting.findUniqueOrThrow({ where: { id: dto.id } })
    expect(row.sequence).toBe(1)
    // remindedAt zera: o lembrete do horário antigo não vale mais.
    expect(row.remindedAt).toBeNull()
    const notifications = await prisma.notification.findMany({ where: { userId: bruno.id, type: 'MEETING_UPDATED' } })
    expect(notifications).toHaveLength(1)
  })

  it('reunião de outra empresa é 404', async () => {
    const ana = await makeUser('Ana')
    const dto = await createOfficeMeeting({
      ...BASE, companyId: DEFAULT_COMPANY_ID, organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'), participantIds: [],
    })
    await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'company-outra' } })
    await expect(
      updateOfficeMeeting(dto.id, ana.id, 'company-outra', { title: 'X' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('cancelOfficeMeeting', () => {
  it('marca canceledAt, notifica e recusa cancelar duas vezes', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const dto = await createOfficeMeeting({
      ...BASE, companyId: DEFAULT_COMPANY_ID, organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'), participantIds: [bruno.id],
    })

    const canceled = await cancelOfficeMeeting(dto.id, ana.id, DEFAULT_COMPANY_ID)
    expect(canceled.canceled).toBe(true)
    const notifications = await prisma.notification.findMany({ where: { userId: bruno.id, type: 'MEETING_CANCELED' } })
    expect(notifications).toHaveLength(1)

    await expect(cancelOfficeMeeting(dto.id, ana.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 409 })
  })
})

describe('buildMeetingIcsFor', () => {
  it('entrega o arquivo ao participante e barra quem não foi convidado', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const carla = await makeUser('Carla')
    const dto = await createOfficeMeeting({
      ...BASE, companyId: DEFAULT_COMPANY_ID, organizerId: ana.id,
      startsAt: new Date('2099-01-10T14:00:00.000Z'), participantIds: [bruno.id],
    })

    const { filename, ics } = await buildMeetingIcsFor(dto.id, bruno.id, DEFAULT_COMPANY_ID)
    expect(filename).toBe('planning.ics')
    expect(ics).toContain('BEGIN:VCALENDAR')

    await expect(buildMeetingIcsFor(dto.id, carla.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 403 })
  })
})
```

Acrescentar `updateOfficeMeeting`, `cancelOfficeMeeting` e `buildMeetingIcsFor` ao import do topo do arquivo de teste.

- [ ] **Step 2: Rodar e ver falhar**

Comando: `pnpm --filter @legends/api exec vitest run src/services/office-meeting-service.test.ts`
Esperado: FAIL — funções não exportadas.

- [ ] **Step 3: Implementar**

Acrescentar ao fim de `apps/api/src/services/office-meeting-service.ts`:

```ts
export interface UpdateMeetingPatch {
  title?: string
  agenda?: string | null
  startsAt?: Date
  durationMinutes?: MeetingDurationMinutes
  participantIds?: string[]
  force?: boolean
}

/** Carrega a reunião no escopo da empresa. Fora do escopo = 404, nunca 403. */
async function loadMeeting(meetingId: string, companyId: string) {
  const db = scopedPrisma(companyId)
  const meeting = await db.officeMeeting.findUnique({ where: { id: meetingId }, include: MEETING_INCLUDE })
  if (!meeting) throw new OfficeMeetingError('Reunião não encontrada', 404)
  return meeting
}

export async function updateOfficeMeeting(
  meetingId: string,
  userId: string,
  companyId: string,
  patch: UpdateMeetingPatch,
): Promise<OfficeMeetingDTO> {
  const meeting = await loadMeeting(meetingId, companyId)
  if (meeting.organizerId !== userId) {
    throw new OfficeMeetingError('Só quem marcou pode editar a reunião', 403)
  }
  if (meeting.canceledAt) throw new OfficeMeetingError('Reunião já cancelada', 409)

  const title = patch.title ?? meeting.title
  const agenda = patch.agenda === undefined ? meeting.agenda : patch.agenda
  assertTexts(title, agenda)

  const startsAt = patch.startsAt ?? meeting.startsAt
  const durationMinutes =
    patch.durationMinutes ?? Math.round((meeting.endsAt.getTime() - meeting.startsAt.getTime()) / 60_000)
  const endsAt = endFrom(startsAt, durationMinutes)

  const horarioMudou = startsAt.getTime() !== meeting.startsAt.getTime() || endsAt.getTime() !== meeting.endsAt.getTime()
  if (horarioMudou && startsAt.getTime() <= Date.now()) {
    throw new OfficeMeetingError('Escolha um horário no futuro')
  }
  if (horarioMudou && !patch.force) {
    const conflicts = await findConflicts(companyId, meeting.roomExternalKey, startsAt, endsAt, meeting.id)
    if (conflicts.length > 0) throw new OfficeMeetingConflictError(conflicts)
  }

  if (patch.participantIds) await assertParticipants(companyId, patch.participantIds)

  const db = scopedPrisma(companyId)
  const updated = await db.officeMeeting.update({
    where: { id: meeting.id },
    data: {
      title: title.trim(),
      agenda: agenda?.trim() || null,
      startsAt,
      endsAt,
      sequence: { increment: 1 },
      // Horário novo, lembrete novo — o do horário antigo não vale mais.
      ...(horarioMudou ? { remindedAt: null } : {}),
      ...(patch.participantIds
        ? {
            participants: {
              deleteMany: {},
              create: patch.participantIds.map((id) => ({ userId: id })),
            },
          }
        : {}),
    },
    include: MEETING_INCLUDE,
  })

  const dto = toOfficeMeetingDTO(updated as MeetingWithPeople)
  await notifyPeople(
    dto.participants.map((p) => p.id),
    companyId,
    userId,
    'MEETING_UPDATED',
    `"${dto.title}" mudou: agora é ${meetingWhen(updated.startsAt)} na sala ${dto.roomName}`,
    dto.roomExternalKey,
  )
  return dto
}

export async function cancelOfficeMeeting(
  meetingId: string,
  userId: string,
  companyId: string,
): Promise<OfficeMeetingDTO> {
  const meeting = await loadMeeting(meetingId, companyId)
  if (meeting.organizerId !== userId) {
    throw new OfficeMeetingError('Só quem marcou pode cancelar a reunião', 403)
  }
  if (meeting.canceledAt) throw new OfficeMeetingError('Reunião já cancelada', 409)

  const db = scopedPrisma(companyId)
  const canceled = await db.officeMeeting.update({
    where: { id: meeting.id },
    data: { canceledAt: new Date(), sequence: { increment: 1 } },
    include: MEETING_INCLUDE,
  })

  const dto = toOfficeMeetingDTO(canceled as MeetingWithPeople)
  await notifyPeople(
    dto.participants.map((p) => p.id),
    companyId,
    userId,
    'MEETING_CANCELED',
    `"${dto.title}" na sala ${dto.roomName} foi cancelada`,
    dto.roomExternalKey,
  )
  return dto
}

/** Nome de arquivo amigável a partir do título. */
function icsFilename(title: string): string {
  const slug =
    title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'reuniao'
  return `${slug}.ics`
}

/** Só organizador e convidados baixam o .ics. */
export async function buildMeetingIcsFor(
  meetingId: string,
  userId: string,
  companyId: string,
): Promise<{ filename: string; ics: string }> {
  const meeting = await loadMeeting(meetingId, companyId)
  const convidado = meeting.participants.some((p) => p.userId === userId)
  if (meeting.organizerId !== userId && !convidado) {
    throw new OfficeMeetingError('Você não participa desta reunião', 403)
  }
  return {
    filename: icsFilename(meeting.title),
    ics: buildMeetingIcs(toCalendarMeeting(meeting as MeetingWithPeople)),
  }
}
```

Ajustar os imports do topo do arquivo:

```ts
import { toCalendarMeeting, toOfficeMeetingDTO, type MeetingWithPeople } from '../lib/serialize'
import { buildMeetingIcs } from '../lib/calendar-export'
```

- [ ] **Step 4: Rodar e ver passar**

Comando: `pnpm --filter @legends/api exec vitest run src/services/office-meeting-service.test.ts`
Esperado: PASS (13 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/office-meeting-service.ts apps/api/src/services/office-meeting-service.test.ts
git commit -m "feat: editar, cancelar e exportar .ics da reunião de sala"
```

---

### Task 7: Rotas HTTP

**Files:**
- Create: `apps/api/src/routes/office-meetings.ts`
- Create: `apps/api/src/routes/office-meetings.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: tudo de Tasks 5–6.
- Produces: `officeMeetingRoutes(app)` registrado em `buildApp`; endpoints `POST /office/meetings`, `GET /office/meetings`, `PATCH /office/meetings/:id`, `DELETE /office/meetings/:id`, `GET /office/meetings/:id/ics`.

- [ ] **Step 1: Escrever os testes que falham**

`apps/api/src/routes/office-meetings.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { DEFAULT_COMPANY_ID, createEmptyMapDocumentV1 } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

beforeEach(async () => {
  const document = createEmptyMapDocumentV1({ width: 25, height: 18, tileSize: 32 })
  document.objects.push({
    id: 'room-aurora',
    type: 'meeting-room',
    geometry: { kind: 'rectangle', x: 64, y: 64, width: 160, height: 128 },
    properties: { externalKey: 'aurora', name: 'Aurora', status: 'OPEN', voiceEnabled: true, accessPolicy: 'OPEN' },
  } as never)
  const map = await prisma.officeMap.create({ data: { name: 'Mapa', companyId: DEFAULT_COMPANY_ID } })
  const publication = await prisma.officeMapPublication.create({
    data: {
      mapId: map.id, version: 1, schemaVersion: document.schemaVersion,
      mapData: document as unknown as Prisma.InputJsonValue, companyId: DEFAULT_COMPANY_ID,
    },
  })
  await prisma.officeSetting.create({ data: { companyId: DEFAULT_COMPANY_ID, activeMapPublicationId: publication.id } })
})

async function makeUserToken(app: ReturnType<typeof buildApp>, name: string) {
  const user = await prisma.user.create({
    data: { name, email: `${name.toLowerCase()}-${Date.now()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
  })
  const token = app.jwt.sign({ sub: user.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: DEFAULT_COMPANY_ID, features: [] })
  return { user, token }
}

const futuro = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

describe('POST /office/meetings', () => {
  it('cria e devolve 201 com o DTO', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await makeUserToken(app, 'Ana')

    const res = await app.inject({
      method: 'POST',
      url: '/office/meetings',
      headers: { authorization: `Bearer ${token}` },
      payload: { roomExternalKey: 'aurora', title: 'Planning', startsAt: futuro, durationMinutes: 30, participantIds: [] },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().roomName).toBe('Aurora')
    expect(res.json().googleCalendarUrl).toContain('calendar.google.com')
  })

  it('rejeita duração fora da lista com 400 e issues', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await makeUserToken(app, 'Ana')

    const res = await app.inject({
      method: 'POST',
      url: '/office/meetings',
      headers: { authorization: `Bearer ${token}` },
      payload: { roomExternalKey: 'aurora', title: 'X', startsAt: futuro, durationMinutes: 17, participantIds: [] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().issues).toBeDefined()
  })

  it('devolve 409 com os conflitos quando a sala já está ocupada', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await makeUserToken(app, 'Ana')
    const payload = { roomExternalKey: 'aurora', title: 'Planning', startsAt: futuro, durationMinutes: 60, participantIds: [] }

    await app.inject({ method: 'POST', url: '/office/meetings', headers: { authorization: `Bearer ${token}` }, payload })
    const conflito = await app.inject({
      method: 'POST', url: '/office/meetings', headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, title: 'Outra' },
    })

    expect(conflito.statusCode).toBe(409)
    expect(conflito.json().conflicts).toHaveLength(1)

    const forcada = await app.inject({
      method: 'POST', url: '/office/meetings', headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, title: 'Outra', force: true },
    })
    expect(forcada.statusCode).toBe(201)
  })

  it('convidado (GUEST) não agenda', async () => {
    const app = buildApp()
    await app.ready()
    const guestToken = app.jwt.sign({
      sub: 'guest-1', role: 'GUEST', sectorId: '', companyId: DEFAULT_COMPANY_ID,
      features: [], guest: true, name: 'Visita', presetId: 'p1', inviteId: 'i1',
    })

    const res = await app.inject({
      method: 'POST', url: '/office/meetings', headers: { authorization: `Bearer ${guestToken}` },
      payload: { roomExternalKey: 'aurora', title: 'X', startsAt: futuro, durationMinutes: 30, participantIds: [] },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /office/meetings', () => {
  it('lista a agenda da sala', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await makeUserToken(app, 'Ana')
    await app.inject({
      method: 'POST', url: '/office/meetings', headers: { authorization: `Bearer ${token}` },
      payload: { roomExternalKey: 'aurora', title: 'Planning', startsAt: futuro, durationMinutes: 30, participantIds: [] },
    })

    const res = await app.inject({
      method: 'GET', url: '/office/meetings?room=aurora', headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })
})

describe('PATCH e DELETE /office/meetings/:id', () => {
  it('não-organizador leva 403 e organizador cancela com 200', async () => {
    const app = buildApp()
    await app.ready()
    const { token: anaToken } = await makeUserToken(app, 'Ana')
    const { token: brunoToken } = await makeUserToken(app, 'Bruno')

    const created = await app.inject({
      method: 'POST', url: '/office/meetings', headers: { authorization: `Bearer ${anaToken}` },
      payload: { roomExternalKey: 'aurora', title: 'Planning', startsAt: futuro, durationMinutes: 30, participantIds: [] },
    })
    const id = created.json().id

    const alheio = await app.inject({
      method: 'PATCH', url: `/office/meetings/${id}`, headers: { authorization: `Bearer ${brunoToken}` },
      payload: { title: 'Sequestrada' },
    })
    expect(alheio.statusCode).toBe(403)

    const cancelada = await app.inject({
      method: 'DELETE', url: `/office/meetings/${id}`, headers: { authorization: `Bearer ${anaToken}` },
    })
    expect(cancelada.statusCode).toBe(200)
    expect(cancelada.json().canceled).toBe(true)
  })
})

describe('GET /office/meetings/:id/ics', () => {
  it('devolve text/calendar com Content-Disposition de download', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await makeUserToken(app, 'Ana')
    const created = await app.inject({
      method: 'POST', url: '/office/meetings', headers: { authorization: `Bearer ${token}` },
      payload: { roomExternalKey: 'aurora', title: 'Planning', startsAt: futuro, durationMinutes: 30, participantIds: [] },
    })

    const res = await app.inject({
      method: 'GET', url: `/office/meetings/${created.json().id}/ics`, headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/calendar')
    expect(res.headers['content-disposition']).toContain('planning.ics')
    expect(res.body).toContain('BEGIN:VCALENDAR')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Comando: `pnpm --filter @legends/api exec vitest run src/routes/office-meetings.test.ts`
Esperado: FAIL — 404 em todas as rotas.

- [ ] **Step 3: Implementar as rotas**

`apps/api/src/routes/office-meetings.ts`:

```ts
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  MEETING_AGENDA_DAYS_AHEAD,
  MEETING_AGENDA_MAX_LENGTH,
  MEETING_DURATION_MINUTES,
  MEETING_TITLE_MAX_LENGTH,
  type OfficeMeetingDTO,
} from '@legends/shared'
import {
  OfficeMeetingConflictError,
  OfficeMeetingError,
  buildMeetingIcsFor,
  cancelOfficeMeeting,
  createOfficeMeeting,
  listRoomMeetings,
  updateOfficeMeeting,
} from '../services/office-meeting-service'

const durationSchema = z.union(
  MEETING_DURATION_MINUTES.map((minutes) => z.literal(minutes)) as unknown as [
    z.ZodLiteral<number>,
    z.ZodLiteral<number>,
    ...z.ZodLiteral<number>[],
  ],
)

const createSchema = z.object({
  roomExternalKey: z.string().min(1),
  title: z.string().trim().min(1).max(MEETING_TITLE_MAX_LENGTH),
  agenda: z.string().trim().max(MEETING_AGENDA_MAX_LENGTH).optional(),
  startsAt: z.string().datetime(),
  durationMinutes: durationSchema,
  participantIds: z.array(z.string().min(1)).max(50),
  force: z.boolean().optional(),
})

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(MEETING_TITLE_MAX_LENGTH).optional(),
    agenda: z.string().trim().max(MEETING_AGENDA_MAX_LENGTH).nullable().optional(),
    startsAt: z.string().datetime().optional(),
    durationMinutes: durationSchema.optional(),
    participantIds: z.array(z.string().min(1)).max(50).optional(),
    force: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nada para atualizar' })

const listQuerySchema = z.object({
  room: z.string().min(1),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

const idParamsSchema = z.object({ id: z.string().min(1) })

function badInput(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ message: 'Dados inválidos', issues: error.issues })
}

/**
 * Traduz erro de domínio em resposta. O conflito tem corpo próprio (a lista do
 * que colide) para o front oferecer "marcar mesmo assim".
 */
function sendDomainError(reply: FastifyReply, err: unknown) {
  if (err instanceof OfficeMeetingConflictError) {
    return reply.code(err.status).send({ message: err.message, conflicts: err.conflicts })
  }
  if (err instanceof OfficeMeetingError) {
    return reply.code(err.status).send({ message: err.message })
  }
  throw err
}

/** Convidado (JWT de guest) não é usuário real — não marca nem lista reunião. */
function isGuest(request: { user: { role: string } }): boolean {
  return request.user.role === 'GUEST'
}

export async function officeMeetingRoutes(app: FastifyInstance) {
  const authed = { onRequest: [app.authenticate] }

  app.post('/office/meetings', authed, async (request, reply): Promise<OfficeMeetingDTO | FastifyReply> => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não pode agendar reunião' })
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      const meeting = await createOfficeMeeting({
        companyId: request.user.companyId,
        organizerId: request.user.sub,
        roomExternalKey: parsed.data.roomExternalKey,
        title: parsed.data.title,
        agenda: parsed.data.agenda ?? null,
        startsAt: new Date(parsed.data.startsAt),
        durationMinutes: parsed.data.durationMinutes as never,
        participantIds: parsed.data.participantIds,
        force: parsed.data.force,
      })
      return reply.code(201).send(meeting)
    } catch (err) {
      return sendDomainError(reply, err)
    }
  })

  app.get('/office/meetings', authed, async (request, reply): Promise<OfficeMeetingDTO[] | FastifyReply> => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não vê a agenda da sala' })
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return badInput(reply, parsed.error)
    const from = parsed.data.from ? new Date(parsed.data.from) : new Date()
    const to = parsed.data.to
      ? new Date(parsed.data.to)
      : new Date(from.getTime() + MEETING_AGENDA_DAYS_AHEAD * 24 * 60 * 60 * 1000)
    return listRoomMeetings(request.user.companyId, parsed.data.room, from, to)
  })

  app.patch('/office/meetings/:id', authed, async (request, reply): Promise<OfficeMeetingDTO | FastifyReply> => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não pode editar reunião' })
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      return await updateOfficeMeeting(params.data.id, request.user.sub, request.user.companyId, {
        title: parsed.data.title,
        agenda: parsed.data.agenda,
        startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : undefined,
        durationMinutes: parsed.data.durationMinutes as never,
        participantIds: parsed.data.participantIds,
        force: parsed.data.force,
      })
    } catch (err) {
      return sendDomainError(reply, err)
    }
  })

  app.delete('/office/meetings/:id', authed, async (request, reply): Promise<OfficeMeetingDTO | FastifyReply> => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não pode cancelar reunião' })
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    try {
      return await cancelOfficeMeeting(params.data.id, request.user.sub, request.user.companyId)
    } catch (err) {
      return sendDomainError(reply, err)
    }
  })

  app.get('/office/meetings/:id/ics', authed, async (request, reply) => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não baixa o convite' })
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    try {
      const { filename, ics } = await buildMeetingIcsFor(params.data.id, request.user.sub, request.user.companyId)
      return reply
        .header('content-type', 'text/calendar; charset=utf-8')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(ics)
    } catch (err) {
      return sendDomainError(reply, err)
    }
  })
}
```

Em `apps/api/src/app.ts`: importar `import { officeMeetingRoutes } from './routes/office-meetings'` junto dos outros imports de office, e registrar `app.register(officeMeetingRoutes)` logo depois de `app.register(officeGuestRoutes)`.

- [ ] **Step 4: Rodar e ver passar**

Comando: `pnpm --filter @legends/api exec vitest run src/routes/office-meetings.test.ts`
Esperado: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/office-meetings.ts apps/api/src/routes/office-meetings.test.ts apps/api/src/app.ts
git commit -m "feat: endpoints de reunião de sala"
```

---

### Task 8: Lembrete agendado

**Files:**
- Create: `apps/api/src/scheduler/meeting-reminders.ts`
- Create: `apps/api/src/scheduler/meeting-reminders.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `createNotification`, `officeRoomDeepLinkPath`, `MEETING_REMINDER_MINUTES`.
- Produces: `runMeetingReminderTick(now: Date): Promise<void>`, `startMeetingReminderScheduler(): void`.

- [ ] **Step 1: Escrever os testes que falham**

`apps/api/src/scheduler/meeting-reminders.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { runMeetingReminderTick } from './meeting-reminders'

async function makeUser(name: string) {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
  })
}

const AGORA = new Date('2099-01-10T13:55:00.000Z')

/** Reunião às 14:00 — 5 min à frente de AGORA, dentro da janela de 10 min. */
async function makeMeeting(organizerId: string, participantIds: string[], startsAt = new Date('2099-01-10T14:00:00.000Z')) {
  return prisma.officeMeeting.create({
    data: {
      companyId: DEFAULT_COMPANY_ID,
      roomExternalKey: 'aurora',
      roomName: 'Aurora',
      title: 'Planning',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      organizerId,
      participants: { create: participantIds.map((userId) => ({ userId })) },
    },
  })
}

describe('runMeetingReminderTick', () => {
  it('notifica organizador e participantes na janela de 10 minutos', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    await makeMeeting(ana.id, [bruno.id])

    await runMeetingReminderTick(AGORA)

    const notifications = await prisma.notification.findMany({ where: { type: 'MEETING_REMINDER' } })
    expect(notifications.map((n) => n.userId).sort()).toEqual([ana.id, bruno.id].sort())
    expect(notifications[0]!.link).toBe('/escritorio?sala=aurora')
  })

  it('não repete o lembrete em ticks seguintes', async () => {
    const ana = await makeUser('Ana')
    await makeMeeting(ana.id, [])

    await runMeetingReminderTick(AGORA)
    await runMeetingReminderTick(new Date('2099-01-10T13:56:00.000Z'))

    expect(await prisma.notification.count({ where: { type: 'MEETING_REMINDER' } })).toBe(1)
  })

  it('ignora reunião fora da janela', async () => {
    const ana = await makeUser('Ana')
    await makeMeeting(ana.id, [], new Date('2099-01-10T16:00:00.000Z'))

    await runMeetingReminderTick(AGORA)

    expect(await prisma.notification.count({ where: { type: 'MEETING_REMINDER' } })).toBe(0)
  })

  it('ignora reunião cancelada', async () => {
    const ana = await makeUser('Ana')
    const meeting = await makeMeeting(ana.id, [])
    await prisma.officeMeeting.update({ where: { id: meeting.id }, data: { canceledAt: new Date() } })

    await runMeetingReminderTick(AGORA)

    expect(await prisma.notification.count({ where: { type: 'MEETING_REMINDER' } })).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Comando: `pnpm --filter @legends/api exec vitest run src/scheduler/meeting-reminders.test.ts`
Esperado: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

`apps/api/src/scheduler/meeting-reminders.ts`:

```ts
/**
 * Lembrete de reunião de sala: 10 minutos antes, uma notificação in-app para
 * organizador e convidados — que o `createNotification` já espelha como card na
 * DM do Teams de quem tem webhook.
 *
 * Cada reunião é REIVINDICADA antes de notificar, com um `updateMany`
 * condicional em `remindedAt: null`. É o `WHERE` do Postgres que serializa dois
 * ticks sobrepostos — ler e depois gravar sem condição deixaria passar duplicata,
 * porque `setInterval` não espera o tick anterior e pode haver mais de um
 * processo. O trade que fica: notificação que falha depois da reivindicação
 * perde aquele lembrete.
 */
import { MEETING_REMINDER_MINUTES, officeRoomDeepLinkPath } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createNotification } from '../services/notification-service'

const TICK_MS = 60 * 1000

export async function runMeetingReminderTick(now: Date): Promise<void> {
  const limite = new Date(now.getTime() + MEETING_REMINDER_MINUTES * 60 * 1000)

  const meetings = await prisma.officeMeeting.findMany({
    where: {
      canceledAt: null,
      remindedAt: null,
      startsAt: { gt: now, lte: limite },
    },
    include: { participants: { select: { userId: true } } },
  })

  for (const meeting of meetings) {
    try {
      // Reivindicação condicional: o `WHERE remindedAt IS NULL` serializa dois
      // ticks sobrepostos no próprio Postgres — quem perder a corrida recebe
      // count 0 e desiste. Marcar antes de notificar significa que uma falha de
      // notificação perde o lembrete; é o trade aceito, melhor que duplicar.
      const claim = await prisma.officeMeeting.updateMany({
        where: { id: meeting.id, remindedAt: null },
        data: { remindedAt: now },
      })
      if (claim.count === 0) continue

      const destinatarios = [meeting.organizerId, ...meeting.participants.map((p) => p.userId)]
      const title = `"${meeting.title}" começa em instantes na sala ${meeting.roomName}`

      for (const userId of new Set(destinatarios)) {
        await createNotification({
          userId,
          type: 'MEETING_REMINDER',
          title,
          link: officeRoomDeepLinkPath(meeting.roomExternalKey),
          companyId: meeting.companyId,
        })
      }
    } catch (err) {
      console.error(`[meeting-reminders] falha na reunião ${meeting.id}`, err)
    }
  }
}

/**
 * Tick de 1 minuto — a granularidade horária do scheduler de nudges não serve
 * para um lembrete de 10 minutos. Não sobe em teste (que usa só buildApp).
 */
export function startMeetingReminderScheduler(): void {
  if (process.env.NODE_ENV === 'test') return
  setInterval(() => {
    runMeetingReminderTick(new Date()).catch((err) =>
      console.error('[meeting-reminders] tick falhou', err),
    )
  }, TICK_MS)
}
```

Em `apps/api/src/server.ts`, importar e subir junto do outro scheduler:

```ts
import { startMeetingReminderScheduler } from './scheduler/meeting-reminders'
```

e, dentro do `.then(...)`, depois de `startNudgeScheduler()`:

```ts
    startMeetingReminderScheduler()
```

- [ ] **Step 4: Rodar e ver passar**

Comando: `pnpm --filter @legends/api exec vitest run src/scheduler/meeting-reminders.test.ts`
Esperado: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scheduler/meeting-reminders.ts apps/api/src/scheduler/meeting-reminders.test.ts apps/api/src/server.ts
git commit -m "feat: lembrete de reunião 10 minutos antes"
```

---

### Task 9: Helper de destino do deep link em `@legends/shared`

**Files:**
- Modify: `packages/shared/src/office-map-runtime.ts`
- Modify: `packages/shared/src/office-map-runtime.test.ts`

**Interfaces:**
- Consumes: `isMapTileWalkable`, `mapZoneAt` (já existem no arquivo).
- Produces: `meetingRoomEntryTile(document: MapDocumentV1, externalKey: string): TilePosition | null`.

**Atenção:** a geometria dos objetos do mapa está em **pixels**; tiles saem de `document.map.tileWidth`/`tileHeight`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `packages/shared/src/office-map-runtime.test.ts`:

```ts
describe("meetingRoomEntryTile", () => {
  const document = {
    schemaVersion: "1",
    map: { width: 20, height: 20, tileWidth: 32, tileHeight: 32 },
    layers: [],
    objects: [
      {
        id: "room-aurora",
        type: "meeting-room",
        geometry: { kind: "rectangle", x: 64, y: 64, width: 128, height: 128 },
        properties: { externalKey: "aurora", name: "Aurora", status: "OPEN", voiceEnabled: true, accessPolicy: "OPEN" },
      },
    ],
  } as unknown as MapDocumentV1;

  it("devolve um tile andável dentro da sala", () => {
    const tile = meetingRoomEntryTile(document, "aurora");
    expect(tile).not.toBeNull();
    expect(tile!.x).toBeGreaterThanOrEqual(2);
    expect(tile!.x).toBeLessThan(6);
    expect(tile!.y).toBeGreaterThanOrEqual(2);
    expect(tile!.y).toBeLessThan(6);
  });

  it("desvia do tile central quando ele tem colisão", () => {
    const comColisao = {
      ...document,
      objects: [
        ...document.objects,
        {
          id: "col",
          type: "collision",
          geometry: { kind: "rectangle", x: 128, y: 128, width: 32, height: 32 },
          properties: {},
        },
      ],
    } as unknown as MapDocumentV1;
    const tile = meetingRoomEntryTile(comColisao, "aurora");
    expect(tile).not.toEqual({ x: 4, y: 4 });
    expect(tile).not.toBeNull();
  });

  it("devolve null para sala inexistente", () => {
    expect(meetingRoomEntryTile(document, "nao-existe")).toBeNull();
  });
});
```

Acrescentar `meetingRoomEntryTile` ao import do topo do arquivo de teste.

- [ ] **Step 2: Rodar e ver falhar**

Comando: `pnpm --filter @legends/shared exec vitest run src/office-map-runtime.test.ts`
Esperado: FAIL — `meetingRoomEntryTile is not exported`.

- [ ] **Step 3: Implementar**

Acrescentar em `packages/shared/src/office-map-runtime.ts`:

```ts
/**
 * Tile de destino para "entrar" numa sala de reunião pelo deep link: o mais
 * central da sala que seja andável. Varre a caixa de tiles da sala em ordem de
 * distância ao centro, então uma mesa no meio não impede a chegada.
 * Devolve null se a sala não existe no mapa ou não tem tile andável.
 */
export function meetingRoomEntryTile(
  document: MapDocumentV1,
  externalKey: string,
): TilePosition | null {
  const room = document.objects.find(
    (object): object is MeetingRoomObjectV1 =>
      object.type === "meeting-room" && object.properties.externalKey === externalKey,
  );
  if (!room) return null;

  const { tileWidth, tileHeight } = document.map;
  const geometry = room.geometry;
  const bounds =
    geometry.kind === "rectangle"
      ? { minX: geometry.x, minY: geometry.y, maxX: geometry.x + geometry.width, maxY: geometry.y + geometry.height }
      : geometry.points.reduce(
          (acc, point) => ({
            minX: Math.min(acc.minX, point.x),
            minY: Math.min(acc.minY, point.y),
            maxX: Math.max(acc.maxX, point.x),
            maxY: Math.max(acc.maxY, point.y),
          }),
          { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
        );

  const firstTileX = Math.floor(bounds.minX / tileWidth);
  const lastTileX = Math.ceil(bounds.maxX / tileWidth) - 1;
  const firstTileY = Math.floor(bounds.minY / tileHeight);
  const lastTileY = Math.ceil(bounds.maxY / tileHeight) - 1;
  const centerX = (firstTileX + lastTileX) / 2;
  const centerY = (firstTileY + lastTileY) / 2;

  const candidates: TilePosition[] = [];
  for (let y = firstTileY; y <= lastTileY; y += 1) {
    for (let x = firstTileX; x <= lastTileX; x += 1) {
      // mapZoneAt garante que o tile é da SALA (importa em polígono, onde a
      // caixa envolvente pega área de fora).
      if (mapZoneAt(document, x, y)?.properties.externalKey !== externalKey) continue;
      if (!isMapTileWalkable(document, x, y)) continue;
      candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return null;

  return candidates.sort(
    (a, b) =>
      (a.x - centerX) ** 2 + (a.y - centerY) ** 2 - ((b.x - centerX) ** 2 + (b.y - centerY) ** 2),
  )[0]!;
}
```

- [ ] **Step 4: Rodar e ver passar**

Comando: `pnpm --filter @legends/shared exec vitest run src/office-map-runtime.test.ts`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/office-map-runtime.ts packages/shared/src/office-map-runtime.test.ts
git commit -m "feat: helper de tile de entrada da sala para deep link"
```

---

### Task 10: Cliente HTTP e hooks no front

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/office/meetings/api.ts`
- Create: `apps/web/src/office/meetings/useRoomMeetings.ts`

**Interfaces:**
- Consumes: DTOs da Task 1; endpoints da Task 7.
- Produces:
  - `apiFetchBlob(path): Promise<{ blob: Blob; filename: string | null }>` em `lib/api.ts`
  - `fetchRoomMeetings(roomExternalKey)`, `createMeeting(body)`, `updateMeeting(id, body)`, `cancelMeeting(id)`, `downloadMeetingIcs(meeting)` em `office/meetings/api.ts`
  - `useRoomMeetings(roomExternalKey)`, `useCreateMeeting()`, `useCancelMeeting()` em `useRoomMeetings.ts`

- [ ] **Step 1: Acrescentar `apiFetchBlob` ao cliente HTTP**

Em `apps/web/src/lib/api.ts`, depois de `apiFetch`:

```ts
/**
 * Baixa um recurso binário/texto puro (ex.: .ics) com o mesmo esquema de auth
 * do `apiFetch`. Existe porque o access token só vive em memória: navegar
 * direto para a URL não mandaria o Authorization e cairia em 401.
 */
export async function apiFetchBlob(
  path: string,
  retryOn401 = true,
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
  })

  if (res.status === 401 && retryOn401 && (await refreshAccessToken())) {
    return apiFetchBlob(path, false)
  }
  if (!res.ok) {
    throw new ApiError(res.status, 'Não foi possível baixar o arquivo')
  }

  const disposition = res.headers.get('content-disposition') ?? ''
  const match = /filename="([^"]+)"/.exec(disposition)
  return { blob: await res.blob(), filename: match?.[1] ?? null }
}
```

- [ ] **Step 2: Escrever as chamadas da feature**

`apps/web/src/office/meetings/api.ts`:

```ts
import type {
  CreateOfficeMeetingRequest,
  OfficeMeetingDTO,
  UpdateOfficeMeetingRequest,
} from '@legends/shared'
import { apiFetch, apiFetchBlob } from '../../lib/api'

export function fetchRoomMeetings(roomExternalKey: string): Promise<OfficeMeetingDTO[]> {
  return apiFetch(`/office/meetings?room=${encodeURIComponent(roomExternalKey)}`)
}

export function createMeeting(body: CreateOfficeMeetingRequest): Promise<OfficeMeetingDTO> {
  return apiFetch('/office/meetings', { method: 'POST', body: JSON.stringify(body) })
}

export function updateMeeting(id: string, body: UpdateOfficeMeetingRequest): Promise<OfficeMeetingDTO> {
  return apiFetch(`/office/meetings/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function cancelMeeting(id: string): Promise<OfficeMeetingDTO> {
  return apiFetch(`/office/meetings/${id}`, { method: 'DELETE' })
}

/** Baixa o .ics e dispara o download no browser. */
export async function downloadMeetingIcs(meeting: OfficeMeetingDTO): Promise<void> {
  const { blob, filename } = await apiFetchBlob(meeting.icsPath)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename ?? 'reuniao.ics'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 3: Escrever os hooks**

`apps/web/src/office/meetings/useRoomMeetings.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateOfficeMeetingRequest } from '@legends/shared'
import { cancelMeeting, createMeeting, fetchRoomMeetings } from './api'

const roomMeetingsKey = (roomExternalKey: string) => ['office-meetings', roomExternalKey] as const

export function useRoomMeetings(roomExternalKey: string | null) {
  return useQuery({
    queryKey: roomMeetingsKey(roomExternalKey ?? ''),
    queryFn: () => fetchRoomMeetings(roomExternalKey!),
    enabled: roomExternalKey !== null,
  })
}

export function useCreateMeeting(roomExternalKey: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateOfficeMeetingRequest) => createMeeting(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: roomMeetingsKey(roomExternalKey) }),
  })
}

export function useCancelMeeting(roomExternalKey: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => cancelMeeting(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: roomMeetingsKey(roomExternalKey) }),
  })
}
```

- [ ] **Step 4: Conferir a compilação**

Comando: `pnpm --filter @legends/web exec tsc --noEmit -p tsconfig.json`
Esperado: sem erros. (Use o binário do workspace, não `npx tsc`.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/office/meetings/api.ts apps/web/src/office/meetings/useRoomMeetings.ts
git commit -m "feat: cliente e hooks de reunião de sala no front"
```

---

### Task 11: Modal de agendamento

**Files:**
- Create: `apps/web/src/office/meetings/ScheduleMeetingModal.tsx`
- Create: `apps/web/src/office/meetings/ScheduleMeetingModal.test.tsx`

**Interfaces:**
- Consumes: hooks da Task 10; `MEETING_DURATION_MINUTES`, `OfficeMeetingDTO` (Task 1).
- Produces: `<ScheduleMeetingModal roomExternalKey roomName youId people onClose />` com `people: Array<{ id: string; name: string }>`.

- [ ] **Step 1: Escrever o teste que falha**

`apps/web/src/office/meetings/ScheduleMeetingModal.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { OfficeMeetingDTO } from '@legends/shared'
import { ScheduleMeetingModal } from './ScheduleMeetingModal'
import { ApiError } from '../../lib/api'
import * as api from './api'

vi.mock('./api')

const meeting: OfficeMeetingDTO = {
  id: 'mtg1',
  roomExternalKey: 'aurora',
  roomName: 'Aurora',
  title: 'Planning',
  agenda: null,
  startsAt: '2099-01-10T14:00:00.000Z',
  endsAt: '2099-01-10T15:00:00.000Z',
  canceled: false,
  organizer: { id: 'u1', name: 'Ana' },
  participants: [],
  googleCalendarUrl: 'https://calendar.google.com/x',
  outlookCalendarUrl: 'https://outlook.office.com/x',
  icsPath: '/office/meetings/mtg1/ics',
}

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ScheduleMeetingModal
        roomExternalKey="aurora"
        roomName="Aurora"
        youId="u1"
        people={[{ id: 'u2', name: 'Bruno' }]}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.fetchRoomMeetings).mockResolvedValue([])
  vi.mocked(api.createMeeting).mockResolvedValue(meeting)
})

describe('ScheduleMeetingModal', () => {
  it('lista as reuniões já marcadas na sala', async () => {
    vi.mocked(api.fetchRoomMeetings).mockResolvedValue([meeting])
    renderModal()
    expect(await screen.findByText('Planning')).toBeInTheDocument()
  })

  it('cria a reunião e mostra os botões de exportar para a agenda', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.type(screen.getByLabelText('Título'), 'Planning')
    await user.type(screen.getByLabelText('Data e hora'), '2099-01-10T14:00')
    await user.click(screen.getByRole('button', { name: 'Marcar reunião' }))

    await waitFor(() => expect(api.createMeeting).toHaveBeenCalled())
    expect(await screen.findByRole('link', { name: /Google Calendar/ })).toHaveAttribute(
      'href',
      'https://calendar.google.com/x',
    )
    expect(screen.getByRole('button', { name: /Baixar \.ics/ })).toBeInTheDocument()
  })

  it('em conflito, avisa e só marca depois de confirmar', async () => {
    const user = userEvent.setup()
    vi.mocked(api.createMeeting)
      .mockRejectedValueOnce(
        new ApiError(409, 'A sala já tem reunião marcada nesse horário', {
          message: 'A sala já tem reunião marcada nesse horário',
          conflicts: [meeting],
        }),
      )
      .mockResolvedValueOnce(meeting)

    renderModal()
    await user.type(screen.getByLabelText('Título'), 'Outra')
    await user.type(screen.getByLabelText('Data e hora'), '2099-01-10T14:30')
    await user.click(screen.getByRole('button', { name: 'Marcar reunião' }))

    expect(await screen.findByText(/já tem reunião marcada/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Marcar mesmo assim' }))

    await waitFor(() => expect(api.createMeeting).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.createMeeting).mock.calls[1]![0].force).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Comando: `pnpm --filter @legends/web exec vitest run src/office/meetings/ScheduleMeetingModal.test.tsx`
Esperado: FAIL — componente inexistente.

- [ ] **Step 3: Implementar o modal**

`apps/web/src/office/meetings/ScheduleMeetingModal.tsx`:

```tsx
import { useState } from 'react'
import {
  MEETING_AGENDA_MAX_LENGTH,
  MEETING_DURATION_MINUTES,
  MEETING_TITLE_MAX_LENGTH,
  officeRoomDeepLinkPath,
  type CreateOfficeMeetingRequest,
  type MeetingDurationMinutes,
  type OfficeMeetingDTO,
} from '@legends/shared'
import { ApiError } from '../../lib/api'
import { downloadMeetingIcs } from './api'
import { useCancelMeeting, useCreateMeeting, useRoomMeetings } from './useRoomMeetings'

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** `datetime-local` devolve hora local sem timezone — o Date do browser resolve. */
function toIso(localValue: string): string {
  return new Date(localValue).toISOString()
}

/**
 * Modal de reuniões da sala: agenda dos próximos dias em cima, formulário
 * embaixo. Reserva é leve — conflito não bloqueia, só pede confirmação.
 */
export function ScheduleMeetingModal({
  roomExternalKey,
  roomName,
  youId,
  people,
  onClose,
}: {
  roomExternalKey: string
  roomName: string
  youId: string
  people: Array<{ id: string; name: string }>
  onClose: () => void
}) {
  const meetings = useRoomMeetings(roomExternalKey)
  const create = useCreateMeeting(roomExternalKey)
  const cancel = useCancelMeeting(roomExternalKey)

  const [title, setTitle] = useState('')
  const [agenda, setAgenda] = useState('')
  const [startsAtLocal, setStartsAtLocal] = useState('')
  const [durationMinutes, setDurationMinutes] = useState<MeetingDurationMinutes>(30)
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [conflicts, setConflicts] = useState<OfficeMeetingDTO[] | null>(null)
  const [created, setCreated] = useState<OfficeMeetingDTO | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(force: boolean) {
    setError(null)
    const body: CreateOfficeMeetingRequest = {
      roomExternalKey,
      title,
      agenda: agenda.trim() || undefined,
      startsAt: toIso(startsAtLocal),
      durationMinutes,
      participantIds,
      ...(force ? { force: true } : {}),
    }
    try {
      const meeting = await create.mutateAsync(body)
      setConflicts(null)
      setCreated(meeting)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflicts((err.payload?.conflicts as OfficeMeetingDTO[] | undefined) ?? [])
        return
      }
      setError(err instanceof ApiError ? err.message : 'Não foi possível marcar a reunião')
    }
  }

  function toggleParticipant(id: string) {
    setParticipantIds((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label={`Reuniões da sala ${roomName}`}>
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-outline-variant/30 bg-surface-container p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-title text-title-md text-on-surface">Reuniões — {roomName}</h2>
          <button type="button" onClick={onClose} className="text-on-surface-variant hover:text-on-surface" aria-label="Fechar">
            ✕
          </button>
        </div>

        <section className="mb-6">
          <h3 className="mb-2 font-label text-label-md text-on-surface-variant">Próximas nesta sala</h3>
          {meetings.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}
          {meetings.data?.length === 0 && (
            <p className="text-body-sm text-on-surface-variant">Nenhuma reunião marcada.</p>
          )}
          <ul className="space-y-2">
            {meetings.data?.map((meeting) => (
              <li key={meeting.id} className="flex items-center justify-between rounded-lg bg-surface-container-highest/40 px-3 py-2">
                <div>
                  <p className={`text-body-md ${meeting.canceled ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}>
                    {meeting.title}
                  </p>
                  <p className="text-body-sm text-on-surface-variant">
                    {formatWhen(meeting.startsAt)} · {meeting.organizer.name}
                  </p>
                </div>
                {meeting.organizer.id === youId && !meeting.canceled && (
                  <button
                    type="button"
                    onClick={() => cancel.mutate(meeting.id)}
                    className="font-label text-label-sm text-error hover:underline"
                  >
                    Cancelar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {created ? (
          <section className="space-y-3">
            <p className="text-body-md text-on-surface">Reunião marcada. Coloque na sua agenda:</p>
            <div className="flex flex-wrap gap-2">
              <a
                href={created.googleCalendarUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-primary-container/20 px-3 py-2 font-label text-label-md text-primary-container"
              >
                Adicionar ao Google Calendar
              </a>
              <button
                type="button"
                onClick={() => void downloadMeetingIcs(created)}
                className="rounded-lg bg-primary-container/20 px-3 py-2 font-label text-label-md text-primary-container"
              >
                Baixar .ics (Outlook/Teams)
              </button>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    `${window.location.origin}${officeRoomDeepLinkPath(roomExternalKey)}`,
                  )
                }
                className="rounded-lg border border-outline-variant/40 px-3 py-2 font-label text-label-md text-on-surface-variant"
              >
                Copiar link da sala
              </button>
            </div>
            <button type="button" onClick={onClose} className="font-label text-label-md text-on-surface-variant hover:underline">
              Fechar
            </button>
          </section>
        ) : (
          <section className="space-y-3">
            <h3 className="font-label text-label-md text-on-surface-variant">Nova reunião</h3>

            <label className="block text-body-sm text-on-surface-variant" htmlFor="meeting-title">
              Título
            </label>
            <input
              id="meeting-title"
              value={title}
              maxLength={MEETING_TITLE_MAX_LENGTH}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-lg bg-surface-container-highest/40 px-3 py-2 text-on-surface"
            />

            <label className="block text-body-sm text-on-surface-variant" htmlFor="meeting-agenda">
              Pauta (opcional)
            </label>
            <textarea
              id="meeting-agenda"
              value={agenda}
              maxLength={MEETING_AGENDA_MAX_LENGTH}
              onChange={(event) => setAgenda(event.target.value)}
              className="w-full rounded-lg bg-surface-container-highest/40 px-3 py-2 text-on-surface"
              rows={3}
            />

            <label className="block text-body-sm text-on-surface-variant" htmlFor="meeting-start">
              Data e hora
            </label>
            <input
              id="meeting-start"
              type="datetime-local"
              value={startsAtLocal}
              onChange={(event) => setStartsAtLocal(event.target.value)}
              className="w-full rounded-lg bg-surface-container-highest/40 px-3 py-2 text-on-surface"
            />

            <label className="block text-body-sm text-on-surface-variant" htmlFor="meeting-duration">
              Duração
            </label>
            <select
              id="meeting-duration"
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(Number(event.target.value) as MeetingDurationMinutes)}
              className="w-full rounded-lg bg-surface-container-highest/40 px-3 py-2 text-on-surface"
            >
              {MEETING_DURATION_MINUTES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} min
                </option>
              ))}
            </select>

            <fieldset>
              <legend className="mb-1 text-body-sm text-on-surface-variant">Participantes</legend>
              <div className="flex flex-wrap gap-2">
                {people.map((person) => (
                  <label key={person.id} className="flex items-center gap-2 rounded-lg bg-surface-container-highest/40 px-3 py-1 text-body-sm text-on-surface">
                    <input
                      type="checkbox"
                      checked={participantIds.includes(person.id)}
                      onChange={() => toggleParticipant(person.id)}
                    />
                    {person.name}
                  </label>
                ))}
              </div>
            </fieldset>

            {conflicts && (
              <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3">
                <p className="text-body-sm text-on-surface">
                  A sala já tem reunião marcada nesse horário:{' '}
                  {conflicts.map((conflict) => `${conflict.title} (${formatWhen(conflict.startsAt)})`).join(', ')}.
                </p>
                <button
                  type="button"
                  onClick={() => void submit(true)}
                  className="mt-2 rounded-lg bg-amber-400/20 px-3 py-2 font-label text-label-md text-on-surface"
                >
                  Marcar mesmo assim
                </button>
              </div>
            )}

            {error && <p className="text-body-sm text-error">{error}</p>}

            <button
              type="button"
              disabled={title.trim().length === 0 || startsAtLocal === '' || create.isPending}
              onClick={() => void submit(false)}
              className="w-full rounded-lg bg-primary-container/20 px-3 py-2 font-label text-label-md text-primary-container disabled:opacity-45"
            >
              Marcar reunião
            </button>
          </section>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Comando: `pnpm --filter @legends/web exec vitest run src/office/meetings/ScheduleMeetingModal.test.tsx`
Esperado: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/meetings/ScheduleMeetingModal.tsx apps/web/src/office/meetings/ScheduleMeetingModal.test.tsx
git commit -m "feat: modal de agendamento de reunião na sala"
```

---

### Task 12: Ligar o modal ao escritório e o deep link

**Files:**
- Modify: `apps/web/src/office/media/MediaBarMoreMenu.tsx`
- Modify: `apps/web/src/office/media/MediaBar.tsx`
- Modify: `apps/web/src/office/useOfficeInteractions.ts` (expor `showToast`)
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Modify: `apps/web/src/office/media/MediaBarMoreMenu.test.tsx`

**Interfaces:**
- Consumes: `ScheduleMeetingModal` (Task 11), `meetingRoomEntryTile` (Task 9), `interactions.walkToTile` e `zone.properties.externalKey` (já existem na `OfficePage`).
- Produces: prop `onScheduleMeeting?: () => void` em `MediaBar` e `MediaBarMoreMenu`; efeito de deep link na `OfficePage`.

- [ ] **Step 1: Escrever o teste que falha no menu**

Acrescentar em `apps/web/src/office/media/MediaBarMoreMenu.test.tsx` (reusando o helper de render já existente no arquivo; se ele receber props por objeto, passe as novas junto):

```tsx
it('oferece "Agendar reunião" dentro da sala e chama o handler', async () => {
  const user = userEvent.setup()
  const onScheduleMeeting = vi.fn()
  renderMenu({ inMeetingRoom: true, showRoomControls: true, onScheduleMeeting })

  await user.click(screen.getByRole('menuitem', { name: 'Agendar reunião' }))

  expect(onScheduleMeeting).toHaveBeenCalledOnce()
})

it('não oferece "Agendar reunião" fora de sala', () => {
  renderMenu({ inMeetingRoom: false, showRoomControls: false, onScheduleMeeting: vi.fn() })
  expect(screen.queryByRole('menuitem', { name: 'Agendar reunião' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Rodar e ver falhar**

Comando: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBarMoreMenu.test.tsx`
Esperado: FAIL — item inexistente.

- [ ] **Step 3: Acrescentar o item ao menu**

Em `MediaBarMoreMenu.tsx`, incluir `onScheduleMeeting` na desestruturação e no tipo das props:

```ts
  onScheduleMeeting,
```
```ts
  /** Só dentro de sala de reunião e nunca para convidado (ver OfficePage). */
  onScheduleMeeting?: () => void
```

E, no JSX, logo depois do item de "pessoas da sala":

```tsx
        {showRoomControls && onScheduleMeeting && (
          <button
            type="button"
            role="menuitem"
            aria-label="Agendar reunião"
            className={rowCls(false)}
            onClick={runAndClose(onScheduleMeeting)}
          >
            <Icon name="calendar_month" className="text-[18px]" />
            Agendar reunião
          </button>
        )}
```

Em `MediaBar.tsx`, aceitar `onScheduleMeeting` (props e tipo, ao lado de `onToggleRoomLock`) e repassar ao `<MediaBarMoreMenu ... onScheduleMeeting={onScheduleMeeting} />`.

- [ ] **Step 4: Rodar e ver passar**

Comando: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBarMoreMenu.test.tsx`
Esperado: PASS.

- [ ] **Step 5: Montar o modal na OfficePage**

Em `apps/web/src/pages/OfficePage.tsx`:

```tsx
const [scheduleOpen, setScheduleOpen] = useState(false)
```

Passar para a `MediaBar` (ao lado de `onToggleRoomLock`):

```tsx
        onScheduleMeeting={
          inMeetingRoom && !isGuest && zone?.properties.externalKey
            ? () => setScheduleOpen(true)
            : undefined
        }
```

E renderizar junto dos outros modais (perto do `<KnockRequestModal .../>`):

```tsx
        {scheduleOpen && youId && zone?.properties.externalKey && (
          <ScheduleMeetingModal
            roomExternalKey={zone.properties.externalKey}
            roomName={zoneName ?? zone.properties.name}
            youId={youId}
            people={occupants
              .filter((o) => o.userId !== youId && !o.isGuest)
              .map((o) => ({ id: o.userId, name: o.name }))}
            onClose={() => setScheduleOpen(false)}
          />
        )}
```

Import novo: `import { ScheduleMeetingModal } from '../office/meetings/ScheduleMeetingModal'`.

- [ ] **Step 6: Expor `showToast` no `useOfficeInteractions`**

O hook já tem um `showToast` interno (`useOfficeInteractions.ts:124`), mas hoje só devolve a string `toast` — a `OfficePage` não consegue disparar aviso próprio. Acrescentar à interface de retorno, logo depois de `walkToTile`:

```ts
  /** Dispara um aviso na faixa de toast da OfficePage (some sozinho). */
  showToast: (message: string) => void
```

e ao objeto retornado no fim do hook, depois de `walkToTile,`:

```ts
    showToast,
```

- [ ] **Step 7: Implementar o deep link**

Ainda na `OfficePage`, com `useSearchParams` de `react-router-dom` (o arquivo já importa `useNavigate` da mesma lib) e `meetingRoomEntryTile` de `@legends/shared`:

```tsx
  const [searchParams, setSearchParams] = useSearchParams()

  // Deep link do convite (/escritorio?sala=aurora): leva o personagem até a
  // sala assim que o mapa carrega e o "você" existe. O param é consumido uma
  // única vez — sem isto, cada re-render reiniciaria a caminhada.
  useEffect(() => {
    const salaKey = searchParams.get('sala')
    if (!salaKey || !activeMap || !you) return

    const target = meetingRoomEntryTile(activeMap.document, salaKey)
    if (target) {
      interactions.walkToTile(target)
    } else {
      interactions.showToast('Sala não encontrada no escritório')
    }

    const next = new URLSearchParams(searchParams)
    next.delete('sala')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, activeMap, you, interactions])
```

O aviso aparece na faixa de toast que a `OfficePage` já renderiza a partir de `interactions.toast` (linha ~699).

- [ ] **Step 8: Conferir a compilação**

Comando: `pnpm --filter @legends/web exec tsc --noEmit -p tsconfig.json`
Esperado: sem erros.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/office/media/MediaBar.tsx apps/web/src/office/media/MediaBarMoreMenu.tsx apps/web/src/office/media/MediaBarMoreMenu.test.tsx apps/web/src/office/useOfficeInteractions.ts apps/web/src/pages/OfficePage.tsx
git commit -m "feat: agendar reunião pelo menu da sala e deep link /escritorio?sala="
```

---

### Task 13: Verificação final

**Files:** nenhum novo.

- [ ] **Step 1: Subir o banco**

```bash
pnpm db:up
```

- [ ] **Step 2: Rodar a suíte inteira**

```bash
pnpm test
```

Esperado: PASS em `@legends/shared`, `@legends/api` e `@legends/web`.

- [ ] **Step 3: Build**

```bash
pnpm build
```

Esperado: build limpo nos três workspaces.

- [ ] **Step 4: Passar o olho no runtime**

Com `pnpm dev`, entrar numa sala de reunião, marcar uma reunião para daqui a alguns minutos e conferir: item no menu, agenda listada, conflito avisando, botão do Google abrindo o template preenchido, `.ics` baixando, notificação chegando ao convidado e o link `/escritorio?sala=<key>` levando o personagem até a sala.

- [ ] **Step 5: Commit final (se algo foi ajustado)**

```bash
git add -A
git commit -m "chore: ajustes da verificação final de agendamento de reunião"
```

---

## Auto-revisão do plano

**Cobertura do spec:** dados (Task 2) · conflito leve (Task 5) · API completa incluindo `.ics` (Tasks 5–7) · exportação Google/Outlook/`.ics` (Task 3) · notificações e espelho no Teams (Tasks 5–6, emojis na 5) · lembrete de 10 min (Task 8) · deep link (Tasks 9 e 12) · UI na sala (Tasks 11–12) · testes em todas as tasks (Task 13 fecha). Fora de escopo do spec (recorrência, OAuth, página dedicada, convite externo) permanece fora.

**Consistência de tipos:** `OfficeMeetingDTO` (Task 1) é o retorno de todo o service (Tasks 5–6), do serialize (Task 4), das rotas (Task 7) e do front (Tasks 10–11). `CalendarMeeting` (Task 3) é produzido só por `toCalendarMeeting` (Task 4) e consumido por `buildMeetingIcs`/`buildGoogleCalendarUrl`/`buildOutlookCalendarUrl`. `MEETING_INCLUDE` (Task 5) é reusado na Task 6. `officeRoomDeepLinkPath` (Task 1) é o único gerador do link, usado em Tasks 3, 5, 8 e 11. `meetingRoomEntryTile` (Task 9) é consumido só na Task 12.
