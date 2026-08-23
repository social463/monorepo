# Calendário corporativo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma rota `/calendario` no menu que mostra aniversários, tempo de casa, férias e reuniões do mês, com filtro por tipo e agendamento de reunião com seletor de sala — mais o cadastro de férias no painel onde o gestor já vê seus liderados.

**Architecture:** Backend ganha um model `Vacation` e um `vacation-service`, mais um `team-scope-service` que passa a ser o único dono da regra "quem eu gerencio" (hoje privada no `squad-mood-service`). Duas rotas existentes ficam mais flexíveis (`/celebrations?month=`, `/office/meetings` sem `room`) e `listActiveOfficeRooms` ganha uma porta para usuário comum. O front monta a tela a partir de três queries independentes, uma por filtro, e reaproveita o fluxo de reunião do escritório apenas adicionando um campo de sala ao formulário.

**Tech Stack:** Fastify 4 + Prisma 5 + PostgreSQL + Zod (api); Vite 5 + React 18 + React Query + React Router 6 + Tailwind 3 (web); Vitest nos dois lados.

**Spec:** `docs/superpowers/specs/2026-07-30-calendario-corporativo-design.md`

## Global Constraints

- Monorepo pnpm; tudo roda da raiz. Testes da API exigem Postgres de pé: `pnpm db:up` (ou `LEGENDS_DB_PORT=5442 pnpm db:up`, passando a mesma variável para os testes).
- Durante a implementação rode **só** o(s) arquivo(s) de teste tocados; a suíte completa (`pnpm test`) fica para a verificação final.
- TypeScript strict, ESM puro. Rota fina → service → Prisma. DTO em `apps/api/src/lib/serialize.ts`. Contrato em `@legends/shared` **primeiro**, depois os dois lados.
- Mensagens ao usuário em **português**.
- Migrations: gerar com `pnpm db:migrate`; **nunca** editar migration já aplicada.
- Datas civis (férias, aniversários) usam componentes **UTC**, nunca conversão para America/Sao_Paulo — o padrão de `civilDayMonth` em `celebration-service.ts:30`. Helpers em `apps/api/src/lib/sao-paulo-date.ts`: `dayFromYmd`, `ymdOf`, `monthBounds`.
- **Nomes de arquivo a evitar** (colidem com a branch `feat/integracao-calendario`, que não é esta feature): `apps/api/src/routes/calendar.ts`, `apps/api/src/services/calendar-*.ts`, `apps/web/src/lib/calendar-api.ts`, `packages/shared/src/calendar.ts`.
- Branch: `feat/calendario-corporativo` (já criada de `origin/main`).

---

## File Structure

**Criar**

| Arquivo | Responsabilidade |
|---|---|
| `packages/shared/src/vacation.ts` | Contrato de férias (DTO, requests, limites) |
| `apps/api/src/services/team-scope-service.ts` | Única definição de "quem eu gerencio" |
| `apps/api/src/services/team-scope-service.test.ts` | Matriz de papéis |
| `apps/api/src/services/vacation-service.ts` | Regra de negócio de férias |
| `apps/api/src/services/vacation-service.test.ts` | Sobreposição, permissão, escopo |
| `apps/api/src/routes/vacations.ts` | CRUD + `/me/team/vacations` |
| `apps/api/src/routes/vacations.test.ts` | Contrato HTTP |
| `apps/web/src/lib/vacations-api.ts` | Cliente HTTP de férias |
| `apps/web/src/lib/office-rooms-api.ts` | Cliente HTTP de salas |
| `apps/web/src/pages/calendar/calendar-events.ts` | Puro: grade do mês, eventos por dia, filtros da URL |
| `apps/web/src/pages/calendar/calendar-events.test.ts` | Testes do módulo puro |
| `apps/web/src/pages/calendar/useCalendarData.ts` | As três queries, cada uma atrelada ao seu filtro |
| `apps/web/src/pages/calendar/CalendarPage.tsx` | Tela: header, filtros, grade, painel |
| `apps/web/src/pages/calendar/CalendarPage.test.tsx` | Testes da tela |
| `apps/web/src/components/VacationDialog.tsx` | Formulário de férias (dois consumidores) |
| `apps/web/src/components/VacationDialog.test.tsx` | Testes do diálogo |
| `apps/web/src/pages/profile/TeamVacationsPanel.tsx` | Painel do gestor |
| `apps/web/src/pages/profile/TeamVacationsPanel.test.tsx` | Testes do painel |

**Modificar**

| Arquivo | Mudança |
|---|---|
| `apps/api/prisma/schema.prisma` | Model `Vacation` + relações em `User`/`Company` |
| `apps/api/test/setup.ts` | Truncar `vacation` |
| `apps/api/src/lib/serialize.ts` | `toVacationDTO`, `toOfficeRoomOption` |
| `apps/api/src/services/squad-mood-service.ts` | Passa a consumir `team-scope-service` |
| `apps/api/src/services/celebration-service.ts` | Parâmetro `monthRef` opcional |
| `apps/api/src/routes/celebrations.ts` | Query `?month=` |
| `apps/api/src/services/office-meeting-service.ts` | `listCompanyMeetings` |
| `apps/api/src/routes/office-meetings.ts` | `room` opcional + `mine` |
| `apps/api/src/routes/office-maps.ts` | `GET /office/rooms` |
| `apps/api/src/app.ts` | Registrar `vacationRoutes` |
| `packages/shared/src/index.ts` | Exportar `./vacation` |
| `packages/shared/src/third-party.ts` | `FeatureKey` `'calendario'` |
| `packages/shared/src/office-map.ts` | `OfficeRoomOptionDTO` |
| `apps/web/src/lib/use-celebrations.ts` | Aceita `monthRef` |
| `apps/web/src/office/meetings/MeetingForm.tsx` | Campo de sala |
| `apps/web/src/office/meetings/ScheduleMeetingModal.tsx` | Sala opcional + data inicial |
| `apps/web/src/pages/OfficePage.tsx` | Passa `initialDateLocal={null}` |
| `apps/web/src/pages/profile/SquadMoodPanel.tsx` | (nenhuma — só o service muda) |
| `apps/web/src/pages/ProfilePage.tsx` | Renderiza `TeamVacationsPanel` |
| `apps/web/src/pages/admin/CollaboratorsSection.tsx` | Ação "Férias" |
| `apps/web/src/components/nav-items.ts` | Item "Calendário" |
| `apps/web/src/App.tsx` | Rota `/calendario` + redirect |
| `apps/web/src/components/BirthdaysCard.tsx`, `WorkAnniversariesCard.tsx` | Apontam para `/calendario` |

**Remover:** `apps/web/src/pages/CelebrationsPage.tsx` e `CelebrationsPage.test.tsx`.

---

## Task 1: Contrato compartilhado

**Files:**
- Create: `packages/shared/src/vacation.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/third-party.ts`, `packages/shared/src/office-map.ts`
- Test: `packages/shared/src/vacation.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `VacationDTO`, `CreateVacationRequest`, `UpdateVacationRequest`, `TeamVacationsResponse`, `VacationsResponse`, `VACATION_NOTE_MAX_LENGTH`, `MAX_VACATION_RANGE_DAYS`, `overlaps(aStart, aEnd, bStart, bEnd)`; `OfficeRoomOptionDTO`; `FeatureKey` `'calendario'`.

- [ ] **Step 1: Escrever o teste que falha**

`packages/shared/src/vacation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { overlaps, VACATION_NOTE_MAX_LENGTH } from './vacation'
import { FEATURE_KEYS, FEATURE_LABELS } from './third-party'

describe('overlaps', () => {
  it('detecta interseção parcial nas duas direções', () => {
    expect(overlaps('2026-08-01', '2026-08-10', '2026-08-05', '2026-08-15')).toBe(true)
    expect(overlaps('2026-08-05', '2026-08-15', '2026-08-01', '2026-08-10')).toBe(true)
  })

  it('trata como sobreposição quando as bordas se encostam', () => {
    expect(overlaps('2026-08-01', '2026-08-10', '2026-08-10', '2026-08-12')).toBe(true)
  })

  it('não sobrepõe períodos disjuntos', () => {
    expect(overlaps('2026-08-01', '2026-08-10', '2026-08-11', '2026-08-12')).toBe(false)
  })

  it('detecta período contido em outro', () => {
    expect(overlaps('2026-08-01', '2026-08-31', '2026-08-10', '2026-08-12')).toBe(true)
  })
})

describe('feature calendario', () => {
  it('está na lista de features com label em português', () => {
    expect(FEATURE_KEYS).toContain('calendario')
    expect(FEATURE_LABELS.calendario).toBe('Calendário')
  })

  it('expõe o teto da observação', () => {
    expect(VACATION_NOTE_MAX_LENGTH).toBe(200)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/shared exec vitest run src/vacation.test.ts`
Expected: FAIL — `Failed to resolve import "./vacation"`.

- [ ] **Step 3: Criar `packages/shared/src/vacation.ts`**

```ts
import type { PublicUser } from './auth'

/** Observação livre do gestor no período ("Férias coletivas", "Emendou feriado"). */
export const VACATION_NOTE_MAX_LENGTH = 200

/** Teto do intervalo aceito em `GET /vacations` — impede que a rota vire dump. */
export const MAX_VACATION_RANGE_DAYS = 366

/**
 * Um período de férias. `startDate`/`endDate` são datas civis (YYYY-MM-DD),
 * inclusivas nas duas pontas: um período de um dia só tem start === end.
 */
export interface VacationDTO {
  id: string
  user: PublicUser
  startDate: string
  endDate: string
  note: string | null
}

export interface VacationsResponse {
  vacations: VacationDTO[]
}

export interface CreateVacationRequest {
  userId: string
  startDate: string
  endDate: string
  note?: string
}

/** Só o período e a observação mudam — trocar a pessoa é apagar e lançar de novo. */
export interface UpdateVacationRequest {
  startDate?: string
  endDate?: string
  note?: string | null
}

/** Um liderado com os períodos dele, no painel do gestor. */
export interface TeamMemberVacationsDTO {
  user: PublicUser
  vacations: VacationDTO[]
}

/** Agrupado como o painel de humor: uma entrada por squad (LEAD) ou uma pela área (MANAGER). */
export interface TeamVacationGroupDTO {
  groupId: string
  groupName: string
  members: TeamMemberVacationsDTO[]
}

export interface TeamVacationsResponse {
  groups: TeamVacationGroupDTO[]
}

/**
 * Dois intervalos fechados de datas civis se sobrepõem? Comparação de strings
 * YYYY-MM-DD é ordenação cronológica — nenhum `Date` envolvido, nenhum fuso.
 */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd
}
```

- [ ] **Step 4: Exportar no barril**

Em `packages/shared/src/index.ts`, ao lado de `export * from './celebration'`:

```ts
export * from './vacation'
```

- [ ] **Step 5: Adicionar a feature**

Em `packages/shared/src/third-party.ts`, dentro de `FEATURE_KEYS`, depois de `'time'`:

```ts
  'calendario',
```

E em `FEATURE_LABELS`:

```ts
  calendario: 'Calendário',
```

- [ ] **Step 6: Adicionar `OfficeRoomOptionDTO`**

Em `packages/shared/src/office-map.ts`, logo abaixo de `OfficeRoomDTO`:

```ts
/**
 * A sala vista por quem só vai marcar reunião: sem `id` (recriado a cada
 * publicação de mapa) e sem `allowedUsers` (a allowlist só interessa ao admin).
 */
export interface OfficeRoomOptionDTO {
  externalKey: string;
  name: string;
  capacity: number | null;
  status: "OPEN" | "LOCKED";
  voiceEnabled: boolean;
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @legends/shared exec vitest run src/vacation.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 8: Conferir que nada quebrou no contrato de features**

Run: `pnpm --filter @legends/shared exec vitest run`
Expected: PASS. Se algum teste fixar o tamanho de `FEATURE_KEYS`, atualize o número esperado.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/vacation.ts packages/shared/src/vacation.test.ts packages/shared/src/index.ts packages/shared/src/third-party.ts packages/shared/src/office-map.ts
git commit -m "feat(shared): contrato de férias, sala como opção e feature calendario"
```

---

## Task 2: Model `Vacation`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/test/setup.ts`, `apps/api/src/lib/serialize.ts`
- Test: `apps/api/src/lib/serialize.test.ts` (criar o `describe` se o arquivo já existir; criar o arquivo se não)

**Interfaces:**
- Consumes: `VacationDTO` (Task 1).
- Produces: `prisma.vacation`; `toVacationDTO(vacation: Vacation & { user: User }): VacationDTO`.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/src/lib/serialize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toVacationDTO } from './serialize'

// Um User mínimo é suficiente: toPublicUser já é testado à parte.
function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1', email: 'a@x.com', passwordHash: 'x', name: 'Ana', position: null, squad: null,
    photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null,
    officeCharacterName: null, teamsWebhookUrl: null, role: 'LEGEND', sectorId: 's1',
    companyId: 'c1', enabledFeatures: [], area: null, active: true, leftAt: null,
    joinedAt: new Date('2024-01-01T00:00:00.000Z'), birthDate: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'), updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('toVacationDTO', () => {
  it('devolve as datas civis em YYYY-MM-DD', () => {
    const dto = toVacationDTO({
      id: 'v1',
      userId: 'u1',
      startDate: new Date('2026-08-03T00:00:00.000Z'),
      endDate: new Date('2026-08-14T00:00:00.000Z'),
      note: 'Férias',
      createdById: 'u2',
      companyId: 'c1',
      createdAt: new Date(),
      updatedAt: new Date(),
      user: userRow() as never,
    } as never)

    expect(dto).toMatchObject({ id: 'v1', startDate: '2026-08-03', endDate: '2026-08-14', note: 'Férias' })
    expect(dto.user.id).toBe('u1')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/serialize.test.ts`
Expected: FAIL — `toVacationDTO` não existe.

- [ ] **Step 3: Adicionar o model ao schema**

Em `apps/api/prisma/schema.prisma`, depois do model `Feedback` (ou em qualquer ponto após `User`):

```prisma
/// Um período de férias de um colaborador, lançado pelo gestor ou pelo admin.
/// `@db.Date` porque férias são datas civis: sem hora, sem fuso — mesmo motivo
/// de `User.birthDate`.
model Vacation {
  id          String   @id @default(cuid())
  userId      String
  startDate   DateTime @db.Date
  endDate     DateTime @db.Date
  note        String?
  createdById String
  companyId   String   @default("company-emr")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user      User    @relation("Vacations", fields: [userId], references: [id], onDelete: Cascade)
  createdBy User    @relation("VacationsCreated", fields: [createdById], references: [id])
  company   Company @relation(fields: [companyId], references: [id])

  @@index([companyId, startDate])
  @@index([userId])
}
```

No model `User`, junto das outras relações:

```prisma
  vacations        Vacation[] @relation("Vacations")
  vacationsCreated Vacation[] @relation("VacationsCreated")
```

No model `Company`, junto das outras relações:

```prisma
  vacations Vacation[]
```

- [ ] **Step 4: Gerar a migration**

```bash
pnpm db:up
pnpm db:migrate
```

Quando o Prisma pedir o nome, use `add_vacation`. Confira que o SQL gerado cria `"startDate" DATE NOT NULL` (não `TIMESTAMP`).

- [ ] **Step 5: Truncar a tabela nos testes**

Em `apps/api/test/setup.ts`, dentro do `prisma.$transaction([...])`, **antes** de `prisma.user.deleteMany()`:

```ts
    prisma.vacation.deleteMany(),
```

- [ ] **Step 6: Escrever o serializer**

Em `apps/api/src/lib/serialize.ts`, ao lado dos outros DTOs (importe `VacationDTO` de `@legends/shared` e `Vacation` de `@prisma/client`, seguindo o estilo dos imports do arquivo):

```ts
/**
 * Datas civis saem como YYYY-MM-DD lidos em UTC: a coluna é `@db.Date` e
 * converter para America/Sao_Paulo jogaria todo período um dia para trás.
 */
export function toVacationDTO(vacation: Vacation & { user: User }): VacationDTO {
  return {
    id: vacation.id,
    user: toPublicUser(vacation.user),
    startDate: vacation.startDate.toISOString().slice(0, 10),
    endDate: vacation.endDate.toISOString().slice(0, 10),
    note: vacation.note,
  }
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/serialize.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/test/setup.ts apps/api/src/lib/serialize.ts apps/api/src/lib/serialize.test.ts
git commit -m "feat(api): modelo Vacation e serializer de férias"
```

---

## Task 3: `team-scope-service` — o dono da regra de gestão

**Files:**
- Create: `apps/api/src/services/team-scope-service.ts`, `apps/api/src/services/team-scope-service.test.ts`
- Modify: `apps/api/src/services/squad-mood-service.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces:
  - `managesUser(viewerId: string, targetId: string): Promise<boolean>`
  - `listManagedGroups(viewerId: string): Promise<ManagedGroup[]>` com `ManagedGroup = { groupId: string; groupName: string; members: User[] }` (`User` do `@prisma/client`, já ordenado por nome/entrada).

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/services/team-scope-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import { listManagedGroups, managesUser } from './team-scope-service'

async function makeUser(name: string, role: string, extra: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@x.com`, passwordHash: 'x', role: role as never, ...extra },
  })
}

describe('managesUser', () => {
  it('LEAD gerencia membro de squad que lidera', async () => {
    const lead = await makeUser('Lead', 'LEAD')
    const member = await makeUser('Membro', 'LEGEND')
    const squad = await prisma.squad.create({ data: { name: 'Squad A', slug: 'squad-a', leaderId: lead.id } })
    await prisma.squadMember.create({ data: { squadId: squad.id, userId: member.id } })

    expect(await managesUser(lead.id, member.id)).toBe(true)
  })

  it('LEAD não gerencia quem está fora das squads dele', async () => {
    const lead = await makeUser('Lead2', 'LEAD')
    const outro = await makeUser('Outro', 'LEGEND')
    await prisma.squad.create({ data: { name: 'Squad B', slug: 'squad-b', leaderId: lead.id } })

    expect(await managesUser(lead.id, outro.id)).toBe(false)
  })

  it('LEAD não gerencia através de squad inativa', async () => {
    const lead = await makeUser('Lead3', 'LEAD')
    const member = await makeUser('Membro3', 'LEGEND')
    const squad = await prisma.squad.create({ data: { name: 'Squad C', slug: 'squad-c', leaderId: lead.id, active: false } })
    await prisma.squadMember.create({ data: { squadId: squad.id, userId: member.id } })

    expect(await managesUser(lead.id, member.id)).toBe(false)
  })

  it('MANAGER gerencia lead/legend ativo da mesma área', async () => {
    const manager = await makeUser('Gestora', 'MANAGER', { area: 'ENGENHARIA' })
    const legend = await makeUser('Lenda', 'LEGEND', { area: 'ENGENHARIA' })
    const outraArea = await makeUser('Fora', 'LEGEND', { area: 'PRODUTO' })

    expect(await managesUser(manager.id, legend.id)).toBe(true)
    expect(await managesUser(manager.id, outraArea.id)).toBe(false)
  })

  it('MANAGER não gerencia quem está desligado', async () => {
    const manager = await makeUser('Gestor2', 'MANAGER', { area: 'ENGENHARIA' })
    const saiu = await makeUser('Saiu', 'LEGEND', { area: 'ENGENHARIA', leftAt: new Date() })

    expect(await managesUser(manager.id, saiu.id)).toBe(false)
  })

  it('LEGEND não gerencia ninguém', async () => {
    const legend = await makeUser('Lenda2', 'LEGEND')
    const outro = await makeUser('Outro2', 'LEGEND')

    expect(await managesUser(legend.id, outro.id)).toBe(false)
  })
})

describe('listManagedGroups', () => {
  it('LEAD recebe um grupo por squad liderada, sem ele mesmo', async () => {
    const lead = await makeUser('Lead4', 'LEAD')
    const member = await makeUser('Membro4', 'LEGEND')
    const squad = await prisma.squad.create({ data: { name: 'Squad D', slug: 'squad-d', leaderId: lead.id } })
    await prisma.squadMember.createMany({
      data: [{ squadId: squad.id, userId: member.id }, { squadId: squad.id, userId: lead.id }],
    })

    const groups = await listManagedGroups(lead.id)
    expect(groups).toHaveLength(1)
    expect(groups[0].groupName).toBe('Squad D')
    expect(groups[0].members.map((m) => m.id)).toEqual([member.id])
  })

  it('MANAGER recebe um grupo com a área', async () => {
    const manager = await makeUser('Gestor3', 'MANAGER', { area: 'ENGENHARIA' })
    const legend = await makeUser('Lenda3', 'LEGEND', { area: 'ENGENHARIA' })

    const groups = await listManagedGroups(manager.id)
    expect(groups).toHaveLength(1)
    expect(groups[0].groupId).toBe('area:ENGENHARIA')
    expect(groups[0].members.map((m) => m.id)).toEqual([legend.id])
  })

  it('LEGEND não recebe grupo nenhum', async () => {
    const legend = await makeUser('Lenda4', 'LEGEND')
    expect(await listManagedGroups(legend.id)).toEqual([])
  })
})
```

> Se `'ENGENHARIA'`/`'PRODUTO'` não forem valores válidos do enum `Area`, use os que existem em `packages/shared/src/enums.ts` (`AREA_LABELS`) — o teste só precisa de duas áreas diferentes.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/services/team-scope-service.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Escrever o service**

`apps/api/src/services/team-scope-service.ts`:

```ts
/**
 * Quem cada pessoa gerencia. Esta é a **única** definição da regra no backend —
 * o painel de humor do time e o lançamento de férias consomem daqui, para não
 * divergirem com o tempo.
 *
 * - LEAD: membros das squads ativas que ele lidera (ele mesmo fora).
 * - MANAGER: líderes e lendas ativos da mesma área, na mesma empresa.
 * - demais papéis (HEAD, LEGEND, ADMIN, SUBADMIN): ninguém — ADMIN/SUBADMIN não
 *   passam por aqui, têm passe livre checado na rota.
 */
import type { Area, User } from '@prisma/client'
import { AREA_LABELS } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'

/** Papéis que o manager acompanha (abaixo dele): liderança de squad e colaboradores. */
const MANAGED_ROLES = ['LEAD', 'LEGEND'] as const
const ACTIVE_MEMBER_WHERE = { active: true, leftAt: null } as const

export interface ManagedGroup {
  /** Id da squad, ou `area:<AREA>` no caso do manager. */
  groupId: string
  groupName: string
  members: User[]
}

export async function managesUser(viewerId: string, targetId: string): Promise<boolean> {
  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    select: { role: true, area: true, companyId: true },
  })
  if (!viewer) return false

  if (viewer.role === 'MANAGER') {
    if (!viewer.area) return false
    const target = await scopedPrisma(viewer.companyId).user.findFirst({
      where: { id: targetId, ...ACTIVE_MEMBER_WHERE, area: viewer.area, role: { in: [...MANAGED_ROLES] } },
      select: { id: true },
    })
    return Boolean(target)
  }

  if (viewer.role !== 'LEAD') return false

  // `leaderId` é id de usuário (globalmente único), então a empresa já está limitada.
  const shared = await prisma.squad.findFirst({
    where: {
      leaderId: viewerId,
      active: true,
      members: { some: { userId: targetId, user: ACTIVE_MEMBER_WHERE } },
    },
    select: { id: true },
  })
  return Boolean(shared)
}

export async function listManagedGroups(viewerId: string): Promise<ManagedGroup[]> {
  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    select: { role: true, area: true, companyId: true },
  })
  if (!viewer) return []
  if (viewer.role === 'MANAGER') return areaGroup(viewerId, viewer.area, viewer.companyId)
  if (viewer.role === 'LEAD') return ledSquadGroups(viewerId)
  return []
}

async function areaGroup(viewerId: string, area: Area | null, companyId: string): Promise<ManagedGroup[]> {
  if (!area) return []
  const members = await scopedPrisma(companyId).user.findMany({
    where: { area, ...ACTIVE_MEMBER_WHERE, role: { in: [...MANAGED_ROLES] }, id: { not: viewerId } },
    orderBy: { name: 'asc' },
  })
  return [{ groupId: `area:${area}`, groupName: AREA_LABELS[area], members }]
}

async function ledSquadGroups(leaderId: string): Promise<ManagedGroup[]> {
  const squads = await prisma.squad.findMany({
    where: { leaderId, active: true },
    include: {
      members: { where: { user: ACTIVE_MEMBER_WHERE }, include: { user: true }, orderBy: { joinedAt: 'asc' } },
    },
    orderBy: { name: 'asc' },
  })
  return squads.map((squad) => ({
    groupId: squad.id,
    groupName: squad.name,
    members: squad.members.filter((m) => m.userId !== leaderId).map((m) => m.user),
  }))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/team-scope-service.test.ts`
Expected: PASS (9 testes).

- [ ] **Step 5: Fazer o squad-mood consumir o novo módulo**

Em `apps/api/src/services/squad-mood-service.ts`:

1. Importe `import { listManagedGroups, managesUser } from './team-scope-service'`.
2. Substitua o corpo de `getTeamMoodGroups` por:

```ts
export async function getTeamMoodGroups(viewerId: string): Promise<LedSquadMoodsDTO[]> {
  const viewer = await prisma.user.findUnique({ where: { id: viewerId }, select: { companyId: true } })
  if (!viewer) return []
  const groups = await listManagedGroups(viewerId)
  const result: LedSquadMoodsDTO[] = []
  for (const group of groups) {
    result.push({
      squadId: group.groupId,
      squadName: group.groupName,
      members: await buildMemberMoodDTOs(group.members, viewer.companyId),
    })
  }
  return result
}
```

3. Substitua o corpo de `canSeeMoodHistory` por `return managesUser(viewerId, memberId)` (mantendo a função privada como fina camada, ou chamando `managesUser` direto em `getMemberMoodHistory` — escolha uma e apague a duplicata).
4. Apague o que ficou órfão: `getAreaMoodGroup`, `getLedSquadsWithMoods`, `MANAGED_ROLES`, `ACTIVE_MEMBER_WHERE` e os imports que só eles usavam (`Area`, `AREA_LABELS`). Se `getLedSquadsWithMoods` for importada em outro arquivo, ajuste o chamador para `listManagedGroups`.

Run: `grep -rn "getLedSquadsWithMoods" apps/api/src` para confirmar que não sobrou consumidor.

- [ ] **Step 6: Rodar a suíte do squad-mood**

Run: `pnpm --filter @legends/api exec vitest run src/services/squad-mood-service.test.ts src/routes/squad-mood.test.ts`
Expected: PASS, sem alterar nenhuma expectativa. Se um teste falhar, a extração mudou comportamento — corrija o service, não o teste.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/team-scope-service.ts apps/api/src/services/team-scope-service.test.ts apps/api/src/services/squad-mood-service.ts
git commit -m "refactor(api): extrai a regra de gestão para team-scope-service"
```

---

## Task 4: `vacation-service`

**Files:**
- Create: `apps/api/src/services/vacation-service.ts`, `apps/api/src/services/vacation-service.test.ts`

**Interfaces:**
- Consumes: `toVacationDTO` (Task 2), `managesUser`/`listManagedGroups` (Task 3), `VacationDTO`/`TeamVacationsResponse`/`overlaps` (Task 1).
- Produces:
  - `class VacationError extends Error { status: number }`
  - `createVacation(actorId: string, input: { userId: string; startDate: string; endDate: string; note: string | null }): Promise<VacationDTO>`
  - `updateVacation(actorId: string, id: string, patch: { startDate?: string; endDate?: string; note?: string | null }): Promise<VacationDTO>`
  - `deleteVacation(actorId: string, id: string): Promise<void>`
  - `listSectorVacations(viewerId: string, sectorId: string, from: string, to: string): Promise<VacationDTO[]>`
  - `listTeamVacations(viewerId: string): Promise<TeamVacationsResponse>`

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/services/vacation-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import {
  VacationError,
  createVacation,
  deleteVacation,
  listSectorVacations,
  listTeamVacations,
  updateVacation,
} from './vacation-service'

async function makeUser(name: string, role: string, extra: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@x.com`, passwordHash: 'x', role: role as never, ...extra },
  })
}

async function leadWithMember() {
  const lead = await makeUser('Lider', 'LEAD')
  const member = await makeUser('Liderado', 'LEGEND')
  const squad = await prisma.squad.create({ data: { name: 'Squad', slug: 'squad', leaderId: lead.id } })
  await prisma.squadMember.create({ data: { squadId: squad.id, userId: member.id } })
  return { lead, member }
}

describe('createVacation', () => {
  it('cria o período para um liderado', async () => {
    const { lead, member } = await leadWithMember()
    const dto = await createVacation(lead.id, {
      userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: 'Férias',
    })
    expect(dto).toMatchObject({ startDate: '2026-08-03', endDate: '2026-08-14', note: 'Férias' })
    expect(dto.user.id).toBe(member.id)
  })

  it('ADMIN lança para qualquer um da empresa', async () => {
    const admin = await makeUser('Admin', 'ADMIN')
    const alguem = await makeUser('Alguem', 'LEGEND')
    const dto = await createVacation(admin.id, {
      userId: alguem.id, startDate: '2026-09-01', endDate: '2026-09-05', note: null,
    })
    expect(dto.user.id).toBe(alguem.id)
  })

  it('recusa quem não gerencia o alvo (403)', async () => {
    const lead = await makeUser('Lider2', 'LEAD')
    const estranho = await makeUser('Estranho', 'LEGEND')
    await expect(
      createVacation(lead.id, { userId: estranho.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('recusa fim antes do início (400)', async () => {
    const { lead, member } = await leadWithMember()
    await expect(
      createVacation(lead.id, { userId: member.id, startDate: '2026-08-14', endDate: '2026-08-03', note: null }),
    ).rejects.toBeInstanceOf(VacationError)
  })

  it('recusa período que sobrepõe outro da mesma pessoa (400)', async () => {
    const { lead, member } = await leadWithMember()
    await createVacation(lead.id, { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null })
    await expect(
      createVacation(lead.id, { userId: member.id, startDate: '2026-08-14', endDate: '2026-08-20', note: null }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('aceita período colado no anterior sem sobrepor', async () => {
    const { lead, member } = await leadWithMember()
    await createVacation(lead.id, { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null })
    const segundo = await createVacation(lead.id, {
      userId: member.id, startDate: '2026-08-15', endDate: '2026-08-20', note: null,
    })
    expect(segundo.startDate).toBe('2026-08-15')
  })
})

describe('updateVacation', () => {
  it('edita ignorando o próprio registro na checagem de sobreposição', async () => {
    const { lead, member } = await leadWithMember()
    const dto = await createVacation(lead.id, { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null })
    const editado = await updateVacation(lead.id, dto.id, { endDate: '2026-08-18' })
    expect(editado.endDate).toBe('2026-08-18')
  })

  it('recusa edição de quem não gerencia o alvo (403)', async () => {
    const { lead, member } = await leadWithMember()
    const outro = await makeUser('Outro', 'LEGEND')
    const dto = await createVacation(lead.id, { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null })
    await expect(updateVacation(outro.id, dto.id, { endDate: '2026-08-18' })).rejects.toMatchObject({ status: 403 })
  })
})

describe('deleteVacation', () => {
  it('remove o período', async () => {
    const { lead, member } = await leadWithMember()
    const dto = await createVacation(lead.id, { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null })
    await deleteVacation(lead.id, dto.id)
    expect(await prisma.vacation.count()).toBe(0)
  })
})

describe('listSectorVacations', () => {
  it('traz só quem intersecta o intervalo, do mesmo setor', async () => {
    const { lead, member } = await leadWithMember()
    await createVacation(lead.id, { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null })
    await createVacation(lead.id, { userId: member.id, startDate: '2026-12-01', endDate: '2026-12-10', note: null })

    const agosto = await listSectorVacations(lead.id, lead.sectorId, '2026-08-01', '2026-08-31')
    expect(agosto.map((v) => v.startDate)).toEqual(['2026-08-03'])
  })

  it('inclui período que começa antes e termina depois da janela', async () => {
    const { lead, member } = await leadWithMember()
    await createVacation(lead.id, { userId: member.id, startDate: '2026-07-20', endDate: '2026-08-10', note: null })
    const agosto = await listSectorVacations(lead.id, lead.sectorId, '2026-08-01', '2026-08-31')
    expect(agosto).toHaveLength(1)
  })

  it('não vaza férias de outro setor', async () => {
    const { lead, member } = await leadWithMember()
    const outroSetor = await prisma.sector.create({ data: { name: 'Outro', slug: 'outro' } })
    await prisma.user.update({ where: { id: member.id }, data: { sectorId: outroSetor.id } })
    await createVacation(lead.id, { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null })

    expect(await listSectorVacations(lead.id, lead.sectorId, '2026-08-01', '2026-08-31')).toEqual([])
  })
})

describe('listTeamVacations', () => {
  it('agrupa os liderados com seus períodos', async () => {
    const { lead, member } = await leadWithMember()
    await createVacation(lead.id, { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null })

    const { groups } = await listTeamVacations(lead.id)
    expect(groups).toHaveLength(1)
    expect(groups[0].members[0].user.id).toBe(member.id)
    expect(groups[0].members[0].vacations.map((v) => v.startDate)).toEqual(['2026-08-03'])
  })

  it('devolve vazio para quem não lidera ninguém', async () => {
    const legend = await makeUser('Lenda', 'LEGEND')
    expect((await listTeamVacations(legend.id)).groups).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/services/vacation-service.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Escrever o service**

`apps/api/src/services/vacation-service.ts`:

```ts
/**
 * Férias dos colaboradores. Quem lança é o gestor direto (regra em
 * team-scope-service) ou um admin da empresa; quem enxerga é todo o setor —
 * mesma regra de visibilidade dos aniversários.
 *
 * Datas são civis (YYYY-MM-DD) do começo ao fim: entram como string, viram
 * `Date` à meia-noite UTC no banco (`@db.Date`) e voltam a string na saída.
 */
import { overlaps, type TeamVacationsResponse, type VacationDTO } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { dayFromYmd, ymdOf } from '../lib/sao-paulo-date'
import { toPublicUser, toVacationDTO } from '../lib/serialize'
import { listManagedGroups, managesUser } from './team-scope-service'

export class VacationError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
    this.name = 'VacationError'
  }
}

const WITH_USER = { user: true } as const

/** Papéis fora do time (não recebem nem aparecem em férias), igual ao /celebrations. */
const SECTOR_ROLES_EXCLUDED = ['ADMIN', 'SUBADMIN', 'THIRD_PARTY'] as const

/**
 * Só o gestor direto do alvo — ou um admin da mesma empresa — mexe nas férias
 * de alguém. ADMIN/SUBADMIN não passam pelo team-scope: eles não gerenciam
 * ninguém no sentido de squad, mas administram a empresa inteira.
 */
async function assertCanManage(actorId: string, targetUserId: string): Promise<void> {
  const [actor, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: actorId }, select: { role: true, companyId: true } }),
    prisma.user.findUnique({ where: { id: targetUserId }, select: { companyId: true } }),
  ])
  if (!actor || !target) throw new VacationError('Usuário não encontrado.', 404)
  if (actor.companyId !== target.companyId) {
    throw new VacationError('Sem permissão para lançar férias desta pessoa.', 403)
  }
  if (actor.role === 'ADMIN' || actor.role === 'SUBADMIN') return
  if (await managesUser(actorId, targetUserId)) return
  throw new VacationError('Sem permissão para lançar férias desta pessoa.', 403)
}

/** Valida a janela e recusa sobreposição com outro período da mesma pessoa. */
async function assertValidRange(
  userId: string,
  startDate: string,
  endDate: string,
  ignoreId: string | null,
): Promise<void> {
  if (endDate < startDate) {
    throw new VacationError('A data de fim não pode ser anterior à de início.')
  }
  const existing = await prisma.vacation.findMany({
    where: { userId, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
    orderBy: { startDate: 'asc' },
  })
  const clash = existing.find((v) => overlaps(startDate, endDate, ymdOf(v.startDate), ymdOf(v.endDate)))
  if (clash) {
    throw new VacationError(
      `Já existe um período de ${ymdOf(clash.startDate)} a ${ymdOf(clash.endDate)} para esta pessoa.`,
    )
  }
}

export interface CreateVacationInput {
  userId: string
  startDate: string
  endDate: string
  note: string | null
}

export async function createVacation(actorId: string, input: CreateVacationInput): Promise<VacationDTO> {
  await assertCanManage(actorId, input.userId)
  await assertValidRange(input.userId, input.startDate, input.endDate, null)
  const target = await prisma.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { companyId: true },
  })
  const created = await prisma.vacation.create({
    data: {
      userId: input.userId,
      startDate: dayFromYmd(input.startDate),
      endDate: dayFromYmd(input.endDate),
      note: input.note,
      createdById: actorId,
      companyId: target.companyId,
    },
    include: WITH_USER,
  })
  return toVacationDTO(created)
}

export interface UpdateVacationPatch {
  startDate?: string
  endDate?: string
  note?: string | null
}

export async function updateVacation(
  actorId: string,
  id: string,
  patch: UpdateVacationPatch,
): Promise<VacationDTO> {
  const current = await prisma.vacation.findUnique({ where: { id } })
  if (!current) throw new VacationError('Período não encontrado.', 404)
  await assertCanManage(actorId, current.userId)

  const startDate = patch.startDate ?? ymdOf(current.startDate)
  const endDate = patch.endDate ?? ymdOf(current.endDate)
  await assertValidRange(current.userId, startDate, endDate, id)

  const updated = await prisma.vacation.update({
    where: { id },
    data: {
      startDate: dayFromYmd(startDate),
      endDate: dayFromYmd(endDate),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
    },
    include: WITH_USER,
  })
  return toVacationDTO(updated)
}

export async function deleteVacation(actorId: string, id: string): Promise<void> {
  const current = await prisma.vacation.findUnique({ where: { id } })
  if (!current) throw new VacationError('Período não encontrado.', 404)
  await assertCanManage(actorId, current.userId)
  await prisma.vacation.delete({ where: { id } })
}

/**
 * Férias visíveis para quem está olhando: dos colegas ativos do mesmo setor e
 * da mesma empresa, que intersectem a janela pedida (inclusiva nas pontas).
 */
export async function listSectorVacations(
  viewerId: string,
  sectorId: string,
  from: string,
  to: string,
): Promise<VacationDTO[]> {
  const viewer = await prisma.user.findUniqueOrThrow({ where: { id: viewerId }, select: { companyId: true } })
  const rows = await scopedPrisma(viewer.companyId).vacation.findMany({
    where: {
      startDate: { lte: dayFromYmd(to) },
      endDate: { gte: dayFromYmd(from) },
      user: { active: true, leftAt: null, sectorId, role: { notIn: [...SECTOR_ROLES_EXCLUDED] } },
    },
    include: WITH_USER,
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
  })
  return rows.map(toVacationDTO)
}

/** O painel do gestor: cada liderado com seus períodos, do mais recente em diante. */
export async function listTeamVacations(viewerId: string): Promise<TeamVacationsResponse> {
  const groups = await listManagedGroups(viewerId)
  const memberIds = groups.flatMap((group) => group.members.map((m) => m.id))
  if (memberIds.length === 0) return { groups: [] }

  const rows = await prisma.vacation.findMany({
    where: { userId: { in: memberIds } },
    include: WITH_USER,
    orderBy: { startDate: 'asc' },
  })
  const byUser = new Map<string, VacationDTO[]>()
  for (const row of rows) {
    const list = byUser.get(row.userId) ?? []
    list.push(toVacationDTO(row))
    byUser.set(row.userId, list)
  }

  return {
    groups: groups.map((group) => ({
      groupId: group.groupId,
      groupName: group.groupName,
      members: group.members.map((member) => ({
        user: toPublicUser(member),
        vacations: byUser.get(member.id) ?? [],
      })),
    })),
  }
}
```

> `toPublicUser` vem do mesmo `../lib/serialize` que já traz `toVacationDTO` — some os dois no mesmo import.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/vacation-service.test.ts`
Expected: PASS (13 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/vacation-service.ts apps/api/src/services/vacation-service.test.ts
git commit -m "feat(api): serviço de férias com regra de sobreposição e permissão"
```

---

## Task 5: Rotas de férias

**Files:**
- Create: `apps/api/src/routes/vacations.ts`, `apps/api/src/routes/vacations.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: tudo da Task 4.
- Produces: `vacationRoutes(app: FastifyInstance)`; endpoints `GET /vacations`, `POST /vacations`, `PATCH /vacations/:id`, `DELETE /vacations/:id`, `GET /me/team/vacations`.

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/routes/vacations.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function registerUser(app: Awaited<ReturnType<typeof buildApp>>, name: string, email: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { name, email, password: 'changeme123' } })
  return { token: res.json().accessToken as string, id: res.json().user.id as string }
}

describe('rotas de férias', () => {
  it('exige autenticação', async () => {
    const app = buildApp()
    await app.ready()
    expect((await app.inject({ method: 'GET', url: '/vacations?from=2026-08-01&to=2026-08-31' })).statusCode).toBe(401)
    await app.close()
  })

  it('lança e lista as férias de um liderado', async () => {
    const app = buildApp()
    await app.ready()
    const lead = await registerUser(app, 'Lider', 'lead-vac@x.com')
    const member = await registerUser(app, 'Liderado', 'member-vac@x.com')
    await prisma.user.update({ where: { id: lead.id }, data: { role: 'LEAD' } })
    const squad = await prisma.squad.create({ data: { name: 'Squad', slug: 'squad-vac', leaderId: lead.id } })
    await prisma.squadMember.create({ data: { squadId: squad.id, userId: member.id } })

    const created = await app.inject({
      method: 'POST',
      url: '/vacations',
      headers: { authorization: `Bearer ${lead.token}` },
      payload: { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: 'Férias' },
    })
    expect(created.statusCode).toBe(201)

    const list = await app.inject({
      method: 'GET',
      url: '/vacations?from=2026-08-01&to=2026-08-31',
      headers: { authorization: `Bearer ${lead.token}` },
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().vacations.map((v: { startDate: string }) => v.startDate)).toEqual(['2026-08-03'])
    await app.close()
  })

  it('recusa lançamento de quem não gerencia (403)', async () => {
    const app = buildApp()
    await app.ready()
    const autor = await registerUser(app, 'Qualquer', 'qualquer-vac@x.com')
    const alvo = await registerUser(app, 'Alvo', 'alvo-vac@x.com')

    const res = await app.inject({
      method: 'POST',
      url: '/vacations',
      headers: { authorization: `Bearer ${autor.token}` },
      payload: { userId: alvo.id, startDate: '2026-08-03', endDate: '2026-08-14' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('recusa payload inválido (400)', async () => {
    const app = buildApp()
    await app.ready()
    const autor = await registerUser(app, 'Autor', 'autor-vac@x.com')
    const res = await app.inject({
      method: 'POST',
      url: '/vacations',
      headers: { authorization: `Bearer ${autor.token}` },
      payload: { userId: autor.id, startDate: '03/08/2026', endDate: '2026-08-14' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('recusa intervalo maior que 366 dias (400)', async () => {
    const app = buildApp()
    await app.ready()
    const autor = await registerUser(app, 'Autor2', 'autor2-vac@x.com')
    const res = await app.inject({
      method: 'GET',
      url: '/vacations?from=2026-01-01&to=2027-06-01',
      headers: { authorization: `Bearer ${autor.token}` },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('edita e remove o período', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-vac@x.com')
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } })
    const alvo = await registerUser(app, 'Alvo2', 'alvo2-vac@x.com')

    const created = await app.inject({
      method: 'POST', url: '/vacations', headers: { authorization: `Bearer ${admin.token}` },
      payload: { userId: alvo.id, startDate: '2026-08-03', endDate: '2026-08-14' },
    })
    const id = created.json().vacation.id as string

    const patched = await app.inject({
      method: 'PATCH', url: `/vacations/${id}`, headers: { authorization: `Bearer ${admin.token}` },
      payload: { endDate: '2026-08-18' },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().vacation.endDate).toBe('2026-08-18')

    const deleted = await app.inject({
      method: 'DELETE', url: `/vacations/${id}`, headers: { authorization: `Bearer ${admin.token}` },
    })
    expect(deleted.statusCode).toBe(204)
    expect(await prisma.vacation.count()).toBe(0)
    await app.close()
  })

  it('GET /me/team/vacations devolve os grupos do gestor', async () => {
    const app = buildApp()
    await app.ready()
    const lead = await registerUser(app, 'Lider2', 'lead2-vac@x.com')
    const member = await registerUser(app, 'Liderado2', 'member2-vac@x.com')
    await prisma.user.update({ where: { id: lead.id }, data: { role: 'LEAD' } })
    const squad = await prisma.squad.create({ data: { name: 'Squad2', slug: 'squad2-vac', leaderId: lead.id } })
    await prisma.squadMember.create({ data: { squadId: squad.id, userId: member.id } })

    const res = await app.inject({
      method: 'GET', url: '/me/team/vacations', headers: { authorization: `Bearer ${lead.token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().groups[0].members[0].user.id).toBe(member.id)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/vacations.test.ts`
Expected: FAIL — 404 nas rotas.

- [ ] **Step 3: Escrever as rotas**

`apps/api/src/routes/vacations.ts`:

```ts
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { MAX_VACATION_RANGE_DAYS, VACATION_NOTE_MAX_LENGTH } from '@legends/shared'
import {
  VacationError,
  createVacation,
  deleteVacation,
  listSectorVacations,
  listTeamVacations,
  updateVacation,
} from '../services/vacation-service'

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD')

const listQuerySchema = z
  .object({ from: ymd, to: ymd })
  .refine(({ from, to }) => from <= to, { message: 'O início do intervalo deve vir antes do fim' })
  .refine(
    ({ from, to }) => (Date.parse(to) - Date.parse(from)) / 86_400_000 <= MAX_VACATION_RANGE_DAYS,
    { message: `O intervalo não pode passar de ${MAX_VACATION_RANGE_DAYS} dias` },
  )

const createSchema = z.object({
  userId: z.string().min(1),
  startDate: ymd,
  endDate: ymd,
  note: z.string().trim().max(VACATION_NOTE_MAX_LENGTH).optional(),
})

const updateSchema = z
  .object({
    startDate: ymd.optional(),
    endDate: ymd.optional(),
    note: z.string().trim().max(VACATION_NOTE_MAX_LENGTH).nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nada para atualizar' })

const idParamsSchema = z.object({ id: z.string().min(1) })

function badInput(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ message: 'Dados inválidos', issues: error.issues })
}

function sendDomainError(reply: FastifyReply, err: unknown) {
  if (err instanceof VacationError) return reply.code(err.status).send({ message: err.message })
  throw err
}

export async function vacationRoutes(app: FastifyInstance) {
  const authed = { onRequest: [app.authenticate] }

  app.get('/vacations', authed, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return badInput(reply, parsed.error)
    const vacations = await listSectorVacations(
      request.user.sub,
      request.user.sectorId,
      parsed.data.from,
      parsed.data.to,
    )
    return reply.send({ vacations })
  })

  app.post('/vacations', authed, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      const vacation = await createVacation(request.user.sub, {
        userId: parsed.data.userId,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        note: parsed.data.note ?? null,
      })
      return reply.code(201).send({ vacation })
    } catch (err) {
      return sendDomainError(reply, err)
    }
  })

  app.patch('/vacations/:id', authed, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      const vacation = await updateVacation(request.user.sub, params.data.id, parsed.data)
      return reply.send({ vacation })
    } catch (err) {
      return sendDomainError(reply, err)
    }
  })

  app.delete('/vacations/:id', authed, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    try {
      await deleteVacation(request.user.sub, params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return sendDomainError(reply, err)
    }
  })

  app.get('/me/team/vacations', authed, async (request, reply) => {
    return reply.send(await listTeamVacations(request.user.sub))
  })
}
```

> Confirme como `request.user.sectorId` é exposto no JWT (veja `apps/api/src/routes/celebrations.ts`, que usa exatamente isso). Se o nome divergir, use o mesmo campo daquele arquivo.

- [ ] **Step 4: Registrar no app**

Em `apps/api/src/app.ts`, junto dos outros imports de rota:

```ts
import { vacationRoutes } from './routes/vacations'
```

E ao lado de `app.register(celebrationRoutes)`:

```ts
  app.register(vacationRoutes)
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/vacations.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/vacations.ts apps/api/src/routes/vacations.test.ts apps/api/src/app.ts
git commit -m "feat(api): rotas de férias"
```

---

## Task 6: `GET /celebrations?month=`

**Files:**
- Modify: `apps/api/src/services/celebration-service.ts`, `apps/api/src/routes/celebrations.ts`
- Test: `apps/api/src/services/celebration-service.test.ts`, `apps/api/src/routes/celebrations.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `getCelebrations(viewerId, viewerSectorId, now?, monthRef?: string)` — `monthRef` em `YYYY-MM`; `CelebrationsResponse` inalterado.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/src/services/celebration-service.test.ts`, novo `describe` (reaproveite os helpers de criação de usuário já existentes no arquivo):

```ts
describe('getCelebrations com mês explícito', () => {
  it('devolve o mês pedido e mantém "hoje" no dia real', async () => {
    const viewer = await makeUser('Quem Olha', { })
    await makeUser('Agosto', { birthDate: new Date('1990-08-10T00:00:00.000Z') })
    await makeUser('Julho', { birthDate: new Date('1990-07-05T00:00:00.000Z') })

    const now = new Date('2026-07-05T12:00:00.000Z')
    const res = await getCelebrations(viewer.id, viewer.sectorId, now, '2026-08')

    expect(res.birthdays.month.map((b) => b.day)).toEqual([10])
    // "hoje" continua sendo 05/07 — quem faz aniversário hoje não some ao navegar.
    expect(res.birthdays.today.map((b) => b.day)).toEqual([5])
    expect(res.referenceDay).toBe('2026-07-05')
  })

  it('conta anos de casa relativos ao ano pedido', async () => {
    const viewer = await makeUser('Viewer2', {})
    await makeUser('Veterana', { joinedAt: new Date('2020-08-10T00:00:00.000Z') })

    const res = await getCelebrations(viewer.id, viewer.sectorId, new Date('2026-07-05T12:00:00.000Z'), '2027-08')
    expect(res.workAnniversaries.month.map((w) => w.years)).toEqual([7])
  })
})
```

E em `apps/api/src/routes/celebrations.test.ts`:

```ts
  it('recusa month em formato inválido (400)', async () => {
    const app = buildApp()
    await app.ready()
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'M', email: 'cel-month@x.com', password: 'changeme123' } })
    const token = reg.json().accessToken as string
    const res = await app.inject({ method: 'GET', url: '/celebrations?month=2026-13-01', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/services/celebration-service.test.ts src/routes/celebrations.test.ts`
Expected: FAIL — `getCelebrations` ignora o 4º argumento; a rota devolve 200 com month inválido.

- [ ] **Step 3: Refatorar o service**

Em `apps/api/src/services/celebration-service.ts`, extraia a montagem por (ano, mês) e use duas vezes. Substitua o trecho a partir de `const birthdays: ...` pelo seguinte, mantendo `observedDay`, `civilDayMonth` e a query de `users` como estão.

**`collect` fica declarada dentro de `getCelebrations`**, logo após a query de `users` — assim ela fecha sobre `users` e não precisa de um tipo nomeado para as linhas do Prisma:

```ts
/**
 * Aniversários e tempo de casa daquele mês naquele ano. Chamado duas vezes:
 * uma para o dia de hoje (ano/mês correntes) e outra para o mês exibido na
 * tela — que pode ser de outro ano, e aí a contagem de "anos de casa" muda.
 */
function collect(rows: typeof users, year: number, month: number) {
  const birthdays: { dto: BirthdayDTO; observed: number }[] = []
  const workAnniversaries: { dto: WorkAnniversaryDTO; observed: number }[] = []

  for (const user of rows) {
    if (user.birthDate) {
      const { day: d, month: m } = civilDayMonth(user.birthDate)
      if (m === month) {
        birthdays.push({ dto: { user: toPublicUser(user), day: d, month: m }, observed: observedDay(m, d, year) })
      }
    }
    const { day: jd, month: jm } = civilDayMonth(user.joinedAt)
    const years = year - user.joinedAt.getUTCFullYear()
    // Quem entrou neste mesmo ano ainda não tem aniversário de casa a comemorar.
    if (jm === month && years >= 1) {
      workAnniversaries.push({
        dto: { user: toPublicUser(user), day: jd, month: jm, years },
        observed: observedDay(jm, jd, year),
      })
    }
  }

  // Ordem do mês: dia crescente e, dentro do dia, o nome (a query já veio alfabética).
  birthdays.sort((a, b) => a.dto.day - b.dto.day)
  workAnniversaries.sort((a, b) => a.dto.day - b.dto.day)
  return { birthdays, workAnniversaries }
}

const current = collect(users, year, month)
const [targetYear, targetMonth] = monthRef ? monthRef.split('-').map(Number) : [year, month]
const target = monthRef ? collect(users, targetYear, targetMonth) : current

return {
  referenceDay,
  birthdays: {
    today: current.birthdays.filter((e) => e.observed === day).map((e) => e.dto),
    month: target.birthdays.map((e) => e.dto),
  },
  workAnniversaries: {
    today: current.workAnniversaries.filter((e) => e.observed === day).map((e) => e.dto),
    month: target.workAnniversaries.map((e) => e.dto),
  },
}
```

E na assinatura:

```ts
export async function getCelebrations(
  viewerId: string,
  viewerSectorId: string,
  now: Date = new Date(),
  /** Mês exibido na tela, YYYY-MM. Ausente = mês corrente. */
  monthRef?: string,
): Promise<CelebrationsResponse> {
```

- [ ] **Step 4: Aceitar o parâmetro na rota**

`apps/api/src/routes/celebrations.ts` inteiro:

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getCelebrations } from '../services/celebration-service'

const querySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês deve estar no formato AAAA-MM')
    .optional(),
})

export async function celebrationRoutes(app: FastifyInstance) {
  app.get('/celebrations', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const celebrations = await getCelebrations(
      request.user.sub,
      request.user.sectorId,
      new Date(),
      parsed.data.month,
    )
    return reply.send(celebrations)
  })
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/celebration-service.test.ts src/routes/celebrations.test.ts`
Expected: PASS — inclusive todos os testes que já existiam, sem alteração.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/celebration-service.ts apps/api/src/services/celebration-service.test.ts apps/api/src/routes/celebrations.ts apps/api/src/routes/celebrations.test.ts
git commit -m "feat(api): /celebrations aceita mês explícito"
```

---

## Task 7: `GET /office/rooms`

**Files:**
- Modify: `apps/api/src/routes/office-maps.ts`, `apps/api/src/lib/serialize.ts`
- Test: `apps/api/src/routes/office-maps.test.ts`

**Interfaces:**
- Consumes: `OfficeRoomOptionDTO` (Task 1), `listActiveOfficeRooms` (já existe).
- Produces: `GET /office/rooms` → `{ rooms: OfficeRoomOptionDTO[] }`; `toOfficeRoomOption(room: OfficeRoomDTO): OfficeRoomOptionDTO`.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/src/routes/office-maps.test.ts`, novo `describe` (reaproveite os helpers do arquivo para publicar um mapa com sala; se não houver, copie o setup do teste que exercita `/admin/office-rooms`):

```ts
describe('GET /office/rooms', () => {
  it('devolve as salas do mapa ativo sem a allowlist', async () => {
    // …setup existente que publica um mapa com uma sala chamada 'Sala 1'…
    const res = await app.inject({ method: 'GET', url: '/office/rooms', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const rooms = res.json().rooms as Array<Record<string, unknown>>
    expect(rooms.map((r) => r.name)).toContain('Sala 1')
    expect(rooms[0]).not.toHaveProperty('allowedUsers')
    expect(rooms[0]).not.toHaveProperty('id')
    expect(rooms[0]).toHaveProperty('externalKey')
  })

  it('devolve lista vazia quando não há mapa publicado', async () => {
    const res = await app.inject({ method: 'GET', url: '/office/rooms', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().rooms).toEqual([])
  })

  it('exige autenticação', async () => {
    expect((await app.inject({ method: 'GET', url: '/office/rooms' })).statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/office-maps.test.ts -t "GET /office/rooms"`
Expected: FAIL — 404.

- [ ] **Step 3: Escrever o serializer**

Em `apps/api/src/lib/serialize.ts`:

```ts
/** A sala reduzida ao que interessa a quem só vai marcar reunião. */
export function toOfficeRoomOption(room: OfficeRoomDTO): OfficeRoomOptionDTO {
  return {
    externalKey: room.externalKey,
    name: room.name,
    capacity: room.capacity,
    status: room.status,
    voiceEnabled: room.voiceEnabled,
  }
}
```

- [ ] **Step 4: Escrever a rota**

Em `apps/api/src/routes/office-maps.ts`, logo abaixo da linha de `GET /office/map`:

```ts
  /**
   * As salas para o seletor de "marcar reunião". Não exige a feature
   * `escritorio`: quem usa o Calendário pode marcar numa sala sem ter o
   * escritório virtual habilitado. Convidado não marca reunião (mesma regra de
   * `/office/meetings`), então também não vê a lista.
   */
  app.get('/office/rooms', { onRequest: [app.authenticate] }, async (request, reply) => {
    if (request.user.role === 'GUEST') {
      return reply.code(403).send({ message: 'Convidado não vê as salas' })
    }
    const rooms = await listActiveOfficeRooms(request.user.companyId)
    return { rooms: rooms.map(toOfficeRoomOption) }
  })
```

Importe `toOfficeRoomOption` de `../lib/serialize`.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/office-maps.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/office-maps.ts apps/api/src/routes/office-maps.test.ts apps/api/src/lib/serialize.ts
git commit -m "feat(api): lista de salas para usuário comum"
```

---

## Task 8: `GET /office/meetings` sem sala

**Files:**
- Modify: `apps/api/src/services/office-meeting-service.ts`, `apps/api/src/routes/office-meetings.ts`
- Test: `apps/api/src/routes/office-meetings.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `listCompanyMeetings(companyId: string, opts: { participantId: string | null; from: Date; to: Date }): Promise<OfficeMeetingDTO[]>`; query `?room=&mine=&from=&to=`.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/src/routes/office-meetings.test.ts`, novo `describe` (reaproveite os helpers de criação de reunião do arquivo):

```ts
describe('GET /office/meetings sem sala', () => {
  it('traz só as reuniões em que o usuário está envolvido', async () => {
    // Ana organiza na sala-1 e convida Bruno; Carla organiza na sala-2 sozinha.
    // …setup com os helpers do arquivo…
    const res = await app.inject({
      method: 'GET',
      url: `/office/meetings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: { authorization: `Bearer ${brunoToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().map((m: { title: string }) => m.title)).toEqual(['Planning'])
  })

  it('com mine=false traz as reuniões de todas as salas', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/office/meetings?mine=false&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: { authorization: `Bearer ${brunoToken}` },
    })
    expect(res.json().map((m: { title: string }) => m.title).sort()).toEqual(['Planning', 'Review'])
  })

  it('não traz reunião cancelada', async () => {
    await app.inject({ method: 'DELETE', url: `/office/meetings/${planningId}`, headers: { authorization: `Bearer ${anaToken}` } })
    const res = await app.inject({
      method: 'GET',
      url: `/office/meetings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: { authorization: `Bearer ${brunoToken}` },
    })
    expect(res.json()).toEqual([])
  })

  it('recusa intervalo maior que 62 dias (400)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/office/meetings?from=2026-01-01T00:00:00.000Z&to=2026-06-01T00:00:00.000Z',
      headers: { authorization: `Bearer ${brunoToken}` },
    })
    expect(res.statusCode).toBe(400)
  })

  it('com room continua listando a agenda da sala inteira', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/office/meetings?room=sala-2',
      headers: { authorization: `Bearer ${brunoToken}` },
    })
    expect(res.json().map((m: { title: string }) => m.title)).toEqual(['Review'])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/office-meetings.test.ts -t "sem sala"`
Expected: FAIL — 400, porque `room` ainda é obrigatório.

- [ ] **Step 3: Escrever o service**

Em `apps/api/src/services/office-meeting-service.ts`, ao lado de `listRoomMeetings`:

```ts
/**
 * Agenda da empresa no intervalo, para o Calendário. Diferente da agenda da
 * sala, aqui reunião cancelada não aparece: o calendário mostra o que vai
 * acontecer, não o histórico do que foi desmarcado.
 */
export async function listCompanyMeetings(
  companyId: string,
  opts: { participantId: string | null; from: Date; to: Date },
): Promise<OfficeMeetingDTO[]> {
  const db = scopedPrisma(companyId)
  const rows = await db.officeMeeting.findMany({
    where: {
      startsAt: { gte: opts.from, lt: opts.to },
      canceled: false,
      ...(opts.participantId
        ? {
            OR: [
              { organizerId: opts.participantId },
              { participants: { some: { userId: opts.participantId } } },
            ],
          }
        : {}),
    },
    include: MEETING_INCLUDE,
    orderBy: { startsAt: 'asc' },
  })
  return rows.map((row) => toOfficeMeetingDTO(row as MeetingWithPeople))
}
```

> Confirme o nome da coluna do organizador no schema (`organizerId`) com `grep -n "model OfficeMeeting" -A 20 apps/api/prisma/schema.prisma`.

- [ ] **Step 4: Ajustar a rota**

Em `apps/api/src/routes/office-meetings.ts`, troque `listQuerySchema` e o handler do `GET`:

```ts
/** Teto do intervalo da agenda da empresa — impede que a rota vire dump. */
const MAX_AGENDA_RANGE_DAYS = 62

const listQuerySchema = z.object({
  /** Ausente = agenda da empresa (as minhas, salvo `mine=false`). */
  room: z.string().min(1).optional(),
  mine: z.enum(['true', 'false']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})
```

```ts
  app.get('/office/meetings', authed, async (request, reply): Promise<OfficeMeetingDTO[] | FastifyReply> => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não vê a agenda da sala' })
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return badInput(reply, parsed.error)
    const from = parsed.data.from ? new Date(parsed.data.from) : new Date()
    const to = parsed.data.to
      ? new Date(parsed.data.to)
      : new Date(from.getTime() + MEETING_AGENDA_DAYS_AHEAD * 24 * 60 * 60 * 1000)

    if (parsed.data.room) {
      return listRoomMeetings(request.user.companyId, parsed.data.room, from, to)
    }

    if (to.getTime() - from.getTime() > MAX_AGENDA_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      return reply.code(400).send({ message: `O intervalo não pode passar de ${MAX_AGENDA_RANGE_DAYS} dias` })
    }
    return listCompanyMeetings(request.user.companyId, {
      participantId: parsed.data.mine === 'false' ? null : request.user.sub,
      from,
      to,
    })
  })
```

Importe `listCompanyMeetings` do service.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/office-meetings.test.ts`
Expected: PASS — inclusive os testes antigos com `room`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/office-meeting-service.ts apps/api/src/routes/office-meetings.ts apps/api/src/routes/office-meetings.test.ts
git commit -m "feat(api): agenda da empresa em /office/meetings sem sala"
```

---

## Task 9: Módulo puro do calendário

**Files:**
- Create: `apps/web/src/pages/calendar/calendar-events.ts`, `apps/web/src/pages/calendar/calendar-events.test.ts`

**Interfaces:**
- Consumes: `BirthdayDTO`, `WorkAnniversaryDTO`, `VacationDTO`, `OfficeMeetingDTO` de `@legends/shared`.
- Produces:
  - `type CalendarFilter = 'aniversarios' | 'tempo-de-casa' | 'ferias' | 'reunioes'`
  - `CALENDAR_FILTERS: readonly CalendarFilter[]`, `CALENDAR_FILTER_LABELS: Record<CalendarFilter, string>`
  - `parseFilters(param: string | null): CalendarFilter[]`, `serializeFilters(filters: CalendarFilter[]): string`
  - `buildMonthDays(monthRef: string): MonthDay[]` com `MonthDay = { iso: string; day: number; inMonth: boolean }`
  - `monthRefOf(iso: string): string`, `shiftMonth(monthRef: string, delta: number): string`, `monthRange(monthRef: string): { from: string; to: string }`, `monthLabel(monthRef: string): string`
  - `type CalendarEvent = { kind: CalendarFilter; iso: string; title: string; subtitle: string | null; userId: string | null; meetingId: string | null }`
  - `buildEvents(input: { monthRef: string; birthdays: BirthdayDTO[]; workAnniversaries: WorkAnniversaryDTO[]; vacations: VacationDTO[]; meetings: OfficeMeetingDTO[] }): Map<string, CalendarEvent[]>`

- [ ] **Step 1: Escrever o teste que falha**

`apps/web/src/pages/calendar/calendar-events.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildEvents, buildMonthDays, monthRange, parseFilters, serializeFilters, shiftMonth } from './calendar-events'

const ana = { id: 'u1', name: 'Ana' } as never

describe('parseFilters', () => {
  it('sem parâmetro liga todos', () => {
    expect(parseFilters(null)).toEqual(['aniversarios', 'tempo-de-casa', 'ferias', 'reunioes'])
  })

  it('lê a lista da querystring', () => {
    expect(parseFilters('ferias,reunioes')).toEqual(['ferias', 'reunioes'])
  })

  it('ignora valor desconhecido', () => {
    expect(parseFilters('ferias,jabuticaba')).toEqual(['ferias'])
  })

  it('cai no padrão quando nenhum valor é válido', () => {
    expect(parseFilters('jabuticaba')).toEqual(['aniversarios', 'tempo-de-casa', 'ferias', 'reunioes'])
  })

  it('serializa de volta', () => {
    expect(serializeFilters(['ferias', 'reunioes'])).toBe('ferias,reunioes')
  })
})

describe('buildMonthDays', () => {
  it('começa no domingo e cobre o mês inteiro', () => {
    const days = buildMonthDays('2026-08')
    expect(days.length % 7).toBe(0)
    // 01/08/2026 é sábado → a grade abre com os últimos dias de julho.
    expect(days[0].iso).toBe('2026-07-26')
    expect(days.filter((d) => d.inMonth)).toHaveLength(31)
  })
})

describe('shiftMonth / monthRange', () => {
  it('avança e volta virando o ano', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })

  it('cobre a grade inteira, não só o mês', () => {
    // A janela precisa alcançar os dias vizinhos que aparecem na grade.
    expect(monthRange('2026-08')).toEqual({ from: '2026-07-26', to: '2026-09-05' })
  })
})

describe('buildEvents', () => {
  it('põe aniversário e tempo de casa no dia certo', () => {
    const map = buildEvents({
      monthRef: '2026-08',
      birthdays: [{ user: ana, day: 10, month: 8 }],
      workAnniversaries: [{ user: ana, day: 12, month: 8, years: 3 }],
      vacations: [],
      meetings: [],
    })
    expect(map.get('2026-08-10')?.[0]).toMatchObject({ kind: 'aniversarios', title: 'Ana' })
    expect(map.get('2026-08-12')?.[0]).toMatchObject({ kind: 'tempo-de-casa', subtitle: '3 anos de casa' })
  })

  it('expande férias por todos os dias do período', () => {
    const map = buildEvents({
      monthRef: '2026-08',
      birthdays: [],
      workAnniversaries: [],
      vacations: [{ id: 'v1', user: ana, startDate: '2026-08-03', endDate: '2026-08-05', note: null }],
      meetings: [],
    })
    expect(map.get('2026-08-03')).toHaveLength(1)
    expect(map.get('2026-08-04')).toHaveLength(1)
    expect(map.get('2026-08-05')).toHaveLength(1)
    expect(map.get('2026-08-06')).toBeUndefined()
  })

  it('recorta férias que passam das bordas da grade', () => {
    const map = buildEvents({
      monthRef: '2026-08',
      birthdays: [],
      workAnniversaries: [],
      vacations: [{ id: 'v1', user: ana, startDate: '2026-06-01', endDate: '2026-10-01', note: null }],
      meetings: [],
    })
    expect(map.get('2026-06-15')).toBeUndefined()
    expect(map.get('2026-08-15')).toHaveLength(1)
  })

  it('põe a reunião no dia local do início', () => {
    const map = buildEvents({
      monthRef: '2026-08',
      birthdays: [],
      workAnniversaries: [],
      vacations: [],
      meetings: [{ id: 'm1', roomName: 'Sala 1', title: 'Planning', startsAt: '2026-08-11T17:00:00.000Z' } as never],
    })
    const dia = map.get('2026-08-11')
    expect(dia?.[0]).toMatchObject({ kind: 'reunioes', title: 'Planning', meetingId: 'm1' })
    expect(dia?.[0].subtitle).toContain('Sala 1')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/calendar/calendar-events.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Escrever o módulo**

`apps/web/src/pages/calendar/calendar-events.ts`:

```ts
import type { BirthdayDTO, OfficeMeetingDTO, VacationDTO, WorkAnniversaryDTO } from '@legends/shared'
import { tenureLabel } from '@legends/shared'

export const CALENDAR_FILTERS = ['aniversarios', 'tempo-de-casa', 'ferias', 'reunioes'] as const
export type CalendarFilter = (typeof CALENDAR_FILTERS)[number]

export const CALENDAR_FILTER_LABELS: Record<CalendarFilter, string> = {
  aniversarios: 'Aniversários',
  'tempo-de-casa': 'Tempo de casa',
  ferias: 'Férias',
  reunioes: 'Reuniões',
}

export const CALENDAR_FILTER_ICONS: Record<CalendarFilter, string> = {
  aniversarios: 'cake',
  'tempo-de-casa': 'workspace_premium',
  ferias: 'beach_access',
  reunioes: 'event',
}

/** Filtro desconhecido é ignorado; nenhum válido volta ao padrão (todos ligados). */
export function parseFilters(param: string | null): CalendarFilter[] {
  if (!param) return [...CALENDAR_FILTERS]
  const wanted = param.split(',').map((s) => s.trim())
  const valid = CALENDAR_FILTERS.filter((f) => wanted.includes(f))
  return valid.length > 0 ? valid : [...CALENDAR_FILTERS]
}

export function serializeFilters(filters: CalendarFilter[]): string {
  return CALENDAR_FILTERS.filter((f) => filters.includes(f)).join(',')
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Data civil YYYY-MM-DD → Date à meia-noite UTC (nenhuma conversão de fuso). */
function utcDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  return isoOf(new Date(utcDate(iso).getTime() + days * DAY_MS))
}

export function monthRefOf(iso: string): string {
  return iso.slice(0, 7)
}

export function shiftMonth(monthRef: string, delta: number): string {
  const [year, month] = monthRef.split('-').map(Number)
  // Date.UTC trata overflow: (2026, 12, 1) → janeiro de 2027.
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1))
  return isoOf(shifted).slice(0, 7)
}

export interface MonthDay {
  iso: string
  day: number
  inMonth: boolean
}

/** A grade: semanas completas de domingo a sábado cobrindo o mês inteiro. */
export function buildMonthDays(monthRef: string): MonthDay[] {
  const [year, month] = monthRef.split('-').map(Number)
  const first = new Date(Date.UTC(year, month - 1, 1))
  const start = new Date(first.getTime() - first.getUTCDay() * DAY_MS)
  const days: MonthDay[] = []
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start.getTime() + i * DAY_MS)
    days.push({ iso: isoOf(date), day: date.getUTCDate(), inMonth: date.getUTCMonth() === month - 1 })
    // Fecha assim que a semana que contém o último dia do mês terminar.
    if (i % 7 === 6 && date.getUTCMonth() !== month - 1 && date > first) break
  }
  return days
}

/** A janela que as queries precisam cobrir: a grade inteira, não só o mês. */
export function monthRange(monthRef: string): { from: string; to: string } {
  const days = buildMonthDays(monthRef)
  return { from: days[0].iso, to: days[days.length - 1].iso }
}

export function monthLabel(monthRef: string): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    utcDate(`${monthRef}-01`),
  )
}

export interface CalendarEvent {
  kind: CalendarFilter
  iso: string
  title: string
  subtitle: string | null
  /** Leva ao perfil quando presente. */
  userId: string | null
  meetingId: string | null
}

function push(map: Map<string, CalendarEvent[]>, event: CalendarEvent) {
  const list = map.get(event.iso) ?? []
  list.push(event)
  map.set(event.iso, list)
}

/** Hora local da reunião — `startsAt` é um instante, não uma data civil. */
function meetingTime(startsAt: string): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(startsAt))
}

function meetingIso(startsAt: string): string {
  const local = new Date(startsAt)
  const y = local.getFullYear()
  const m = String(local.getMonth() + 1).padStart(2, '0')
  const d = String(local.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Eventos por dia da grade. Aniversário e tempo de casa vêm com dia/mês (o ano
 * é o do mês exibido); férias ocupam todos os dias do período, recortadas à
 * grade; reunião cai no dia **local** do início.
 */
export function buildEvents(input: {
  monthRef: string
  birthdays: BirthdayDTO[]
  workAnniversaries: WorkAnniversaryDTO[]
  vacations: VacationDTO[]
  meetings: OfficeMeetingDTO[]
}): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>()
  const year = input.monthRef.slice(0, 4)
  const { from, to } = monthRange(input.monthRef)

  for (const birthday of input.birthdays) {
    push(map, {
      kind: 'aniversarios',
      iso: `${year}-${String(birthday.month).padStart(2, '0')}-${String(birthday.day).padStart(2, '0')}`,
      title: birthday.user.name,
      subtitle: 'Aniversário',
      userId: birthday.user.id,
      meetingId: null,
    })
  }

  for (const anniversary of input.workAnniversaries) {
    push(map, {
      kind: 'tempo-de-casa',
      iso: `${year}-${String(anniversary.month).padStart(2, '0')}-${String(anniversary.day).padStart(2, '0')}`,
      title: anniversary.user.name,
      subtitle: tenureLabel(anniversary.years),
      userId: anniversary.user.id,
      meetingId: null,
    })
  }

  for (const vacation of input.vacations) {
    let cursor = vacation.startDate < from ? from : vacation.startDate
    const last = vacation.endDate > to ? to : vacation.endDate
    while (cursor <= last) {
      push(map, {
        kind: 'ferias',
        iso: cursor,
        title: vacation.user.name,
        subtitle: vacation.note ?? 'Férias',
        userId: vacation.user.id,
        meetingId: null,
      })
      cursor = addDays(cursor, 1)
    }
  }

  for (const meeting of input.meetings) {
    push(map, {
      kind: 'reunioes',
      iso: meetingIso(meeting.startsAt),
      title: meeting.title,
      subtitle: `${meetingTime(meeting.startsAt)} · ${meeting.roomName}`,
      userId: null,
      meetingId: meeting.id,
    })
  }

  return map
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/calendar/calendar-events.test.ts`
Expected: PASS (12 testes). Se `monthRange('2026-08')` não bater com o esperado, corrija `buildMonthDays` — não o teste: a grade **precisa** abrir no domingo anterior ao dia 1.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/calendar/calendar-events.ts apps/web/src/pages/calendar/calendar-events.test.ts
git commit -m "feat(web): módulo puro de eventos do calendário"
```

---

## Task 10: A tela do calendário

**Files:**
- Create: `apps/web/src/lib/vacations-api.ts`, `apps/web/src/pages/calendar/useCalendarData.ts`, `apps/web/src/pages/calendar/CalendarPage.tsx`, `apps/web/src/pages/calendar/CalendarPage.test.tsx`
- Modify: `apps/web/src/lib/use-celebrations.ts`

**Interfaces:**
- Consumes: tudo da Task 9; `VacationsResponse`, `TeamVacationsResponse` (Task 1).
- Produces:
  - `fetchVacations(from, to)`, `createVacation(body)`, `updateVacation(id, body)`, `deleteVacation(id)`, `fetchTeamVacations()` em `lib/vacations-api.ts`
  - `useCalendarData({ monthRef, filters, allRooms })` → `{ eventsByDay, isLoading, isError }`
  - `CalendarPage`

- [ ] **Step 1: Escrever o teste que falha**

`apps/web/src/pages/calendar/CalendarPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { Mock } from 'vitest'
import { CalendarPage } from './CalendarPage'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

const ana = { id: 'u1', name: 'Ana', position: 'Dev', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null }

/** Roteia a resposta pelo path — a tela dispara três queries em paralelo. */
function routeApi() {
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith('/celebrations')) {
      return Promise.resolve({
        referenceDay: '2026-08-11',
        birthdays: { today: [], month: [{ user: ana, day: 10, month: 8 }] },
        workAnniversaries: { today: [], month: [{ user: ana, day: 12, month: 8, years: 3 }] },
      })
    }
    if (path.startsWith('/vacations')) {
      return Promise.resolve({
        vacations: [{ id: 'v1', user: ana, startDate: '2026-08-03', endDate: '2026-08-05', note: null }],
      })
    }
    if (path.startsWith('/office/meetings')) {
      return Promise.resolve([
        { id: 'm1', title: 'Planning', roomName: 'Sala 1', roomExternalKey: 'sala-1', startsAt: '2026-08-11T17:00:00.000Z', endsAt: '2026-08-11T17:30:00.000Z', canceled: false, agenda: null, organizer: ana, participants: [], googleCalendarUrl: '', outlookCalendarUrl: '', icsPath: '' },
      ])
    }
    if (path.startsWith('/office/rooms')) return Promise.resolve({ rooms: [] })
    return Promise.resolve({})
  })
}

function wrap(initialEntry = '/calendario') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <CalendarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CalendarPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeApi()
    // Congela "hoje" para a tela abrir sempre em agosto/2026.
    vi.setSystemTime(new Date('2026-08-11T12:00:00.000Z'))
  })

  it('mostra os quatro tipos de evento no mês', async () => {
    wrap()
    expect(await screen.findByText('Planning')).toBeInTheDocument()
    expect(screen.getAllByText('Ana').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: /agosto de 2026/i })).toBeInTheDocument()
  })

  it('desligar um filtro tira os eventos daquele tipo', async () => {
    wrap()
    await screen.findByText('Planning')
    await userEvent.click(screen.getByRole('button', { name: /reuniões/i }))
    await waitFor(() => expect(screen.queryByText('Planning')).not.toBeInTheDocument())
  })

  it('respeita os filtros vindos da querystring', async () => {
    wrap('/calendario?filtros=reunioes')
    expect(await screen.findByText('Planning')).toBeInTheDocument()
    // Sem o filtro de aniversários, /celebrations nem é chamado.
    expect(mockApiFetch.mock.calls.every(([path]) => !String(path).startsWith('/celebrations'))).toBe(true)
  })

  it('navegar de mês refaz as buscas com o novo intervalo', async () => {
    wrap()
    await screen.findByText('Planning')
    await userEvent.click(screen.getByRole('button', { name: /próximo mês/i }))
    expect(await screen.findByRole('heading', { name: /setembro de 2026/i })).toBeInTheDocument()
    await waitFor(() =>
      expect(mockApiFetch.mock.calls.some(([path]) => String(path).includes('month=2026-09'))).toBe(true),
    )
  })

  it('o toggle "todas as salas" muda a busca de reuniões', async () => {
    wrap()
    await screen.findByText('Planning')
    await userEvent.click(screen.getByRole('checkbox', { name: /todas as salas/i }))
    await waitFor(() =>
      expect(mockApiFetch.mock.calls.some(([path]) => String(path).includes('mine=false'))).toBe(true),
    )
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/calendar/CalendarPage.test.tsx`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Escrever o cliente HTTP de férias**

`apps/web/src/lib/vacations-api.ts`:

```ts
import type {
  CreateVacationRequest,
  TeamVacationsResponse,
  UpdateVacationRequest,
  VacationDTO,
  VacationsResponse,
} from '@legends/shared'
import { apiFetch } from './api'

export function fetchVacations(from: string, to: string): Promise<VacationsResponse> {
  return apiFetch(`/vacations?from=${from}&to=${to}`)
}

export function fetchTeamVacations(): Promise<TeamVacationsResponse> {
  return apiFetch('/me/team/vacations')
}

export function createVacation(body: CreateVacationRequest): Promise<{ vacation: VacationDTO }> {
  return apiFetch('/vacations', { method: 'POST', body: JSON.stringify(body) })
}

export function updateVacation(id: string, body: UpdateVacationRequest): Promise<{ vacation: VacationDTO }> {
  return apiFetch(`/vacations/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deleteVacation(id: string): Promise<void> {
  return apiFetch(`/vacations/${id}`, { method: 'DELETE' })
}
```

- [ ] **Step 4: Deixar `useCelebrations` aceitar mês**

Em `apps/web/src/lib/use-celebrations.ts`:

```ts
/**
 * @param monthRef Mês exibido (YYYY-MM). Ausente = mês corrente — é como a Home
 * chama, e a queryKey diferente mantém o cache dos cards separado do calendário.
 */
export function useCelebrations(monthRef?: string, enabled = true) {
  const query = useQuery({
    queryKey: ['celebrations', monthRef ?? 'atual'],
    queryFn: () => apiFetch<CelebrationsResponse>(monthRef ? `/celebrations?month=${monthRef}` : '/celebrations'),
    enabled,
  })
  // …resto igual…
}
```

- [ ] **Step 5: Escrever `useCalendarData`**

`apps/web/src/pages/calendar/useCalendarData.ts`:

```ts
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { OfficeMeetingDTO } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { useCelebrations } from '../../lib/use-celebrations'
import { fetchVacations } from '../../lib/vacations-api'
import { buildEvents, monthRange, type CalendarEvent, type CalendarFilter } from './calendar-events'

const NO_VACATIONS: never[] = []
const NO_MEETINGS: never[] = []

/**
 * As três fontes do calendário, cada uma atrelada ao seu filtro: filtro
 * desligado não busca. As constantes vazias são estáveis de propósito — um
 * `?? []` inline nasceria novo a cada render e refaria o `useMemo`.
 */
export function useCalendarData(args: {
  monthRef: string
  filters: CalendarFilter[]
  allRooms: boolean
}) {
  const { monthRef, filters, allRooms } = args
  const { from, to } = monthRange(monthRef)
  const wantsCelebrations = filters.includes('aniversarios') || filters.includes('tempo-de-casa')

  const celebrations = useCelebrations(monthRef, wantsCelebrations)

  const vacations = useQuery({
    queryKey: ['vacations', from, to],
    queryFn: () => fetchVacations(from, to),
    enabled: filters.includes('ferias'),
  })

  const meetingsFrom = `${from}T00:00:00.000Z`
  const meetingsTo = `${to}T23:59:59.999Z`
  const meetings = useQuery({
    queryKey: ['calendar-meetings', from, to, allRooms],
    queryFn: () =>
      apiFetch<OfficeMeetingDTO[]>(
        `/office/meetings?from=${encodeURIComponent(meetingsFrom)}&to=${encodeURIComponent(meetingsTo)}${allRooms ? '&mine=false' : ''}`,
      ),
    enabled: filters.includes('reunioes'),
  })

  const eventsByDay = useMemo(
    () =>
      buildEvents({
        monthRef,
        birthdays: filters.includes('aniversarios') ? celebrations.birthdays.month : [],
        workAnniversaries: filters.includes('tempo-de-casa') ? celebrations.workAnniversaries.month : [],
        vacations: filters.includes('ferias') ? (vacations.data?.vacations ?? NO_VACATIONS) : NO_VACATIONS,
        meetings: filters.includes('reunioes') ? (meetings.data ?? NO_MEETINGS) : NO_MEETINGS,
      }),
    [monthRef, filters, celebrations.birthdays, celebrations.workAnniversaries, vacations.data, meetings.data],
  )

  return {
    eventsByDay: eventsByDay as Map<string, CalendarEvent[]>,
    isLoading: celebrations.isLoading || vacations.isLoading || meetings.isLoading,
    isError: celebrations.isError || vacations.isError || meetings.isError,
  }
}
```

- [ ] **Step 6: Escrever a tela**

`apps/web/src/pages/calendar/CalendarPage.tsx` — siga o visual de `DevelopmentThursdayPage.tsx:280-330` (grade `grid-cols-7`, painel lateral `lg:grid-cols-[minmax(0,1fr)_360px]`, botões de mês com `aria-label` "Mês anterior"/"Próximo mês"). Requisitos que os testes cobrem:

- `<h2>` com o mês por extenso (`monthLabel(monthRef)`), capitalizado via `capitalize`.
- Um `<button>` por filtro, com `aria-pressed` e o label de `CALENDAR_FILTER_LABELS`; clicar alterna e escreve em `setSearchParams({ filtros: serializeFilters(next) })`.
- Estado inicial dos filtros vindo de `parseFilters(searchParams.get('filtros'))`.
- Um `<input type="checkbox">` com label "Todas as salas", visível só quando o filtro `reunioes` está ligado.
- Grade: `buildMonthDays(monthRef)`; cada dia é um `<button>` que seleciona o dia; mostra até 3 chips e "+N" quando houver mais; dia de hoje com destaque; dias fora do mês esmaecidos (**sem** desabilitar fim de semana — aniversário cai em sábado).
- Painel lateral: título com a data por extenso do dia selecionado, a lista de eventos daquele dia (chip do tipo + título + subtítulo; evento com `userId` vira `<Link to={'/perfil/' + userId}>`), e o botão "Marcar reunião", que na Task 11 abre o modal.
- Estados: `TeamSkeleton` enquanto carrega; caixa de erro no padrão das outras telas ("Erro ao carregar o calendário.").
- Header com `Icon name="calendar_month"` e subtítulo "Aniversários, tempo de casa, férias e reuniões do seu setor."

Nesta task o botão "Marcar reunião" pode ser um `<button>` que ainda não abre nada — a Task 11 liga o modal.

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/calendar/CalendarPage.test.tsx`
Expected: PASS (5 testes).

- [ ] **Step 8: Rodar os testes da Home, que compartilham `useCelebrations`**

Run: `pnpm --filter @legends/web exec vitest run src/components/BirthdaysCard.test.tsx src/components/WorkAnniversariesCard.test.tsx src/pages/HomePage.test.tsx`
Expected: PASS sem alteração.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/vacations-api.ts apps/web/src/lib/use-celebrations.ts apps/web/src/pages/calendar
git commit -m "feat(web): tela do calendário com filtros por tipo de evento"
```

---

## Task 11: Marcar reunião a partir do calendário

**Files:**
- Create: `apps/web/src/lib/office-rooms-api.ts`
- Modify: `apps/web/src/office/meetings/MeetingForm.tsx`, `apps/web/src/office/meetings/ScheduleMeetingModal.tsx`, `apps/web/src/pages/OfficePage.tsx`, `apps/web/src/pages/calendar/CalendarPage.tsx`
- Test: `apps/web/src/office/meetings/MeetingForm.test.tsx` (criar), `apps/web/src/office/meetings/ScheduleMeetingModal.test.tsx` (existente)

**Interfaces:**
- Consumes: `OfficeRoomOptionDTO` (Task 1), `GET /office/rooms` (Task 7).
- Produces: `fetchOfficeRooms(): Promise<{ rooms: OfficeRoomOptionDTO[] }>`; `MeetingFormValues` ganha `roomExternalKey: string`; `ScheduleMeetingModal` aceita `roomExternalKey: string | null`, `roomName: string | null`, `initialDateLocal?: string`.

- [ ] **Step 1: Escrever o teste que falha**

`apps/web/src/office/meetings/MeetingForm.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { MeetingForm, EMPTY_MEETING_FORM } from './MeetingForm'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('MeetingForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/office/rooms')) {
        return Promise.resolve({
          rooms: [
            { externalKey: 'sala-1', name: 'Sala 1', capacity: 6, status: 'OPEN', voiceEnabled: true },
            { externalKey: 'sala-2', name: 'Sala 2', capacity: null, status: 'OPEN', voiceEnabled: false },
          ],
        })
      }
      return Promise.resolve({ users: [] })
    })
  })

  it('não mostra o campo de sala quando a sala é fixa', async () => {
    wrap(
      <MeetingForm
        initialValues={{ ...EMPTY_MEETING_FORM, roomExternalKey: 'sala-1' }}
        roomFixed
        submitLabel="Marcar"
        pending={false}
        youId="u1"
        onDirty={() => {}}
        onSubmit={() => {}}
      />,
    )
    expect(screen.queryByLabelText(/sala/i)).not.toBeInTheDocument()
  })

  it('mostra o seletor de sala quando a sala é escolhida no formulário', async () => {
    wrap(
      <MeetingForm
        initialValues={EMPTY_MEETING_FORM}
        submitLabel="Marcar"
        pending={false}
        youId="u1"
        onDirty={() => {}}
        onSubmit={() => {}}
      />,
    )
    expect(await screen.findByLabelText(/sala/i)).toBeInTheDocument()
  })

  it('envia a sala escolhida junto com os demais campos', async () => {
    const onSubmit = vi.fn()
    wrap(
      <MeetingForm
        initialValues={EMPTY_MEETING_FORM}
        submitLabel="Marcar"
        pending={false}
        youId="u1"
        onDirty={() => {}}
        onSubmit={onSubmit}
      />,
    )
    await userEvent.click(await screen.findByLabelText(/sala/i))
    await userEvent.click(await screen.findByRole('option', { name: /sala 2/i }))
    await userEvent.type(screen.getByLabelText(/título/i), 'Planning')
    await userEvent.type(screen.getByLabelText(/início/i), '2026-08-11T14:00')
    await userEvent.click(screen.getByRole('button', { name: 'Marcar' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ roomExternalKey: 'sala-2', title: 'Planning' }))
  })

  it('não deixa enviar sem sala escolhida', async () => {
    const onSubmit = vi.fn()
    wrap(
      <MeetingForm
        initialValues={EMPTY_MEETING_FORM}
        submitLabel="Marcar"
        pending={false}
        youId="u1"
        onDirty={() => {}}
        onSubmit={onSubmit}
      />,
    )
    await userEvent.type(await screen.findByLabelText(/título/i), 'Planning')
    await userEvent.type(screen.getByLabelText(/início/i), '2026-08-11T14:00')
    await userEvent.click(screen.getByRole('button', { name: 'Marcar' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
```

> Os seletores de `título`/`início` devem casar com os `<label>` que já existem no `MeetingForm`. Abra o arquivo e ajuste os regexes ao texto real antes de rodar.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/office/meetings/MeetingForm.test.tsx`
Expected: FAIL — `roomExternalKey` não existe em `MeetingFormValues`.

- [ ] **Step 3: Escrever o cliente de salas**

`apps/web/src/lib/office-rooms-api.ts`:

```ts
import type { OfficeRoomOptionDTO } from '@legends/shared'
import { apiFetch } from './api'

/** Salas do mapa ativo, para o seletor de "marcar reunião". */
export function fetchOfficeRooms(): Promise<{ rooms: OfficeRoomOptionDTO[] }> {
  return apiFetch('/office/rooms')
}
```

- [ ] **Step 4: Adicionar o campo de sala ao `MeetingForm`**

Em `apps/web/src/office/meetings/MeetingForm.tsx`:

1. `MeetingFormValues` ganha `roomExternalKey: string`; `EMPTY_MEETING_FORM` ganha `roomExternalKey: ''`.
2. A prop nova `roomFixed?: boolean` — quando `true`, o campo não é renderizado e `roomExternalKey` sai de `initialValues` intocado.
3. Quando `roomFixed` não é passado, renderize antes do campo de título:

```tsx
      {!roomFixed && (
        <div>
          <label className="mb-xs block text-body-sm text-on-surface-variant" htmlFor="meeting-room">
            Sala
          </label>
          <Select
            options={roomOptions}
            value={roomExternalKey}
            onChange={(value) => {
              setRoomExternalKey(value)
              onDirty()
            }}
            ariaLabel="Sala"
            placeholder="Escolha a sala…"
          />
        </div>
      )}
```

com

```tsx
  const rooms = useQuery({ queryKey: ['office-rooms'], queryFn: fetchOfficeRooms, enabled: !roomFixed })
  const roomOptions = useMemo(
    () =>
      (rooms.data?.rooms ?? []).map((room) => ({
        value: room.externalKey,
        label: room.capacity ? `${room.name} · ${room.capacity} lugares` : room.name,
      })),
    [rooms.data],
  )
```

4. No submit, bloqueie quando `!roomFixed && !roomExternalKey` (mesmo tratamento que o formulário já dá a título/início vazios) e inclua `roomExternalKey` no objeto passado a `onSubmit`.

> O `Select` de `apps/web/src/components/Select.tsx` recebe `ariaLabel` e renderiza as opções com `role="option"` — é o que o teste usa.

- [ ] **Step 5: Rodar o teste do formulário**

Run: `pnpm --filter @legends/web exec vitest run src/office/meetings/MeetingForm.test.tsx`
Expected: PASS (4 testes).

- [ ] **Step 6: Deixar o modal aceitar sala nula**

Em `apps/web/src/office/meetings/ScheduleMeetingModal.tsx`:

- Props viram `roomExternalKey: string | null`, `roomName: string | null`, `initialDateLocal?: string` (um `YYYY-MM-DDTHH:mm` para pré-preencher o início).
- Um estado `selectedRoom` inicia com `roomExternalKey`; quando a prop é `null`, ele passa a ser o que o `MeetingForm` escolheu (leia do `values.roomExternalKey` no `onSubmit`).
- `useRoomMeetings(selectedRoom)` — o hook já aceita `null` e não busca (`enabled`); a agenda do topo só aparece quando há sala.
- O título do modal usa `roomName ?? 'Marcar reunião'`.
- `EMPTY_MEETING_FORM` inicial recebe `startsAtLocal: initialDateLocal ?? ''` e `roomExternalKey: roomExternalKey ?? ''`.
- `roomFixed={roomExternalKey !== null}` é repassado ao `MeetingForm`.
- Os `useCreateMeeting`/`useUpdateMeeting`/`useCancelMeeting` passam a receber `selectedRoom ?? ''` para a invalidação da queryKey; invalide também `['calendar-meetings']` no `onSuccess` para o calendário atualizar sozinho.

- [ ] **Step 7: Atualizar o chamador do escritório**

Em `apps/web/src/pages/OfficePage.tsx:754`, nada muda no comportamento — as props continuam com sala e nome preenchidos. Confirme apenas que o TypeScript aceita (o tipo ficou mais largo).

- [ ] **Step 8: Ligar o botão do calendário**

Em `CalendarPage.tsx`, o botão "Marcar reunião" abre:

```tsx
      {scheduleOpen && youId && (
        <ScheduleMeetingModal
          roomExternalKey={null}
          roomName={null}
          youId={youId}
          initialDateLocal={`${selectedIso}T09:00`}
          onClose={() => setScheduleOpen(false)}
        />
      )}
```

`youId` vem de `useAuth().user?.id`.

- [ ] **Step 9: Rodar os testes do modal e da tela**

Run: `pnpm --filter @legends/web exec vitest run src/office/meetings src/pages/calendar`
Expected: PASS. Os testes existentes de `ScheduleMeetingModal.test.tsx` precisam continuar passando com as props antigas (agora tipadas mais largas) — se algum quebrar, ajuste o componente, não o teste.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/office-rooms-api.ts apps/web/src/office/meetings apps/web/src/pages/calendar apps/web/src/pages/OfficePage.tsx
git commit -m "feat(web): marcar reunião pelo calendário escolhendo a sala"
```

---

## Task 12: Cadastro de férias no painel do gestor

**Files:**
- Create: `apps/web/src/components/VacationDialog.tsx`, `apps/web/src/components/VacationDialog.test.tsx`, `apps/web/src/pages/profile/TeamVacationsPanel.tsx`, `apps/web/src/pages/profile/TeamVacationsPanel.test.tsx`
- Modify: `apps/web/src/pages/ProfilePage.tsx`

**Interfaces:**
- Consumes: `vacations-api` (Task 10), `TeamVacationsResponse` (Task 1).
- Produces:
  - `VacationDialog({ user, vacation, onClose })` — `vacation: VacationDTO | null` (null = criar).
  - `TeamVacationsPanel()`.

- [ ] **Step 1: Escrever os testes que falham**

`apps/web/src/components/VacationDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Mock } from 'vitest'
import { VacationDialog } from './VacationDialog'
import { apiFetch } from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn(), ApiError: actual.ApiError }
})
const mockApiFetch = apiFetch as unknown as Mock

const ana = { id: 'u1', name: 'Ana' } as never

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('VacationDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('cria um período para a pessoa', async () => {
    mockApiFetch.mockResolvedValue({ vacation: { id: 'v1' } })
    const onClose = vi.fn()
    wrap(<VacationDialog user={ana} vacation={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText(/início/i), '2026-08-03')
    await userEvent.type(screen.getByLabelText(/fim/i), '2026-08-14')
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }))

    expect(mockApiFetch).toHaveBeenCalledWith(
      '/vacations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ userId: 'u1', startDate: '2026-08-03', endDate: '2026-08-14', note: '' }),
      }),
    )
  })

  it('mostra a mensagem de erro da API', async () => {
    const { ApiError } = await import('../lib/api')
    mockApiFetch.mockRejectedValue(new ApiError('Já existe um período de 2026-08-01 a 2026-08-10 para esta pessoa.', 400))
    wrap(<VacationDialog user={ana} vacation={null} onClose={() => {}} />)

    await userEvent.type(screen.getByLabelText(/início/i), '2026-08-03')
    await userEvent.type(screen.getByLabelText(/fim/i), '2026-08-14')
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/já existe um período/i)
  })

  it('edita um período existente', async () => {
    mockApiFetch.mockResolvedValue({ vacation: { id: 'v1' } })
    wrap(
      <VacationDialog
        user={ana}
        vacation={{ id: 'v1', user: ana, startDate: '2026-08-03', endDate: '2026-08-14', note: 'Férias' }}
        onClose={() => {}}
      />,
    )
    expect(screen.getByLabelText(/início/i)).toHaveValue('2026-08-03')
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }))
    expect(mockApiFetch).toHaveBeenCalledWith('/vacations/v1', expect.objectContaining({ method: 'PATCH' }))
  })
})
```

`apps/web/src/pages/profile/TeamVacationsPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Mock } from 'vitest'
import { TeamVacationsPanel } from './TeamVacationsPanel'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn(), ApiError: actual.ApiError }
})
const mockApiFetch = apiFetch as unknown as Mock

const ana = { id: 'u1', name: 'Ana', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null }

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><TeamVacationsPanel /></QueryClientProvider>)
}

describe('TeamVacationsPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lista os liderados e seus períodos', async () => {
    mockApiFetch.mockResolvedValue({
      groups: [{
        groupId: 's1', groupName: 'Squad A',
        members: [{ user: ana, vacations: [{ id: 'v1', user: ana, startDate: '2026-08-03', endDate: '2026-08-14', note: null }] }],
      }],
    })
    wrap()
    expect(await screen.findByText('Squad A')).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText(/03\/08\/2026/)).toBeInTheDocument()
  })

  it('não renderiza nada para quem não lidera ninguém', async () => {
    mockApiFetch.mockResolvedValue({ groups: [] })
    const { container } = wrap()
    await new Promise((r) => setTimeout(r, 0))
    expect(container).toBeEmptyDOMElement()
  })

  it('abre o diálogo de lançar férias', async () => {
    mockApiFetch.mockResolvedValue({
      groups: [{ groupId: 's1', groupName: 'Squad A', members: [{ user: ana, vacations: [] }] }],
    })
    wrap()
    await userEvent.click(await screen.findByRole('button', { name: /lançar férias para ana/i }))
    expect(screen.getByLabelText(/início/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/components/VacationDialog.test.tsx src/pages/profile/TeamVacationsPanel.test.tsx`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Escrever o `VacationDialog`**

`apps/web/src/components/VacationDialog.tsx` — um modal no padrão visual dos outros do app (overlay + card `rounded-xl border border-outline-variant/40 bg-surface-container`), com:

- Título "Lançar férias — {user.name}" (ou "Editar férias — …" quando `vacation` existe).
- `<label>` "Início" e "Fim" com `<input type="date">`; `<label>` "Observação" com `<input type="text" maxLength={VACATION_NOTE_MAX_LENGTH}>`.
- Botões "Salvar" e "Cancelar" (`onClose`).
- `useMutation` chamando `createVacation`/`updateVacation` de `lib/vacations-api`; no sucesso, `queryClient.invalidateQueries({ queryKey: ['team-vacations'] })`, `invalidateQueries({ queryKey: ['vacations'] })` e `onClose()`.
- Erro: `err instanceof ApiError ? err.message : 'Erro ao salvar as férias.'` num `<p role="alert">`.
- Fechar no `Escape`, como o `ScheduleMeetingModal` já faz.

- [ ] **Step 4: Escrever o `TeamVacationsPanel`**

`apps/web/src/pages/profile/TeamVacationsPanel.tsx` — espelhe a estrutura do `SquadMoodPanel.tsx`:

```tsx
export function TeamVacationsPanel() {
  const teamQuery = useQuery({ queryKey: ['team-vacations'], queryFn: fetchTeamVacations })
  const [dialog, setDialog] = useState<{ user: PublicUser; vacation: VacationDTO | null } | null>(null)
  const groups = teamQuery.data?.groups ?? []
  // Não gerencia ninguém (ou ainda carregando) → não ocupa espaço.
  if (groups.length === 0) return null
  // …card "Férias do time", um bloco por grupo, uma linha por membro com o
  // Avatar, o nome, os períodos formatados (dd/MM/yyyy – dd/MM/yyyy) com botões
  // de editar/remover, e o botão "Lançar férias para {nome}" (aria-label).
}
```

Remoção usa `deleteVacation` com `useMutation` e invalida `['team-vacations']`.

- [ ] **Step 5: Renderizar no perfil**

Em `apps/web/src/pages/ProfilePage.tsx`, logo abaixo de `{showsMood && <SquadMoodPanel />}`:

```tsx
                {/* Férias do time: mesmo público do painel de humor (líder/manager). */}
                {showsMood && <TeamVacationsPanel />}
```

com o import correspondente.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/components/VacationDialog.test.tsx src/pages/profile/TeamVacationsPanel.test.tsx src/pages/ProfilePage.test.tsx`
Expected: PASS. Se `ProfilePage.test.tsx` quebrar por uma chamada nova a `/me/team/vacations`, adicione a resposta ao mock daquele teste.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/VacationDialog.tsx apps/web/src/components/VacationDialog.test.tsx apps/web/src/pages/profile/TeamVacationsPanel.tsx apps/web/src/pages/profile/TeamVacationsPanel.test.tsx apps/web/src/pages/ProfilePage.tsx
git commit -m "feat(web): cadastro de férias no painel do gestor"
```

---

## Task 13: Ação "Férias" no Admin › Colaboradores

**Files:**
- Modify: `apps/web/src/pages/admin/CollaboratorsSection.tsx`
- Test: `apps/web/src/pages/admin/CollaboratorsSection.test.tsx`

**Interfaces:**
- Consumes: `VacationDialog` (Task 12).
- Produces: nada novo.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/web/src/pages/admin/CollaboratorsSection.test.tsx`, novo caso (reaproveite o wrapper e o mock do arquivo):

```tsx
  it('abre o diálogo de férias pela linha do colaborador', async () => {
    // …mock que devolve um colaborador chamado 'Ana'…
    render(/* … */)
    await userEvent.click(await screen.findByRole('button', { name: /^férias$/i }))
    expect(screen.getByLabelText(/início/i)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/CollaboratorsSection.test.tsx`
Expected: FAIL — botão não existe.

- [ ] **Step 3: Adicionar o botão**

Em `CollaboratorsSection.tsx`, no `<div className="flex shrink-0 gap-sm">` da linha (por volta da linha 163), depois do botão "Editar":

```tsx
        <button
          type="button"
          onClick={() => onOpenVacations(member)}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
        >
          Férias
        </button>
```

`onOpenVacations` é uma prop nova da linha, ligada no `CollaboratorsSection` a um estado `vacationTarget: PublicUser | null` que renderiza `<VacationDialog user={vacationTarget} vacation={null} onClose={() => setVacationTarget(null)} />`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/CollaboratorsSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/admin/CollaboratorsSection.tsx apps/web/src/pages/admin/CollaboratorsSection.test.tsx
git commit -m "feat(web): admin lança férias pela linha do colaborador"
```

---

## Task 14: Menu, rota e aposentadoria da `/aniversarios`

**Files:**
- Modify: `apps/web/src/components/nav-items.ts`, `apps/web/src/App.tsx`, `apps/web/src/components/BirthdaysCard.tsx`, `apps/web/src/components/WorkAnniversariesCard.tsx`
- Create: `apps/api/prisma/migrations/<timestamp>_enable_calendario/migration.sql`
- Delete: `apps/web/src/pages/CelebrationsPage.tsx`, `apps/web/src/pages/CelebrationsPage.test.tsx`
- Test: `apps/web/src/components/nav-items.test.ts`, `apps/web/src/App.routing.test.tsx`

**Interfaces:**
- Consumes: `CalendarPage` (Task 10), feature `'calendario'` (Task 1).
- Produces: rota `/calendario`; redirect de `/aniversarios`.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/web/src/components/nav-items.test.ts`:

```ts
  it('inclui Calendário para quem tem a feature', () => {
    const items = buildNavItems({ isAdmin: false, userId: 'u1', role: 'LEGEND', sectorFeatures: ['calendario'] })
    expect(items.find((i) => i.to === '/calendario')?.label).toBe('Calendário')
  })

  it('esconde Calendário de quem não tem a feature', () => {
    const items = buildNavItems({ isAdmin: false, userId: 'u1', role: 'LEGEND', sectorFeatures: ['time'] })
    expect(items.some((i) => i.to === '/calendario')).toBe(false)
  })

  it('admin sempre vê Calendário', () => {
    const items = buildNavItems({ isAdmin: true })
    expect(items.some((i) => i.to === '/calendario')).toBe(true)
  })
```

Em `apps/web/src/App.routing.test.tsx` (siga o padrão dos casos existentes de rota):

```tsx
  it('/aniversarios redireciona para o calendário com os filtros de datas', async () => {
    // …render do App em MemoryRouter com initialEntries={['/aniversarios']} e usuário autenticado…
    await waitFor(() => expect(window.location.pathname).toBe('/calendario'))
    // ou, se o teste do arquivo usa o histórico do MemoryRouter, verifique
    // que a tela do calendário renderizou e a URL contém filtros=aniversarios,tempo-de-casa
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/components/nav-items.test.ts src/App.routing.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Adicionar o item de menu**

Em `apps/web/src/components/nav-items.ts`, na lista do admin, depois de `/time`:

```ts
      { to: '/calendario', label: 'Calendário', icon: 'calendar_month' },
```

e na lista de lenda, depois do item `/time`:

```ts
    { to: '/calendario', label: 'Calendário', icon: 'calendar_month', feature: 'calendario' },
```

- [ ] **Step 4: Registrar a rota e o redirect**

Em `apps/web/src/App.tsx`, importe `CalendarPage` de `./pages/calendar/CalendarPage`, remova o import de `CelebrationsPage` e troque a linha da rota antiga por:

```tsx
                  {/* A tela de aniversários virou o Calendário; o link antigo abre já filtrado. */}
                  <Route
                    path="/aniversarios"
                    element={<Navigate to="/calendario?filtros=aniversarios,tempo-de-casa" replace />}
                  />
                  <Route
                    path="/calendario"
                    element={
                      <FeatureGate feature="calendario">
                        <CalendarPage />
                      </FeatureGate>
                    }
                  />
```

- [ ] **Step 5: Apontar os cards da Home para o calendário**

Em `BirthdaysCard.tsx`, troque o destino do link de `/aniversarios` para `/calendario?filtros=aniversarios`; em `WorkAnniversariesCard.tsx`, para `/calendario?filtros=tempo-de-casa`.

- [ ] **Step 6: Remover a tela antiga**

```bash
git rm apps/web/src/pages/CelebrationsPage.tsx apps/web/src/pages/CelebrationsPage.test.tsx
grep -rn "CelebrationsPage" apps/web/src
```

O `grep` deve voltar vazio. `CelebrationTile` permanece — é usado pela Home.

- [ ] **Step 7: Habilitar a feature nos setores existentes**

Crie `apps/api/prisma/migrations/<timestamp>_enable_calendario/migration.sql` (use o timestamp no formato `AAAAMMDDHHMMSS`, seguindo `20260730120500_enable_corporate_mural_where_resenha` como modelo):

```sql
-- O Calendário absorve a tela de aniversários, que não era gated por feature.
-- Sem isto, quem via os aniversários perderia o acesso até um admin habilitar
-- a feature setor a setor.
UPDATE "Sector"
SET "enabledFeatures" = "enabledFeatures" || '["calendario"]'::jsonb
WHERE NOT ("enabledFeatures" @> '["calendario"]'::jsonb);

-- Terceirizados têm allowlist individual (não herdam a do setor). Só ganham o
-- Calendário quem já via o Time — mesma vizinhança de informação.
UPDATE "User"
SET "enabledFeatures" = "enabledFeatures" || '["calendario"]'::jsonb
WHERE "role" = 'THIRD_PARTY'
  AND "enabledFeatures" @> '["time"]'::jsonb
  AND NOT ("enabledFeatures" @> '["calendario"]'::jsonb);
```

Aplique com `pnpm db:migrate` (o Prisma vai reconhecer a migration manual e aplicá-la).

- [ ] **Step 8: Rodar e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/components/nav-items.test.ts src/App.routing.test.tsx src/pages/HomePage.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(web): rota e item de menu do Calendário; /aniversarios redireciona"
```

---

## Task 15: Verificação final

**Files:** nenhum (a menos que algo quebre).

- [ ] **Step 1: Typecheck dos três workspaces**

```bash
./node_modules/.bin/tsc -p apps/api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit
./node_modules/.bin/tsc -p packages/shared/tsconfig.json --noEmit
```

Expected: sem erros. (Use o binário direto; `npx tsc` é interceptado pelo proxy e pode mentir.)

- [ ] **Step 2: Suíte completa**

```bash
pnpm db:up
pnpm test
```

Expected: tudo verde. Se um teste alheio quebrar, corrija o código — não o teste — e commite a correção separadamente.

- [ ] **Step 3: Build**

```bash
pnpm build
```

Expected: sucesso.

- [ ] **Step 4: Checagem manual (opcional, se o ambiente permitir)**

`pnpm dev`, entrar com a conta de dev do seed, e conferir: item "Calendário" no menu; os quatro filtros ligando/desligando; navegação de mês; "Marcar reunião" com o seletor de sala; o painel "Férias do time" no perfil de um líder.

---

## Self-Review

**Cobertura da spec:**

| Requisito da spec | Task |
|---|---|
| Model `Vacation` com `@db.Date`, índices, regras de sobreposição | 2, 4 |
| `team-scope-service` + squad-mood consumindo | 3 |
| `GET/POST/PATCH/DELETE /vacations`, `GET /me/team/vacations` | 5 |
| `GET /celebrations?month=` | 6 |
| `GET /office/rooms` com DTO enxuto | 7 |
| `GET /office/meetings` sem `room`, `mine`, teto de 62 dias | 8 |
| Contrato em `@legends/shared` (vacation, OfficeRoomOptionDTO, FeatureKey) | 1 |
| Grade do mês, filtros na querystring, férias expandidas, cores por tipo | 9, 10 |
| Toggle "todas as salas" | 10 |
| Marcar reunião com seletor de sala; escritório intacto | 11 |
| `TeamVacationsPanel` no perfil do gestor + `VacationDialog` | 12 |
| Ação "Férias" no Admin › Colaboradores | 13 |
| Item de menu, rota, `FeatureGate`, redirect, cards da Home, remoção da tela antiga | 14 |
| Feature habilitada nos setores existentes | 14 |

Sem lacunas.

**Consistência de nomes:** `roomExternalKey` (não `roomKey`) atravessa Tasks 1/7/11; `listManagedGroups`/`managesUser` (Task 3) são consumidas por nome idêntico na Task 4; `parseFilters`/`serializeFilters`/`monthRange`/`buildEvents` (Task 9) aparecem com a mesma assinatura na Task 10; `fetchTeamVacations` (Task 10) é usada na Task 12; `VacationDialog({ user, vacation, onClose })` tem a mesma assinatura nas Tasks 12 e 13.

**Sem placeholders:** nenhum "TBD"/"depois"; os únicos pontos onde o plano manda o implementador olhar o código em vez de ditar a linha são os que dependem de helpers de teste já existentes (setup de mapa publicado na Task 7, helpers de reunião na Task 8, labels reais do `MeetingForm` na Task 11) — em todos, o comportamento esperado está escrito por extenso.
